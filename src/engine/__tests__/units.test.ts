import test from "node:test";
import assert from "node:assert/strict";

import { addQuantities, applyOutputUnit, createQuantity } from "../units";

test("unit system converts compatible pressure units", () => {
  const pa = createQuantity(100, "Pa");
  const atm = createQuantity(1, "atm");
  assert.equal(pa.ok, true);
  assert.equal(atm.ok, true);
  if (!pa.ok || !atm.ok) {
    return;
  }

  const sum = addQuantities(pa.value, atm.value);
  assert.equal(sum.ok, true);
  if (!sum.ok) {
    return;
  }

  const converted = applyOutputUnit(sum.value, "Pa");
  assert.equal(converted.ok, true);
  if (!converted.ok) {
    return;
  }

  assert.ok(Math.abs(converted.value.displayValue - 101425) < 1e-9);
});

test("unit system rejects incompatible add/sub operations", () => {
  const resistance = createQuantity(10, "ohm");
  const voltage = createQuantity(5, "V");
  assert.equal(resistance.ok, true);
  assert.equal(voltage.ok, true);
  if (!resistance.ok || !voltage.ok) {
    return;
  }

  const sum = addQuantities(resistance.value, voltage.value);
  assert.equal(sum.ok, false);
});

