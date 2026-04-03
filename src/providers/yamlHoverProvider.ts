import * as vscode from "vscode";

import { formatPreviewNumber } from "../core/preview";
import type { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";

function buildYamlHoverMarkdown(state: CalcDocsState, symbol: string): vscode.MarkdownString {
  const entry = state.formulaIndex.get(symbol);
  const lines: string[] = [];

  if (!entry) {
    return new vscode.MarkdownString("");
  }

  lines.push(`### ${entry.key}`);

  if (typeof entry.valueCalc === "number" && Number.isFinite(entry.valueCalc)) {
    lines.push(`- Value: \`${formatPreviewNumber(state, entry.valueCalc)}\``);
  } else {
    lines.push("- Value: `unresolved`");
  }

  if (entry.unit) {
    lines.push(`- Unit: \`${entry.unit}\``);
  }

  if (entry.exprType) {
    lines.push(`- Type: \`${entry.exprType}\``);
  }

  if (entry.formula) {
    lines.push("");
    lines.push("**Formula**");
    lines.push("```text");
    lines.push(entry.formula);
    lines.push("```");
  }

  if (entry.expanded) {
    lines.push("");
    lines.push("**Expanded**");
    lines.push("```text");
    lines.push(entry.expanded);
    lines.push("```");
  }

  if (entry.resolvedDependencies && entry.resolvedDependencies.length > 0) {
    lines.push("");
    lines.push("**Resolved symbols**");
    for (const resolved of entry.resolvedDependencies) {
      lines.push(`- \`${resolved}\``);
    }
  }

  if (entry.explainSteps && entry.explainSteps.length > 0) {
    lines.push("");
    lines.push("**Explain**");
    lines.push("```text");
    for (const step of entry.explainSteps) {
      lines.push(step);
    }
    lines.push("```");
  }

  if (entry.evaluationErrors && entry.evaluationErrors.length > 0) {
    lines.push("");
    lines.push("**Errors**");
    for (const error of entry.evaluationErrors) {
      lines.push(`- ${error}`);
    }
  }

  if (entry.evaluationWarnings && entry.evaluationWarnings.length > 0) {
    lines.push("");
    lines.push("**Warnings**");
    for (const warning of entry.evaluationWarnings) {
      lines.push(`- ${warning}`);
    }
  }

  const markdown = new vscode.MarkdownString(lines.join("\n"));
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  return markdown;
}

export function registerYamlHoverProvider(
  context: vscode.ExtensionContext,
  state: CalcDocsState
): void {
  const selector: vscode.DocumentSelector = [
    { language: "yaml", scheme: "file" },
    { language: "yaml", scheme: "untitled" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        if (!state.enabled) {
          return undefined;
        }

        const symbol = pickWord(document, position);
        if (!symbol) {
          return undefined;
        }

        const entry = state.formulaIndex.get(symbol);
        if (!entry) {
          return undefined;
        }

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          return undefined;
        }

        const markdown = buildYamlHoverMarkdown(state, symbol);
        if (!markdown.value.trim()) {
          return undefined;
        }

        return new vscode.Hover(markdown, range);
      },
    })
  );
}
