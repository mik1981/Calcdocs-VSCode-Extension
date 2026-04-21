import * as path from "path";
import * as vscode from "vscode";

import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";
import { CSymbol, SymbolKindType } from "./SymbolTypes";

function parserKindForSymbol(state: CalcDocsState, name: string): SymbolKindType {
  if (state.functionDefines.has(name) || state.allDefines.has(name)) {
    return "macro";
  }

  if (state.symbolValues.has(name)) {
    return "const";
  }

  return "variable";
}

function parserLocationForSymbol(
  state: CalcDocsState,
  name: string
): vscode.Location | undefined {
  const primary = state.symbolDefs.get(name);
  if (primary) {
    const file = path.resolve(state.workspaceRoot, primary.file);
    return new vscode.Location(
      vscode.Uri.file(file),
      new vscode.Position(primary.line, 0)
    );
  }

  const variant = state.symbolConditionalDefs.get(name)?.[0];
  if (!variant) {
    return undefined;
  }

  const file = path.resolve(state.workspaceRoot, variant.file);
  return new vscode.Location(vscode.Uri.file(file), new vscode.Position(variant.line, 0));
}

export class LegacyParserProvider {
  constructor(private readonly state: CalcDocsState) {}

  async getSymbolAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<CSymbol | null> {
    const name = pickWord(document, position);
    if (!name) {
      return null;
    }

    const valueNumber = this.state.symbolValues.get(name);
    const value = typeof valueNumber === "number" ? String(valueNumber) : undefined;
    const unit = this.state.symbolUnits.get(name);
    const expression = this.state.allDefines.get(name);
    const location = parserLocationForSymbol(this.state, name);

    const symbol: CSymbol = {
      name,
      kind: parserKindForSymbol(this.state, name),
      value,
      unit,
      expression,
      location,
      source: "parser",
      confidence: 0,
      fieldSources: {},
      notes: [],
    };

    if (value != null) {
      symbol.fieldSources.value = "parser";
    }
    if (expression != null) {
      symbol.fieldSources.expression = "parser";
    }
    if (location) {
      symbol.fieldSources.location = "parser";
    }

    if (
      !this.state.symbolValues.has(name) &&
      !this.state.allDefines.has(name) &&
      !this.state.symbolDefs.has(name)
    ) {
      return null;
    }

    return symbol;
  }
}

