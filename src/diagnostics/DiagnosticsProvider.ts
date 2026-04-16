import * as vscode from "vscode";

import { ClangdService } from "../clangd/ClangdService";
import { CalcDocsState } from "../core/state";

function cloneDiagnostic(
  diagnostic: vscode.Diagnostic,
  source: "clangd" | "calcdocs"
): vscode.Diagnostic {
  const copy = new vscode.Diagnostic(
    diagnostic.range,
    diagnostic.message,
    diagnostic.severity
  );
  copy.code = diagnostic.code;
  copy.relatedInformation = diagnostic.relatedInformation;
  copy.tags = diagnostic.tags;
  copy.source = source;
  return copy;
}

function isClangdDiagnostic(diagnostic: vscode.Diagnostic): boolean {
  return (diagnostic.source ?? "").toLowerCase().includes("clangd");
}

export class DiagnosticsProvider {
  constructor(
    private readonly state: CalcDocsState,
    private readonly clangdService: ClangdService
  ) {}

  mergeDiagnosticsForUri(uri: vscode.Uri): void {
    const collection = this.state.diagnostics;
    if (!collection) {
      return;
    }

    const existing = collection.get(uri) ?? [];
    const calcdocsDiagnostics = existing
      .filter((diagnostic) => !isClangdDiagnostic(diagnostic))
      .map((diagnostic) => cloneDiagnostic(diagnostic, "calcdocs"));

    if (!this.clangdService.isAvailable()) {
      collection.set(uri, calcdocsDiagnostics);
      return;
    }

    const clangdDiagnostics = vscode.languages
      .getDiagnostics(uri)
      .filter(isClangdDiagnostic)
      .map((diagnostic) => cloneDiagnostic(diagnostic, "clangd"));

    collection.set(uri, [...calcdocsDiagnostics, ...clangdDiagnostics]);
  }

  mergeForVisibleEditors(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      const language = editor.document.languageId;
      if (language !== "c" && language !== "cpp" && language !== "yaml") {
        continue;
      }

      this.mergeDiagnosticsForUri(editor.document.uri);
    }
  }
}
