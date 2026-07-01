import { describe, expect, it } from "vitest";

import { ExpressionEvaluator } from "../../src/evaluation/ExpressionEvaluator";

describe("ExpressionEvaluator", () => {
  it("evaluates arithmetic, C numeric suffixes, casts, and hex values", async () => {
    const evaluator = new ExpressionEvaluator();
    const result = await evaluator.evaluate(
      "A + 0x10UL + (uint32_t)4",
      async (identifier) => (identifier === "A" ? 2 : undefined),
      { filePath: "main.c", line: 0, column: 0 }
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe(22);
    expect(result.expandedExpression).toContain("2");
  });

  it("supports a small numeric math function scope", async () => {
    const evaluator = new ExpressionEvaluator();
    const result = await evaluator.evaluate(
      "sqrt(16) + max(1, 2)",
      async () => undefined,
      { filePath: "formulas.yaml", line: 0, column: 0 }
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe(6);
  });

  it("reports unresolved identifiers without evaluating unsafe text", async () => {
    const evaluator = new ExpressionEvaluator();
    const result = await evaluator.evaluate(
      "KNOWN + UNKNOWN",
      async (identifier) => (identifier === "KNOWN" ? 1 : undefined),
      { filePath: "main.c", line: 3, column: 1 }
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("unresolved-expression-symbol");
  });
});
