import * as vscode from 'vscode';
import type { TextDocument } from 'vscode';
import type { OutlineFormula } from './formulaParser';
import { parseFormulaDocument } from './formulaParser';

export class FormulaRegistry {
  private formulas = new Map<string, OutlineFormula[]>(); // uri -> formulas[]
  private disposables: vscode.Disposable[] = [];

  constructor() {
    const debounceParse = this.debounce(async (doc: TextDocument) => {
      const uri = doc.uri.toString();
      if (!this.isFormulaFile(doc)) return;

      const lines = doc.getText().split(/\r?\n/);
      const formulas = parseFormulaDocument(lines, doc.uri.fsPath);
      this.formulas.set(uri, formulas);
    }, 300);

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(debounceParse),
      vscode.workspace.onDidChangeTextDocument(e => debounceParse(e.document)),
      vscode.workspace.onDidSaveTextDocument(debounceParse)
    );

    // Parsa subito tutti i file yaml già aperti all'avvio
    vscode.workspace.textDocuments.forEach(doc => {
      if (this.isFormulaFile(doc)) {
        debounceParse(doc);
      }
    });
  }

  private isFormulaFile(doc: TextDocument): boolean {
    const name = doc.fileName.toLowerCase();
    return doc.languageId === 'yaml' && /.*formulas.*\.yaml$/i.test(name);
  }

  async getFormulas(uri: string): Promise<OutlineFormula[]> {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri);
    if (doc) {
      await this.parseDocument(doc);
    }
    return this.formulas.get(uri) ?? [];
  }

  async parseDocument(doc: TextDocument): Promise<OutlineFormula[]> {
    const uri = doc.uri.toString();
    if (!this.isFormulaFile(doc)) return [];

    const lines = doc.getText().split(/\r?\n/);
    const formulas = parseFormulaDocument(lines, doc.uri.fsPath);
    this.formulas.set(uri, formulas);
    return formulas;
  }

  async getAllFormulas(): Promise<OutlineFormula[]> {
    const all: OutlineFormula[] = [];
    for (const formulas of this.formulas.values()) {
      all.push(...formulas);
    }
    return all;
  }

  private debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), delay);
    };
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    this.formulas.clear();
  }
}
