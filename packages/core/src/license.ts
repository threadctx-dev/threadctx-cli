// Offline-verifiable licences. A licence is `tctx1.<payload>.<signature>`: a JSON payload and an
// Ed25519 signature over it, both base64url. The CLI embeds only the public key, so verifying a
// licence needs no network and the private key never ships.
import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

/** Production public key. The matching private key lives only in the licence-issuing service. */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjxD7a4Ug5yVw5+Ra8bY1IZVLobxeiCS9dtrVwekYjqw=
-----END PUBLIC KEY-----
`;

export type LicensePlan = "audit" | "team" | "business" | "agency";
export const LICENSE_PLANS: readonly LicensePlan[] = ["audit", "team", "business", "agency"];

export interface LicenseClaims {
  v: 1;
  plan: LicensePlan;
  /** GitHub organisation or user login the licence unlocks, lowercase; "*" for any. */
  org: string;
  /** Issued at and expiry, unix seconds. */
  iat: number;
  exp: number;
  /** Unique id, so a leaked key can be traced to its order. */
  id: string;
  /** Most repositories with agent context the licence covers in one audit. Absent: no limit. */
  agentRepoLimit?: number;
  /** Agency: the organisations the licence covers (lowercase). When present, `org` is "*". */
  orgs?: string[];
}

export type LicenseCheck =
  | { ok: true; claims: LicenseClaims }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" | "wrong-org" | "unsupported" };

const PREFIX = "tctx1";
const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface SignInput {
  plan: LicensePlan;
  org: string;
  /** Validity in days from `now`. */
  days: number;
  now?: Date;
  /** Fixed id, so the same order always yields the same key (Ed25519 signing is deterministic). */
  id?: string;
  agentRepoLimit?: number;
  orgs?: string[];
}

/** Issue a licence. Called only by the service that holds the private key. */
export function signLicense(input: SignInput, privateKeyPem: string): string {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: LicenseClaims = { v: 1, plan: input.plan, org: input.org.trim().toLowerCase(), iat, exp: iat + Math.round(input.days * 86400), id: input.id ?? randomBytes(8).toString("hex") };
  if (input.agentRepoLimit !== undefined) claims.agentRepoLimit = input.agentRepoLimit;
  if (input.orgs?.length) claims.orgs = [...new Set(input.orgs.map((o) => o.trim().toLowerCase()).filter(Boolean))].sort();
  const payload = b64u(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(`${PREFIX}.${payload}`), createPrivateKey(privateKeyPem));
  return `${PREFIX}.${payload}.${b64u(signature)}`;
}

export interface VerifyOptions {
  /** Organisation the caller wants to unlock. Omit to skip the organisation check. */
  org?: string;
  now?: Date;
  /** Override the public key (tests). */
  publicKey?: string;
}

/** Never throws: any garbage input is simply `malformed`. */
export function verifyLicense(key: string, opts: VerifyOptions = {}): LicenseCheck {
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: "malformed" };
  let claims: LicenseClaims;
  try {
    const valid = verify(null, Buffer.from(`${PREFIX}.${parts[1]}`), createPublicKey(opts.publicKey ?? LICENSE_PUBLIC_KEY), Buffer.from(parts[2]!, "base64url"));
    if (!valid) return { ok: false, reason: "bad-signature" };
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as LicenseClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.v !== 1 || typeof claims.exp !== "number" || typeof claims.org !== "string" || !LICENSE_PLANS.includes(claims.plan)) return { ok: false, reason: "unsupported" };
  if (claims.agentRepoLimit !== undefined && (!Number.isInteger(claims.agentRepoLimit) || claims.agentRepoLimit < 1)) return { ok: false, reason: "unsupported" };
  if (claims.orgs !== undefined && (!Array.isArray(claims.orgs) || claims.orgs.some((o) => typeof o !== "string"))) return { ok: false, reason: "unsupported" };
  if (claims.exp * 1000 < (opts.now ?? new Date()).getTime()) return { ok: false, reason: "expired" };
  const want = opts.org?.trim().toLowerCase();
  if (want && claims.orgs?.length && !claims.orgs.includes(want)) return { ok: false, reason: "wrong-org" };
  if (want && !claims.orgs?.length && claims.org !== "*" && claims.org !== want) return { ok: false, reason: "wrong-org" };
  return { ok: true, claims };
}

export const LICENSE_PROBLEM: Record<Exclude<LicenseCheck, { ok: true }>["reason"], string> = {
  malformed: "is not a valid threadctx licence",
  "bad-signature": "was not issued by threadctx (signature check failed)",
  expired: "has expired",
  "wrong-org": "is for a different GitHub organisation",
  unsupported: "is for a newer or unknown plan; update threadctx",
};
