/**
 * Monte Carlo uncertainty propagation engine for CalcDocs.
 *
 * Generates N samples for each input variable according to its declared
 * distribution, evaluates the formula on the full sample vector
 * (vectorised via typed arrays for speed), then computes output statistics.
 *
 * Three distributions are supported:
 *   - Rectangular  : defined by min/max or nominal ± tol%
 *   - Triangular   : defined by min/max/mode  (peak of the triangle)
 *   - Gaussian     : defined by value (mean) and sigma (std-dev)
 */

import type { TolMode } from "../types/FormulaEntry";

// ─── Public types ─────────────────────────────────────────────────────────────

export type McDistribution =
  | { kind: "rectangular"; min: number; max: number }
  | { kind: "triangular";  min: number; max: number; mode: number }
  | { kind: "gaussian";    mean: number; sigma: number };

export type McInput = {
  name: string;
  distribution: McDistribution;
};

export type McResult = {
  /** Sample mean of the output */
  mean: number;
  /** Sample standard deviation */
  stdDev: number;
  /** Empirical minimum */
  min: number;
  /** Empirical maximum */
  max: number;
  /** 2.5th percentile  (≈ μ − 2σ for Gaussian) */
  p025: number;
  /** 97.5th percentile (≈ μ + 2σ for Gaussian) */
  p975: number;
  /** Number of samples that were evaluated */
  nSamples: number;
  /** Number of samples that produced non-finite results (discarded) */
  nDiscarded: number;
};

export type McOptions = {
  /** Number of Monte Carlo samples (default: 10 000) */
  nSamples?: number;
  /** Random seed for reproducibility (optional, uses Math.random if absent) */
  seed?: number;
};

// ─── Internal PRNG (xoshiro128** – fast, seedable) ────────────────────────────

type Prng = () => number;   // returns [0, 1)

function buildPrng(seed?: number): Prng {
  // xoshiro128** state (4 × uint32)
  let s0 = (seed ?? Date.now()) >>> 0;
  let s1 = (s0 ^ 0xdeadbeef) >>> 0;
  let s2 = (s1 ^ 0xcafebabe) >>> 0;
  let s3 = (s2 ^ 0x12345678) >>> 0;

  const rotl = (x: number, k: number) =>
    ((x << k) | (x >>> (32 - k))) >>> 0;

  return () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0) / 0x100000000;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    return result;
  };
}

// ─── Sample generators ────────────────────────────────────────────────────────

/** Box-Muller transform: two uniform → two independent standard normals */
function gaussianPair(u1: number, u2: number): [number, number] {
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-300)));
  const θ = 2 * Math.PI * u2;
  return [r * Math.cos(θ), r * Math.sin(θ)];
}

/**
 * Fill a Float64Array with N samples drawn from `dist`.
 * The function uses the supplied PRNG and writes directly into `out`
 * (avoiding allocations inside the hot loop).
 */
function fillSamples(
  dist: McDistribution,
  out: Float64Array,
  rng: Prng
): void {
  const n = out.length;

  switch (dist.kind) {
    case "rectangular": {
      const span = dist.max - dist.min;
      for (let i = 0; i < n; i++) {
        out[i] = dist.min + rng() * span;
      }
      break;
    }

    case "triangular": {
      // Inverse CDF for triangular distribution
      const { min: a, max: b, mode: c } = dist;
      const span = b - a;
      const Fc = (c - a) / span;   // CDF at mode
      for (let i = 0; i < n; i++) {
        const u = rng();
        if (u < Fc) {
          out[i] = a + Math.sqrt(u * span * (c - a));
        } else {
          out[i] = b - Math.sqrt((1 - u) * span * (b - c));
        }
      }
      break;
    }

    case "gaussian": {
      // Box-Muller, two samples per iteration
      const { mean, sigma } = dist;
      let i = 0;
      while (i < n - 1) {
        const [z0, z1] = gaussianPair(rng(), rng());
        out[i++] = mean + sigma * z0;
        out[i++] = mean + sigma * z1;
      }
      // Tail sample if n is odd
      if (i < n) {
        const [z0] = gaussianPair(rng(), rng());
        out[i] = mean + sigma * z0;
      }
      break;
    }
  }
}

// ─── Percentile helper ────────────────────────────────────────────────────────

/** Linear interpolation percentile on a *sorted* array */
function percentile(sorted: Float64Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a Monte Carlo propagation.
 *
 * @param inputs    Array of named inputs with their distributions.
 * @param evaluate  Function that takes a map `{ [name]: sampledValue }` and
 *                  returns the scalar output.  It is called **once per sample**
 *                  in a tight loop, so keep it lightweight.
 * @param options   nSamples (default 10 000) and optional seed.
 */
export function runMonteCarlo(
  inputs: McInput[],
  evaluate: (values: Record<string, number>) => number,
  options: McOptions = {}
): McResult {
  const nSamples = Math.max(100, options.nSamples ?? 10_000);
  const rng = buildPrng(options.seed);

  // Pre-allocate one Float64Array per input
  const sampleArrays = inputs.map((inp) => {
    const arr = new Float64Array(nSamples);
    fillSamples(inp.distribution, arr, rng);
    return arr;
  });

  // Output buffer
  const outputSamples = new Float64Array(nSamples);
  const pointValues: Record<string, number> = {};

  let sum = 0;
  let sum2 = 0;
  let validCount = 0;
  let discarded = 0;

  for (let i = 0; i < nSamples; i++) {
    // Populate the evaluation point
    for (let j = 0; j < inputs.length; j++) {
      pointValues[inputs[j].name] = sampleArrays[j][i];
    }

    const y = evaluate(pointValues);

    if (!Number.isFinite(y)) {
      discarded++;
      outputSamples[i] = NaN;
      continue;
    }

    outputSamples[i] = y;
    sum += y;
    sum2 += y * y;
    validCount++;
  }

  if (validCount === 0) {
    return {
      mean: NaN, stdDev: NaN, min: NaN, max: NaN,
      p025: NaN, p975: NaN,
      nSamples, nDiscarded: discarded,
    };
  }

  const mean = sum / validCount;
  const variance = sum2 / validCount - mean * mean;
  const stdDev = Math.sqrt(Math.max(0, variance));

  // Collect valid samples for min/max/percentiles
  const valid = new Float64Array(validCount);
  let k = 0;
  for (let i = 0; i < nSamples; i++) {
    const v = outputSamples[i];
    if (Number.isFinite(v)) valid[k++] = v;
  }
  valid.sort();    // TypedArray.sort() is in-place and fast

  return {
    mean,
    stdDev,
    min: valid[0],
    max: valid[validCount - 1],
    p025: percentile(valid, 0.025),
    p975: percentile(valid, 0.975),
    nSamples,
    nDiscarded: discarded,
  };
}

// ─── Helpers for CalcDocs integration ────────────────────────────────────────

/**
 * Build a McDistribution from CalcDocs tolerance metadata.
 *
 * @param tolMode  The declared TolMode ("worst_case" treated as rectangular)
 * @param min      Lower bound (absolute)
 * @param max      Upper bound (absolute)
 * @param nominal  Nominal value (used as mode for triangular / mean for Gaussian)
 * @param sigma    Number of sigmas for Gaussian (default 3)
 */
export function distributionFromTolerance(
  tolMode: TolMode | undefined,
  min: number,
  max: number,
  nominal?: number,
  sigma?: number
): McDistribution {
  const mode = nominal ?? (min + max) / 2;

  switch (tolMode) {
    case "gaussian": {
      // Treat min/max as ±(sigma)σ bounds
      const s = sigma ?? 3;
      const stdDevEst = (max - min) / (2 * s);
      return { kind: "gaussian", mean: mode, sigma: stdDevEst };
    }
    case "rss":
      // RSS typically implies rectangular inputs → Gaussian output via CLT.
      // For the *input* distribution we use rectangular here.
      return { kind: "rectangular", min, max };

    default:
      // worst_case or undefined → rectangular (uniform)
      return { kind: "rectangular", min, max };
  }
}