import { describe, expect, it } from "vitest";

import { InteractiveFormulaEngine } from "../../src/ui/interactiveFormulaEngine";
import type { CalcDocsState } from "../../src/core/state";
import type { FormulaEntry } from "../../src/types/FormulaEntry";

function makeEntry(
  key: string,
  formula: string | undefined,
  valueYaml?: number
): FormulaEntry {
  return {
    key,
    formula,
    steps: [],
    labels: [],
    valueYaml,
    valueCalc: valueYaml ?? null,
  };
}

function makeState(entries: FormulaEntry[], values = new Map<string, number>()): CalcDocsState {
  return {
    formulaIndex: new Map(entries.map((entry) => [entry.key, entry])),
    symbolValues: values,
    symbolUnits: new Map(),
    csvTables: new Map(),
    lastYamlPath: "",
    lastYamlRaw: "",
  } as unknown as CalcDocsState;
}

describe("InteractiveFormulaEngine", () => {
  it("recomputes nested formulas from direct overrides", () => {
    const state = makeState(
      [
        makeEntry("ROOT", "MID + X"),
        makeEntry("MID", "LEAF * 2"),
        makeEntry("LEAF", undefined, 2),
      ],
      new Map([["X", 5]])
    );
    const engine = new InteractiveFormulaEngine(state);

    const result = engine.evaluate("ROOT", { LEAF: 3 }, "LEAF");

    expect(result.values.ROOT).toBe(11);
    expect(result.values.MID).toBe(6);
    expect(result.values.LEAF).toBe(3);
    expect(result.propagation).toEqual(expect.arrayContaining(["LEAF", "MID", "ROOT"]));
    expect(result.tree.localInputs.find((input) => input.name === "MID")?.kind).toBe("formula");
  });

  it("reports dependency cycles instead of producing a dummy result", () => {
    const state = makeState([
      makeEntry("A", "B + 1"),
      makeEntry("B", "A + 1"),
    ]);
    const engine = new InteractiveFormulaEngine(state);

    const result = engine.evaluate("A", {});

    expect(result.value).toBeNull();
    expect(result.errors.A?.join("\n")).toContain("cyclic dependency");
    expect(JSON.stringify(result.tree)).toContain("cyclic dependency");
  });

  it("marks nested branches that exceed the depth limit", () => {
    const entries = Array.from({ length: 8 }, (_, index) =>
      makeEntry(`F${index}`, index === 7 ? undefined : `F${index + 1} + 1`, index === 7 ? 1 : undefined)
    );
    const state = makeState(entries);
    const engine = new InteractiveFormulaEngine(state);

    const result = engine.evaluate("F0", {});

    expect(JSON.stringify(result.tree)).toContain('"depthLimited":true');
  });
});
