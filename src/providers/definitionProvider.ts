import * as path from "path";
import * as vscode from "vscode";

import { CalcDocsState } from "../core/state";
import { pickWord } from "../utils/editor";

function getSymbolLocations(
  state: CalcDocsState,
  word: string
): vscode.Location[] {
  const variants = state.symbolConditionalDefs.get(word) ?? [];
  const variantLocations = variants.map(
    (variant) =>
      new vscode.Location(
        vscode.Uri.file(path.resolve(state.workspaceRoot, variant.file)),
        new vscode.Range(variant.line, 0, variant.line, 0)
      )
  );

  if (variantLocations.length > 0) {
    const unique = new Map<string, vscode.Location>();

    for (const location of variantLocations) {
      const key = `${location.uri.fsPath}:${location.range.start.line}`;
      unique.set(key, location);
    }

    return Array.from(unique.values());
  }

  const symbolLocation = state.symbolDefs.get(word);
  if (!symbolLocation) {
    return [];
  }

  return [
    new vscode.Location(
      vscode.Uri.file(path.resolve(state.workspaceRoot, symbolLocation.file)),
      new vscode.Range(symbolLocation.line, 0, symbolLocation.line, 0)
    ),
  ];
}

/**
 * Registers "Go to Definition" support:
 * - YAML symbol -> YAML formula declaration
 * - optional C/C++ symbol -> YAML formula or C/C++ symbol definition
 */
export function registerDefinitionProviders(
  context: vscode.ExtensionContext,
  state: CalcDocsState,
  enableCppProviders: boolean
): void {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [
        { language: "yaml", scheme: "file" },
        { language: "yaml", scheme: "untitled" },
      ],
      {
        provideDefinition(document, position) {
          if (!state.enabled) {
            return undefined;
          }

          const word = pickWord(document, position);
          if (!word) {
            return undefined;
          }

          const formula = state.formulaIndex.get(word);
          if (!formula || !formula._filePath) {
            return undefined;
          }

          const targetFile = path.resolve(state.workspaceRoot, formula._filePath);
          const line = formula._line ?? 0;

          return new vscode.Location(
            vscode.Uri.file(targetFile),
            new vscode.Range(line, 0, line, 0)
          );
        },
      }
    )
  );

  if (!enableCppProviders) {
    return;
  }

  // C/C++ fallback provider used when C/C++ language extensions do not own the symbol.
  const cppSelectors: vscode.DocumentSelector = [
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" },
    { language: "c", scheme: "untitled" },
    { language: "cpp", scheme: "untitled" },
  ];

  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(cppSelectors, {
      provideDefinition(document, position) {
        if (!state.enabled) {
          return undefined;
        }

        const word = pickWord(document, position);
        if (!word) {
          return undefined;
        }

        const formula = state.formulaIndex.get(word);
        if (formula?._filePath) {
          const targetFile = path.resolve(state.workspaceRoot, formula._filePath);
          const line = formula._line ?? 0;

          return new vscode.Location(
            vscode.Uri.file(targetFile),
            new vscode.Range(line, 0, line, 0)
          );
        }

        const symbolLocations = getSymbolLocations(state, word);
        if (symbolLocations.length === 0) {
          return undefined;
        }

        if (symbolLocations.length === 1) {
          return symbolLocations[0];
        }

        return symbolLocations;
      },
    })
  );
}
