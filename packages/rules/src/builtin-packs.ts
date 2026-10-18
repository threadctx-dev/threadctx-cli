// Built-in heuristic rules expressed in the public pack format (docs/extending.md).
import { RULES } from "./registry.js";
import { validatePack, type Pack } from "./packs.js";

const meta = (id: string) => {
  const r = RULES.find((x) => x.id === id)!;
  return { id, title: r.title, rationale: r.rationale, citation: r.citation, remediation: r.remediation, family: r.family, severity: r.severity, determinism: r.determinism };
};

export const BUILTIN_PACKS: Pack[] = [
  validatePack(
    {
      pack: "ctx",
      description: "Built-in heuristic rules",
      rules: [
        {
          ...meta("CTX-B003"),
          match: {
            minPerArtifact: 3,
            any: [
              "\\bwrite (clean|readable|maintainable|high[- ]quality|good) code\\b",
              "\\bfollow (the |industry |coding )?best practices\\b",
              "\\buse (clear|meaningful|descriptive) (variable |function )?names\\b",
              "\\bkeep (functions|methods|code|things) (small|simple|short|clean|focused)\\b",
              "\\b(add|write) (good |proper |helpful |clear )?comments\\b",
              "\\bfollow (the )?(SOLID|DRY|KISS|YAGNI) principles?\\b",
              "\\bhandle errors (properly|gracefully|appropriately)\\b",
              "\\bwrite (unit )?tests for (all|your|new) code\\b",
              "\\bbe consistent\\b",
              "\\byou are an? (expert|senior|world[- ]class|experienced)\\b",
              "\\bthink step[- ]by[- ]step\\b",
              "\\bensure (the )?code is (well[- ]documented|readable|maintainable|clean)\\b",
            ],
          },
        },
        {
          ...meta("CTX-X004"),
          match: {
            kinds: ["instructions", "rule", "skill", "subagent", "command"],
            any: [
              "\\b(use|using|with|pass|add|run)\\s+`?--no-verify\\b",
              "\\bgit (commit|push)\\b[^\\n`]*--no-verify\\b",
              "\\b(don't|do not|never) (tell|inform|notify|alert) (the )?user\\b",
              "\\bwithout (telling|informing|notifying) (the )?user\\b",
              "\\bhide (this|these|the|your|any) (changes?|edits?|commits?|actions?) from\\b",
              "\\bignore (all )?(previous|prior|above|earlier) instructions\\b",
              "\\b(disable|turn off|bypass|circumvent) (the |all |any )?(branch protection|pre-commit hooks?|ci checks?|required checks|code review|safety checks?|guardrails?)\\b",
              "\\bskip (the |all |any )?(tests?|ci|checks?|hooks?|code review) (and|then) (commit|push|merge)\\b",
            ],
          },
        },
      ],
    },
    "builtin:ctx",
    true,
  ),
];
