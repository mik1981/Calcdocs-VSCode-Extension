import * as fsp from "fs/promises";
import * as path from "path";

import { DEFINE_RX, CONST_RX, SRC_EXTS } from "../utils/regex";
import { stripComments } from "../utils/text";
import { safeEval } from "./expression";
import {
  SymbolConditionalDefinition,
  SymbolDefinitionLocation,
} from "./state";

export type CppSymbolDefinition = {
  name: string;
  expr: string;
};

export type CollectedCppSymbols = {
  defines: Map<string, string>;
  defineVariants: Map<string, SymbolConditionalDefinition[]>;
  consts: Map<string, number>;
  locations: Map<string, SymbolDefinitionLocation>;
};

type ConditionalFrame = {
  parentCondition: string | null;
  branchConditions: string[];
  activeCondition: string;
};

const IFDEF_RX = /^\s*#\s*ifdef\s+([A-Za-z_]\w*)\b/;
const IFNDEF_RX = /^\s*#\s*ifndef\s+([A-Za-z_]\w*)\b/;
const IF_RX = /^\s*#\s*if\b(.+)$/;
const ELIF_RX = /^\s*#\s*elif\b(.+)$/;
const ELSE_RX = /^\s*#\s*else\b/;
const ENDIF_RX = /^\s*#\s*endif\b/;

function normalizeDirectiveCondition(raw: string): string {
  const cleaned = stripComments(raw).trim();
  return cleaned.length > 0 ? cleaned : "1";
}

function combineConditions(parent: string | null, branch: string): string {
  const normalizedBranch = branch.trim() || "1";

  if (!parent || parent === "1") {
    return normalizedBranch;
  }

  if (normalizedBranch === "1") {
    return parent;
  }

  return `(${parent}) && (${normalizedBranch})`;
}

function negateCondition(condition: string): string {
  const trimmed = condition.trim();
  if (!trimmed) {
    return "1";
  }

  if (trimmed === "1") {
    return "0";
  }

  const definedMatch = trimmed.match(/^defined\(\s*([A-Za-z_]\w*)\s*\)$/);
  if (definedMatch) {
    return `!defined(${definedMatch[1]})`;
  }

  const notDefinedMatch = trimmed.match(/^!defined\(\s*([A-Za-z_]\w*)\s*\)$/);
  if (notDefinedMatch) {
    return `defined(${notDefinedMatch[1]})`;
  }

  if (trimmed.startsWith("!(") && trimmed.endsWith(")")) {
    const inner = trimmed.slice(2, -1).trim();
    if (inner.length > 0) {
      return inner;
    }
  }

  return `!(${trimmed})`;
}

function buildElseCondition(branchConditions: string[]): string {
  if (branchConditions.length === 0) {
    return "1";
  }

  return branchConditions.map((condition) => negateCondition(condition)).join(" && ");
}

/**
 * Parses one C/C++ line and extracts either:
 * - "#define NAME EXPR"
 * - "const TYPE NAME = EXPR;"
 * Returns undefined for non-matching lines.
 */
export function parseCppSymbolDefinition(
  line: string
): CppSymbolDefinition | undefined {
  const defineMatch = line.match(/^\s*#define\s+([A-Za-z_]\w*)\s+(.+)$/);
  if (defineMatch) {
    return {
      name: defineMatch[1],
      expr: defineMatch[2],
    };
  }

  const constMatch = line.match(
    /^\s*(?:static\s+)?const\s+[A-Za-z0-9_]+\s+([A-Za-z_]\w*)\s*=\s*(.+);/
  );

  if (constMatch) {
    return {
      name: constMatch[1],
      expr: constMatch[2],
    };
  }

  return undefined;
}

/**
 * Scans source files and collects:
 * - raw #define expressions
 * - numeric const values
 * - source locations for navigation
 *
 * Example:
 * "#define K 3" -> defines["K"]="3"
 * "const int V = 10;" -> consts["V"]=10
 */
export async function collectDefinesAndConsts(
  files: string[],
  workspaceRoot: string
): Promise<CollectedCppSymbols> {
  const defines = new Map<string, string>();
  const defineVariants = new Map<string, SymbolConditionalDefinition[]>();
  const consts = new Map<string, number>();
  const locations = new Map<string, SymbolDefinitionLocation>();

  for (const file of files) {
    if (!SRC_EXTS.has(path.extname(file).toLowerCase())) {
      continue;
    }

    let text = "";
    try {
      text = await fsp.readFile(file, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    const conditionalStack: ConditionalFrame[] = [];
    let currentCondition: string | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const directiveLine = stripComments(line).trim();

      const ifdefMatch = directiveLine.match(IFDEF_RX);
      if (ifdefMatch) {
        const branchCondition = `defined(${ifdefMatch[1]})`;
        const activeCondition = combineConditions(currentCondition, branchCondition);

        conditionalStack.push({
          parentCondition: currentCondition,
          branchConditions: [branchCondition],
          activeCondition,
        });

        currentCondition = activeCondition;
        continue;
      }

      const ifndefMatch = directiveLine.match(IFNDEF_RX);
      if (ifndefMatch) {
        const branchCondition = `!defined(${ifndefMatch[1]})`;
        const activeCondition = combineConditions(currentCondition, branchCondition);

        conditionalStack.push({
          parentCondition: currentCondition,
          branchConditions: [branchCondition],
          activeCondition,
        });

        currentCondition = activeCondition;
        continue;
      }

      const ifMatch = directiveLine.match(IF_RX);
      if (ifMatch) {
        const branchCondition = normalizeDirectiveCondition(ifMatch[1]);
        const activeCondition = combineConditions(currentCondition, branchCondition);

        conditionalStack.push({
          parentCondition: currentCondition,
          branchConditions: [branchCondition],
          activeCondition,
        });

        currentCondition = activeCondition;
        continue;
      }

      const elifMatch = directiveLine.match(ELIF_RX);
      if (elifMatch && conditionalStack.length > 0) {
        const frame = conditionalStack[conditionalStack.length - 1];
        const branchCondition = normalizeDirectiveCondition(elifMatch[1]);
        const previousBranchExclusion = buildElseCondition(frame.branchConditions);
        const localCondition =
          previousBranchExclusion === "1"
            ? branchCondition
            : `(${previousBranchExclusion}) && (${branchCondition})`;

        frame.branchConditions.push(branchCondition);
        frame.activeCondition = combineConditions(frame.parentCondition, localCondition);
        currentCondition = frame.activeCondition;
        continue;
      }

      if (ELSE_RX.test(directiveLine) && conditionalStack.length > 0) {
        const frame = conditionalStack[conditionalStack.length - 1];
        const elseCondition = buildElseCondition(frame.branchConditions);

        frame.activeCondition = combineConditions(frame.parentCondition, elseCondition);
        currentCondition = frame.activeCondition;
        continue;
      }

      if (ENDIF_RX.test(directiveLine) && conditionalStack.length > 0) {
        const frame = conditionalStack.pop();
        currentCondition = frame?.parentCondition ?? null;
        continue;
      }

      const defineMatch = line.match(DEFINE_RX);
      if (!defineMatch) {
        continue;
      }

      const name = defineMatch[1];
      const expr = stripComments(defineMatch[2]);

      if (name.includes("(")) {
        continue;
      }

      if (!defines.has(name)) {
        defines.set(name, expr);
      }

      const location: SymbolDefinitionLocation = {
        file: path.relative(workspaceRoot, file),
        line: i,
      };

      if (!locations.has(name)) {
        locations.set(name, location);
      }

      const variants = defineVariants.get(name) ?? [];
      variants.push({
        ...location,
        expr,
        condition:
          currentCondition && currentCondition !== "1" ? currentCondition : "always",
      });
      defineVariants.set(name, variants);
    }

    for (const match of text.matchAll(CONST_RX)) {
      const name = match[1];
      const expr = stripComments(match[2]);

      try {
        const value = safeEval(expr);

        if (consts.has(name)) {
          continue;
        }

        consts.set(name, value);

        const line = lines.findIndex((candidate) => candidate.includes(name));
        if (!locations.has(name)) {
          locations.set(name, {
            file: path.relative(workspaceRoot, file),
            line: Math.max(0, line),
          });
        }
      } catch {
        // Ignore const declarations that are not fully numeric.
      }
    }
  }

  return {
    defines,
    defineVariants,
    consts,
    locations,
  };
}
