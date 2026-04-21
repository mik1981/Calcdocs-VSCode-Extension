// hoverProvider.ts

import * as vscode from 'vscode';
import { inferDimension, dimToString, getUnitDim } from './dimensionEvaluator';
import { FormulaRegistry } from './formulaRegistry';
import { FormulaCodeActionProvider } from './codeActionProvider';
import { FormulaOutlineProvider } from './formulaOutlineProvider';


export class FormulaHoverProvider implements vscode.HoverProvider {

  constructor(private registry: FormulaRegistry) {}

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position) {

    const formulas = await this.registry.getFormulas(doc.uri.toString());
    const line = doc.lineAt(pos.line).text;

    const formula = formulas.find(f => f.lineStart === pos.line);
    if (!formula?.expr) return;

    const inferred = inferDimension(formula.expr, formulas, formula.unit);
    const declared = getUnitDim(formula.unit);

    let md = new vscode.MarkdownString();

    md.appendMarkdown(`### 🧮 Formula\n`);
    md.appendCodeblock(formula.expr, 'c');

    if (inferred.dim) {
      md.appendMarkdown(`\n**Inferred:** \`${dimToString(inferred.dim)}\``);
    }

    if (declared) {
      md.appendMarkdown(`\n**Declared unit:** \`${formula.unit}\``);
    }

    if (inferred.error) {
      md.appendMarkdown(`\n\n⛔ **Invalid operation**`);
    }
    else if (inferred.dim && declared && dimToString(inferred.dim) !== dimToString(declared)) {
      md.appendMarkdown(`\n\n⚠ **Dimension mismatch**`);
    }

    return new vscode.Hover(md);
  }
}

export function registerFormulaOutlineHoverProvider(
  context: vscode.ExtensionContext,
  registry: FormulaRegistry
): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { language: 'yaml', pattern: '**/*formulas*.yaml' },
      new FormulaHoverProvider(registry)
    )
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'yaml', pattern: '**/*formulas*.yaml' },
      new FormulaCodeActionProvider(registry),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );
}