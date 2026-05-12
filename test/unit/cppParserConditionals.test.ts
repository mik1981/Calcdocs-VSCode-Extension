import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { collectDefinesAndConsts } from "../../src/core/cppParser";
import {
  buildCompositeExpressionPreview,
  createSymbolResolutionStats,
  resolveSymbol,
} from "../../src/core/expression";

async function withTempWorkspace<T>(
  run: (workspaceRoot: string) => Promise<T>
): Promise<T> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "calcdocs-cpp-conditionals-"));
  try {
    return await run(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

describe("conditional C/C++ symbol collection", () => {
  it("continues collecting symbols after include guards and active else branches", async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const srcDir = path.join(workspaceRoot, "src");
      const incDir = path.join(workspaceRoot, "inc");
      await mkdir(srcDir, { recursive: true });
      await mkdir(incDir, { recursive: true });

      await writeFile(
        path.join(incDir, "test.h"),
        [
          "#ifndef __TEST_H",
          "#define __TEST_H",
          "#define ADC_RES (0x0000400U)",
          "#define VEL (24)",
          "#endif",
          "",
        ].join("\n"),
        "utf8"
      );

      const sourcePath = path.join(srcDir, "test.c");
      await writeFile(
        sourcePath,
        [
          '#include "test.h"',
          "#if !defined(__TEST_H)",
          "#define SHOULD_SKIP 1",
          "#else",
          "#define MUL (2<<1)",
          "#define FINAL (VEL * MUL)",
          "#define MULTIPLE_CONDITION_TEST (4*ADC_RES)",
          "#define PT100_OHM_MIN (58.93)",
          "#define PT100_TOT_AMPL (0.000974 * 32.44192581 / 5.0)",
          "#define PT100_NUM16(R) (signed int)(0.5 + ( R - PT100_OHM_MIN ) * PT100_TOT_AMPL * 65536.0 )",
          "#define PT100_100OHM PT100_NUM16(100)",
          "#endif",
          "",
        ].join("\n"),
        "utf8"
      );

      const collected = await collectDefinesAndConsts(
        [sourcePath],
        workspaceRoot,
        { resolveIncludes: true }
      );
      const symbolValues = new Map<string, number>(collected.consts);
      const resolved = new Map<string, number>();
      const stats = createSymbolResolutionStats();

      for (const name of collected.defines.keys()) {
        resolveSymbol(
          name,
          collected.defines,
          collected.functionDefines,
          resolved,
          symbolValues,
          {},
          stats,
          new Set<string>(),
          collected.defineConditions
        );
      }

      expect(collected.defines.has("SHOULD_SKIP")).toBe(false);
      expect(symbolValues.get("MUL")).toBe(4);
      expect(symbolValues.get("FINAL")).toBe(96);
      expect(symbolValues.get("MULTIPLE_CONDITION_TEST")).toBe(4096);
      expect(symbolValues.get("PT100_100OHM")).toBe(17010);

      expect(
        buildCompositeExpressionPreview(
          "5 * MUL",
          symbolValues,
          collected.defines,
          collected.functionDefines,
          {},
          collected.defineConditions
        ).value
      ).toBe(20);
      expect(
        buildCompositeExpressionPreview(
          "PT100_NUM16(100)",
          symbolValues,
          collected.defines,
          collected.functionDefines,
          {},
          collected.defineConditions
        ).value
      ).toBe(17010);
    });
  });
});
