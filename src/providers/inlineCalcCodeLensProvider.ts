import * as vscode from "vscode";

import { evaluateInlineCalcs, type InlineCalcResult } from "../core/inlineCalc";
import { CalcDocsState } from "../core/state";

const CODELENS_MAX_TITLE_LEN = 160;
const CODELENS_SOURCE_PREVIEW_LEN = 80;

function clampText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}

function buildCodeLensTitle(result: InlineCalcResult): string {
  const sourcePreview = clampText(result.source, CODELENS_SOURCE_PREVIEW_LEN);

  if (result.severity === "error") {
    return clampText(
      `CalcDocs: ${sourcePreview} -> ERROR (${result.error ?? "unresolved"})`,
      CODELENS_MAX_TITLE_LEN
    );
  }

  if (result.severity === "warning") {
    const warning = result.warnings[0] ?? "dimension warning";
    return clampText(
      `CalcDocs: ${sourcePreview} -> WARNING (${warning})`,
      CODELENS_MAX_TITLE_LEN
    );
  }

  return clampText(
    `CalcDocs: ${sourcePreview} -> ${result.displayValue}`,
    CODELENS_MAX_TITLE_LEN
  );
}

/**
 * Shows inline calculation results for comment-based expressions:
 * - @name = ...
 * - = expression
 */
export class InlineCalcCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly state: CalcDocsState) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.state.enabled || !this.state.inlineCalcEnableCodeLens) {
      return [];
    }

    const results = evaluateInlineCalcs(document.getText(), this.state, {
      includeAssignments: false,
    }, document.languageId);
    const lenses: vscode.CodeLens[] = [];

    for (const result of results) {
      lenses.push(
        new vscode.CodeLens(new vscode.Range(result.line, 0, result.line, 0), {
          title: buildCodeLensTitle(result),
          command: "",
        })
      );
    }

    return lenses;
  }
}

export function registerInlineCalcCodeLensProvider(
  context: vscode.ExtensionContext,
  provider: InlineCalcCodeLensProvider
): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "c", scheme: "file" },
        { language: "cpp", scheme: "file" },
        { language: "c", scheme: "untitled" },
        { language: "cpp", scheme: "untitled" },
        { language: "plaintext", scheme: "file" },
        { language: "yaml", scheme: "file" },
        { language: "yaml", scheme: "untitled" },
      ],
      provider
    )
  );
}
