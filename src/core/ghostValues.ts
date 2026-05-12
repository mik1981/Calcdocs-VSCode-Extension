import * as vscode from "vscode";

import { collectCppCodeLensItems } from "./cppCodeLensItems";
import { shouldRenderGhostInsteadOfCodeLens } from "./ghostPolicy";
import { CalcDocsState } from "./state";
import { evaluateInlineCalcs } from "./inlineCalc";

const INLINE_CALC_GHOST_LANGUAGES = new Set(["c", "cpp", "plaintext", "yaml"]);
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

  // Strip #define NAME / #define NAME(params) prefix regardless of kind
  const defineMatch = noPrefix.match(/^#define\s+[A-Za-z_]\w*(?:\s*\([^)]*\))?\s+(.+)$/);
  const withoutDefine = defineMatch ? defineMatch[1].trim() : noPrefix;
  
  // For expandedPreview/functionCall: use full stripped preview (shows expression/structure)
  if (kind === "expandedPreview" || kind === "functionCall") {
    return withoutDefine;
  }
  
  if (defineMatch) {
    return withoutDefine;
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

    const perLineGhostTexts = new Map<number, string[]>();

    // ── C/C++ code-lens ghost values (existing logic, C only) ──────────────
    if (document.languageId === "c") {
      const maxItemsPerFile = Math.max(1, this.state.cppCodeLens.maxItemsPerFile);
      const items = collectCppCodeLensItems(document, this.state, maxItemsPerFile * 4);

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
    }

    // ── Inline-calc ghost values for all supported languages ───────────────
    if (INLINE_CALC_GHOST_LANGUAGES.has(document.languageId)) {
      const results = evaluateInlineCalcs(
        document.getText(),
        this.state,
        { includeAssignments: false },
        document.languageId
      );

      for (const result of results) {
        if (result.line < 0 || result.line >= document.lineCount) {
          continue;
        }
        const texts = perLineGhostTexts.get(result.line) ?? [];
        texts.push(result.displayValue);
        perLineGhostTexts.set(result.line, texts);
      }
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
            contentText: ` ← ${toGhostText(titles)}`,
          },
        },
      });
    }

    editor.setDecorations(this.decorationType, decorations);
  }
}
