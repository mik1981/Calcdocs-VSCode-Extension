export const FORMULA_LABEL_VALUES = [
  "complex_expression",
  "table_lookup",
] as const

export type FormulaLabel = (typeof FORMULA_LABEL_VALUES)[number]

export type FormulaEntry = {
  key: string
  unit?: string
  formula?: string
  dati?: string
  steps: string[]
  labels: FormulaLabel[]

  valueYaml?: number
  expanded?: string
  valueCalc?: number | null

  _filePath?: string
  _line?: number
}
