import * as vscode from "vscode";

import { evaluateInlineCalcs, type InlineCalcResult } from "../core/inlineCalc";
import { CalcDocsState } from "../core/state";

const ITEM_SOURCE_MAX_LEN = 72;

function clampText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}

function createInfoItem(label: string): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon("info");
  return item;
}

function createGuideItem(): vscode.TreeItem {
  const item = new vscode.TreeItem(
    "Open Inline HTML Guide",
    vscode.TreeItemCollapsibleState.None
  );
  item.iconPath = new vscode.ThemeIcon("book");
  item.command = {
    command: "calcdocs.inlineCalc.openGuide",
    title: "Open inline guide",
  };
  item.tooltip = "CalcDocs: Open Inline Guide";
  return item;
}

function toItemIcon(result: InlineCalcResult): vscode.ThemeIcon {
  if (result.severity === "error") {
    return new vscode.ThemeIcon("error");
  }

  if (result.severity === "warning") {
    return new vscode.ThemeIcon("warning");
  }

  return new vscode.ThemeIcon(
    result.kind === "assign" ? "symbol-variable" : "symbol-number"
  );
}

/**
 * Tree view provider used by the "CalcDocs Inline Results" mini panel.
 */
export class InlineCalcResultsViewProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly emitter = new vscode.EventEmitter<void>();
  private activeDocument: vscode.TextDocument | undefined;

  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly state: CalcDocsState) {}

  setActiveEditor(editor: vscode.TextEditor | undefined): void {
    this.activeDocument = editor?.document;
    this.refresh();
  }

  notifyDocumentChanged(document: vscode.TextDocument): void {
    if (!this.activeDocument) {
      return;
    }

    if (this.activeDocument.uri.toString() !== document.uri.toString()) {
      return;
    }

    this.refresh();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return [];
    }

    const items: vscode.TreeItem[] = [];//[createGuideItem()];

    if (!this.state.enabled) {
      items.push(createInfoItem("CalcDocs is disabled"));
      return items;
    }

    if (!this.activeDocument) {
      items.push(createInfoItem("Open a C/C++ file to see inline calc results"));
      return items;
    }

    const results = evaluateInlineCalcs(this.activeDocument.getText(), this.state, {}, this.activeDocument.languageId);
    if (results.length === 0) {
      items.push(createInfoItem("No inline calculations found (= ...)"));
      return items;
    }

    for (const result of results) {
      const lineLabel = `L${result.line + 1}`;
      const prefix = result.kind === "assign" ? "@" : "=";
      const label = `${lineLabel} ${prefix} ${clampText(
        result.source,
        ITEM_SOURCE_MAX_LEN
      )}`;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description =
        result.severity === "error"
          ? `ERROR: ${result.error ?? "unresolved"}`
          : result.severity === "warning"
            ? `WARN: ${result.warnings[0] ?? result.displayValue}`
            : result.displayValue;
      item.tooltip = [
        `${lineLabel}: ${result.source}`,
        `Result: ${result.displayValue}`,
        `Dimension: ${result.dimensionText}`,
        ...result.warnings.map((warning) => `Warning: ${warning}`),
        result.error ? `Error: ${result.error}` : "",
      ]
        .filter((line) => line.length > 0)
        .join("\n");
      item.iconPath = toItemIcon(result);
      item.command = {
        command: "calcdocs.inlineCalc.openResult",
        title: "Open inline calc result",
        arguments: [this.activeDocument.uri, result.line],
      };
      items.push(item);
    }

    return items;
  }
}
