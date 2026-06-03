import type { CsvTableMap } from "../core/csvTables";
import {
  getYamlTopLevelLine,
  normalizeFormulaYamlNode,
  parseFormulaYamlValue,
  type FormulaToleranceRange,
  type FormulaToleranceSpec,
} from "../core/formulaYaml";
import {
  collectFunctionCallees,
  collectIdentifiers,
  parseExpression,
  printExpression,
  type ExpressionNode,
} from "./ast";
import { createCsvLookupResolver } from "./csvLookup";
import { formatNumberToSigFigs } from "../utils/nformat";
import {
  buildExplainSteps,
  evaluateExpressionAst,
  preprocessExpression,
  substituteIdentifiersForExplain,
  type EvaluationContext,
} from "./evaluator";
import {
  applyOutputUnit,
  createDimensionlessQuantity,
  createQuantity,
  createQuantityFromData,
  dimensionsEqual,
  formatDimension,
  getUnitSpec,
  isDimensionless,
  parseUnitToQuantity,
  toDisplayUnit,
  toDisplayValue,
  type UnitSpec,
  type Quantity,
  SCALABLE_UNIT_FAMILY,
  UNIT_SPEC_LIST,
  UNIT_SPECS,
} from "./units";
import type { TolMode } from "../types/FormulaEntry";

export type YamlSymbolType = "const" | "expr" | "lookup";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type YamlEvaluationDiagnostic = {
  symbol: string;
  line: number;
  severity: DiagnosticSeverity;
  message: string;
};

export type MissingYamlSuggestion = {
  name: string;
  unit: string;
  value?: number;
};

type ParsedSymbol = {
  name: string;
  line: number;
  type: YamlSymbolType;
  rawNode: Record<string, unknown>;
  expression?: string;
  ast?: ExpressionNode;
  literalValue?: number;
  literalValues?: number[];
  declaredUnit?: string;
  effectiveUnit?: string;
  yamlValue?: number;
  parameters: string[];
  tolerance?: FormulaToleranceSpec;
  dependencies: string[];
  parseError?: string;
};

export type EvaluatedYamlSymbol = {
  name: string;
  line: number;
  type: YamlSymbolType;
  expression?: string;
  dependencies: string[];
  resolvedDependencies: string[];
  expanded?: string;
  explainSteps: string[];
  quantity?: Quantity;
  value?: number;
  outputUnit?: string;
  yamlValue?: number;
  range?: {
    min: number;
    max: number;
    source: "declared" | "propagated";
    /** Original percentage tolerance (e.g. 5 for ±5 %).
     *  Present only when the range was derived from a `tol` field;
     *  absent for explicit min/max or propagated ranges. */
    tol?: number;
    nominalValue?: number;
    mode?: TolMode;
    sigma?: number;
  };

  errors: string[];
  warnings: string[];
  isParameterized?: boolean;
};

export type YamlEvaluationResult = {
  symbols: Map<string, EvaluatedYamlSymbol>;
  diagnostics: YamlEvaluationDiagnostic[];
  cycles: string[][];
  missingSuggestions: MissingYamlSuggestion[];
};

export type EvaluateYamlOptions = {
  rawText: string;
  yamlPath?: string;
  externalValues?: Map<string, number>;
  externalUnits?: Map<string, string>;
  csvTables?: CsvTableMap;
};

/**
* Ricava l'unità canonica (es. "A", "W", "Pa") dalla dimensione fisica
 * di una Quantity. Preferisce le unità SI (factorToSi = 1) per coerenza
 * col valore già espresso in SI.
 */
function inferCanonicalUnit(quantity: Quantity): string | undefined {
  if (isDimensionless(quantity.dimension)) {
    return undefined;
  }

  // Se la quantità ha già un'unità preferita riconosciuta, usala direttamente
  if (quantity.preferredUnit) {
    const spec = UNIT_SPECS.get(quantity.preferredUnit);
    if (spec) {
      return spec.canonical;
    }
  }

  // displayUnit non è una stringa dimensionale grezza (es. "M^1 L^2 T^-3")
  if (quantity.displayUnit && !/^[MLTIK]/.test(quantity.displayUnit)) {
    return quantity.displayUnit;
  }

  const EPSILON = 1e-12;

  // Prima passata: cerca un'unità SI (factorToSi ≈ 1) con dimensione uguale
  for (const spec of UNIT_SPEC_LIST) {
    if (
      Math.abs(spec.factorToSi - 1) < EPSILON &&
      dimensionsEqual(spec.dimension, quantity.dimension)
    ) {
      return spec.canonical;
    }
  }

  // Seconda passata: qualsiasi unità con dimensione corrispondente
  for (const spec of UNIT_SPEC_LIST) {
    if (dimensionsEqual(spec.dimension, quantity.dimension)) {
      return spec.canonical;
    }
  }

  return undefined;
}

function toNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    // Support units in string: "5 V"
    const match = trimmed.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?)\s*[A-Za-z%][A-Za-z0-9_%]*$/);
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function inferSymbolType(node: Record<string, unknown>): YamlSymbolType | null {
  if (typeof node.type === "string") {
    const normalized = node.type.trim().toLowerCase();
    if (normalized === "const") {
      return "const";
    }
    if (normalized === "expr" || normalized === "expression") {
      return "expr";
    }
    if (normalized === "lookup" || normalized === "table") {
      return "lookup";
    }
    return null;
  }

  if (typeof node.expr === "string" || typeof node.formula === "string") {
    return "expr";
  }

  if (node.table != null || node.lookup != null || node.column != null) {
    return "lookup";
  }

  const parsedValue = parseFormulaYamlValue(node.value);
  if (parsedValue.value != null || parsedValue.values != null) {
    return "const";
  }

  return null;
}

function toLookupArgument(
  value: unknown,
  options?: {
    allowIdentifier?: boolean;
  }
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return "\"\"";
  }

  if (options?.allowIdentifier && /^[A-Za-z_]\w*$/.test(text)) {
    return text;
  }

  return JSON.stringify(text);
}

function buildLookupExpression(node: Record<string, unknown>): string | null {
  const table = node.table ?? node.lookup ?? node.csv;
  const row = node.row ?? node.key ?? node.lookupKey;
  const valueColumn = node.valueColumn ?? node.column ?? node.outputColumn;
  const lookupColumn = node.lookupColumn ?? node.inputColumn;
  const interpolation = node.interpolation ?? node.mode;

  const tableText = String(table ?? "").trim();
  if (!tableText || row == null || valueColumn == null) {
    return null;
  }

  const tableArgument = JSON.stringify(tableText);
  const rowArgument = toLookupArgument(row, {
    allowIdentifier: true,
  });
  const valueColumnArgument = toLookupArgument(valueColumn);
  const interpolationArgument =
    interpolation == null ? undefined : toLookupArgument(interpolation);

  if (lookupColumn != null) {
    const lookupColumnArgument = toLookupArgument(lookupColumn);
    if (interpolationArgument) {
      return `csv(${tableArgument}, ${rowArgument}, ${lookupColumnArgument}, ${valueColumnArgument}, ${interpolationArgument})`;
    }

    return `csv(${tableArgument}, ${rowArgument}, ${lookupColumnArgument}, ${valueColumnArgument})`;
  }

  if (interpolationArgument) {
    return `csv(${tableArgument}, ${rowArgument}, ${valueColumnArgument}, ${interpolationArgument})`;
  }

  return `csv(${tableArgument}, ${rowArgument}, ${valueColumnArgument})`;
}

function formatExplainNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return formatNumberToSigFigs(value, 6);
}

function formatResolvedDependency(
  name: string,
  quantity: Quantity | undefined,
  fallbackValue?: number
): string | undefined {
  if (quantity) {
    const value = formatExplainNumber(toDisplayValue(quantity));
    const unit = toDisplayUnit(quantity);
    return unit ? `${name} = ${value} ${unit}` : `${name} = ${value}`;
  }

  if (typeof fallbackValue === "number" && Number.isFinite(fallbackValue)) {
    return `${name} = ${formatExplainNumber(fallbackValue)}`;
  }

  return undefined;
}

type NumericRange = {
  min: number;
  max: number;
};

function normalizeToleranceRange(
  range: FormulaToleranceRange | undefined,
  nominal?: number
): NumericRange | undefined {
  if (!range) {
    return undefined;
  }

  let min = range.min;
  let max = range.max;

  if ((min === undefined || max === undefined) && range.tol !== undefined && nominal !== undefined) {
    const delta = Math.abs(nominal) * Math.abs(range.tol) / 100;
    min ??= nominal - delta;
    max ??= nominal + delta;
  }

  if (min === undefined || max === undefined) {
    return undefined;
  }

  return min <= max ? { min, max } : { min: max, max: min };
}

function getToleranceParameterRange(
  tolerance: FormulaToleranceSpec | undefined,
  name: string
): FormulaToleranceRange | undefined {
  return tolerance?.parameters[name];
}

function expressionNeedsOutputConversion(ast: ExpressionNode | undefined): boolean {
  if (!ast) {
    return false;
  }

  let requiresConversion = false;

  const walk = (node: ExpressionNode): void => {
    if (requiresConversion) {
      return;
    }

    switch (node.kind) {
      case "binary":
        if (node.operator === "+" || node.operator === "-") {
          requiresConversion = true;
          return;
        }
        walk(node.left);
        walk(node.right);
        return;
      case "unary":
        walk(node.argument);
        return;
      case "call":
        for (const arg of node.args) {
          walk(arg);
          if (requiresConversion) {
            return;
          }
        }
        return;
      case "identifier":
      case "number":
      case "string":
        return;
    }
  };

  walk(ast);
  return requiresConversion;
}

function shouldConvertPureExpressionOutput(
  quantity: Quantity,
  outputSpec?: UnitSpec
): boolean {
  if (!outputSpec) {
    return true;
  }

  // If no native preferred unit is available (composite/derived result),
  // honoring explicit output unit is the only way to provide a stable display unit.
  const sourceToken = quantity.preferredUnit;
  if (!sourceToken) {
    return true;
  }

  if (sourceToken === outputSpec.token) {
    return false;
  }

  const sourceFamily = SCALABLE_UNIT_FAMILY.get(sourceToken);
  const targetFamily = SCALABLE_UNIT_FAMILY.get(outputSpec.token);
  if (!sourceFamily || !targetFamily || sourceFamily !== targetFamily) {
    return false;
  }

  // Keep pure multiplicative expressions in their native engineering unit for
  // broad families (pressure/force/energy...), and only auto-scale where users
  // usually expect SI-prefix normalization.
  return [
    "voltage",
    "current",
    "resistance",
    "conductance",
    "capacitance",
    "inductance",
    "frequency",
    "time",
    "power",
  ].includes(sourceFamily);
}

function createDiagnostic(
  diagnostics: YamlEvaluationDiagnostic[],
  symbol: string,
  line: number,
  severity: DiagnosticSeverity,
  message: string
): void {
  const duplicate = diagnostics.some(
    (entry) =>
      entry.symbol === symbol &&
      entry.line === line &&
      entry.severity === severity &&
      entry.message === message
  );
  if (duplicate) {
    return;
  }

  diagnostics.push({
    symbol,
    line,
    severity,
    message,
  });
}

function parseSymbols(
  root: Record<string, unknown>,
  options: EvaluateYamlOptions,
  diagnostics: YamlEvaluationDiagnostic[]
): Map<string, ParsedSymbol> {
  const parsed = new Map<string, ParsedSymbol>();
  const externalUnits = options.externalUnits ?? new Map<string, string>();

  for (const [name, rawNode] of Object.entries(root)) {
    if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) {
      continue;
    }

    const node = rawNode as Record<string, unknown>;
    const type = inferSymbolType(node);
    const line = Math.max(0, getYamlTopLevelLine(options.rawText, name));
    const normalizedNode = normalizeFormulaYamlNode(name, node, options.rawText, options.yamlPath);
    const parsedValue = parseFormulaYamlValue(node.value);
    const yamlValue = parsedValue.value;
    const yamlValues = parsedValue.values;
    const declaredUnit = normalizedNode.unit;
    const effectiveUnit = declaredUnit || externalUnits.get(name);
    const parameters = normalizedNode.parameters ?? [];
    const tolerance = normalizedNode.tolerance;

    if (!type) {
      createDiagnostic(
        diagnostics,
        name,
        line,
        "error",
        `unable to infer symbol type for '${name}'`
      );
      parsed.set(name, {
        name,
        line,
        type: "expr",
        rawNode: node,
        declaredUnit,
        effectiveUnit,
        yamlValue,
        parameters,
        tolerance,
        dependencies: [],
        parseError: "unknown symbol type",
      });
      continue;
    }

    if (type === "const") {
      if (yamlValue == null && yamlValues == null) {
        createDiagnostic(
          diagnostics,
          name,
          line,
          "error",
          `const '${name}' requires a numeric 'value'`
        );
      }

      parsed.set(name, {
        name,
        line,
        type,
        rawNode: node,
        literalValue: yamlValue ?? undefined,
        literalValues: yamlValues,
        declaredUnit,
        effectiveUnit,
        yamlValue: yamlValue ?? undefined,
        parameters,
        tolerance,
        dependencies: [],
      });
      continue;
    }

    const expression =
      (normalizedNode.expr ? normalizedNode.expr : undefined) ??
      (type === "lookup" ? buildLookupExpression(node) ?? undefined : undefined);

    if (!expression) {
      createDiagnostic(
        diagnostics,
        name,
        line,
        "error",
        `'${name}' requires an expression`
      );
      parsed.set(name, {
        name,
        line,
        type,
        rawNode: node,
        declaredUnit,
        effectiveUnit,
        yamlValue,
        parameters,
        tolerance,
        dependencies: [],
        parseError: "missing expression",
      });
      continue;
    }

    try {
      const ast = parseExpression(preprocessExpression(expression));
      const dependencySet = collectIdentifiers(ast);
      for (const callee of collectFunctionCallees(ast)) {
        if (root[callee] != null) {
          dependencySet.add(callee);
        }
      }
      const dependencies = Array.from(dependencySet)
        .filter((dependency) => !parameters.includes(dependency))
        .sort();

      parsed.set(name, {
        name,
        line,
        type,
        rawNode: node,
        expression,
        ast,
        declaredUnit,
        effectiveUnit,
        yamlValue,
        parameters,
        tolerance,
        dependencies,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      createDiagnostic(
        diagnostics,
        name,
        line,
        "error",
        `invalid expression for '${name}': ${message}`
      );
      parsed.set(name, {
        name,
        line,
        type,
        rawNode: node,
        expression,
        declaredUnit,
        effectiveUnit,
        yamlValue,
        parameters,
        tolerance,
        dependencies: [],
        parseError: message,
      });
    }
  }

  return parsed;
}

function detectCycles(parsedSymbols: Map<string, ParsedSymbol>): string[][] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) {
      return;
    }

    if (visiting.has(name)) {
      const cycleStartIndex = stack.indexOf(name);
      const cyclePath =
        cycleStartIndex >= 0
          ? [...stack.slice(cycleStartIndex), name]
          : [...stack, name];
      const key = cyclePath.join("->");
      if (!seenCycleKeys.has(key)) {
        seenCycleKeys.add(key);
        cycles.push(cyclePath);
      }
      return;
    }

    visiting.add(name);
    stack.push(name);
    const symbol = parsedSymbols.get(name);
    if (symbol) {
      for (const dependency of symbol.dependencies) {
        if (!parsedSymbols.has(dependency)) {
          continue;
        }
        visit(dependency);
      }
    }

    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of parsedSymbols.keys()) {
    visit(name);
  }

  return cycles;
}

export function evaluateYamlDocument(
  root: Record<string, unknown>,
  options: EvaluateYamlOptions
): YamlEvaluationResult {
  const diagnostics: YamlEvaluationDiagnostic[] = [];
  const symbols = parseSymbols(root, options, diagnostics);
  const cycles = detectCycles(symbols);
  const cycleNodes = new Set<string>();
  const externalValues = options.externalValues ?? new Map<string, number>();
  const externalUnits = options.externalUnits ?? new Map<string, string>();
  const csvLookup = createCsvLookupResolver(options.csvTables, options.yamlPath);

  for (const cycle of cycles) {
    for (const name of cycle) {
      cycleNodes.add(name);
      const symbol = symbols.get(name);
      if (!symbol) {
        continue;
      }

      createDiagnostic(
        diagnostics,
        name,
        symbol.line,
        "error",
        `circular dependency detected: ${cycle.join(" -> ")}`
      );
    }
  }

  for (const symbol of symbols.values()) {
    for (const dependency of symbol.dependencies) {
      if (symbols.has(dependency)) {
        continue;
      }

      if (externalValues.has(dependency)) {
        continue;
      }

      // ✅ Non è più un errore, ma un INFO: variabile libera/parametro della formula
      createDiagnostic(
        diagnostics,
        symbol.name,
        symbol.line,
        "info",
        `formula parametrizzata: '${dependency}' verrà trattata come argomento libero nel codice generato`
      );
    }
  }

  const evaluated = new Map<string, EvaluatedYamlSymbol>();
  const evaluating = new Set<string>();
  const createYamlDataQuantity = (
    value: number,
    unit?: string
  ): ReturnType<typeof createQuantity> => {
    if (!unit) {
      return createQuantity(value);
    }

    const spec = getUnitSpec(unit);
    if (spec && (spec.toSi || spec.fromSi)) {
      if (!Number.isFinite(value)) {
        return {
          ok: false,
          error: `non-finite numeric value: ${value}`,
        };
      }

      return {
        ok: true,
        value: {
          ...createDimensionlessQuantity(value),
          displayUnit: spec.canonical,
        },
      };
    }

    return createQuantityFromData(value, unit);
  };

  const resolveExternalQuantity = (name: string): Quantity | undefined => {
    const value = externalValues.get(name);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }

    const unit = externalUnits.get(name);
    if (unit) {
      const qty = createYamlDataQuantity(value, unit);
      if (!qty.ok) return undefined;
      return qty.value;
    } else {
      const qty = createQuantity(value);
      if (!qty.ok) return undefined;
      return qty.value;
    }
  };

  const createDataQuantity = (value: number, unit?: string): Quantity | undefined => {
    const quantity = createYamlDataQuantity(value, unit);
    return quantity.ok ? quantity.value : undefined;
  };

  const resolveArrayQuantities = (name: string): Quantity[] | undefined => {
    const symbol = symbols.get(name);
    if (!symbol?.literalValues) {
      return undefined;
    }

    const quantities: Quantity[] = [];
    for (const value of symbol.literalValues) {
      const quantity = createDataQuantity(value, symbol.effectiveUnit);
      if (!quantity) {
        return undefined;
      }
      quantities.push(quantity);
    }

    return quantities;
  };

  const evaluateSymbol = (name: string): EvaluatedYamlSymbol | undefined => {
    if (evaluated.has(name)) {
      return evaluated.get(name);
    }

    const symbol = symbols.get(name);
    if (!symbol) {
      return undefined;
    }

    const result: EvaluatedYamlSymbol = {
      name: symbol.name,
      line: symbol.line,
      type: symbol.type,
      expression: symbol.expression,
      dependencies: [...symbol.dependencies],
      resolvedDependencies: [],
      explainSteps: [],
      errors: [],
      warnings: [],
      yamlValue: symbol.yamlValue,
    };
    const addError = (message: string): void => {
      if (!result.errors.includes(message)) {
        result.errors.push(message);
      }
    };
    const addWarning = (message: string): void => {
      if (!result.warnings.includes(message)) {
        result.warnings.push(message);
      }
    };

    evaluated.set(name, result);

    if (cycleNodes.has(name)) {
      addError("evaluation skipped because of circular dependency");
      return result;
    }

    if (symbol.parseError) {
      addError(symbol.parseError);
      return result;
    }

    if (evaluating.has(name)) {
      addError(`recursive evaluation detected for '${name}'`);
      return result;
    }

    evaluating.add(name);

    if (symbol.type === "const") {
      if (symbol.literalValues) {
        if (symbol.literalValues.length === 0) {
          addError(`const '${name}' has an empty value table`);
        }
        result.expanded = `[${symbol.literalValues.map(formatExplainNumber).join(", ")}]`;
        result.explainSteps = [`= ${result.expanded}`];
        result.outputUnit = symbol.effectiveUnit;
        evaluating.delete(name);
        return result;
      }

      if (typeof symbol.literalValue !== "number" || !Number.isFinite(symbol.literalValue)) {
        addError(`const '${name}' has invalid numeric value`);
        evaluating.delete(name);
        return result;
      }

      let constQuantity: Quantity;
      if (symbol.effectiveUnit) {
        const spec = getUnitSpec(symbol.effectiveUnit);
        if (spec && (spec.toSi || spec.fromSi)) {
          // Unità con offset (degC, degF, rankine).
          // Il valore dichiarato viene usato as-is nelle formule.
          // Non eseguiamo la conversione in SI perché le formule YAML
          // operano su valori utente (25°C), non su Kelvin assoluti.
          constQuantity = {
            valueSi: symbol.literalValue,
            dimension: createDimensionlessQuantity(symbol.literalValue).dimension,
            preferredUnit: undefined,   // evita che toDisplayValue chiami fromSi
            displayUnit: spec.canonical,
          };
        } else {
          const qty = createQuantityFromData(symbol.literalValue, symbol.effectiveUnit);
          if (!qty.ok) {
            addError(qty.error);
            evaluating.delete(name);
            return result;
          }
          constQuantity = qty.value;
        }
      } else {
        const qty = createQuantity(symbol.literalValue);
        if (!qty.ok) {
          addError(qty.error);
          evaluating.delete(name);
          return result;
        }
        constQuantity = qty.value;
      }

      result.quantity = constQuantity;
      result.value = toDisplayValue(constQuantity);   // restituisce 25 ✓
      
      const declaredRange = normalizeToleranceRange(symbol.tolerance, result.value);
      if (declaredRange) {
        result.range = {
          ...declaredRange,
          source: "declared",
          tol: symbol.tolerance?.tol,
          nominalValue: result.value,
          mode: symbol.tolerance?.mode,
          sigma: symbol.tolerance?.sigma,
        };
      }
      // result.outputUnit = toDisplayUnit(quantity.value);
      // toDisplayUnit restituisce la dimensione grezza ("M^1 L^2 T^-3") quando
      // non c'è un'unità preferita. Proviamo a trovare l'unità canonica.
      const rawUnit = toDisplayUnit(constQuantity);
      const isRawDimension = rawUnit != null && /^[MLTIK]/.test(rawUnit);
      result.outputUnit = isRawDimension || rawUnit == null
        ? inferCanonicalUnit(constQuantity)
        : rawUnit;


      result.expanded = formatExplainNumber(result.value);
      result.explainSteps = [`= ${result.expanded}`];

      if (!symbol.declaredUnit && symbol.effectiveUnit) {
        createDiagnostic(
          diagnostics,
          symbol.name,
          symbol.line,
          "info",
          `unit '${symbol.effectiveUnit}' inferred from C/C++ declarations`
        );
      }

      // Notifica se l'unità è stata derivata automaticamente dalle dimensioni
      if (!symbol.declaredUnit && !symbol.effectiveUnit && result.outputUnit) {
        createDiagnostic(
          diagnostics,
          symbol.name,
          symbol.line,
          "info",
          `unit '${result.outputUnit}' derived from formula dimensions (add 'unit: ${result.outputUnit}' to confirm)`
        );
      }

      evaluating.delete(name);
      return result;
    }

    if (!symbol.ast || !symbol.expression) {
      addError("expression is not available");
      evaluating.delete(name);
      return result;
    }

    const hasUnknownVariables = symbol.dependencies.some(
      (dep) => !symbols.has(dep) && !externalUnits.has(dep) && !externalValues.has(dep)
    );

    result.isParameterized = hasUnknownVariables || symbol.parameters.length > 0;

    const context: EvaluationContext = {
      ignoreUnitCompatibility: hasUnknownVariables,
      resolveIdentifier: (identifier: string): Quantity | undefined => {
        if (symbol.parameters.includes(identifier)) {
          return createDimensionlessQuantity(1.0);
        }

        // 1. Prova a risolvere dai simboli YAML già valutati o in corso di valutazione
        if (symbols.has(identifier)) {
          const dependency = evaluateSymbol(identifier);
          if (dependency?.quantity) {
            return dependency.quantity;
          }
          // Se non abbiamo ancora il valore, ma abbiamo l'unità dichiarata,
          // restituiamo una quantità con valore 1.0 ma dimensione corretta.
          const declaredUnit = symbols.get(identifier)?.effectiveUnit;
          if (declaredUnit) {
            const q = createYamlDataQuantity(1.0, declaredUnit);
            if (q.ok) return q.value;
          }
        }

        // 2. Prova a risolvere dai simboli esterni (C/C++)
        const extValue = externalValues.get(identifier);
        const extUnit = externalUnits.get(identifier);
        
        if (extUnit) {
          const q = createYamlDataQuantity(extValue ?? 1.0, extUnit);
          if (q.ok) return q.value;
        }

        if (extValue !== undefined) {
          const q = createQuantity(extValue);
          if (q.ok) return q.value;
        }

        return undefined;
      },
      resolveArrayIdentifier: resolveArrayQuantities,
      resolveFunctionCall: (functionName, args) => {
        const target = symbols.get(functionName);
        if (!target) {
          return undefined;
        }

        if (!target.ast || !target.expression) {
          return {
            ok: false,
            error: `formula '${functionName}' is not callable`,
          };
        }

        if (args.length !== target.parameters.length) {
          return {
            ok: false,
            error: `formula '${functionName}' expects ${target.parameters.length} parameter(s), got ${args.length}`,
          };
        }

        if (evaluating.has(functionName)) {
          return {
            ok: false,
            error: `recursive formula call detected for '${functionName}'`,
          };
        }

        const boundParameters = new Map<string, Quantity>();
        target.parameters.forEach((parameter, index) => {
          boundParameters.set(parameter, args[index]);
        });

        evaluating.add(functionName);
        const callContext: EvaluationContext = {
          ignoreUnitCompatibility: false,
          resolveIdentifier: (identifier: string): Quantity | undefined => {
            const bound = boundParameters.get(identifier);
            if (bound) {
              return bound;
            }

            if (symbols.has(identifier)) {
              const dependency = evaluateSymbol(identifier);
              if (dependency?.quantity) {
                return dependency.quantity;
              }

              const declaredUnit = symbols.get(identifier)?.effectiveUnit;
              if (declaredUnit) {
                const q = createYamlDataQuantity(1.0, declaredUnit);
                if (q.ok) return q.value;
              }
            }

            return resolveExternalQuantity(identifier);
          },
          resolveArrayIdentifier: resolveArrayQuantities,
          resolveLookup: (lookupName, lookupArgs) => csvLookup(lookupName, lookupArgs),
          resolveFunctionCall: (nestedName, nestedArgs) =>
            context.resolveFunctionCall?.(nestedName, nestedArgs),
        };

        const evaluatedCall = evaluateExpressionAst(target.ast, callContext);
        evaluating.delete(functionName);
        if (!evaluatedCall.ok) {
          return {
            ok: false,
            error: evaluatedCall.error,
          };
        }

        let callQuantity = evaluatedCall.quantity;
        if (target.effectiveUnit) {
          const output = applyOutputUnit(callQuantity, target.effectiveUnit);
          if (output.ok) {
            callQuantity = output.value.quantity;
          } else if (isDimensionless(callQuantity.dimension)) {
            const tagged = createYamlDataQuantity(callQuantity.valueSi, target.effectiveUnit);
            if (!tagged.ok) {
              return {
                ok: false,
                error: tagged.error,
              };
            }
            callQuantity = tagged.value;
          } else {
            return {
              ok: false,
              error: output.error,
            };
          }
        }

        return {
          ok: true,
          value: callQuantity,
        };
      },
      resolveLookup: (functionName, args) => csvLookup(functionName, args),
    };

    const evaluatedExpression = evaluateExpressionAst(symbol.ast, context);
    if (!evaluatedExpression.ok) {
      if (!hasUnknownVariables) {
        addError(evaluatedExpression.error);
      }
      evaluating.delete(name);
      return result;
    }

    let quantity = evaluatedExpression.quantity;
    if (symbol.effectiveUnit) {
      const outputUnit = symbol.effectiveUnit;
      const parsedUnit = parseUnitToQuantity(outputUnit);
      if (!parsedUnit.ok) {
        addError(`unknown unit '${outputUnit}'`);
        evaluating.delete(name);
        return result;
      }

      const outputSpec = getUnitSpec(outputUnit);
      const isRawDimensionless = isDimensionless(quantity.dimension);

      const hasUnitMismatch =
        !isRawDimensionless &&
        !dimensionsEqual(quantity.dimension, parsedUnit.value.dimension) &&
        !hasUnknownVariables;

      if (hasUnitMismatch) {
        const calcDim = formatDimension(quantity.dimension);
        const targetDim = formatDimension(parsedUnit.value.dimension);
        addError(
          `unit mismatch: expression has ${calcDim} ` +
            `but output unit '${outputUnit}' expects ${targetDim}`
        );
        // Keep the native evaluated quantity and avoid re-emitting the same
        // mismatch from a downstream conversion layer.
        result.quantity = quantity;
        result.value = toDisplayValue(quantity);
        result.outputUnit = toDisplayUnit(quantity);
      } else {
        if (isRawDimensionless) {
          const tagged = createYamlDataQuantity(
            quantity.valueSi,
            outputUnit
          );

          if (!tagged.ok) {
            addError(tagged.error);
            evaluating.delete(name);
            return result;
          }

          quantity = tagged.value;

          result.quantity = quantity;
          result.value = toDisplayValue(quantity);
          result.outputUnit = toDisplayUnit(quantity);
        }
        else {
          const shouldConvertOutput =
            expressionNeedsOutputConversion(symbol.ast) ||
            shouldConvertPureExpressionOutput(quantity, outputSpec);
          if (shouldConvertOutput) {
            const output = applyOutputUnit(quantity, outputUnit);
            if (!output.ok) {
              addError(output.error);
              evaluating.delete(name);
              return result;
            }

            quantity = output.value.quantity;
            result.value = output.value.displayValue;
            result.outputUnit = output.value.displayUnit;
            result.quantity = quantity;
          } else {
            result.quantity = quantity;
            result.value = toDisplayValue(quantity);
            result.outputUnit = toDisplayUnit(quantity);
          }
        }
      }
    } else {
      result.quantity = quantity;
      result.value = toDisplayValue(quantity);
      result.outputUnit = toDisplayUnit(quantity);
    }

    const declaredRange = normalizeToleranceRange(symbol.tolerance, result.value);
    if (declaredRange) {
      result.range = {
        ...declaredRange,
        source: "declared",
        tol: symbol.tolerance?.tol,
        nominalValue: result.value,
        mode: symbol.tolerance?.mode,
        sigma: symbol.tolerance?.sigma,
      };
    } else if (symbol.ast) {
      const tolMode: TolMode = symbol.tolerance?.mode ?? "worst_case";
      const tolSigma: number = symbol.tolerance?.sigma ?? 3;

      const rangeInputs = new Map<string, { min: Quantity; max: Quantity }>();


      const addRangeInput = (
        dependencyName: string,
        range: NumericRange | undefined,
        unit?: string
      ): void => {
        if (!range) {
          return;
        }

        const minQuantity = createDataQuantity(range.min, unit);
        const maxQuantity = createDataQuantity(range.max, unit);
        if (minQuantity && maxQuantity) {
          rangeInputs.set(dependencyName, {
            min: minQuantity,
            max: maxQuantity,
          });
        }
      };

      for (const parameter of symbol.parameters) {
        addRangeInput(
          parameter,
          normalizeToleranceRange(getToleranceParameterRange(symbol.tolerance, parameter), 1)
        );
      }

      for (const dependencyName of symbol.dependencies) {
        const dependency = symbols.has(dependencyName)
          ? evaluateSymbol(dependencyName)
          : undefined;
        const explicitRange = normalizeToleranceRange(
          getToleranceParameterRange(symbol.tolerance, dependencyName),
          dependency?.value ?? externalValues.get(dependencyName)
        );

        if (explicitRange) {
          addRangeInput(
            dependencyName,
            explicitRange,
            dependency?.outputUnit ?? externalUnits.get(dependencyName)
          );
          continue;
        }

        if (dependency?.range) {
          addRangeInput(dependencyName, dependency.range, dependency.outputUnit);
        }
      }

      // Per ogni dipendenza array con tol, costruiamo una variazione
      // "tutti min" / "tutti max" da aggiungere al corner-case sweep.
      type ArrayTolEntry = { tol: number; baseQuantities: Quantity[] };
      const arrayTolInputs = new Map<string, ArrayTolEntry>();

      for (const dependencyName of symbol.dependencies) {
        const dep = symbols.get(dependencyName);
        if (!dep?.literalValues || dep.literalValues.length === 0) continue;
        if (dep.tolerance?.tol === undefined) continue;

        const base: Quantity[] = [];
        let allOk = true;
        for (const v of dep.literalValues) {
          const q = createDataQuantity(v, dep.effectiveUnit);
          if (!q) { allOk = false; break; }
          base.push(q);
        }
        if (allOk && base.length > 0) {
          arrayTolInputs.set(dependencyName, {
            tol: Math.abs(dep.tolerance.tol) / 100,
            baseQuantities: base,
          });
        }
      }

      const scalarEntries = Array.from(rangeInputs.entries());
      const arrayEntries  = Array.from(arrayTolInputs.entries());
      const totalInputs   = scalarEntries.length + arrayEntries.length;

      if (totalInputs > 0 && totalInputs <= 12) {

        // Funzione che valuta l'espressione dati i valori numerici degli input.
        // overrideValues[i] = valore display numerico per scalarEntries[i]
        // arrayFactors[i]   = moltiplicatore per arrayEntries[i] (1 ± tol)
        const evalAtPoint = (
          overrideValues: number[],
          arrayFactors: number[]
        ): number | undefined => {
          const overrideMap    = new Map<string, Quantity>();
          const arrayOverrideMap = new Map<string, Quantity[]>();

          scalarEntries.forEach(([name, range], i) => {
            const v    = overrideValues[i];
            const unit = range.min.displayUnit ?? range.min.preferredUnit;
            const q    = unit ? createQuantityFromData(v, unit) : createQuantity(v);
            if (q.ok) overrideMap.set(name, q.value);
            else {
              const qs = createQuantity(v);
              if (qs.ok) overrideMap.set(name, qs.value);
            }
          });

          arrayEntries.forEach(([name, { baseQuantities }], i) => {
            const factor = arrayFactors[i];
            arrayOverrideMap.set(
              name,
              baseQuantities.map(q => ({ ...q, valueSi: q.valueSi * factor }))
            );
          });

          const rangeContext: EvaluationContext = {
            ...context,
            resolveIdentifier: (id) =>
              overrideMap.get(id) ?? context.resolveIdentifier(id),
            resolveArrayIdentifier: arrayOverrideMap.size > 0
              ? (name) => arrayOverrideMap.get(name) ?? context.resolveArrayIdentifier?.(name)
              : context.resolveArrayIdentifier,
          };

          const ev = evaluateExpressionAst(symbol.ast!, rangeContext);
          if (!ev.ok) return undefined;

          let q = ev.quantity;
          if (symbol.effectiveUnit) {
            const out = applyOutputUnit(q, symbol.effectiveUnit);
            if (out.ok) return out.value.displayValue;
          }
          return toDisplayValue(q);
        };

        // Valori nominali degli scalari (centro del range)
        const nominalScalars = scalarEntries.map(([, range]) =>
          (toDisplayValue(range.min) + toDisplayValue(range.max)) / 2
        );
        const nominalArrayFactors = arrayEntries.map(() => 1.0);

        if (tolMode === "worst_case") {
          const values: number[] = [];
          const combinations = 1 << totalInputs;
          for (let mask = 0; mask < combinations; mask++) {
            const sv = scalarEntries.map(([, range], i) =>
              (mask & (1 << i)) === 0
                ? toDisplayValue(range.min)
                : toDisplayValue(range.max)
            );
            const af = arrayEntries.map(([, { tol }], i) =>
              (mask & (1 << (i + scalarEntries.length))) === 0
                ? (1 - tol)
                : (1 + tol)
            );
            const v = evalAtPoint(sv, af);
            if (v !== undefined && Number.isFinite(v)) values.push(v);
          }
          if (values.length > 0) {
            result.range = {
              min: Math.min(...values),
              max: Math.max(...values),
              source: "propagated",
              nominalValue: result.value,
              mode: tolMode,
              sigma: tolSigma,
            };
          }

        } else {
          // RSS e gaussian: differenze finite centrate
          let sumSq = 0;
          const nominal = result.value ?? evalAtPoint(nominalScalars, nominalArrayFactors) ?? 0;

          // Sensibilità scalari
          for (let i = 0; i < scalarEntries.length; i++) {
            const [, range] = scalarEntries[i];
            const halfSpan = (toDisplayValue(range.max) - toDisplayValue(range.min)) / 2;
            if (halfSpan <= 0) continue;

            const svPlus  = [...nominalScalars]; svPlus[i]  = nominalScalars[i] + halfSpan;
            const svMinus = [...nominalScalars]; svMinus[i] = nominalScalars[i] - halfSpan;

            const fPlus  = evalAtPoint(svPlus,  nominalArrayFactors);
            const fMinus = evalAtPoint(svMinus, nominalArrayFactors);
            if (fPlus === undefined || fMinus === undefined) continue;

            const sensitivity = (fPlus - fMinus) / 2;
            sumSq += sensitivity * sensitivity;
          }

          // Sensibilità array
          for (let i = 0; i < arrayEntries.length; i++) {
            const [, { tol }] = arrayEntries[i];
            const afPlus  = [...nominalArrayFactors]; afPlus[i]  = 1 + tol;
            const afMinus = [...nominalArrayFactors]; afMinus[i] = 1 - tol;

            const fPlus  = evalAtPoint(nominalScalars, afPlus);
            const fMinus = evalAtPoint(nominalScalars, afMinus);
            if (fPlus === undefined || fMinus === undefined) continue;

            const sensitivity = (fPlus - fMinus) / 2;
            sumSq += sensitivity * sensitivity;
          }

          if (sumSq > 0) {
            const sigmaOut = Math.sqrt(sumSq);
            const nsigma   = tolMode === "gaussian" ? tolSigma : 1;
            result.range = {
              min: nominal - nsigma * sigmaOut,
              max: nominal + nsigma * sigmaOut,
              source: "propagated",
              nominalValue: nominal,
              mode: tolMode,
              sigma: tolSigma,
            };
          }
        }
      }
    }

    const substituted = substituteIdentifiersForExplain(
      symbol.ast,
      (identifier): { value: number; unit?: string } | undefined => {
        if (symbols.has(identifier)) {
          const dependency = evaluateSymbol(identifier);
          if (!dependency?.quantity) {
            return undefined;
          }
          return {
            value: toDisplayValue(dependency.quantity),
            unit: toDisplayUnit(dependency.quantity),
          };
        }

        if (externalValues.has(identifier)) {
          const externalQuantity = resolveExternalQuantity(identifier);
          if (externalQuantity) {
            return {
              value: toDisplayValue(externalQuantity),
              unit: toDisplayUnit(externalQuantity),
            };
          }

          const fallback = externalValues.get(identifier);
          return typeof fallback === "number"
            ? { value: fallback, unit: externalUnits.get(identifier) }
            : undefined;
        }

        return undefined;
      }
    );

    result.expanded = printExpression(substituted);
    const resolvedDependencies: string[] = [];
    for (const dependencyName of symbol.dependencies) {
      if (symbols.has(dependencyName)) {
        const dependency = evaluateSymbol(dependencyName);
        const resolved = formatResolvedDependency(
          dependencyName,
          dependency?.quantity
        );
        if (resolved) {
          resolvedDependencies.push(resolved);
        }
        continue;
      }

      const externalQuantity = resolveExternalQuantity(dependencyName);
      const resolved = formatResolvedDependency(
        dependencyName,
        externalQuantity,
        externalValues.get(dependencyName)
      );
      if (resolved) {
        resolvedDependencies.push(resolved);
      }
    }
    result.resolvedDependencies = resolvedDependencies;

    result.explainSteps = buildExplainSteps(result.expanded, {
      lookup: (functionName, args) => csvLookup(functionName, args),
      maxSteps: 16,
    });

    if (typeof result.value === "number" && Number.isFinite(result.value)) {
      const last = result.explainSteps[result.explainSteps.length - 1];
      const finalStep = `= ${formatExplainNumber(result.value)}`;
      if (last !== finalStep) {
        result.explainSteps.push(finalStep);
      }
    }

    if (
      symbol.declaredUnit &&
      quantity &&
      result.outputUnit &&
      !result.errors.length &&
      !result.warnings.length
    ) {
      // This additional guard helps surface expressions that silently became
      // dimensionless because of missing dependencies.
      if (result.outputUnit === formatDimension(quantity.dimension)) {
        addWarning(
          `output unit fallback used (${result.outputUnit}) because no canonical unit mapping was found`
        );
      }
    }

    evaluating.delete(name);
    return result;
  };

  for (const name of symbols.keys()) {
    evaluateSymbol(name);
  }

  for (const symbol of evaluated.values()) {
    for (const error of symbol.errors) {
      createDiagnostic(diagnostics, symbol.name, symbol.line, "error", error);
    }
    for (const warning of symbol.warnings) {
      createDiagnostic(diagnostics, symbol.name, symbol.line, "warning", warning);
    }
  }

  const missingSuggestions: MissingYamlSuggestion[] = [];
  for (const [name, unit] of externalUnits) {
    if (symbols.has(name)) {
      continue;
    }

    const value = externalValues.get(name);
    missingSuggestions.push({
      name,
      unit,
      value: Number.isFinite(value ?? Number.NaN) ? value : undefined,
    });
  }

  return {
    symbols: evaluated,
    diagnostics,
    cycles,
    missingSuggestions,
  };
}
