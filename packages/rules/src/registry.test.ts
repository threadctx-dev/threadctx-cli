import { describe, expect, it } from "vitest";
import { RULES, validateRegistry, type RuleMeta } from "./registry.js";

// Registry-count test (spec §7.1). Update these numbers deliberately when a rule is added or removed.
const EXPECTED_TOTAL = 35;
const EXPECTED_LOCAL = 29;

describe("rule registry", () => {
  it("passes the registry contract", () => {
    expect(() => validateRegistry(RULES)).not.toThrow();
  });

  it("has the expected number of rules", () => {
    expect(RULES).toHaveLength(EXPECTED_TOTAL);
    expect(RULES.filter((r) => r.availability === "local")).toHaveLength(EXPECTED_LOCAL);
  });

  it("rejects an entry with a missing field", () => {
    const broken = { ...RULES[0], citation: "" } as RuleMeta;
    expect(() => validateRegistry([broken])).toThrow(/citation/);
  });

  it("rejects an id whose prefix does not match its family", () => {
    const broken = { ...RULES[0], family: "security" } as RuleMeta;
    expect(() => validateRegistry([broken])).toThrow(/prefix/);
  });

  it("applies the false-positive budget from the benchmark corpus", () => {
    for (const r of RULES) {
      if (r.benchmark && r.benchmark.rate >= 0.05) {
        expect(r.status, r.id).toBe("beta");
        expect(r.severity, r.id).toBe("info");
      }
      if (r.status === "ga") expect(r.benchmark!.rate, r.id).toBeLessThan(0.05);
    }
  });

  it("rejects duplicate ids", () => {
    expect(() => validateRegistry([RULES[0]!, RULES[0]!])).toThrow(/Duplicate/);
  });
});
