import * as vscode from "vscode";

import { collectCppCodeLensItems, type CppCodeLensItem } from "../core/cppCodeLensItems";
import { shouldRenderGhostInsteadOfCodeLens } from "../core/ghostPolicy";
import { CalcDocsState } from "../core/state";

function toCodeLens(item: CppCodeLensItem): vscode.CodeLens {
  return new vscode.CodeLens(new vscode.Range(item.line, 0, item.line, 0), {
    title: item.title,
    command: item.command ?? "",
    arguments: item.arguments,
  });
}

/**
 * Adds inline CodeLens hints above C/C++ symbol definitions.
 */
export class CppValueCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly state: CalcDocsState) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.state.enabled || !this.state.cppCodeLens.enabled) {
      return [];
    }

    const maxItemsPerFile = Math.max(1, this.state.cppCodeLens.maxItemsPerFile);
    const items = collectCppCodeLensItems(document, this.state, maxItemsPerFile);
    const lenses: vscode.CodeLens[] = [];

    for (const item of items) {
      if (shouldRenderGhostInsteadOfCodeLens(document, item, this.state)) {
        continue;
      }

      lenses.push(toCodeLens(item));
    }

    return lenses;
  }
}

/**
 * Registers CodeLens provider for C/C++ (and plaintext file fallback).
 */
export function registerCppCodeLensProvider(
  context: vscode.ExtensionContext,
  provider: CppValueCodeLensProvider
): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "c", scheme: "file" },
        { language: "cpp", scheme: "file" },
        { language: "c", scheme: "untitled" },
        { language: "cpp", scheme: "untitled" },
        { language: "c", scheme: "vscode-userdata" },
        { language: "cpp", scheme: "vscode-userdata" },
        { language: "plaintext", scheme: "file" },
      ],
      provider
    )
  );
}
