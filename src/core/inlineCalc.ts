import { evaluateExpressionPreview, formatPreviewNumber } from "./preview";
import type { CalcDocsState } from "./state";
import {
  getUnitSpec as getEngineUnitSpec,
  normalizeUnitToken as normalizeEngineUnitToken,
} from "../engine/units";

export type InlineCalcSeverity = "error" | "warning" | "info";

export type IgnoreDirectives = {
  all: boolean;
  error: boolean;
  warning: boolean;
  info: boolean;
};

type InlineCommand =
  | {
      kind: "assign";
      line: number;
      source: string;
      variable: string;
      expression: string;
      outputUnit?: string;
      ignore: IgnoreDirectives;
    }
  | {
      kind: "calc";
      line: number;
      source: string;
      expression: string;
      outputUnit?: string;
      ignore: IgnoreDirectives;
    };

type EvalResult = {
  value: number | null;
  resolvedExpression: string;
  error?: string;
};

export type DimensionVector = {
  M: number;
  L: number;
  T: number;
  I: number;
};

type UnitSpec = {
  factor: number;
  canonical: string;
  dimension: DimensionVector;
};

type DimensionEvalResult = {
  dimension: DimensionVector | null;
  warnings: string[];
};

type DimensionToken = {
  value: string;
};

export type InlineCalcResult = {
  kind: "assign" | "calc";
  line: number;
  source: string;
  expression: string;
  resolvedExpression: string;
  outputUnit?: string;
  value: number | null;
  variable?: string;
  displayValue: string;
  severity: InlineCalcSeverity;
  warnings: string[];
  error?: string;
  dimensionText: string;
  suppressed: boolean;
  ignore: IgnoreDirectives;
};

export type InlineCalcEvaluationOptions = {
  includeSuppressed?: boolean;
  includeAssignments?: boolean;
};

const DIMENSIONLESS: DimensionVector = { M: 0, L: 0, T: 0, I: 0 };
const EPSILON = 1e-9;

const INLINE_ASSIGN_RX = /^@([A-Za-z_]\w*)\s*=\s*(.+)$/;
const INLINE_CALC_RX = /^=\s*(.+)$/;
const OUTPUT_UNIT_ARROW_RX = /^(.*?)(?:->|=>)\s*([A-Za-z0-9_%./*^+-]+)\s*$/;
const OUTPUT_UNIT_BRACKET_RX = /^(.*)\[\s*([A-Za-z0-9_%./*^+-]+)\s*]\s*$/;
const VAR_REFERENCE_RX = /@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g;
const IDENTIFIER_TOKEN_RX = /[A-Za-z_][A-Za-z0-9_]*/g;
const IGNORE_DIRECTIVE_RX =
  /(?:^|\s)#?\s*calcdocs-ignore(?:-(error|warning|info))?\b/gi;
const IGNORE_LINE_DIRECTIVE_RX = /\bcalcdocs-ignore-line\b/i;
const QUANTITY_LITERAL_RX =
  /(?<![A-Za-z0-9_.$])([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z%\u00B5\u03BC\u03A9][A-Za-z0-9_%\u00B5\u03BC\u03A9/^.-]*)/g;
const DECORATIVE_EQUALS_RX = /^=+\s*[^0-9@+\-*/%^()]*\s*=+$/;
const DECORATIVE_ONLY_RX = /^[=:_*#\-\s]+$/;
const MATH_OPERATOR_RX = /[+\-*/%^()]/;
const FUNCTION_CALL_RX = /[A-Za-z_][A-Za-z0-9_]*\s*\(/;
const NUMBER_RX = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENTIFIER_RX = /^[A-Za-z_][A-Za-z0-9_]*/;

export const UNIT_SPECS = new Map<string, UnitSpec>([
  ["s", { factor: 1, canonical: "s", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["ms", { factor: 1e-3, canonical: "ms", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["us", { factor: 1e-6, canonical: "us", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["ns", { factor: 1e-9, canonical: "ns", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["min", { factor: 60, canonical: "min", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["h", { factor: 3600, canonical: "h", dimension: { M: 0, L: 0, T: 1, I: 0 } }],
  ["in", { factor: 0.0254, canonical: "in", dimension: { M: 0, L: 1, T: 0, I: 0 } }],
  ["ft", { factor: 0.3048, canonical: "ft", dimension: { M: 0, L: 1, T: 0, I: 0 } }],
  ["yd", { factor: 0.9144, canonical: "yd", dimension: { M: 0, L: 1, T: 0, I: 0 } }],
  ["mi", { factor: 1609.344, canonical: "mi", dimension: { M: 0, L: 1, T: 0, I: 0 } }],
  ["mph", { factor: 1609.344 / 3600, canonical: "mph", dimension: { M: 0, L: 1, T: -1, I: 0 } }],
  ["fps", { factor: 0.3048, canonical: "fps", dimension: { M: 0, L: 1, T: -1, I: 0 } }],
  ["ips", { factor: 0.0254, canonical: "ips", dimension: { M: 0, L: 1, T: -1, I: 0 } }],
  ["hz", { factor: 1, canonical: "Hz", dimension: { M: 0, L: 0, T: -1, I: 0 } }],
  ["khz", { factor: 1e3, canonical: "kHz", dimension: { M: 0, L: 0, T: -1, I: 0 } }],
  ["mhz", { factor: 1e6, canonical: "MHz", dimension: { M: 0, L: 0, T: -1, I: 0 } }],
  ["ghz", { factor: 1e9, canonical: "GHz", dimension: { M: 0, L: 0, T: -1, I: 0 } }],
  ["v", { factor: 1, canonical: "V", dimension: { M: 1, L: 2, T: -3, I: -1 } }],
  ["mv", { factor: 1e-3, canonical: "mV", dimension: { M: 1, L: 2, T: -3, I: -1 } }],
  ["kv", { factor: 1e3, canonical: "kV", dimension: { M: 1, L: 2, T: -3, I: -1 } }],
  ["a", { factor: 1, canonical: "A", dimension: { M: 0, L: 0, T: 0, I: 1 } }],
  ["ma", { factor: 1e-3, canonical: "mA", dimension: { M: 0, L: 0, T: 0, I: 1 } }],
  ["ua", { factor: 1e-6, canonical: "uA", dimension: { M: 0, L: 0, T: 0, I: 1 } }],
  ["ohm", { factor: 1, canonical: "Ohm", dimension: { M: 1, L: 2, T: -3, I: -2 } }],
  ["kohm", { factor: 1e3, canonical: "kOhm", dimension: { M: 1, L: 2, T: -3, I: -2 } }],
  ["mohm", { factor: 1e6, canonical: "MOhm", dimension: { M: 1, L: 2, T: -3, I: -2 } }],
  ["w", { factor: 1, canonical: "W", dimension: { M: 1, L: 2, T: -3, I: 0 } }],
  ["mw", { factor: 1e-3, canonical: "mW", dimension: { M: 1, L: 2, T: -3, I: 0 } }],
  ["kw", { factor: 1e3, canonical: "kW", dimension: { M: 1, L: 2, T: -3, I: 0 } }],
  ["f", { factor: 1, canonical: "F", dimension: { M: -1, L: -2, T: 4, I: 2 } }],
  ["mf", { factor: 1e-3, canonical: "mF", dimension: { M: -1, L: -2, T: 4, I: 2 } }],
  ["uf", { factor: 1e-6, canonical: "uF", dimension: { M: -1, L: -2, T: 4, I: 2 } }],
  ["nf", { factor: 1e-9, canonical: "nF", dimension: { M: -1, L: -2, T: 4, I: 2 } }],
  ["pf", { factor: 1e-12, canonical: "pF", dimension: { M: -1, L: -2, T: 4, I: 2 } }],
  ["henry", { factor: 1, canonical: "H", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["mhenry", { factor: 1e-3, canonical: "mH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["uhenry", { factor: 1e-6, canonical: "uH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["nhenry", { factor: 1e-9, canonical: "nH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["mh", { factor: 1e-3, canonical: "mH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["uh", { factor: 1e-6, canonical: "uH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["nh", { factor: 1e-9, canonical: "nH", dimension: { M: 1, L: 2, T: -2, I: -2 } }],
  ["lb", { factor: 0.45359237, canonical: "lb", dimension: { M: 1, L: 0, T: 0, I: 0 } }],
  ["oz", { factor: 0.028349523125, canonical: "oz", dimension: { M: 1, L: 0, T: 0, I: 0 } }],
  ["lbf", { factor: 4.4482216152605, canonical: "lbf", dimension: { M: 1, L: 1, T: -2, I: 0 } }],
  ["pa", { factor: 1, canonical: "Pa", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["kpa", { factor: 1e3, canonical: "kPa", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["bar", { factor: 1e5, canonical: "bar", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["atm", { factor: 101325, canonical: "atm", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["psi", { factor: 6894.757293168, canonical: "psi", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["ksi", { factor: 6894757.293168, canonical: "ksi", dimension: { M: 1, L: -1, T: -2, I: 0 } }],
  ["gal", { factor: 0.003785411784, canonical: "gal", dimension: { M: 0, L: 3, T: 0, I: 0 } }],
  ["degf", { factor: 1, canonical: "degF", dimension: { M: 0, L: 0, T: 0, I: 0 } }],
  ["%", { factor: 0.01, canonical: "%", dimension: { M: 0, L: 0, T: 0, I: 0 } }],
]);

const UNIT_ALIASES = new Map<string, string>([
  ["sec", "s"],
  ["secs", "s"],
  ["second", "s"],
  ["seconds", "s"],
  ["mins", "min"],
  ["minute", "min"],
  ["minutes", "min"],
  ["hr", "h"],
  ["hrs", "h"],
  ["hour", "h"],
  ["hours", "h"],
  ["volt", "v"],
  ["volts", "v"],
  ["amp", "a"],
  ["amps", "a"],
  ["ampere", "a"],
  ["amperes", "a"],
  ["ohms", "ohm"],
  ["inch", "in"],
  ["inches", "in"],
  ["foot", "ft"],
  ["feet", "ft"],
  ["yard", "yd"],
  ["yards", "yd"],
  ["mile", "mi"],
  ["miles", "mi"],
  ["lbm", "lb"],
  ["lbs", "lb"],
  ["pound", "lb"],
  ["pounds", "lb"],
  ["ounce", "oz"],
  ["ounces", "oz"],
  ["gallon", "gal"],
  ["gallons", "gal"],
  ["pascal", "pa"],
  ["pascals", "pa"],
  ["kilopascal", "kpa"],
  ["kilopascals", "kpa"],
  ["kpa", "kpa"],
  ["bars", "bar"],
  ["atmosphere", "atm"],
  ["atmospheres", "atm"],
  ["fahrenheit", "degf"],
  ["degf", "degf"],
  ["deg_f", "degf"],
]);

function cloneDimension(value: DimensionVector): DimensionVector {
  return {
    M: value.M,
    L: value.L,
    T: value.T,
    I: value.I,
  };
}

function addDimensions(left: DimensionVector, right: DimensionVector): DimensionVector {
  return {
    M: left.M + right.M,
    L: left.L + right.L,
    T: left.T + right.T,
    I: left.I + right.I,
  };
}

function subtractDimensions(left: DimensionVector, right: DimensionVector): DimensionVector {
  return {
    M: left.M - right.M,
    L: left.L - right.L,
    T: left.T - right.T,
    I: left.I - right.I,
  };
}

function scaleDimensions(value: DimensionVector, exponent: number): DimensionVector {
  return {
    M: value.M * exponent,
    L: value.L * exponent,
    T: value.T * exponent,
    I: value.I * exponent,
  };
}

export function dimensionsEqual(left: DimensionVector, right: DimensionVector): boolean {
  return (
    Math.abs(left.M - right.M) < EPSILON &&
    Math.abs(left.L - right.L) < EPSILON &&
    Math.abs(left.T - right.T) < EPSILON &&
    Math.abs(left.I - right.I) < EPSILON
  );
}

function isDimensionless(value: DimensionVector): boolean {
  return dimensionsEqual(value, DIMENSIONLESS);
}

function formatDimensionExponent(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function formatDimensionVector(value: DimensionVector | null): string {
  if (!value) {
    return "unknown";
  }

  const parts: string[] = [];
  if (Math.abs(value.M) >= EPSILON) {
    parts.push(`M^${formatDimensionExponent(value.M)}`);
  }
  if (Math.abs(value.L) >= EPSILON) {
    parts.push(`L^${formatDimensionExponent(value.L)}`);
  }
  if (Math.abs(value.T) >= EPSILON) {
    parts.push(`T^${formatDimensionExponent(value.T)}`);
  }
  if (Math.abs(value.I) >= EPSILON) {
    parts.push(`I^${formatDimensionExponent(value.I)}`);
  }

  return parts.length > 0 ? parts.join(" * ") : "1";
}

export function normalizeUnitToken(rawUnit: string): string {
  const normalized = normalizeEngineUnitToken(rawUnit);
  if (getEngineUnitSpec(normalized)) {
    return normalized;
  }

  return UNIT_ALIASES.get(normalized) ?? normalized;
}

function resolveUnitSpec(rawUnit: string): UnitSpec | undefined {
  const normalized = normalizeUnitToken(rawUnit);
  const local = UNIT_SPECS.get(normalized);
  if (local) {
    return local;
  }

  const engine = getEngineUnitSpec(normalized);
  if (!engine) {
    return undefined;
  }

  return {
    factor: engine.factorToSi,
    canonical: engine.canonical,
    dimension: {
      M: engine.dimension.M,
      L: engine.dimension.L,
      T: engine.dimension.T,
      I: engine.dimension.I,
    },
  };
}

export function parseExpressionUnit(raw: string): { expression: string; outputUnit?: string } {
  const trimmed = raw.trim();
  const arrow = trimmed.match(OUTPUT_UNIT_ARROW_RX);
  if (arrow) {
    return {
      expression: arrow[1].trim(),
      outputUnit: arrow[2].trim(),
    };
  }

  const bracket = trimmed.match(OUTPUT_UNIT_BRACKET_RX);
  if (bracket) {
    return {
      expression: bracket[1].trim(),
      outputUnit: bracket[2].trim(),
    };
  }

  return {
    expression: trimmed,
  };
}

function makeIgnoreDirectives(initial?: Partial<IgnoreDirectives>): IgnoreDirectives {
  return {
    all: initial?.all ?? false,
    error: initial?.error ?? false,
    warning: initial?.warning ?? false,
    info: initial?.info ?? false,
  };
}

function mergeIgnoreDirectives(
  left: IgnoreDirectives,
  right: IgnoreDirectives
): IgnoreDirectives {
  return {
    all: left.all || right.all,
    error: left.error || right.error,
    warning: left.warning || right.warning,
    info: left.info || right.info,
  };
}

function parseIgnoreDirectives(instruction: string): {
  cleaned: string;
  ignore: IgnoreDirectives;
} {
  const ignore = makeIgnoreDirectives();
  const cleaned = instruction
    .replace(IGNORE_DIRECTIVE_RX, (_: string, level: string | undefined) => {
      if (!level) {
        ignore.all = true;
        return " ";
      }

      const normalized = level.trim().toLowerCase();
      if (normalized === "error") {
        ignore.error = true;
      } else if (normalized === "warning") {
        ignore.warning = true;
      } else if (normalized === "info") {
        ignore.info = true;
      }

      return " ";
    })
    .trim();

  return {
    cleaned,
    ignore,
  };
}

function shouldSuppressByIgnore(
  severity: InlineCalcSeverity,
  ignore: IgnoreDirectives
): boolean {
  if (ignore.all) {
    return true;
  }

  if (severity === "error") {
    return ignore.error;
  }

  if (severity === "warning") {
    return ignore.warning;
  }

  return ignore.info;
}

function normalizePathForMatch(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

function parseNumericConfigValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object" && "value" in value) {
    return parseNumericConfigValue((value as { value?: unknown }).value);
  }

  return null;
}

function matchesConfigFileHint(relativePath: string, fileHint: string): boolean {
  const normalizedPath = normalizePathForMatch(relativePath);
  const normalizedHint = normalizePathForMatch(fileHint);
  if (!normalizedHint) {
    return false;
  }

  const pathParts = normalizedPath.split("/");
  const fileName = pathParts[pathParts.length - 1] ?? normalizedPath;
  const extIndex = fileName.lastIndexOf(".");
  const fileStem =
    extIndex > 0 ? fileName.slice(0, extIndex) : fileName;

  return (
    normalizedPath === normalizedHint ||
    normalizedPath.endsWith(`/${normalizedHint}`) ||
    fileName === normalizedHint ||
    fileStem === normalizedHint
  );
}

function resolveConfigValueFromFileHint(
  state: CalcDocsState,
  fileHint: string,
  configKey: string
): number | null {
  for (const [relativePath, configVars] of state.configVars) {
    if (!matchesConfigFileHint(relativePath, fileHint)) {
      continue;
    }

    if (!configVars.has(configKey)) {
      continue;
    }

    const numeric = parseNumericConfigValue(configVars.get(configKey));
    if (numeric != null) {
      return numeric;
    }
  }

  return null;
}

function resolveConfigValueFromAnyFile(
  state: CalcDocsState,
  configKey: string
): number | null {
  for (const configVars of state.configVars.values()) {
    if (!configVars.has(configKey)) {
      continue;
    }

    const numeric = parseNumericConfigValue(configVars.get(configKey));
    if (numeric != null) {
      return numeric;
    }
  }

  return null;
}

function resolveConfigReference(
  state: CalcDocsState,
  variableName: string
): number | null {
  if (!variableName.startsWith("config.")) {
    return null;
  }

  const suffix = variableName.slice("config.".length).trim();
  if (!suffix) {
    return null;
  }

  const parts = suffix.split(".").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  const configKey = parts[parts.length - 1];
  const fileHints = new Set<string>();

  if (parts.length === 1) {
    fileHints.add("config");
  } else {
    const scopedHint = parts.slice(0, -1).join(".");
    fileHints.add(`config.${scopedHint}`);
    fileHints.add(scopedHint);
  }

  for (const hint of fileHints) {
    const scopedValue = resolveConfigValueFromFileHint(state, hint, configKey);
    if (scopedValue != null) {
      return scopedValue;
    }
  }

  // Backward-compatible fallback: @config.<var> scans all parsed config files.
  if (parts.length === 1) {
    return resolveConfigValueFromAnyFile(state, configKey);
  }

  return null;
}

function resolveVariables(
  expression: string,
  state: CalcDocsState,
  variables: Map<string, number>
): { expression: string; missingVars: string[] } {
  const missing = new Set<string>();

  const replaced = expression.replace(
    VAR_REFERENCE_RX,
    (_: string, variableName: string) => {
      const configValue = resolveConfigReference(state, variableName);
      if (configValue != null) {
        return String(configValue);
      }

      if (!variables.has(variableName)) {
        missing.add(variableName);
        return `@${variableName}`;
      }

      return String(variables.get(variableName));
    }
  );

  return {
    expression: replaced,
    missingVars: Array.from(missing.values()),
  };
}

function replaceInlineQuantityLiterals(expression: string): string {
  return expression.replace(
    QUANTITY_LITERAL_RX,
    (full: string, rawNumeric: string, rawUnit: string) => {
      const numeric = Number(rawNumeric);
      if (!Number.isFinite(numeric)) {
        return full;
      }

      const normalizedUnit = normalizeUnitToken(rawUnit);
      const spec = resolveUnitSpec(normalizedUnit);
      if (!spec) {
        return full;
      }

      return String(numeric * spec.factor);
    }
  );
}

function replaceVariablesForDimension(expression: string): string {
  return expression.replace(
    VAR_REFERENCE_RX,
    (_: string, variableName: string) =>
      `__VAR_${variableName.replace(/\./g, "__")}`
  );
}

function replaceQuantityLiteralsForDimension(expression: string): {
  expression: string;
  quantityDimensions: Map<string, DimensionVector>;
} {
  let counter = 0;
  const quantityDimensions = new Map<string, DimensionVector>();

  const replaced = expression.replace(
    QUANTITY_LITERAL_RX,
    (full: string, _rawNumeric: string, rawUnit: string) => {
      const normalizedUnit = normalizeUnitToken(rawUnit);
      const spec = resolveUnitSpec(normalizedUnit);
      if (!spec) {
        return full;
      }

      const token = `__Q${counter++}`;
      quantityDimensions.set(token, cloneDimension(spec.dimension));
      return token;
    }
  );

  return {
    expression: replaced,
    quantityDimensions,
  };
}

function tokenizeDimensionExpression(expression: string): DimensionToken[] | null {
  const tokens: DimensionToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if ("()+-*/^,".includes(char)) {
      tokens.push({ value: char });
      index += 1;
      continue;
    }

    const numberMatch = expression.slice(index).match(NUMBER_RX);
    if (numberMatch) {
      tokens.push({ value: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }

    const identifierMatch = expression.slice(index).match(IDENTIFIER_RX);
    if (identifierMatch) {
      tokens.push({ value: identifierMatch[0] });
      index += identifierMatch[0].length;
      continue;
    }

    return null;
  }

  return tokens;
}

class DimensionParser {
  private index = 0;
  private warnings: string[] = [];

  constructor(
    private readonly tokens: DimensionToken[],
    private readonly quantityDimensions: Map<string, DimensionVector>,
    private readonly variableDimensions: Map<string, DimensionVector>
  ) {}

  parse(): DimensionEvalResult {
    const dimension = this.parseAddSub();
    if (this.index < this.tokens.length) {
      return {
        dimension: null,
        warnings: this.warnings.slice(),
      };
    }

    return {
      dimension,
      warnings: this.warnings.slice(),
    };
  }

  private parseAddSub(): DimensionVector | null {
    let left = this.parseMulDiv();

    while (this.match("+", "-")) {
      const operator = this.previous().value;
      const right = this.parseMulDiv();

      if (left && right && !dimensionsEqual(left, right)) {
        this.warnings.push(
          `dimension mismatch in '${operator}': ${formatDimensionVector(left)} vs ${formatDimensionVector(right)}`
        );
        left = null;
        continue;
      }

      if (!left || !right) {
        left = null;
      }
    }

    return left;
  }

  private parseMulDiv(): DimensionVector | null {
    let left = this.parsePower();

    while (this.match("*", "/")) {
      const operator = this.previous().value;
      const right = this.parsePower();

      if (!left || !right) {
        left = null;
        continue;
      }

      left = operator === "*" ? addDimensions(left, right) : subtractDimensions(left, right);
    }

    return left;
  }

  private parsePower(): DimensionVector | null {
    let base = this.parseUnary();

    while (this.match("^")) {
      const exponent = this.parseNumericExponent();
      if (exponent == null) {
        base = null;
        continue;
      }

      if (!base) {
        continue;
      }

      base = scaleDimensions(base, exponent);
    }

    return base;
  }

  private parseNumericExponent(): number | null {
    let sign = 1;
    if (this.match("+")) {
      sign = 1;
    } else if (this.match("-")) {
      sign = -1;
    }

    const current = this.peek();
    if (current && NUMBER_RX.test(current.value)) {
      this.advance();
      return sign * Number(current.value);
    }

    if (this.match("(")) {
      const nested = this.parseNumericExponent();
      if (!this.match(")")) {
        return null;
      }

      return nested == null ? null : sign * nested;
    }

    // Mantieni il parser in avanzamento consumando una primaria non numerica.
    this.parseUnary();
    return null;
  }

  private parseUnary(): DimensionVector | null {
    if (this.match("+", "-")) {
      return this.parseUnary();
    }

    return this.parsePrimary();
  }

  private parsePrimary(): DimensionVector | null {
    if (this.match("(")) {
      const nested = this.parseAddSub();
      if (!this.match(")")) {
        return null;
      }

      return nested;
    }

    if (this.isAtEnd()) {
      return null;
    }

    const token = this.advance();
    if (!token) {
      return null;
    }

    if (NUMBER_RX.test(token.value)) {
      return cloneDimension(DIMENSIONLESS);
    }

    if (token.value.startsWith("__Q")) {
      const value = this.quantityDimensions.get(token.value);
      return value ? cloneDimension(value) : null;
    }

    if (token.value.startsWith("__VAR_")) {
      const variable = token.value.slice("__VAR_".length);
      const dimension = this.variableDimensions.get(variable);
      return dimension ? cloneDimension(dimension) : null;
    }

    if (this.match("(")) {
      let depth = 1;
      while (!this.isAtEnd() && depth > 0) {
        const next = this.advance();
        if (!next) {
          break;
        }

        if (next.value === "(") {
          depth += 1;
        } else if (next.value === ")") {
          depth -= 1;
        }
      }

      return null;
    }

    return null;
  }

  private peek(): DimensionToken | null {
    if (this.index >= this.tokens.length) {
      return null;
    }

    return this.tokens[this.index];
  }

  private previous(): DimensionToken {
    return this.tokens[this.index - 1];
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private advance(): DimensionToken | null {
    if (this.isAtEnd()) {
      return null;
    }

    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private match(...candidates: string[]): boolean {
    if (this.isAtEnd()) {
      return false;
    }

    const token = this.tokens[this.index];
    if (!candidates.includes(token.value)) {
      return false;
    }

    this.index += 1;
    return true;
  }
}

export function evaluateExpressionDimensions(
  expression: string,
  variableDimensions: Map<string, DimensionVector>
): DimensionEvalResult {
  const withVariables = replaceVariablesForDimension(expression);
  const withQuantities = replaceQuantityLiteralsForDimension(withVariables);
  const tokens = tokenizeDimensionExpression(withQuantities.expression);
  if (!tokens) {
    return {
      dimension: null,
      warnings: [],
    };
  }

  const parser = new DimensionParser(
    tokens,
    withQuantities.quantityDimensions,
    variableDimensions
  );
  return parser.parse();
}

function evaluateInlineExpression(
  state: CalcDocsState,
  expression: string,
  variables: Map<string, number>
): EvalResult {
  const resolvedVariables = resolveVariables(expression, state, variables);
  if (resolvedVariables.missingVars.length > 0) {
    return {
      value: null,
      resolvedExpression: resolvedVariables.expression,
      error: `missing @${resolvedVariables.missingVars.join(", @")}`,
    };
  }

  const normalizedExpression = replaceInlineQuantityLiterals(
    resolvedVariables.expression
  );
  const preview = evaluateExpressionPreview(state, normalizedExpression);

  if (typeof preview.value === "number") {
    return {
      value: preview.value,
      resolvedExpression: preview.expanded || normalizedExpression,
    };
  }

  if (preview.error?.kind === "cast-overflow") {
    const overflow = preview.error.overflow;
    return {
      value: null,
      resolvedExpression: preview.expanded || normalizedExpression,
      error: `cast overflow (${overflow.castType})`,
    };
  }

  return {
    value: null,
    resolvedExpression: preview.expanded || normalizedExpression,
    error: "unresolved expression",
  };
}

function formatWithOutputUnit(
  state: CalcDocsState,
  value: number,
  outputUnit: string | undefined
): string {
  if (!outputUnit) {
    return formatPreviewNumber(state, value);
  }

  const normalizedUnit = normalizeUnitToken(outputUnit);
  const spec = resolveUnitSpec(normalizedUnit);
  if (!spec) {
    return `${formatPreviewNumber(state, value)} ${outputUnit}`;
  }

  const converted = value / spec.factor;
  return `${formatPreviewNumber(state, converted)} ${spec.canonical}`;
}

function normalizeCommentLine(rawComment: string): string {
  return rawComment.replace(/^\s*\*+\s?/, "").trim();
}

function extractCommentLines(documentText: string, languageId?: string): { line: number; comment: string }[] {
  const lines = documentText.split(/\r?\n/);
  const comments: { line: number; comment: string }[] = [];
  const isYaml = languageId === "yaml";

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    let cursor = 0;
    let commentBuffer = "";
    let inString: string | null = null;
    let inBlockComment = false;

    while (cursor < lineText.length) {
      const current = lineText[cursor];
      const next = cursor + 1 < lineText.length ? lineText[cursor + 1] : "";

      if (inBlockComment) {
        if (current === "*" && next === "/") {
          inBlockComment = false;
          cursor += 2;
          continue;
        }

        commentBuffer += current;
        cursor += 1;
        continue;
      }

      if (inString) {
        if (current === "\\") {
          cursor += 2;
          continue;
        }

        if (current === inString) {
          inString = null;
        }

        cursor += 1;
        continue;
      }

      if (current === "'" || current === '"') {
        inString = current;
        cursor += 1;
        continue;
      }

      // YAML: commenti con #
      if (isYaml && current === "#") {
        commentBuffer += lineText.slice(cursor + 1);
        break;
      }

      // C/C++: commenti con //
      if (!isYaml && current === "/" && next === "/") {
        commentBuffer += lineText.slice(cursor + 2);
        break;
      }

      // C/C++: commenti con /* */
      if (!isYaml && current === "/" && next === "*") {
        inBlockComment = true;
        cursor += 2;
        continue;
      }

      cursor += 1;
    }

    const normalized = normalizeCommentLine(commentBuffer);
    if (normalized) {
      comments.push({
        line: lineIndex,
        comment: normalized,
      });
    }
  }

  return comments;
}

function parseInlineCommands(documentText: string, languageId?: string): InlineCommand[] {
  const commands: InlineCommand[] = [];
  const comments = extractCommentLines(documentText, languageId);

  for (const entry of comments) {
    const lineIgnore = IGNORE_LINE_DIRECTIVE_RX.test(entry.comment);
    const lineIgnoreDirectives = lineIgnore
      ? makeIgnoreDirectives({
          all: true,
          error: true,
          warning: true,
          info: true,
        })
      : makeIgnoreDirectives();

    const instructions = entry.comment
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const instruction of instructions) {
      const parsedIgnore = parseIgnoreDirectives(instruction);
      if (!parsedIgnore.cleaned) {
        continue;
      }

      const ignore = mergeIgnoreDirectives(parsedIgnore.ignore, lineIgnoreDirectives);

      const assignMatch = parsedIgnore.cleaned.match(INLINE_ASSIGN_RX);
      if (assignMatch) {
        const parsed = parseExpressionUnit(assignMatch[2]);
        if (!parsed.expression) {
          continue;
        }

        commands.push({
          kind: "assign",
          line: entry.line,
          source: parsedIgnore.cleaned,
          variable: assignMatch[1],
          expression: parsed.expression,
          outputUnit: parsed.outputUnit,
          ignore,
        });
        continue;
      }

      const calcMatch = parsedIgnore.cleaned.match(INLINE_CALC_RX);
      if (!calcMatch) {
        continue;
      }

      const parsed = parseExpressionUnit(calcMatch[1]);
      if (!parsed.expression) {
        continue;
      }

      commands.push({
        kind: "calc",
        line: entry.line,
        source: parsedIgnore.cleaned,
        expression: parsed.expression,
        outputUnit: parsed.outputUnit,
        ignore,
      });
    }
  }

  return commands;
}

function hasQuantityLiteralSignal(expression: string): boolean {
  QUANTITY_LITERAL_RX.lastIndex = 0;
  return QUANTITY_LITERAL_RX.test(expression);
}

function isKnownUnitWord(token: string): boolean {
  return Boolean(resolveUnitSpec(token));
}

function isLikelyInlineCalculationExpression(
  expression: string,
  state: CalcDocsState,
  knownInlineVariables: Map<string, number>
): boolean {
  // const logPrefix = "[inline]";
  const trimmed = expression.trim();

  if (!trimmed) {
    // state.output.appendLine(`${logPrefix} trimmed=<empty>\n`);
    return false;
  }

  if (DECORATIVE_ONLY_RX.test(trimmed)) {
    // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> DECORATIVE_ONLY_RX\n`);
    return false;
  }

  if (DECORATIVE_EQUALS_RX.test(trimmed)) {
    // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> DECORATIVE_EQUALS_RX\n`);
    return false;
  }

  if (trimmed.startsWith("==") && !/\d|@/.test(trimmed)) {
    // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> startsWith== without digit/@\n`);
    return false;
  }

  const hasNumber = /\d/.test(trimmed);
  const hasAtVariable = /@[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/.test(trimmed);
  const hasMathOperator = MATH_OPERATOR_RX.test(trimmed);
  const hasFunctionCall = FUNCTION_CALL_RX.test(trimmed);
  const hasQuantity = hasQuantityLiteralSignal(trimmed);
  const tokens = trimmed.match(IDENTIFIER_TOKEN_RX) ?? [];

  const hasKnownSymbolToken = tokens.some((token) => {
    return (
      state.symbolValues.has(token) ||
      state.allDefines.has(token) ||
      knownInlineVariables.has(token)
    );
  });

  if (!hasMathOperator && !hasFunctionCall) {
    return false;
  }
  const hasOnlyUnknownWords =
    tokens.length > 0 &&
    !hasNumber &&
    !hasAtVariable &&
    !hasMathOperator &&
    !hasFunctionCall &&
    !hasQuantity &&
    !hasKnownSymbolToken &&
    tokens.every((token) => !isKnownUnitWord(token));

  const nonNumericTextTokens = tokens.filter((t) => !/^\d+$/.test(t));

  // state.output.appendLine(
  //   [
  //     `${logPrefix} trimmed=${trimmed}`,
  //     `hasNumber=${hasNumber}`,
  //     `hasAtVariable=${hasAtVariable}`,
  //     `hasMathOperator=${hasMathOperator}`,
  //     `hasFunctionCall=${hasFunctionCall}`,
  //     `hasQuantity=${hasQuantity}`,
  //     `tokens=${JSON.stringify(tokens)}`,
  //     `hasKnownSymbolToken=${hasKnownSymbolToken}`,
  //     `hasOnlyUnknownWords=${hasOnlyUnknownWords}`,
  //     `nonNumericTextTokens=${JSON.stringify(nonNumericTextTokens)}`
  //   ].join(" | ") + "\n"
  // );

  if (hasOnlyUnknownWords) {
    // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> false (hasOnlyUnknownWords)\n`);
    return false;
  }

  if (
    nonNumericTextTokens.length > 4 &&
    !hasMathOperator &&
    !hasAtVariable &&
    !hasFunctionCall &&
    !hasQuantity
  ) {
    // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> false (too many text tokens)\n`);
    return false;
  }

  const result =
    hasNumber ||
    hasAtVariable ||
    hasMathOperator ||
    hasFunctionCall ||
    hasQuantity ||
    hasKnownSymbolToken;

  // state.output.appendLine(`${logPrefix} trimmed=${trimmed} -> result=${result}\n`);
  return result;
}

function buildWarningsForOutputUnit(
  resultDimension: DimensionVector | null,
  outputUnit: string | undefined
): string[] {
  if (!outputUnit) {
    return [];
  }

  const normalized = normalizeUnitToken(outputUnit);
  const unitSpec = resolveUnitSpec(normalized);
  if (!unitSpec) {
    return [`output unit '${outputUnit}' not recognized`];
  }

  if (resultDimension && !dimensionsEqual(resultDimension, unitSpec.dimension)) {
    return [
      `output unit mismatch: expression is ${formatDimensionVector(resultDimension)} but output unit '${unitSpec.canonical}' expects ${formatDimensionVector(unitSpec.dimension)}`,
    ];
  }

  return [];
}

function pickSeverity(error: string | undefined, warnings: string[]): InlineCalcSeverity {
  if (error) {
    return "error";
  }

  if (warnings.length > 0) {
    return "warning";
  }

  return "info";
}

export function evaluateInlineCalcs(
  documentText: string,
  state: CalcDocsState,
  options: InlineCalcEvaluationOptions = {},
  languageId?: string
): InlineCalcResult[] {
  const includeSuppressed = options.includeSuppressed ?? false;
  const includeAssignments = options.includeAssignments ?? true;
  const variables = new Map<string, number>();
  const variableDimensions = new Map<string, DimensionVector>();
  const commands = parseInlineCommands(documentText, languageId);
  const results: InlineCalcResult[] = [];

  for (const command of commands) {
    if (
      command.kind === "calc" &&
      !isLikelyInlineCalculationExpression(command.expression, state, variables)
    ) {
      continue;
    }

    const evaluated = evaluateInlineExpression(state, command.expression, variables);
    const dimensionEvaluation = evaluateExpressionDimensions(
      command.expression,
      variableDimensions
    );
    const warnings = [
      ...dimensionEvaluation.warnings,
      ...buildWarningsForOutputUnit(
        dimensionEvaluation.dimension,
        command.outputUnit
      ),
    ];

    if (command.kind === "assign") {
      if (typeof evaluated.value === "number") {
        variables.set(command.variable, evaluated.value);
      }

      if (dimensionEvaluation.dimension) {
        variableDimensions.set(command.variable, dimensionEvaluation.dimension);
      }
    }

    const severity = pickSeverity(evaluated.error, warnings);
    const suppressed = shouldSuppressByIgnore(severity, command.ignore);

    let displayValue: string;
    if (typeof evaluated.value === "number") {
      const formatted = formatWithOutputUnit(state, evaluated.value, command.outputUnit);
      displayValue =
        command.kind === "assign"
          ? `@${command.variable} = ${formatted}`
          : formatted;
    } else {
      displayValue = evaluated.error ?? warnings[0] ?? "unresolved";
    }

    const result: InlineCalcResult = {
      kind: command.kind,
      line: command.line,
      source: command.source,
      expression: command.expression,
      resolvedExpression: evaluated.resolvedExpression,
      outputUnit: command.outputUnit,
      value: evaluated.value,
      variable: command.kind === "assign" ? command.variable : undefined,
      displayValue,
      severity,
      warnings,
      error: evaluated.error,
      dimensionText: formatDimensionVector(dimensionEvaluation.dimension),
      suppressed,
      ignore: command.ignore,
    };

    if (!includeAssignments && result.kind === "assign") {
      continue;
    }

    if (!includeSuppressed && suppressed) {
      continue;
    }

    results.push(result);
  }

  return results;
}
