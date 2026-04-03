import type { CsvTableMap } from "../core/csvTables";
import { getYamlTopLevelLine } from "../core/yamlParser";
import {
  collectIdentifiers,
  parseExpression,
  printExpression,
  type ExpressionNode,
} from "./ast";
import { createCsvLookupResolver } from "./csvLookup";
import {
  buildExplainSteps,
  evaluateExpressionAst,
  preprocessExpression,
  substituteIdentifiersForExplain,
  type EvaluationContext,
} from "./evaluator";
import {
  applyOutputUnit,
  createQuantity,
  dimensionsEqual,
  formatDimension,
  getUnitSpec,
  toDisplayUnit,
  toDisplayValue,
  type UnitSpec,
  type Quantity,
} from "./units";

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
  declaredUnit?: string;
  effectiveUnit?: string;
  yamlValue?: number;
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
  errors: string[];
  warnings: string[];
};

export type YamlEvaluationResult = {
  symbols: Map<string, EvaluatedYamlSymbol>;
  diagnostics: YamlEvaluationDiagnostic[];
  cycles: string[][];
  missingSuggestions: MissingYamlSuggestion[];
};

export type EvaluateYamlOptions = {
  rawText: string;
  externalValues?: Map<string, number>;
  externalUnits?: Map<string, string>;
  csvTables?: CsvTableMap;
};

function toNumericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
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

  if (toNumericValue(node.value) != null) {
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
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(10).replace(/\.?0+$/, "");
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

const SCALABLE_UNIT_FAMILY = new Map<string, string>([
  // Time
  ["s", "time"],
  ["ms", "time"],
  ["us", "time"],
  ["ns", "time"],
  // Length
  ["m", "length"],
  ["km", "length"],
  ["dm", "length"],
  ["cm", "length"],
  ["mm", "length"],
  ["um", "length"],
  ["nm", "length"],
  // Area / volume
  ["m2", "area"],
  ["cm2", "area"],
  ["mm2", "area"],
  ["m3", "volume"],
  ["l", "volume"],
  ["ml", "volume"],
  // Mass
  ["kg", "mass"],
  ["g", "mass"],
  ["mg", "mass"],
  ["ug", "mass"],
  // Pressure / force
  ["pa", "pressure"],
  ["kpa", "pressure"],
  ["mpa", "pressure"],
  ["n", "force"],
  ["kn", "force"],
  // Electrical
  ["a", "current"],
  ["ma", "current"],
  ["ua", "current"],
  ["v", "voltage"],
  ["mv", "voltage"],
  ["kv", "voltage"],
  ["ohm", "resistance"],
  ["kohm", "resistance"],
  ["mohm", "resistance"],
  ["siemens", "conductance"],
  ["msiemens", "conductance"],
  ["usiemens", "conductance"],
  ["f", "capacitance"],
  ["mf", "capacitance"],
  ["uf", "capacitance"],
  ["nf", "capacitance"],
  ["pf", "capacitance"],
  ["hry", "inductance"],
  ["mhry", "inductance"],
  ["uhry", "inductance"],
  ["nhry", "inductance"],
  // Frequency / power / energy
  ["hz", "frequency"],
  ["khz", "frequency"],
  ["mhz", "frequency"],
  ["ghz", "frequency"],
  ["w", "power"],
  ["mw", "power"],
  ["kw", "power"],
  ["mwatt", "power"],
  ["j", "energy"],
  ["kj", "energy"],
  ["mj", "energy"],
  ["t", "magnetic_flux_density"],
  ["mt", "magnetic_flux_density"],
]);

function shouldConvertPureExpressionOutput(
  quantity: Quantity,
  outputSpec: UnitSpec
): boolean {
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
  return Boolean(sourceFamily && targetFamily && sourceFamily === targetFamily);
}

function createDiagnostic(
  diagnostics: YamlEvaluationDiagnostic[],
  symbol: string,
  line: number,
  severity: DiagnosticSeverity,
  message: string
): void {
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
    const declaredUnit = typeof node.unit === "string" ? node.unit.trim() : undefined;
    const effectiveUnit = declaredUnit || externalUnits.get(name);
    const yamlValue = toNumericValue(node.value);

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
        dependencies: [],
        parseError: "unknown symbol type",
      });
      continue;
    }

    if (type === "const") {
      const value = toNumericValue(node.value);
      if (value == null) {
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
        literalValue: value,
        declaredUnit,
        effectiveUnit,
        yamlValue,
        dependencies: [],
      });
      continue;
    }

    const expression =
      (typeof node.expr === "string" ? node.expr : undefined) ??
      (typeof node.formula === "string" ? node.formula : undefined) ??
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
        dependencies: [],
        parseError: "missing expression",
      });
      continue;
    }

    try {
      const ast = parseExpression(preprocessExpression(expression));
      const dependencies = Array.from(collectIdentifiers(ast)).sort();

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
  const csvLookup = createCsvLookupResolver(options.csvTables);

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

      createDiagnostic(
        diagnostics,
        symbol.name,
        symbol.line,
        "error",
        `undefined variable '${dependency}'`
      );
    }
  }

  const evaluated = new Map<string, EvaluatedYamlSymbol>();
  const evaluating = new Set<string>();

  const resolveExternalQuantity = (name: string): Quantity | undefined => {
    const value = externalValues.get(name);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return undefined;
    }

    const unit = externalUnits.get(name);
    const quantity = createQuantity(value, unit);
    if (!quantity.ok) {
      return undefined;
    }

    return quantity.value;
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

    evaluated.set(name, result);

    if (cycleNodes.has(name)) {
      result.errors.push("evaluation skipped because of circular dependency");
      return result;
    }

    if (symbol.parseError) {
      result.errors.push(symbol.parseError);
      return result;
    }

    if (evaluating.has(name)) {
      result.errors.push(`recursive evaluation detected for '${name}'`);
      return result;
    }

    evaluating.add(name);

    if (symbol.type === "const") {
      if (typeof symbol.literalValue !== "number" || !Number.isFinite(symbol.literalValue)) {
        result.errors.push(`const '${name}' has invalid numeric value`);
        evaluating.delete(name);
        return result;
      }

      const quantity = createQuantity(symbol.literalValue, symbol.effectiveUnit);
      if (!quantity.ok) {
        result.errors.push(quantity.error);
        evaluating.delete(name);
        return result;
      }

      result.quantity = quantity.value;
      result.value = toDisplayValue(quantity.value);
      result.outputUnit = toDisplayUnit(quantity.value);
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

      evaluating.delete(name);
      return result;
    }

    if (!symbol.ast || !symbol.expression) {
      result.errors.push("expression is not available");
      evaluating.delete(name);
      return result;
    }

    const context: EvaluationContext = {
      resolveIdentifier: (identifier: string): Quantity | undefined => {
        if (symbols.has(identifier)) {
          const dependency = evaluateSymbol(identifier);
          return dependency?.quantity;
        }

        return resolveExternalQuantity(identifier);
      },
      resolveLookup: (functionName, args) => csvLookup(functionName, args),
    };

    const evaluatedExpression = evaluateExpressionAst(symbol.ast, context);
    if (!evaluatedExpression.ok) {
      result.errors.push(evaluatedExpression.error);
      evaluating.delete(name);
      return result;
    }

    let quantity = evaluatedExpression.quantity;
    if (symbol.effectiveUnit) {
      // Always validate output-unit compatibility.
      const outputSpec = getUnitSpec(symbol.effectiveUnit);
      if (!outputSpec) {
        result.errors.push(`unknown unit '${symbol.effectiveUnit}'`);
        evaluating.delete(name);
        return result;
      }

      if (!dimensionsEqual(quantity.dimension, outputSpec.dimension)) {
        result.errors.push(
          `unit mismatch: expression has ${formatDimension(quantity.dimension)} ` +
            `but output unit '${outputSpec.canonical}' requires ${formatDimension(outputSpec.dimension)}`
        );
        evaluating.delete(name);
        return result;
      }

      const shouldConvertOutput =
        expressionNeedsOutputConversion(symbol.ast) ||
        shouldConvertPureExpressionOutput(quantity, outputSpec);
      if (shouldConvertOutput) {
        const output = applyOutputUnit(quantity, symbol.effectiveUnit);
        if (!output.ok) {
          result.errors.push(output.error);
          evaluating.delete(name);
          return result;
        }

        quantity = output.value.quantity;
        result.value = output.value.displayValue;
        result.outputUnit = output.value.displayUnit;
        result.quantity = quantity;
      } else {
        // Conversion is skipped for pure scale/mul/div expressions.
        result.quantity = quantity;
        result.value = toDisplayValue(quantity);
        result.outputUnit = toDisplayUnit(quantity);
      }
    } else {
      result.quantity = quantity;
      result.value = toDisplayValue(quantity);
      result.outputUnit = toDisplayUnit(quantity);
    }

    const substituted = substituteIdentifiersForExplain(
      symbol.ast,
      (identifier): number | undefined => {
        if (symbols.has(identifier)) {
          const dependency = evaluateSymbol(identifier);
          if (!dependency?.quantity) {
            return undefined;
          }
          return toDisplayValue(dependency.quantity);
        }

        if (externalValues.has(identifier)) {
          const externalQuantity = resolveExternalQuantity(identifier);
          if (externalQuantity) {
            return toDisplayValue(externalQuantity);
          }

          const fallback = externalValues.get(identifier);
          return typeof fallback === "number" ? fallback : undefined;
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
        result.warnings.push(
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
