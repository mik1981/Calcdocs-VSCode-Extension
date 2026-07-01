import { describe, expect, it } from "vitest";

import { contextFor, createHarness, ws } from "./helpers";

describe("Regression behavior", () => {
  it("preserves macro-chain numeric results", async () => {
    const root = ws(process.cwd(), "fixture-regression-chain");
    const main = ws(root, "input.c");
    const text = [
      "#define ADC_BITS 12",
      "#define ADC_MAX ((1 << ADC_BITS) - 1)",
      "#define HALF_SCALE (ADC_MAX / 2)",
      "",
    ].join("\n");
    const harness = createHarness({ [main]: text }, root);

    const result = await harness.symbolEngine.resolve("HALF_SCALE", contextFor(main, text, root));

    expect(result.resolved?.value).toBe(2047.5);
  });

  it("preserves enum resolution outcomes", async () => {
    const root = ws(process.cwd(), "fixture-regression-enum");
    const main = ws(root, "input.c");
    const text = [
      "enum Mode {",
      "  MODE_IDLE = 0,",
      "  MODE_RUN,",
      "  MODE_FAULT = MODE_RUN + 4,",
      "};",
      "#define SELECTED_MODE MODE_FAULT",
      "",
    ].join("\n");
    const harness = createHarness({ [main]: text }, root);

    const result = await harness.symbolEngine.resolve("SELECTED_MODE", contextFor(main, text, root));

    expect(result.resolved?.value).toBe(5);
  });
});
