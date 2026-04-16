import * as vscode from "vscode";

import { collectDocumentSymbolDefinitions } from "./documentSymbols";
import { isCompositeExpression, unwrapParens } from "./expression";
import {
  buildCStylePreview,
  evaluateExpressionPreview,
  formatExpandedPreview,
  normalizeExpandedPreviewText,
  formatPreviewNumber,
} from "./preview";
import { CalcDocsState } from "./state";

const CODELENS_PREVIEW_MAX_LEN = 140;
const MISMATCH_THRESHOLD = 0.01;

export type CppCodeLensItemKind =
  | "ambiguity"
  | "castOverflow"
  | "mismatch"
  | "openFormula"
  | "resolvedValue"
  | "expandedPreview";

export type CppCodeLensItem = {
  line: number;
  title: string;
  kind: CppCodeLensItemKind;
  command?: string;
  arguments?: unknown[];
};

function createInfoItem(
  line: number,
  title: string,
  kind: CppCodeLensItemKind
): CppCodeLensItem {
  return {
    line,
    title,
    kind,
  };
}

function createOpenFormulaItem(
  state: CalcDocsState,
  symbol: string,
  line: number
): CppCodeLensItem | null {
  const formula = state.formulaIndex.get(symbol);
  if (!formula?._filePath) {
    return null;
  }

  const formulaLine = (formula._line ?? 0) + 1;
  return {
    line,
    kind: "openFormula",
    title: `CalcDocs: open formula ${formula._filePath}:${formulaLine}`,
    command: "calcdocs.fixMismatch",
    arguments: [symbol],
  };
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

function buildCastOverflowTitle(
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

export function collectCppCodeLensItems(
  document: vscode.TextDocument,
  state: CalcDocsState,
  maxItemsPerFile: number
): CppCodeLensItem[] {
  const maxItems = Math.max(1, maxItemsPerFile);
  const items: CppCodeLensItem[] = [];
  const renderedAmbiguityLens = new Set<string>();
  const definitions = collectDocumentSymbolDefinitions(document.getText());

  const pushItem = (item: CppCodeLensItem): boolean => {
    if (items.length >= maxItems) {
      return false;
    }

    items.push(item);
    return true;
  };

  for (const definition of definitions) {
    if (items.length >= maxItems) {
      break;
    }

    const { line, isDefineLine, parsed } = definition;
    const { name, expr } = parsed;
    const ambiguityRoots = state.symbolAmbiguityRoots.get(name) ?? [];

    if (ambiguityRoots.length > 0) {
      if (state.cppCodeLens.showAmbiguity && !renderedAmbiguityLens.has(name)) {
        renderedAmbiguityLens.add(name);
        if (!pushItem(createInfoItem(line, buildAmbiguityTitle(name, ambiguityRoots), "ambiguity"))) {
          break;
        }
      }

      continue;
    }

    const displayName = parsed.macroParams
      ? `${name}(${parsed.macroParams.join(", ")})`
      : name;
    const isFunctionLikeMacro = parsed.macroParams != null;

    const preview = evaluateExpressionPreview(state, expr);
    const value = preview.value;

    if (preview.error?.kind === "cast-overflow") {
      if (state.cppCodeLens.showCastOverflow) {
        if (
          !pushItem(
            createInfoItem(
              line,
              buildCastOverflowTitle(state, displayName, preview.error),
              "castOverflow"
            )
          )
        ) {
          break;
        }
      }

      continue;
    }

    if (
      !isFunctionLikeMacro &&
      !isCompositeExpression(expr, state.symbolValues, state.allDefines)
    ) {
      const formula = state.formulaIndex.get(name);
      const mismatch =
        Boolean(formula) &&
        typeof formula?.valueCalc === "number" &&
        typeof value === "number" &&
        hasFormulaMismatch(formula.valueCalc, value);

      if (mismatch) {
        if (state.cppCodeLens.showMismatch) {
          if (
            !pushItem({
              line,
              kind: "mismatch",
              title: formula
                ? `CalcDocs: ${name} differs from YAML value ${formula.valueCalc} (click to open)`
                : `CalcDocs: ${name} needs a check (click to open)`,
              command: "calcdocs.fixMismatch",
              arguments: [name],
            })
          ) {
            break;
          }
        }
      } else if (state.cppCodeLens.showOpenFormula) {
        const openFormulaItem = createOpenFormulaItem(state, name, line);
        if (openFormulaItem && !pushItem(openFormulaItem)) {
          break;
        }
      }

      continue;
    }

    if (typeof value === "number" && state.cppCodeLens.showResolvedValue) {
      const cLikePreview = buildCStylePreview(
        displayName,
        formatPreviewNumber(state, value),
        isDefineLine
      );

      if (!pushItem(createInfoItem(line, `CalcDocs: ${cLikePreview}`, "resolvedValue"))) {
        break;
      }

      continue;
    }

    if (!state.cppCodeLens.showExpandedPreview) {
      continue;
    }

    const previewText = formatExpandedPreview(state, preview.expanded, {
      maxLength: CODELENS_PREVIEW_MAX_LEN,
    });
    const originalComparable = normalizeExpressionForComparison(expr);
    const expandedComparable = normalizeExpressionForComparison(preview.expanded);

    if (previewText && expandedComparable !== originalComparable) {
      const cLikePreview = buildCStylePreview(displayName, previewText, isDefineLine);
      if (!pushItem(createInfoItem(line, `CalcDocs: ${cLikePreview}`, "expandedPreview"))) {
        break;
      }
    }
  }

  return items;
}
