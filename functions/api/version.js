// The immutable edition version (Codex audit P0-1).
// POST /api/version  {signup_id, sig: hmac("version:<id>"), plan_json, post_ids, body_hashes,
//   renderer_sha, print_mode, volumes, proof_key, proof_sha256, pages}
//   -> {ok, version_id, nonce}. Older versions of the same reservation become "superseded".
// GET  /api/version?id=<version>&sig=hmac("version:<signup>")  -> the version, for the press.
// The nonce is the single-use token the approval link carries; approval consumes it.
import { hmacHex } from "../lib/press-dispatch.js";

export async function onRequest({ request, env }) {
  const u = new URL(request.url);
  if (request.method === "GET") {
    const vid = Number(u.searchParams.get("id")), sig = String(u.searchParams.get("sig") || "");
    const v = await env.DB.prepare("SELECT * FROM edition_versions WHERE id = ?").bind(vid).first().catch(() => null);
    if (!v) return json({ ok: false, error: "not found" }, 404);
    if (!env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `version:${v.signup_id}`)) return json({ ok: false, error: "bad signature" }, 403);
    const { approval_nonce, ...safe } = v;
    return json({ ok: true, version: safe });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  if (Number(request.headers.get("content-length") || 0) > 512_000) return json({ ok: false, error: "too large" }, 413);
  let b; try { b = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
  const id = Number(b.signup_id);
  if (!id || !env.ARCHIVE_RELAY_TOKEN || String(b.sig || "") !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `version:${id}`)) return json({ ok: false, error: "bad signature" }, 403);
  const need = ["plan_json", "post_ids", "body_hashes", "renderer_sha", "print_mode", "volumes", "proof_key", "proof_sha256", "pages"];
  for (const k of need) if (b[k] == null || b[k] === "") return json({ ok: false, error: `${k} required` }, 400);
  if (!/^[0-9a-f]{64}$/.test(String(b.proof_sha256))) return json({ ok: false, error: "proof_sha256 must be a sha256 hex" }, 400);
  if (!["bw", "color"].includes(b.print_mode)) return json({ ok: false, error: "print_mode" }, 400);
  const nonce = [...crypto.getRandomValues(new Uint8Array(18))].map(x => x.toString(16).padStart(2, "0")).join("");
  const str = x => typeof x === "string" ? x : JSON.stringify(x);
  await env.DB.prepare("UPDATE edition_versions SET status = 'superseded', updated_at = datetime('now') WHERE signup_id = ? AND status IN ('proofed')").bind(id).run().catch(() => {});
  const r = await env.DB.prepare(`INSERT INTO edition_versions (signup_id, plan_json, post_ids, body_hashes, renderer_sha, print_mode, volumes, proof_key, proof_sha256, pages, status, approval_nonce, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proofed', ?, ?)`)
    .bind(id, str(b.plan_json).slice(0, 60000), str(b.post_ids).slice(0, 60000), str(b.body_hashes).slice(0, 200000), String(b.renderer_sha).slice(0, 64), b.print_mode, str(b.volumes).slice(0, 20000),
      String(b.proof_key).slice(0, 300), String(b.proof_sha256), Number(b.pages) || 0, nonce, String(b.run_id || "").slice(0, 40)).run();
  const version_id = r.meta?.last_row_id;
  await env.DB.prepare("UPDATE signups SET plan_json = ? WHERE id = ?").bind(str(b.plan_json).slice(0, 60000), id).run().catch(() => {}); /* the plan the version was built from is the reservation's plan */
  return json({ ok: true, version_id, nonce });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
