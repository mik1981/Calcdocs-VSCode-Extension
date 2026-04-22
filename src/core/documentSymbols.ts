import { parseCppSymbolDefinition, type CppSymbolDefinition } from "./cppParser";
import { updateBraceDepth } from "../utils/braceDepth";

export const DEFINE_DIRECTIVE_RX = /^\s*#\s*define\b/;
const CONTROL_FLOW_RX = /^\s*(if|while|for|switch|return|do)\b/;

export type DocumentSymbolDefinition = {
  line: number;
  lineText: string;
  isDefineLine: boolean;
  parsed: CppSymbolDefinition;
};

/**
 * Collects C/C++ declarations parsed by parseCppSymbolDefinition.
 * Supports both top-level and local declarations to drive inline ghost values.
 * #define directives are parsed regardless of brace depth.
 * Multi-line #define directives using trailing "\" are merged into one
 * logical line before parsing.
 */
export function collectDocumentSymbolDefinitions(
  documentText: string
): DocumentSymbolDefinition[] {
  const lines = documentText.split(/\r?\n/);
  const definitions: DocumentSymbolDefinition[] = [];
  let braceDepth = 0;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const startLine = lineIndex;
    let lineText = lines[lineIndex];

    while (lineText.trimEnd().endsWith("\\") && lineIndex + 1 < lines.length) {
      lineIndex += 1;
      lineText = `${lineText.trimEnd().slice(0, -1)} ${lines[lineIndex].trim()}`;
    }

    const isDefineLine = DEFINE_DIRECTIVE_RX.test(lineText);
    const isControlFlow = CONTROL_FLOW_RX.test(lineText);

    if (isDefineLine) {
      const parsed = parseCppSymbolDefinition(lineText);
      if (parsed) {
        definitions.push({
          line: startLine,
          lineText,
          isDefineLine: true,
          parsed,
        });
      }
    } else if (isControlFlow) {
      // Best-effort expression extraction for control flow lines
      const exprMatch = lineText.match(/^[^(]*\((.*)\)[^)]*$/);
      const expr = exprMatch ? exprMatch[1].trim() : "";
      if (expr) {
        definitions.push({
          line: startLine,
          lineText,
          isDefineLine: false,
          parsed: {
            name: "", // anonymous expression
            expr: expr,
          },
        });
      }
    } else {
      // Handle potential multiple declarations on one line (e.g. "int a=1; int b=2;")
      const segments = lineText.split(";");
      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        
        const parsed = parseCppSymbolDefinition(trimmed + ";");
        if (parsed) {
          definitions.push({
            line: startLine,
            lineText: segment + ";",
            isDefineLine: false,
            parsed,
          });
        } else {
          // parseCppSymbolDefinition requires "TYPE name = expr" (≥2 left-side tokens).
          // Plain assignments like `screen_state = SCREEN_OFF;` are silently dropped.
          // We still want to resolve and display the RHS as a ghost value.
          const assignMatch = (trimmed + ";").match(
            /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+);$/
          );
          if (assignMatch) {
            const assignName = assignMatch[1];
            const assignExpr = assignMatch[2].trim();
            const isCKeyword =
              /^(if|else|while|for|do|switch|case|break|continue|return|goto|sizeof|typeof|typedef|struct|union|enum|const|volatile|static|extern|inline|int|char|short|long|float|double|unsigned|signed|void|bool)$/.test(
                assignName
              );
            if (!isCKeyword && assignExpr) {
              definitions.push({
                line: startLine,
                lineText: segment + ";",
                isDefineLine: false,
                parsed: { name: assignName, expr: assignExpr },
              });
            }
          }
        }
      }
    }

    braceDepth = updateBraceDepth(braceDepth, lineText);
    lineIndex += 1;
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
