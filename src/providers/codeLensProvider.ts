import * as vscode from "vscode";

import { parseCppSymbolDefinition } from "../core/cppParser";
import {
  evaluateCompositeExpression,
  isCompositeExpression,
} from "../core/expression";
import { CalcDocsState } from "../core/state";

/**
 * Adds inline CodeLens hints above C/C++ symbol definitions.
 * Example:
 * - "CalcDocs: K = 42" for resolvable expressions
 * - mismatch warning when YAML computed value diverges from C/C++
 */
export class CppValueCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly state: CalcDocsState) {}

  /**
   * Triggers VS Code to recompute lenses.
   */
  refresh(): void {
    this.emitter.fire();
  }

  /**
   * Builds CodeLens hints for each parsed symbol definition in the document.
   */
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);
    const renderedAmbiguityLens = new Set<string>();

    for (let i = 0; i < lines.length; i += 1) {
      const parsed = parseCppSymbolDefinition(lines[i]);
      if (!parsed) {
        continue;
      }

      const { name, expr } = parsed;
      const ambiguityRoots = this.state.symbolAmbiguityRoots.get(name) ?? [];
      if (ambiguityRoots.length > 0) {
        if (!renderedAmbiguityLens.has(name)) {
          renderedAmbiguityLens.add(name);
          const inheritedFrom = ambiguityRoots.filter((root) => root !== name);
          const title =
            inheritedFrom.length > 0
              ? `CalcDocs: ${name} depends on conditional symbols (${inheritedFrom.join(", ")})`
              : `CalcDocs: ${name} has multiple conditional definitions`;

          lenses.push(
            new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
              title,
              command: "",
            })
          );
        }

        continue;
      }

      const value = evaluateCompositeExpression(
        expr,
        this.state.symbolValues,
        this.state.allDefines
      );

      if (!isCompositeExpression(expr, this.state.symbolValues, this.state.allDefines)) {
        const formula = this.state.formulaIndex.get(name);

        let mismatch = false;

        if (
          formula &&
          typeof formula.valueCalc === "number" &&
          typeof value === "number"
        ) {
          const baseline = formula.valueCalc === 0 ? 1 : Math.abs(formula.valueCalc);
          const diff = Math.abs(formula.valueCalc - value) / baseline;
          mismatch = diff > 0.01;
        }

        if (mismatch) {
          lenses.push(
            new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
              title: formula
                ? `❗CalcDocs: ${name} differs from YAML value ${formula.valueCalc} (click to open)`
                : `❗CalcDocs: ${name} needs a check (click to open)`,
              command: "calcdocs.fixMismatch",
              arguments: [name],
            })
          );
        }

        continue;
      }

      if (typeof value === "number") {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
            title: `CalcDocs: ${name} = ${value}`,
            command: "",
          })
        );
      }
    }

    return lenses;
  }
}

/**
 * Registers CodeLens provider for C/C++ (and plaintext file fallback).
 */
export function registerCppCodeLensProvider(
  context: vscode.ExtensionContext,
  provider: CppValueCodeLensProvider
): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "c", scheme: "file" },
        { language: "cpp", scheme: "file" },
        { language: "c", scheme: "untitled" },
        { language: "cpp", scheme: "untitled" },
        { language: "c", scheme: "vscode-userdata" },
        { language: "cpp", scheme: "vscode-userdata" },
        { language: "plaintext", scheme: "file" },
      ],
      provider
    )
  );
}
