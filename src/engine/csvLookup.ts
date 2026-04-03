import type { CsvTable, CsvTableMap } from "../core/csvTables";
import { normalizeCsvTableKey } from "../core/csvTables";

type CsvInterpolationMode = "none" | "linear" | "nearest";

function parseNumericCell(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const direct = Number(trimmed);
  if (Number.isFinite(direct)) {
    return direct;
  }

  if (trimmed.includes(",") && !trimmed.includes(".")) {
    const commaDecimal = Number(trimmed.replace(",", "."));
    if (Number.isFinite(commaDecimal)) {
      return commaDecimal;
    }
  }

  return null;
}

function resolveCsvTable(
  csvTables: CsvTableMap | undefined,
  tableName: string
): CsvTable | undefined {
  if (!csvTables) {
    return undefined;
  }

  const normalized = normalizeCsvTableKey(tableName);
  const normalizedWithoutExt = normalized.endsWith(".csv")
    ? normalized.slice(0, -4)
    : normalized;
  const slashIndex = normalized.lastIndexOf("/");
  const basename = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const basenameWithoutExt = basename.endsWith(".csv")
    ? basename.slice(0, -4)
    : basename;

  return (
    csvTables.get(normalized) ??
    csvTables.get(normalizedWithoutExt) ??
    csvTables.get(basename) ??
    csvTables.get(basenameWithoutExt)
  );
}

function parseInterpolationMode(rawMode: unknown): CsvInterpolationMode {
  if (rawMode == null) {
    return "none";
  }

  const normalized = String(rawMode).trim().toLowerCase();
  if (!normalized || normalized === "none" || normalized === "exact") {
    return "none";
  }
  if (normalized === "linear" || normalized === "lerp") {
    return "linear";
  }
  if (normalized === "nearest" || normalized === "closest") {
    return "nearest";
  }

  throw new Error(`unsupported interpolation mode '${rawMode}'`);
}

function resolveColumnIndex(table: CsvTable, reference: unknown): number | null {
  if (typeof reference === "number" && Number.isFinite(reference)) {
    return Math.trunc(reference);
  }

  const text = String(reference ?? "").trim();
  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  if (table.headerIndex.has(normalized)) {
    return table.headerIndex.get(normalized) ?? null;
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }

  return null;
}

type InterpolationPoint = {
  x: number;
  y: number;
};

function collectInterpolationPoints(
  table: CsvTable,
  lookupColumnIndex: number,
  valueColumnIndex: number
): InterpolationPoint[] {
  const points: InterpolationPoint[] = [];

  for (const row of table.rows) {
    const x = parseNumericCell(row[lookupColumnIndex] ?? "");
    const y = parseNumericCell(row[valueColumnIndex] ?? "");
    if (x == null || y == null) {
      continue;
    }

    points.push({ x, y });
  }

  points.sort((a, b) => a.x - b.x);
  return points;
}

function interpolateValue(
  target: number,
  points: InterpolationPoint[],
  mode: CsvInterpolationMode
): number | null {
  if (points.length === 0) {
    return null;
  }

  let lower: InterpolationPoint | null = null;
  let upper: InterpolationPoint | null = null;
  let nearest = points[0];
  let nearestDistance = Math.abs(points[0].x - target);

  for (const point of points) {
    if (point.x === target) {
      return point.y;
    }

    if (point.x < target && (!lower || point.x > lower.x)) {
      lower = point;
    }
    if (point.x > target && (!upper || point.x < upper.x)) {
      upper = point;
    }

    const distance = Math.abs(point.x - target);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  if (mode === "nearest") {
    return nearest.y;
  }

  if (!lower || !upper || upper.x === lower.x) {
    return null;
  }

  const ratio = (target - lower.x) / (upper.x - lower.x);
  return lower.y + ratio * (upper.y - lower.y);
}

function resolveRowByLookup(
  table: CsvTable,
  rowReference: unknown,
  lookupColumnIndex: number
): string[] | null {
  const rawLookup = String(rowReference ?? "").trim();
  if (!rawLookup) {
    return null;
  }

  const numericLookup = Number(rawLookup);
  const hasNumericLookup = Number.isFinite(numericLookup);

  for (let i = 1; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    const cell = String(row[lookupColumnIndex] ?? "").trim();
    if (!cell) {
      continue;
    }

    if (cell === rawLookup) {
      return row;
    }

    if (hasNumericLookup) {
      const numericCell = parseNumericCell(cell);
      if (numericCell != null && numericCell === numericLookup) {
        return row;
      }
    }
  }

  return null;
}

function resolveRowByIndex(table: CsvTable, rowReference: number): string[] | null {
  if (!Number.isFinite(rowReference)) {
    return null;
  }

  const rowIndex = Math.trunc(rowReference);
  if (rowIndex < 0) {
    return null;
  }

  const dataRows = table.rows.length > 1 ? table.rows.slice(1) : table.rows;
  return dataRows[rowIndex] ?? null;
}

export function createCsvLookupResolver(
  csvTables: CsvTableMap | undefined
): (functionName: string, args: Array<string | number>) => number {
  return (_functionName: string, args: Array<string | number>): number => {
    if (args.length < 2) {
      throw new Error("csv() requires at least table and row arguments");
    }

    const tableRef = args[0];
    if (typeof tableRef !== "string" || !tableRef.trim()) {
      throw new Error("csv() first argument must be a table name");
    }

    const table = resolveCsvTable(csvTables, tableRef);
    if (!table) {
      throw new Error(`csv table not found: ${tableRef}`);
    }

    let lookupColumnRef: unknown = 0;
    let valueColumnRef: unknown = args[2] ?? 1;
    let interpolationRef: unknown = args[3];
    let allowRowIndex = true;

    if (args.length >= 5) {
      allowRowIndex = false;
      lookupColumnRef = args[2];
      valueColumnRef = args[3];
      interpolationRef = args[4];
    } else if (args.length === 4) {
      const secondIsColumn = resolveColumnIndex(table, args[2]) != null;
      const thirdIsColumn = resolveColumnIndex(table, args[3]) != null;
      const thirdIsMode = (() => {
        try {
          parseInterpolationMode(args[3]);
          return true;
        } catch {
          return false;
        }
      })();

      if (secondIsColumn && thirdIsColumn) {
        allowRowIndex = false;
        lookupColumnRef = args[2];
        valueColumnRef = args[3];
        interpolationRef = undefined;
      } else if (secondIsColumn && thirdIsMode) {
        allowRowIndex = true;
        lookupColumnRef = 0;
        valueColumnRef = args[2];
        interpolationRef = args[3];
      } else {
        allowRowIndex = false;
        lookupColumnRef = args[2];
        valueColumnRef = args[3];
        interpolationRef = undefined;
      }
    } else {
      allowRowIndex = true;
      lookupColumnRef = 0;
      valueColumnRef = args[2] ?? 1;
      interpolationRef = undefined;
    }

    const interpolationMode = parseInterpolationMode(interpolationRef);
    const lookupColumnIndex = resolveColumnIndex(table, lookupColumnRef);
    const valueColumnIndex = resolveColumnIndex(table, valueColumnRef);

    if (lookupColumnIndex == null || lookupColumnIndex < 0) {
      throw new Error(`invalid csv lookup column '${String(lookupColumnRef)}'`);
    }
    if (valueColumnIndex == null || valueColumnIndex < 0) {
      throw new Error(`invalid csv value column '${String(valueColumnRef)}'`);
    }

    const rowRef = args[1];
    const numericRowRef =
      typeof rowRef === "number"
        ? rowRef
        : (() => {
            const parsed = Number(rowRef);
            return Number.isFinite(parsed) ? parsed : null;
          })();

    if (
      interpolationMode !== "none" &&
      numericRowRef != null &&
      Number.isFinite(numericRowRef)
    ) {
      const points = collectInterpolationPoints(
        table,
        lookupColumnIndex,
        valueColumnIndex
      );
      const interpolated = interpolateValue(numericRowRef, points, interpolationMode);
      if (interpolated != null) {
        return interpolated;
      }
    }

    const row =
      allowRowIndex && typeof rowRef === "number"
        ? resolveRowByIndex(table, rowRef)
        : resolveRowByLookup(table, rowRef, lookupColumnIndex);

    if (!row) {
      throw new Error(`csv row not found '${String(rowRef)}'`);
    }

    const cellValue = String(row[valueColumnIndex] ?? "").trim();
    const numeric = parseNumericCell(cellValue);
    if (numeric == null) {
      throw new Error(
        `csv value is not numeric for row '${String(rowRef)}', column '${String(valueColumnRef)}'`
      );
    }

    return numeric;
  };
}

