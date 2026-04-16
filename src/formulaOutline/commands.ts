import * as vscode from 'vscode';
import { FormulaRegistry } from './formulaRegistry';

export function registerFormulaCommands(context: vscode.ExtensionContext, registry: FormulaRegistry) {
  const foldAll = vscode.commands.registerCommand('calcdocs.formulas.foldAll', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'yaml') {
      vscode.window.showInformationMessage('Open a formulas.yaml file');
      return;
    }

    const formulas = await registry.getFormulas(editor.document.uri.toString());
    if (formulas.length === 0) {
      vscode.window.showInformationMessage('No formulas found');
      return;
    }

    // Use VSCode folding API
    for (const formula of formulas) {
      const range = new vscode.Range(
        formula.lineStart,
        0,
        formula.lineEnd,
        1000 // Full line
      );
      await vscode.commands.executeCommand('editor.fold', { 
        selectionLines: [formula.lineStart, formula.lineEnd] 
      });
    }

    vscode.window.showInformationMessage(`Folded ${formulas.length} formulas`);
  });

  context.subscriptions.push(foldAll);
}

