import { describe, expect, it } from "vitest";

import { contextFor, createHarness, ws } from "./helpers";

describe("CalcDocs integration", () => {
  it("evaluates YAML formulas end to end with lazy local dependencies", async () => {
    const root = ws(process.cwd(), "fixture-yaml");
    const formulas = ws(root, "formulas.yaml");
    const text = [
      "adc_counts:",
      "  value: 2048",
      "vref:",
      "  value: 3.3",
      "voltage:",
      "  formula: adc_counts * vref / 4096",
      "",
    ].join("\n");
    const harness = createHarness({ [formulas]: text }, root);

    const result = await harness.yamlFormulaEngine.evaluateDocument(
      text,
      contextFor(formulas, text, root)
    );

    const voltage = result.items.find((item) => item.id === "voltage");
    expect(voltage?.value).toBeCloseTo(1.65, 5);
    expect(result.issues).toEqual([]);
  });

  it("resolves C/C++ constants across include chains without workspace scans", async () => {
    const root = ws(process.cwd(), "fixture-cpp");
    const main = ws(root, "src/main.cpp");
    const config = ws(root, "src/config.h");
    const mainText = '#include "config.h"\n#define SAMPLE_RATE (BASE_RATE * MULTIPLIER)\n';
    const harness = createHarness(
      {
        [main]: mainText,
        [config]: "#define BASE_RATE 1000\nconst int MULTIPLIER = 4;\n",
      },
      root
    );

    const result = await harness.symbolEngine.resolve("SAMPLE_RATE", contextFor(main, mainText, root));

    expect(result.resolved?.value).toBe(4000);
    expect(harness.fileSystem.readCount).toBeLessThan(10);
  });

  it("scales across 1000 unrelated files by reading only requested include paths", async () => {
    const root = ws(process.cwd(), "fixture-large");
    const main = ws(root, "src/main.c");
    const selected = ws(root, "src/selected.h");
    const files: Record<string, string> = {
      [main]: '#include "selected.h"\n#define RESULT (SELECTED + 1)\n',
      [selected]: "#define SELECTED 99\n",
    };
    for (let index = 0; index < 1000; index += 1) {
      files[ws(root, `unrelated/file_${index}.h`)] = `#define UNUSED_${index} ${index}\n`;
    }
    const harness = createHarness(files, root);

    const result = await harness.symbolEngine.resolve(
      "RESULT",
      contextFor(main, files[main], root)
    );

    expect(result.resolved?.value).toBe(100);
    expect(harness.fileSystem.readCount).toBeLessThan(20);
  });
});
