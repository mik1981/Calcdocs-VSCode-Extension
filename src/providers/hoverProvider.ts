import * as vscode from "vscode";

import { parseCppSymbolDefinition } from "../core/cppParser";
import {
  buildCompositeExpressionPreview,
} from "../core/expression";
import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";
import { formatNumbersWithThousandsSeparator } from "../utils/nformat";
import { updateBraceDepth } from "../utils/braceDepth";

const HOVER_VARIANT_LIMIT = 8;
const HOVER_IN_DOC_DEFINITION_LIMIT = 6;
const DEFINE_DIRECTIVE_RX = /^\s*#\s*define\b/;

/**
 * Extracts a full function-like macro call expression at the cursor position.
 * Returns the complete expression including the function name and its arguments,
 * or null if the cursor is not inside a function-like macro call.
 */
function extractFunctionMacroCall(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  const line = document.lineAt(position.line).text;
  const lineUntilCursor = line.slice(0, position.character);

  // Find the start of a potential identifier before the cursor
  let start = lineUntilCursor.length - 1;
  while (start >= 0 && /[A-Za-z_]/.test(line[start])) {
    start -= 1;
  }
  start += 1;

  if (start >= lineUntilCursor.length) {
    return null;
  }

  const potentialName = line.slice(start, lineUntilCursor.length);
  if (!/^[A-Za-z_]\w*$/.test(potentialName)) {
    return null;
  }

  // Check if there's an opening parenthesis after the identifier (allowing whitespace)
  const afterName = lineUntilCursor.slice(start + potentialName.length).match(/^\s*\(/);
  if (!afterName) {
    return null;
  }

  // Find the matching closing parenthesis
  let depth = 0;
  let end = start + potentialName.length + afterName[0].length - 1;

  while (end < line.length) {
    const char = line[end];

    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    } else if (char === '"' || char === "'") {
      const quote = char;
      end += 1;
      while (end < line.length) {
        if (line[end] === "\\") {
          end += 2;
          continue;
        }
        if (line[end] === quote) {
          end += 1;
          break;
        }
        end += 1;
      }
      continue;
    }

    end += 1;
  }

  if (depth !== 0) {
    return null;
  }

  const expr = line.slice(start, end).trim();
  return expr || null;
}

function findSymbolDefinitionsInDocument(
  document: vscode.TextDocument,
  word: string
): Array<{ expr: string; line: number }> {
  const lines = document.getText().split(/\r?\n/);
  const definitions: Array<{ expr: string; line: number }> = [];
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const canParseDeclaration = braceDepth === 0 || DEFINE_DIRECTIVE_RX.test(line);
    const parsed = canParseDeclaration ? parseCppSymbolDefinition(line) : undefined;
    if (!parsed || parsed.name !== word) {
      braceDepth = updateBraceDepth(braceDepth, line);
      continue;
    }

    definitions.push({
      expr: parsed.expr,
      line: i,
    });

    braceDepth = updateBraceDepth(braceDepth, line);
  }

  return definitions;
}

function formatConditionalDefinitionsSection(
  word: string,
  state: CalcDocsState
): string | null {
  const variants = state.symbolConditionalDefs.get(word);
  if (!variants || variants.length <= 1) {
    return null;
  }

  const lines: string[] = ["**Multiple C/C++ definitions:**"];
  const shown = variants.slice(0, HOVER_VARIANT_LIMIT);

  for (const variant of shown) {
    const location = `${variant.file}:${variant.line + 1}`;
    lines.push(
      `- when \`${variant.condition}\`: \`${variant.expr}\` (\`${location}\`)`
    );
  }

  if (variants.length > shown.length) {
    lines.push(`- ...and ${variants.length - shown.length} more`);
  }

  return lines.join("\n");
}

function formatInDocumentMultipleDefinitionsSection(
  word: string,
  document: vscode.TextDocument,
  state: CalcDocsState,
  inDocumentDefinitions: Array<{ expr: string; line: number }>
): string | null {
  const trackedVariants = state.symbolConditionalDefs.get(word);
  if (trackedVariants && trackedVariants.length > 1) {
    return null;
  }

  if (inDocumentDefinitions.length <= 1) {
    return null;
  }

  const lines: string[] = ["**Multiple definitions found in current file:**"];
  const shown = inDocumentDefinitions.slice(0, HOVER_IN_DOC_DEFINITION_LIMIT);
  const relativePath = vscode.workspace.asRelativePath(document.uri.fsPath);

  for (const definition of shown) {
    lines.push(
      `- \`${definition.expr}\` (\`${relativePath}:${definition.line + 1}\`)`
    );
  }

  if (inDocumentDefinitions.length > shown.length) {
    lines.push(`- ...and ${inDocumentDefinitions.length - shown.length} more`);
  }

  return lines.join("\n");
}

function formatInheritedAmbiguitySection(
  word: string,
  state: CalcDocsState
): string | null {
  const roots = state.symbolAmbiguityRoots.get(word);
  if (!roots || roots.length === 0) {
    return null;
  }

  const inheritedFrom = roots.filter((name) => name !== word);
  if (inheritedFrom.length === 0) {
    return null;
  }

  return `**Depends on symbols with multiple definitions:** \`${inheritedFrom.join(
    "`, `"
  )}\``;
}

function buildOpenFormulaCommandLink(
  word: string,
  formula: { _filePath?: string; _line?: number }
): string | null {
  if (!formula._filePath) {
    return null;
  }

  const line = (formula._line ?? 0) + 1;
  const locationLabel = `${formula._filePath}:${line}`;
  const args = encodeURIComponent(JSON.stringify([word]));
  return `[Open formula source (${locationLabel})](command:calcdocs.fixMismatch?${args})`;
}

/**
 * Registers hover provider for C/C++ symbols.
 * Hover includes computed value plus linked YAML formula details when available.
 */
export function registerCppHoverProvider(
  context: vscode.ExtensionContext,
  state: CalcDocsState,
  enableCppProviders: boolean
): void {
  if (!enableCppProviders) {
    return;
  }

  const cppSelectors: vscode.DocumentSelector = [
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" },
    { language: "c", scheme: "untitled" },
    { language: "cpp", scheme: "untitled" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(cppSelectors, {
      provideHover(document, position) {
        if (!state.enabled) {
          state.output.debug("Hover ignored: state.disabled");
          return undefined;
        }

        const word = pickWord(document, position);
        if (!word) {
          state.output.debug("No word found at position");
          return undefined;
        }
        state.output.debug(`Hover word detected: ${word}`);

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          state.output.debug("No identifier range found");
          return undefined;
        }

        const fullLine = document.lineAt(position.line).text;
        const isDefineLine = DEFINE_DIRECTIVE_RX.test(fullLine);

        state.output.debug(`Full line: ${fullLine}`);
        state.output.debug(`Is define line: ${isDefineLine}`);

        // --- 1) Prova ad estrarre macro-call dal cursore
        let functionMacroCall = extractFunctionMacroCall(document, position);
        state.output.debug(`Function macro detected by extractFunctionMacroCall(): ${functionMacroCall}`);

        // --- 2) Fallback regex (valido anche su righe #define)
        const fallbackCallMatch = fullLine.match(/([A-Za-z_]\w*)\s*\([^)]*\)/);
        const fallbackCall = fallbackCallMatch?.[0] ?? null;
        state.output.debug(`Fallback macro match: ${fallbackCall ?? "null"}`);

        // --- 3) Macro individuata complessiva
        let macroToEvaluate: string | null = functionMacroCall ?? fallbackCall ?? null;

        // --- 4) #define: cerca una call nella parte destra se non trovata
        if (isDefineLine && !macroToEvaluate) {
          state.output.debug("Line is a #define: scanning right‑side expression for macro call…");
          const rightSideMatch = fullLine.match(/([A-Za-z_]\w*\([^)]*\))/);
          if (rightSideMatch) {
            macroToEvaluate = rightSideMatch[1];
            state.output.debug(`Found macro call inside #define → ${macroToEvaluate}`);
          } else {
            state.output.debug("No macro call detected inside the define line.");
          }
        }

        // --- 5) Se esiste una macro-call, valutala SOLO se il cursore è sul suo nome
        if (macroToEvaluate) {
          const macroName = macroToEvaluate.match(/^([A-Za-z_]\w*)/)?.[1] ?? "";
          if (word !== macroName) {
            state.output.debug(
              `Cursor is on '${word}', but macro '${macroToEvaluate}' refers to '${macroName}' → skipping macro evaluation`
            );
            macroToEvaluate = null;
          }
        }

        // --- 6) Valutazione macro (se ancora valida dopo il controllo del nome)
        if (macroToEvaluate) {
          state.output.debug(`Evaluating macro call: ${macroToEvaluate}`);

          const preview = buildCompositeExpressionPreview(
            macroToEvaluate,
            state.symbolValues,
            state.allDefines,
            state.functionDefines,
            {},
            state.defineConditions
          );

          state.output.debug(`Preview.expanded: ${preview.expanded}`);
          state.output.debug(`Preview.value: ${preview.value}`);

          // Normalizza la call per una resa più pulita (es. FINAL(VEL*MUL))
          const normalizeCall = (call: string) => {
            let s = call;
            s = s.replace(/\s+\(/g, "(");
            s = s.replace(/\(\s+/g, "(");
            s = s.replace(/\s+\)/g, ")");
            s = s.replace(/\)\s+/g, ")");
            s = s.replace(/\s*,\s*/g, ",");
            s = s.replace(/\s*([+\-*/%|&^<>])\s*/g, "$1");
            // Rimuove spazi multipli residui
            s = s.replace(/\s+/g, " ").trim();
            return s;
          };

          const displayCall = normalizeCall(macroToEvaluate);
          const sections: string[] = [`**${displayCall}**`];

            if (preview.value !== null) {
            // Caso migliore: mostra direttamente il valore
            sections.push(
              formatNumbersWithThousandsSeparator(
                state, 
                `→ **${preview.value}**`
              )
            );
            } else {
            // Evita effetti tipo "80 80": se l'espansione è una doppia del medesimo numero, mostralo una sola volta
            const expanded = (preview.expanded ?? "").trim();
            if (expanded && expanded !== macroToEvaluate) {
              const tokens = expanded.split(/\s+/).filter(Boolean);

              // if two identical numbers → show one
              const allNumeric = tokens.every((t) => !isNaN(Number(t)));
              const allSame =
                allNumeric &&
                new Set(tokens.map((t) => Number(t))).size === 1;

              if (allSame) {
                sections.push(`→ **${Number(tokens[0])}**`);
              } else {
                // pick first numeric token
                const firstNum = tokens.find(
                  (t) => !isNaN(Number(t.replace(/[()]/g, "")))
                );

                if (firstNum !== undefined) {
                  const normalized = Number(firstNum.replace(/[()]/g, ""));
                  sections.push(`→ **${normalized}**`);
                } else {
                  sections.push(`→ \`${expanded}\``);
                }
              }
            } else {
              // Fallback: nessun valore e nessuna espansione significativa → mostra la call
              sections.push(`→ \`${displayCall}\``);
              }
            }

          const markdown = new vscode.MarkdownString(sections.join(" "));
            markdown.isTrusted = true;

          state.output.debug("Returning hover from macro evaluation.");
            return new vscode.Hover(markdown, range);
        }

        // --- 7) SYMBOL‑LEVEL LOGIC (come prima, con debug)
        const inDocumentDefinitions = findSymbolDefinitionsInDocument(document, word);
        state.output.debug(`In-document definitions found: ${inDocumentDefinitions.length}`);

        const sections: string[] = [];
        const trackedVariants = state.symbolConditionalDefs.get(word) ?? [];
        const ambiguityRoots = state.symbolAmbiguityRoots.get(word) ?? [];

        state.output.debug(`Tracked variants: ${trackedVariants.length}`);
        state.output.debug(`Ambiguity roots: ${ambiguityRoots.length}`);

        const hasTrackedAmbiguity = ambiguityRoots.length > 0;
        const hasInDocumentAmbiguity =
          trackedVariants.length <= 1 && inDocumentDefinitions.length > 1;

        if (hasTrackedAmbiguity) {
          sections.push(`**${word}: conditional value (multiple possible definitions)**`);
        } else if (hasInDocumentAmbiguity) {
          sections.push(`**${word}: multiple definitions found, value is not unique**`);
        } 

        const conditionalDefinitions = formatConditionalDefinitionsSection(word, state);
        if (conditionalDefinitions) {
          sections.push(
            formatNumbersWithThousandsSeparator(
              state, 
              conditionalDefinitions
            )
          );
        }

        const inDocumentAmbiguitySection = formatInDocumentMultipleDefinitionsSection(
          word,
          document,
          state,
          inDocumentDefinitions
        );
        if (inDocumentAmbiguitySection) {
          sections.push(inDocumentAmbiguitySection);
        }

        const inheritedAmbiguity = formatInheritedAmbiguitySection(word, state);
        if (inheritedAmbiguity) {
          sections.push(inheritedAmbiguity);
        }

        const formula = state.formulaIndex.get(word);
        if (formula) {
          state.output.debug(`Formula found for ${word}`);
          sections.push(
            `### ${formula.key}${formula.unit ? `  \n*Unit:* \`${formula.unit}\`` : ""}`
          );

          if (formula.steps && Array.isArray(formula.steps) && formula.steps.length > 0) {
            const stepLines = formula.steps.map((s) => `  - \`${s}\``).join("\n");
            sections.push(`*Steps:*\n${stepLines}`);
          }

          if (formula.formula) {
            sections.push(`*Formula:* **\`${formula.formula}\`**`);
          }

          if (formula.expanded) {
            const arrow = typeof formula.valueCalc === "number" ? ` -> \`${formula.valueCalc}\`` : "";
            sections.push(
              formatNumbersWithThousandsSeparator(state, `**\`${formula.expanded}\`${arrow}**`)
            );
          }

          const openFormulaLink = buildOpenFormulaCommandLink(word, formula);
          if (openFormulaLink) sections.push(openFormulaLink);
        } else if (state.symbolValues.has(word)) {
          const knownValue = state.symbolValues.get(word);
          if (typeof knownValue === "number") {
            sections.push(
              formatNumbersWithThousandsSeparator(state, `${word} = **${knownValue}**`)
            );
          }
        }

        if (sections.length === 0) {
          state.output.debug("No hover sections generated → returning undefined");
          return undefined;
        }

        state.output.debug(`Generated hover sections:\n${sections.join("\n---\n")}`);

        const markdown = new vscode.MarkdownString(sections.join("\n\n"));
        markdown.isTrusted = true;

        return new vscode.Hover(markdown, range);
      },
    })
  );
}
