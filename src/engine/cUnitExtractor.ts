import * as fsp from "fs/promises";
import * as path from "path";

export type ExtractedCUnit = {
  name: string;
  value?: number;
  unit: string;
  file: string;
  line: number;
};

export type CUnitExtractionResult = {
  units: Map<string, string>;
  values: Map<string, number>;
  entries: ExtractedCUnit[];
};

const C_FILE_RX = /\.(?:c|cc|cpp|h|hpp)$/i;
const DEFINE_WITH_COMMENT_RX =
  /^\s*#\s*define\s+([A-Za-z_]\w*)(?:\([^)]*\))?\s+(.+)$/;
const CONST_WITH_COMMENT_RX =
  /^\s*(?:static\s+)?(?:const\s+)?(?:volatile\s+)?(?:unsigned\s+|signed\s+)?(?:char|short|int|long|float|double|uint\d+_t|int\d+_t)\s+([A-Za-z_]\w*)\s*=\s*([-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;(.*)$/;

function extractCommentText(rawTail: string): string {
  const lineCommentIndex = rawTail.indexOf("//");
  if (lineCommentIndex >= 0) {
    return rawTail.slice(lineCommentIndex + 2).trim();
  }

  const blockCommentStart = rawTail.indexOf("/*");
  if (blockCommentStart >= 0) {
    const blockCommentEnd = rawTail.indexOf("*/", blockCommentStart + 2);
    if (blockCommentEnd >= 0) {
      return rawTail.slice(blockCommentStart + 2, blockCommentEnd).trim();
    }

    return rawTail.slice(blockCommentStart + 2).trim();
  }

  return "";
}

function extractUnitToken(comment: string): string | undefined {
  if (!comment) {
    return undefined;
  }

  // Priorità al tag esplicito @unit=
  const explicitMatch = comment.match(/@unit=([a-zA-Z0-9^*/_%-]+)/);
  if (explicitMatch) {
    return explicitMatch[1].trim();
  }

  // Fallback a ricerca tra parentesi quadre [unit]
  const bracketMatch = comment.match(/\[([a-zA-Z0-9^*/_%-]+)\]/);
  if (bracketMatch) {
    return bracketMatch[1].trim();
  }

  // Fallback a prima parola che sembra un'unità
  const compact = comment.trim();
  const match = compact.match(/^([A-Za-z%][A-Za-z0-9_%*/^.-]*)/);
  if (match) {
    return match[1].trim();
  }

  return undefined;
}

function parseNumeric(text: string): number | undefined {
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function stripInlineComments(rawText: string): string {
  const lineCommentIndex = rawText.indexOf("//");
  if (lineCommentIndex >= 0) {
    return rawText.slice(0, lineCommentIndex).trim();
  }

  const blockCommentIndex = rawText.indexOf("/*");
  if (blockCommentIndex >= 0) {
    return rawText.slice(0, blockCommentIndex).trim();
  }

  return rawText.trim();
}

function tryExtractEntry(
  lineText: string,
  fileRelativePath: string,
  lineNumber: number
): ExtractedCUnit | null {
  const defineMatch = lineText.match(DEFINE_WITH_COMMENT_RX);
  if (defineMatch) {
    const [, name, rawTail] = defineMatch;
    const unit = extractUnitToken(extractCommentText(rawTail));
    const value = parseNumeric(stripInlineComments(rawTail));
    if (!unit) {
      return null;
    }

    return {
      name,
      unit,
      value,
      file: fileRelativePath,
      line: lineNumber,
    };
  }

  const constMatch = lineText.match(CONST_WITH_COMMENT_RX);
  if (constMatch) {
    const [, name, rawValue, tail] = constMatch;
    const unit = extractUnitToken(extractCommentText(tail));
    const value = parseNumeric(rawValue);
    if (!unit) {
      return null;
    }

    return {
      name,
      unit,
      value,
      file: fileRelativePath,
      line: lineNumber,
    };
  }

  return null;
}

export async function extractUnitsFromCppFiles(
  files: string[],
  workspaceRoot: string
): Promise<CUnitExtractionResult> {
  const units = new Map<string, string>();
  const values = new Map<string, number>();
  const entries: ExtractedCUnit[] = [];

  const candidates = files.filter((filePath) => C_FILE_RX.test(filePath));

  for (const filePath of candidates) {
    let content = "";
    try {
      content = await fsp.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const relativePath = path.relative(workspaceRoot, filePath);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const extracted = tryExtractEntry(lines[i], relativePath, i);
      if (!extracted) {
        continue;
      }

      entries.push(extracted);

      if (!units.has(extracted.name)) {
        units.set(extracted.name, extracted.unit);
      }

      if (
        typeof extracted.value === "number" &&
        Number.isFinite(extracted.value) &&
        !values.has(extracted.name)
      ) {
        values.set(extracted.name, extracted.value);
      }
    }
  }

  return {
    units,
    values,
    entries,
  };
}
