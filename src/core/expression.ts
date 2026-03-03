import { OP_RX, NUM_LITERAL_RX, TOKEN_RX } from "../utils/regex";
import { stripComments } from "../utils/text";
import type { CsvTable, CsvTableMap } from "./csvTables";
import { normalizeCsvTableKey } from "./csvTables";

export type EvaluationContext = {
  csvTables?: CsvTableMap;
};

type IdentifierMeta = {
  prevChar: string;
  nextChar: string;
};

type EvalScopeValue =
  | number
  | ((...args: number[]) => number)
  | ((...args: unknown[]) => number)
  | object;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const BASE_MATH_SCOPE: Record<string, EvalScopeValue> = {
  Math,
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atan2: Math.atan2,
  atanh: Math.atanh,
  cbrt: Math.cbrt,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  expm1: Math.expm1,
  floor: Math.floor,
  hypot: Math.hypot,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc,
  fabs: Math.abs,
  pi: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  deg2rad: (value: number) => value * DEG_TO_RAD,
  rad2deg: (value: number) => value * RAD_TO_DEG,
  sind: (value: number) => Math.sin(value * DEG_TO_RAD),
  cosd: (value: number) => Math.cos(value * DEG_TO_RAD),
  tand: (value: number) => Math.tan(value * DEG_TO_RAD),
  asind: (value: number) => Math.asin(value) * RAD_TO_DEG,
  acosd: (value: number) => Math.acos(value) * RAD_TO_DEG,
  atand: (value: number) => Math.atan(value) * RAD_TO_DEG,
};

const MATH_SCOPE = addUppercaseAliases(BASE_MATH_SCOPE);
const LOOKUP_FUNCTION_NAMES = new Set<string>(["csv", "table", "lookup"]);
const RESERVED_IDENTIFIERS = new Set<string>([
  ...Object.keys(MATH_SCOPE),
  "csv",
  "table",
  "lookup",
  "true",
  "false",
  "null",
  "undefined",
  "Infinity",
  "NaN",
]);

function addUppercaseAliases(
  scope: Record<string, EvalScopeValue>
): Record<string, EvalScopeValue> {
  const withAliases: Record<string, EvalScopeValue> = {
    ...scope,
  };

  for (const [key, value] of Object.entries(scope)) {
    const upper = key.toUpperCase();
    if (!(upper in withAliases)) {
      withAliases[upper] = value;
    }
  }

  return withAliases;
}

function isIdentifierStartChar(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPartChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function isWhitespaceChar(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function findPrevNonWhitespaceChar(text: string, start: number): string {
  for (let i = start - 1; i >= 0; i -= 1) {
    const char = text[i];
    if (!isWhitespaceChar(char)) {
      return char;
    }
  }

  return "";
}

function findNextNonWhitespaceChar(text: string, start: number): string {
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (!isWhitespaceChar(char)) {
      return char;
    }
  }

  return "";
}

function looksLikeNumericSuffixToken(
  expr: string,
  start: number,
  token: string
): boolean {
  const prevRawChar = start > 0 ? expr[start - 1] : "";
  const prevIsNumberPiece = /[0-9.]/.test(prevRawChar);

  if (prevIsNumberPiece && /^e[0-9]*$/i.test(token)) {
    return true;
  }

  if (prevRawChar === "0" && /^[xXbBoO][0-9A-Fa-f]+$/.test(token)) {
    return true;
  }

  return false;
}

function replaceIdentifiersOutsideStrings(
  expr: string,
  replacer: (identifier: string, meta: IdentifierMeta) => string
): string {
  let output = "";

  for (let i = 0; i < expr.length; ) {
    const char = expr[i];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const start = i;
      i += 1;

      while (i < expr.length) {
        const current = expr[i];

        if (current === "\\") {
          i += 2;
          continue;
        }

        i += 1;

        if (current === quote) {
          break;
        }
      }

      output += expr.slice(start, i);
      continue;
    }

    if (!isIdentifierStartChar(char)) {
      output += char;
      i += 1;
      continue;
    }

    const start = i;
    i += 1;

    while (i < expr.length && isIdentifierPartChar(expr[i])) {
      i += 1;
    }

    const token = expr.slice(start, i);
    if (looksLikeNumericSuffixToken(expr, start, token)) {
      output += token;
      continue;
    }

    output += replacer(token, {
      prevChar: findPrevNonWhitespaceChar(expr, start),
      nextChar: findNextNonWhitespaceChar(expr, i),
    });
  }

  return output;
}

function parseCsvNumericValue(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const directNumber = Number(trimmed);
  if (Number.isFinite(directNumber)) {
    return directNumber;
  }

  if (trimmed.includes(",") && !trimmed.includes(".")) {
    const commaDecimal = Number(trimmed.replace(",", "."));
    if (Number.isFinite(commaDecimal)) {
      return commaDecimal;
    }
  }

  return null;
}

function resolveCsvTable(
  csvTables: CsvTableMap | undefined,
  tableName: string
): CsvTable | undefined {
  if (!csvTables) {
    return undefined;
  }

  const normalized = normalizeCsvTableKey(tableName);
  const normalizedWithoutExt = normalized.endsWith(".csv")
    ? normalized.slice(0, -4)
    : normalized;
  const lastSlashIndex = normalized.lastIndexOf("/");
  const basename =
    lastSlashIndex >= 0 ? normalized.slice(lastSlashIndex + 1) : normalized;
  const basenameWithoutExt = basename.endsWith(".csv")
    ? basename.slice(0, -4)
    : basename;

  return (
    csvTables.get(normalized) ??
    csvTables.get(normalizedWithoutExt) ??
    csvTables.get(basename) ??
    csvTables.get(basenameWithoutExt)
  );
}

function parseCsvRowIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  return null;
}

type CsvInterpolationMode = "none" | "linear" | "nearest";

function resolveCsvColumnIndex(table: CsvTable, columnRef: unknown): number | null {
  if (typeof columnRef === "number" && Number.isFinite(columnRef)) {
    return Math.trunc(columnRef);
  }

  if (typeof columnRef === "string") {
    const normalized = columnRef.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (table.headerIndex.has(normalized)) {
      return table.headerIndex.get(normalized) ?? null;
    }

    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }

  return null;
}

function parseCsvInterpolationMode(modeRef: unknown): CsvInterpolationMode {
  if (modeRef == null) {
    return "none";
  }

  if (typeof modeRef !== "string") {
    throw new Error("csv interpolation mode must be string");
  }

  const normalized = modeRef.trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "exact") {
    return "none";
  }

  if (normalized === "linear" || normalized === "lerp") {
    return "linear";
  }

  if (normalized === "nearest" || normalized === "closest") {
    return "nearest";
  }

  throw new Error(`unsupported csv interpolation mode: ${modeRef}`);
}

function tryParseCsvInterpolationMode(
  modeRef: unknown
): CsvInterpolationMode | null {
  try {
    return parseCsvInterpolationMode(modeRef);
  } catch {
    return null;
  }
}

function parseCsvLookupNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    return parseCsvNumericValue(value);
  }

  return null;
}

function resolveCsvRow(
  table: CsvTable,
  rowRef: unknown,
  lookupColumnIndex: number,
  allowNumericRowIndex: boolean
): string[] | null {
  if (allowNumericRowIndex) {
    const numericRowIndex = parseCsvRowIndex(rowRef);
    if (numericRowIndex != null) {
      if (numericRowIndex < 0) {
        return null;
      }

      const dataRows = table.rows.length > 1 ? table.rows.slice(1) : table.rows;
      return dataRows[numericRowIndex] ?? null;
    }
  }

  const lookupKey = String(rowRef ?? "").trim();
  if (!lookupKey) {
    return null;
  }

  const numericLookup = parseCsvLookupNumericValue(rowRef);

  for (let i = 1; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    const cellValue = (row[lookupColumnIndex] ?? "").trim();
    if (!cellValue) {
      continue;
    }

    if (cellValue === lookupKey) {
      return row;
    }

    if (numericLookup != null) {
      const numericCell = parseCsvNumericValue(cellValue);
      if (numericCell != null && numericCell === numericLookup) {
        return row;
      }
    }
  }

  const firstRow = table.rows[0];
  const firstCellValue = (firstRow?.[lookupColumnIndex] ?? "").trim();
  if (firstCellValue === lookupKey) {
    return firstRow;
  }

  if (numericLookup != null) {
    const numericCell = parseCsvNumericValue(firstCellValue);
    if (numericCell != null && numericCell === numericLookup) {
      return firstRow ?? null;
    }
  }

  return null;
}

type CsvInterpolationPoint = {
  x: number;
  y: number;
};

function collectCsvInterpolationPoints(
  table: CsvTable,
  lookupColumnIndex: number,
  valueColumnIndex: number
): CsvInterpolationPoint[] {
  const points: CsvInterpolationPoint[] = [];

  for (const row of table.rows) {
    const x = parseCsvNumericValue(row[lookupColumnIndex] ?? "");
    const y = parseCsvNumericValue(row[valueColumnIndex] ?? "");
    if (x == null || y == null) {
      continue;
    }

    points.push({
      x,
      y,
    });
  }

  points.sort((a, b) => a.x - b.x);
  return points;
}

function interpolateCsvValue(
  target: number,
  points: CsvInterpolationPoint[],
  mode: CsvInterpolationMode
): number | null {
  if (points.length === 0) {
    return null;
  }

  let lowerPoint: CsvInterpolationPoint | null = null;
  let upperPoint: CsvInterpolationPoint | null = null;
  let nearestPoint: CsvInterpolationPoint = points[0];
  let nearestDistance = Math.abs(points[0].x - target);

  for (const point of points) {
    if (point.x === target) {
      return point.y;
    }

    if (point.x < target && (!lowerPoint || point.x > lowerPoint.x)) {
      lowerPoint = point;
    }

    if (point.x > target && (!upperPoint || point.x < upperPoint.x)) {
      upperPoint = point;
    }

    const distance = Math.abs(point.x - target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  }

  if (mode === "nearest") {
    return nearestPoint.y;
  }

  if (!lowerPoint || !upperPoint || upperPoint.x === lowerPoint.x) {
    return null;
  }

  const ratio = (target - lowerPoint.x) / (upperPoint.x - lowerPoint.x);
  return lowerPoint.y + ratio * (upperPoint.y - lowerPoint.y);
}

function lookupCsvValue(
  args: unknown[],
  csvTables: CsvTableMap | undefined
): number {
  if (args.length < 2) {
    throw new Error("csv() requires at least table and row parameters");
  }

  const [tableRef, rowRef] = args;
  if (typeof tableRef !== "string" || !tableRef.trim()) {
    throw new Error("csv() first argument must be table name");
  }

  const table = resolveCsvTable(csvTables, tableRef);
  if (!table) {
    throw new Error(`csv table not found: ${tableRef}`);
  }

  // Supported signatures:
  // - csv(table, row, valueColumn)
  // - csv(table, row, valueColumn, interpolationMode)
  // - csv(table, row, lookupColumn, valueColumn)
  // - csv(table, row, lookupColumn, valueColumn, interpolationMode)
  let isNewSignature = false;
  let allowNumericRowIndex = true;
  const fallbackValueColumn = typeof rowRef === "string" ? 1 : 0;
  let lookupColumnRef: unknown = 0;
  let valueColumnRef: unknown = args[2] ?? fallbackValueColumn;
  let interpolationModeRef: unknown = args[3];

  if (args.length >= 5) {
    isNewSignature = true;
    allowNumericRowIndex = false;
    lookupColumnRef = args[2];
    valueColumnRef = args[3];
    interpolationModeRef = args[4];
  } else if (args.length === 4) {
    const secondArgColumnExists = resolveCsvColumnIndex(table, args[2]) != null;
    const thirdArgColumnExists = resolveCsvColumnIndex(table, args[3]) != null;
    const maybeInterpolationMode = tryParseCsvInterpolationMode(args[3]);

    if (secondArgColumnExists && thirdArgColumnExists) {
      isNewSignature = true;
      allowNumericRowIndex = false;
      lookupColumnRef = args[2];
      valueColumnRef = args[3];
      interpolationModeRef = undefined;
    } else if (secondArgColumnExists && maybeInterpolationMode != null) {
      isNewSignature = false;
      allowNumericRowIndex = true;
      lookupColumnRef = 0;
      valueColumnRef = args[2];
      interpolationModeRef = args[3];
    } else {
      isNewSignature = true;
      allowNumericRowIndex = false;
      lookupColumnRef = args[2];
      valueColumnRef = args[3];
      interpolationModeRef = undefined;
    }
  } else if (args.length === 3) {
    isNewSignature = false;
    allowNumericRowIndex = true;
    lookupColumnRef = 0;
    valueColumnRef = args[2];
    interpolationModeRef = undefined;
  } else {
    isNewSignature = false;
    allowNumericRowIndex = true;
    lookupColumnRef = 0;
    valueColumnRef = fallbackValueColumn;
    interpolationModeRef = undefined;
  }

  const interpolationMode = parseCsvInterpolationMode(interpolationModeRef);

  const lookupColumnIndex = resolveCsvColumnIndex(table, lookupColumnRef);
  if (
    lookupColumnIndex == null ||
    lookupColumnIndex < 0 ||
    lookupColumnIndex >= table.rows[0].length
  ) {
    throw new Error(`csv column not found: ${String(lookupColumnRef)}`);
  }

  const valueColumnIndex = resolveCsvColumnIndex(table, valueColumnRef);
  if (
    valueColumnIndex == null ||
    valueColumnIndex < 0 ||
    valueColumnIndex >= table.rows[0].length
  ) {
    throw new Error(`csv column not found: ${String(valueColumnRef)}`);
  }

  const row = resolveCsvRow(
    table,
    rowRef,
    lookupColumnIndex,
    allowNumericRowIndex
  );
  if (row) {
    const numericCellValue = parseCsvNumericValue(row[valueColumnIndex] ?? "");
    if (numericCellValue == null) {
      throw new Error("csv value is not numeric");
    }

    return numericCellValue;
  }

  if (interpolationMode === "none") {
    throw new Error(`csv row not found: ${String(rowRef)}`);
  }

  const targetValue = parseCsvLookupNumericValue(rowRef);
  if (targetValue == null) {
    throw new Error("csv interpolation requires a numeric lookup value");
  }

  const points = collectCsvInterpolationPoints(
    table,
    lookupColumnIndex,
    valueColumnIndex
  );
  const interpolatedValue = interpolateCsvValue(
    targetValue,
    points,
    interpolationMode
  );
  if (interpolatedValue == null) {
    throw new Error("csv interpolation not possible for requested value");
  }

  return interpolatedValue;
}

function createEvaluationScope(
  context: EvaluationContext
): Record<string, EvalScopeValue> {
  const csvLookup = (...args: unknown[]) => lookupCsvValue(args, context.csvTables);

  return {
    ...MATH_SCOPE,
    csv: csvLookup,
    table: csvLookup,
    lookup: csvLookup,
  };
}

function findFunctionCallEnd(expr: string, openParenIndex: number): number {
  let depth = 0;

  for (let i = openParenIndex; i < expr.length; i += 1) {
    const char = expr[i];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      i += 1;

      while (i < expr.length) {
        const current = expr[i];
        if (current === "\\") {
          i += 2;
          continue;
        }

        if (current === quote) {
          break;
        }

        i += 1;
      }

      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
    }
  }

  return -1;
}

/**
 * Resolves inline CSV/table lookup calls into numeric literals.
 * Example: csv("ntc.csv","25","temp_c","r","linear") -> 10000
 */
export function resolveInlineLookups(
  expr: string,
  context: EvaluationContext = {}
): string {
  if (!expr) {
    return expr;
  }

  let output = "";

  for (let i = 0; i < expr.length; ) {
    const char = expr[i];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      const start = i;
      i += 1;

      while (i < expr.length) {
        const current = expr[i];
        if (current === "\\") {
          i += 2;
          continue;
        }

        i += 1;
        if (current === quote) {
          break;
        }
      }

      output += expr.slice(start, i);
      continue;
    }

    if (!isIdentifierStartChar(char)) {
      output += char;
      i += 1;
      continue;
    }

    const tokenStart = i;
    i += 1;
    while (i < expr.length && isIdentifierPartChar(expr[i])) {
      i += 1;
    }

    const token = expr.slice(tokenStart, i);
    if (!LOOKUP_FUNCTION_NAMES.has(token.toLowerCase())) {
      output += token;
      continue;
    }

    let openParenIndex = i;
    while (openParenIndex < expr.length && isWhitespaceChar(expr[openParenIndex])) {
      openParenIndex += 1;
    }

    if (expr[openParenIndex] !== "(") {
      output += token;
      continue;
    }

    const callEnd = findFunctionCallEnd(expr, openParenIndex);
    if (callEnd < 0) {
      output += token;
      continue;
    }

    const callExpr = expr.slice(tokenStart, callEnd);
    try {
      const lookupValue = safeEval(callExpr, context);
      output += String(lookupValue);
    } catch {
      output += callExpr;
    }

    i = callEnd;
  }

  return output;
}

/**
 * Removes one or more outer parenthesis layers from an expression.
 * Example: "((A + B))" -> "A + B"
 */
function unwrapParens(expr: string): string {
  let value = expr.trim();

  while (value.startsWith("(") && value.endsWith(")")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      break;
    }

    value = inner;
  }

  return value;
}

/**
 * Removes common C literal suffixes so JavaScript evaluation can parse them.
 * Example: "10UL + 3f" -> "10 + 3"
 */
function cleanLiteralSuffixes(expr: string): string {
  return expr.replace(/(?<=\d)(ul|lu|ull|llu|u|l|ll|f)\b/gi, "");
}

/**
 * Evaluates an expression and accepts only finite numeric results.
 * Throws when expression is not reducible to a finite number.
 */
export function safeEval(expr: string, context: EvaluationContext = {}): number {
  const cleaned = cleanLiteralSuffixes(expr);
  const scope = createEvaluationScope(context);
  const scopeKeys = Object.keys(scope);
  const scopeValues = scopeKeys.map((key) => scope[key]);

  const fn = new Function(...scopeKeys, `"use strict"; return (${cleaned});`);
  const value = fn(...scopeValues);

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("non-numeric");
  }

  return value;
}

/**
 * Replaces identifier tokens with known numeric values.
 * Example: replaceTokens("A+B", {A:2}) -> "2+B"
 */
export function replaceTokens(
  expr: string,
  values: Map<string, number>
): string {
  if (!expr) {
    return expr;
  }

  return replaceIdentifiersOutsideStrings(expr, (token, meta) => {
    if (meta.prevChar === ".") {
      return token;
    }

    if (!values.has(token)) {
      return token;
    }

    return String(values.get(token));
  });
}

/**
 * Recursively resolves one symbol from #define expressions.
 * Example:
 * - defines: A=10, B=A*2
 * - resolveSymbol("B") -> 20
 */
export function resolveSymbol(
  name: string,
  defines: Map<string, string>,
  resolved: Map<string, number>,
  symbolValues: Map<string, number>,
  context: EvaluationContext = {}
): number | null {
  if (resolved.has(name)) {
    return resolved.get(name) ?? null;
  }

  if (symbolValues.has(name)) {
    const value = symbolValues.get(name) ?? null;

    if (value != null) {
      resolved.set(name, value);
    }

    return value;
  }

  if (!defines.has(name)) {
    return null;
  }

  const expr = defines.get(name) ?? "";
  const tokens = expr.match(TOKEN_RX) ?? [];
  let expanded = expr;

  for (const token of tokens) {
    if (token === name) {
      continue;
    }

    const resolvedToken = resolveSymbol(token, defines, resolved, symbolValues, context);
    if (resolvedToken == null) {
      continue;
    }

    expanded = expanded.replace(new RegExp(`\\b${token}\\b`, "g"), String(resolvedToken));
  }

  try {
    const value = safeEval(expanded, context);
    resolved.set(name, value);
    symbolValues.set(name, value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Expands every resolvable token in an expression into numeric values.
 * Example: "P + Q" with P=3, Q=4 -> "3 + 4"
 */
export function expandExpression(
  expr: string,
  defines: Map<string, string>,
  resolved: Map<string, number>,
  symbolValues: Map<string, number>,
  context: EvaluationContext = {}
): string {
  return replaceIdentifiersOutsideStrings(expr, (token, meta) => {
    if (meta.prevChar === ".") {
      return token;
    }

    const value = resolveSymbol(token, defines, resolved, symbolValues, context);
    if (value == null) {
      return token;
    }

    return String(value);
  });
}

/**
 * Returns true when expression is already a pure numeric literal.
 * Example: " 42UL " -> true
 */
export function isPureNumericExpression(expr: string): boolean {
  const sanitized = unwrapParens(stripComments(expr));
  return NUM_LITERAL_RX.test(sanitized);
}

/**
 * Detects whether expression is composite and worth evaluating for preview.
 * Composite means it contains operators and/or resolvable tokens.
 */
export function isCompositeExpression(
  expr: string,
  symbolValues: Map<string, number>,
  allDefines: Map<string, string>
): boolean {
  const sanitized = stripComments(expr).trim();
  if (!sanitized) {
    return false;
  }

  if (isPureNumericExpression(sanitized)) {
    return false;
  }

  if (OP_RX.test(sanitized)) {
    return true;
  }

  const tokens = sanitized.match(TOKEN_RX) ?? [];
  return tokens.some((token) => symbolValues.has(token) || allDefines.has(token));
}

/**
 * Computes numeric value for composite expressions after token resolution.
 * Returns null when unresolved identifiers remain.
 */
export function evaluateCompositeExpression(
  expr: string,
  symbolValues: Map<string, number>,
  allDefines: Map<string, string>,
  context: EvaluationContext = {}
): number | null {
  try {
    let expanded = stripComments(expr);
    const resolvedMap = new Map<string, number>();

    expanded = replaceIdentifiersOutsideStrings(expanded, (token, meta) => {
      if (meta.prevChar === ".") {
        return token;
      }

      if (symbolValues.has(token)) {
        return String(symbolValues.get(token));
      }

      const value = resolveSymbol(token, allDefines, resolvedMap, symbolValues, context);
      if (value != null) {
        return String(value);
      }

      if (RESERVED_IDENTIFIERS.has(token) || meta.nextChar === "(") {
        return token;
      }

      return token;
    });

    return safeEval(expanded, context);
  } catch {
    return null;
  }
}
