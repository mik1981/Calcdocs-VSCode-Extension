import * as vscode from "vscode";
import type { ClangdStatus } from "./ClangdClient";
import type { ClangdAst, IClangdBackend } from "./ClangdService";

export class VsCodeClangdBackend implements IClangdBackend {
  private indexing = false;
  private disposable?: vscode.Disposable;

  async initialize(): Promise<void> {
    // intercetta index progress (clangd lo pubblica come progress LSP)
    this.disposable = vscode.window.onDidChangeWindowState(() => {
      // noop, serve solo a forzare activation timing-safe
    });

    vscode.languages.onDidChangeDiagnostics(() => {
      // activity heuristic: presenza di attività = indicizzazione
      this.indexing = true;
      setTimeout(() => (this.indexing = false), 800);
    });
  }

  dispose(): void {
    this.disposable?.dispose();
  }

  isAvailable(): boolean {
    return true;
  }

  getStatus(): ClangdStatus {
    return {
      available: true,
      hasCompileCommands: true,
      indexing: this.indexing,
    };
  }

  async getHover(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Hover | null> {
    // const hover = await vscode.commands.executeCommand<vscode.Hover>(
    //   "vscode.executeHoverProvider",
    //   uri,
    //   position
    // );
    // return hover ?? null;
    // ⚠️ Non chiamare vscode.executeHoverProvider da dentro un hover provider:
    // causerebbe una ricorsione infinita poiché VSCode ri-invoca tutti i provider
    // registrati, incluso CalcDocs stesso.
    // L'hover di vscode-clangd viene già mostrato nativamente da VSCode;
    // CalcDocs aggiunge solo i propri dati (value, expression, notes).
    return null;
  }

  async getDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location | null> {
    const res = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeDefinitionProvider",
      uri,
      position
    );
    return res?.[0] ?? null;
  }

  async getDocumentSymbols(uri: vscode.Uri) {
    return (
      (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        uri
      )) ?? []
    );
  }

  async getAst(_uri: vscode.Uri): Promise<ClangdAst | null> {
    // VSCode command API currently exposes symbols/hover/definition, but not
    // clangd's custom textDocument/ast request.
    return null;
  }
}
