import * as vscode from "vscode";
import { ClangdClient } from "./ClangdClient";
import { VsCodeClangdBackend } from "./VsCodeClangdBackend";
import { ClangdService, type IClangdBackend } from "./ClangdService";
import type { ColoredOutput } from "../utils/output";

async function hasVsCodeClangd(): Promise<boolean> {
  const ext = vscode.extensions.getExtension(
    "llvm-vs-code-extensions.vscode-clangd"
  );
  if (!ext) {
    return false;
  }

  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch {
      return false;
    }
  }

  return true;
}

function createFallbackBackend(): IClangdBackend {
  return {
    isAvailable: () => false,
    getStatus: () => ({ available: false, hasCompileCommands: false, indexing: false }),
    getHover: async () => null,
    getDefinition: async () => null,
    getDocumentSymbols: async () => [],
    getAst: async () => null,
  };
}

async function createClangdBackend(
  context: vscode.ExtensionContext,
  output?: ColoredOutput,
  useClangd = true
): Promise<IClangdBackend> {
  if (!useClangd) {
    output?.info("[clangd] disabled by configuration");
    return createFallbackBackend();
  }

  if (await hasVsCodeClangd()) {
    output?.info("[clangd] using vscode-clangd backend");
    const backend = new VsCodeClangdBackend();
    await backend.initialize();
    return backend;
  }

  output?.info("[clangd] vscode-clangd not found");

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const client = new ClangdClient(workspaceRoot, output);
  const status = await client.initialize(context, true);
  if (status.available) {
    output?.info("[clangd] using external clangd backend");
    return client;
  }

  output?.warn("[clangd] clangd unavailable, fallback mode");
  return createFallbackBackend();
}

export async function createClangdService(
  context: vscode.ExtensionContext,
  output?: ColoredOutput,
  useClangd = true
): Promise<ClangdService> {
  const backend = await createClangdBackend(context, output, useClangd);
  return new ClangdService(backend);
}

export async function reconfigureClangdService(
  service: ClangdService,
  context: vscode.ExtensionContext,
  output?: ColoredOutput,
  useClangd = true
): Promise<void> {
  const backend = await createClangdBackend(context, output, useClangd);
  await service.setBackend(backend);
}
