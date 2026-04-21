import * as vscode from "vscode";

import { ClangdAstNode, ClangdService } from "../clangd/ClangdService";
import { CSymbol, SymbolKindType } from "./SymbolTypes";

function symbolKindFromVscode(kind: vscode.SymbolKind | undefined): SymbolKindType {
  if (kind === vscode.SymbolKind.Constant) {
    return "const";
  }

  if (kind === vscode.SymbolKind.EnumMember || kind === vscode.SymbolKind.Enum) {
    return "enum";
  }

  if (kind === vscode.SymbolKind.Variable || kind === vscode.SymbolKind.Field) {
    return "variable";
  }

  return "macro";
}

function flattenDocumentSymbols(
  symbols: vscode.DocumentSymbol[],
  output: vscode.DocumentSymbol[] = []
): vscode.DocumentSymbol[] {
  for (const symbol of symbols) {
    output.push(symbol);
    if (symbol.children.length > 0) {
      flattenDocumentSymbols(symbol.children, output);
    }
  }

  return output;
}

function parseHoverValueAndType(hoverText: string, name: string): {
  type?: string;
  value?: string;
  expression?: string;
} {
  const lines = hoverText
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const output: { type?: string; value?: string; expression?: string } = {};

  for (const line of lines) {
    const defineMatch = line.match(new RegExp(`^#define\\s+${name}\\s+(.+)$`));
    if (defineMatch) {
      output.type = output.type ?? "macro";
      output.value = output.value ?? defineMatch[1].trim();
      output.expression = output.expression ?? defineMatch[1].trim();
      continue;
    }

    const declarationMatch = line.match(
      new RegExp(`^(.+?)\\b${name}\\b(?:\\s*=\\s*(.+))?$`)
    );
    if (declarationMatch) {
      const rawType = declarationMatch[1].trim();
      if (!rawType.startsWith("#define")) {
        output.type = output.type ?? rawType;
      }
      const rhs = declarationMatch[2]?.trim();
      if (rhs) {
        output.value = output.value ?? rhs;
      }
      continue;
    }

    const fallbackTypeMatch = line.match(/^Type:\s*(.+)$/i);
    if (fallbackTypeMatch) {
      output.type = output.type ?? fallbackTypeMatch[1].trim();
      continue;
    }
  }

  return output;
}

function symbolKindFromAstKind(kind: string | undefined): SymbolKindType | undefined {
  const normalized = (kind ?? "").toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("macro")) {
    return "macro";
  }

  if (normalized.includes("enum")) {
    return "enum";
  }

  if (normalized.includes("const")) {
    return "const";
  }

  if (
    normalized.includes("decl") ||
    normalized.includes("var") ||
    normalized.includes("field")
  ) {
    return "variable";
  }

  return undefined;
}

function positionInRange(position: vscode.Position, range: vscode.Range | undefined): boolean {
  if (!range) {
    return false;
  }

  return !position.isBefore(range.start) && !position.isAfter(range.end);
}

function sanitizeAstText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[|`+\-\\\s]+/, "")
    .trim();
}

function parseAstValueAndType(node: ClangdAstNode, name: string): {
  type?: string;
  value?: string;
  expression?: string;
} {
  const lines = [node.label, node.detail, node.arcana]
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .map((line) => sanitizeAstText(line));
  if (lines.length === 0) {
    return {};
  }

  return parseHoverValueAndType(lines.join("\n"), name);
}

function findBestAstNodeForSymbol(
  root: ClangdAstNode,
  name: string,
  position: vscode.Position
): ClangdAstNode | undefined {
  let best: { node: ClangdAstNode; score: number } | undefined;
  const loweredName = name.toLowerCase();

  const visit = (node: ClangdAstNode): void => {
    const label = `${node.label} ${node.detail ?? ""} ${node.arcana ?? ""}`.toLowerCase();
    const mentionsName = label.includes(loweredName);
    const containsPosition = positionInRange(position, node.range);
    let score = 0;

    if (mentionsName) {
      score += 2;
    }
    if (containsPosition) {
      score += 3;
    }
    if (
      node.kind.toLowerCase().includes("decl") ||
      node.kind.toLowerCase().includes("macro")
    ) {
      score += 1;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { node, score };
    }

    for (const child of node.children) {
      visit(child);
    }
  };

  visit(root);
  return best?.node;
}

export class ClangdSymbolProvider {
  constructor(private readonly clangdService: ClangdService) {}

  async getSymbolAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<CSymbol | null> {
    if (!this.clangdService.isAvailable()) {
      return null;
    }

    const range = document.getWordRangeAtPosition(position, /[A-Za-z_]\w*/);
    if (!range) {
      return null;
    }

    const name = document.getText(range);
    if (!name) {
      return null;
    }

    const [hover, definition, docSymbols, ast] = await Promise.all([
      this.clangdService.getHover(document.uri, position),
      this.clangdService.getDefinition(document.uri, position),
      this.clangdService.getDocumentSymbols(document.uri),
      this.clangdService.getAst(document.uri),
    ]);

    const hoverText =
      hover?.contents
        .map((content) => {
          if (typeof content === "string") {
            return content;
          }

          if (content instanceof vscode.MarkdownString) {
            return content.value;
          }

          if (typeof content === "object" && content && "value" in content) {
            const value = (content as { value?: unknown }).value;
            return typeof value === "string" ? value : "";
          }

          return "";
        })
        .join("\n")
        .trim() ?? "";
    const hoverInfo = parseHoverValueAndType(hoverText ?? "", name);
    const astNode = ast ? findBestAstNodeForSymbol(ast.root, name, position) : undefined;
    const astInfo = astNode ? parseAstValueAndType(astNode, name) : {};
    const astKind = symbolKindFromAstKind(astNode?.kind);

    const symbolAtPosition = flattenDocumentSymbols(docSymbols).find(
      (symbol) =>
        symbol.name === name &&
        symbol.selectionRange.start.line <= position.line &&
        symbol.selectionRange.end.line >= position.line
    );

    const output: CSymbol = {
      name,
      kind: astKind ?? symbolKindFromVscode(symbolAtPosition?.kind),
      value: hoverInfo.value ?? astInfo.value,
      type: hoverInfo.type ?? astInfo.type,
      expression: hoverInfo.expression ?? astInfo.expression,
      location: definition ?? undefined,
      source: "clangd",
      confidence: 0,
      fieldSources: {},
      notes: [],
    };

    if (output.location && output.location.uri.scheme === "file") {
      try {
        const defDoc = await vscode.workspace.openTextDocument(output.location.uri);
        const lineText = defDoc.lineAt(output.location.range.start.line).text;
        const unitMatch = lineText.match(/@unit=([a-zA-Z0-9_/]+)/);
        if (unitMatch) {
          output.unit = unitMatch[1];
          output.fieldSources["unit"] = "clangd";
        }
      } catch (e) {
        // ignore
      }
    }

    if (output.type) {
      output.fieldSources.type = "clangd";
    }
    if (output.value) {
      output.fieldSources.value = "clangd";
    }
    if (output.location) {
      output.fieldSources.location = "clangd";
    }
    if (output.expression) {
      output.fieldSources.expression = "clangd";
    }
    if (astNode && astNode.kind) {
      output.notes?.push(`clangd AST: ${astNode.kind}`);
    }

    return output;
  }
}
