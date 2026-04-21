import * as fsp from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";

import {
  FormulaEntry,
  FORMULA_LABEL_VALUES,
  type FormulaLabel,
} from "../types/FormulaEntry";

export type LoadedYaml = {
  rawText: string;
  parsed: Record<string, unknown>;
};

/**
 * Reads and parses YAML file, enforcing an object root.
 */
export async function loadYaml(yamlPath: string): Promise<LoadedYaml> {
  const rawText = await fsp.readFile(yamlPath, "utf8");
  const parsedRoot = yaml.load(rawText);

  if (!parsedRoot || typeof parsedRoot !== "object" || Array.isArray(parsedRoot)) {
    throw new Error("YAML root is not a valid object");
  }

  return {
    rawText,
    parsed: parsedRoot as Record<string, unknown>,
  };
}

/**
 * Finds the line where a top-level key is declared.
 * Example: in "PRESSURE_DROP:", key "PRESSURE_DROP" returns that line index.
 */
export function getYamlTopLevelLine(yamlText: string, key: string): number {
  const lines = yamlText.split(/\r?\n/);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRegex = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(#.*)?$`);

  return lines.findIndex((line) => keyRegex.test(line));
}

/**
 * Builds a normalized formula entry from one YAML node.
 * Keeps source location metadata for navigation and write-back operations.
 */
export function buildFormulaEntry(
  key: string,
  node: Record<string, unknown>,
  yamlRawText: string,
  yamlPath: string,
  workspaceRoot: string
): FormulaEntry {
  const rawLabels = Array.isArray(node.labels)
    ? node.labels
    : Array.isArray(node.etichette)
      ? node.etichette
      : [];
  const labels = normalizeLabels(rawLabels);

  const rawValue = node.value;
  let valueYaml: number | undefined;
  let unitFromValue: string | undefined;

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    valueYaml = rawValue;
  } else if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    const match = trimmed.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-z%][A-Za-z0-9_%]*)$/);
    if (match) {
      valueYaml = Number(match[1]);
      unitFromValue = match[2];
    } else {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        valueYaml = numeric;
      }
    }
  }

  const unit = typeof node.unit === "string" ? node.unit : unitFromValue;

  return {
    key,
    unit,
    formula: typeof node.formula === "string" ? node.formula : undefined,
    steps: Array.isArray(node.steps) ? node.steps.map(String) : [],
    labels,
    revision: typeof node.revision === "string" ? node.revision : undefined,
    valueYaml,
    expanded: undefined,
    valueCalc: null,
    _filePath: path.relative(workspaceRoot, yamlPath),
    _line: getYamlTopLevelLine(yamlRawText, key),
  };
}

function normalizeLabels(rawLabels: unknown[]): FormulaLabel[] {
  const allowed = new Set<string>(FORMULA_LABEL_VALUES);
  const normalized = new Set<FormulaLabel>();

  for (const label of rawLabels) {
    const asString = String(label).trim().toLowerCase();
    if (!asString || !allowed.has(asString)) {
      continue;
    }

    normalized.add(asString as FormulaLabel);
  }

  return Array.from(normalized);
}
