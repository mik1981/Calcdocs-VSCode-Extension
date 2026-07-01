import * as path from "path";

import { CacheSystem } from "../../src/cache/CacheSystem";
import { ExpressionEvaluator } from "../../src/evaluation/ExpressionEvaluator";
import { IncludeResolver } from "../../src/includes/IncludeResolver";
import { FileIndexer } from "../../src/indexing/FileIndexer";
import { normalizeFilePath, type TextFileSystem } from "../../src/runtime/FileSystem";
import type { FileStamp, ResolutionContext } from "../../src/runtime/types";
import { SymbolEngine } from "../../src/symbols/SymbolEngine";
import { YamlFormulaEngine } from "../../src/formulas/YamlFormulaEngine";

export class MemoryFileSystem implements TextFileSystem {
  readonly files = new Map<string, string>();
  readCount = 0;
  statCount = 0;
  existsCount = 0;

  constructor(files: Record<string, string>) {
    for (const [filePath, text] of Object.entries(files)) {
      this.files.set(normalizeFilePath(filePath), text);
    }
  }

  async readFile(filePath: string): Promise<string | undefined> {
    this.readCount += 1;
    return this.files.get(normalizeFilePath(filePath));
  }

  async statFile(filePath: string): Promise<FileStamp | undefined> {
    this.statCount += 1;
    const text = this.files.get(normalizeFilePath(filePath));
    if (text === undefined) {
      return undefined;
    }
    return {
      mtimeMs: text.length,
      size: Buffer.byteLength(text, "utf8"),
    };
  }

  async fileExists(filePath: string): Promise<boolean> {
    this.existsCount += 1;
    return this.files.has(normalizeFilePath(filePath));
  }
}

export function createHarness(files: Record<string, string>, root = path.resolve("workspace")) {
  const fileSystem = new MemoryFileSystem(files);
  const cache = new CacheSystem({
    memoryLimitBytes: 1024 * 1024,
    maxEntries: 500,
  });
  const fileIndexer = new FileIndexer(fileSystem, cache);
  const includeResolver = new IncludeResolver(fileSystem, cache);
  const expressionEvaluator = new ExpressionEvaluator();
  const symbolEngine = new SymbolEngine(
    fileIndexer,
    includeResolver,
    expressionEvaluator,
    cache
  );
  const yamlFormulaEngine = new YamlFormulaEngine(expressionEvaluator, symbolEngine);

  return {
    root,
    fileSystem,
    cache,
    fileIndexer,
    includeResolver,
    expressionEvaluator,
    symbolEngine,
    yamlFormulaEngine,
  };
}

export function contextFor(
  filePath: string,
  text: string | undefined,
  root: string,
  includeDepthLimit = 4
): ResolutionContext {
  return {
    filePath,
    documentText: text,
    documentVersion: text === undefined ? undefined : 1,
    workspaceRoots: [root],
    includeDepthLimit,
  };
}

export function ws(root: string, relativePath: string): string {
  return path.resolve(root, relativePath);
}
