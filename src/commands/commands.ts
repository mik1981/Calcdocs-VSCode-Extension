import * as fsp from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { writeBackYaml } from "../core/analysis";
import { getConfig } from "../core/config";
import { CalcDocsState, SymbolDefinitionLocation } from "../core/state";
import { AnalysisScheduler } from "../infra/watchers";
import { pickWord } from "../utils/editor";
import { localize } from "../utils/localize";

type RegisterCommandsParams = {
  context: vscode.ExtensionContext;
  state: CalcDocsState;
  scheduler: AnalysisScheduler;
  runAnalysisAndRefreshUi: () => Promise<void>;
};

/**
 * Registers all extension commands exposed in package.json.
 * Example: "calcdocs.forceRefresh" runs analysis and writes computed values back to YAML.
 */
export function registerCommands({
  context,
  state,
  scheduler,
  runAnalysisAndRefreshUi,
}: RegisterCommandsParams): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("calcdocs.forceRefresh", async () => {
      if (!state.enabled) {
        await vscode.window.showWarningMessage(
          localize("command.forceRefresh.warningDisabled")
        );
        return;
      }

      await runAnalysisAndRefreshUi();

      if (state.lastYamlPath && state.lastYamlRaw) {
        await writeBackYaml(state, state.lastYamlPath, state.lastYamlRaw);
      }

      await vscode.window.showInformationMessage("CalcDocs updated.");
    }),

    vscode.commands.registerCommand("calcdocs.showOutput", async () => {
      state.output.show(false);
    }),

    vscode.commands.registerCommand("calcdocs.setScanInterval", async () => {
      const currentInterval = getConfig().scanInterval;

      const input = await vscode.window.showInputBox({
        prompt: "Scan interval in seconds, 0 disables periodic scan",
        value: String(currentInterval),
        validateInput(value) {
          const numeric = Number(value);
          return !Number.isFinite(numeric) || numeric < 0
            ? "Insert a number >= 0"
            : null;
        },
      });

      if (input == null) {
        return;
      }

      const nextInterval = Number(input);

      await vscode.workspace
        .getConfiguration("calcdocs")
        .update("scanInterval", nextInterval, vscode.ConfigurationTarget.Workspace);

      scheduler.applyConfiguration(context, getConfig());
    }),

    vscode.commands.registerCommand("calcdocs.toggleEnabled", async () => {
      const currentEnabled = getConfig().enabled;
      const nextEnabled = !currentEnabled;

      await vscode.workspace
        .getConfiguration("calcdocs")
        .update("enabled", nextEnabled, vscode.ConfigurationTarget.Workspace);

      const stateLabel = nextEnabled ? localize("command.toggleEnabled.enabled") : localize("command.toggleEnabled.disabled");
      await vscode.window.showInformationMessage(stateLabel);
    }),

    vscode.commands.registerCommand("calcdocs.goToCounterpart", async () => {
      if (!state.enabled) {
        await vscode.window.showWarningMessage(
          localize("command.goToCounterpart.warningDisabled")
        );
        return;
      }

      await goToCounterpart(state);
    }),

    vscode.commands.registerCommand("calcdocs.fixMismatch", async (label: string) => {
      if (!state.enabled) {
        return;
      }

      await openFormulaDefinition(state, label);
    }),

    vscode.commands.registerCommand(
      "calcdocs.inlineCalc.openResult",
      async (uri: vscode.Uri | string, line: number) => {
        const targetUri =
          uri instanceof vscode.Uri ? uri : vscode.Uri.parse(String(uri));
        const safeLine = Number.isFinite(line) ? Math.max(0, Math.trunc(line)) : 0;
        await reveal(targetUri, safeLine);
      }
    ),

    vscode.commands.registerCommand("calcdocs.inlineCalc.openGuide", async () => {
      await openInlineCalcGuide(context);
    }),

    vscode.commands.registerCommand("calcdocs.openTestFolder", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      let testFolderUri: vscode.Uri | undefined;
      let testFileUri: vscode.Uri | undefined;

      // Determine test folder location (workspace or extension)
      if (workspaceRoot) {
        const workspaceTestFolder = vscode.Uri.file(path.join(workspaceRoot, "test"));
        const workspaceTestFile = vscode.Uri.file(path.join(workspaceRoot, "test", "src", "test.c"));
        try {
          await fsp.access(workspaceTestFolder.fsPath);
          testFolderUri = workspaceTestFolder;
          try {
            await fsp.access(workspaceTestFile.fsPath);
            testFileUri = workspaceTestFile;
          } catch {
            // test.c not found in workspace, will try extension
          }
        } catch {
          // test folder not in workspace
        }
      }

      // Fallback to extension test folder
      if (!testFolderUri) {
        const extensionTestFolder = vscode.Uri.joinPath(context.extensionUri, "test");
        const extensionTestFile = vscode.Uri.joinPath(context.extensionUri, "test", "src", "test.c");
        try {
          await fsp.access(extensionTestFolder.fsPath);
          testFolderUri = extensionTestFolder;
          try {
            await fsp.access(extensionTestFile.fsPath);
            testFileUri = extensionTestFile;
          } catch {
            // test.c not found in extension
          }
        } catch {
          // test folder not found in extension
        }
      }

      if (!testFolderUri) {
        await vscode.window.showWarningMessage(
          "CalcDocs test folder not found."
        );
        return;
      }

      // Check if test folder is already a workspace folder
      const existingFolder = vscode.workspace.workspaceFolders?.find(
        folder => folder.uri.fsPath === testFolderUri!.fsPath
      );

      if (!existingFolder) {
        // Add test folder as a workspace folder
        const success = vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders?.length ?? 0,
          0,
          { uri: testFolderUri, name: "CalcDocs Test" }
        );

        if (!success) {
          await vscode.window.showWarningMessage(
            "Failed to add test folder to workspace."
          );
          return;
        }
      }

      // Open test.c if available
      if (testFileUri) {
        const document = await vscode.workspace.openTextDocument(testFileUri);
        await vscode.window.showTextDocument(document, { preview: false });
      }
    })
  );
}

async function openInlineCalcGuide(
  context: vscode.ExtensionContext
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "calcdocsInlineGuide",
    "CalcDocs Guide",
    vscode.ViewColumn.Beside,
    {
      enableFindWidget: true,
      retainContextWhenHidden: true,
    }
  );

const locale = vscode.env.language.toLowerCase();
  const guideFileName = locale.startsWith('it') ? 'inline-calc-guide_it.html' : 'inline-calc-guide_en.html';
  const htmlUri = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    guideFileName
  );

  try {
    const htmlContent = await fsp.readFile(htmlUri.fsPath, "utf8");
    panel.webview.html = htmlContent;
  } catch {
    panel.webview.html = `<!doctype html>
<html><body><h2>CalcDocs Guide</h2><p>Guide file not found.</p></body></html>`;
  }
}

/**
 * Jumps between C/C++ symbols and YAML formula definitions.
 * Example:
 * - from C/C++ "FOO" -> open formulas*.yaml at FOO entry when available
 * - from YAML "FOO" -> open C/C++ symbol definition for FOO
 */
async function goToCounterpart(state: CalcDocsState): Promise<void> {
  const activeContext = getActiveWord();
  if (!activeContext) {
    return;
  }

  const { editor, word } = activeContext;
  const language = editor.document.languageId;

  if (language === "c" || language === "cpp") {
    const formula = state.formulaIndex.get(word);
    if (formula?._filePath) {
      const targetFile = path.resolve(state.workspaceRoot, formula._filePath);
      await reveal(vscode.Uri.file(targetFile), formula._line ?? 0);
      return;
    }

    const symbolLocation = await pickSymbolLocation(state, word);
    if (symbolLocation) {
      const targetFile = path.resolve(state.workspaceRoot, symbolLocation.file);
      await reveal(vscode.Uri.file(targetFile), symbolLocation.line);
    }

    return;
  }

  if (language === "yaml") {
    const symbolLocation = await pickSymbolLocation(state, word);
    if (symbolLocation) {
      const targetFile = path.resolve(state.workspaceRoot, symbolLocation.file);
      await reveal(vscode.Uri.file(targetFile), symbolLocation.line);
    }
  }
}

function getSymbolLocations(
  state: CalcDocsState,
  word: string
): SymbolDefinitionLocation[] {
  const variants = state.symbolConditionalDefs.get(word) ?? [];
  if (variants.length > 0) {
    const unique = new Map<string, SymbolDefinitionLocation>();

    for (const variant of variants) {
      const key = `${variant.file}:${variant.line}`;
      unique.set(key, {
        file: variant.file,
        line: variant.line,
      });
    }

    return Array.from(unique.values());
  }

  const single = state.symbolDefs.get(word);
  return single ? [single] : [];
}

async function pickSymbolLocation(
  state: CalcDocsState,
  word: string
): Promise<SymbolDefinitionLocation | null> {
  const locations = getSymbolLocations(state, word);
  if (locations.length === 0) {
    return null;
  }

  if (locations.length === 1) {
    return locations[0];
  }

  const picks = locations.map((location) => ({
    label: `${location.file}:${location.line + 1}`,
    location,
  }));

  const selected = await vscode.window.showQuickPick(picks, {
    placeHolder: localize("command.pickSymbol.placeholder", word),
  });

  return selected?.location ?? null;
}

/**
 * Opens the YAML block where a formula key is declared.
 * Example: "fix mismatch" lens passes label "PRESSURE_DROP" and this reveals its node.
 */
async function openFormulaDefinition(
  state: CalcDocsState,
  key: string
): Promise<void> {
  const formula = state.formulaIndex.get(key);
  if (!formula || !formula._filePath) {
    await vscode.window.showWarningMessage(`No formulas entry for '${key}'`);
    return;
  }

  const file = path.resolve(state.workspaceRoot, formula._filePath);
  const line = formula._line ?? 0;

  const document = await vscode.workspace.openTextDocument(file);
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/**
 * Returns active editor + symbol under cursor if it matches an identifier token.
 */
function getActiveWord():
  | { editor: vscode.TextEditor; word: string }
  | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const position = editor.selection.active;
  const word = pickWord(editor.document, position);

  if (!word) {
    return undefined;
  }

  return { editor, word };
}

/**
 * Opens a document and centers the given line.
 */
async function reveal(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: true });

  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
