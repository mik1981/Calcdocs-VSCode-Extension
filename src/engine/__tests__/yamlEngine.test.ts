import test from "node:test";
import assert from "node:assert/strict";

import { evaluateYamlDocument } from "../yamlEngine";

const SAMPLE_YAML_TEXT = `ADC_MAX:
  type: const
  value: 4095

R_PULLUP:
  type: const
  value: 10000
  unit: ohm

NTC_R:
  type: const
  value: 10
  unit: ohm

NTC_ADC:
  type: expr
  expr: ADC_MAX * NTC_R / (R_PULLUP + NTC_R)
  unit: count
  value: auto
`;

test("yaml engine evaluates dependency graph and explain steps", () => {
  const parsedRoot = {
    ADC_MAX: {
      type: "const",
      value: 4095,
    },
    R_PULLUP: {
      type: "const",
      value: 10000,
      unit: "ohm",
    },
    NTC_R: {
      type: "const",
      value: 10,
      unit: "ohm",
    },
    NTC_ADC: {
      type: "expr",
      expr: "ADC_MAX * NTC_R / (R_PULLUP + NTC_R)",
      unit: "count",
      value: "auto",
    },
  } as Record<string, unknown>;

  const result = evaluateYamlDocument(parsedRoot, {
    rawText: SAMPLE_YAML_TEXT,
  });

  const ntcAdc = result.symbols.get("NTC_ADC");
  assert.ok(ntcAdc);
  if (!ntcAdc) {
    return;
  }

  assert.equal(ntcAdc.errors.length, 0);
  assert.ok(typeof ntcAdc.value === "number");
  assert.ok(Math.abs((ntcAdc.value ?? 0) - 4.0909090909) < 1e-6);
  assert.ok((ntcAdc.explainSteps?.length ?? 0) >= 2);
});

test("yaml engine reports undefined variables and circular dependencies", () => {
  const parsedRoot = {
    A: {
      type: "expr",
      expr: "B + C",
    },
    B: {
      type: "expr",
      expr: "A + 1",
    },
  } as Record<string, unknown>;

  const result = evaluateYamlDocument(parsedRoot, {
    rawText: `A:\n  type: expr\n  expr: B + C\nB:\n  type: expr\n  expr: A + 1\n`,
  });

  assert.ok(result.cycles.length >= 1);
  assert.ok(result.diagnostics.some((diag) => diag.message.includes("undefined variable 'C'")));
  assert.ok(
    result.diagnostics.some((diag) =>
      diag.message.toLowerCase().includes("circular dependency")
    )
  );
});

test("yaml engine accepts compatible pressure units in one expression", () => {
  const parsedRoot = {
    PRESSURE_MIX: {
      type: "expr",
      expr: "100 bar + 10 kPa",
      unit: "atm",
    },
  } as Record<string, unknown>;

  const result = evaluateYamlDocument(parsedRoot, {
    rawText: `PRESSURE_MIX:\n  type: expr\n  expr: 100 bar + 10 kPa\n  unit: atm\n`,
  });

  const symbol = result.symbols.get("PRESSURE_MIX");
  assert.ok(symbol);
  if (!symbol) {
    return;
  }

  assert.equal(symbol.errors.length, 0);
  assert.ok(typeof symbol.value === "number");
  assert.ok(Math.abs((symbol.value ?? 0) - (10010000 / 101325)) < 1e-6);
});

test("yaml engine avoids unnecessary output conversion on pure multiplication", () => {
  const parsedRoot = {
    VEL: {
      type: "expr",
      expr: "5 * MUL",
      unit: "atm",
    },
  } as Record<string, unknown>;

  const result = evaluateYamlDocument(parsedRoot, {
    rawText: `VEL:\n  type: expr\n  expr: 5 * MUL\n  unit: atm\n`,
    externalValues: new Map([["MUL", 4]]),
    externalUnits: new Map([["MUL", "bar"]]),
  });

  const symbol = result.symbols.get("VEL");
  assert.ok(symbol);
  if (!symbol) {
    return;
  }

  assert.equal(symbol.errors.length, 0);
  assert.equal(symbol.outputUnit, "bar");
  assert.ok(typeof symbol.value === "number");
  assert.ok(Math.abs((symbol.value ?? 0) - 20) < 1e-9);
});

test("yaml engine converts pure multiplication output for scaled same-family units", () => {
  const parsedRoot = {
    VIN: {
      type: "const",
      value: 3.3,
      unit: "V",
    },
    VIN_MV: {
      type: "expr",
      expr: "VIN * 2",
      unit: "mV",
    },
  } as Record<string, unknown>;

  const result = evaluateYamlDocument(parsedRoot, {
    rawText:
      `VIN:\n  type: const\n  value: 3.3\n  unit: V\n` +
      `VIN_MV:\n  type: expr\n  expr: VIN * 2\n  unit: mV\n`,
  });

  const symbol = result.symbols.get("VIN_MV");
  assert.ok(symbol);
  if (!symbol) {
    return;
  }

  assert.equal(symbol.errors.length, 0);
  assert.equal(symbol.outputUnit, "mV");
  assert.ok(typeof symbol.value === "number");
  assert.ok(Math.abs((symbol.value ?? 0) - 6600) < 1e-9);
});
