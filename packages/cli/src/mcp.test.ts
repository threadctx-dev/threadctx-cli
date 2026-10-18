import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confine, handleMessage } from "./mcp.js";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "tctx-mcp-"));
  const put = (p: string, c: string) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  };
  put("package.json", JSON.stringify({ scripts: { test: "vitest" } }));
  put("pnpm-lock.yaml", "");
  put("AGENTS.md", "- Install: `npm install`\n- See `docs/gone.md`\n");
  put("CLAUDE.md", "- hi‮evil\n");
  put("src/a.ts", "");
  return dir;
}

const call = (root: string, name: string, args: Record<string, unknown>) =>
  handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, root) as { result: { isError?: boolean; content: { text: string }[] } };

describe("mcp", () => {
  const root = project();

  it("initialises, echoing a supported protocol version and falling back for unknown ones", () => {
    const init = (v: string) => handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v } }, root) as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: object } } };
    expect(init("2025-03-26").result.protocolVersion).toBe("2025-03-26");
    expect(init("2099-01-01").result.protocolVersion).toBe("2025-06-18");
    expect(init("2025-06-18").result.serverInfo.name).toBe("threadctx");
  });

  it("lists three read-only tools with LLM-oriented descriptions", () => {
    const r = handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, root) as { result: { tools: { name: string; description: string; annotations: { readOnlyHint: boolean } }[] } };
    expect(r.result.tools.map((t) => t.name)).toEqual(["check_context", "get_effective_context", "explain_rule"]);
    expect(r.result.tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
    expect(r.result.tools[0]!.description).toMatch(/Call this after you edit/);
  });

  it("check_context grades the project", () => {
    const text = call(root, "check_context", {}).result.content[0]!.text;
    expect(text).toMatch(/^Grade [A-F] \(\d+\/100\)/);
    expect(text).toContain("CTX-X001");
    expect(text).toContain("CTX-D003");
  });

  it("get_effective_context shows layers per tool", () => {
    const text = call(root, "get_effective_context", { file: "src/a.ts", tool: "claude-code" }).result.content[0]!.text;
    expect(text).toContain("Claude Code");
    expect(text).toContain("CLAUDE.md");
  });

  it("explain_rule explains and reports unknown ids as tool errors", () => {
    expect(call(root, "explain_rule", { id: "ctx-x001" }).result.content[0]!.text).toContain("Invisible");
    const bad = call(root, "explain_rule", { id: "nope" }).result;
    expect(bad.isError).toBe(true);
  });

  it("refuses paths outside the project, including through symlinks", () => {
    const outside = mkdtempSync(join(tmpdir(), "tctx-outside-"));
    writeFileSync(join(outside, "AGENTS.md"), "secret");
    symlinkSync(outside, join(root, "link"));
    for (const p of ["../", "/etc", "link", "src/../../"]) {
      const r = call(root, "check_context", { path: p }).result;
      expect(r.isError, p).toBe(true);
      expect(r.content[0]!.text).toMatch(/outside the project/);
    }
    expect(() => confine(root, ".")).not.toThrow();
  });

  it("protocol errors: unknown method, unknown tool, malformed message; notifications get no reply", () => {
    expect((handleMessage({ jsonrpc: "2.0", id: 3, method: "nope" }, root) as { error: { code: number } }).error.code).toBe(-32601);
    expect((handleMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rm_rf" } }, root) as { error: { code: number } }).error.code).toBe(-32602);
    expect((handleMessage({ nonsense: true }, root) as { error: { code: number } }).error.code).toBe(-32600);
    expect(handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, root)).toBeUndefined();
  });

  it("speaks newline-delimited JSON-RPC over stdio with the real binary", async () => {
    const bin = join(dirname(fileURLToPath(import.meta.url)), "../dist/bin.js");
    const child = spawn("node", [bin, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_context", arguments: {} } });
    child.stdin.write("{broken json\n");
    child.stdin.end();
    await new Promise((r) => child.on("close", r));
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(3); // initialize, tools/call, parse error: the notification is silent
    expect(lines[0].result.serverInfo.name).toBe("threadctx");
    expect(lines[1].result.content[0].text).toMatch(/^Grade/);
    expect(lines[2].error.code).toBe(-32700);
  });
});
