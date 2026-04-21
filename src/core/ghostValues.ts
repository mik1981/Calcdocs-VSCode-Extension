import * as vscode from "vscode";

import { collectCppCodeLensItems } from "./cppCodeLensItems";
import { shouldRenderGhostInsteadOfCodeLens } from "./ghostPolicy";
import { CalcDocsState } from "./state";

const MAX_GHOST_TEXT_LEN = 180;

function clampGhostText(text: string): string {
  if (text.length <= MAX_GHOST_TEXT_LEN) {
    return text;
  }

  return `${text.slice(0, MAX_GHOST_TEXT_LEN - 3)}...`;
}

export function extractPureGhostValue(title: string, kind: string): string {
  const noIcon = title.replace(/^\$\([^)]+\)\s*/, "");
  const noPrefix = noIcon.replace(/^CalcDocs:\s*/, "").trim();
  
  // For expandedPreview: use full stripped preview (shows expression)
  /*if (kind === "expandedPreview") {
    return noPrefix;
  }*/
  
  // CASO 1: #define NAME(params) VALUE → pure VALUE
  //const defineMatch = noPrefix.match(/^#define\s+[^\s]+\s+(.+)$/);
  // We match #define, then the name with optional params, then the value.
  const defineMatch = noPrefix.match(/^#define\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s+(.+)$/);
  if (defineMatch) {
    return defineMatch[1].trim();
  }
  
  // CASO 2: NAME = VALUE → pure VALUE
  const constMatch = noPrefix.match(/^[^=]+\s*=\s*(.+)$/);
  if (constMatch) {
    return constMatch[1].trim();
  }

  // CASO 3: Anonymous expressions (e.g. from control flow)
  // If it starts with "(" and ends with ")", it might be an anonymous expression preview
  // e.g. "((Flags < 101))" -> "(Flags < 101)"
  if (noPrefix.startsWith("(") && noPrefix.endsWith(")")) {
    return noPrefix;
  }
  
  // Fallback: full stripped text (errors, ambiguity, etc.)
  return noPrefix || title;
}

function toGhostText(titles: string[]): string {
  const joined = titles.join(" | ");
  return clampGhostText(joined);
}

export class GhostValueProvider {
  private readonly decorationType: vscode.TextEditorDecorationType;

  constructor(private readonly state: CalcDocsState) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 12px",
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
      },
    });
  }

  public update(editor: vscode.TextEditor): void {
    if (!editor) {
      return;
    }

    const document = editor.document;
    if (!this.state.enabled || !this.state.inlineGhostEnabled || document.languageId !== "c") {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const maxItemsPerFile = Math.max(1, this.state.cppCodeLens.maxItemsPerFile);
    const items = collectCppCodeLensItems(document, this.state, maxItemsPerFile);
    const perLineGhostTexts = new Map<number, string[]>();

    for (const item of items) {
      if (!shouldRenderGhostInsteadOfCodeLens(document, item, this.state)) {
        continue;
      }

      const normalizedTitle = extractPureGhostValue(item.title, item.kind);
      if (!normalizedTitle) {
        continue;
      }

      const texts = perLineGhostTexts.get(item.line) ?? [];
      texts.push(normalizedTitle);
      perLineGhostTexts.set(item.line, texts);
    }

    const decorations: vscode.DecorationOptions[] = [];
    for (const [line, titles] of perLineGhostTexts) {
      if (line < 0 || line >= document.lineCount || titles.length === 0) {
        continue;
      }

      const lineText = document.lineAt(line).text;
      decorations.push({
        range: new vscode.Range(line, lineText.length, line, lineText.length),
        renderOptions: {
          after: {
            contentText: ` <- ${toGhostText(titles)}`,
          },
        },
      });
    }

    editor.setDecorations(this.decorationType, decorations);
  }
}
