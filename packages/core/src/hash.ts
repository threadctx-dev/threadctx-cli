import { createHash } from "node:crypto";

/** Normalise bytes before hashing so line endings and a BOM never change identity. */
export function normalizeContent(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function contentHash(text: string): string {
  return `sha256:${sha256(normalizeContent(text))}`;
}

export function artifactId(tool: string, path: string): string {
  return sha256(`${tool}\u0000${path}`).slice(0, 16);
}

/** Deterministic JSON with sorted keys, for hashes over structured data. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
