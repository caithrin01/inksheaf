#!/usr/bin/env node
// Contract test for the private proof store (services/proof_store.py): upload, HEAD/GET
// byte-exactness, range requests, expiry, bad signature, missing key, non-PDF and
// path-traversal rejection. Uses a throwaway 300KB PDF-shaped file under proofs/store-test/.
// Run: node scripts/test-proof-store.mjs
import { strict as assert } from "node:assert";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proofKey, uploadProof, signedProofUrl, PROOF_STORE_BASE } from "./lib/proof-store.mjs";

const dir = mkdtempSync(join(tmpdir(), "proofstore-"));
const file = join(dir, "t.pdf");
writeFileSync(file, Buffer.concat([Buffer.from("%PDF-1.4\n%store-test\n"), randomBytes(300000)]));
const size = readFileSync(file).length;
const key = proofKey("store-test", "interior", file);
let n = 0;
const ok = (name, cond, detail = "") => { n++; assert.ok(cond, name + (detail ? " :: " + detail : "")); console.log("PASS " + name); };

const up = await uploadProof(file, key);
ok("upload echoes byte count", up.bytes === size, JSON.stringify(up));
const url = signedProofUrl(key, 120);
const h = await fetch(url, { method: "HEAD" });
ok("HEAD 200 application/pdf with length", h.status === 200 && h.headers.get("content-type") === "application/pdf" && h.headers.get("content-length") === String(size));
ok("HEAD advertises byte ranges", h.headers.get("accept-ranges") === "bytes");
ok("HEAD is private, no-store", /no-store/.test(h.headers.get("cache-control") || ""));
const g = await fetch(url);
const got = Buffer.from(await g.arrayBuffer());
ok("GET returns the exact bytes", g.status === 200 && got.equals(readFileSync(file)));
const r = await fetch(url, { headers: { range: "bytes=0-99" } });
ok("range request is 206 with content-range", r.status === 206 && r.headers.get("content-range") === `bytes 0-99/${size}` && (await r.arrayBuffer()).byteLength === 100);
ok("expired URL is 403", (await fetch(signedProofUrl(key, -5))).status === 403);
ok("tampered signature is 401", (await fetch(url.replace(/sig=[0-9a-f]{6}/, "sig=000000"))).status === 401);
ok("unknown key is 404", (await fetch(signedProofUrl("proofs/store-test/i-000000000000.pdf", 60))).status === 404);

const tok = process.env.PROOF_STORE_TOKEN || readFileSync(`${process.env.HOME}/.secrets/inksheaf-proof-token`, "utf8").trim();
const bucket = Math.floor(Date.now() / 300000);
const upSig = k => createHmac("sha256", tok).update(`${k}:upload:${bucket}`).digest("hex");
const put = (k, sig, body) => fetch(`${PROOF_STORE_BASE}/upload?key=${encodeURIComponent(k)}&sig=${sig}`, { method: "PUT", body });
const k2 = "proofs/store-test/i-deadbeef0000.pdf";
ok("non-PDF body is 400", (await put(k2, upSig(k2), "not a pdf")).status === 400);
ok("unsigned upload is 401", (await put(k2, "abc", "%PDF-x")).status === 401);
ok("traversal key is 400", (await put("../etc/passwd", upSig("../etc/passwd"), "%PDF-x")).status === 400);
console.log(`PROOF STORE: ${n} checks passed`);
