import * as fsp from "fs/promises";
import * as path from "path";
import * as yaml from "js-yaml";

import {
  FormulaEntry,
  FORMULA_LABEL_VALUES,
  type FormulaLabel,
} from "../types/FormulaEntry";
import {
  getYamlTopLevelLine,
  normalizeFormulaYamlNode,
  parseFormulaYamlValue,
} from "./formulaYaml";

export { getYamlTopLevelLine } from "./formulaYaml";

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

  const parsedValue = parseFormulaYamlValue(node.value);
  const normalized = normalizeFormulaYamlNode(key, node, yamlRawText, yamlPath);
  const unit = typeof node.unit === "string" ? node.unit : normalized.unit;

  return {
    key,
    unit,
    formula: normalized.expr || undefined,
    steps: Array.isArray(node.steps) ? node.steps.map(String) : [],
    labels,
    revision: typeof node.revision === "string" ? node.revision : undefined,
    valueYaml: parsedValue.value,
    valueYamlList: parsedValue.values,
    parameters: normalized.parameters,
    tolerance: normalized.tolerance,
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
