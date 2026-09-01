// Client for services/proof_store.py: upload a proof PDF to the private Modal volume and
// mint expiring signed URLs for it. Token: ~/.secrets/inksheaf-proof-token or PROOF_STORE_TOKEN.
import { createHmac, createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

export const PROOF_STORE_BASE = process.env.PROOF_STORE_BASE ||
  "https://caithrin--inksheaf-proof-store-web.modal.run";

function token() {
  if (process.env.PROOF_STORE_TOKEN) return process.env.PROOF_STORE_TOKEN;
  const p = `${process.env.HOME}/.secrets/inksheaf-proof-token`;
  if (!existsSync(p)) throw new Error(`proof store token missing: ${p}`);
  return readFileSync(p, "utf8").trim();
}
const sign = message => createHmac("sha256", token()).update(message).digest("hex");

export const proofKey = (slug, kind, file) =>
  `proofs/${slug}/${kind[0]}-${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 12)}.pdf`;

export async function uploadProof(file, key) {
  const bucket = Math.floor(Date.now() / 300000);
  const url = `${PROOF_STORE_BASE}/upload?key=${encodeURIComponent(key)}&sig=${sign(`${key}:upload:${bucket}`)}`;
  const r = await fetch(url, { method: "PUT", body: readFileSync(file),
    headers: { "content-type": "application/pdf" } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.ok) throw new Error(`proof upload failed: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

export function signedProofUrl(key, ttlSeconds = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `${PROOF_STORE_BASE}/proof?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(`${key}:${exp}`)}`;
}
