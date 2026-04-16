// dimensionEvaluator.ts

import type { OutlineFormula } from './formulaParser';

// -------------------- DIM TYPE --------------------

export type Dim = {
  V: number;
  I: number;
  R: number;
  T: number;
  F: number;
  P: number;
  C: number;
  L: number;
  A: number;
};

export const ZERO_DIM: Dim = { V:0,I:0,R:0,T:0,F:0,P:0,C:0,L:0,A:0 };

function clone(d: Dim): Dim {
  return { ...d };
}

export function addDim(a: Dim, b: Dim): Dim {
  const out = clone(ZERO_DIM);
  for (const k in out) out[k as keyof Dim] = a[k as keyof Dim] + b[k as keyof Dim];
  return out;
}

export function subDim(a: Dim, b: Dim): Dim {
  const out = clone(ZERO_DIM);
  for (const k in out) out[k as keyof Dim] = a[k as keyof Dim] - b[k as keyof Dim];
  return out;
}

export function sameDim(a: Dim, b: Dim): boolean {
  return Object.keys(a).every(k => a[k as keyof Dim] === b[k as keyof Dim]);
}

// -------------------- UNIT → DIM --------------------

const BASE_UNIT_DIM = new Map<string, Dim>([
  ['v',   { ...ZERO_DIM, V:1 }],
  ['a',   { ...ZERO_DIM, I:1 }],
  ['ohm', { ...ZERO_DIM, R:1 }],
  ['s',   { ...ZERO_DIM, T:1 }],
  ['hz',  { ...ZERO_DIM, F:1 }],
  ['w',   { ...ZERO_DIM, P:1 }],
  ['f',   { ...ZERO_DIM, C:1 }],
  ['h',   { ...ZERO_DIM, L:1 }],
  ['rad', { ...ZERO_DIM, A:1 }],
  ['deg', { ...ZERO_DIM, A:1 }],
]);

function stripPrefix(u: string): string {
  return u.replace(/^(m|k|u|n|p|g)/, '');
}

export function getUnitDim(unit?: string): Dim | null {
  if (!unit) return null;
  const base = stripPrefix(unit.toLowerCase());
  return BASE_UNIT_DIM.get(base) ?? null;
}

// -------------------- C SYMBOL DIM PROPAGATION --------------------

export type CSymbolDimMap = Map<string, Dim>;

export function buildCSymbolDimTable(
  formulas: OutlineFormula[]
): CSymbolDimMap {

  const map = new Map<string, Dim>();

  for (const f of formulas) {
    const dim = getUnitDim(f.unit);
    if (dim) map.set(f.id, dim);
  }

  return map;
}

// -------------------- TOKENIZER --------------------

type Token =
  | { type: 'var'; v: string }
  | { type: 'op'; v: string }
  | { type: 'num' }
  | { type: 'func'; v: string }
  | { type: 'paren'; v: string };

function tokenize(expr: string): Token[] {
  const regex = /([A-Z_][A-Z0-9_]*)|(sqrt|sin|cos|tan|pow)|(\d+(\.\d+)?)|([+\-*/(),])/gi;
  const tokens: Token[] = [];

  let m;
  while ((m = regex.exec(expr)) !== null) {
    if (m[1]) tokens.push({ type: 'var', v: m[1] });
    else if (m[2]) tokens.push({ type: 'func', v: m[2] });
    else if (m[3]) tokens.push({ type: 'num' });
    else tokens.push({ type: 'op', v: m[5] });
  }

  return tokens;
}

// -------------------- FUNCTION RULES --------------------

function applyFunction(name: string, args: Dim[]): Dim {
  switch (name) {
    case 'sqrt':
      return Object.fromEntries(
        Object.entries(args[0]).map(([k, v]) => [k, v / 2])
      ) as Dim;

    case 'pow':
      // pow(x, n) → dimension x^n
      const power = args[1] ? 2 : 1; // fallback
      return Object.fromEntries(
        Object.entries(args[0]).map(([k, v]) => [k, v * power])
      ) as Dim;

    case 'sin':
    case 'cos':
    case 'tan':
      return ZERO_DIM;

    default:
      return ZERO_DIM;
  }
}

// -------------------- INFERENCE ENGINE --------------------

export function inferDimension(
  expr: string,
  formulas: OutlineFormula[]
): { dim: Dim | null; error?: string } {

  const tokens = tokenize(expr);
  const stack: Dim[] = [];
  const ops: string[] = [];

  const getVarDim = (name: string): Dim => {
    const f = formulas.find(f => f.id === name);
    return getUnitDim(f?.unit) ?? ZERO_DIM;
  };

  function applyOp() {
    const b = stack.pop();
    const a = stack.pop();
    const op = ops.pop();

    if (!a || !b || !op) return;

    if (op === '+' || op === '-') {
      if (!sameDim(a, b)) throw new Error('ADD_MISMATCH');
      stack.push(a);
    }

    if (op === '*') stack.push(addDim(a, b));
    if (op === '/') stack.push(subDim(a, b));
  }

  try {
    for (const t of tokens) {
      if (t.type === 'var') stack.push(getVarDim(t.v));
      else if (t.type === 'num') stack.push(ZERO_DIM);
      else if (t.type === 'op') {
        while (ops.length) applyOp();
        ops.push(t.v);
      }
      else if (t.type === 'func') {
        const arg = stack.pop();
        if (!arg) continue;
        stack.push(applyFunction(t.v, [arg]));
      }
    }

    while (ops.length) applyOp();

    return { dim: stack[0] ?? null };

  } catch (e: any) {
    return { dim: null, error: e.message };
  }
}

// -------------------- DEBUG --------------------

export function dimToString(d: Dim): string {
  return Object.entries(d)
    .filter(([_, v]) => v !== 0)
    .map(([k, v]) => `${k}^${v}`)
    .join(' ') || '1';
}