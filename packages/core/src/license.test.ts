import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LICENSE_PUBLIC_KEY, signLicense, verifyLicense } from "./license.js";

const pair = generateKeyPairSync("ed25519");
const priv = pair.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const pub = pair.publicKey.export({ type: "spki", format: "pem" }) as string;
const NOW = new Date("2026-10-05T12:00:00Z");

describe("licence limits and agency organisations", () => {
  it("carries an agent-repository limit and keeps old keys (no limit) unlimited", () => {
    const k = signLicense({ plan: "team", org: "acme", days: 365, now: NOW, agentRepoLimit: 50 }, priv);
    const r = verifyLicense(k, { publicKey: pub, org: "acme", now: NOW });
    expect(r.ok && r.claims.agentRepoLimit).toBe(50);
    const old = verifyLicense(signLicense({ plan: "team", org: "acme", days: 30, now: NOW }, priv), { publicKey: pub, now: NOW });
    expect(old.ok && old.claims.agentRepoLimit).toBeUndefined();
  });

  it("an agency licence unlocks only its listed organisations", () => {
    const k = signLicense({ plan: "agency", org: "*", days: 365, now: NOW, orgs: ["Client-A", "client-b", "client-a"] }, priv);
    const ok = verifyLicense(k, { publicKey: pub, org: "CLIENT-A", now: NOW });
    expect(ok.ok && ok.claims.orgs).toEqual(["client-a", "client-b"]);
    expect(verifyLicense(k, { publicKey: pub, org: "someone-else", now: NOW })).toEqual({ ok: false, reason: "wrong-org" });
  });
});

describe("licence", () => {
  const key = signLicense({ plan: "audit", org: "Acme", days: 30, now: NOW }, priv);

  it("verifies offline and normalises the organisation", () => {
    const r = verifyLicense(key, { publicKey: pub, org: "ACME", now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims).toMatchObject({ plan: "audit", org: "acme", v: 1 });
  });

  it("rejects the wrong organisation, expiry, tampering and other keys", () => {
    expect(verifyLicense(key, { publicKey: pub, org: "other", now: NOW })).toEqual({ ok: false, reason: "wrong-org" });
    expect(verifyLicense(key, { publicKey: pub, now: new Date("2026-12-01T00:00:00Z") })).toEqual({ ok: false, reason: "expired" });
    const [p, payload, sig] = key.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, "base64url").toString()), org: "*" })).toString("base64url");
    expect(verifyLicense(`${p}.${forged}.${sig}`, { publicKey: pub, now: NOW })).toEqual({ ok: false, reason: "bad-signature" });
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) as string;
    expect(verifyLicense(key, { publicKey: other, now: NOW })).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("a fixed id makes issuing repeatable, so a lost key can be re-derived from the order", () => {
    const a = signLicense({ plan: "audit", org: "acme", days: 30, now: NOW, id: "order-1" }, priv);
    const b = signLicense({ plan: "audit", org: "acme", days: 30, now: NOW, id: "order-1" }, priv);
    expect(a).toBe(b);
    expect(signLicense({ plan: "audit", org: "acme", days: 30, now: NOW, id: "order-2" }, priv)).not.toBe(a);
  });

  it("never throws on garbage", () => {
    for (const junk of ["", "abc", "tctx1.a.b", "tctx1..", "x.y.z", "tctx1.%%%.%%%", "tctx1.e30.AAAA"]) {
      expect(verifyLicense(junk, { publicKey: pub }).ok).toBe(false);
    }
  });

  it("a wildcard licence unlocks any organisation", () => {
    const any = signLicense({ plan: "team", org: "*", days: 1, now: NOW }, priv);
    expect(verifyLicense(any, { publicKey: pub, org: "whoever", now: NOW }).ok).toBe(true);
  });

  it("the embedded production public key matches the private key held outside the repo", () => {
    let privatePem: string;
    try {
      privatePem = readFileSync(join(homedir(), ".threadctx-signing", "license-private.pem"), "utf8");
    } catch {
      return; // CI and other machines do not have the signing key, which is the point
    }
    const k = signLicense({ plan: "audit", org: "acme", days: 1, now: NOW }, privatePem);
    expect(verifyLicense(k, { publicKey: LICENSE_PUBLIC_KEY, now: NOW }).ok).toBe(true);
  });
});
