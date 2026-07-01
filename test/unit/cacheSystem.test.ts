import { describe, expect, it } from "vitest";

import { CacheSystem } from "../../src/cache/CacheSystem";

describe("CacheSystem", () => {
  it("tracks hits and misses", () => {
    const cache = new CacheSystem({ memoryLimitBytes: 1024, maxEntries: 10 });

    expect(cache.get("missing")).toBeUndefined();
    cache.set("answer", { value: 42 }, ["main.c"]);
    expect(cache.get<{ value: number }>("answer")?.value).toBe(42);

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
  });

  it("evicts least recently used entries", () => {
    const cache = new CacheSystem({ memoryLimitBytes: 1024 * 1024, maxEntries: 2 });

    cache.set("a", "A");
    cache.set("b", "B");
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.getStats().evictions).toBe(1);
  });

  it("invalidates entries associated with a file", () => {
    const cache = new CacheSystem({ memoryLimitBytes: 1024 * 1024, maxEntries: 10 });

    cache.set("symbol::A::main.c", 1, ["main.c"]);
    cache.invalidateFile("main.c");

    expect(cache.get("symbol::A::main.c")).toBeUndefined();
  });
});
