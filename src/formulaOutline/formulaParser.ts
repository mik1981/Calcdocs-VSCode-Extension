import {
  parseFormulaYamlLines,
  type ParsedFormulaYamlEntry,
} from "../core/formulaYaml";

export type OutlineFormula = ParsedFormulaYamlEntry;

/**
 * Compatibility entry point for formulas*.yaml consumers.
 * The implementation is shared with the YAML engine parser so outline,
 * hovers, folding, header generation, and unit evaluation see the same shape.
 */
export function parseFormulaDocument(lines: string[], filePath?: string): OutlineFormula[] {
  return parseFormulaYamlLines(lines, filePath);
}
