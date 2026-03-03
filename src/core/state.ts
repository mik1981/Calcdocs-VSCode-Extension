import * as vscode from "vscode";

import { FormulaEntry } from "../types/FormulaEntry";

export type SymbolDefinitionLocation = {
  file: string;
  line: number;
};

export type SymbolConditionalDefinition = SymbolDefinitionLocation & {
  expr: string;
  condition: string;
};

export type CalcDocsState = {
  workspaceRoot: string;
  output: vscode.OutputChannel;
  lastYamlPath: string;
  lastYamlRaw: string;
  hasFormulasFile: boolean;
  ignoredDirs: Set<string>;
  formulaIndex: Map<string, FormulaEntry>;
  symbolValues: Map<string, number>;
  symbolDefs: Map<string, SymbolDefinitionLocation>;
  symbolConditionalDefs: Map<string, SymbolConditionalDefinition[]>;
  symbolAmbiguityRoots: Map<string, string[]>;
  allDefines: Map<string, string>;
};

/**
 * Creates the in-memory state container shared by analysis and VS Code providers.
 */
export function createCalcDocsState(
  workspaceRoot: string,
  output: vscode.OutputChannel
): CalcDocsState {
  return {
    workspaceRoot,
    output,
    lastYamlPath: "",
    lastYamlRaw: "",
    hasFormulasFile: false,
    ignoredDirs: new Set<string>(),
    formulaIndex: new Map<string, FormulaEntry>(),
    symbolValues: new Map<string, number>(),
    symbolDefs: new Map<string, SymbolDefinitionLocation>(),
    symbolConditionalDefs: new Map<string, SymbolConditionalDefinition[]>(),
    symbolAmbiguityRoots: new Map<string, string[]>(),
    allDefines: new Map<string, string>(),
  };
}
