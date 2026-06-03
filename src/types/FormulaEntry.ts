export const FORMULA_LABEL_VALUES = [
  "complex_expression",
  "table_lookup",
] as const

export type TolMode = "worst_case" | "rss" | "gaussian";

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
  valueYamlList?: number[]
  parameters?: string[]
  tolerance?: {
    min?: number
    max?: number
    tol?: number
    mode?: TolMode
    sigma?: number
    parameters: Record<string, { min?: number; max?: number; tol?: number; mode?: TolMode; sigma?: number }>
  }
  toleranceResult?: {
    min: number
    max: number
    source: "declared" | "propagated"
    tol?: number
    nominalValue?: number
    mode?: TolMode
    sigma?: number
  }
  expanded?: string
  resolvedDependencies?: string[]
  valueCalc?: number | null
  explainSteps?: string[]
  evaluationErrors?: string[]
  evaluationWarnings?: string[]

  _filePath?: string
  _line?: number
}
