import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  // Tests run against sources, never stale dist/ builds.
  resolve: {
    alias: Object.fromEntries(["core", "discovery", "adapters", "rules", "report"].map((n) => [`@threadctx/${n}`, pkg(n)])),
  },
  test: { include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"], testTimeout: 30_000 },
});
