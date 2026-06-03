const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export type MathScopeValue = number | ((...args: number[]) => number);

function toInteger(value: number): number {
  return value < 0 ? Math.ceil(value) : Math.floor(value);
}

function modulo(value: number, divisor: number): number {
  return value - divisor * Math.floor(value / divisor);
}

export const ENGINEERING_MATH_SCOPE: Record<string, MathScopeValue> = {
  abs: Math.abs,
  ass: Math.abs,
  fabs: Math.abs,
  int: toInteger,
  integer: toInteger,
  mod: modulo,
  modulo,
  remainder: (value: number, divisor: number) => value % divisor,

  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atan2: Math.atan2,
  atanh: Math.atanh,
  cbrt: Math.cbrt,
  ceil: Math.ceil,
  ceiling: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  exp: Math.exp,
  expm1: Math.expm1,
  floor: Math.floor,
  hypot: Math.hypot,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  power: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
  trunc: Math.trunc,

  pi: Math.PI,
  PI: Math.PI,
  tau: Math.PI * 2,
  e: Math.E,
  E: Math.E,

  deg2rad: (value: number) => value * DEG_TO_RAD,
  rad2deg: (value: number) => value * RAD_TO_DEG,
  radians: (value: number) => value * DEG_TO_RAD,
  degrees: (value: number) => value * RAD_TO_DEG,
  sind: (value: number) => Math.sin(value * DEG_TO_RAD),
  cosd: (value: number) => Math.cos(value * DEG_TO_RAD),
  tand: (value: number) => Math.tan(value * DEG_TO_RAD),
  asind: (value: number) => Math.asin(value) * RAD_TO_DEG,
  acosd: (value: number) => Math.acos(value) * RAD_TO_DEG,
  atand: (value: number) => Math.atan(value) * RAD_TO_DEG,
};

for (const [name, value] of Object.entries({ ...ENGINEERING_MATH_SCOPE })) {
  if (/^[a-z][a-z0-9_]*$/.test(name)) {
    ENGINEERING_MATH_SCOPE[name.toUpperCase()] = value;
  }
}

export const LOOKUP_FUNCTION_NAMES = new Set(["csv", "lookup", "table"]);

export const ENGINEERING_MATH_NAMES = new Set(
  Object.keys(ENGINEERING_MATH_SCOPE).map((name) => name.toLowerCase())
);

export const RESERVED_EXPRESSION_NAMES = new Set([
  ...ENGINEERING_MATH_NAMES,
  ...LOOKUP_FUNCTION_NAMES,
  "true",
  "false",
  "null",
  "undefined",
  "infinity",
  "nan",
]);

export function isEngineeringMathName(name: string): boolean {
  return ENGINEERING_MATH_NAMES.has(name.trim().toLowerCase());
}

export function isLookupFunctionName(name: string): boolean {
  return LOOKUP_FUNCTION_NAMES.has(name.trim().toLowerCase());
}
