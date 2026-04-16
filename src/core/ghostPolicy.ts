import * as vscode from "vscode";
import { collectCppCodeLensItems, type CppCodeLensItem } from "./cppCodeLensItems";
import { extractPureGhostValue } from "./ghostValues";
import { CalcDocsState } from "./state";

const GHOST_SUPPORTED_LANGUAGE = "c";

function isGhostReplaceableItem(item: CppCodeLensItem): boolean {
  return item.kind === "resolvedValue" || item.kind === "expandedPreview";
}

export function shouldRenderGhostInsteadOfCodeLens(
  document: vscode.TextDocument,
  item: CppCodeLensItem,
  state: CalcDocsState
): boolean {
  if (!state.enabled || !state.inlineGhostEnabled) {
    return false;
  }

  if (document.languageId !== GHOST_SUPPORTED_LANGUAGE) {
    return false;
  }

  if (item.line < 0 || item.line >= document.lineCount) {
    return false;
  }

  if (!isGhostReplaceableItem(item)) {
    return false;
  }

  // Keep ghost rendering active even with trailing comments:
  // parser/preview already strip comments where needed.
  return true;
}

export function getPotentialGhostItems(
  document: vscode.TextDocument,
  line: number,
  state: CalcDocsState
): CppCodeLensItem[] {
  const maxItems = Math.max(1, state.cppCodeLens.maxItemsPerFile || 40);
  const allItems = collectCppCodeLensItems(document, state, maxItems);
  return allItems.filter(
    (item) => item.line === line && isGhostReplaceableItem(item)
  );
}

export function shouldRenderGhost(
  document: vscode.TextDocument,
  line: number,
  state: CalcDocsState
): boolean {
  const items = getPotentialGhostItems(document, line, state);
  for (const item of items) {
    if (!shouldRenderGhostInsteadOfCodeLens(document, item, state)) {
      continue;
    }

    const ghostText = extractPureGhostValue(item.title, item.kind);
    if (ghostText && ghostText.trim().length > 0) {
      return true;
    }
  }

  return false;
}

export function shouldShowCodeLens(
  document: vscode.TextDocument,
  line: number,
  state: CalcDocsState
): boolean {
  if (!state.cppCodeLens.enabled && !state.inlineCodeLens.enabled) {
    return false;
  }

  const items = getPotentialGhostItems(document, line, state);
  if (items.length === 0) {
    return false;
  }

  return !items.every((item) =>
    shouldRenderGhostInsteadOfCodeLens(document, item, state)
  );
}

export function hasRichHoverContent(state: CalcDocsState): boolean {
  return (
    state.cppHover.showFormulaSection ||
    state.cppHover.showConditionalDefinitions ||
    state.cppHover.showInheritedAmbiguity ||
    state.inlineHover.showDimension ||
    state.inlineHover.showWarnings ||
    state.cppHover.showCastOverflow ||
    state.cppHover.showKnownValue
  );
}

export type LineDisplayPriority = {
  showGhost: boolean;
  showCodeLens: boolean;
  showHover: boolean;
};

export function getLineDisplayPriority(
  document: vscode.TextDocument,
  line: number,
  state: CalcDocsState
): LineDisplayPriority {
  const showGhost = shouldRenderGhost(document, line, state);
  const showCodeLens = !showGhost && shouldShowCodeLens(document, line, state);
  const richHover = hasRichHoverContent(state);
  const showHover = richHover || (!showGhost && !showCodeLens);

  return { showGhost, showCodeLens, showHover };
}

