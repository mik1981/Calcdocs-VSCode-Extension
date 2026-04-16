import { describe, expect, it } from "vitest";

import { addQuantities, applyOutputUnit, createQuantity } from "../units";

describe("units", () => {
  it("converts compatible pressure units", () => {
    const pa = createQuantity(100, "Pa");
    const atm = createQuantity(1, "atm");
    expect(pa.ok).toBe(true);
    expect(atm.ok).toBe(true);
    if (!pa.ok || !atm.ok) {
      return;
    }

    const sum = addQuantities(pa.value, atm.value);
    expect(sum.ok).toBe(true);
    if (!sum.ok) {
      return;
    }

    const converted = applyOutputUnit(sum.value, "Pa");
    expect(converted.ok).toBe(true);
    if (!converted.ok) {
      return;
    }

    expect(converted.value.displayValue).toBeCloseTo(101425, 9);
  });

  it("rejects incompatible add/sub operations", () => {
    const resistance = createQuantity(10, "ohm");
    const voltage = createQuantity(5, "V");
    expect(resistance.ok).toBe(true);
    expect(voltage.ok).toBe(true);
    if (!resistance.ok || !voltage.ok) {
      return;
    }

    const sum = addQuantities(resistance.value, voltage.value);
    expect(sum.ok).toBe(false);
  });
});

