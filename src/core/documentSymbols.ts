import { parseCppSymbolDefinition, type CppSymbolDefinition } from "./cppParser";
import { updateBraceDepth } from "../utils/braceDepth";

export const DEFINE_DIRECTIVE_RX = /^\s*#\s*define\b/;

export type DocumentSymbolDefinition = {
  line: number;
  lineText: string;
  isDefineLine: boolean;
  parsed: CppSymbolDefinition;
};

/**
 * Collects top-level C/C++ declarations parsed by parseCppSymbolDefinition.
 * #define directives are always parsed regardless of brace depth.
 */
export function collectDocumentSymbolDefinitions(
  documentText: string
): DocumentSymbolDefinition[] {
  const lines = documentText.split(/\r?\n/);
  const definitions: DocumentSymbolDefinition[] = [];
  let braceDepth = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    const isDefineLine = DEFINE_DIRECTIVE_RX.test(lineText);
    const canParseDeclaration = braceDepth === 0 || isDefineLine;
    const parsed = canParseDeclaration
      ? parseCppSymbolDefinition(lineText)
      : undefined;

    if (parsed) {
      definitions.push({
        line: lineIndex,
        lineText,
        isDefineLine,
        parsed,
      });
    }

    braceDepth = updateBraceDepth(braceDepth, lineText);
  }

  return definitions;
}

/**
 * Filters collected definitions by symbol name.
 */
export function findDocumentSymbolDefinitions(
  documentText: string,
  symbolName: string
): DocumentSymbolDefinition[] {
  return collectDocumentSymbolDefinitions(documentText).filter(
    (definition) => definition.parsed.name === symbolName
  );
}
