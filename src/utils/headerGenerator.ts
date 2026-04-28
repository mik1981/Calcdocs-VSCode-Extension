import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { OutlineFormula } from '../formulaOutline/formulaParser';
import { parseFormulaDocument } from '../formulaOutline/formulaParser';
import type { CalcDocsState } from '../core/state';
import {
  buildFormulaSymbolTable,
  resolveFormulaValue,
  scaleValueToUnit,
  formatGhostNumber,
} from '../formulaOutline/formulaEvaluator';
import { createCsvLookupResolver } from '../engine/csvLookup';

// ─── helpers ────────────────────────────────────────────────────────────────

const RESERVED = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs',
  'min', 'max', 'pow', 'floor', 'ceil', 'round', 'log', 'log10', 'exp',
  'pi', 'e', 'deg2rad', 'rad2deg', 'csv', 'table', 'lookup',
  'uint8_t', 'uint16_t', 'uint32_t', 'int8_t', 'int16_t', 'int32_t',
  'float', 'double', 'bool',
]);

const CSV_CALL_RX = /\bcsv\s*\(/i;
const UNIT_EMBEDDED_RX = /\d+(\.\d+)?\s+[a-zA-Z]+\b/;

/**
 * Collect unknown symbol tokens from an expression (tokens not in knownValues
 * and not in RESERVED). Used to decide whether to emit a parametric macro.
 */
function extractUnknownParams(
  expr: string,
  knownValues: Map<string, unknown>,
): string[] {
  const tokens: string[] = [];
  const rx = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(expr)) !== null) {
    const t = m[1];
    if (!RESERVED.has(t.toLowerCase()) && !knownValues.has(t)) {
      tokens.push(t);
    }
  }
  return [...new Set(tokens)];
}

// ─── workspace discovery ────────────────────────────────────────────────────

/**
 * Recursively find all files matching formula*.yaml in a directory tree,
 * skipping common noise folders.
 */
async function findFormulaYamlFilesInDir(dir: string): Promise<string[]> {
  const SKIP = new Set(['.git', 'node_modules', 'out', 'dist', 'build']);
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true }) as import('fs').Dirent[];
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const full = path.join(current, name);
      if (entry.isDirectory()) {
        if (!SKIP.has(name.toLowerCase())) {
          await walk(full);
        }
      } else if (entry.isFile() && /^formulas?.*\.ya?ml$/i.test(name)) {
        results.push(full);
      }
    }
  }

  await walk(dir);
  return results;
}

// ─── section builder ────────────────────────────────────────────────────────

function buildSection(
  formulas: OutlineFormula[],
  sourceLabel: string,
  cSymbols: Map<string, number>,
  lookupResolver: ReturnType<typeof createCsvLookupResolver>,
): string {
  const symbolTable = buildFormulaSymbolTable(formulas, cSymbols, lookupResolver);

  // knownValues merges both sources for unknown-param detection
  const knownValues = new Map<string, unknown>([
    ...cSymbols,
    ...symbolTable,
  ]);

  let section = `\n/* ============================================================\n`;
  section += ` * Source: ${sourceLabel}\n`;
  section += ` * ============================================================ */\n\n`;

  for (const f of formulas) {
    const idUpper = f.id.toUpperCase();
    const unitComment = f.unit ? `  /* [${f.unit}] */` : '';

    const evalResult = resolveFormulaValue(f, symbolTable, cSymbols, lookupResolver);
    const resolvedValue =
      evalResult.resolved !== null
        ? scaleValueToUnit(evalResult.resolved, f.unit)
        : f.value;

    // Pure constant (no expression)
    if (!f.expr) {
      if (resolvedValue !== undefined) {
        section += `/* Constant: ${f.id}${f.unit ? ` [${f.unit}]` : ''} */\n`;
        section += `#define ${idUpper.padEnd(40)} (${resolvedValue})${unitComment}\n\n`;
      }
      continue;
    }

    // CSV lookup — always emit numeric result if available
    if (CSV_CALL_RX.test(f.expr)) {
      if (resolvedValue !== undefined) {
        section += `/* Formula (csv lookup): ${f.id} = ${f.expr} */\n`;
        section += `#define ${idUpper.padEnd(40)} (${resolvedValue})${unitComment}\n\n`;
      } else {
        section += `/* WARNING: ${f.id} uses csv() but could not be resolved */\n`;
        section += `/* Formula: ${f.expr} */\n\n`;
      }
      continue;
    }

    // Expression with embedded unit literals (e.g. "24 V * 2 A")
    if (UNIT_EMBEDDED_RX.test(f.expr)) {
      if (resolvedValue !== undefined) {
        section += `/* Formula (unit-aware): ${f.id} = ${f.expr} */\n`;
        section += `#define ${idUpper.padEnd(40)} (${resolvedValue})${unitComment}\n\n`;
      } else {
        section += `/* WARNING: ${f.id} has embedded units but could not be resolved */\n`;
        section += `/* Original formula: ${f.expr} */\n\n`;
      }
      continue;
    }

    // Standard expression: try to expand with known symbols
    const unknownParams = extractUnknownParams(f.expr, knownValues);

    if (unknownParams.length === 0) {
      // Fully resolved — prefer numeric result, fall back to expression
      const numericResult =
        resolvedValue !== undefined ? resolvedValue : f.expr;
      section += `/* Formula: ${f.id} = ${f.expr} */\n`;
      section += `#define ${idUpper.padEnd(40)} (${numericResult})${unitComment}\n\n`;
    } else {
      // Parametric macro
      const params = unknownParams.join(', ');
      section += `/* Formula: ${f.id} = ${f.expr} */\n`;
      section += `#define ${idUpper}(${params}) (${f.expr})${unitComment}\n\n`;
    }
  }

  return section;
}

// ─── public entry point ─────────────────────────────────────────────────────

/**
 * Generate a single `macro_generate.h` that contains one labelled section
 * per discovered `formulas*.yaml` file, ordered by relative path.
 */
export async function generateFormulaHeader(
  _formulasUnused: OutlineFormula[],   // kept for backward-compat signature, ignored
  outputPath: string,
  state: CalcDocsState,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage('CalcDocs: no workspace folder open.');
    return;
  }

  // 1. Discover all formula*.yaml files
  const yamlFiles = await findFormulaYamlFilesInDir(workspaceRoot);
  if (yamlFiles.length === 0) {
    vscode.window.showWarningMessage('CalcDocs: no formulas*.yaml files found.');
    return;
  }

  // 2. Build shared context from state
  const cSymbols = state.symbolValues;           // Map<string, number>
  const csvTables = state.csvTables;
  const lookupResolver = createCsvLookupResolver(csvTables);

  // 3. Assemble header
  const headerPath = path.isAbsolute(outputPath)
    ? outputPath
    : path.join(workspaceRoot, outputPath);

  let content = '// Auto-generated by CalcDocs — DO NOT EDIT MANUALLY\n';
  content += `// Generated: ${new Date().toISOString()}\n`;
  content += '#pragma once\n';

  for (const yamlFile of yamlFiles.sort()) {
    let rawText: string;
    try {
      rawText = await fs.readFile(yamlFile, 'utf8');
    } catch {
      continue;
    }

    const lines = rawText.split(/\r?\n/);
    const formulas = parseFormulaDocument(lines, yamlFile);
    if (formulas.length === 0) {
      continue;
    }

    const relLabel = path.relative(workspaceRoot, yamlFile).replace(/\\/g, '/');
    content += buildSection(formulas, relLabel, cSymbols, lookupResolver);
  }

  // 4. Write file
  await fs.mkdir(path.dirname(headerPath), { recursive: true });
  await fs.writeFile(headerPath, content, 'utf8');

  const relOut = path.relative(workspaceRoot, headerPath).replace(/\\/g, '/');
  vscode.window.showInformationMessage(
    `CalcDocs: generated ${relOut} from ${yamlFiles.length} formula file(s).`,
  );
}