import * as fsp from "fs/promises";
import * as path from "path";
import { Dirent } from "fs";

export type CsvTable = {
  fileName: string;
  rows: string[][];
  headerIndex: Map<string, number>;
};

export type CsvTableMap = Map<string, CsvTable>;

export function normalizeCsvTableKey(tableName: string): string {
  return tableName.trim().replace(/\\/g, "/").toLowerCase();
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(csvText: string): string {
  const firstLine =
    csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  const commaCount = countDelimiterOutsideQuotes(firstLine, ",");
  const semicolonCount = countDelimiterOutsideQuotes(firstLine, ";");

  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvRows(csvText: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        cell += '"';
        i += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      row.push(cell.trim());
      cell = "";

      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }

      row = [];

      if (char === "\r" && csvText[i + 1] === "\n") {
        i += 1;
      }

      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function buildHeaderIndex(rows: string[][]): Map<string, number> {
  const headerIndex = new Map<string, number>();
  const header = rows[0] ?? [];

  for (let i = 0; i < header.length; i += 1) {
    const normalizedHeader = header[i].trim().toLowerCase();
    if (!normalizedHeader || headerIndex.has(normalizedHeader)) {
      continue;
    }

    headerIndex.set(normalizedHeader, i);
  }

  return headerIndex;
}

function registerCsvTable(
  tables: CsvTableMap,
  fileName: string,
  table: CsvTable
): void {
  const normalized = normalizeCsvTableKey(fileName);
  const withoutExt = normalized.endsWith(".csv")
    ? normalized.slice(0, -4)
    : normalized;

  tables.set(normalized, table);
  tables.set(withoutExt, table);
}

/**
 * Loads CSV files in the same directory as formulas YAML.
 * Keys support file name with and without ".csv" extension.
 */
export async function loadAdjacentCsvTables(
  yamlPath: string
): Promise<CsvTableMap> {
  const tables: CsvTableMap = new Map<string, CsvTable>();
  const yamlDirectory = path.dirname(yamlPath);

  let entries: Dirent[];
  try {
    entries = (await fsp.readdir(yamlDirectory, {
      withFileTypes: true,
    })) as Dirent[];
  } catch {
    return tables;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const name = String(entry.name);
    if (!name.toLowerCase().endsWith(".csv")) {
      continue;
    }

    const absolutePath = path.join(yamlDirectory, name);

    let csvText = "";
    try {
      csvText = await fsp.readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsvRows(csvText, delimiter);
    if (rows.length === 0) {
      continue;
    }

    const table: CsvTable = {
      fileName: name,
      rows,
      headerIndex: buildHeaderIndex(rows),
    };

    registerCsvTable(tables, name, table);
  }

  return tables;
}
