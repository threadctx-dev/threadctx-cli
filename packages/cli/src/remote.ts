import { execFileSync } from "node:child_process";

export { fetchScannableRepo as fetchRemoteRepo } from "@threadctx/adapters";
export { listOrgRepos, pool, type ListOptions, type OrgRepo, type RemoteRepo } from "@threadctx/discovery";

export function githubToken(env: NodeJS.ProcessEnv): string | undefined {
  if (env.GH_TOKEN || env.GITHUB_TOKEN) return env.GH_TOKEN ?? env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}
