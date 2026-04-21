export type DimensionVector = {
  M: number;
  L: number;
  T: number;
  I: number;
  K: number;
};

export type UnitSpec = {
  token: string;
  canonical: string;
  factorToSi: number;
  dimension: DimensionVector;
};

export type Quantity = {
  valueSi: number;
  dimension: DimensionVector;
  preferredUnit?: string;
  displayUnit?: string;
};

export type UnitResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const EPSILON = 1e-12;
const DIMENSIONLESS: DimensionVector = { M: 0, L: 0, T: 0, I: 0, K: 0 };

function cloneDimension(source: DimensionVector): DimensionVector {
  return {
    M: source.M,
    L: source.L,
    T: source.T,
    I: source.I,
    K: source.K,
  };
}

export function addDimensions(
  left: DimensionVector,
  right: DimensionVector
): DimensionVector {
  return {
    M: left.M + right.M,
    L: left.L + right.L,
    T: left.T + right.T,
    I: left.I + right.I,
    K: left.K + right.K,
  };
}

export function subtractDimensions(
  left: DimensionVector,
  right: DimensionVector
): DimensionVector {
  return {
    M: left.M - right.M,
    L: left.L - right.L,
    T: left.T - right.T,
    I: left.I - right.I,
    K: left.K - right.K,
  };
}

export function dimensionsEqual(
  left: DimensionVector,
  right: DimensionVector
): boolean {
  return (
    Math.abs(left.M - right.M) < EPSILON &&
    Math.abs(left.L - right.L) < EPSILON &&
    Math.abs(left.T - right.T) < EPSILON &&
    Math.abs(left.I - right.I) < EPSILON &&
    Math.abs(left.K - right.K) < EPSILON
  );
}

export function isDimensionless(dimension: DimensionVector): boolean {
  return dimensionsEqual(dimension, DIMENSIONLESS);
}

function formatExponent(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(6).replace(/\.?0+$/, "");
}

export function formatDimension(dimension: DimensionVector): string {
  if (isDimensionless(dimension)) {
    return "1";
  }

  const parts: string[] = [];
  if (Math.abs(dimension.M) > EPSILON) {
    parts.push(`M^${formatExponent(dimension.M)}`);
  }
  if (Math.abs(dimension.L) > EPSILON) {
    parts.push(`L^${formatExponent(dimension.L)}`);
  }
  if (Math.abs(dimension.T) > EPSILON) {
    parts.push(`T^${formatExponent(dimension.T)}`);
  }
  if (Math.abs(dimension.I) > EPSILON) {
    parts.push(`I^${formatExponent(dimension.I)}`);
  }
  if (Math.abs(dimension.K) > EPSILON) {
    parts.push(`K^${formatExponent(dimension.K)}`);
  }

  return parts.join(" * ");
}

function dim(M: number, L: number, T: number, I: number, K: number = 0): DimensionVector {
  return { M, L, T, I, K };
}

export const UNIT_SPEC_LIST: UnitSpec[] = [
  // Dimensionless / ratios / angles
  { token: "count", canonical: "count", factorToSi: 1, dimension: dim(0, 0, 0, 0) },
  { token: "ratio", canonical: "ratio", factorToSi: 1, dimension: dim(0, 0, 0, 0) },
  { token: "%", canonical: "%", factorToSi: 0.01, dimension: dim(0, 0, 0, 0) },
  { token: "ppm", canonical: "ppm", factorToSi: 1e-6, dimension: dim(0, 0, 0, 0) },
  { token: "ppb", canonical: "ppb", factorToSi: 1e-9, dimension: dim(0, 0, 0, 0) },
  { token: "ppt", canonical: "ppt", factorToSi: 1e-12, dimension: dim(0, 0, 0, 0) },
  { token: "rad", canonical: "rad", factorToSi: 1, dimension: dim(0, 0, 0, 0) },
  { token: "deg", canonical: "deg", factorToSi: Math.PI / 180, dimension: dim(0, 0, 0, 0) },

  // Time
  { token: "s", canonical: "s", factorToSi: 1, dimension: dim(0, 0, 1, 0) },
  { token: "ms", canonical: "ms", factorToSi: 1e-3, dimension: dim(0, 0, 1, 0) },
  { token: "us", canonical: "us", factorToSi: 1e-6, dimension: dim(0, 0, 1, 0) },
  { token: "ns", canonical: "ns", factorToSi: 1e-9, dimension: dim(0, 0, 1, 0) },
  { token: "min", canonical: "min", factorToSi: 60, dimension: dim(0, 0, 1, 0) },
  { token: "h", canonical: "h", factorToSi: 3600, dimension: dim(0, 0, 1, 0) },
  { token: "day", canonical: "day", factorToSi: 86400, dimension: dim(0, 0, 1, 0) },

  // Length
  { token: "m", canonical: "m", factorToSi: 1, dimension: dim(0, 1, 0, 0) },
  { token: "dm", canonical: "dm", factorToSi: 0.1, dimension: dim(0, 1, 0, 0) },
  { token: "cm", canonical: "cm", factorToSi: 0.01, dimension: dim(0, 1, 0, 0) },
  { token: "mm", canonical: "mm", factorToSi: 1e-3, dimension: dim(0, 1, 0, 0) },
  { token: "um", canonical: "um", factorToSi: 1e-6, dimension: dim(0, 1, 0, 0) },
  { token: "nm", canonical: "nm", factorToSi: 1e-9, dimension: dim(0, 1, 0, 0) },
  { token: "pm", canonical: "pm", factorToSi: 1e-12, dimension: dim(0, 1, 0, 0) },
  { token: "km", canonical: "km", factorToSi: 1e3, dimension: dim(0, 1, 0, 0) },
  { token: "in", canonical: "in", factorToSi: 0.0254, dimension: dim(0, 1, 0, 0) },
  { token: "uin", canonical: "uin", factorToSi: 0.0254e-6, dimension: dim(0, 1, 0, 0) },
  { token: "mil", canonical: "mil", factorToSi: 0.0254e-3, dimension: dim(0, 1, 0, 0) },
  { token: "thou", canonical: "thou", factorToSi: 0.0254e-3, dimension: dim(0, 1, 0, 0) },
  { token: "ft", canonical: "ft", factorToSi: 0.3048, dimension: dim(0, 1, 0, 0) },
  { token: "yd", canonical: "yd", factorToSi: 0.9144, dimension: dim(0, 1, 0, 0) },
  { token: "mi", canonical: "mi", factorToSi: 1609.344, dimension: dim(0, 1, 0, 0) },
  { token: "nmi", canonical: "nmi", factorToSi: 1852, dimension: dim(0, 1, 0, 0) },

  // Area
  { token: "m2", canonical: "m2", factorToSi: 1, dimension: dim(0, 2, 0, 0) },
  { token: "cm2", canonical: "cm2", factorToSi: 1e-4, dimension: dim(0, 2, 0, 0) },
  { token: "mm2", canonical: "mm2", factorToSi: 1e-6, dimension: dim(0, 2, 0, 0) },
  { token: "in2", canonical: "in2", factorToSi: 0.0254 ** 2, dimension: dim(0, 2, 0, 0) },
  { token: "ft2", canonical: "ft2", factorToSi: 0.3048 ** 2, dimension: dim(0, 2, 0, 0) },
  { token: "yd2", canonical: "yd2", factorToSi: 0.9144 ** 2, dimension: dim(0, 2, 0, 0) },
  { token: "ac", canonical: "ac", factorToSi: 4046.8564224, dimension: dim(0, 2, 0, 0) },
  { token: "ha", canonical: "ha", factorToSi: 10000, dimension: dim(0, 2, 0, 0) },

  // Volume
  { token: "m3", canonical: "m3", factorToSi: 1, dimension: dim(0, 3, 0, 0) },
  { token: "l", canonical: "L", factorToSi: 1e-3, dimension: dim(0, 3, 0, 0) },
  { token: "ml", canonical: "mL", factorToSi: 1e-6, dimension: dim(0, 3, 0, 0) },
  { token: "ul", canonical: "uL", factorToSi: 1e-9, dimension: dim(0, 3, 0, 0) },
  { token: "cm3", canonical: "cm3", factorToSi: 1e-6, dimension: dim(0, 3, 0, 0) },
  { token: "in3", canonical: "in3", factorToSi: 0.0254 ** 3, dimension: dim(0, 3, 0, 0) },
  { token: "ft3", canonical: "ft3", factorToSi: 0.3048 ** 3, dimension: dim(0, 3, 0, 0) },
  { token: "gal", canonical: "gal", factorToSi: 0.003785411784, dimension: dim(0, 3, 0, 0) },
  { token: "qt", canonical: "qt", factorToSi: 0.000946352946, dimension: dim(0, 3, 0, 0) },
  { token: "pt", canonical: "pt", factorToSi: 0.000473176473, dimension: dim(0, 3, 0, 0) },
  { token: "cup", canonical: "cup", factorToSi: 0.0002365882365, dimension: dim(0, 3, 0, 0) },
  { token: "floz", canonical: "fl oz", factorToSi: 2.95735295625e-5, dimension: dim(0, 3, 0, 0) },
  { token: "bbl", canonical: "bbl", factorToSi: 0.158987, dimension: dim(0, 3, 0, 0) },

  // Speed / acceleration / angular
  { token: "mps", canonical: "m/s", factorToSi: 1, dimension: dim(0, 1, -1, 0) },
  { token: "kmh", canonical: "km/h", factorToSi: 1000 / 3600, dimension: dim(0, 1, -1, 0) },
  { token: "mph", canonical: "mph", factorToSi: 1609.344 / 3600, dimension: dim(0, 1, -1, 0) },
  { token: "fps", canonical: "ft/s", factorToSi: 0.3048, dimension: dim(0, 1, -1, 0) },
  { token: "ips", canonical: "in/s", factorToSi: 0.0254, dimension: dim(0, 1, -1, 0) },
  { token: "knot", canonical: "knot", factorToSi: 1852 / 3600, dimension: dim(0, 1, -1, 0) },
  { token: "mps2", canonical: "m/s2", factorToSi: 1, dimension: dim(0, 1, -2, 0) },
  { token: "g0", canonical: "g", factorToSi: 9.80665, dimension: dim(0, 1, -2, 0) },
  { token: "rpm", canonical: "rpm", factorToSi: 1 / 60, dimension: dim(0, 0, -1, 0) },

  // Mass
  { token: "kg", canonical: "kg", factorToSi: 1, dimension: dim(1, 0, 0, 0) },
  { token: "g", canonical: "g", factorToSi: 1e-3, dimension: dim(1, 0, 0, 0) },
  { token: "mg", canonical: "mg", factorToSi: 1e-6, dimension: dim(1, 0, 0, 0) },
  { token: "ug", canonical: "ug", factorToSi: 1e-9, dimension: dim(1, 0, 0, 0) },
  { token: "tonne", canonical: "tonne", factorToSi: 1000, dimension: dim(1, 0, 0, 0) },
  { token: "lb", canonical: "lb", factorToSi: 0.45359237, dimension: dim(1, 0, 0, 0) },
  { token: "oz", canonical: "oz", factorToSi: 0.028349523125, dimension: dim(1, 0, 0, 0) },
  { token: "st", canonical: "st", factorToSi: 6.35029318, dimension: dim(1, 0, 0, 0) },
  { token: "slug", canonical: "slug", factorToSi: 14.5939029, dimension: dim(1, 0, 0, 0) },
  { token: "gr", canonical: "gr", factorToSi: 64.79891e-6, dimension: dim(1, 0, 0, 0) },
  { token: "tonus", canonical: "ton(US)", factorToSi: 907.18474, dimension: dim(1, 0, 0, 0) },
  { token: "tonuk", canonical: "ton(UK)", factorToSi: 1016.0469088, dimension: dim(1, 0, 0, 0) },

  // Force / pressure / torque
  { token: "n", canonical: "N", factorToSi: 1, dimension: dim(1, 1, -2, 0) },
  { token: "kn", canonical: "kN", factorToSi: 1e3, dimension: dim(1, 1, -2, 0) },
  { token: "lbf", canonical: "lbf", factorToSi: 4.4482216152605, dimension: dim(1, 1, -2, 0) },
  { token: "ozf", canonical: "ozf", factorToSi: 0.27801385, dimension: dim(1, 1, -2, 0) },
  { token: "pa", canonical: "Pa", factorToSi: 1, dimension: dim(1, -1, -2, 0) },
  { token: "hpa", canonical: "hPa", factorToSi: 100, dimension: dim(1, -1, -2, 0) },
  { token: "kpa", canonical: "kPa", factorToSi: 1e3, dimension: dim(1, -1, -2, 0) },
  { token: "mpa", canonical: "MPa", factorToSi: 1e6, dimension: dim(1, -1, -2, 0) },
  { token: "bar", canonical: "bar", factorToSi: 1e5, dimension: dim(1, -1, -2, 0) },
  { token: "mbar", canonical: "mbar", factorToSi: 100, dimension: dim(1, -1, -2, 0) },
  { token: "atm", canonical: "atm", factorToSi: 101325, dimension: dim(1, -1, -2, 0) },
  { token: "torr", canonical: "torr", factorToSi: 133.322368421, dimension: dim(1, -1, -2, 0) },
  { token: "mmhg", canonical: "mmHg", factorToSi: 133.322, dimension: dim(1, -1, -2, 0) },
  { token: "inhg", canonical: "inHg", factorToSi: 3386.389, dimension: dim(1, -1, -2, 0) },
  { token: "psi", canonical: "psi", factorToSi: 6894.757293168, dimension: dim(1, -1, -2, 0) },
  { token: "ksi", canonical: "ksi", factorToSi: 6_894_757.293168, dimension: dim(1, -1, -2, 0) },
  { token: "nmt", canonical: "N*m", factorToSi: 1, dimension: dim(1, 2, -2, 0) },
  { token: "lbfft", canonical: "lbf*ft", factorToSi: 1.3558179483314004, dimension: dim(1, 2, -2, 0) },
  { token: "lbfin", canonical: "lbf*in", factorToSi: 0.112984829, dimension: dim(1, 2, -2, 0) },
  { token: "ozfin", canonical: "ozf*in", factorToSi: 0.0070615518, dimension: dim(1, 2, -2, 0) },

  // Energy / power
  { token: "j", canonical: "J", factorToSi: 1, dimension: dim(1, 2, -2, 0) },
  { token: "kj", canonical: "kJ", factorToSi: 1e3, dimension: dim(1, 2, -2, 0) },
  { token: "mj", canonical: "MJ", factorToSi: 1e6, dimension: dim(1, 2, -2, 0) },
  { token: "ev", canonical: "eV", factorToSi: 1.602176634e-19, dimension: dim(1, 2, -2, 0) },
  { token: "cal", canonical: "cal", factorToSi: 4.184, dimension: dim(1, 2, -2, 0) },
  { token: "kcal", canonical: "kcal", factorToSi: 4184, dimension: dim(1, 2, -2, 0) },
  { token: "btu", canonical: "BTU", factorToSi: 1055.05585262, dimension: dim(1, 2, -2, 0) },
  { token: "wh", canonical: "Wh", factorToSi: 3600, dimension: dim(1, 2, -2, 0) },
  { token: "kwh", canonical: "kWh", factorToSi: 3_600_000, dimension: dim(1, 2, -2, 0) },
  { token: "w", canonical: "W", factorToSi: 1, dimension: dim(1, 2, -3, 0) },
  { token: "mw", canonical: "mW", factorToSi: 1e-3, dimension: dim(1, 2, -3, 0) },
  { token: "kw", canonical: "kW", factorToSi: 1e3, dimension: dim(1, 2, -3, 0) },
  { token: "mwatt", canonical: "MW", factorToSi: 1e6, dimension: dim(1, 2, -3, 0) },
  { token: "hp", canonical: "hp", factorToSi: 745.6998715822702, dimension: dim(1, 2, -3, 0) },
  { token: "btuh", canonical: "BTU/h", factorToSi: 1055.05585262 / 3600, dimension: dim(1, 2, -3, 0) },

  // Frequency
  { token: "hz", canonical: "Hz", factorToSi: 1, dimension: dim(0, 0, -1, 0) },
  { token: "khz", canonical: "kHz", factorToSi: 1e3, dimension: dim(0, 0, -1, 0) },
  { token: "mhz", canonical: "MHz", factorToSi: 1e6, dimension: dim(0, 0, -1, 0) },
  { token: "ghz", canonical: "GHz", factorToSi: 1e9, dimension: dim(0, 0, -1, 0) },

  // Flow rates
  { token: "lpm", canonical: "L/min", factorToSi: 1e-3 / 60, dimension: dim(0, 3, -1, 0) },
  { token: "gpm", canonical: "gal/min", factorToSi: 0.003785411784 / 60, dimension: dim(0, 3, -1, 0) },
  { token: "m3s", canonical: "m3/s", factorToSi: 1, dimension: dim(0, 3, -1, 0) },
  { token: "cfm", canonical: "ft3/min", factorToSi: (0.3048 ** 3) / 60, dimension: dim(0, 3, -1, 0) },

  // Electrical quantities
  { token: "a", canonical: "A", factorToSi: 1, dimension: dim(0, 0, 0, 1) },
  { token: "ma", canonical: "mA", factorToSi: 1e-3, dimension: dim(0, 0, 0, 1) },
  { token: "ua", canonical: "uA", factorToSi: 1e-6, dimension: dim(0, 0, 0, 1) },
  { token: "c", canonical: "C", factorToSi: 1, dimension: dim(0, 0, 1, 1) },
  { token: "ah", canonical: "Ah", factorToSi: 3600, dimension: dim(0, 0, 1, 1) },
  { token: "mah", canonical: "mAh", factorToSi: 3.6, dimension: dim(0, 0, 1, 1) },
  { token: "v", canonical: "V", factorToSi: 1, dimension: dim(1, 2, -3, -1) },
  { token: "mv", canonical: "mV", factorToSi: 1e-3, dimension: dim(1, 2, -3, -1) },
  { token: "kv", canonical: "kV", factorToSi: 1e3, dimension: dim(1, 2, -3, -1) },
  { token: "ohm", canonical: "ohm", factorToSi: 1, dimension: dim(1, 2, -3, -2) },
  { token: "kohm", canonical: "kohm", factorToSi: 1e3, dimension: dim(1, 2, -3, -2) },
  { token: "mohm", canonical: "Mohm", factorToSi: 1e6, dimension: dim(1, 2, -3, -2) },
  { token: "siemens", canonical: "S", factorToSi: 1, dimension: dim(-1, -2, 3, 2) },
  { token: "msiemens", canonical: "mS", factorToSi: 1e-3, dimension: dim(-1, -2, 3, 2) },
  { token: "usiemens", canonical: "uS", factorToSi: 1e-6, dimension: dim(-1, -2, 3, 2) },
  { token: "f", canonical: "F", factorToSi: 1, dimension: dim(-1, -2, 4, 2) },
  { token: "mf", canonical: "mF", factorToSi: 1e-3, dimension: dim(-1, -2, 4, 2) },
  { token: "uf", canonical: "uF", factorToSi: 1e-6, dimension: dim(-1, -2, 4, 2) },
  { token: "nf", canonical: "nF", factorToSi: 1e-9, dimension: dim(-1, -2, 4, 2) },
  { token: "pf", canonical: "pF", factorToSi: 1e-12, dimension: dim(-1, -2, 4, 2) },
  { token: "hry", canonical: "H", factorToSi: 1, dimension: dim(1, 2, -2, -2) },
  { token: "mhry", canonical: "mH", factorToSi: 1e-3, dimension: dim(1, 2, -2, -2) },
  { token: "uhry", canonical: "uH", factorToSi: 1e-6, dimension: dim(1, 2, -2, -2) },
  { token: "nhry", canonical: "nH", factorToSi: 1e-9, dimension: dim(1, 2, -2, -2) },
  { token: "wb", canonical: "Wb", factorToSi: 1, dimension: dim(1, 2, -2, -1) },
  { token: "t", canonical: "T", factorToSi: 1, dimension: dim(1, 0, -2, -1) },
  { token: "mt", canonical: "mT", factorToSi: 1e-3, dimension: dim(1, 0, -2, -1) },
  { token: "gauss", canonical: "G", factorToSi: 1e-4, dimension: dim(1, 0, -2, -1) },

  // Density / viscosity
  { token: "kgm3", canonical: "kg/m3", factorToSi: 1, dimension: dim(1, -3, 0, 0) },
  { token: "gcm3", canonical: "g/cm3", factorToSi: 1000, dimension: dim(1, -3, 0, 0) },
  { token: "lbft3", canonical: "lb/ft3", factorToSi: 16.01846337396014, dimension: dim(1, -3, 0, 0) },
  { token: "pas", canonical: "Pa*s", factorToSi: 1, dimension: dim(1, -1, -1, 0) },
  { token: "cp", canonical: "cP", factorToSi: 1e-3, dimension: dim(1, -1, -1, 0) },

  // Temperature (using K dimension for deltas/absolute values)
  { token: "k", canonical: "K", factorToSi: 1, dimension: dim(0, 0, 0, 0, 1) },
  { token: "degc", canonical: "degC", factorToSi: 1, dimension: dim(0, 0, 0, 0, 1) },
  { token: "degf", canonical: "degF", factorToSi: 5 / 9, dimension: dim(0, 0, 0, 0, 1) },
  { token: "rankine", canonical: "R", factorToSi: 5 / 9, dimension: dim(0, 0, 0, 0, 1) },
];

export const UNIT_SPECS = new Map<string, UnitSpec>(
  UNIT_SPEC_LIST.map((spec) => [spec.token, spec])
);

export const SCALABLE_UNIT_FAMILY = new Map<string, string>([
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
  ["pm", "length"],
  ["uin", "length"],
  ["mil", "length"],
  ["thou", "length"],
  // Area / volume
  ["m2", "area"],
  ["cm2", "area"],
  ["mm2", "area"],
  ["ac", "area"],
  ["ha", "area"],
  ["m3", "volume"],
  ["l", "volume"],
  ["ml", "volume"],
  ["ul", "volume"],
  ["gal", "volume"],
  ["qt", "volume"],
  ["pt", "volume"],
  ["cup", "volume"],
  ["floz", "volume"],
  ["bbl", "volume"],
  // Mass
  ["kg", "mass"],
  ["g", "mass"],
  ["mg", "mass"],
  ["ug", "mass"],
  ["tonne", "mass"],
  ["lb", "mass"],
  ["oz", "mass"],
  ["st", "mass"],
  ["slug", "mass"],
  ["gr", "mass"],
  // Pressure / force
  ["pa", "pressure"],
  ["hpa", "pressure"],
  ["kpa", "pressure"],
  ["mpa", "pressure"],
  ["bar", "pressure"],
  ["mbar", "pressure"],
  ["atm", "pressure"],
  ["torr", "pressure"],
  ["psi", "pressure"],
  ["ksi", "pressure"],
  ["mmhg", "pressure"],
  ["inhg", "pressure"],
  ["n", "force"],
  ["kn", "force"],
  ["lbf", "force"],
  ["ozf", "force"],
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
  // Temperature
  ["k", "temperature"],
  ["degc", "temperature"],
  ["degf", "temperature"],
  ["rankine", "temperature"],
]);

export const UNIT_ALIASES = new Map<string, string>([
  // Dimensionless and ratios
  ["count", "count"],
  ["counts", "count"],
  ["ratio", "ratio"],
  ["percent", "%"],
  ["percentage", "%"],
  ["ppm", "ppm"],
  ["ppb", "ppb"],
  ["ppt", "ppt"],
  ["deg", "deg"],
  ["degree", "deg"],
  ["degrees", "deg"],
  ["rad", "rad"],
  ["radian", "rad"],
  ["radians", "rad"],

  // Time
  ["s", "s"],
  ["sec", "s"],
  ["secs", "s"],
  ["second", "s"],
  ["seconds", "s"],
  ["ms", "ms"],
  ["us", "us"],
  ["ns", "ns"],
  ["min", "min"],
  ["mins", "min"],
  ["minute", "min"],
  ["minutes", "min"],
  ["h", "h"],
  ["hr", "h"],
  ["hrs", "h"],
  ["hour", "h"],
  ["hours", "h"],
  ["day", "day"],
  ["days", "day"],

  // Length
  ["m", "m"],
  ["meter", "m"],
  ["meters", "m"],
  ["metre", "m"],
  ["metres", "m"],
  ["dm", "dm"],
  ["cm", "cm"],
  ["mm", "mm"],
  ["um", "um"],
  ["micron", "um"],
  ["microns", "um"],
  ["nm", "nm"],
  ["nanometer", "nm"],
  ["pm", "pm"],
  ["picometer", "pm"],
  ["km", "km"],
  ["in", "in"],
  ["inch", "in"],
  ["inches", "in"],
  ["uin", "uin"],
  ["microinch", "uin"],
  ["microinches", "uin"],
  ["mil", "mil"],
  ["mils", "mil"],
  ["thou", "thou"],
  ["ft", "ft"],
  ["foot", "ft"],
  ["feet", "ft"],
  ["yd", "yd"],
  ["yard", "yd"],
  ["yards", "yd"],
  ["mi", "mi"],
  ["mile", "mi"],
  ["miles", "mi"],
  ["nmi", "nmi"],
  ["nauticalmile", "nmi"],
  ["nauticalmiles", "nmi"],

  // Area / volume
  ["m2", "m2"],
  ["m^2", "m2"],
  ["cm2", "cm2"],
  ["cm^2", "cm2"],
  ["mm2", "mm2"],
  ["mm^2", "mm2"],
  ["in2", "in2"],
  ["in^2", "in2"],
  ["ft2", "ft2"],
  ["ft^2", "ft2"],
  ["yd2", "yd2"],
  ["yd^2", "yd2"],
  ["ac", "ac"],
  ["acre", "ac"],
  ["acres", "ac"],
  ["ha", "ha"],
  ["hectare", "ha"],
  ["hectares", "ha"],
  ["m3", "m3"],
  ["m^3", "m3"],
  ["cm3", "cm3"],
  ["cm^3", "cm3"],
  ["in3", "in3"],
  ["in^3", "in3"],
  ["ft3", "ft3"],
  ["ft^3", "ft3"],
  ["l", "l"],
  ["liter", "l"],
  ["liters", "l"],
  ["litre", "l"],
  ["litres", "l"],
  ["ml", "ml"],
  ["milliliter", "ml"],
  ["milliliters", "ml"],
  ["millilitre", "ml"],
  ["millilitres", "ml"],
  ["ul", "ul"],
  ["microliter", "ul"],
  ["microliters", "ul"],
  ["microlitre", "ul"],
  ["microlitres", "ul"],
  ["gal", "gal"],
  ["gallon", "gal"],
  ["gallons", "gal"],
  ["qt", "qt"],
  ["quart", "qt"],
  ["quarts", "qt"],
  ["pt", "pt"],
  ["pint", "pt"],
  ["pints", "pt"],
  ["cup", "cup"],
  ["cups", "cup"],
  ["floz", "floz"],
  ["fl_oz", "floz"],
  ["fl-oz", "floz"],
  ["fluidounce", "floz"],
  ["fluidounces", "floz"],
  ["bbl", "bbl"],
  ["barrel", "bbl"],
  ["barrels", "bbl"],

  // Speed / acceleration / frequency
  ["mps", "mps"],
  ["m/s", "mps"],
  ["kmh", "kmh"],
  ["km/h", "kmh"],
  ["kph", "kmh"],
  ["mph", "mph"],
  ["mi/h", "mph"],
  ["fps", "fps"],
  ["ft/s", "fps"],
  ["ips", "ips"],
  ["in/s", "ips"],
  ["knot", "knot"],
  ["knots", "knot"],
  ["volt", "v"],
  ["volts", "v"],
  ["amp", "a"],
  ["amps", "a"],
  ["ampere", "a"],
  ["amperes", "a"],
  ["ohm", "ohm"],
  ["ohms", "ohm"],
  ["henry", "hry"],
  ["mhenry", "mhry"],
  ["uhenry", "uhry"],
  ["nhenry", "nhry"],
  ["mh", "mhry"],
  ["uh", "uhry"],
  ["nh", "nhry"],
  ["farad", "f"],
  ["farads", "f"],
  ["watt", "w"],
  ["watts", "w"],
  ["mps2", "mps2"],
  ["m/s2", "mps2"],
  ["m/s^2", "mps2"],
  ["g0", "g0"],
  ["rpm", "rpm"],
  ["hz", "hz"],
  ["khz", "khz"],
  ["mhz", "mhz"],
  ["ghz", "ghz"],

  // Mass
  ["kg", "kg"],
  ["kilogram", "kg"],
  ["kilograms", "kg"],
  ["g", "g"],
  ["gram", "g"],
  ["grams", "g"],
  ["mg", "mg"],
  ["ug", "ug"],
  ["tonne", "tonne"],
  ["metric-ton", "tonne"],
  ["mt", "tonne"],
  ["lb", "lb"],
  ["lbs", "lb"],
  ["pound", "lb"],
  ["pounds", "lb"],
  ["oz", "oz"],
  ["ounce", "oz"],
  ["ounces", "oz"],
  ["st", "st"],
  ["stone", "st"],
  ["stones", "st"],
  ["slug", "slug"],
  ["slugs", "slug"],
  ["gr", "gr"],
  ["grain", "gr"],
  ["grains", "gr"],
  ["tonus", "tonus"],
  ["ton_us", "tonus"],
  ["tonuk", "tonuk"],
  ["ton_uk", "tonuk"],

  // Force / pressure / torque
  ["n", "n"],
  ["newton", "n"],
  ["newtons", "n"],
  ["kn", "kn"],
  ["lbf", "lbf"],
  ["ozf", "ozf"],
  ["pa", "pa"],
  ["pascal", "pa"],
  ["pascals", "pa"],
  ["hpa", "hpa"],
  ["hectopascal", "hpa"],
  ["hectopascals", "hpa"],
  ["kpa", "kpa"],
  ["kilopascal", "kpa"],
  ["kilopascals", "kpa"],
  ["mpa", "mpa"],
  ["megapascal", "mpa"],
  ["megapascals", "mpa"],
  ["bar", "bar"],
  ["bars", "bar"],
  ["mbar", "mbar"],
  ["millibar", "mbar"],
  ["millibars", "mbar"],
  ["atm", "atm"],
  ["atmosphere", "atm"],
  ["atmospheres", "atm"],
  ["torr", "torr"],
  ["mmhg", "mmhg"],
  ["inhg", "inhg"],
  ["psi", "psi"],
  ["ksi", "ksi"],
  ["nmt", "nmt"],
  ["n*m", "nmt"],
  ["newtonmeter", "nmt"],
  ["newtonmeters", "nmt"],
  ["lbfft", "lbfft"],
  ["lbf*ft", "lbfft"],
  ["lbfin", "lbfin"],
  ["lbf*in", "lbfin"],
  ["ozfin", "ozfin"],
  ["ozf*in", "ozfin"],

  // Energy / power
  ["j", "j"],
  ["joule", "j"],
  ["joules", "j"],
  ["kj", "kj"],
  ["mj", "mj"],
  ["ev", "ev"],
  ["electronvolt", "ev"],
  ["electronvolts", "ev"],
  ["cal", "cal"],
  ["kcal", "kcal"],
  ["btu", "btu"],
  ["wh", "wh"],
  ["kwh", "kwh"],
  ["w", "w"],
  ["watt", "w"],
  ["watts", "w"],
  ["mw", "mw"],
  ["kw", "kw"],
  ["mwatt", "mwatt"],
  ["hp", "hp"],
  ["horsepower", "hp"],
  ["btuh", "btuh"],
  ["btu/h", "btuh"],

  // Flow
  ["lpm", "lpm"],
  ["l/min", "lpm"],
  ["gpm", "gpm"],
  ["gal/min", "gpm"],
  ["m3s", "m3s"],
  ["m3/s", "m3s"],
  ["cfm", "cfm"],
  ["ft3/min", "cfm"],

  // Electrical
  ["a", "a"],
  ["amp", "a"],
  ["amps", "a"],
  ["ampere", "a"],
  ["amperes", "a"],
  ["ma", "ma"],
  ["ua", "ua"],
  ["c", "c"],
  ["ah", "ah"],
  ["mah", "mah"],
  ["v", "v"],
  ["volt", "v"],
  ["volts", "v"],
  ["mv", "mv"],
  ["kv", "kv"],
  ["ohm", "ohm"],
  ["ohms", "ohm"],
  ["kohm", "kohm"],
  ["mohm", "mohm"],
  ["siemens", "siemens"],
  ["msiemens", "msiemens"],
  ["usiemens", "usiemens"],
  ["f", "f"],
  ["mf", "mf"],
  ["uf", "uf"],
  ["nf", "nf"],
  ["pf", "pf"],
  ["henry", "hry"],
  ["mhenry", "mhry"],
  ["uhenry", "uhry"],
  ["nhenry", "nhry"],
  ["mh", "mhry"],
  ["uh", "uhry"],
  ["nh", "nhry"],
  ["wb", "wb"],
  ["t", "t"],
  ["tesla", "t"],
  ["mt", "mt"],
  ["gauss", "gauss"],
  ["gss", "gauss"],

  // Density / viscosity
  ["kgm3", "kgm3"],
  ["kg/m3", "kgm3"],
  ["gcm3", "gcm3"],
  ["g/cm3", "gcm3"],
  ["lbft3", "lbft3"],
  ["lb/ft3", "lbft3"],
  ["pas", "pas"],
  ["pa*s", "pas"],
  ["cp", "cp"],

  // Temperature (linearized deltas)
  ["k", "k"],
  ["degc", "degc"],
  ["celsius", "degc"],
  ["degf", "degf"],
  ["fahrenheit", "degf"],
  ["rankine", "rankine"],
  ["r", "rankine"],
]);

export function normalizeUnitToken(rawUnit: string): string {
  const trimmed = rawUnit.trim();

  // Preserve common electrical-case abbreviations that collide with time symbols.
  if (/^[munp]?H$/.test(trimmed)) {
    if (trimmed === "H") {
      return "hry";
    }

    const prefix = trimmed[0].toLowerCase();
    return `${prefix}hry`;
  }

  if (trimmed === "S") {
    return "siemens";
  }

  return trimmed
    .replace(/[\u03A9\u03C9]/g, "ohm")
    .replace(/[\u00B5\u03BC]/g, "u")
    .toLowerCase();
}

export function getUnitSpec(rawUnit: string): UnitSpec | undefined {
  const normalized = normalizeUnitToken(rawUnit);
  const canonicalToken = UNIT_ALIASES.get(normalized) ?? normalized;
  return UNIT_SPECS.get(canonicalToken);
}

export function getUnitFamily(rawUnit: string): string | undefined {
  const spec = getUnitSpec(rawUnit);
  if (!spec) {
    return undefined;
  }
  return SCALABLE_UNIT_FAMILY.get(spec.token);
}

export const UNIT_SCALE_FACTORS = new Map<string, number>(
  UNIT_SPEC_LIST.map((spec) => [spec.token, spec.factorToSi])
);

export const UNITS = Array.from(UNIT_SPECS.keys());

export const UNIT_DIM = new Map<string, DimensionVector>(
  UNIT_SPEC_LIST.map((spec) => [spec.token, spec.dimension])
);

function buildCompositeUnit(
  left: string | undefined,
  right: string | undefined,
  operator: "*" | "/"
): string | undefined {
  if (!left && !right) {
    return undefined;
  }

  if (!left) {
    return operator === "*" ? right : `1/${right}`;
  }

  if (!right) {
    return left;
  }

  return operator === "*" ? `${left}*${right}` : `${left}/${right}`;
}

export function createDimensionlessQuantity(value: number): Quantity {
  return {
    valueSi: value,
    dimension: cloneDimension(DIMENSIONLESS),
  };
}

export function createQuantity(value: number, rawUnit?: string): UnitResult<Quantity> {
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      error: `non-finite numeric value: ${value}`,
    };
  }

  if (!rawUnit || rawUnit.trim().length === 0) {
    return {
      ok: true,
      value: createDimensionlessQuantity(value),
    };
  }

  const spec = getUnitSpec(rawUnit);
  if (!spec) {
    return {
      ok: false,
      error: `unknown unit '${rawUnit}'`,
    };
  }

  return {
    ok: true,
    value: {
      valueSi: value * spec.factorToSi,
      dimension: cloneDimension(spec.dimension),
      preferredUnit: spec.token,
      displayUnit: spec.canonical,
    },
  };
}

export function convertSiToUnit(valueSi: number, rawUnit: string): UnitResult<number> {
  const spec = getUnitSpec(rawUnit);
  if (!spec) {
    return {
      ok: false,
      error: `unknown unit '${rawUnit}'`,
    };
  }

  return {
    ok: true,
    value: valueSi / spec.factorToSi,
  };
}

export function convertQuantityToUnit(
  quantity: Quantity,
  rawUnit: string
): UnitResult<number> {
  const spec = getUnitSpec(rawUnit);
  if (!spec) {
    return {
      ok: false,
      error: `unknown unit '${rawUnit}'`,
    };
  }

  if (!dimensionsEqual(quantity.dimension, spec.dimension)) {
    return {
      ok: false,
      error:
        `unit mismatch: expression has ${formatDimension(quantity.dimension)} ` +
        `but '${spec.canonical}' expects ${formatDimension(spec.dimension)}`,
    };
  }

  return {
    ok: true,
    value: quantity.valueSi / spec.factorToSi,
  };
}

function unitText(quantity: Quantity): string | undefined {
  if (quantity.displayUnit) {
    return quantity.displayUnit;
  }

  if (quantity.preferredUnit) {
    const spec = UNIT_SPECS.get(quantity.preferredUnit);
    return spec?.canonical;
  }

  return undefined;
}

export function addQuantities(left: Quantity, right: Quantity): UnitResult<Quantity> {
  if (!dimensionsEqual(left.dimension, right.dimension)) {
    return {
      ok: false,
      error:
        `cannot add incompatible units: ${formatDimension(left.dimension)} ` +
        `and ${formatDimension(right.dimension)}`,
    };
  }

  return {
    ok: true,
    value: {
      valueSi: left.valueSi + right.valueSi,
      dimension: cloneDimension(left.dimension),
      preferredUnit: left.preferredUnit ?? right.preferredUnit,
      displayUnit: unitText(left) ?? unitText(right),
    },
  };
}

export function subtractQuantities(
  left: Quantity,
  right: Quantity
): UnitResult<Quantity> {
  if (!dimensionsEqual(left.dimension, right.dimension)) {
    return {
      ok: false,
      error:
        `cannot subtract incompatible units: ${formatDimension(left.dimension)} ` +
        `and ${formatDimension(right.dimension)}`,
    };
  }

  return {
    ok: true,
    value: {
      valueSi: left.valueSi - right.valueSi,
      dimension: cloneDimension(left.dimension),
      preferredUnit: left.preferredUnit ?? right.preferredUnit,
      displayUnit: unitText(left) ?? unitText(right),
    },
  };
}

export function multiplyQuantities(
  left: Quantity,
  right: Quantity
): UnitResult<Quantity> {
  if (!Number.isFinite(left.valueSi) || !Number.isFinite(right.valueSi)) {
    return {
      ok: false,
      error: "non-finite multiplication operand",
    };
  }

  if (isDimensionless(left.dimension)) {
    return {
      ok: true,
      value: {
        valueSi: left.valueSi * right.valueSi,
        dimension: cloneDimension(right.dimension),
        preferredUnit: right.preferredUnit,
        displayUnit: right.displayUnit,
      },
    };
  }

  if (isDimensionless(right.dimension)) {
    return {
      ok: true,
      value: {
        valueSi: left.valueSi * right.valueSi,
        dimension: cloneDimension(left.dimension),
        preferredUnit: left.preferredUnit,
        displayUnit: left.displayUnit,
      },
    };
  }

  return {
    ok: true,
    value: {
      valueSi: left.valueSi * right.valueSi,
      dimension: addDimensions(left.dimension, right.dimension),
      displayUnit: buildCompositeUnit(unitText(left), unitText(right), "*"),
    },
  };
}

export function divideQuantities(left: Quantity, right: Quantity): UnitResult<Quantity> {
  if (!Number.isFinite(left.valueSi) || !Number.isFinite(right.valueSi)) {
    return {
      ok: false,
      error: "non-finite division operand",
    };
  }

  if (Math.abs(right.valueSi) < EPSILON) {
    return {
      ok: false,
      error: "division by zero",
    };
  }

  if (isDimensionless(right.dimension)) {
    return {
      ok: true,
      value: {
        valueSi: left.valueSi / right.valueSi,
        dimension: cloneDimension(left.dimension),
        preferredUnit: left.preferredUnit,
        displayUnit: left.displayUnit,
      },
    };
  }

  return {
    ok: true,
    value: {
      valueSi: left.valueSi / right.valueSi,
      dimension: subtractDimensions(left.dimension, right.dimension),
      displayUnit: buildCompositeUnit(unitText(left), unitText(right), "/"),
    },
  };
}

export function negateQuantity(input: Quantity): Quantity {
  return {
    ...input,
    valueSi: -input.valueSi,
  };
}

export function toDisplayValue(quantity: Quantity): number {
  if (!quantity.preferredUnit) {
    return quantity.valueSi;
  }

  const spec = UNIT_SPECS.get(quantity.preferredUnit);
  if (!spec) {
    return quantity.valueSi;
  }

  return quantity.valueSi / spec.factorToSi;
}

export function toDisplayUnit(quantity: Quantity): string | undefined {
  if (quantity.displayUnit) {
    return quantity.displayUnit;
  }

  if (quantity.preferredUnit) {
    const spec = UNIT_SPECS.get(quantity.preferredUnit);
    return spec?.canonical;
  }

  if (isDimensionless(quantity.dimension)) {
    return undefined;
  }

  return formatDimension(quantity.dimension);
}

function scoreNormalizedMagnitude(absValue: number): number {
  if (!Number.isFinite(absValue) || absValue === 0) {
    return 0;
  }

  const logMagnitude = Math.log10(absValue);
  let score = Math.abs(logMagnitude - 1.5);
  if (absValue < 1 || absValue >= 1000) {
    score += 2;
  }

  return score;
}

function trimUnitBrackets(rawUnit: string): string {
  return rawUnit.trim().replace(/^\[+/, "").replace(/\]+$/, "").trim();
}

/**
 * Chooses a human-friendly representation for a numeric value with unit.
 * Example: normalizeUnit(24000, "mA") -> { value: 24, unit: "A" }.
 */
export function normalizeUnit(
  value: number,
  rawUnit?: string
): { value: number; unit?: string } {
  if (!Number.isFinite(value)) {
    return {
      value,
      unit: rawUnit?.trim(),
    };
  }

  if (!rawUnit || rawUnit.trim().length === 0) {
    return {
      value,
    };
  }

  const cleanedUnit = trimUnitBrackets(rawUnit);
  const sourceSpec = getUnitSpec(cleanedUnit);
  if (!sourceSpec) {
    return {
      value,
      unit: cleanedUnit || undefined,
    };
  }

  const family = SCALABLE_UNIT_FAMILY.get(sourceSpec.token);
  if (!family) {
    return {
      value,
      unit: sourceSpec.canonical,
    };
  }

  const valueSi = value * sourceSpec.factorToSi;
  let bestSpec = sourceSpec;
  let bestScore = scoreNormalizedMagnitude(Math.abs(value));

  for (const candidate of UNIT_SPEC_LIST) {
    if (SCALABLE_UNIT_FAMILY.get(candidate.token) !== family) {
      continue;
    }

    if (!dimensionsEqual(candidate.dimension, sourceSpec.dimension)) {
      continue;
    }

    const candidateValue = valueSi / candidate.factorToSi;
    if (!Number.isFinite(candidateValue)) {
      continue;
    }

    const score = scoreNormalizedMagnitude(Math.abs(candidateValue));
    if (score + EPSILON < bestScore) {
      bestScore = score;
      bestSpec = candidate;
    }
  }

  return {
    value: valueSi / bestSpec.factorToSi,
    unit: bestSpec.canonical,
  };
}

export function applyOutputUnit(
  quantity: Quantity,
  rawUnit: string
): UnitResult<{ quantity: Quantity; displayValue: number; displayUnit: string }> {
  const spec = getUnitSpec(rawUnit);
  if (!spec) {
    return {
      ok: false,
      error: `unknown unit '${rawUnit}'`,
    };
  }

  if (!dimensionsEqual(quantity.dimension, spec.dimension)) {
    return {
      ok: false,
      error:
        `unit mismatch: expression has ${formatDimension(quantity.dimension)} ` +
        `but output unit '${spec.canonical}' requires ${formatDimension(spec.dimension)}`,
    };
  }

  return {
    ok: true,
    value: {
      quantity: {
        ...quantity,
        preferredUnit: spec.token,
        displayUnit: spec.canonical,
      },
      displayValue: quantity.valueSi / spec.factorToSi,
      displayUnit: spec.canonical,
    },
  };
}
