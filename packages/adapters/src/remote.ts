import { fetchRemoteRepo, type FetchOptions, type RemoteRepo } from "@threadctx/discovery";
import type { FsView } from "@threadctx/core";
import { buildCatalog } from "./catalog.js";
import { resolveImport } from "./common.js";

/** Files that context artifacts import (`@path`), resolved to repo-relative paths. */
export function importTargets(view: FsView): string[] {
  const out = new Set<string>();
  for (const a of buildCatalog(view).artifacts) {
    for (const imp of a.imports) {
      const r = resolveImport(a.artifact.path, imp.path);
      if (r) out.add(r);
    }
  }
  return [...out];
}

/** Fetch a GitHub repository ready to scan: context files, manifests and everything they import. */
export function fetchScannableRepo(fullName: string, opts: Omit<FetchOptions, "followImports"> = {}): Promise<RemoteRepo> {
  return fetchRemoteRepo(fullName, { ...opts, followImports: importTargets });
}
