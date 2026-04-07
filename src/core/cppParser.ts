import * as fsp from "fs/promises";
import * as path from "path";

import { updateBraceDepth } from "../utils/braceDepth";
import { DEFINE_RX, SRC_EXTS, TOKEN_RX } from "../utils/regex";
import { stripComments, stripLineContinuations } from "../utils/text";
import { type FunctionMacroDefinition, safeEval } from "./expression";
import {
  SymbolConditionalDefinition,
  SymbolDefinitionLocation,
} from "./state";
import { type ColoredOutput } from "../utils/output";

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

export type CollectOptions = {
  resolveIncludes?: boolean;
  output?: ColoredOutput;
  workspaceRoot?: string;
  maxMegaCacheEntries?: number;
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
const UNDEF_RX = /^\s*#\s*undef\s+([A-Za-z_]\w*)\b/;
const CONTROL_FLOW_KEYWORD_RX =
  /^(?:if|else|for|while|switch|case|return|goto|do)\b/;

/** Regex per catturare #include "file" o <file> */
const INCLUDE_RX = /^\s*#include\s+["<]([^">]+)[">]/i;

type FileStamp = {
  mtimeMs: number;
  size: number;
};

type MegaCacheEntry = {
  content: string;
  dependencies: Map<string, FileStamp>;
  byteSize: number;
  lastAccessed: number;
};

const DEFAULT_MEGA_CACHE_MAX_ENTRIES = 50; // Increased for test files
const MIN_MEGA_CACHE_ENTRIES = 1;
const megaCache = new Map<string, MegaCacheEntry>();

function normalizeCacheKey(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

async function getFileStamp(filePath: string, output?: ColoredOutput): Promise<FileStamp | null> {
  try {
    const stat = await fsp.stat(filePath);
    return {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch (err) {
    output?.warn(`[MegaStamp] ❌ Missing dep: ${path.relative(process.cwd(), filePath)}`);
    return null;
  }
}

async function isMegaCacheEntryValid(entry: MegaCacheEntry, output?: ColoredOutput): Promise<boolean> {
  for (const [dependencyPath, previousStamp] of entry.dependencies) {
    const currentStamp = await getFileStamp(dependencyPath, output);
    if (!currentStamp) {
      output?.appendLine(`[MegaValid] ❌ Invalid cache (missing dep): ${path.basename(dependencyPath)}`);
      return false;
    }

    if (
      currentStamp.mtimeMs !== previousStamp.mtimeMs ||
      currentStamp.size !== previousStamp.size
    ) {
      output?.appendLine(`[MegaValid] ❌ Invalid cache (changed): ${path.basename(dependencyPath)}`);
      return false;
    }
  }

  return true;
}

function touchMegaCacheEntry(cacheKey: string, entry: MegaCacheEntry): void {
  entry.lastAccessed = Date.now();
  megaCache.delete(cacheKey);
  megaCache.set(cacheKey, entry);
}

function clampMegaCacheEntries(maxMegaCacheEntries: number | undefined): number {
  if (!Number.isFinite(maxMegaCacheEntries)) {
    return DEFAULT_MEGA_CACHE_MAX_ENTRIES;
  }

  return Math.max(MIN_MEGA_CACHE_ENTRIES, Math.floor(maxMegaCacheEntries!));
}

function evictOldMegaEntries(maxEntries: number, output?: ColoredOutput): void {
  while (megaCache.size > maxEntries) {
    const oldest = megaCache.keys().next();
    if (oldest.done) {
      break;
    }

    const oldestKey = oldest.value;
    const oldestEntry = megaCache.get(oldestKey);
    megaCache.delete(oldestKey);

    if (oldestEntry) {
      output?.detail(
        `[Mega] LRU evict ${path.basename(oldestKey)} (${(oldestEntry.byteSize / 1024).toFixed(1)}kB)`
      );
    }
  }
}


/*
 * Adapted from analysis.ts createMegaSourceFile logic.
 */
async function resolveInclude(
  relIncludePath: string, 
  baseDir: string, 
  workspaceRoot: string,
  output: ColoredOutput | undefined,
  visited: Set<string>,
  dependencyTracker: Set<string>
): Promise<string> {
// FIXED: Prioritize inc/test/inc dirs for external headers
  output?.appendLine(`[ResolveInclude] 🔍 Searching "${relIncludePath}" (baseDir="${path.relative(workspaceRoot, baseDir)}")`);
  
  const candidateDirs = [
    path.join(baseDir, '..', 'inc'),     // 0. Sibling inc/ (test/src → test/inc)
    path.join(workspaceRoot, 'test', 'inc'), // 1. Explicit test/inc
    path.join(workspaceRoot, 'inc'),     // 2. Workspace inc/
    path.join(workspaceRoot, 'include'), // 3. include/
    path.join(workspaceRoot, 'headers'), // 4. headers/
    baseDir,                             // 5. Source dir
    workspaceRoot,                       // 6. Root
    path.join(workspaceRoot, 'src')      // 7. src/
  ];
  
  let absIncludePath: string | null = null;
  let triedPaths: string[] = [];
  
  for (const dir of candidateDirs) {
    const candidatePath = path.resolve(dir, relIncludePath);
    triedPaths.push(path.relative(workspaceRoot || '.', candidatePath));
    try {
      await fsp.access(candidatePath);
      absIncludePath = candidatePath;
      output?.appendLine(`[ResolveInclude] ✅ Found: ${relIncludePath} → ${path.relative(workspaceRoot || '.', absIncludePath)} (in ${path.basename(path.dirname(absIncludePath))})`);
      break;
    } catch {
      // Continue to next directory
    }
  }
  
  if (!absIncludePath) {
    output?.appendLine(`[ResolveInclude] ❌ NOT FOUND: ${relIncludePath} (tried ${triedPaths.slice(0,5).join(' → ')}${triedPaths.length>5 ? '...' : ''})`);
    return '';
  }
  
  const key = normalizeCacheKey(absIncludePath);
  output?.appendLine(`[ResolveInclude] Entry: ${relIncludePath} → ${key} (ext: ${path.extname(relIncludePath)})`);

  if (visited.has(key)) {
    output?.appendLine(`[ResolveInclude] SKIP recursive include: ${path.basename(relIncludePath)}`);
    return '';
  }

  visited.add(key);
  dependencyTracker.add(absIncludePath);


  let content: string;
  try {
    content = await fsp.readFile(absIncludePath, 'utf8');
    output?.appendLine(`[ResolveInclude] Read ${relIncludePath}: lines=${content.split('\n').length}`);
  } catch (err) {
    output?.appendLine(`[ResolveInclude] Failed read ${relIncludePath}: ${err}`);
    return '';
  }
  
  const lines = content.split(/\r?\n/);
  let processedContent = `/* === INCL ${path.relative(workspaceRoot, absIncludePath)} === */\n`;
  
  for (const line of lines) {
  const includeMatch = line.match(INCLUDE_RX);
    if (includeMatch) {
      output?.appendLine(`[ResolveInclude] Found include match: ${includeMatch[1]}`);
      const nested = await resolveInclude(

        includeMatch[1], 
        path.dirname(absIncludePath), 
        workspaceRoot,
        output,
        visited,
        dependencyTracker
      );
      processedContent += nested || line + '\n';
    } else {
      processedContent += line + '\n';
    }
  }
  
  return processedContent;
}

/**
 * Builds mega-content for main source file.
 */
async function buildMegaContent(
  sourcePath: string,
  workspaceRoot: string,
  output: ColoredOutput | undefined,
  maxMegaCacheEntries: number
): Promise<string> {
  // Force clear cache for test files to avoid stale data
  if (sourcePath.includes('test')) {
    const testKey = normalizeCacheKey(sourcePath);
    if (megaCache.has(testKey)) {
      output?.appendLine(`[Mega] 🔄 Force clear test cache: ${path.basename(sourcePath)}`);
      megaCache.delete(testKey);
    }
  }
  
  const cacheKey = normalizeCacheKey(sourcePath);
  const cached = megaCache.get(cacheKey);
  if (cached) {
    const isValid = await isMegaCacheEntryValid(cached);
    if (isValid) {
      touchMegaCacheEntry(cacheKey, cached);
      output?.appendLine(
        `[Mega] CACHE HIT: ${path.basename(sourcePath)} (${(cached.byteSize / 1024).toFixed(1)}kB)`
      );
      return cached.content;
    }

    megaCache.delete(cacheKey);
    output?.appendLine(`[Mega] CACHE STALE: ${path.basename(sourcePath)} → rebuilding`);
  }
  output?.appendLine(`[Mega] CACHE MISS: ${path.basename(sourcePath)} → building fresh`);


  const visited = new Set<string>();
  const dependencyTracker = new Set<string>([path.resolve(sourcePath)]);
  const mainDir = path.dirname(sourcePath);
  
  let megaContent = `/* === MEGA from ${path.relative(workspaceRoot, sourcePath)} === */\n`;
  let mainContent: string;
  try {
    mainContent = await fsp.readFile(sourcePath, 'utf8');
  } catch (err) {
    output?.appendLine(`[Mega] Failed read main ${sourcePath}: ${err}`);
    return megaContent;
  }
  
  const mainLines = mainContent.split(/\r?\n/);
  
  for (const line of mainLines) {
    const includeMatch = line.match(INCLUDE_RX);
    if (includeMatch) {
      const included = await resolveInclude(
        includeMatch[1], 
        mainDir, 
        workspaceRoot,
        output,
        visited,
        dependencyTracker
      );
      if (included) {
      output?.appendLine(`[Mega] included ${includeMatch[1]} in ${mainDir}`);
      }
      megaContent += included || line + '\n';
    } else {
      megaContent += line + '\n';
    }
  }

  const lines = megaContent.split(/\r?\n/);
  const byteSize = Buffer.byteLength(megaContent);
  const sizeKB = (byteSize / 1024).toFixed(1);
  const dependencies = new Map<string, FileStamp>();
  for (const dependencyPath of dependencyTracker) {
    const stamp = await getFileStamp(dependencyPath);
    if (stamp) {
      dependencies.set(dependencyPath, stamp);
    }
  }

  const cacheEntry: MegaCacheEntry = {
    content: megaContent,
    dependencies,
    byteSize,
    lastAccessed: Date.now(),
  };
  megaCache.set(cacheKey, cacheEntry);
  evictOldMegaEntries(maxMegaCacheEntries, output);

  output?.appendLine(`[Mega] Built ${path.basename(sourcePath)}: lines=${lines.length}, size=${sizeKB}kB`);
  return megaContent;
}


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

function parseDefineNameDirective(line: string): string | undefined {
  const match = stripComments(line).match(/^\s*#\s*define\s+([A-Za-z_]\w*)\b/);
  return match?.[1];
}

function resolveCondition(
  rawCondition: string,
  defines: Map<string, string>,
  consts: Map<string, number>,
  definedSymbols: Set<string>,
  output?: ColoredOutput,
): string {
  const cleaned = stripComments(rawCondition).trim();
  if (!cleaned) {
    return "1";
  }

  rawCondition = rawCondition.replace(
    /defined\s*\(\s*(\w+)\s*\)/g,
    (_, name) => defines.has(name) ? "1" : "0"
  );

  let resolved = cleaned;
  output?.appendLine(`resolveCondition input: "${rawCondition}" -> "${cleaned}"`); // TEMP DEBUG
  
  resolved = resolved.replace(/defined\s*\(\s*([A-Za-z_]\w*)\s*\)/gi, (_, symbol) => {
    return definedSymbols.has(symbol) || consts.has(symbol) ? "1" : "0";
  });
  
  resolved = resolved.replace(/!\s*defined\s*\(\s*([A-Za-z_]\w*)\s*\)/gi, (_, symbol) => {
    return definedSymbols.has(symbol) || consts.has(symbol) ? "0" : "1";
  });

  const tokenSet = new Set(resolved.match(TOKEN_RX) ?? []);
  const tokens = Array.from(tokenSet);

  for (const token of tokens) {
    if (token === "defined" || token === "sizeof" || token === "nullptr") {
      continue;
    }
    
    if (token === "not" || token === "and" || token === "or" ||
        token === "bitand" || token === "bitor" || token === "xor" ||
        token === "compl") {
      continue;
    }

    if (consts.has(token)) {
      const value = consts.get(token)!;
      resolved = resolved.replace(new RegExp(`\\b${token}\\b`, 'g'), String(value));
      continue;
    }

    if (definedSymbols.has(token) && !defines.has(token)) {
      resolved = resolved.replace(new RegExp(`\\b${token}\\b`, "g"), "1");
      continue;
    }

    if (defines.has(token)) {
      const expr = defines.get(token)!;

      try {
        const value = safeEval(expr);
        resolved = resolved.replace(new RegExp(`\\b${token}\\b`, 'g'), String(value));
      } catch {
        resolved = resolved.replace(new RegExp(`\\b${token}\\b`, 'g'), "1");
      }
      continue;
    }

    // In C preprocessor #if expressions, unknown identifiers are treated as 0.
    resolved = resolved.replace(new RegExp(`\\b${token}\\b`, "g"), "0");
  }

  try {
    const value = safeEval(resolved);
    output?.appendLine(`[resolveCondition] cleaned=${cleaned} resolved=${resolved} value=${value}`);
    return value !== 0 ? "1" : "0";
  } catch {
    output?.warn(`[resolveCondition] ⚠️ FAILED final eval (fallback 0): "${resolved}"`);
    return "0";
  }
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

function normalizeVariantCondition(condition: string): string {
  const trimmed = condition.trim();
  if (!trimmed || trimmed === "1" || trimmed.toLowerCase() === "always") {
    return "always";
  }

  try {
    const value = safeEval(trimmed);
    if (Number.isFinite(value)) {
      return value !== 0 ? "always" : "0";
    }
  } catch {
    // keep raw symbolic condition when not directly evaluable
  }

  return trimmed.replace(/\s+/g, " ");
}

function normalizeVariantExpression(expr: string): string {
  return expr.trim().replace(/\s+/g, " ");
}

function buildVariantDedupKey(variant: SymbolConditionalDefinition): string {
  const normalizedCondition = normalizeVariantCondition(variant.condition);
  const normalizedExpression = normalizeVariantExpression(variant.expr);
  return `${normalizedCondition}::${normalizedExpression}`;
}

function dedupeDefineVariants(
  defineVariants: Map<string, SymbolConditionalDefinition[]>
): Map<string, SymbolConditionalDefinition[]> {
  const deduped = new Map<string, SymbolConditionalDefinition[]>();

  for (const [name, variants] of defineVariants) {
    const seenKeys = new Set<string>();
    const uniqueVariants: SymbolConditionalDefinition[] = [];

    for (const variant of variants) {
      const dedupKey = buildVariantDedupKey(variant);
      if (seenKeys.has(dedupKey)) {
        continue;
      }

      seenKeys.add(dedupKey);
      uniqueVariants.push({ ...variant });
    }

    if (uniqueVariants.length > 0) {
      deduped.set(name, uniqueVariants);
    }
  }

  return deduped;
}

function parseDefineDirective(line: string): ParsedDefineDirective | undefined {
  const directiveMatch = line.match(DEFINE_RX);
  if (!directiveMatch) {
    return undefined;
  }

  const name = directiveMatch[1];
  const rawTail = directiveMatch[2] ?? "";

  // Function-like macro: no space between name and '('
  // Object-like macro: expression may start with '(' but has leading whitespace
  if (rawTail.startsWith("(") && !rawTail.startsWith(" ")) {
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

  const expr = stripComments(rawTail).trim();
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
 * 
 * Uses two-pass approach:
 * 1. First pass: collect all defines and consts from all files
 * 2. Second pass: process conditional blocks using resolved conditions
 */
export async function collectDefinesAndConsts(
  files: string[],
  workspaceRoot: string,
  options: CollectOptions = {}
): Promise<CollectedCppSymbols> {

  const { resolveIncludes = false, output, maxMegaCacheEntries } = options;
  const effectiveCacheLimit = clampMegaCacheEntries(maxMegaCacheEntries);

  output?.appendLine(
    `[CPP] entry files=${files.length}, resolveIncludes=${resolveIncludes ? "YES" : "NO"}, cacheLimit=${effectiveCacheLimit}`
  );

  
  const defines = new Map<string, string>();
  const defineConditions = new Map<string, string>();
  const functionDefines = new Map<string, FunctionMacroDefinition>();
  const defineVariants = new Map<string, SymbolConditionalDefinition[]>();
  const consts = new Map<string, number>();
  const locations = new Map<string, SymbolDefinitionLocation>();
  const globallyDefinedSymbols = new Set<string>();

  const SOURCES_ONLY_EXTS = new Set([".c", ".cpp", ".cc"]);
  const effectiveFiles = resolveIncludes 
    ? files.filter(f => SOURCES_ONLY_EXTS.has(path.extname(f).toLowerCase()))
    : files;
  output?.appendLine(`[CPP] effectiveFiles (${effectiveFiles.length}): ${effectiveFiles.map(p => path.basename(p)).join(', ')}`);

  // ========== FIRST PASS: Collect unconditional defines/consts ==========
  for (const filePath of effectiveFiles) {
    const seenDefinesInFile = new Set<string>(); // Track defines per file

    let text: string;
    if (resolveIncludes) {
      text = await buildMegaContent(
        filePath,
        workspaceRoot,
        output,
        effectiveCacheLimit
      );
    } else {
      try {
        text = await fsp.readFile(filePath, "utf8");
      } catch {
        continue;
      }
    }

    text = stripLineContinuations(text);
    const lines = text.split(/\r?\n/);

    let braceDepth = 0;    
    let conditionalDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineWithoutComments = stripComments(line);
      const directive = lineWithoutComments.trim();

      // ---- track preprocessor conditionals ----
      if (/^\s*#\s*(if|ifdef|ifndef)\b/.test(directive)) {
        conditionalDepth++;
        continue;
      }
      if (/^\s*#\s*endif\b/.test(directive)) {
        conditionalDepth = Math.max(0, conditionalDepth - 1);
        continue;
      }
      if (/^\s*#\s*(else|elif)\b/.test(directive)) {
        continue;
      }

      // ---- ignore anything inside conditional blocks ----
      if (conditionalDepth > 0) {
        braceDepth = updateBraceDepth(braceDepth, lineWithoutComments);
        continue;
      }

      // ---- parse defines ----
      const defineName = parseDefineNameDirective(line);
      if (defineName) {
        globallyDefinedSymbols.add(defineName);
      }

      const parsedDefine = parseDefineDirective(line);
      if (parsedDefine && !seenDefinesInFile.has(parsedDefine.name)) {
        seenDefinesInFile.add(parsedDefine.name); // mark as seen for this file

        const { name, expr, params } = parsedDefine;

        if (params) {
          if (!functionDefines.has(name)) {
            functionDefines.set(name, {
              params,
              body: expr,
            });
          }
        } else {
          // Allow overwrite in case later file redefines
          defines.set(name, expr);
          
          try {
            consts.set(name, safeEval(expr));
          } catch {}

          defineConditions.set(name, "always");
          const location: SymbolDefinitionLocation = {
            file: path.relative(workspaceRoot, filePath),
            line: i + 1
          };
          locations.set(name, location);
        }

        continue;
      }

      // ---- parse global scalar declarations ----
      if (braceDepth === 0) {
        const parsedValueDeclaration = parseValueDeclaration(line);
        if (parsedValueDeclaration && !seenDefinesInFile.has(parsedValueDeclaration.name)) {
          seenDefinesInFile.add(parsedValueDeclaration.name);

          const { name, expr } = parsedValueDeclaration;
          defines.set(name, expr);
          try {
            consts.set(name, safeEval(expr));
          } catch {}

          const location: SymbolDefinitionLocation = {
            file: path.relative(workspaceRoot, filePath),
            line: i + 1
          };
          locations.set(name, location);
        }
      }

      braceDepth = updateBraceDepth(braceDepth, lineWithoutComments);
    }
  }

  // ========== SECOND PASS: Conditional-aware processing ==========
  for (const filePath of effectiveFiles) {
    const seenDefinesInFile = new Set<string>();

    let text: string;    
    if (resolveIncludes) {
      text = await buildMegaContent(
        filePath,
        workspaceRoot,
        output,
        effectiveCacheLimit
      );
    } else {
      try {
        text = await fsp.readFile(filePath, "utf8");
      } catch {
        continue;
      }
    }

    text = stripLineContinuations(text);
    const lines = text.split(/\r?\n/);
    const conditionalStack: ConditionalFrame[] = [];
    let currentCondition: string | null = null;
    let braceDepth = 0;
    const seenVariants = new Set<string>();
    const activeDefinedSymbols = new Set<string>(globallyDefinedSymbols);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const lineWithoutComments = stripComments(line);
      const directiveLine = lineWithoutComments.trim();
      let isDirectiveLine = false;

      // Conditional directives...
      const ifdefMatch = directiveLine.match(IFDEF_RX);
      if (ifdefMatch) {
        const branchCondition = resolveCondition(
          `defined(${ifdefMatch[1]})`,
          defines,
          consts,
          activeDefinedSymbols,
          output
        );
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
            : resolveCondition(
                `!defined(${ifndefMatch[1]})`,
                defines,
                consts,
                activeDefinedSymbols,
                output
              );
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
            const rawCondition = ifMatch[1];
            const branchCondition = resolveCondition(
              rawCondition,
              defines,
              consts,
              activeDefinedSymbols,
              output
            );
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
              const rawCondition = elifMatch[1];
              const branchCondition = resolveCondition(
                rawCondition,
                defines,
                consts,
                activeDefinedSymbols,
                output
              );
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
            } else {
              const undefMatch = directiveLine.match(UNDEF_RX);
              if (undefMatch) {
                activeDefinedSymbols.delete(undefMatch[1]);
                isDirectiveLine = true;
              }
            }
          }
        }
      }

      if (!isDirectiveLine) {
        let isActiveBranch = true;
        if (currentCondition) {
          output?.appendLine(`[CPP2] Eval condition "${currentCondition}"`);
          try {
            const evalResult = safeEval(currentCondition);
            output?.appendLine(`[CPP2] condition eval = ${evalResult} (active=${evalResult !== 0})`);
            isActiveBranch = evalResult !== 0;
          } catch (e) {
            output?.error(`[CPP2] condition eval FAILED: ${e}`);
            isActiveBranch = true;
          }
        }

        const definitionCondition = isActiveBranch
          ? (currentCondition && currentCondition !== "1" ? currentCondition : "always")
          : "0";

        if (!isActiveBranch) {
          braceDepth = updateBraceDepth(braceDepth, lineWithoutComments);
          continue;
        }

        const activeDefineName = parseDefineNameDirective(line);
        if (activeDefineName) {
          activeDefinedSymbols.add(activeDefineName);
        }

        const parsedDefine = parseDefineDirective(line);
        if (parsedDefine && !seenDefinesInFile.has(parsedDefine.name)) {
          seenDefinesInFile.add(parsedDefine.name);
          const { name, expr, params } = parsedDefine;
          output?.appendLine(`[CPP2] Parsed define ${name}=${expr} cond=${definitionCondition} active=${isActiveBranch}`);

          if (params) {
            if (!functionDefines.has(name)) {
              functionDefines.set(name, {
                params,
                body: expr,
              });
            }
          } else {
            if (!defines.has(name)) {
              defines.set(name, expr);
            }
            
            defineConditions.set(name, definitionCondition);

            const location: SymbolDefinitionLocation = {
              file: path.relative(workspaceRoot ?? '.', filePath),
              line: i + 1 // 1-based
            };

            const variantKey = `${name}:${location.file}:${location.line}`;
            if (!seenVariants.has(variantKey)) {
              seenVariants.add(variantKey);

              const variants = defineVariants.get(name) ?? [];
              variants.push({
                ...location,
                expr,
                condition: definitionCondition
              });
              defineVariants.set(name, variants);
            }

            if (!locations.has(name)) {
              locations.set(name, location);
            }
          }
        } else if (braceDepth === 0) {
          const parsedValueDeclaration = parseValueDeclaration(line);
          if (parsedValueDeclaration && !seenDefinesInFile.has(parsedValueDeclaration.name)) {
            seenDefinesInFile.add(parsedValueDeclaration.name);

            const { name, expr } = parsedValueDeclaration;

            if (!defines.has(name)) {
              defines.set(name, expr);
            }

            defineConditions.set(name, definitionCondition);

            try {
              consts.set(name, safeEval(expr));
            } catch {}

            const location: SymbolDefinitionLocation = {
              file: path.relative(workspaceRoot, filePath),
              line: i + 1
            };

            const variantKey = `${location.file}:${location.line}`;
            if (!seenVariants.has(variantKey)) {
              seenVariants.add(variantKey);

              const variants = defineVariants.get(name) ?? [];
              variants.push({
                ...location,
                expr,
                condition: definitionCondition
              });
              defineVariants.set(name, variants);
            }

            if (!locations.has(name)) {
              locations.set(name, location);
            }
          }
        }
      }

      braceDepth = updateBraceDepth(braceDepth, lineWithoutComments);
    }
  }

  const dedupedDefineVariants = dedupeDefineVariants(defineVariants);

  return {
    defines,
    defineConditions,
    functionDefines,
    defineVariants: dedupedDefineVariants,
    consts,
    locations
  };
}
