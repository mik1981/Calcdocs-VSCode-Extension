export const FORMULA_LABEL_VALUES = [
  "complex_expression",
  "table_lookup",
] as const

export type FormulaLabel = (typeof FORMULA_LABEL_VALUES)[number]

export type FormulaEntry = {
  key: string
  unit?: string
  formula?: string
  exprType?: "const" | "expr" | "lookup"
  steps: string[]
  labels: FormulaLabel[]
  revision?: string

  valueYaml?: number
  expanded?: string
  resolvedDependencies?: string[]
  valueCalc?: number | null
  explainSteps?: string[]
  evaluationErrors?: string[]
  evaluationWarnings?: string[]

  _filePath?: string
  _line?: number
}
