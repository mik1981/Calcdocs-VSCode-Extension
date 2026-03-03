import * as vscode from "vscode";

/**
 * Creates CalcDocs status bar item and binds click action to manual refresh.
 */
export function createStatusBar(
  context: vscode.ExtensionContext
): vscode.StatusBarItem {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );

  statusBar.text = "Initializing CalcDocs...";
  statusBar.command = "calcdocs.forceRefresh";

  context.subscriptions.push(statusBar);

  return statusBar;
}

/**
 * Updates indexed formulas counter shown in status bar.
 */
export function updateStatusBar(statusBar: vscode.StatusBarItem, formulaCount: number): void {
  statusBar.text = `$(refresh) CalcDocs: ${formulaCount}`;
  statusBar.tooltip = "Updates indexed formulas";
}

/**
 * Shows status bar only when a formulas YAML file is present.
 */
export function updateStatusBarVisibility(
  statusBar: vscode.StatusBarItem,
  hasFormulasFile: boolean
): void {
  if (hasFormulasFile) {
    statusBar.show();
    return;
  }

  statusBar.hide();
}
