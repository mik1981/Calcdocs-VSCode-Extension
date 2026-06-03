import * as yaml from "js-yaml";

export const FORMULA_YAML_FILE_RX = /(^|[\\/])formulas?.*\.ya?ml$/i;

import type { TolMode } from "../types/FormulaEntry";

export type FormulaToleranceRange = {
  min?: number;
  max?: number;
  tol?: number;
  mode?: TolMode;
  sigma?: number;
};


export type FormulaToleranceSpec = FormulaToleranceRange & {
  parameters: Record<string, FormulaToleranceRange>;
};

export type ParsedFormulaYamlEntry = {
  id: string;
  expr: string;
  desc?: string;
  example?: Record<string, number>;
  unit?: string;
  value?: number;
  values?: number[];
  parameters?: string[];
  tolerance?: FormulaToleranceSpec;
  lineStart: number;
  lineEnd: number;
  _filePath?: string;
  line?: number;
  rawNode: Record<string, unknown>;
};

export type ParsedFormulaYamlDocument = {
  rawText: string;
  root: Record<string, unknown>;
  entries: ParsedFormulaYamlEntry[];
};

const NUMERIC_WITH_UNIT_RX =
  /^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z%][A-Za-z0-9_%]*)$/;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    const withUnit = trimmed.match(NUMERIC_WITH_UNIT_RX);
    if (withUnit) {
      return Number(withUnit[1]);
    }
  }

  return undefined;
}

function toNumericArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values: number[] = [];
  for (const item of value) {
    const numeric = toFiniteNumber(item);
    if (numeric === undefined) {
      return undefined;
    }
    values.push(numeric);
  }

  return values;
}

export function parseFormulaYamlValue(value: unknown): {
  value?: number;
  values?: number[];
  unitFromValue?: string;
} {
  const values = toNumericArray(value);
  if (values) {
    return { values };
  }

  if (typeof value === "string") {
    const match = value.trim().match(NUMERIC_WITH_UNIT_RX);
    if (match) {
      return {
        value: Number(match[1]),
        unitFromValue: match[2],
      };
    }
  }

  return {
    value: toFiniteNumber(value),
  };
}

export function getYamlTopLevelLine(yamlText: string, key: string): number {
  const lines = yamlText.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(#.*)?$`);

  return lines.findIndex((line) => keyRegex.test(line));
}

function getTopLevelKeyLines(lines: string[]): Map<string, number> {
  const result = new Map<string, number>();
  const keyRx = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:\s*(?:#.*)?$/;

  lines.forEach((line, index) => {
    if (/^\s/.test(line)) {
      return;
    }

    const match = line.trim().match(keyRx);
    if (match) {
      result.set(match[1], index);
    }
  });

  return result;
}

function getLineEnd(lineStart: number, orderedStarts: number[], lineCount: number): number {
  const next = orderedStarts.find((line) => line > lineStart);
  return (next ?? lineCount) - 1;
}

function parseExample(node: Record<string, unknown>): Record<string, number> {
  const example: Record<string, number> = {};
  const rawExample = node.example;

  if (isObjectRecord(rawExample)) {
    for (const [key, value] of Object.entries(rawExample)) {
      const numeric = toFiniteNumber(value);
      if (numeric !== undefined) {
        example[key] = numeric;
      }
    }
  }

  const reserved = new Set([
    "type",
    "expr",
    "formula",
    "unit",
    "desc",
    "description",
    "value",
    "values",
    "steps",
    "labels",
    "etichette",
    "revision",
    "parameters",
    "tolerance",
    "ranges",
    "min",
    "max",
    "tol",
  ]);

  for (const [key, value] of Object.entries(node)) {
    if (reserved.has(key)) {
      continue;
    }

    const numeric = toFiniteNumber(value);
    if (numeric !== undefined) {
      example[key] = numeric;
    }
  }

  return example;
}

function parseParameterNames(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (Array.isArray(raw)) {
    return raw
      .map((part) => String(part).trim())
      .filter(Boolean);
  }

  if (isObjectRecord(raw)) {
    return Object.keys(raw).filter(Boolean);
  }

  return [];
}

function parseTolMode(raw: unknown): TolMode | undefined {
  if (raw === "worst_case" || raw === "rss" || raw === "gaussian") {
    return raw;
  }
  return undefined;
}

function parseRange(raw: unknown): FormulaToleranceRange | undefined {
  if (!isObjectRecord(raw)) {
    return undefined;
  }

  const range: FormulaToleranceRange = {};
  const min = toFiniteNumber(raw.min);
  const max = toFiniteNumber(raw.max);
  const tol = parseTolerancePercent(raw.tol);
  const mode = parseTolMode(
    (raw as Record<string, unknown>).mode ?? 
    (raw as Record<string, unknown>).tol_mode ??
    (raw as Record<string, unknown>).tolMode
  );
  const sigmaRaw = (raw as Record<string, unknown>).sigma;
  const sigma = typeof sigmaRaw === "number" && Number.isFinite(sigmaRaw) ? sigmaRaw : undefined;

  if (min !== undefined) {
    range.min = min;
  }
  if (max !== undefined) {
    range.max = max;
  }
  if (tol !== undefined) {
    range.tol = tol;
  }
  if (mode !== undefined) {
    range.mode = mode;
  }
  if (sigma !== undefined) {
    range.sigma = sigma;
  }

  return (
    range.min !== undefined ||
    range.max !== undefined ||
    range.tol !== undefined ||
    range.mode !== undefined ||
    range.sigma !== undefined
  )
    ? range
    : undefined;
}


function parseTolerancePercent(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/%$/, "");
    const value = Number(trimmed);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function mergeParameterRanges(
  target: Record<string, FormulaToleranceRange>,
  raw: unknown
): void {
  if (!isObjectRecord(raw)) {
    return;
  }

  for (const [name, value] of Object.entries(raw)) {
    const range = parseRange(value);
    if (range) {
      target[name] = {
        ...target[name],
        ...range,
      };
    }
  }
}

function parseToleranceSpec(node: Record<string, unknown>): FormulaToleranceSpec | undefined {
  const rootRange: FormulaToleranceRange = {};
  const parameters: Record<string, FormulaToleranceRange> = {};
  const explicitTolerance = isObjectRecord(node.tolerance) ? node.tolerance : undefined;

  for (const source of [node, explicitTolerance]) {
    if (!source) {
      continue;
    }

    const min = toFiniteNumber(source.min);
    const max = toFiniteNumber(source.max);
    const tol = parseTolerancePercent(source.tol);
    const mode = parseTolMode(
      (source as any).mode ?? 
      (source as any).tol_mode ??
      (source as any).tolMode
    );

    const sigmaRaw = (source as Record<string, unknown>).sigma;
    const sigma = typeof sigmaRaw === "number" && Number.isFinite(sigmaRaw)
      ? sigmaRaw
      : undefined;

    if (min !== undefined) {
      rootRange.min = min;
    }
    if (max !== undefined) {
      rootRange.max = max;
    }
    if (tol !== undefined) {
      rootRange.tol = tol;
    }
    if (mode !== undefined) {
      rootRange.mode = mode;
    }
    if (sigma !== undefined) {
      rootRange.sigma = sigma;
    }
  }

  mergeParameterRanges(parameters, node.ranges);
  mergeParameterRanges(parameters, explicitTolerance?.parameters);
  mergeParameterRanges(parameters, explicitTolerance?.ranges);

  if (isObjectRecord(node.parameters)) {
    mergeParameterRanges(parameters, node.parameters);
  }

  if (
    rootRange.min === undefined &&
    rootRange.max === undefined &&
    rootRange.tol === undefined &&
    rootRange.mode === undefined &&
    rootRange.sigma === undefined &&
    Object.keys(parameters).length === 0
  ) {
    return undefined;
  }

  return {
    ...rootRange,
    parameters,
  };
}


export function normalizeFormulaYamlNode(
  id: string,
  node: Record<string, unknown>,
  yamlText: string,
  filePath?: string
): ParsedFormulaYamlEntry {
  const rawValue = parseFormulaYamlValue(node.value);
  const expr =
    (typeof node.expr === "string" ? node.expr : undefined) ??
    (typeof node.formula === "string" ? node.formula : undefined) ??
    "";
  const unit =
    (typeof node.unit === "string" ? node.unit.trim() : undefined) ??
    rawValue.unitFromValue;
  const desc =
    (typeof node.desc === "string" ? node.desc : undefined) ??
    (typeof node.description === "string" ? node.description : undefined);
  const parameters = parseParameterNames(node.parameters);
  const lineStart = Math.max(0, getYamlTopLevelLine(yamlText, id));

  return {
    id,
    expr,
    desc,
    example: parseExample(node),
    unit,
    value: rawValue.value,
    values: rawValue.values,
    parameters: parameters.length > 0 ? parameters : undefined,
    tolerance: parseToleranceSpec(node),
    lineStart,
    lineEnd: lineStart,
    _filePath: filePath,
    line: lineStart,
    rawNode: node,
  };
}

export function parseFormulaYamlText(rawText: string, filePath?: string): ParsedFormulaYamlEntry[] {
  const parsedRoot = yaml.load(rawText);
  if (!isObjectRecord(parsedRoot)) {
    return [];
  }

  const lines = rawText.split(/\r?\n/);
  const keyLines = getTopLevelKeyLines(lines);
  const orderedStarts = Array.from(keyLines.values()).sort((left, right) => left - right);
  const entries: ParsedFormulaYamlEntry[] = [];

  for (const [id, rawNode] of Object.entries(parsedRoot)) {
    if (!isObjectRecord(rawNode)) {
      continue;
    }

    const entry = normalizeFormulaYamlNode(id, rawNode, rawText, filePath);
    const lineStart = keyLines.get(id) ?? entry.lineStart;
    entry.lineStart = lineStart;
    entry.line = lineStart;
    entry.lineEnd = getLineEnd(lineStart, orderedStarts, lines.length);

    if (entry.expr || entry.value !== undefined || entry.values !== undefined) {
      entries.push(entry);
    }
  }

  return entries;
}

export function parseFormulaYamlLines(lines: string[], filePath?: string): ParsedFormulaYamlEntry[] {
  return parseFormulaYamlText(lines.join("\n"), filePath);
}

export function isFormulaYamlFileName(fileName: string): boolean {
  return FORMULA_YAML_FILE_RX.test(fileName);
}

