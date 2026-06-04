import type { CalcDocsState } from "../core/state";
import type { 
  FormulaEntry as CoreFormulaEntry,
  TolMode
} from "../types/FormulaEntry";
import {
  parseExpression,
  type ExpressionNode,
} from "../engine/ast";
import {
  evaluateExpressionWithOutputUnit,
  preprocessExpression,
  type EvaluationContext,
} from "../engine/evaluator";
import { createCsvLookupResolver } from "../engine/csvLookup";
import {
  createDimensionlessQuantity,
  createQuantity,
  createQuantityFromData,
  getUnitSpec,
  toDisplayUnit,
  toDisplayValue,
  type Quantity,
  type UnitResult,
} from "../engine/units";
import type {
  EvalStep,
  FormulaEntry,
  FormulaInputNode,
  FormulaTreeNode,
} from "./webview-types";
import { runMonteCarlo, distributionFromTolerance, type McInput } from "../engine/monteCarlo";

export const MAX_INTERACTIVE_DEPTH = 5;

type FormulaKind = "formula" | "constant" | "leaf";

type SymbolEvaluation = {
  name: string;
  quantity?: Quantity;
  value?: number;
  unit?: string;
  expression?: string;
  errors: string[];
  warnings: string[];
};

export type InteractiveEvaluationResult = {
  rootId: string;
  value: number | null;
  unit?: string;
  values: Record<string, number>;
  units: Record<string, string>;
  errors: Record<string, string[]>;
  warnings: Record<string, string[]>;
  active: string[];
  propagation: string[];
  steps: EvalStep[];
  tree: FormulaTreeNode;
  last?: string;
};

type BuildTreeOptions = {
  evaluation?: InteractiveEvaluationResult;
  overrides?: Record<string, number>;
  liveRanges?: Map<string, { min: number; max: number; source: "propagated"; mode?: TolMode; sigma?: number } | undefined>;
};

const BUILTIN_IDENTIFIERS = new Set([
  "abs",
  "cos",
  "csv",
  "lookup",
  "sin",
  "table",
  "__unit",
]);

const SUPPRESS_INTERACTIVE_WARNINGS = [
  /missing value for /,
  /incompatible units/i,
  /unit mismatch/i,
];

const SUPPRESS_INTERACTIVE_ERRORS = [
  /unit mismatch/i,
  /incompatible units/i,
];

function isSuppressedInteractiveWarning(message: string): boolean {
  return SUPPRESS_INTERACTIVE_WARNINGS.some((re) => re.test(message));
}

function isSuppressedInteractiveError(message: string): boolean {
  return SUPPRESS_INTERACTIVE_ERRORS.some((re) => re.test(message));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function addUnique(target: string[], message: string): void {
  if (!target.includes(message)) {
    target.push(message);
  }
}

/**
 * Returns an up-to-date range for `name`, recomputing absolute bounds when
 * the stored tolerance is percentage-based (`tol`) and a fresh `currentValue`
 * is available.  For explicit min/max or propagated ranges the stored values
 * are returned unchanged.
 */
function liveRange(
  toleranceResult: CoreFormulaEntry['toleranceResult'] | undefined,
  currentValue: number | undefined
): { min: number; max: number; source: 'declared' | 'propagated'; mode?: 'worst_case' | 'rss' | 'gaussian'; sigma?: number } | undefined {
  if (!toleranceResult) return undefined;

  // Use `as any` so extra fields work even if the TS type lags behind.
  const tr = toleranceResult as any;

  // ── Case 1: root-level tol (e.g. `tol: 5` on the formula itself) ──────────
  // Recompute exact ±tol% bounds from the live output value.
  if (tr.tol !== undefined && isFiniteNumber(currentValue)) {
    const delta = Math.abs(currentValue) * Math.abs(tr.tol) / 100;
    return {
      min: currentValue - delta,
      max: currentValue + delta,
      source: 'declared',
      mode: tr.mode,
      sigma: tr.sigma,
    };
  }

  // ── Case 2: propagated range (from dependency parameter tolerances) ────────
  // Scale min/max proportionally with the new output value, using the nominal
  // value stored at analysis time as the reference.
  if (
    toleranceResult.source === 'propagated' &&
    isFiniteNumber(tr.nominalValue) &&
    tr.nominalValue !== 0 &&
    isFiniteNumber(currentValue)
  ) {
    const scale = currentValue / tr.nominalValue;
    return {
      min: toleranceResult.min * scale,
      max: toleranceResult.max * scale,
      source: 'propagated',
      mode: tr.mode,
      sigma: tr.sigma,
    };
  }

  // ── Case 3: explicit min/max (absolute bounds) ────────────────────────────
  // Do not rescale — these are fixed acceptance limits, not relative tolerances.
  return {
    min: toleranceResult.min,
    max: toleranceResult.max,
    source: toleranceResult.source,
    mode: tr.mode,
    sigma: tr.sigma,
  };
}

function collectIdentifiersInOrder(expression: string): string[] {
  const identifiers: string[] = [];
  const seen = new Set<string>();

  const push = (name: string): void => {
    if (BUILTIN_IDENTIFIERS.has(name.toLowerCase()) || seen.has(name)) {
      return;
    }
    seen.add(name);
    identifiers.push(name);
  };

  const walk = (node: ExpressionNode): void => {
    switch (node.kind) {
      case "identifier":
        push(node.name);
        return;
      case "number":
      case "string":
        return;
      case "unary":
        walk(node.argument);
        return;
      case "binary":
        walk(node.left);
        walk(node.right);
        return;
      case "call":
        for (const arg of node.args) {
          walk(arg);
        }
        return;
    }
  };

  try {
    walk(parseExpression(preprocessExpression(expression)));
    return identifiers;
  } catch {
    const matcher = /\b([A-Za-z_][A-Za-z0-9_.]*)\b(?!\s*\()/g;
    for (const match of expression.matchAll(matcher)) {
      push(match[1]);
    }
    return identifiers;
  }
}

function getEntryExpression(entry: CoreFormulaEntry): string {
  if (entry.formula) {
    return entry.formula;
  }

  if (isFiniteNumber(entry.valueYaml)) {
    return String(entry.valueYaml);
  }

  if (isFiniteNumber(entry.valueCalc)) {
    return String(entry.valueCalc);
  }

  return "";
}

function getEntryKind(entry: CoreFormulaEntry | undefined): FormulaKind {
  if (!entry) {
    return "leaf";
  }
  // Se l'entry ha una formula stringa complessa è una formula, altrimenti è una costante modificabile
  return (entry.formula && entry.formula.trim().length > 0) ? "formula" : "constant";
}

function getDefaultValue(
  name: string,
  entry: CoreFormulaEntry | undefined,
  state: CalcDocsState
): number | undefined {
  if (isFiniteNumber(entry?.valueYaml)) {
    return entry.valueYaml;
  }

  if (isFiniteNumber(entry?.valueCalc)) {
    return entry.valueCalc;
  }

  const stateValue = state.symbolValues.get(name);
  return isFiniteNumber(stateValue) ? stateValue : undefined;
}

function getUnit(
  name: string,
  entry: CoreFormulaEntry | undefined,
  state: CalcDocsState
): string | undefined {
  return entry?.unit ?? state.symbolUnits.get(name);
}

function createQuantityForSymbol(
  value: number,
  unit: string | undefined
): { quantity?: Quantity; error?: string } {
  const result = createFormulaDataQuantity(value, unit);

  if (!result.ok) {
    return { error: result.error };
  }

  return { quantity: result.value };
}

function createFormulaDataQuantity(
  value: number,
  unit: string | undefined
): UnitResult<Quantity> {
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
}

function getRawYamlBlock(entry: CoreFormulaEntry, state: CalcDocsState): string | undefined {
  if (!state.lastYamlRaw || entry._line == null || entry._line < 0) {
    return undefined;
  }

  const lines = state.lastYamlRaw.split(/\r?\n/);
  if (entry._line >= lines.length) {
    return undefined;
  }

  // 1. Trova l'inizio reale (include commenti e righe vuote sopra la chiave)
  let start = entry._line;
  for (let index = entry._line - 1; index >= 0; index -= 1) {
    const line = lines[index];
    
    // Se la riga è un commento (inizia con #) o è vuota/contiene solo spazi
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
      start = index;
    } else {
      // Si ferma al primo contenuto che non è un commento o riga vuota
      break;
    }
  }

  // 2. Trova l'inizio del blocco successivo (o la fine del file)
  let nextBlockStart = lines.length;
  for (let index = entry._line + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S.*:\s*(?:#.*)?$/.test(line)) {
      nextBlockStart = index;
      break;
    }
  }

  // 3. Torna indietro dall'inizio del blocco successivo per rimuovere i commenti in coda
  let end = nextBlockStart;
  for (let index = nextBlockStart - 1; index > entry._line; index -= 1) {
    const line = lines[index];
    // Se è un commento o una riga vuota, arretra la fine del blocco corrente
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
      end = index;
    } else {
      break;
    }
  }

  // Affetta l'array partendo dal nuovo 'start' calcolato
  return lines.slice(start, end).join("\n").trimEnd();
}

function formatResolvedExpression(
  expression: string,
  values: Record<string, number>
): string {
  let resolved = expression;
  const names = Object.keys(values).sort((left, right) => right.length - left.length);

  for (const name of names) {
    const value = values[name];
    if (!Number.isFinite(value)) {
      continue;
    }

    resolved = resolved.replace(
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"),
      Number.parseFloat(value.toPrecision(8)).toString()
    );
  }

  return resolved;
}

export class InteractiveFormulaEngine {
  private readonly csvLookup: EvaluationContext["resolveLookup"];

  constructor(private readonly state: CalcDocsState) {
    this.csvLookup = createCsvLookupResolver(
      state.csvTables,
      state.lastYamlPath || undefined
    );
  }

  private computeLiveRange(
    name: string,
    values: Record<string, number>,
    units: Record<string, string>
  ): { min: number; max: number; source: "propagated"; mode?: TolMode; sigma?: number } | undefined {

    const entry = this.state.formulaIndex.get(name);
    if (!entry?.formula) return undefined;

    // La formula deve avere tol_mode dichiarato OPPURE avere dipendenze con tolleranza
    // per avere senso calcolare un range propagato.
    const tolMode: TolMode  = entry.tolerance?.mode  ?? "worst_case";
    const tolSigma: number  = entry.tolerance?.sigma  ?? 3;

    // Raccoglie gli input con range dichiarati (dalle dipendenze dirette)
    const deps = collectIdentifiersInOrder(entry.formula);

    // Costruisce i range degli input partendo dai toleranceResult delle dipendenze
    // o dai tolerance.parameters dichiarati sulla formula
    const inputRanges: Array<{ name: string; min: number; max: number }> = [];

    for (const depName of deps) {
      const depVal  = values[depName];
      const depEntry = this.state.formulaIndex.get(depName);

      // Priorità 1: override esplicito sul parametro nella tolerance della formula padre
      const paramTol = entry.tolerance?.parameters?.[depName];
      if (paramTol) {
        if (paramTol.min !== undefined && paramTol.max !== undefined) {
          inputRanges.push({ name: depName, min: paramTol.min, max: paramTol.max });
          continue;
        }
        if (paramTol.tol !== undefined) {
          const ref = isFiniteNumber(depVal) ? depVal
            : isFiniteNumber(depEntry?.valueCalc ?? depEntry?.valueYaml)
              ? (depEntry!.valueCalc ?? depEntry!.valueYaml)!
              : undefined;
          if (ref !== undefined) {
            const delta = Math.abs(ref) * Math.abs(paramTol.tol) / 100;
            inputRanges.push({ name: depName, min: ref - delta, max: ref + delta });
            continue;
          }
        }
      }

      // Priorità 2: la dipendenza è una costante con tol dichiarata → usa valore corrente
      if (depEntry && !depEntry.formula && depEntry.tolerance?.tol !== undefined) {
        const ref = isFiniteNumber(depVal) ? depVal
          : isFiniteNumber(depEntry.valueCalc ?? depEntry.valueYaml)
            ? (depEntry.valueCalc ?? depEntry.valueYaml)!
            : undefined;
        if (ref !== undefined) {
          const delta = Math.abs(ref) * Math.abs(depEntry.tolerance.tol) / 100;
          inputRanges.push({ name: depName, min: ref - delta, max: ref + delta });
          continue;
        }
      }

      // Priorità 3: la dipendenza ha un toleranceResult dichiarato con min/max assoluti
      if (depEntry?.toleranceResult) {
        const tr = depEntry.toleranceResult;
        if (tr.tol !== undefined) {
          // range dichiarato percentuale → scala al valore corrente
          const ref = isFiniteNumber(depVal) ? depVal
            : isFiniteNumber((tr as any).nominalValue) ? (tr as any).nominalValue
            : undefined;
          if (ref !== undefined) {
            const delta = Math.abs(ref) * Math.abs(tr.tol) / 100;
            inputRanges.push({ name: depName, min: ref - delta, max: ref + delta });
            continue;
          }
        } else {
          // range assoluto: scala proporzionalmente se il valore corrente è diverso dal nominale
          const nominal = (tr as any).nominalValue;
          if (isFiniteNumber(depVal) && isFiniteNumber(nominal) && nominal !== 0) {
            const scale = depVal / nominal;
            inputRanges.push({ name: depName, min: tr.min * scale, max: tr.max * scale });
          } else {
            inputRanges.push({ name: depName, min: tr.min, max: tr.max });
          }
          continue;
        }
      }

      // Priorità 4: la dipendenza è essa stessa una formula con range propagato →
      // ricorsione un livello (evita ricorsione profonda con un guard)
      if (depEntry?.formula && depEntry.toleranceResult?.source === "propagated") {
        const tr = depEntry.toleranceResult;
        const nominal = (tr as any).nominalValue;
        if (isFiniteNumber(depVal) && isFiniteNumber(nominal) && nominal !== 0) {
          const scale = depVal / nominal;
          inputRanges.push({ name: depName, min: tr.min * scale, max: tr.max * scale });
        } else {
          inputRanges.push({ name: depName, min: tr.min, max: tr.max });
        }
      }
      // Se nessuna condizione si applica, la dipendenza non contribuisce alla tolleranza
    }

    if (inputRanges.length === 0 || inputRanges.length > 12) 
      return undefined;

    // Funzione di valutazione nel punto dato
    const evalAtPoint = (overrides: Record<string, number>): number | undefined => {
      const ctx: EvaluationContext = {
        resolveIdentifier: (id) => {
          const v = overrides[id] ?? values[id];
          if (v === undefined) return undefined;
          const unit = units[id] ?? this.state.symbolUnits.get(id);
          const q = unit ? createFormulaDataQuantity(v, unit) : createQuantity(v);
          return q.ok ? q.value : undefined;
        },
        resolveArrayIdentifier: (id) => {
          const depEntry = this.state.formulaIndex.get(id);
          if (!depEntry?.valueYamlList) return undefined;
          const u = getUnit(id, depEntry, this.state);
          return depEntry.valueYamlList.map(v => {
            const q = createFormulaDataQuantity(v, u);
            return q.ok ? q.value : createDimensionlessQuantity(v);
          });
        },
        resolveLookup: this.csvLookup,
        ignoreUnitCompatibility: true,
      };
      const res = evaluateExpressionWithOutputUnit(entry!.formula!, ctx, getUnit(name, entry, this.state));
      return res.ok ? (res.displayValue ?? toDisplayValue(res.quantity)) : undefined;
    };

    const nominalOverrides = Object.fromEntries(
      inputRanges.map(r => [r.name, (r.min + r.max) / 2])
    );
    const nominal = evalAtPoint(nominalOverrides) ?? values[name];
    if (!isFiniteNumber(nominal)) return undefined;

    if (tolMode === "worst_case") {
      const allValues: number[] = [];
      const n = inputRanges.length;
      for (let mask = 0; mask < (1 << n); mask++) {
        const point: Record<string, number> = {};
        inputRanges.forEach((r, i) => {
          point[r.name] = (mask & (1 << i)) === 0 ? r.min : r.max;
        });
        const v = evalAtPoint(point);
        if (isFiniteNumber(v)) allValues.push(v);
      }
      if (!allValues.length) return undefined;
      return {
        min: Math.min(...allValues),
        max: Math.max(...allValues),
        source: "propagated",
        mode: tolMode,
        sigma: tolSigma,
      };

    } else {
      // RSS or Gaussian → Monte Carlo
      const mcInputs: McInput[] = inputRanges.map(r => ({
        name: r.name,
        distribution: distributionFromTolerance(
          tolMode,
          r.min, r.max,
          (r.min + r.max) / 2,
          tolSigma
        ),
      }));

      const mcResult = runMonteCarlo(mcInputs, evalAtPoint as any, { nSamples: 10_000 });

      if (Number.isFinite(mcResult.mean)) {
        return {
          min: mcResult.p025,
          max: mcResult.p975,
          source: "propagated",
          mode: tolMode,
          sigma: tolSigma,
        };
      }
    }

    // RSS / gaussian
    let sumSq = 0;
    for (const r of inputRanges) {
      const halfSpan = (r.max - r.min) / 2;
      if (halfSpan <= 0) continue;
      const plus  = { ...nominalOverrides, [r.name]: nominalOverrides[r.name] + halfSpan };
      const minus = { ...nominalOverrides, [r.name]: nominalOverrides[r.name] - halfSpan };
      const fPlus  = evalAtPoint(plus);
      const fMinus = evalAtPoint(minus);
      if (!isFiniteNumber(fPlus) || !isFiniteNumber(fMinus)) continue;
      const sens = (fPlus - fMinus) / 2;
      sumSq += sens * sens;
    }
    if (sumSq <= 0) return undefined;
    const sigmaOut = Math.sqrt(sumSq);
    const nsigma   = tolMode === "gaussian" ? tolSigma : 1;
    return {
      min: nominal - nsigma * sigmaOut,
      max: nominal + nsigma * sigmaOut,
      source: "propagated",
      mode: tolMode,
      sigma: tolSigma,
    };
  }


  createFormulaEntry(entry: CoreFormulaEntry, options: BuildTreeOptions = {}): FormulaEntry {
    const expression = getEntryExpression(entry);
    const tree = this.buildTree(entry.key, [], 0, options);
    const value = options.evaluation?.values[entry.key] ?? getDefaultValue(entry.key, entry, this.state);
    const rawYaml = getRawYamlBlock(entry, this.state);
    // const toleranceResult = entry.toleranceResult;
    // const range: { min: number; max: number; source: "declared" | "propagated" } | undefined = toleranceResult
    //   ? { min: toleranceResult.min, max: toleranceResult.max, source: toleranceResult.source }
    //   : tree.result?.range;
    const range = liveRange(entry.toleranceResult, value) ?? tree.result?.range;

    return {
      id: entry.key,
      name: entry.key,
      expression,
      unit: getUnit(entry.key, entry, this.state),
      localInputs: tree.localInputs,
      tree,
      rawYaml,
      value,
      range,
      errors: options.evaluation?.errors[entry.key] ?? entry.evaluationErrors,
      warnings: options.evaluation?.warnings[entry.key] ?? entry.evaluationWarnings,
      line: entry._line !== undefined ? entry._line + 1 : undefined,
      type: getEntryKind(entry) === "formula" ? "formula" : "constant",
    };
  }

  evaluate(
    rootId: string,
    overrides: Record<string, number>,
    changedId?: string
  ): InteractiveEvaluationResult {
    const values: Record<string, number> = {};
    const units: Record<string, string> = {};
    const errors: Record<string, string[]> = {};
    const warnings: Record<string, string[]> = {};
    let steps: EvalStep[] = [];
    const memo = new Map<string, SymbolEvaluation>();

    const record = (result: SymbolEvaluation): SymbolEvaluation => {
      if (isFiniteNumber(result.value)) {
        values[result.name] = result.value;
      }
      if (result.unit) {
        units[result.name] = result.unit;
      }
      if (result.errors.length > 0) {
        errors[result.name] = result.errors;
      }
      if (result.warnings.length > 0) {
        warnings[result.name] = result.warnings;
      }
      memo.set(result.name, result);
      return result;
    };

    const evaluateSymbol = (name: string, stack: string[], targetSteps: EvalStep[] = []): SymbolEvaluation => {
      const overrideValue = overrides[name];
      
      // 1. Cerca nell'indice globale (formule locali o globali già caricate)
      let entry = this.state.formulaIndex.get(name);
      
      // VIRTUALIZZAZIONE: Se non esiste e contiene un punto (es: "motore.giri"), 
      // proviamo a risolverla cercando la variabile standalone "giri" o caricandola dal contesto
      if (!entry && name.includes('.')) {
        const parts = name.split('.');
        const bareName = parts[parts.length - 1];
        // Usa il fallback SOLO se il nome nudo non è definito localmente.
        // Se 'vin' esiste nel formulaIndex come costante inline, allora
        // 'config.vin' è un simbolo distinto e non deve alias-are su 'vin'.
        if (!this.state.formulaIndex.has(bareName)) {
          entry = this.state.formulaIndex.get(bareName);
        }
      }

      const unit = getUnit(name, entry, this.state);

      if (isFiniteNumber(overrideValue)) {
        const created = createQuantityForSymbol(overrideValue, unit);
        const result: SymbolEvaluation = {
          name,
          quantity: created.quantity ?? createDimensionlessQuantity(overrideValue),
          value: overrideValue,
          unit,
          errors: [],
          warnings: created.error ? [created.error] : [],
        };
        return record(result);
      }

      const cached = memo.get(name);
      if (cached) {
        return cached;
      }

      const cycleIndex = stack.indexOf(name);
      if (cycleIndex >= 0) {
        const cyclePath = [...stack.slice(cycleIndex), name];
        return record({
          name,
          value: undefined,
          unit,
          errors: [`cyclic dependency detected: ${cyclePath.join(" -> ")}`],
          warnings: [],
        });
      }


      if (!entry) {
        // Gestione dei fallback nel caso di simboli mappati da codice C standard o esterni senza formula espressa
        let externalValue = this.state.symbolValues.get(name);
        
        // Fallback virtualizzato per il valore numerico se ha il punto
        if (externalValue == null && name.includes('.')) {
          const parts = name.split('.');
          const bareName = parts[parts.length - 1];
          // Stesso criterio: non fare fallback se il nome nudo è definito localmente
          if (!this.state.formulaIndex.has(bareName)) {
            externalValue = this.state.symbolValues.get(bareName);
          }
        }

        if (isFiniteNumber(externalValue)) {
          const created = createQuantityForSymbol(externalValue, unit);
          return record({
            name,
            quantity: created.quantity ?? createDimensionlessQuantity(externalValue),
            value: externalValue,
            unit,
            errors: [],
            warnings: created.error ? [created.error] : [],
          });
        }

        return record({
          name,
          unit,
          errors: [],
          warnings: [],
        });
      }

      if (!entry.formula) {
        const value = getDefaultValue(name, entry, this.state);
        if (!isFiniteNumber(value)) {
          return record({
            name,
            unit,
            errors: [`constant '${name}' has no numeric value`],
            warnings: [],
          });
        }

        const created = createQuantityForSymbol(value, unit);
        return record({
          name,
          quantity: created.quantity,
          value,
          unit,
          expression: String(value),
          errors: created.error ? [created.error] : [],
          warnings: [],
        });
      }

      const expression = entry.formula;
      const dependencyErrors: string[] = [];
      const dependencyWarnings: string[] = [];
      const nextStack = [...stack, name];

      const resolveArrayIdentifier = (name: string): Quantity[] | undefined => {
        const depEntry = this.state.formulaIndex.get(name);
        if (depEntry?.valueYamlList) {
          const unit = getUnit(name, depEntry, this.state);
          const quantities: Quantity[] = [];
          for (const v of depEntry.valueYamlList) {
            if (unit) {
              const q = createFormulaDataQuantity(v, unit);
              if (q.ok) quantities.push(q.value);
              else return undefined;
            } else {
              quantities.push(createDimensionlessQuantity(v));
            }
          }
          return quantities;
        }
        return undefined;
      };

      const resolveFunctionCall = (functionName: string, args: Quantity[]): UnitResult<Quantity> | undefined => {
        const fnEntry = this.state.formulaIndex.get(functionName);
        if (!fnEntry?.formula || !fnEntry.parameters) {
          return undefined;
        }

        // Evalua la formula sostituendo i parametri con gli argomenti
        const boundParameters = new Map<string, Quantity>();
        fnEntry.parameters.forEach((param, idx) => {
          if (idx < args.length) {
            boundParameters.set(param, args[idx]);
          }
        });

        const fnContext: EvaluationContext = {
          resolveIdentifier: (identifier) => {
            const bound = boundParameters.get(identifier);
            if (bound) return bound;
            // Risolvi altre dipendenze dalla formula
            const dep = evaluateSymbol(identifier, nextStack, targetSteps);
            return dep.quantity;
          },
          resolveArrayIdentifier,
          resolveLookup: this.csvLookup,
          ignoreUnitCompatibility: true,
          onWarning: (message) => {
            if (!isSuppressedInteractiveWarning(message)) {
              addUnique(dependencyWarnings, message);
            }
          },
        };

        const result = evaluateExpressionWithOutputUnit(fnEntry.formula, fnContext, getUnit(functionName, fnEntry, this.state));
        if (!result.ok) {
          return { ok: false, error: result.error };
        }
        return { ok: true, value: result.quantity };
      };

      const context: EvaluationContext = {
        resolveIdentifier: (identifier) => {
          const dependency = evaluateSymbol(identifier, nextStack, targetSteps);
          for (const error of dependency.errors) {
            addUnique(dependencyErrors, `${identifier}: ${error}`);
          }
          for (const warning of dependency.warnings) {
            // Non propagare "missing value" e unit-mismatch verso il padre:
            // in modalità interattiva sono rumori attesi per parametri liberi.
            if (!isSuppressedInteractiveWarning(warning)) {
              addUnique(dependencyWarnings, `${identifier}: ${warning}`);
            }
          }
          return dependency.quantity;
        },
        resolveArrayIdentifier,
        resolveFunctionCall,
        resolveLookup: this.csvLookup,
        ignoreUnitCompatibility: true,
        onWarning: (message) => {
          if (!isSuppressedInteractiveWarning(message)) {
            addUnique(dependencyWarnings, message);
          }
        },
      };
      const evaluated = evaluateExpressionWithOutputUnit(expression, context, unit);
      const result: SymbolEvaluation = {
        name,
        expression,
        errors: [],
        warnings: dependencyWarnings,
      };

      if (dependencyErrors.length > 0) {
        result.errors.push(...dependencyErrors);
        return record(result);
      }

      if (!evaluated.ok) {
        if (!isSuppressedInteractiveError(evaluated.error)) {
          result.errors.push(evaluated.error);
        }
        //
        return record(result);
      }

      result.quantity = evaluated.quantity;
      result.value = evaluated.displayValue ?? toDisplayValue(evaluated.quantity);
      result.unit = evaluated.displayUnit ?? toDisplayUnit(evaluated.quantity) ?? unit;

      targetSteps.push({
        name,
        expression,
        resolved: formatResolvedExpression(expression, values),
        result: result.value,
        unit: result.unit,
        depth: stack.length, // 0 = radice, 1 = dipendenza diretta, …
        // Real-time tolerance/range snapshot for this step.
        range: (() => {
          const tol = this.state.formulaIndex.get(name)?.toleranceResult;
          if (!tol) return undefined;
          const tr = tol as any;
          const currentValue = result.value;

          if (tr.tol !== undefined && typeof currentValue === "number" && Number.isFinite(currentValue)) {
            const delta = Math.abs(currentValue) * Math.abs(tr.tol) / 100;
            return { min: currentValue - delta, max: currentValue + delta, source: "declared", mode: tr.mode, sigma: tr.sigma };
          }

          if (
            tol.source === "propagated" &&
            isFiniteNumber(tr.nominalValue) &&
            tr.nominalValue !== 0 &&
            typeof currentValue === "number" &&
            Number.isFinite(currentValue)
          ) {
            const scale = currentValue / tr.nominalValue;
            return { min: tol.min * scale, max: tol.max * scale, source: "propagated", mode: tr.mode, sigma: tr.sigma };
          }

          return { min: tol.min, max: tol.max, source: tol.source, mode: tr.mode, sigma: tr.sigma };
        })(),
        // Tolleranze note sui parametri d'ingresso di questa formula.
        // Cerca tolleranze in due modi:
        // 1. tolerance.parameters del YAML (dichiarazioni esplicite del parametro)
        // 2. toleranceResult delle entry dipendenti (tolleranza propria di quel simbolo, dichiarata o propagata)
        inputTolerances: (() => {
          const formulaEntry = this.state.formulaIndex.get(name);
          if (!formulaEntry) return undefined;

          // Raccoglie gli identificatori dipendenti dalla formula corrente
          const depIdentifiers = entry.formula
            ? collectIdentifiersInOrder(entry.formula)
            : [];

          // Priority map: le tolleranze dichiarate esplicitamente su tolerance.parameters hanno la precedenza
          const declaredParams = formulaEntry.tolerance?.parameters ?? {};

          const result: Array<{
            name: string;
            source: 'declared' | 'propagated' | 'unknown';
            tol?: number;
            min?: number;
            max?: number;
          }> = [];

          for (const depName of depIdentifiers) {
            // Caso 1: tolleranza dichiarata esplicitamente in tolerance.parameters
            const paramTol = declaredParams[depName];
            if (paramTol) {
              const entry: {
                name: string;
                source: 'declared' | 'propagated' | 'unknown';
                tol?: number;
                min?: number;
                max?: number;
              } = {
                name: depName,
                source: 'declared',
              };
              if (paramTol.tol !== undefined) entry.tol = paramTol.tol;
              if (paramTol.min !== undefined) entry.min = paramTol.min;
              if (paramTol.max !== undefined) entry.max = paramTol.max;
              result.push(entry);
              continue;
            }

            // Caso 2: la dipendenza ha una tolleranza propria (toleranceResult)
            const depEntry = this.state.formulaIndex.get(depName);
            const depTolResult = depEntry?.toleranceResult;
            if (depTolResult) {
              const tr = depTolResult as any;
              const entry: {
                name: string;
                source: 'declared' | 'propagated' | 'unknown';
                tol?: number;
                min?: number;
                max?: number;
              } = {
                name: depName,
                source: depTolResult.source === 'propagated' ? 'propagated' : 'declared',
                min: depTolResult.min,
                max: depTolResult.max,
              };
              // Se ha tol percentuale, usalo (il range sarà calcolato live)
              if (tr.tol !== undefined) entry.tol = tr.tol;
              result.push(entry);
              continue;
            }

            // Caso 3: nessuna tolleranza nota — lo segnaliamo comunque come 'unknown'
            result.push({
              name: depName,
              source: 'unknown',
            });
          }

          return result.length > 0 ? result : undefined;
        })(),
      });

      return record(result);
    };

    const rootResult = evaluateSymbol(rootId, [], steps);

    for (const [name] of this.state.formulaIndex) {
      if (!memo.has(name)) {
        evaluateSymbol(name, []);
      }
    }

    // Ricalcola i range live per i simboli con tolleranza propagata
    const liveRanges = new Map<string, ReturnType<typeof this.computeLiveRange>>();
    for (const [name, entry] of this.state.formulaIndex) {
      if (entry.formula) {
        const r = this.computeLiveRange(name, values, units);
        if (r) liveRanges.set(name, r);
      }
    }

    // Aggiorna il range negli step con i valori live calcolati
    for (const step of steps) {
      const live = liveRanges.get(step.name);
      if (live) {
        step.range = {
          min: live.min,
          max: live.max,
          source: live.source,
          mode: live.mode,
          sigma: live.sigma,
        };
      }
    }

    const baseResult: InteractiveEvaluationResult = {
      rootId,
      value: isFiniteNumber(rootResult.value) ? rootResult.value : null,
      unit: rootResult.unit,
      values,
      units,
      errors,
      warnings,
      active: Object.keys(values),
      propagation: this.collectPropagation(rootId, changedId),
      steps,
      tree: {} as FormulaTreeNode,
      last: changedId,
    };

    baseResult.tree = this.buildTree(rootId, [], 0, {
      evaluation: baseResult,
      overrides,
      liveRanges,
    });

    return baseResult;
  }

  private buildTree(
    name: string,
    path: string[],
    depth: number,
    options: BuildTreeOptions
  ): FormulaTreeNode {
    const entry = this.state.formulaIndex.get(name);
    const kind = getEntryKind(entry);
    const unit = getUnit(name, entry, this.state);
    const expression = entry ? getEntryExpression(entry) : "";
    const instanceId = [...path, name].join("/");
    const cycleIndex = path.indexOf(name);
    const nodeErrors = [
      ...(options.evaluation?.errors[name] ?? entry?.evaluationErrors ?? [])
    ].filter(msg => !isSuppressedInteractiveError(msg));
    const nodeWarnings = [
      ...(options.evaluation?.warnings[name] ?? entry?.evaluationWarnings ?? [])
    ].filter(msg => !isSuppressedInteractiveWarning(msg));
    const resultValue = options.evaluation?.values[name] ?? getDefaultValue(name, entry, this.state);
    const resultUnit = options.evaluation?.units[name] ?? unit;

    if (cycleIndex >= 0) {
      const cyclePath = [...path.slice(cycleIndex), name];
      addUnique(nodeErrors, `cyclic dependency detected: ${cyclePath.join(" -> ")}`);
      return {
        id: name,
        instanceId,
        name,
        expression,
        unit,
        depth,
        localInputs: [],
        children: [],
        rawYaml: entry ? getRawYamlBlock(entry, this.state) : undefined,
        sourceFile: entry?._filePath,
        line: entry?._line !== undefined ? entry._line + 1 : undefined,
        type: kind,
        result: {
          value: resultValue,
          unit: resultUnit,
          error: nodeErrors[0],
        },
        errors: nodeErrors,
        warnings: nodeWarnings,
        cycle: true,
        cyclePath,
      };
    }

    const localInputs: FormulaInputNode[] = [];
    const children: FormulaTreeNode[] = [];
    const dependencies = entry?.formula ? collectIdentifiersInOrder(entry.formula) : [];
    const nextPath = [...path, name];

    for (const dependency of dependencies) {
      let dependencyEntry = this.state.formulaIndex.get(dependency);
      
      // Se non lo trova con il prefisso completo, usa la virtualizzazione per pescare i dati di default
      if (!dependencyEntry && dependency.includes('.')) {
        const parts = dependency.split('.');
        const bareName = parts[parts.length - 1];
        if (!this.state.formulaIndex.has(bareName)) {
          dependencyEntry = this.state.formulaIndex.get(bareName);
        }
      }

      const dependencyKind = getEntryKind(dependencyEntry);
      const sourceFormulaId = dependencyEntry?.formula ? dependency : undefined;
      const currentValue = options.evaluation?.values[dependency];
      const defaultValue = getDefaultValue(dependency, dependencyEntry, this.state);
      
      const dependencyUnit =
        options.evaluation?.units[dependency] ??
        getUnit(dependency, dependencyEntry, this.state);
        
      const isOverridden = isFiniteNumber(options.overrides?.[dependency]);
      const isFormula = dependencyKind === "formula";
      const inputErrors = options.evaluation?.errors[dependency] ?? dependencyEntry?.evaluationErrors;
      const inputWarnings = options.evaluation?.warnings[dependency] ?? dependencyEntry?.evaluationWarnings;

      // Determina se l'origine è un simbolo cross-file virtualizzato
      const isCrossFile = dependency.includes('.');

      localInputs.push({
        name: dependency, // <--- Mantiene il nome con il prefisso (es: "sensori.temperatura")
        unit: dependencyUnit,
        defaultValue,
        currentValue: currentValue ?? defaultValue,
        hasDefault: isFiniteNumber(defaultValue),
        kind: isFormula
          ? "formula"
          : dependencyEntry
            ? "constant"
            : this.state.symbolValues.has(dependency) || isCrossFile
              ? "external"
              : "unknown",
        origin: isFormula
          ? "yaml-formula"
          : isCrossFile
            ? "cpp-symbol" // Trattato come input virtuale modificabile
            : dependencyEntry
              ? "yaml-constant"
              : "unknown",
        sourceFormulaId,
        expression: dependencyEntry?.formula,
        editable: !isFormula, // Se non è una formula annidata complessa, permette l'input numerico nella UI
        overridden: isOverridden,
        calculated: isFormula || currentValue !== undefined,
        errors: inputErrors,
        warnings: inputWarnings,
      });

      if (!isFormula) {
        continue;
      }

      if (depth >= MAX_INTERACTIVE_DEPTH) {
        children.push({
          id: dependency,
          instanceId: [...nextPath, dependency].join("/"),
          name: dependency,
          expression: dependencyEntry?.formula ?? "",
          unit: dependencyUnit,
          depth: depth + 1,
          localInputs: [],
          children: [],
          rawYaml: dependencyEntry ? getRawYamlBlock(dependencyEntry, this.state) : undefined,
          sourceFile: dependencyEntry?._filePath,
          line: dependencyEntry?._line !== undefined ? dependencyEntry._line + 1 : undefined,
          type: "formula",
          result: {
            value: currentValue,
            unit: dependencyUnit,
            error: inputErrors?.[0],
          },
          errors: inputErrors,
          warnings: inputWarnings,
          depthLimited: true,
        });
        continue;
      }

      children.push(this.buildTree(dependency, nextPath, depth + 1, options));
    }

    // Propagate tolerance range from entry to tree node
    // const toleranceResult = entry?.toleranceResult;
    // const entryRange = toleranceResult
    //   ? { min: toleranceResult.min, max: toleranceResult.max, source: toleranceResult.source as "declared" | "propagated" }
    //   : undefined;

    // const entryRange = liveRange(entry?.toleranceResult, resultValue);
    const entryRange =
      options.liveRanges?.get(name) ??
      liveRange(entry?.toleranceResult, resultValue);

    return {
      id: name,
      instanceId,
      name,
      expression,
      unit,
      depth,
      localInputs,
      children,
      rawYaml: entry ? getRawYamlBlock(entry, this.state) : undefined,
      sourceFile: entry?._filePath,
      line: entry?._line !== undefined ? entry._line + 1 : undefined,
      type: kind,
      result: {
        value: resultValue,
        unit: resultUnit,
        error: nodeErrors[0],
        range: entryRange,
      },
      range: entryRange,
      errors: nodeErrors,
      warnings: nodeWarnings,
    };
  }

  private collectPropagation(rootId: string, changedId: string | undefined): string[] {
    if (!changedId) {
      return [];
    }

    const affected = new Set<string>();
    const visits = new Set<string>();

    const visit = (name: string): boolean => {
      if (name === changedId) {
        affected.add(name);
        return true;
      }

      const visitKey = `${name}:${changedId}`;
      if (visits.has(visitKey)) {
        return false;
      }
      visits.add(visitKey);

      const entry = this.state.formulaIndex.get(name);
      if (!entry?.formula) {
        return false;
      }

      let childAffected = false;
      for (const dependency of collectIdentifiersInOrder(entry.formula)) {
        if (visit(dependency)) {
          childAffected = true;
        }
      }

      if (childAffected) {
        affected.add(name);
      }

      return childAffected;
    };

    visit(rootId);
    return Array.from(affected);
  }
}

export function buildInteractiveFormulaEntries(
  state: CalcDocsState,
  entries: CoreFormulaEntry[],
  engine = new InteractiveFormulaEngine(state)
): FormulaEntry[] {
  return entries.map((entry) => engine.createFormulaEntry(entry));
}
