import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real bug found, not theoretical: with the default "threads" pool, a
    // vi.spyOn(Math, "random") mock from one test file (e.g. flora.test.ts
    // or needs.test.ts) can intermittently leak into another (reproduction.test.ts)
    // when vitest schedules both onto the same worker thread — reproducible
    // ~50% of the time running just those two files together, completely
    // independent of any code change. "forks" runs each test file in its
    // own OS process, which can't share JS globals like Math at all.
    pool: "forks",
  },
});
