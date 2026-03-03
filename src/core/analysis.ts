import * as fsp from "fs/promises";

import { collectDefinesAndConsts } from "./cppParser";
import { listFilesRecursive, findFormulaYamlFile } from "./files";
import {
  safeEval,
  replaceTokens,
  expandExpression,
  resolveSymbol,
  resolveInlineLookups,
  type EvaluationContext,
} from "./expression";
import { loadAdjacentCsvTables } from "./csvTables";
import { loadYaml, buildFormulaEntry, type LoadedYaml } from "./yamlParser";
import { getConfig, refreshIgnoredDirs } from "./config";
import { CalcDocsState } from "./state";
import { type FormulaLabel } from "../types/FormulaEntry";
import { clampLen } from "../utils/text";
import { TOKEN_RX } from "../utils/regex";

export type AnalysisResult = {
  hasFormulasFileChanged: boolean;
};

type WorkspaceScan = {
  files: string[];
  yamlPath?: string;
  hasFormulasFileChanged: boolean;
};

type YamlNodeEntries = Array<[string, Record<string, unknown>]>;
type CollectedCppSymbols = Awaited<ReturnType<typeof collectDefinesAndConsts>>;

const TABLE_LOOKUP_RX = /\b(?:csv|table|lookup)\s*\(/i;
const FUNC_CALL_RX = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/;
const OPERATOR_COUNT_RX = /[+\-*/%&|^~<>?:]/g;

/**
 * Main orchestration for workspace analysis.
 * It scans files, decides YAML vs C/C++ only mode, and populates shared state maps.
 */
export async function runAnalysis(state: CalcDocsState): Promise<AnalysisResult> {
  try {
    const workspaceScan = await scanWorkspace(state);

    if (!workspaceScan.yamlPath) {
      await runCppOnlyAnalysis(state, workspaceScan.files);
      return {
        hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
      };
    }

    const loadedYaml = await loadYamlOrReportError(state, workspaceScan.yamlPath);
    if (!loadedYaml) {
      return {
        hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
      };
    }

    await runYamlAnalysis(
      state,
      workspaceScan.files,
      workspaceScan.yamlPath,
      loadedYaml
    );

    return {
      hasFormulasFileChanged: workspaceScan.hasFormulasFileChanged,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    state.output.appendLine(`[Analysis error] ${message}`);

    return {
      hasFormulasFileChanged: false,
    };
  }
}

/**
 * Enumerates workspace files and updates formulas YAML presence state.
 * Example: toggles status bar visibility when formulas.yaml appears/disappears.
 */
async function scanWorkspace(state: CalcDocsState): Promise<WorkspaceScan> {
  const config = getConfig();
  refreshIgnoredDirs(state, config);

  const files = await listFilesRecursive(
    state.workspaceRoot,
    (dirName) => state.ignoredDirs.has(dirName)
  );

  const yamlPath = findFormulaYamlFile(files);
  const previousHasFormulasFile = state.hasFormulasFile;
  state.hasFormulasFile = Boolean(yamlPath);

  return {
    files,
    yamlPath,
    hasFormulasFileChanged: previousHasFormulasFile !== state.hasFormulasFile,
  };
}

/**
 * Fallback mode used when no formulas*.yaml is found.
 * Keeps C/C++ symbol values and locations available for hover/definition features.
 */
async function runCppOnlyAnalysis(
  state: CalcDocsState,
  files: string[]
): Promise<void> {
  if (files.length === 0) {
    return;
  }

  const cppSymbols = await collectDefinesAndConsts(files, state.workspaceRoot);
  applyCppSymbols(state, cppSymbols, {
    resetSymbolValues: true,
    applyConstsBeforeResolve: false,
    requireFiniteResolvedValues: true,
  });

  state.output.appendLine(
    `[CalcDocs] formulas*.yaml not found, C/C++ analysis completed (${state.symbolValues.size} values)`
  );
}

/**
 * Loads YAML and reports parser failures to extension output without throwing.
 */
async function loadYamlOrReportError(
  state: CalcDocsState,
  yamlPath: string
): Promise<LoadedYaml | null> {
  try {
    return await loadYaml(yamlPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    state.output.appendLine(`YAML error: ${message}`);
    return null;
  }
}

/**
 * Full analysis mode when formulas YAML exists.
 * Flow:
 * 1) seed known numeric YAML values
 * 2) merge and resolve C/C++ symbols
 * 3) rebuild searchable formula index with expanded expressions
 */
async function runYamlAnalysis(
  state: CalcDocsState,
  files: string[],
  yamlPath: string,
  loadedYaml: LoadedYaml
): Promise<void> {
  state.lastYamlPath = yamlPath;
  state.lastYamlRaw = loadedYaml.rawText;

  const yamlNodes = getYamlNodeEntries(loadedYaml.parsed);
  seedSymbolValuesFromYaml(state, yamlNodes);

  const cppSymbols = await collectDefinesAndConsts(files, state.workspaceRoot);
  applyCppSymbols(state, cppSymbols, {
    resetSymbolValues: false,
    applyConstsBeforeResolve: true,
    requireFiniteResolvedValues: false,
  });

  const csvTables = await loadAdjacentCsvTables(yamlPath);
  rebuildFormulaIndex(
    state,
    yamlNodes,
    loadedYaml.rawText,
    yamlPath,
    state.allDefines,
    {
      csvTables,
    }
  );

  state.output.appendLine(
    `[${new Date().toLocaleTimeString()}] Analysis ok (${state.formulaIndex.size} formulas)`
  );
}

/**
 * Filters root YAML object down to top-level object nodes only.
 * Example: ignores scalar keys like "version: 1" and keeps blocks like "PRESSURE_DROP:".
 */
function getYamlNodeEntries(yamlRoot: Record<string, unknown>): YamlNodeEntries {
  const entries: YamlNodeEntries = [];

  for (const [key, value] of Object.entries(yamlRoot)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    entries.push([key, value as Record<string, unknown>]);
  }

  return entries;
}

/**
 * Initializes symbol values from YAML "value" fields.
 * Example: { PRESSURE_DROP: { value: 25 } } -> symbolValues.set("PRESSURE_DROP", 25)
 */
function seedSymbolValuesFromYaml(
  state: CalcDocsState,
  yamlNodes: YamlNodeEntries
): void {
  state.symbolValues.clear();

  for (const [key, node] of yamlNodes) {
    if (!("value" in node)) {
      continue;
    }

    const numericValue = Number(node.value);
    if (Number.isFinite(numericValue)) {
      state.symbolValues.set(key, numericValue);
    }
  }
}

/**
 * Merges defines/consts from C/C++ into state and resolves derived symbols.
 * Options control merge order depending on current analysis mode.
 */
function applyCppSymbols(
  state: CalcDocsState,
  cppSymbols: CollectedCppSymbols,
  options: {
    resetSymbolValues: boolean;
    applyConstsBeforeResolve: boolean;
    requireFiniteResolvedValues: boolean;
  }
): void {
  state.allDefines.clear();
  state.symbolDefs.clear();
  state.symbolConditionalDefs.clear();
  state.symbolAmbiguityRoots.clear();

  if (options.resetSymbolValues) {
    state.symbolValues.clear();
  }

  for (const [name, expr] of cppSymbols.defines) {
    state.allDefines.set(name, expr);

    try {
      const numericValue = safeEval(expr);
      state.symbolValues.set(name, numericValue);
    } catch {
      // Keep unresolved definitions for recursive expansion.
    }
  }

  if (options.applyConstsBeforeResolve) {
    mergeConstValues(state, cppSymbols.consts);
  }

  resolveRemainingDefines(state, options.requireFiniteResolvedValues);

  if (!options.applyConstsBeforeResolve) {
    mergeConstValues(state, cppSymbols.consts);
  }

  for (const [name, location] of cppSymbols.locations) {
    state.symbolDefs.set(name, location);
  }

  updateConditionalDefinitionInfo(state, cppSymbols.defineVariants);
  removeAmbiguousSymbolsFromEvaluationState(state);
}

/**
 * Copies parsed C/C++ const numeric values into symbolValues.
 */
function mergeConstValues(
  state: CalcDocsState,
  consts: Map<string, number>
): void {
  for (const [name, value] of consts) {
    state.symbolValues.set(name, value);
  }
}

/**
 * Attempts recursive evaluation for unresolved #define symbols.
 * Example: if A=10 and B=(A*2), this fills B=20.
 */
function resolveRemainingDefines(
  state: CalcDocsState,
  requireFiniteResolvedValues: boolean
): void {
  for (const name of state.allDefines.keys()) {
    if (state.symbolValues.has(name)) {
      continue;
    }

    const resolvedValue = resolveSymbol(
      name,
      state.allDefines,
      new Map<string, number>(),
      state.symbolValues
    );

    const isResolvedNumber =
      typeof resolvedValue === "number" &&
      (!requireFiniteResolvedValues || Number.isFinite(resolvedValue));

    if (isResolvedNumber) {
      state.symbolValues.set(name, resolvedValue);
    }
  }
}

/**
 * Persists every parsed conditional definition and propagates ambiguity to dependent symbols.
 * Example: if N has 2 #define variants and M uses N, both N and M are marked as ambiguous.
 */
function updateConditionalDefinitionInfo(
  state: CalcDocsState,
  defineVariants: CollectedCppSymbols["defineVariants"]
): void {
  for (const [name, variants] of defineVariants) {
    state.symbolConditionalDefs.set(
      name,
      variants.map((variant) => ({ ...variant }))
    );
  }

  const ambiguousRoots = Array.from(defineVariants.entries())
    .filter(([, variants]) => variants.length > 1)
    .map(([name]) => name);

  if (ambiguousRoots.length === 0) {
    return;
  }

  const reverseDependencies = buildReverseDefineDependencies(defineVariants);
  const inheritedAmbiguities = new Map<string, Set<string>>();

  for (const root of ambiguousRoots) {
    const rootSet = inheritedAmbiguities.get(root) ?? new Set<string>();
    rootSet.add(root);
    inheritedAmbiguities.set(root, rootSet);

    const visited = new Set<string>([root]);
    const queue = Array.from(reverseDependencies.get(root) ?? []);

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);

      const currentSet = inheritedAmbiguities.get(current) ?? new Set<string>();
      currentSet.add(root);
      inheritedAmbiguities.set(current, currentSet);

      for (const next of reverseDependencies.get(current) ?? []) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  for (const [name, roots] of inheritedAmbiguities) {
    state.symbolAmbiguityRoots.set(name, Array.from(roots).sort());
  }
}

/**
 * Keeps ambiguous symbols available for navigation, but excludes them from numeric evaluation.
 */
function removeAmbiguousSymbolsFromEvaluationState(state: CalcDocsState): void {
  for (const name of state.symbolAmbiguityRoots.keys()) {
    state.symbolValues.delete(name);
    state.allDefines.delete(name);
  }
}

function buildReverseDefineDependencies(
  defineVariants: CollectedCppSymbols["defineVariants"]
): Map<string, Set<string>> {
  const reverse = new Map<string, Set<string>>();

  for (const [name, variants] of defineVariants) {
    const dependencies = new Set<string>();

    for (const variant of variants) {
      for (const token of variant.expr.match(TOKEN_RX) ?? []) {
        if (token !== name) {
          dependencies.add(token);
        }
      }
    }

    for (const dependency of dependencies) {
      const dependents = reverse.get(dependency) ?? new Set<string>();
      dependents.add(name);
      reverse.set(dependency, dependents);
    }
  }

  return reverse;
}

/**
 * Rebuilds formula index entries enriched with expanded expression and computed value.
 * Example: "RHO * V * V / 2" -> "1.2 * 10 * 10 / 2" -> 60.
 */
function rebuildFormulaIndex(
  state: CalcDocsState,
  yamlNodes: YamlNodeEntries,
  yamlRaw: string,
  yamlPath: string,
  defines: Map<string, string>,
  evalContext: EvaluationContext
): void {
  state.formulaIndex.clear();

  for (const [key, node] of yamlNodes) {
    const entry = buildFormulaEntry(
      key,
      node,
      yamlRaw,
      yamlPath,
      state.workspaceRoot
    );

    if (entry.formula) {
      entry.labels = mergeEntryLabels(entry.formula, entry.labels);
      const ambiguousSymbols = getAmbiguousFormulaSymbols(entry.formula, state);
      if (ambiguousSymbols.length === 0) {
        const resolvedMap = new Map<string, number>();
        const replaced = replaceTokens(entry.formula, state.symbolValues);
        const expanded = expandExpression(
          replaced,
          defines,
          resolvedMap,
          state.symbolValues,
          evalContext
        );
        const expandedWithLookups = resolveInlineLookups(expanded, evalContext);

        entry.expanded = clampLen(expandedWithLookups);

        try {
          entry.valueCalc = safeEval(expandedWithLookups, evalContext);
        } catch {
          // Leave valueCalc as null when expression is not numeric.
        }
      }
    }

    state.formulaIndex.set(key, entry);
  }
}

function getAmbiguousFormulaSymbols(
  formula: string,
  state: CalcDocsState
): string[] {
  const ambiguous = new Set<string>();

  for (const token of formula.match(TOKEN_RX) ?? []) {
    if (state.symbolAmbiguityRoots.has(token)) {
      ambiguous.add(token);
    }
  }

  return Array.from(ambiguous);
}

function mergeEntryLabels(
  formula: string,
  existingLabels: FormulaLabel[]
): FormulaLabel[] {
  const merged = new Set<FormulaLabel>(existingLabels);

  if (TABLE_LOOKUP_RX.test(formula)) {
    merged.add("table_lookup");
  }

  if (isComplexFormulaExpression(formula)) {
    merged.add("complex_expression");
  }

  return Array.from(merged);
}

function isComplexFormulaExpression(formula: string): boolean {
  if (TABLE_LOOKUP_RX.test(formula)) {
    return true;
  }

  if (FUNC_CALL_RX.test(formula)) {
    return true;
  }

  const operatorCount = formula.match(OPERATOR_COUNT_RX)?.length ?? 0;
  return operatorCount >= 2;
}

/**
 * Writes expanded expression ("dati") and computed value back into YAML text blocks.
 * Existing fields are updated, missing fields are inserted near the formula block.
 */
export async function writeBackYaml(
  state: CalcDocsState,
  yamlPath: string,
  rawText: string
): Promise<void> {
  const lines = rawText.split(/\r?\n/);

  const valueRegex = /^\s*value\s*:/i;
  const datiRegex = /^\s*dati\s*:/i;
  const formulaRegex = /^\s*formula\s*:/i;

  for (const entry of state.formulaIndex.values()) {
    const lineIndex = entry._line ?? -1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      continue;
    }

    const keyLine = lines[lineIndex];
    const keyIndent = keyLine.match(/^\s*/)?.[0] ?? "";
    const fieldIndent = `${keyIndent}  `;

    let pointer = lineIndex + 1;
    let valueLineIndex = -1;
    let datiLineIndex = -1;

    while (pointer < lines.length) {
      const currentLine = lines[pointer];
      const trimmed = currentLine.trim();
      const isEmpty = trimmed.length === 0;
      const isIndented = /^\s+/.test(currentLine);

      if (!isEmpty && !isIndented) {
        break;
      }

      if (valueRegex.test(currentLine)) {
        valueLineIndex = pointer;
      } else if (datiRegex.test(currentLine)) {
        datiLineIndex = pointer;
      }

      pointer += 1;
    }

    const blockStart = lineIndex + 1;
    const blockEnd = pointer;

    if (entry.expanded) {
      const newDatiLine = `${fieldIndent}dati: ${entry.expanded}`;

      if (datiLineIndex >= 0) {
        lines[datiLineIndex] = newDatiLine;
      } else {
        let formulaLineIndex = -1;
        for (let i = blockStart; i < blockEnd; i += 1) {
          if (formulaRegex.test(lines[i])) {
            formulaLineIndex = i;
            break;
          }
        }

        const insertIndex = formulaLineIndex >= 0 ? formulaLineIndex : blockStart;
        lines.splice(insertIndex, 0, newDatiLine);

        if (valueLineIndex >= 0 && valueLineIndex >= insertIndex) {
          valueLineIndex += 1;
        }
      }
    }

    if (entry.valueCalc != null) {
      const newValueLine = `${fieldIndent}value: ${entry.valueCalc}`;

      if (valueLineIndex < 0) {
        for (let i = blockStart; i < blockEnd; i += 1) {
          if (valueRegex.test(lines[i])) {
            valueLineIndex = i;
            break;
          }
        }
      }

      if (valueLineIndex >= 0) {
        lines[valueLineIndex] = newValueLine;
      } else {
        const insertIndex = datiLineIndex >= 0 ? datiLineIndex + 1 : blockStart;
        lines.splice(insertIndex, 0, newValueLine);
      }
    }
  }

  const updatedText = lines.join("\n");

  if (updatedText === rawText) {
    state.output.appendLine(`No YAML updates needed: ${yamlPath}`);
    return;
  }

  await fsp.writeFile(yamlPath, updatedText, "utf8");
  state.lastYamlRaw = updatedText;
  state.output.appendLine(`Updated YAML: ${yamlPath}`);
}
