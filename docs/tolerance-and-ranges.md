# Tolerance propagation & formula ranges

CalcDocs can do more than compute a nominal value: it can also propagate **uncertainty** through your engineering formulas and compute a final **min/max range**.

This is driven by tolerance metadata defined in `formulas*.yaml`.

---

## What “tolerance propagation” means

When a YAML symbol defines a tolerance:

- `tol` (percent, e.g. `tol: 5` or `tol: 2%`), and/or
- absolute bounds `min` / `max`

CalcDocs computes an internal numeric **range** (`[min, max]`) for that symbol.

If the symbol is then used as an input to other formulas, CalcDocs propagates its range through the whole dependency chain to estimate the final range for dependent symbols.

---

## Supported tolerance fields

### 1) `tol`

Percent tolerance around the nominal value.

Example:

```yaml
R1:
  value: 100
  unit: ohm
  tol: 5
```

→ nominal `100` with range `[95, 105]`.

### 2) `min` / `max`

Absolute variation bounds.

```yaml
CURRENT_SOURCE_A:
  value: 0.5
  unit: A
  min: 0.48
  max: 0.52
```

### 3) `ranges` (per-dependency overrides)

Override the uncertainty of specific dependencies used by a formula.

```yaml
V_DIVIDER_RAW:
  formula: SUPPLY_V * R3 / (R1 + R3)
  unit: V
  ranges:
    R1:
      tol: 1
    R3:
      min: 320
      max: 340
```

Meaning: even if `R1` and `R3` declare other tolerances elsewhere, this formula uses the overridden intervals.

### 4) `tolerance.parameters` (parameter tolerances)


For parameterized formulas, you can assign tolerances to the **formal parameters**.

```yaml
DIVIDER:
  formula: V * R2 / (R1 + R2)
  parameters: [V, R1, R2]
  tolerance:
    parameters:
      V:  { tol: 2 }
      R1: { tol: 1 }
      R2: { tol: 5 }
```

Then:

```yaml
DIVIDER_OUT:
  formula: DIVIDER(SUPPLY_V, 1000, 2000)
  unit: V
```

CalcDocs applies those parameter tolerances during propagation.

---

## Propagation model (worst-case)

CalcDocs uses a **worst-case** approach for range estimation.

- If a final formula does **not** declare its own tolerance, the interval is estimated by combining dependency extremes.
- For **non-linear operators** (multiplication, division, functions, etc.), CalcDocs explores admissible min/max combinations among dependencies and then uses:
  - `min` = minimum value observed across evaluations
  - `max` = maximum value observed across evaluations

A complexity limit is applied to keep evaluation safe and fast.

---

## Arrays and vector tolerances

Arrays can also carry `tol` metadata and/or define values that are then summed/combined in formulas.

Example (array elements with tolerance):

```yaml
RES_ARRAY:
  value: [100, 220, 330, 470]
  unit: ohm
  tol: 5

ARRAY_SUM:
  formula: RES_ARRAY[0] + RES_ARRAY[1] + RES_ARRAY[2]
  unit: ohm
```

---

## How to use this in the UI (Interactive Formula Viewer)

Once ranges are computed, the **Interactive Formula Viewer** can:

- show nominal values
- show propagated min/max ranges on computed outputs
- explain dependency chains that caused the final range

In practice you enable it and inspect the dependency graph for your target symbol.

---

## Reference example: tolerance propagation case

The repository includes a dedicated test/demo:

- `examples/cases/15_tolerance_propagation`
  - `input.c`
  - `formulas.yaml`
  - `expected.yaml`

Key features covered in that example:

- `tol` percent on components
- explicit `min`/`max` bounds
- `ranges` overrides
- `tolerance.parameters` for parameterized formulas
- propagation across deep chains (component → derived → final)

---

## Practical tips (best results)

- Always declare `unit` for tolerance-bearing symbols (helps dimensional checks).
- Use `ranges` when you need a tighter interval for a specific measurement path.
- Prefer explicit `min`/`max` for datasheet-driven absolute specs.
- Keep dependency graphs small when using strongly non-linear formulas (worst-case exploration can get expensive).

