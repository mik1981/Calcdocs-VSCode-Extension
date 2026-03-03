import * as vscode from "vscode";

import { registerCommands } from "./commands/commands";
import { runAnalysis } from "./core/analysis";
import { getConfig } from "./core/config";
import { createCalcDocsState } from "./core/state";
import { AnalysisScheduler } from "./infra/watchers";
import {
  CppValueCodeLensProvider,
  registerCppCodeLensProvider,
} from "./providers/codeLensProvider";
import { registerDefinitionProviders } from "./providers/definitionProvider";
import { registerCppHoverProvider } from "./providers/hoverProvider";
import {
  createStatusBar,
  updateStatusBar,
  updateStatusBarVisibility,
} from "./ui/statusBar";

let outputChannel: vscode.OutputChannel | undefined;
let scheduler: AnalysisScheduler | undefined;
let statusBar: vscode.StatusBarItem | undefined;

/**
 * Extension entry point.
 * Wires state, providers, commands, scheduler, and the status bar.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("CalcDocs");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[activate] CalcDocs");

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    outputChannel.appendLine("[activate] No workspace folder found.");
    return;
  }

  const state = createCalcDocsState(workspaceRoot, outputChannel);

  statusBar = createStatusBar(context);

  const codeLensProvider = new CppValueCodeLensProvider(state);

  /**
   * Runs analysis and synchronizes all UI pieces that depend on current state.
   * Example: after a YAML change this updates formula index, status bar, and lenses.
   */
  const runAnalysisAndRefreshUi = async (): Promise<void> => {
    await runAnalysis(state);

    if (statusBar) {
      updateStatusBar(statusBar, state.formulaIndex.size);
      updateStatusBarVisibility(statusBar, state.hasFormulasFile);
    }

    codeLensProvider.refresh();
  };

  await runAnalysisAndRefreshUi();

  const config = getConfig();

  registerDefinitionProviders(context, state, config.enableCppProviders);
  registerCppHoverProvider(context, state, config.enableCppProviders);
  registerCppCodeLensProvider(context, codeLensProvider);

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(() => {
      codeLensProvider.refresh();
    })
  );

  scheduler = new AnalysisScheduler(state, runAnalysisAndRefreshUi);
  scheduler.applyConfiguration(context, config);
  context.subscriptions.push(scheduler);

  registerCommands({
    context,
    state,
    scheduler,
    runAnalysisAndRefreshUi,
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("calcdocs")) {
        return;
      }

      const nextConfig = getConfig();
      scheduler?.applyConfiguration(context, nextConfig);
      void runAnalysisAndRefreshUi();
    })
  );
}

/**
 * Extension shutdown hook.
 * Releases timers, watchers, output channel, and status bar resources.
 */
export async function deactivate(): Promise<void> {
  scheduler?.dispose();

  if (outputChannel) {
    outputChannel.appendLine("[deactivate] CalcDocs");
    outputChannel.dispose();
  }

  statusBar?.dispose();
}
