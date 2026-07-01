import { describe, expect, it } from "vitest";

import { contextFor, createHarness, ws } from "./helpers";

describe("SymbolEngine", () => {
  it("resolves symbols from the active document first", async () => {
    const root = ws(process.cwd(), "fixture-local");
    const main = ws(root, "main.c");
    const text = "#define BASE 10\n#define TOTAL (BASE * 2)\n";
    const harness = createHarness({ [main]: text }, root);

    const result = await harness.symbolEngine.resolve("TOTAL", contextFor(main, text, root));

    expect(result.resolved?.value).toBe(20);
    expect(result.resolved?.metadata.source).toBe("active-document");
  });

  it("resolves dependencies through bounded includes", async () => {
    const root = ws(process.cwd(), "fixture-include");
    const main = ws(root, "src/main.c");
    const header = ws(root, "src/config.h");
    const mainText = '#include "config.h"\n#define TOTAL (CONFIG_VALUE + 2)\n';
    const harness = createHarness(
      {
        [main]: mainText,
        [header]: "#define CONFIG_VALUE 40\n",
      },
      root
    );

    const result = await harness.symbolEngine.resolve("TOTAL", contextFor(main, mainText, root));

    expect(result.resolved?.value).toBe(42);
    expect(result.resolved?.metadata.dependencies).toContain("CONFIG_VALUE");
  });

  it("falls back to the lazy disk file index when no active text is provided", async () => {
    const root = ws(process.cwd(), "fixture-index");
    const main = ws(root, "main.c");
    const text = "static const int GAIN = 7;\n";
    const harness = createHarness({ [main]: text }, root);

    const result = await harness.symbolEngine.resolve("GAIN", contextFor(main, undefined, root));

    expect(result.resolved?.value).toBe(7);
    expect(result.resolved?.metadata.source).toBe("file-index");
  });

  it("enforces include depth limits without exploding cycles", async () => {
    const root = ws(process.cwd(), "fixture-depth");
    const main = ws(root, "main.c");
    const a = ws(root, "a.h");
    const b = ws(root, "b.h");
    const c = ws(root, "c.h");
    const mainText = '#include "a.h"\n';
    const harness = createHarness(
      {
        [main]: mainText,
        [a]: '#include "b.h"\n',
        [b]: '#include "c.h"\n',
        [c]: "#define TOO_DEEP 9\n",
      },
      root
    );

    const result = await harness.symbolEngine.resolve("TOO_DEEP", contextFor(main, mainText, root, 2));

    expect(result.resolved).toBeUndefined();
    expect(result.issues.some((issue) => issue.code === "include-depth-limit")).toBe(true);
  });

  it("uses cached symbol results on warm paths", async () => {
    const root = ws(process.cwd(), "fixture-cache");
    const main = ws(root, "main.c");
    const text = "#define A 5\n";
    const harness = createHarness({ [main]: text }, root);
    const context = contextFor(main, text, root);

    await harness.symbolEngine.resolve("A", context);
    const before = harness.cache.getStats();
    await harness.symbolEngine.resolve("A", context);
    const after = harness.cache.getStats();

    expect(after.hits).toBeGreaterThan(before.hits);
  });
});
