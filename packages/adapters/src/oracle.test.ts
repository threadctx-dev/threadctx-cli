// Oracle tests (spec §6.5): fixtures whose loaded context was recorded from the real tool.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openRepo } from "@threadctx/discovery";
import { buildCatalog, getAdapter } from "./index.js";

const ORACLE = fileURLToPath(new URL("../../../fixtures/oracle/", import.meta.url));

describe("oracle: claude-code startup", () => {
  const dir = `${ORACLE}claude-code/startup`;
  const expected = JSON.parse(readFileSync(`${dir}/expected.json`, "utf8")) as { expectedLoaded: string[]; expectedAbsent: string[] };
  const catalog = buildCatalog(openRepo(dir));
  const ctx = getAdapter("claude-code")!.resolve({ path: "__root__", isDir: false }, catalog);
  const loaded = ctx.layers
    .filter((l) => l.loading === "always")
    .flatMap((l) => catalog.get(l.path)!.loadedText.match(/ORACLE-[A-Z0-9-]+/g) ?? []);
  const predicted = [...new Set(loaded)].sort();

  it("predicts exactly the tokens recorded from every observed Claude Code version", () => {
    for (const f of readdirSync(dir).filter((x) => x.startsWith("observed-"))) {
      const observed = readFileSync(`${dir}/${f}`, "utf8").split("\n").filter(Boolean).sort();
      expect(predicted, f).toEqual(observed);
    }
  });
  it("matches the fixture's documented expectation", () => {
    expect(predicted).toEqual(expected.expectedLoaded);
    for (const t of expected.expectedAbsent) expect(predicted).not.toContain(t);
  });
});
