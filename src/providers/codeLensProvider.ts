import * as vscode from "vscode";

import { collectDocumentSymbolDefinitions } from "../core/documentSymbols";
import { isCompositeExpression, unwrapParens } from "../core/expression";
import {
  buildCStylePreview,
  evaluateExpressionPreview,
  formatExpandedPreview,
  normalizeExpandedPreviewText,
  formatPreviewNumber,
} from "../core/preview";
import { CalcDocsState } from "../core/state";

const CODELENS_PREVIEW_MAX_LEN = 140;
const MISMATCH_THRESHOLD = 0.01;

function createInfoCodeLens(line: number, title: string): vscode.CodeLens {
  return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
    title,
    command: "",
  });
}

function createOpenFormulaCodeLens(
  state: CalcDocsState,
  symbol: string,
  line: number
): vscode.CodeLens | null {
  const formula = state.formulaIndex.get(symbol);
  if (!formula?._filePath) {
    return null;
  }

  const formulaLine = (formula._line ?? 0) + 1;
  return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
    title: `CalcDocs: open formula ${formula._filePath}:${formulaLine}`,
    command: "calcdocs.fixMismatch",
    arguments: [symbol],
  });
}

function hasFormulaMismatch(formulaValue: number, evaluatedValue: number): boolean {
  const baseline = formulaValue === 0 ? 1 : Math.abs(formulaValue);
  const diff = Math.abs(formulaValue - evaluatedValue) / baseline;
  return diff > MISMATCH_THRESHOLD;
}

function buildAmbiguityTitle(symbolName: string, roots: string[]): string {
  const inheritedRoots = roots.filter((root) => root !== symbolName);
  return inheritedRoots.length > 0
    ? `CalcDocs: ${symbolName} depends on conditional symbols (${inheritedRoots.join(", ")})`
    : `CalcDocs: ${symbolName} has multiple conditional definitions`;
}

function normalizeExpressionForComparison(expression: string): string {
  return normalizeExpandedPreviewText(unwrapParens(expression));
}

function buildCastOverflowCodeLensTitle(
  state: CalcDocsState,
  symbolName: string,
  error: NonNullable<ReturnType<typeof evaluateExpressionPreview>["error"]>
): string {
  const overflow = error.overflow;
  const rangeText = `[${formatPreviewNumber(state, overflow.min)}..${formatPreviewNumber(state, overflow.max)}]`;
  const truncated = formatPreviewNumber(state, overflow.truncatedValue);
  const input = formatPreviewNumber(state, overflow.inputValue);
  const fromSuffix =
    overflow.inputValue === overflow.truncatedValue ? "" : ` (from ${input})`;

  return `$(error) CalcDocs: ${symbolName} cast overflow (${overflow.castType}) ${truncated}${fromSuffix} not in ${rangeText}`;
}

/**
 * Adds inline CodeLens hints above C/C++ symbol definitions.
 */
export class CppValueCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly state: CalcDocsState) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.state.enabled) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const renderedAmbiguityLens = new Set<string>();
    const definitions = collectDocumentSymbolDefinitions(document.getText());

    for (const definition of definitions) {
      const { line, isDefineLine, parsed } = definition;
      const { name, expr } = parsed;
      const ambiguityRoots = this.state.symbolAmbiguityRoots.get(name) ?? [];

      if (ambiguityRoots.length > 0) {
        if (!renderedAmbiguityLens.has(name)) {
          renderedAmbiguityLens.add(name);
          lenses.push(createInfoCodeLens(line, buildAmbiguityTitle(name, ambiguityRoots)));
        }
        continue;
      }

      const displayName = parsed.macroParams
        ? `${name}(${parsed.macroParams.join(", ")})`
        : name;
      const isFunctionLikeMacro = parsed.macroParams != null;

      const preview = evaluateExpressionPreview(this.state, expr);
      const value = preview.value;
      if (preview.error?.kind === "cast-overflow") {
        lenses.push(
          createInfoCodeLens(
            line,
            buildCastOverflowCodeLensTitle(this.state, displayName, preview.error)
          )
        );
        continue;
      }

      if (
        !isFunctionLikeMacro &&
        !isCompositeExpression(expr, this.state.symbolValues, this.state.allDefines)
      ) {
        const formula = this.state.formulaIndex.get(name);
        const mismatch =
          Boolean(formula) &&
          typeof formula?.valueCalc === "number" &&
          typeof value === "number" &&
          hasFormulaMismatch(formula.valueCalc, value);

        if (mismatch) {
          lenses.push(
            new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
              title: formula
                ? `CalcDocs: ${name} differs from YAML value ${formula.valueCalc} (click to open)`
                : `CalcDocs: ${name} needs a check (click to open)`,
              command: "calcdocs.fixMismatch",
              arguments: [name],
            })
          );
        } else {
          const openFormulaLens = createOpenFormulaCodeLens(this.state, name, line);
          if (openFormulaLens) {
            lenses.push(openFormulaLens);
          }
        }

        continue;
      }

      if (typeof value === "number") {
        const cLikePreview = buildCStylePreview(
          displayName,
          formatPreviewNumber(this.state, value),
          isDefineLine
        );
        lenses.push(createInfoCodeLens(line, `CalcDocs: ${cLikePreview}`));
        continue;
      }

      const previewText = formatExpandedPreview(this.state, preview.expanded, {
        maxLength: CODELENS_PREVIEW_MAX_LEN,
      });
      const originalComparable = normalizeExpressionForComparison(expr);
      const expandedComparable = normalizeExpressionForComparison(preview.expanded);

      if (previewText && expandedComparable !== originalComparable) {
        const cLikePreview = buildCStylePreview(displayName, previewText, isDefineLine);
        lenses.push(createInfoCodeLens(line, `CalcDocs: ${cLikePreview}`));
      }
    }

    return lenses;
  }
}

/**
 * Registers CodeLens provider for C/C++ (and plaintext file fallback).
 */
export function registerCppCodeLensProvider(
  context: vscode.ExtensionContext,
  provider: CppValueCodeLensProvider
): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "c", scheme: "file" },
        { language: "cpp", scheme: "file" },
        { language: "c", scheme: "untitled" },
        { language: "cpp", scheme: "untitled" },
        { language: "c", scheme: "vscode-userdata" },
        { language: "cpp", scheme: "vscode-userdata" },
        { language: "plaintext", scheme: "file" },
      ],
      provider
    )
  );
}
