import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// ============================================================
// IMPORT YOUR ENGINE
// ============================================================

import { evaluateExpression, EvaluationContext } from "../../src/engine";
import { createEvaluationContext } from "../../src/engine/createEvaluationContext";
import { loadYamlIfExists, loadCsvIfExists } from "./loaders";

// ============================================================
// CONFIG
// ============================================================

const CASES_DIR = path.resolve(__dirname, "../cases");

// ============================================================
// HELPERS
// ============================================================

function readYaml(filePath: string): any {
  if (!fs.existsSync(filePath)) {
    console.log(`  ❌ YAML ${filePath} unexist`);
    return {};
  }
  return yaml.load(fs.readFileSync(filePath, "utf8")) as any;
}

function loadText(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function unwrap(v: any) {
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}

// ============================================================
// CONTEXT BUILDING (CRITICAL PART)
// ============================================================

function buildContext(caseDir: string): EvaluationContext {

  const yamlData = loadYamlIfExists(caseDir, "formulas.yaml");
  const csvData = loadCsvIfExists(caseDir);

  return {
    resolveIdentifier: (name: string) => {
      console.log("🔍 resolveIdentifier CALLED WITH:", name);

      // 1. YAML variables (@vin, @curr, etc.)
      if (yamlData[name] !== undefined) {
        const v = yamlData[name];

        // supporto sia:
        // value: 10
        // oppure valore diretto
        if (typeof v === "object" && "value" in v) {
          return { value: v.value } as any;
        }

        return { value: v } as any;
      }

      // 2. fallback (se hai macro system esterno)
      return undefined;
    },

    resolveLookup: (fn: string, args: any[]) => {

      // CSV lookup
      if (fn === "csv") {
        const [file, key, colKey, colVal] = args;

        const table = csvData[file];
        if (!table) return 0;

        const row = table.find((r: any) => r[colKey] == key);
        return row ? Number(row[colVal]) : 0;
      }

      return 0;
    }
  };
}

// ============================================================
// GET INPUT FILE
// ============================================================

function getInputFile(caseDir: string): string {
  const input = path.join(caseDir, "input.c");
  const test = path.join(caseDir, "test.c");

  if (fs.existsSync(input)) return input;
  if (fs.existsSync(test)) return test;

  throw new Error(`No input file in ${caseDir}`);
}

// ============================================================
// RUN SINGLE CASE
// ============================================================

function runCase(caseDir: string): number {
  const caseName = path.basename(caseDir);

  const file = getInputFile(caseDir);
  const code = loadText(file);

  const expected = readYaml(path.join(caseDir, "expected.yaml"));
  // const context = createEvaluationContext(caseDir);//
  // const context = buildContext(caseDir);

  console.log(`\n📦 ${caseName}`);

  let failed = 0;

  let result: any;

  try {
    // result = evaluateExpression(code, context);
    const engineContext = createEvaluationContext(caseDir);
    result = evaluateExpression(code, engineContext);
  } catch (err: any) {
    console.log(`❌ CRASH in engine: ${err.message}`);
    return 1;
  }

  const symbols = result?.symbols ?? {};

  for (const testId of Object.keys(expected)) {
    const expectedValue = expected[testId]?.value;
    const gotValue = unwrap(symbols[testId]);

    const ok = gotValue === expectedValue;

    if (ok) {
      console.log(`  ✅ ${testId} = ${gotValue}`);
    } else {
      console.log(`  ❌ ${testId}`);
      console.log(`     expected: ${expectedValue}`);
      console.log(`     got:      ${gotValue}`);
      failed++;
    }
  }

  return failed;
}

// ============================================================
// RUN ALL CASES
// ============================================================

function runAll(): void {
  const cases = fs.readdirSync(CASES_DIR)
    .map(name => path.join(CASES_DIR, name))
    .filter(p => fs.statSync(p).isDirectory());

  let totalFailed = 0;

  for (const c of cases) {
    totalFailed += runCase(c);
  }

  console.log("\n==============================");
  console.log("📊 CALCDOCS TEST SUMMARY");
  console.log("==============================");
  console.log(totalFailed === 0
    ? "✅ ALL TESTS PASSED"
    : `❌ FAILED TESTS: ${totalFailed}`
  );

  process.exit(totalFailed > 0 ? 1 : 0);
}

// ============================================================
// ENTRYPOINT
// ============================================================

runAll();