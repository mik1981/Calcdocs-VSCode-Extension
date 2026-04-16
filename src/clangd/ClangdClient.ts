import * as fsp from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import * as vscode from "vscode";
import type { ClangdAst, ClangdAstNode, IClangdBackend } from "./ClangdService";
import {
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  ServerOptions,
} from "vscode-languageclient/node";

import type { ColoredOutput } from "../utils/output";

const execFileAsync = promisify(execFile);
const CLANGD_REQUEST_TIMEOUT_MS = 1200;
const COMPILE_COMMANDS_FILE = "compile_commands.json";

export interface ClangdStatus {
  available: boolean;
  hasCompileCommands: boolean;
  indexing: boolean;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 1200 });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findCompileCommandsInWorkspace(
  workspaceRoot: string
): Promise<boolean> {
  const candidatePaths = [
    path.join(workspaceRoot, COMPILE_COMMANDS_FILE),
    path.join(workspaceRoot, "build", COMPILE_COMMANDS_FILE),
    path.join(workspaceRoot, "out", COMPILE_COMMANDS_FILE),
    path.join(workspaceRoot, ".vscode", COMPILE_COMMANDS_FILE),
  ];

  for (const candidatePath of candidatePaths) {
    if (await fileExists(candidatePath)) {
      return true;
    }
  }

  const stack: Array<{ dir: string; depth: number }> = [{ dir: workspaceRoot, depth: 0 }];
  const maxDepth = 3;
  const maxEntriesPerDir = 120;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const { dir, depth } = current;
    let entries: Array<import("fs").Dirent>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries.slice(0, maxEntriesPerDir)) {
      if (entry.isFile() && entry.name === COMPILE_COMMANDS_FILE) {
        return true;
      }
    }

    if (depth >= maxDepth) {
      continue;
    }

    for (const entry of entries.slice(0, maxEntriesPerDir)) {
      if (!entry.isDirectory()) {
        continue;
      }

      const name = entry.name.toLowerCase();
      if (
        name === ".git" ||
        name === "node_modules" ||
        name === ".vscode" ||
        name === "out" ||
        name === "dist"
      ) {
        continue;
      }

      stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }

  return false;
}

type ProtocolPosition = {
  line: number;
  character: number;
};

type ProtocolRange = {
  start: ProtocolPosition;
  end: ProtocolPosition;
};

function parseProtocolRange(value: unknown): ProtocolRange | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const maybeRange = value as {
    start?: { line?: unknown; character?: unknown };
    end?: { line?: unknown; character?: unknown };
  };
  const startLine = Number(maybeRange.start?.line);
  const startChar = Number(maybeRange.start?.character);
  const endLine = Number(maybeRange.end?.line);
  const endChar = Number(maybeRange.end?.character);

  if (
    !Number.isFinite(startLine) ||
    !Number.isFinite(startChar) ||
    !Number.isFinite(endLine) ||
    !Number.isFinite(endChar)
  ) {
    return undefined;
  }

  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

function toStringField(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferAstKind(label: string): string {
  const match = label.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
  if (!match) {
    return "node";
  }

  return match[1];
}

function parseAstTextPayload(text: string): ClangdAst | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  "))
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  const nodesWithIndent = lines.map((line) => {
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const rawLabel = line.trim().replace(/^[|`+\-\\\s]+/, "").trim();
    const label = rawLabel.length > 0 ? rawLabel : line.trim();
    const node: ClangdAstNode = {
      kind: inferAstKind(label),
      label,
      children: [],
    };

    return { indent, node };
  });

  const rootEntry = nodesWithIndent[0];
  const stack: Array<{ indent: number; node: ClangdAstNode }> = [rootEntry];

  for (let i = 1; i < nodesWithIndent.length; i += 1) {
    const current = nodesWithIndent[i];

    while (stack.length > 0 && current.indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootEntry.node.children.push(current.node);
      stack.push(current);
      continue;
    }

    stack[stack.length - 1].node.children.push(current.node);
    stack.push(current);
  }

  return {
    root: rootEntry.node,
    source: "clangd-text",
  };
}

function parseAstJsonNode(value: unknown): ClangdAstNode | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const kind =
    toStringField(raw.kind) ??
    toStringField(raw.kindName) ??
    toStringField(raw.nodeKind) ??
    "node";
  const role = toStringField(raw.role);
  const detail = toStringField(raw.detail) ?? toStringField(raw.value);
  const arcana = toStringField(raw.arcana);
  const fallbackLabel = [kind, detail].filter(Boolean).join(": ");
  const label =
    toStringField(raw.label) ??
    toStringField(raw.name) ??
    (fallbackLabel || kind);
  const range = parseProtocolRange(
    raw.range ?? raw.extent ?? raw.location ?? raw.selectionRange
  );

  const childrenRaw = Array.isArray(raw.children)
    ? raw.children
    : Array.isArray(raw.nodes)
      ? raw.nodes
      : Array.isArray(raw.inner)
        ? raw.inner
        : [];
  const children: ClangdAstNode[] = [];
  for (const child of childrenRaw) {
    const parsedChild = parseAstJsonNode(child);
    if (parsedChild) {
      children.push(parsedChild);
    }
  }

  return {
    kind,
    label,
    role,
    detail,
    arcana,
    range: range
      ? new vscode.Range(
          new vscode.Position(range.start.line, range.start.character),
          new vscode.Position(range.end.line, range.end.character)
        )
      : undefined,
    children,
  };
}

function parseAstPayload(payload: unknown): ClangdAst | null {
  if (typeof payload === "string") {
    return parseAstTextPayload(payload);
  }

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const raw = payload as Record<string, unknown>;
  const candidate = raw.ast ?? raw.root ?? raw.tree ?? raw.node ?? payload;
  if (typeof candidate === "string") {
    return parseAstTextPayload(candidate);
  }

  const root = parseAstJsonNode(candidate);
  if (!root) {
    return null;
  }

  return {
    root,
    source: "clangd-json",
  };
}

export class ClangdClient implements IClangdBackend {
  private readonly workspaceRoot: string;
  private readonly output?: ColoredOutput;
  private languageClient: LanguageClient | null = null;
  private status: ClangdStatus = { available: false, hasCompileCommands: false, indexing: false };
  private useClangd = true;

  isAvailable(): boolean {
    return this.status.available && Boolean(this.languageClient);
  }

  constructor(workspaceRoot: string, output?: ColoredOutput) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  getStatus(): ClangdStatus {
    return { ...this.status };
  }

  async getHover(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Hover | null> {
    const client = this.getLanguageClient();
    if (!client || !this.isAvailable()) {
      return null;
    }

    const REQUEST_TIMEOUT_MS = 1200;
    const payload = await Promise.race([
      client.sendRequest("textDocument/hover", {
        textDocument: { uri: uri.toString() },
        position: { line: position.line, character: position.character },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS)),
    ]) as any;

    if (!payload) {
      return null;
    }

    const text = this.markupToText(payload.contents);
    if (!text) {
      return null;
    }

    const markdown = new vscode.MarkdownString(text);
    markdown.isTrusted = false;
    markdown.supportHtml = false;
    const range = this.protocolRangeToVscodeRange(payload.range);
    return new vscode.Hover(markdown, range);
  }

  async getDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location | null> {
    const client = this.getLanguageClient();
    if (!client || !this.isAvailable()) {
      return null;
    }

    const REQUEST_TIMEOUT_MS = 1200;
    const payload = await Promise.race([
      client.sendRequest("textDocument/definition", {
        textDocument: { uri: uri.toString() },
        position: { line: position.line, character: position.character },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS)),
    ]) as any;

    return this.firstDefinitionLocation(payload);
  }

  async getDocumentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
    const client = this.getLanguageClient();
    if (!client || !this.isAvailable()) {
      return [];
    }

    const REQUEST_TIMEOUT_MS = 1200;
    const payload = await Promise.race([
      client.sendRequest("textDocument/documentSymbol", {
        textDocument: { uri: uri.toString() },
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS)),
    ]) as any;

    if (!payload || !Array.isArray(payload)) {
      return [];
    }

    const result: vscode.DocumentSymbol[] = [];
    for (const entry of payload) {
      if (typeof entry !== "object" || !entry) {
        continue;
      }

      const symbol = entry as Record<string, unknown>;
      const name = typeof symbol.name === "string" ? symbol.name : "";
      const detail = typeof symbol.detail === "string" ? symbol.detail : "";
      const range = this.protocolRangeToVscodeRange(symbol.range as any);
      const selectionRange = this.protocolRangeToVscodeRange(symbol.selectionRange as any) ?? range;
      if (!name || !range || !selectionRange) {
        continue;
      }

      const vscodeSymbol = new vscode.DocumentSymbol(
        name,
        detail,
        this.protocolKindToVscodeKind(symbol.kind),
        range,
        selectionRange
      );

      result.push(vscodeSymbol);
    }

    return result;
  }

  async getAst(uri: vscode.Uri): Promise<ClangdAst | null> {
    const client = this.getLanguageClient();
    if (!client || !this.isAvailable()) {
      return null;
    }

    try {
      const payload = await Promise.race([
        client.sendRequest("textDocument/ast", {
          textDocument: { uri: uri.toString() },
        }),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), CLANGD_REQUEST_TIMEOUT_MS)
        ),
      ]);

      return parseAstPayload(payload);
    } catch {
      return null;
    }
  }

  private markupToText(contents: unknown): string {
    if (typeof contents === "string") {
      return contents;
    }

    if (!contents) {
      return "";
    }

    if (Array.isArray(contents)) {
      return contents
        .map((entry) => this.markupToText(entry))
        .filter((text) => text.length > 0)
        .join("\n\n");
    }

    if (typeof contents === "object") {
      const asRecord = contents as Record<string, unknown>;
      const language = typeof asRecord.language === "string" ? asRecord.language : "";
      const value = typeof asRecord.value === "string" ? asRecord.value : "";
      if (language && value) {
        return `\`\`\`${language}\n${value}\n\`\`\``;
      }

      if (value) {
        return value;
      }

      const kind = typeof asRecord.kind === "string" ? asRecord.kind : "";
      if (kind && value) {
        return value;
      }
    }

    return "";
  }

  private protocolRangeToVscodeRange(
    range: { start: { line: number; character: number }; end: { line: number; character: number } } | undefined
  ): vscode.Range | undefined {
    if (!range) {
      return undefined;
    }

    return new vscode.Range(
      new vscode.Position(range.start.line, range.start.character),
      new vscode.Position(range.end.line, range.end.character)
    );
  }

  private firstDefinitionLocation(
    payload: any
  ): vscode.Location | null {
    if (!payload) {
      return null;
    }

    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return null;
      }

      for (const entry of payload) {
        const uri = entry.uri ?? entry.targetUri;
        const range = entry.range ?? entry.targetSelectionRange;
        if (!uri || !range) {
          continue;
        }

        return new vscode.Location(vscode.Uri.parse(uri), this.protocolRangeToVscodeRange(range)!);
      }
      return null;
    }

    return new vscode.Location(
      vscode.Uri.parse(payload.uri),
      this.protocolRangeToVscodeRange(payload.range)!
    );
  }

  private protocolKindToVscodeKind(value: unknown): vscode.SymbolKind {
    if (typeof value !== "number") {
      return vscode.SymbolKind.Variable;
    }

    if (value >= 1 && value <= 26) {
      return value as vscode.SymbolKind;
    }

    return vscode.SymbolKind.Variable;
  }

  getLanguageClient(): LanguageClient | null {
    return this.languageClient;
  }

  isIndexing(): boolean {
    return this.status.indexing;
  }

  async initialize(
    context: vscode.ExtensionContext,
    useClangd: boolean
  ): Promise<ClangdStatus> {
    this.useClangd = useClangd;
    await this.stop();

    const hasCompileCommands = await findCompileCommandsInWorkspace(this.workspaceRoot);
    if (!useClangd) {
      this.status = {
        available: false,
        hasCompileCommands,
        indexing: false,
      };
      return this.getStatus();
    }

    const clangdExists = await commandExists("clangd");
    if (!clangdExists) {
      this.status = {
        available: false,
        hasCompileCommands,
        indexing: false,
      };
      this.output?.warn("[clangd] executable not found in PATH. Falling back to parser.");
      return this.getStatus();
    }

    const serverOptions: ServerOptions = {
      command: "clangd",
      args: ["--background-index"],
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "untitled", language: "c" },
        { scheme: "untitled", language: "cpp" },
      ],
      synchronize: {
        fileEvents: vscode.workspace.createFileSystemWatcher(
          `**/${COMPILE_COMMANDS_FILE}`
        ),
      },
      revealOutputChannelOn: RevealOutputChannelOn.Never,
      outputChannelName: "CalcDocs clangd",
      diagnosticCollectionName: "calcdocs-clangd",
    };

    const client = new LanguageClient(
      "calcdocs-clangd",
      "CalcDocs clangd",
      serverOptions,
      clientOptions
    );

    try {
      context.subscriptions.push({
        dispose: () => {
          void client.stop();
        },
      });
      const startPromise = client.start();
      await Promise.race([
        startPromise,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("clangd start timeout")),
            CLANGD_REQUEST_TIMEOUT_MS * 2
          )
        ),
      ]);

      // REGISTRAZIONE NOTIFICA CLANGD
      // La notifica invia un oggetto tipo { queued: number, idle: number, ... }
      client.onNotification("$clangd/indexStatus", (params: { queued: number; idle: number }) => {
        // Se ci sono file in coda (queued > 0), allora sta indicizzando
        const isIndexing = params.queued > 0;
        this.status.indexing = isIndexing;
        
        // Opzionale: logga lo stato per debug
        // this.output?.info(`[clangd] Indexing: ${isIndexing} (Queued: ${params.queued})`);
      });

      this.languageClient = client;
      this.status = {
        available: true,
        hasCompileCommands,
        indexing: false,
      };

      if (!hasCompileCommands) {
        this.output?.warn(
          "[clangd] compile_commands.json not found. Hover/definition confidence reduced."
        );
        void vscode.window.showWarningMessage(
          "CalcDocs: clangd active but compile_commands.json is missing. Results may be less accurate."
        );
      }
    } catch (error) {
      this.output?.error(
        `[clangd] failed to start (${String(error)}). Falling back to parser.`
      );
      this.status = {
        available: false,
        hasCompileCommands,
        indexing: false,
      };
      this.languageClient = null;
    }

    return this.getStatus();
  }

  // restart removed - handled by factory

  async stop(): Promise<void> {
    if (!this.languageClient) {
      return;
    }

    try {
      await this.languageClient.stop();
    } catch {
      // ignore shutdown errors
    } finally {
      this.languageClient = null;
    }
  }
}
