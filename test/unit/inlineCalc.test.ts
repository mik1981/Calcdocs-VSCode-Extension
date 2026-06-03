import { describe, expect, it } from "vitest";
import { evaluateInlineCalcs } from "../../src/core/inlineCalc";

describe("inline calculations", () => {
  const mockState = {
    formulaIndex: new Map(),
    configVars: new Map(),
    symbolValues: new Map(),
    symbolUnits: new Map(),
    allDefines: new Map(),
    functionDefines: new Map(),
    defineConditions: new Map(),
  };

  it("evaluates basic assignments and calculations", () => {
    const text = [
      "// @vin = 12V",
      "// @r = 4.7kohm",
      "// = @vin / @r -> ma",
    ].join("\n");

    const results = evaluateInlineCalcs(text, mockState, { includeAssignments: true }, "c");
    
    expect(results).toHaveLength(3);
    expect(results[0].kind).toBe("assign");
    expect(results[0].variable).toBe("vin");
    expect(results[0].value).toBeCloseTo(12);

    expect(results[1].kind).toBe("assign");
    expect(results[1].variable).toBe("r");
    expect(results[1].value).toBeCloseTo(4700);

    expect(results[2].kind).toBe("calc");
    expect(results[2].value).toBeCloseTo(0.002553191489361702);
    expect(results[2].displayValue).toContain("2.553");
    expect(results[2].outputUnit).toBe("ma");
  });

  it("handles unit conversions", () => {
    const text = "// = 100 bar + 10 kPa -> atm";
    const results = evaluateInlineCalcs(text, mockState, {}, "c");
    
    expect(results).toHaveLength(1);
    expect(results[0].displayValue).toContain("atm");
  });

  it("evaluates direct output-unit conversions", () => {
    const text = [
      "// @vin = 12 V",
      "// = @vin -> mV",
      "// = 4.74 L/min -> m3/s",
    ].join("\n");
    const results = evaluateInlineCalcs(text, mockState, {}, "c");
    const calculations = results.filter((result) => result.kind === "calc");

    expect(calculations).toHaveLength(2);
    expect(calculations[0].value).toBeCloseTo(12);
    expect(calculations[0].displayValue).toContain("mV");
    expect(calculations[1].value).toBeCloseTo(0.000079);
    expect(calculations[1].displayValue).toContain("m3/s");
  });

  it("detects dimensional mismatches", () => {
    const text = "// = 10m + 5s";
    const results = evaluateInlineCalcs(text, mockState, {}, "c");
    
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe("warning");
    expect(results[0].warnings.length).toBeGreaterThan(0);
  });
});
