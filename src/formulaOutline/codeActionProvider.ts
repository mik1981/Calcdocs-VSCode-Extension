// codeActionProvider.ts

import * as vscode from 'vscode';
import { inferDimension, dimToString } from './dimensionEvaluator';
import { FormulaRegistry } from './formulaRegistry';

export class FormulaCodeActionProvider implements vscode.CodeActionProvider {

  constructor(private registry: FormulaRegistry) {}

  async provideCodeActions(doc: vscode.TextDocument, range: vscode.Range) {

    const actions: vscode.CodeAction[] = [];
    const formulas = await this.registry.getFormulas(doc.uri.toString());

    const formula = formulas.find(f => f.lineStart === range.start.line);
    if (!formula?.expr) return [];

    const inferred = inferDimension(formula.expr, formulas, formula.unit);

    if (inferred.dim) {
      const fix = new vscode.CodeAction('Fix unit to inferred', vscode.CodeActionKind.QuickFix);

      const dimStr = dimToString(inferred.dim);

      fix.edit = new vscode.WorkspaceEdit();

      const line = doc.lineAt(formula.lineStart + 1);
      const unitIdx = line.text.indexOf('unit:');

      if (unitIdx !== -1) {
        fix.edit.replace(
          doc.uri,
          new vscode.Range(
            formula.lineStart + 1,
            unitIdx,
            formula.lineStart + 1,
            line.text.length
          ),
          `  unit: ${dimStr}`
        );
      }

      actions.push(fix);
    }

    return actions;
  }
}