import * as vscode from "vscode";

import { parseCppSymbolDefinition } from "../core/cppParser";
import {
  buildCompositeExpressionPreview,
  isCompositeExpression,
} from "../core/expression";
import { CalcDocsState } from "../core/state";
import { updateBraceDepth } from "../utils/braceDepth";
import { formatNumbersWithThousandsSeparator } from "../utils/nformat";

const CODELENS_PREVIEW_MAX_LEN = 140;
const DEFINE_DIRECTIVE_RX = /^\s*#\s*define\b/;

function normalizePreviewText(expr: string): string {
  const compact = expr.replace(/\s+/g, " ").trim();
  const withoutCast = compact.replace(
    /^\(\s*(?:u?int(?:8|16|32)|u?int(?:8|16|32)_t|float|double)\s*\)\s*\((.+)\)$/i,
    "$1"
  );

  if (withoutCast.length <= CODELENS_PREVIEW_MAX_LEN) {
    return withoutCast;
  }

  return `${withoutCast.slice(0, CODELENS_PREVIEW_MAX_LEN)}...`;
}

function buildOpenFormulaCodeLens(
  state: CalcDocsState,
  symbol: string,
  line: number
): vscode.CodeLens | null {
  const formula = state.formulaIndex.get(symbol);
  if (!formula?._filePath) {
    return null;
  }

  const formulaLine = (formula._line ?? 0) + 1;
  return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
    title: `CalcDocs: open formula ${formula._filePath}:${formulaLine}`,
    command: "calcdocs.fixMismatch",
    arguments: [symbol],
  });
}

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
    if (!this.state.enabled) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const lines = document.getText().split(/\r?\n/);
    const renderedAmbiguityLens = new Set<string>();
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const canParseDeclaration = braceDepth === 0 || DEFINE_DIRECTIVE_RX.test(line);
      const parsed = canParseDeclaration ? parseCppSymbolDefinition(line) : undefined;
      if (!parsed) {
        braceDepth = updateBraceDepth(braceDepth, line);
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

        braceDepth = updateBraceDepth(braceDepth, line);
        continue;
      }

      const displayName = parsed.macroParams
        ? `${name}(${parsed.macroParams.join(", ")})`
        : name;
      const isFunctionLikeMacro = parsed.macroParams != null;

      const preview = buildCompositeExpressionPreview(
        expr,
        this.state.symbolValues,
        this.state.allDefines,
        this.state.functionDefines,
        {},
        this.state.defineConditions
      );
      const value = preview.value;

      if (
        !isFunctionLikeMacro &&
        !isCompositeExpression(expr, this.state.symbolValues, this.state.allDefines)
      ) {
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
                ? `❗CalcDocs: ${name} differs from YAML value ${formula.valueCalc} (click to open)❗`
                : `❗CalcDocs: ${name} needs a check (click to open)❗`,
              command: "calcdocs.fixMismatch",
              arguments: [name],
            })
          );
        } else {
          const openFormulaLens = buildOpenFormulaCodeLens(this.state, name, i);
          if (openFormulaLens) {
            lenses.push(openFormulaLens);
          }
        }
        
        braceDepth = updateBraceDepth(braceDepth, line);
        continue;
      }

      if (typeof value === "number") {
        const svalue = formatNumbersWithThousandsSeparator(this.state, `${value}`);
        lenses.push(
          new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
            title: `CalcDocs: ${displayName} = ${svalue}`,
            command: "",
          })
        );
        braceDepth = updateBraceDepth(braceDepth, line);
        continue;
      }

      const previewText = formatNumbersWithThousandsSeparator(this.state, normalizePreviewText(preview.expanded));
      if (previewText && previewText !== expr.trim()) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(i, 0, i, 0), {
            title: `CalcDocs: ${displayName} -> ${previewText}`,
            command: "",
          })
        );
      }

      braceDepth = updateBraceDepth(braceDepth, line);
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
