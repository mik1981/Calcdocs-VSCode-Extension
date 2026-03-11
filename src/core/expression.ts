import { OP_RX, NUM_LITERAL_RX, TOKEN_RX } from "../utils/regex";
import { stripComments } from "../utils/text";
import type { CsvTable, CsvTableMap } from "./csvTables";
import { normalizeCsvTableKey } from "./csvTables";

export type EvaluationContext = {
  csvTables?: CsvTableMap;
};

export type FunctionMacroDefinition = {
  params: string[];
  body: string;
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
const MAX_MACRO_EXPANSION_DEPTH = 12;
// Hard stop for recursive symbol resolution to avoid JS stack overflow.
const MAX_SYMBOL_RESOLUTION_DEPTH = 96;
const MAX_CYCLE_SAMPLES = 10;
const SIMPLIFY_MAX_PASSES = 4;
const NUMERIC_MUL_DIV_CHAIN_RX =
  /(?<![A-Za-z0-9_.$])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?(?:\s*[*/]\s*[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)+(?![A-Za-z0-9_])/g;

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return numeric;
}

function toUintN(value: unknown, bits: number): number {
  const modulo = 2 ** bits;
  const truncated = Math.trunc(toFiniteNumber(value));
  return ((truncated % modulo) + modulo) % modulo;
}

function toIntN(value: unknown, bits: number): number {
  const unsigned = toUintN(value, bits);
  const signBit = 2 ** (bits - 1);
  const modulo = 2 ** bits;
  return unsigned >= signBit ? unsigned - modulo : unsigned;
}

const C_CAST_SCOPE: Record<string, EvalScopeValue> = {
  UINT8: (value: unknown) => toUintN(value, 8),
  UINT16: (value: unknown) => toUintN(value, 16),
  UINT32: (value: unknown) => toUintN(value, 32),
  INT8: (value: unknown) => toIntN(value, 8),
  INT16: (value: unknown) => toIntN(value, 16),
  INT32: (value: unknown) => toIntN(value, 32),
  uint8_t: (value: unknown) => toUintN(value, 8),
  uint16_t: (value: unknown) => toUintN(value, 16),
  uint32_t: (value: unknown) => toUintN(value, 32),
  int8_t: (value: unknown) => toIntN(value, 8),
  int16_t: (value: unknown) => toIntN(value, 16),
  int32_t: (value: unknown) => toIntN(value, 32),
  int: (value: unknown) => toIntN(value, 32),
  short: (value: unknown) => toIntN(value, 16),
  long: (value: unknown) => toIntN(value, 32),
  unsigned: (value: unknown) => toUintN(value, 32),
  float: (value: unknown) => toFiniteNumber(value),
  double: (value: unknown) => toFiniteNumber(value),
  bool: (value: unknown) => (toFiniteNumber(value) === 0 ? 0 : 1),
};

const BASE_MATH_SCOPE: Record<string, EvalScopeValue> = {
  ...C_CAST_SCOPE,
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

export type SymbolResolutionStats = {
  // Current recursive depth while traversing dependencies.
  currentDepth: number;
  // Highest depth reached in the whole analysis pass.
  maxDepth: number;
  // Configured hard limit used by guards.
  depthLimit: number;
  // Circular references detected during resolution.
  cycleCount: number;
  // Number of branches stopped by depth guard.
  depthLimitHits: number;
  // Unique samples of circular dependency chains, e.g. A -> B -> A.
  cycleSamples: string[];
};

export type SymbolResolutionSnapshot = {
  usedDepth: number;
  depthLimit: number;
  cycleCount: number;
  prunedCount: number;
  degraded: boolean;
};

export function createSymbolResolutionStats(
  depthLimit = MAX_SYMBOL_RESOLUTION_DEPTH
): SymbolResolutionStats {
  return {
    currentDepth: 0,
    maxDepth: 0,
    depthLimit,
    cycleCount: 0,
    depthLimitHits: 0,
    cycleSamples: [],
  };
}

export function snapshotSymbolResolutionStats(
  stats: SymbolResolutionStats
): SymbolResolutionSnapshot {
  return {
    usedDepth: stats.maxDepth,
    depthLimit: stats.depthLimit,
    cycleCount: stats.cycleCount,
    prunedCount: stats.depthLimitHits,
    degraded: stats.cycleCount > 0 || stats.depthLimitHits > 0,
  };
}

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

function splitCallArguments(argText: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < argText.length; i += 1) {
    const char = argText[i];

    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      current += char;
      i += 1;

      while (i < argText.length) {
        const inner = argText[i];
        current += inner;
        if (inner === "\\") {
          i += 1;
          if (i < argText.length) {
            current += argText[i];
          }
          i += 1;
          continue;
        }

        if (inner === quote) {
          break;
        }

        i += 1;
      }

      continue;
    }

    if (char === "(") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      if (depth > 0) {
        depth -= 1;
      }

      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = current.trim();
  if (trailing.length > 0 || argText.trim().length > 0) {
    args.push(trailing);
  }

  return args;
}

function replaceMacroParameter(body: string, parameter: string, value: string): string {
  return body.replace(new RegExp(`\\b${parameter}\\b`, "g"), value);
}

function formatPreviewNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function isReducibleNumericFragment(fragment: string): boolean {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return false;
  }

  if (/[A-Za-z_]/.test(trimmed)) {
    return false;
  }

  return /^[0-9+\-*/%()\s.eE]+$/.test(trimmed);
}

function simplifyNumericFragments(expr: string, context: EvaluationContext): string {
  let output = expr;

  for (let pass = 0; pass < SIMPLIFY_MAX_PASSES; pass += 1) {
    let changed = false;

    output = output.replace(
      /\(([^()]+)\)/g,
      (group, inner: string, offset: number, source: string) => {
        if (!isReducibleNumericFragment(inner)) {
          return group;
        }

        try {
          const value = safeEval(inner, context);
          changed = true;
          const formatted = formatPreviewNumber(value);
          const prefix = source.slice(0, offset);
          const castPrefixMatch = prefix.match(
            /\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)\s*$/
          );

          return castPrefixMatch ? `(${formatted})` : formatted;
        } catch {
          return group;
        }
      }
    );

    output = output.replace(NUMERIC_MUL_DIV_CHAIN_RX, (segment) => {
      if (!isReducibleNumericFragment(segment)) {
        return segment;
      }

      try {
        const value = safeEval(segment, context);
        changed = true;
        return formatPreviewNumber(value);
      } catch {
        return segment;
      }
    });

    if (!changed) {
      break;
    }
  }

  return output;
}

function expandFunctionLikeMacrosInExpression(
  expr: string,
  functionDefines: Map<string, FunctionMacroDefinition>,
  symbolValues: Map<string, number>,
  defines: Map<string, string>,
  resolved: Map<string, number>,
  context: EvaluationContext,
  depth = 0,
  stackStats: SymbolResolutionStats = createSymbolResolutionStats(),
  resolving: Set<string> = new Set<string>(),
  defineConditions: Map<string, string> = new Map<string, string>(),
  activeCondition: string | null = null
): string {
  if (!expr || functionDefines.size === 0 || depth >= MAX_MACRO_EXPANSION_DEPTH) {
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
    const macro = functionDefines.get(token);
    if (!macro) {
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

    const rawArgs = expr.slice(openParenIndex + 1, callEnd - 1);
    const parsedArgs = splitCallArguments(rawArgs);
    if (parsedArgs.length !== macro.params.length) {
      output += expr.slice(tokenStart, callEnd);
      i = callEnd;
      continue;
    }

    const expandedArgs = parsedArgs.map((argument) => {
      const expandedArgument = expandFunctionLikeMacrosInExpression(
        argument,
        functionDefines,
        symbolValues,
        defines,
        resolved,
        context,
        depth + 1,
        stackStats,
        resolving,
        defineConditions,
        activeCondition
      );

      return replaceIdentifiersOutsideStrings(expandedArgument, (identifier, meta) => {
        if (meta.prevChar === ".") {
          return identifier;
        }

        if (symbolValues.has(identifier)) {
          return String(symbolValues.get(identifier));
        }

        if (RESERVED_IDENTIFIERS.has(identifier) || meta.nextChar === "(") {
          return identifier;
        }

        const value = resolveSymbol(
          identifier,
          defines,
          functionDefines,
          resolved,
          symbolValues,
          context,
          stackStats,
          resolving,
          defineConditions,
          activeCondition
        );
        if (value == null) {
          return identifier;
        }

        return String(value);
      });
    });

    let expandedBody = macro.body;
    for (let argIndex = 0; argIndex < macro.params.length; argIndex += 1) {
      expandedBody = replaceMacroParameter(
        expandedBody,
        macro.params[argIndex],
        `(${expandedArgs[argIndex]})`
      );
    }

    expandedBody = expandFunctionLikeMacrosInExpression(
      expandedBody,
      functionDefines,
      symbolValues,
      defines,
      resolved,
      context,
      depth + 1,
      stackStats,
      resolving,
      defineConditions,
      activeCondition
    );

    output += `(${expandedBody})`;
    i = callEnd;
  }

  return output;
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
 * Removes outer parenthesis layers only when they are truly redundant.
 * A parenthesis layer is redundant when:
 * - The inner expression is a pure numeric literal (already resolved), OR
 * - The inner expression can be successfully evaluated numerically
 * 
 * Parentheses are kept when they are meaningful, such as:
 * - C-style type casts: "(unsigned int)(value)"
 * - Expressions with unresolved symbols that can't be evaluated
 * 
 * Examples:
 * - "((42))" -> "42" (pure numeric - redundant)
 * - "(unsigned int)(0.5 + ...)" -> "(unsigned int)(0.5 + ...)" (kept - C cast)
 * - "(3.14)" -> "3.14" (evaluable - redundant)
 */
export function unwrapParens(expr: string): string {
  let value = expr.trim();

  // Remove trailing semicolon if present
  if (value.endsWith(";")) {
    const inner = value.slice(0, -1).trim();
    if (inner) {
      value = inner;
    }
  }

  // Only remove outer parentheses if they're truly redundant
  // (i.e., the inner content is already a numeric literal or evaluates to a number)
  while (value.startsWith("(") && value.endsWith(")")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) {
      break;
    }

    // If the inner expression is a pure numeric literal, parentheses are redundant
    if (isPureNumericExpression(inner)) {
      value = inner;
      continue;
    }

    // Try to evaluate the inner expression - if it succeeds, parentheses are redundant
    try {
      const evaluated = safeEval(inner, {});
      // Evaluation succeeded - parentheses are redundant, use the inner expression
      value = inner;
      continue;
    } catch {
      // Evaluation failed - contains unresolved symbols or invalid syntax
      // Keep the parentheses (they might be a C-style cast or meaningful grouping)
      break;
    }
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

function normalizeConditionExpression(condition: string | null | undefined): string {
  const trimmed = (condition ?? "").trim();
  if (!trimmed || trimmed === "1" || trimmed.toLowerCase() === "always") {
    return "always";
  }

  return trimmed;
}

function compactConditionExpression(condition: string): string {
  return condition.replace(/\s+/g, "");
}

function stripOuterConditionParens(condition: string): string {
  let output = condition.trim();

  while (output.startsWith("(") && output.endsWith(")")) {
    let depth = 0;
    let wrapsWholeExpression = true;

    for (let i = 0; i < output.length; i += 1) {
      const char = output[i];
      if (char === "(") {
        depth += 1;
        continue;
      }

      if (char === ")") {
        depth -= 1;
        if (depth < 0) {
          wrapsWholeExpression = false;
          break;
        }

        if (depth === 0 && i < output.length - 1) {
          wrapsWholeExpression = false;
          break;
        }
      }
    }

    if (!wrapsWholeExpression || depth !== 0) {
      break;
    }

    output = output.slice(1, -1).trim();
  }

  return output;
}

function splitTopLevelAndConditions(condition: string): string[] {
  const trimmed = condition.trim();
  if (!trimmed) {
    return [];
  }

  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && trimmed[i] === "&" && trimmed[i + 1] === "&") {
      const chunk = trimmed.slice(start, i).trim();
      if (chunk.length > 0) {
        parts.push(chunk);
      }

      i += 1;
      start = i + 1;
    }
  }

  const trailing = trimmed.slice(start).trim();
  if (trailing.length > 0) {
    parts.push(trailing);
  }

  return parts.length > 0 ? parts : [trimmed];
}

function negateConditionExpression(condition: string): string {
  const normalized = normalizeConditionExpression(condition);
  if (normalized === "always") {
    return "0";
  }

  if (normalized === "0") {
    return "always";
  }

  const trimmed = normalized.trim();
  if (trimmed.startsWith("!(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(2, -1).trim();
    return inner || "always";
  }

  return `!(${normalized})`;
}

function mergeConditionExpressions(
  parentCondition: string | null,
  currentCondition: string
): string {
  const normalizedParent = normalizeConditionExpression(parentCondition);
  const normalizedCurrent = normalizeConditionExpression(currentCondition);

  if (normalizedParent === "always") {
    return normalizedCurrent;
  }

  if (normalizedCurrent === "always") {
    return normalizedParent;
  }

  if (normalizedParent === normalizedCurrent) {
    return normalizedParent;
  }

  return `(${normalizedParent}) && (${normalizedCurrent})`;
}

function conditionsCanOverlap(
  leftCondition: string | null,
  rightCondition: string | null
): boolean {
  const normalizedLeft = normalizeConditionExpression(leftCondition);
  const normalizedRight = normalizeConditionExpression(rightCondition);

  if (normalizedLeft === "always" || normalizedRight === "always") {
    return true;
  }

  const compactLeft = compactConditionExpression(normalizedLeft);
  const compactRight = compactConditionExpression(normalizedRight);
  if (!compactLeft || !compactRight) {
    return true;
  }

  if (compactLeft === compactRight) {
    return true;
  }

  const compactLeftNegated = compactConditionExpression(
    negateConditionExpression(normalizedLeft)
  );
  const compactRightNegated = compactConditionExpression(
    negateConditionExpression(normalizedRight)
  );

  if (compactLeft === compactRightNegated || compactRight === compactLeftNegated) {
    return false;
  }

  if (
    compactLeft.includes(`!(${compactRight})`) ||
    compactRight.includes(`!(${compactLeft})`)
  ) {
    return false;
  }

  const leftTerms = splitTopLevelAndConditions(normalizedLeft).map((term) =>
    stripOuterConditionParens(term)
  );
  const rightTerms = splitTopLevelAndConditions(normalizedRight).map((term) =>
    stripOuterConditionParens(term)
  );

  for (const leftTerm of leftTerms) {
    const compactLeftTerm = compactConditionExpression(leftTerm);
    if (!compactLeftTerm) {
      continue;
    }

    const compactLeftTermNegated = compactConditionExpression(
      stripOuterConditionParens(negateConditionExpression(compactLeftTerm))
    );

    for (const rightTerm of rightTerms) {
      const compactRightTerm = compactConditionExpression(rightTerm);
      if (!compactRightTerm) {
        continue;
      }

      const compactRightTermNegated = compactConditionExpression(
        stripOuterConditionParens(negateConditionExpression(compactRightTerm))
      );

      if (
        compactLeftTerm === compactRightTermNegated ||
        compactRightTerm === compactLeftTermNegated ||
        compactLeftTerm.includes(`!(${compactRightTerm})`) ||
        compactRightTerm.includes(`!(${compactLeftTerm})`)
      ) {
        return false;
      }
    }
  }

  return true;
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
  functionDefines: Map<string, FunctionMacroDefinition>,
  resolved: Map<string, number>,
  symbolValues: Map<string, number>,
  context: EvaluationContext = {},
  stackStats: SymbolResolutionStats = createSymbolResolutionStats(),
  resolving: Set<string> = new Set<string>(),
  defineConditions: Map<string, string> = new Map<string, string>(),
  activeCondition: string | null = null
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

  const normalizedActiveCondition = normalizeConditionExpression(activeCondition);
  const symbolCondition = normalizeConditionExpression(defineConditions.get(name));

  // Without a concrete preprocessor context, conditional-only symbols are unsafe to
  // resolve numerically because they can pull in mutually-exclusive branches.
  if (symbolCondition !== "always" && normalizedActiveCondition === "always") {
    return null;
  }

  if (!conditionsCanOverlap(normalizedActiveCondition, symbolCondition)) {
    return null;
  }

  const nextCondition = mergeConditionExpressions(
    normalizedActiveCondition,
    symbolCondition
  );

  if (resolving.has(name)) {
    stackStats.cycleCount += 1;

    const resolvingChain = Array.from(resolving);
    const cycleStartIndex = resolvingChain.indexOf(name);
    const cycleNodes =
      cycleStartIndex >= 0
        ? resolvingChain.slice(cycleStartIndex)
        : resolvingChain;
    const cycleSample = [...cycleNodes, name].join(" -> ");

    if (
      cycleSample &&
      stackStats.cycleSamples.length <= MAX_CYCLE_SAMPLES &&
      !stackStats.cycleSamples.includes(cycleSample)
    ) {
      if (stackStats.cycleSamples.length < MAX_CYCLE_SAMPLES) {
        stackStats.cycleSamples.push(cycleSample);
      }
      else {
        stackStats.cycleSamples.push("[...]");
      }
    }

    return null;
  }

  if (stackStats.currentDepth >= stackStats.depthLimit) {
    stackStats.depthLimitHits += 1;
    return null;
  }

  resolving.add(name);
  stackStats.currentDepth += 1;
  stackStats.maxDepth = Math.max(stackStats.maxDepth, stackStats.currentDepth);

  const expr = defines.get(name) ?? "";
  try {
    let expanded = expandFunctionLikeMacrosInExpression(
      expr,
      functionDefines,
      symbolValues,
      defines,
      resolved,
      context,
      0,
      stackStats,
      resolving,
      defineConditions,
      nextCondition
    );
    const tokens = expanded.match(TOKEN_RX) ?? [];

    for (const token of tokens) {
      if (token === name) {
        continue;
      }

      const tokenCondition = normalizeConditionExpression(
        defineConditions.get(token)
      );
      if (!conditionsCanOverlap(nextCondition, tokenCondition)) {
        continue;
      }

      const resolvedToken = resolveSymbol(
        token,
        defines,
        functionDefines,
        resolved,
        symbolValues,
        context,
        stackStats,
        resolving,
        defineConditions,
        nextCondition
      );
      if (resolvedToken == null) {
        continue;
      }

      expanded = expanded.replace(
        new RegExp(`\\b${token}\\b`, "g"),
        String(resolvedToken)
      );
    }

    const value = safeEval(expanded, context);
    resolved.set(name, value);
    symbolValues.set(name, value);
    return value;
  } catch {
    return null;
  } finally {
    stackStats.currentDepth = Math.max(0, stackStats.currentDepth - 1);
    resolving.delete(name);
  }
}

/**
 * Expands every resolvable token in an expression into numeric values.
 * Example: "P + Q" with P=3, Q=4 -> "3 + 4"
 */
export function expandExpression(
  expr: string,
  defines: Map<string, string>,
  functionDefines: Map<string, FunctionMacroDefinition>,
  resolved: Map<string, number>,
  symbolValues: Map<string, number>,
  context: EvaluationContext = {},
  stackStats: SymbolResolutionStats = createSymbolResolutionStats(),
  defineConditions: Map<string, string> = new Map<string, string>()
): string {
  const functionExpanded = expandFunctionLikeMacrosInExpression(
    expr,
    functionDefines,
    symbolValues,
    defines,
    resolved,
    context,
    0,
    stackStats,
    new Set<string>(),
    defineConditions
  );

  return replaceIdentifiersOutsideStrings(functionExpanded, (token, meta) => {
    if (meta.prevChar === ".") {
      return token;
    }

    const value = resolveSymbol(
      token,
      defines,
      functionDefines,
      resolved,
      symbolValues,
      context,
      stackStats,
      new Set<string>(),
      defineConditions
    );
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
 * Resolves function-like macros and known symbols, then tries to simplify numeric fragments.
 */
export function buildCompositeExpressionPreview(
  expr: string,
  symbolValues: Map<string, number>,
  allDefines: Map<string, string>,
  functionDefines: Map<string, FunctionMacroDefinition> = new Map(),
  context: EvaluationContext = {},
  defineConditions: Map<string, string> = new Map<string, string>()
): { expanded: string; value: number | null } {
  let expanded = stripComments(expr);
  const resolvedMap = new Map<string, number>();
  const stackStats = createSymbolResolutionStats();

  expanded = expandFunctionLikeMacrosInExpression(
    expanded,
    functionDefines,
    symbolValues,
    allDefines,
    resolvedMap,
    context,
    0,
    stackStats,
    new Set<string>(),
    defineConditions
  );

  expanded = replaceIdentifiersOutsideStrings(expanded, (token, meta) => {
    if (meta.prevChar === ".") {
      return token;
    }

    if (symbolValues.has(token)) {
      return String(symbolValues.get(token));
    }

    const value = resolveSymbol(
      token,
      allDefines,
      functionDefines,
      resolvedMap,
      symbolValues,
      context,
      stackStats,
      new Set<string>(),
      defineConditions
    );
    if (value != null) {
      return String(value);
    }

    if (RESERVED_IDENTIFIERS.has(token) || meta.nextChar === "(") {
      return token;
    }

    return token;
  });

  expanded = resolveInlineLookups(expanded, context);
  const evaluableExpanded = expanded;
  const simplifiedExpanded = simplifyNumericFragments(evaluableExpanded, context);

  try {
    const value = safeEval(evaluableExpanded, context);
    return {
      expanded: unwrapParens(simplifiedExpanded),
      value,
    };
  } catch {
    try {
      const value = safeEval(simplifiedExpanded, context);
      return {
        expanded: unwrapParens(simplifiedExpanded),
        value,
      };
    } catch {
      return {
        expanded: unwrapParens(simplifiedExpanded),
        value: null,
      };
    }
  }
}

/**
 * Computes numeric value for composite expressions after token resolution.
 * Returns null when unresolved identifiers remain.
 */
export function evaluateCompositeExpression(
  expr: string,
  symbolValues: Map<string, number>,
  allDefines: Map<string, string>,
  functionDefines: Map<string, FunctionMacroDefinition> = new Map(),
  context: EvaluationContext = {},
  defineConditions: Map<string, string> = new Map<string, string>()
): number | null {
  return buildCompositeExpressionPreview(
    expr,
    symbolValues,
    allDefines,
    functionDefines,
    context,
    defineConditions
  ).value;
}
