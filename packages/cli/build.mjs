// Bundle the CLI and every workspace and third-party dependency into one file with zero runtime dependencies.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/threadctx.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __tctxCreateRequire } from 'node:module';\nconst require = __tctxCreateRequire(import.meta.url);" },
});
chmodSync("dist/threadctx.mjs", 0o755);
const size = Math.round(readFileSync("dist/threadctx.mjs").length / 1024);
console.log(`dist/threadctx.mjs ${size} kB`);

// Bundled third-party code keeps its licence notice (required by their licences).
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
const store = new URL("../../node_modules/.pnpm/", import.meta.url).pathname;
const wanted = ["yaml", "picomatch", "ignore", "diff"];
const parts = ["# Third-party software bundled in threadctx\n"];
for (const name of wanted) {
  const dir = readdirSync(store).find((d) => d.startsWith(`${name}@`));
  if (!dir) throw new Error(`bundled dependency ${name} not found in node_modules`);
  const root = join(store, dir, "node_modules", name);
  const found = readdirSync(root).find((f) => /^(licen[cs]e|copying)(\.|-|$)/i.test(f));
  const file = found ? join(root, found) : undefined;
  const meta = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!file) throw new Error(`no licence file for ${name}`);
  parts.push(`\n## ${name} ${meta.version} (${meta.license})\n\n${readFileSync(file, "utf8").trim()}\n`);
}
writeFileSync("THIRD_PARTY_LICENSES.md", parts.join(""));
console.log("THIRD_PARTY_LICENSES.md written");
