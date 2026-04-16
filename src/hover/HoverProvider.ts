import * as vscode from "vscode";

import { ClangdService } from "../clangd/ClangdService";
import { CalcDocsState } from "../core/state";
import { HybridSymbolProvider } from "../symbols/HybridSymbolProvider";
import { CSymbol } from "../symbols/SymbolTypes";

type ExternalProvidersState = {
  clangdActive: boolean;
  cpptoolsActive: boolean;
};

function getExternalProvidersState(clangdService: ClangdService): ExternalProvidersState {
  const clangdActive = clangdService.getStatus().available;
  const cpptoolsExtension = vscode.extensions.getExtension("ms-vscode.cpptools");
  const cpptoolsActive = Boolean(cpptoolsExtension?.isActive);

  return {
    clangdActive,
    cpptoolsActive,
  };
}

function isParserBackedField(source: CSymbol["fieldSources"][keyof CSymbol["fieldSources"]]): boolean {
  return source === "parser";
}

function buildCalcDocsAugmentation(
  symbol: CSymbol,
  clangdService: ClangdService
): vscode.MarkdownString | null {
  const lines: string[] = [];

  if (isParserBackedField(symbol.fieldSources.value) && symbol.value != null) {
    lines.push(`**Value (CalcDocs):** \`${symbol.value}\``);
  }

  if (isParserBackedField(symbol.fieldSources.expression) && symbol.expression) {
    lines.push(`**Expression (CalcDocs):** \`${symbol.expression}\``);
  }

  if (isParserBackedField(symbol.fieldSources.location) && symbol.location) {
    const fileName = symbol.location.uri.path.split("/").pop() ?? symbol.location.uri.fsPath;
    const line = symbol.location.range.start.line + 1;
    lines.push(`**Definition (CalcDocs):** \`${fileName}:${line}\``);
  }

  if (symbol.notes && symbol.notes.length > 0) {
    lines.push(`**Notes:**\n${symbol.notes.map((note) => `- ${note}`).join("\n")}`);
  }

  const status = clangdService.getStatus();
  if (status.available && !status.hasCompileCommands) {
    lines.push("- clangd active without `compile_commands.json`: confidence reduced.");
  }

  if (lines.length === 0) {
    return null;
  }

  const markdown = new vscode.MarkdownString(
    [`*CalcDocs additional context*`, ...lines].join("\n\n")
  );
  markdown.isTrusted = false;
  markdown.supportHtml = false;
  return markdown;
}

export function registerHybridHoverProvider(
  context: vscode.ExtensionContext,
  state: CalcDocsState,
  hybridProvider: HybridSymbolProvider,
  clangdService: ClangdService,
  enableCppProviders: boolean
): void {
  if (!enableCppProviders) {
    return;
  }

  const selector: vscode.DocumentSelector = [
    { language: "c", scheme: "file" },
    { language: "cpp", scheme: "file" },
    { language: "c", scheme: "untitled" },
    { language: "cpp", scheme: "untitled" },
  ];

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        if (!state.enabled) {
          return undefined;
        }

        const { showHover } = require("../core/ghostPolicy").getLineDisplayPriority(
          document,
          position.line,
          state
        );
        if (!showHover) {
          return undefined;
        }

        const external = getExternalProvidersState(clangdService);
        if (!external.clangdActive && !external.cpptoolsActive) {
          // No external IntelliSense provider active: leave full hover ownership
          // to the legacy CalcDocs hover provider.
          return undefined;
        }

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
        if (!range) {
          return undefined;
        }

        return provideAugmentationHover(document, position, range);
      },
    })
  );

  async function provideAugmentationHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    range: vscode.Range
  ): Promise<vscode.Hover | undefined> {
    const symbol = await hybridProvider.getSymbolAtPosition(document, position);
    if (!symbol) {
      return undefined;
    }

    const augmentation = buildCalcDocsAugmentation(symbol, clangdService);
    if (!augmentation) {
      return undefined;
    }

    return new vscode.Hover(augmentation, range);
  }
}

