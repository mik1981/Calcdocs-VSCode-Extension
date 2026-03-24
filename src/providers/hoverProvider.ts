import * as vscode from "vscode";

import {
  DEFINE_DIRECTIVE_RX,
  findDocumentSymbolDefinitions,
} from "../core/documentSymbols";
import {
  evaluateExpressionPreview,
  formatExpandedPreview,
  formatPreviewNumberWithHex,
} from "../core/preview";
import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";
import { formatNumbersWithThousandsSeparator } from "../utils/nformat";
import { DEFINE_NAME_RX, FUNCTION_DEFINE_RX, OBJECT_DEFINE_RX } from "../utils/regex";
import { stripComments } from "../utils/text";

const HOVER_VARIANT_LIMIT = 8;
const HOVER_IN_DOC_DEFINITION_LIMIT = 6;

type InDocumentSymbolDefinition = {
  expr: string;
  line: number;
};

function debugLog(state: CalcDocsState, message: string): void {
  state.output.detail(message);
}

function toCCodeBlock(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    return "";
  }

  return `\`\`\`c\n${trimmed}\n\`\`\``;
}

function indentBlock(block: string, indent = "  "): string {
  return block
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
}

function extractFunctionMacroCall(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  const lineText = document.lineAt(position.line).text;
  const lineUntilCursor = lineText.slice(0, position.character);

  let identifierStart = lineUntilCursor.length - 1;
  while (identifierStart >= 0 && /[A-Za-z_]/.test(lineText[identifierStart])) {
    identifierStart -= 1;
  }
  identifierStart += 1;

  if (identifierStart >= lineUntilCursor.length) {
    return null;
  }

  const potentialName = lineText.slice(identifierStart, lineUntilCursor.length);
  if (!/^[A-Za-z_]\w*$/.test(potentialName)) {
    return null;
  }

  const afterName = lineUntilCursor
    .slice(identifierStart + potentialName.length)
    .match(/^\s*\(/);
  if (!afterName) {
    return null;
  }

  let depth = 0;
  let end = identifierStart + potentialName.length + afterName[0].length - 1;

  while (end < lineText.length) {
    const char = lineText[end];

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
      while (end < lineText.length) {
        if (lineText[end] === "\\") {
          end += 2;
          continue;
        }

        if (lineText[end] === quote) {
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

  const call = lineText.slice(identifierStart, end).trim();
  return call || null;
}

function extractMacroCallWithRegex(lineText: string): string | null {
  if (/^\s*#\s*define/.test(lineText)) {
    return null;
  }

  const match = lineText.match(/([A-Za-z_]\w*)\s*\((.*)\)/);
  return match ? match[0] : null;
}

function extractMacroCallFromDefineRightSide(lineText: string): string | null {
  const noComment = lineText.split("//")[0];
  const defineMatch = noComment.match(/^\s*#\s*define\s+[A-Za-z_]\w*\s+(.*)$/);
  if (!defineMatch) {
    return null;
  }

  const rightHandSide = defineMatch[1].trim();
  const nameMatch = rightHandSide.match(/^([A-Za-z_]\w*)\s*\(/);
  if (!nameMatch) {
    return null;
  }

  let depth = 0;
  let end = nameMatch[0].length - 1;

  while (end < rightHandSide.length) {
    const char = rightHandSide[end];

    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    } else if (char === '"' || char === "'") {
      const quote = char;
      end += 1;
      while (end < rightHandSide.length) {
        if (rightHandSide[end] === "\\") {
          end += 2;
          continue;
        }

        if (rightHandSide[end] === quote) {
          break;
        }

        end += 1;
      }
    }

    end += 1;
  }

  if (depth !== 0) {
    return null;
  }

  return rightHandSide.slice(0, end).trim();
}

function normalizeMacroCallForDisplay(call: string): string {
  let output = call;
  output = output.replace(/\s+\(/g, "(");
  output = output.replace(/\(\s+/g, "(");
  output = output.replace(/\s+\)/g, ")");
  output = output.replace(/\)\s+/g, ")");
  output = output.replace(/\s*,\s*/g, ",");
  output = output.replace(/\s*([+\-*/%|&^<>])\s*/g, "$1");
  return output.replace(/\s+/g, " ").trim();
}

function getMacroName(call: string): string | null {
  return call.match(/^([A-Za-z_]\w*)/)?.[1] ?? null;
}

function resolveMacroCallForHover(
  document: vscode.TextDocument,
  position: vscode.Position,
  hoveredWord: string,
  lineText: string,
  state: CalcDocsState
): string | null {
  const isDefineLine = DEFINE_DIRECTIVE_RX.test(lineText);
  let macroToEvaluate =
    extractFunctionMacroCall(document, position) ??
    extractMacroCallWithRegex(lineText) ??
    null;

  const definedMacro = lineText.match(DEFINE_NAME_RX)?.[1] ?? null;

  if (isDefineLine) {
    const functionDefineMatch = lineText.match(FUNCTION_DEFINE_RX);
    const objectDefineMatch = lineText.match(OBJECT_DEFINE_RX);

    if (functionDefineMatch) {
      const macroName = functionDefineMatch[1];
      if (hoveredWord !== macroName) {
        return null;
      }

      const rhsCall = extractMacroCallFromDefineRightSide(lineText);
      if (rhsCall) {
        macroToEvaluate = rhsCall;
      }
      return macroToEvaluate;
    }

    if (objectDefineMatch) {
      if (hoveredWord === definedMacro) {
        debugLog(state, "Hover on object-like macro name, skipping macro evaluation");
        return null;
      }

      const rhsCall = extractMacroCallFromDefineRightSide(lineText);
      if (!rhsCall) {
        return null;
      }

      return getMacroName(rhsCall) === hoveredWord ? rhsCall : null;
    }
  }

  const rhsCall = extractMacroCallFromDefineRightSide(lineText);
  if (rhsCall && getMacroName(rhsCall) === hoveredWord) {
    return rhsCall;
  }

  return macroToEvaluate;
}

function formatConditionalDefinitionsSection(
  symbol: string,
  state: CalcDocsState
): string | null {
  const variants = state.symbolConditionalDefs.get(symbol);
  if (!variants || variants.length <= 1) {
    return null;
  }

  const lines: string[] = ["**Multiple C/C++ definitions:**"];
  const shown = variants.slice(0, HOVER_VARIANT_LIMIT);

  for (const variant of shown) {
    const location = `${variant.file}:${variant.line + 1}`;
    lines.push(`- when \`${variant.condition}\`:`);

    const exprBlock = toCCodeBlock(variant.expr);
    if (exprBlock) {
      lines.push(indentBlock(exprBlock));
    } else {
      lines.push(`  \`${variant.expr}\``);
    }

    lines.push(`  (\`${location}\`)`);
  }

  if (variants.length > shown.length) {
    lines.push(`- ...and ${variants.length - shown.length} more`);
  }

  return lines.join("\n");
}

function formatInDocumentMultipleDefinitionsSection(
  symbol: string,
  document: vscode.TextDocument,
  state: CalcDocsState,
  inDocumentDefinitions: InDocumentSymbolDefinition[]
): string | null {
  const trackedVariants = state.symbolConditionalDefs.get(symbol);
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
    lines.push(`- \`${definition.expr}\` (\`${relativePath}:${definition.line + 1}\`)`);
  }

  if (inDocumentDefinitions.length > shown.length) {
    lines.push(`- ...and ${inDocumentDefinitions.length - shown.length} more`);
  }

  return lines.join("\n");
}

function formatInheritedAmbiguitySection(
  symbol: string,
  state: CalcDocsState
): string | null {
  const roots = state.symbolAmbiguityRoots.get(symbol);
  if (!roots || roots.length === 0) {
    return null;
  }

  const inheritedFrom = roots.filter((name) => name !== symbol);
  if (inheritedFrom.length === 0) {
    return null;
  }

  return `**Depends on symbols with multiple definitions:** \`${inheritedFrom.join("`, `")}\``;
}

function buildOpenFormulaCommandLink(
  symbol: string,
  formula: { _filePath?: string; _line?: number }
): string | null {
  if (!formula._filePath) {
    return null;
  }

  const line = (formula._line ?? 0) + 1;
  const locationLabel = `${formula._filePath}:${line}`;
  const args = encodeURIComponent(JSON.stringify([symbol]));
  return `[Open formula source (${locationLabel})](command:calcdocs.fixMismatch?${args})`;
}

function appendFormulaSection(
  symbol: string,
  state: CalcDocsState,
  sections: string[]
): void {
  const formula = state.formulaIndex.get(symbol);
  if (!formula) {
    return;
  }

  sections.push(
    `### ${formula.key}${formula.unit ? `  \n*Unit:* \`${formula.unit}\`` : ""}`
  );

  if (Array.isArray(formula.steps) && formula.steps.length > 0) {
    const stepLines = formula.steps.map((step) => `  - \`${step}\``).join("\n");
    sections.push(`*Steps:*\n${stepLines}`);
  }

  if (formula.formula) {
    sections.push("*Formula:*");
    const formulaBlock = toCCodeBlock(formula.formula);
    if (formulaBlock) {
      sections.push(formulaBlock);
    }
  }

  if (formula.expanded) {
    sections.push("*Expanded:*");
    const expandedBlock = toCCodeBlock(
      formatExpandedPreview(state, formula.expanded)
    );
    if (expandedBlock) {
      sections.push(expandedBlock);
    }

    if (typeof formula.valueCalc === "number") {
      sections.push(`-> \`${formatPreviewNumberWithHex(state, formula.valueCalc)}\``);
    }
  }

  const openFormulaLink = buildOpenFormulaCommandLink(symbol, formula);
  if (openFormulaLink) {
    sections.push(openFormulaLink);
  }
}

function appendKnownValueSection(
  symbol: string,
  state: CalcDocsState,
  sections: string[]
): void {
  if (state.formulaIndex.has(symbol)) {
    return;
  }

  const knownValue = state.symbolValues.get(symbol);
  if (typeof knownValue !== "number") {
    return;
  }

  sections.push(`${symbol} = **${formatPreviewNumberWithHex(state, knownValue)}**`);
}

function evaluateMacroForHover(macroCall: string, state: CalcDocsState): string {
  const preview = evaluateExpressionPreview(state, macroCall);
  state.output.detail(`Preview.expanded: ${preview.expanded}`);
  state.output.detail(`Preview.value: ${preview.value}`);

  const displayCall = normalizeMacroCallForDisplay(stripComments(macroCall));
  const sections: string[] = [];
  const displayBlock = toCCodeBlock(displayCall);
  sections.push(displayBlock || displayCall);

  if (typeof preview.value === "number") {
    sections.push(`-> **${formatPreviewNumberWithHex(state, preview.value)}**`);
    return sections.join("\n\n");
  }

  const expanded = (preview.expanded ?? "").trim();
  if (!expanded || expanded === macroCall) {
    sections.push(`-> \`${displayCall}\``);
    return sections.join("\n\n");
  }

  const expandedNumber = Number(expanded);
  if (Number.isFinite(expandedNumber)) {
    sections.push(`-> **${formatPreviewNumberWithHex(state, expandedNumber)}**`);
    return sections.join("\n\n");
  }

  const expandedBlock = toCCodeBlock(formatExpandedPreview(state, expanded));
  if (expandedBlock) {
    sections.push(`->\n${expandedBlock}`);
  } else {
    sections.push(`-> **${formatExpandedPreview(state, expanded)}**`);
  }

  return sections.join("\n\n");
}

function buildSymbolHoverSections(
  word: string,
  document: vscode.TextDocument,
  state: CalcDocsState,
  inDocumentDefinitions: InDocumentSymbolDefinition[]
): string[] {
  const sections: string[] = [];
  const trackedVariants = state.symbolConditionalDefs.get(word) ?? [];
  const ambiguityRoots = state.symbolAmbiguityRoots.get(word) ?? [];

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
    sections.push(formatNumbersWithThousandsSeparator(state, conditionalDefinitions));
  }

  const inDocumentSection = formatInDocumentMultipleDefinitionsSection(
    word,
    document,
    state,
    inDocumentDefinitions
  );
  if (inDocumentSection) {
    sections.push(inDocumentSection);
  }

  const inheritedAmbiguity = formatInheritedAmbiguitySection(word, state);
  if (inheritedAmbiguity) {
    sections.push(inheritedAmbiguity);
  }

  appendFormulaSection(word, state, sections);
  appendKnownValueSection(word, state, sections);

  return sections;
}

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
          debugLog(state, "Hover ignored: extension disabled");
          return undefined;
        }

        const word = pickWord(document, position);
        if (!word) {
          return undefined;
        }

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          return undefined;
        }

        const fullLine = document.lineAt(position.line).text;
        const macroToEvaluate = resolveMacroCallForHover(
          document,
          position,
          word,
          fullLine,
          state
        );

        if (macroToEvaluate) {
          debugLog(state, `Evaluating macro call: ${macroToEvaluate}`);
          const markdown = new vscode.MarkdownString(
            evaluateMacroForHover(macroToEvaluate, state)
          );
          markdown.isTrusted = true;
          return new vscode.Hover(markdown, range);
        }

        const inDocumentDefinitions = findDocumentSymbolDefinitions(
          document.getText(),
          word
        ).map((definition) => ({
          expr: definition.parsed.expr,
          line: definition.line,
        }));

        const sections = buildSymbolHoverSections(
          word,
          document,
          state,
          inDocumentDefinitions
        );

        if (sections.length === 0) {
          return undefined;
        }

        const markdown = new vscode.MarkdownString(sections.join("\n\n"));
        markdown.isTrusted = true;
        return new vscode.Hover(markdown, range);
      },
    })
  );
}
