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
  absolutePath: string,
  table: CsvTable
): void {
  const normalized = normalizeCsvTableKey(absolutePath);
  const fileName = path.basename(absolutePath);
  const normalizedName = normalizeCsvTableKey(fileName);
  
  const withoutExt = normalized.endsWith(".csv")
    ? normalized.slice(0, -4)
    : normalized;
  
  const nameWithoutExt = normalizedName.endsWith(".csv")
    ? normalizedName.slice(0, -4)
    : normalizedName;

  // Primary key: absolute path
  tables.set(normalized, table);
  tables.set(withoutExt, table);
  
  // Fallback keys: just the filename (backward compatibility if not ambiguous)
  if (!tables.has(normalizedName)) {
    tables.set(normalizedName, table);
  }
  if (!tables.has(nameWithoutExt)) {
    tables.set(nameWithoutExt, table);
  }
}

/**
 * Loads CSV files in the same directory as formulas YAML.
 * Keys support file name with and without ".csv" extension.
 */
export async function loadAdjacentCsvTables(
  yamlPath: string
): Promise<CsvTableMap> {
  console.groupCollapsed(`[CalcDocs-CSV] 🔍 Loading tables near: ${yamlPath}`);
  
  const tables: CsvTableMap = new Map<string, CsvTable>();
  const yamlDirectory = path.dirname(yamlPath);

  let entries: Dirent[];
  try {
    entries = (await fsp.readdir(yamlDirectory, {
      withFileTypes: true,
    })) as Dirent[];
    
    console.log(`📁 Found ${entries.length} entries`);
  } catch (err) {
    console.log(`❌ Cannot read directory: ${yamlDirectory}`);
    console.groupEnd();
    return tables;
  }

  let csvCount = 0;
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const name = String(entry.name);
    if (!name.toLowerCase().endsWith(".csv")) {
      continue;
    }
    csvCount++;

    const absolutePath = path.join(yamlDirectory, name);
    console.log(`📄 Processing: ${name}`);

    let csvText = "";
    try {
      csvText = await fsp.readFile(absolutePath, "utf8");
    } catch (err) {
      console.log(`  ❌ Read error: ${err}`);
      continue;
    }

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsvRows(csvText, delimiter);
    if (rows.length === 0) {
      console.log(`  ❌ Empty after parse`);
      continue;
    }

    const table: CsvTable = {
      fileName: name,
      rows,
      headerIndex: buildHeaderIndex(rows),
    };

    registerCsvTable(tables, absolutePath, table);
    console.log(`  ✅ Loaded: ${rows.length-1} data rows`);
  }
  
  console.log(`📊 Total tables loaded: ${tables.size}`);
  console.groupEnd();
  return tables;
}

/**
 * Loads all CSV files from the provided file list.
 */
export async function loadWorkspaceCsvTables(
  csvFiles: string[]
): Promise<CsvTableMap> {
  console.groupCollapsed(`[CalcDocs-CSV] 🔍 Loading ${csvFiles.length} workspace tables`);
  
  const tables: CsvTableMap = new Map<string, CsvTable>();

  for (const absolutePath of csvFiles) {
    const name = path.basename(absolutePath);
    console.log(`📄 Processing: ${name} (${absolutePath})`);

    let csvText = "";
    try {
      csvText = await fsp.readFile(absolutePath, "utf8");
    } catch (err) {
      console.log(`  ❌ Read error: ${err}`);
      continue;
    }

    const delimiter = detectDelimiter(csvText);
    const rows = parseCsvRows(csvText, delimiter);
    if (rows.length === 0) {
      console.log(`  ❌ Empty after parse`);
      continue;
    }

    const table: CsvTable = {
      fileName: name,
      rows,
      headerIndex: buildHeaderIndex(rows),
    };

    registerCsvTable(tables, absolutePath, table);
    console.log(`  ✅ Loaded: ${rows.length-1} data rows`);
  }
  
  console.log(`📊 Total tables loaded: ${tables.size}`);
  console.groupEnd();
  return tables;
}
