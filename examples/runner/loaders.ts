import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

/**
 * Load YAML file if exists (formulas.yaml, expected.yaml, ecc.)
 */
export function loadYamlIfExists(caseDir: string, fileName = "formulas.yaml"): any {
  const filePath = path.join(caseDir, fileName);

  if (!fs.existsSync(filePath)) {
    console.log(`  ❌ YAML ${filePath} unexist`);
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return yaml.load(raw) ?? {};
  } catch (err) {
    console.error(`❌ YAML parse error: ${filePath}`);
    throw err;
  }
}

/**
 * Load CSV files in a case directory (simple registry-based loader)
 */
export function loadCsvIfExists(caseDir: string): Record<string, any[]> {
  const result: Record<string, any[]> = {};

  if (!fs.existsSync(caseDir)) {
    return result;
  }

  const files = fs.readdirSync(caseDir)
    .filter(f => f.endsWith(".csv"));

  for (const file of files) {
    const filePath = path.join(caseDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    result[file] = parseCsv(content);
  }

  return result;
}

/**
 * Minimal CSV parser (no dependency, CI-safe)
 */
function parseCsv(content: string): any[] {
  const lines = content
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",");

  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");

    const row: Record<string, any> = {};

    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx]?.trim();
    });

    rows.push(row);
  }

  return rows;
}