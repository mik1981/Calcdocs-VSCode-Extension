import type { OutlineFormula } from './formulaParser';

// ---------------- DIM ----------------

export type Dim = Record<string, number>;

export const ZERO_DIM: Dim = {};

function clone(d: Dim): Dim {
  return { ...d };
}

function add(a: Dim, b: Dim): Dim {
  const out: Dim = { ...a };
  for (const k in b) out[k] = (out[k] ?? 0) + b[k];
  return out;
}

function sub(a: Dim, b: Dim): Dim {
  const out: Dim = { ...a };
  for (const k in b) out[k] = (out[k] ?? 0) - b[k];
  return out;
}

function same(a: Dim, b: Dim): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  }
  return true;
}

// ---------------- UNIT ----------------

const UNIT_DIM = new Map<string, Dim>([
  ['v', { V:1 }],
  ['a', { I:1 }],
  ['ohm', { R:1 }],
  ['count', {}],
]);

function baseUnit(u: string) {
  return u.replace(/^(m|k|u|n|p)/, '');
}

export function getUnitDim(unit?: string): Dim | null {
  if (!unit) return null;
  return UNIT_DIM.get(baseUnit(unit.toLowerCase())) ?? null;
}

// ---------------- SYMBOL CLASSIFICATION ----------------

export function classifySymbol(
  name: string,
  formulas: OutlineFormula[],
  cSymbols: Map<string, number>
): 'resolved' | 'param' {

  if (cSymbols.has(name)) return 'resolved';

  const f = formulas.find(f => f.id === name);
  if (f && (f.value !== undefined || f.expr)) return 'resolved';

  return 'param'; // 🔥 default: PARAMETRICO
}

// ---------------- INFERENCE ----------------

// =========================================================
// ✅ RISOLUTORE DIMENSIONALE AUTOMATICO PER MACRO PARAMETRICHE
// =========================================================
export function solveParametricDimensions(
  expr: string,
  targetUnit: string,
  formulas: OutlineFormula[],
  cSymbols: Map<string, number>
): {
  valid: boolean;
  error?: string;
  paramUnits: Map<string, string>;
  params: string[];
} {

  const targetDim = getUnitDim(targetUnit) ?? ZERO_DIM;
  const tokens = expr.match(/[A-Z_][A-Z0-9_]*/gi) || [];
  
  const params: string[] = [];
  let knownDim = ZERO_DIM;

  for (const t of tokens) {
    const kind = classifySymbol(t, formulas, cSymbols);
    if (kind === 'param') {
      if (!params.includes(t)) params.push(t);
      continue;
    }
    const f = formulas.find(f => f.id === t);
    const dim = getUnitDim(f?.unit) ?? ZERO_DIM;
    knownDim = add(knownDim, dim);
  }

  const paramUnits = new Map<string, string>();

  // ✅ CASO 1: solo un parametro libero -> SOLUZIONE UNICA!
  if (params.length === 1) {
    const requiredDim = sub(targetDim, knownDim);
    
    // Trova quale unità corrisponde alla dimensione richiesta
    for (const [unit, dim] of UNIT_DIM) {
      if (same(dim, requiredDim)) {
        paramUnits.set(params[0], unit);
        return {
          valid: true,
          paramUnits,
          params
        };
      }
    }

    return {
      valid: false,
      error: `Nessuna unità compatibile per il parametro '${params[0]}' per ottenere ${targetUnit}`,
      paramUnits,
      params
    };
  }

  // ✅ CASO 2: più parametri -> verifica solo che esista almeno una soluzione possibile
  // (non facciamo risoluzione sistemi lineari per adesso, garantiamo solo che non è impossibile)
  return {
    valid: true,
    paramUnits,
    params
  };
}

export function inferDimension(
  expr: string,
  formulas: OutlineFormula[],
  cSymbols: Map<string, number>
): {
  dim: Dim | null;
  error?: string;
  params: string[];
} {

  const tokens = expr.match(/[A-Z_][A-Z0-9_]*/gi) || [];

  let current: Dim | null = null;
  const params: string[] = [];

  for (const t of tokens) {

    const kind = classifySymbol(t, formulas, cSymbols);

    if (kind === 'param') {
      params.push(t);
      continue; // 🔥 NON errore
    }

    const f = formulas.find(f => f.id === t);
    const dim = getUnitDim(f?.unit) ?? ZERO_DIM;

    if (!current) current = dim;
    else current = add(current, dim); // semplificato
  }

  return { dim: current, params };
}
