import { describe, expect, it } from "vitest";

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

describe("yamlEngine", () => {
  it("evaluates dependency graph and explain steps", () => {
    const parsedRoot = {
      ADC_MAX: { type: "const", value: 4095 },
      R_PULLUP: { type: "const", value: 10000, unit: "ohm" },
      NTC_R: { type: "const", value: 10, unit: "ohm" },
      NTC_ADC: {
        type: "expr",
        expr: "ADC_MAX * NTC_R / (R_PULLUP + NTC_R)",
        unit: "count",
        value: "auto",
      },
    } as Record<string, unknown>;

    const result = evaluateYamlDocument(parsedRoot, { rawText: SAMPLE_YAML_TEXT });
    const ntcAdc = result.symbols.get("NTC_ADC");
    expect(ntcAdc).toBeTruthy();
    if (!ntcAdc) {
      return;
    }

    expect(ntcAdc.errors.length).toBe(0);
    expect(typeof ntcAdc.value).toBe("number");
    expect(ntcAdc.value ?? 0).toBeCloseTo(4.0909090909, 6);
    expect((ntcAdc.explainSteps?.length ?? 0) >= 2).toBe(true);
  });

  it("reports undefined variables and circular dependencies", () => {
    const parsedRoot = {
      A: { type: "expr", expr: "B + C" },
      B: { type: "expr", expr: "A + 1" },
    } as Record<string, unknown>;

    const result = evaluateYamlDocument(parsedRoot, {
      rawText: `A:\n  type: expr\n  expr: B + C\nB:\n  type: expr\n  expr: A + 1\n`,
    });

    expect(result.cycles.length >= 1).toBe(true);
    expect(result.diagnostics.length > 0).toBe(true);
    expect(
      result.diagnostics.some((diag) =>
        diag.message.toLowerCase().includes("circular dependency")
      )
    ).toBe(true);
  });

  it("accepts compatible pressure units in one expression", () => {
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
    expect(symbol).toBeTruthy();
    if (!symbol) {
      return;
    }

    expect(symbol.errors.length).toBe(0);
    expect(typeof symbol.value).toBe("number");
    expect(symbol.value ?? 0).toBeCloseTo(10010000 / 101325, 6);
  });

  it("avoids unnecessary output conversion on pure multiplication", () => {
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
    expect(symbol).toBeTruthy();
    if (!symbol) {
      return;
    }

    expect(symbol.errors.length).toBe(0);
    expect(symbol.outputUnit).toBe("bar");
    expect(typeof symbol.value).toBe("number");
    expect(symbol.value ?? 0).toBeCloseTo(20, 9);
  });

  it("converts pure multiplication output for scaled same-family units", () => {
    const parsedRoot = {
      VIN: { type: "const", value: 3.3, unit: "V" },
      VIN_MV: { type: "expr", expr: "VIN * 2", unit: "mV" },
    } as Record<string, unknown>;

    const result = evaluateYamlDocument(parsedRoot, {
      rawText:
        `VIN:\n  type: const\n  value: 3.3\n  unit: V\n` +
        `VIN_MV:\n  type: expr\n  expr: VIN * 2\n  unit: mV\n`,
    });

    const symbol = result.symbols.get("VIN_MV");
    expect(symbol).toBeTruthy();
    if (!symbol) {
      return;
    }

    expect(symbol.errors.length).toBe(0);
    expect(symbol.outputUnit).toBe("mV");
    expect(typeof symbol.value).toBe("number");
    expect(symbol.value ?? 0).toBeCloseTo(6600, 9);
  });
});
