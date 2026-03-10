import * as fsp from "fs/promises";
import * as path from "path";

import { updateBraceDepth } from "../utils/braceDepth";
import { DEFINE_RX, SRC_EXTS } from "../utils/regex";
import { stripComments } from "../utils/text";
import { type FunctionMacroDefinition, safeEval } from "./expression";
import {
  SymbolConditionalDefinition,
  SymbolDefinitionLocation,
} from "./state";

export type CppSymbolDefinition = {
  name: string;
  expr: string;
  macroParams?: string[];
};

export type CollectedCppSymbols = {
  defines: Map<string, string>;
  defineConditions: Map<string, string>;
  functionDefines: Map<string, FunctionMacroDefinition>;
  defineVariants: Map<string, SymbolConditionalDefinition[]>;
  consts: Map<string, number>;
  locations: Map<string, SymbolDefinitionLocation>;
};

type ParsedDefineDirective = {
  name: string;
  expr: string;
  params?: string[];
};

type ParsedValueDeclaration = {
  name: string;
  expr: string;
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
const CONTROL_FLOW_KEYWORD_RX =
  /^(?:if|else|for|while|switch|case|return|goto|do)\b/;

function findNextMeaningfulLine(
  lines: string[],
  startIndex: number
): string | null {
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const candidate = stripComments(lines[i]).trim();
    if (!candidate) {
      continue;
    }

    return candidate;
  }

  return null;
}

function isTopLevelIncludeGuard(
  lines: string[],
  lineIndex: number,
  guardSymbol: string,
  conditionalStackDepth: number
): boolean {
  if (conditionalStackDepth !== 0) {
    return false;
  }

  const nextMeaningfulLine = findNextMeaningfulLine(lines, lineIndex);
  if (!nextMeaningfulLine) {
    return false;
  }

  const defineMatch = nextMeaningfulLine.match(
    /^\s*#\s*define\s+([A-Za-z_]\w*)\b/
  );

  return Boolean(defineMatch && defineMatch[1] === guardSymbol);
}

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

function parseDefineDirective(line: string): ParsedDefineDirective | undefined {
  const directiveMatch = line.match(DEFINE_RX);
  if (!directiveMatch) {
    return undefined;
  }

  const name = directiveMatch[1];
  const rawTail = directiveMatch[2] ?? "";

  // Function-like macros are recognized only when '(' immediately follows the name.
  if (rawTail.startsWith("(")) {
    let depth = 0;
    let closeIndex = -1;

    for (let i = 0; i < rawTail.length; i += 1) {
      const char = rawTail[i];
      if (char === "(") {
        depth += 1;
        continue;
      }

      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }

    if (closeIndex < 0) {
      return undefined;
    }

    const rawParams = rawTail.slice(1, closeIndex).trim();
    const params =
      rawParams.length === 0
        ? []
        : rawParams
            .split(",")
            .map((param) => param.trim())
            .filter((param) => param.length > 0);

    const expr = stripComments(rawTail.slice(closeIndex + 1));
    if (!expr) {
      return undefined;
    }

    return {
      name,
      expr,
      params,
    };
  }

  const expr = stripComments(rawTail);
  if (!expr) {
    return undefined;
  }

  return {
    name,
    expr,
  };
}

function findAssignmentOperatorIndex(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char !== "=") {
      continue;
    }

    const prev = i > 0 ? line[i - 1] : "";
    const next = i + 1 < line.length ? line[i + 1] : "";

    if (
      prev === "=" ||
      prev === "!" ||
      prev === "<" ||
      prev === ">" ||
      prev === "+" ||
      prev === "-" ||
      prev === "*" ||
      prev === "/" ||
      prev === "%" ||
      prev === "&" ||
      prev === "|" ||
      prev === "^" ||
      next === "="
    ) {
      continue;
    }

    return i;
  }

  return -1;
}

function parseValueDeclaration(line: string): ParsedValueDeclaration | undefined {
  const cleaned = stripComments(line).trim();
  if (!cleaned || cleaned.startsWith("#")) {
    return undefined;
  }

  const semicolonIndex = cleaned.lastIndexOf(";");
  if (semicolonIndex < 0) {
    return undefined;
  }

  const declaration = cleaned.slice(0, semicolonIndex).trim();
  if (!declaration) {
    return undefined;
  }

  const assignmentIndex = findAssignmentOperatorIndex(declaration);
  if (assignmentIndex <= 0) {
    return undefined;
  }

  const leftSide = declaration.slice(0, assignmentIndex).trim();
  const expr = declaration.slice(assignmentIndex + 1).trim();

  if (!leftSide || !expr || expr.startsWith("{")) {
    return undefined;
  }

  if (
    leftSide.includes("(") ||
    leftSide.includes(")") ||
    leftSide.includes("[") ||
    leftSide.includes("]") ||
    leftSide.includes("{") ||
    leftSide.includes("}") ||
    leftSide.includes("*") ||
    leftSide.includes("&")
  ) {
    return undefined;
  }

  const leftTokens = leftSide.split(/\s+/).filter((token) => token.length > 0);
  if (leftTokens.length < 2) {
    return undefined;
  }

  if (CONTROL_FLOW_KEYWORD_RX.test(leftTokens[0])) {
    return undefined;
  }

  const name = leftTokens[leftTokens.length - 1];
  if (!/^[A-Za-z_]\w*$/.test(name)) {
    return undefined;
  }

  if (/,\s*[A-Za-z_]\w*\s*=/.test(expr)) {
    return undefined;
  }

  return {
    name,
    expr,
  };
}

/**
 * Parses one C/C++ line and extracts either:
 * - "#define NAME EXPR"
 * - "#define NAME(P1,...) EXPR"
 * - scalar declaration with assignment ("TYPE NAME = EXPR;")
 * Returns undefined for non-matching lines.
 */
export function parseCppSymbolDefinition(
  line: string
): CppSymbolDefinition | undefined {
  const parsedDefine = parseDefineDirective(line);
  if (parsedDefine) {
    return {
      name: parsedDefine.name,
      expr: parsedDefine.expr,
      macroParams: parsedDefine.params,
    };
  }

  const parsedValueDeclaration = parseValueDeclaration(line);
  if (parsedValueDeclaration) {
    return {
      name: parsedValueDeclaration.name,
      expr: parsedValueDeclaration.expr,
    };
  }

  return undefined;
}

/**
 * Scans source files and collects:
 * - raw object-like #define expressions
 * - function-like #define macros
 * - scalar declaration expressions (const/variables with one-line assignment)
 * - direct numeric values for declarations that can be evaluated immediately
 * - source locations for navigation
 */
export async function collectDefinesAndConsts(
  files: string[],
  workspaceRoot: string
): Promise<CollectedCppSymbols> {
  const defines = new Map<string, string>();
  const defineConditions = new Map<string, string>();
  const functionDefines = new Map<string, FunctionMacroDefinition>();
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
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineWithoutComments = stripComments(line);
      const directiveLine = lineWithoutComments.trim();
      let isDirectiveLine = false;

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
        isDirectiveLine = true;
      } else {
        const ifndefMatch = directiveLine.match(IFNDEF_RX);
        if (ifndefMatch) {
          const branchCondition = isTopLevelIncludeGuard(
            lines,
            i,
            ifndefMatch[1],
            conditionalStack.length
          )
            ? "1"
            : `!defined(${ifndefMatch[1]})`;
          const activeCondition = combineConditions(currentCondition, branchCondition);

          conditionalStack.push({
            parentCondition: currentCondition,
            branchConditions: [branchCondition],
            activeCondition,
          });

          currentCondition = activeCondition;
          isDirectiveLine = true;
        } else {
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
            isDirectiveLine = true;
          } else {
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
              frame.activeCondition = combineConditions(
                frame.parentCondition,
                localCondition
              );
              currentCondition = frame.activeCondition;
              isDirectiveLine = true;
            } else if (ELSE_RX.test(directiveLine) && conditionalStack.length > 0) {
              const frame = conditionalStack[conditionalStack.length - 1];
              const elseCondition = buildElseCondition(frame.branchConditions);

              frame.activeCondition = combineConditions(
                frame.parentCondition,
                elseCondition
              );
              currentCondition = frame.activeCondition;
              isDirectiveLine = true;
            } else if (ENDIF_RX.test(directiveLine) && conditionalStack.length > 0) {
              const frame = conditionalStack.pop();
              currentCondition = frame?.parentCondition ?? null;
              isDirectiveLine = true;
            }
          }
        }
      }

      if (!isDirectiveLine) {
        const definitionCondition =
          currentCondition && currentCondition !== "1" ? currentCondition : "always";

        const parsedDefine = parseDefineDirective(line);
        if (parsedDefine) {
          const { name, expr, params } = parsedDefine;

          if (params) {
            if (!functionDefines.has(name)) {
              functionDefines.set(name, {
                params,
                body: expr,
              });
            }
          } else if (!defines.has(name)) {
            defines.set(name, expr);
            defineConditions.set(name, definitionCondition);
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
            condition: definitionCondition,
          });
          defineVariants.set(name, variants);
        } else if (braceDepth === 0) {
          const parsedValueDeclaration = parseValueDeclaration(line);
          if (parsedValueDeclaration) {
            const { name, expr } = parsedValueDeclaration;

            if (!defines.has(name)) {
              defines.set(name, expr);
              defineConditions.set(name, definitionCondition);

              try {
                consts.set(name, safeEval(expr));
              } catch {
                // Keep unresolved declaration expressions for recursive expansion.
              }
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
              condition: definitionCondition,
            });
            defineVariants.set(name, variants);
          }
        }
      }

      braceDepth = updateBraceDepth(braceDepth, lineWithoutComments);
    }
  }

  return {
    defines,
    defineConditions,
    functionDefines,
    defineVariants,
    consts,
    locations,
  };
}
