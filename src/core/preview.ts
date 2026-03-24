import { buildCompositeExpressionPreview } from "./expression";
import { CalcDocsState } from "./state";
import {
  formatNumbersWithThousandsSeparator,
  toHexString,
} from "../utils/nformat";

export type ExpressionPreview = {
  expanded: string;
  value: number | null;
};

type FormatExpandedPreviewOptions = {
  maxLength?: number;
};

const WRAPPED_CAST_RX =
  /^\(\s*(?:u?int(?:8|16|32)|u?int(?:8|16|32)_t|float|double)\s*\)\s*\((.+)\)$/i;

/**
 * Shared expression preview engine used by CodeLens and Hover.
 */
export function evaluateExpressionPreview(
  state: CalcDocsState,
  expression: string
): ExpressionPreview {
  return buildCompositeExpressionPreview(
    expression,
    state.symbolValues,
    state.allDefines,
    state.functionDefines,
    {},
    state.defineConditions
  );
}

/**
 * Normalizes an expanded expression for display:
 * - compacts whitespace
 * - removes one outer cast wrapper on whole expression
 */
export function normalizeExpandedPreviewText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.replace(WRAPPED_CAST_RX, "$1");
}

/**
 * Formats expanded preview text with optional truncation and thousand separators.
 */
export function formatExpandedPreview(
  state: CalcDocsState,
  expanded: string,
  options: FormatExpandedPreviewOptions = {}
): string {
  let normalized = normalizeExpandedPreviewText(expanded);

  if (
    typeof options.maxLength === "number" &&
    options.maxLength > 0 &&
    normalized.length > options.maxLength
  ) {
    normalized = `${normalized.slice(0, options.maxLength)}...`;
  }

  return formatNumbersWithThousandsSeparator(state, normalized);
}

/**
 * Formats numeric value for inline previews.
 */
export function formatPreviewNumber(state: CalcDocsState, value: number): string {
  return formatNumbersWithThousandsSeparator(state, String(value));
}

/**
 * Formats numeric value and appends hex form when available.
 */
export function formatPreviewNumberWithHex(
  state: CalcDocsState,
  value: number
): string {
  const decimal = formatPreviewNumber(state, value);
  const hex = toHexString(value);
  return hex ? `${decimal} (${hex})` : decimal;
}

/**
 * Renders a C-like preview row from symbol name and right-hand side.
 */
export function buildCStylePreview(
  displayName: string,
  rightHandSide: string,
  isDefineDirective: boolean
): string {
  return isDefineDirective
    ? `#define ${displayName} ${rightHandSide}`
    : `${displayName} = ${rightHandSide}`;
}
