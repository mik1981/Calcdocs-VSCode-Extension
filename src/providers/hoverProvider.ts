import * as vscode from "vscode";

import { parseCppSymbolDefinition } from "../core/cppParser";
import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";

const HOVER_VARIANT_LIMIT = 8;
const HOVER_IN_DOC_DEFINITION_LIMIT = 6;

function findSymbolDefinitionsInDocument(
  document: vscode.TextDocument,
  word: string
): Array<{ expr: string; line: number }> {
  const lines = document.getText().split(/\r?\n/);
  const definitions: Array<{ expr: string; line: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseCppSymbolDefinition(lines[i]);
    if (!parsed || parsed.name !== word) {
      continue;
    }

    definitions.push({
      expr: parsed.expr,
      line: i,
    });
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
        const word = pickWord(document, position);
        if (!word) {
          return undefined;
        }

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          return undefined;
        }

        const inDocumentDefinitions = findSymbolDefinitionsInDocument(document, word);
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
        } else if (state.symbolValues.has(word)) {
          const knownValue = state.symbolValues.get(word);
          if (typeof knownValue === "number") {
            sections.push(`**${word} = ${knownValue}**`);
          }
        }

        const conditionalDefinitions = formatConditionalDefinitionsSection(word, state);
        if (conditionalDefinitions) {
          sections.push(conditionalDefinitions);
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
          sections.push(`### ${formula.key}${formula.unit ? `  \n*Unit:* \`${formula.unit}\`` : ""}`);

          if (formula.formula) {
            sections.push(`**YAML Formula:** \`${formula.formula}\``);
          }

          if (formula.expanded) {
            const arrow = typeof formula.valueCalc === "number" ? ` -> \`${formula.valueCalc}\`` : "";
            sections.push(`**Expanded YAML:** \`${formula.expanded}\`${arrow}`);
          }

          if (typeof formula.valueCalc === "number") {
            sections.push(`**YAML Value:** \`${formula.valueCalc}\``);
          }
        }

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
