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

// Private worker recovery bundles use a distinct route and purpose-bound HMAC.
// They are never returned as proof links or exposed through the reader.
export function checkpointStore(owner,{fetchImpl=fetch}={}){
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(owner))throw Error('Invalid checkpoint owner');
  const key=sha=>{if(!/^[a-f0-9]{64}$/.test(sha))throw Error('Invalid checkpoint hash');return `checkpoints/${owner}/${sha}.json.gz`;};
  return {
    async put(sha,bytes){
      const name=key(sha),bucket=Math.floor(Date.now()/300000);
      const r=await fetchImpl(`${PROOF_STORE_BASE}/checkpoint?key=${encodeURIComponent(name)}&sig=${sign(`${name}:checkpoint-upload:${bucket}`)}`,{method:'PUT',body:bytes,headers:{'content-type':'application/gzip'},signal:AbortSignal.timeout(120000)});
      const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok||j.sha256!==sha)throw Error('Completed PDF could not be saved for worker recovery.');
    },
    async get(sha){
      const name=key(sha),exp=Math.floor(Date.now()/1000)+300;
      const r=await fetchImpl(`${PROOF_STORE_BASE}/checkpoint?key=${encodeURIComponent(name)}&exp=${exp}&sig=${sign(`${name}:checkpoint-read:${exp}`)}`,{signal:AbortSignal.timeout(120000)});
      if(!r.ok||Number(r.headers.get('content-length'))>150_000_000)throw Error('Saved PDF recovery is unavailable; its allowances remain spent.');
      const chunks=[];let size=0;
      for await(const chunk of r.body){size+=chunk.length;if(size>150_000_000)throw Error('Saved PDF recovery exceeds its size limit.');chunks.push(chunk);}
      return Buffer.concat(chunks);
    },
  };
}
