// GET  /api/change?id&sig  -> the reservation's plan with post titles and the other routes
// POST /api/change {id, sig, changes} -> applies structured changes to the chosen route
//   (leave posts out, retitle a volume, switch route or interior, add a dedication), re-derives
//   pages and prices from the archive, stores the new plan, and starts a new proof.
//   {id, sig, request} -> a change in the writer's own words, relayed to a person (as before).
// Signed like the approval link (hmac "change:<id>"). The writer's words are data, never code.
import { hmacHex, dispatchPress } from "../lib/press-dispatch.js";
import { fetchArchive, armFault } from "./preview.js";
import { partition, volumePages, printCost, postId } from "../lib/editor-input.js";

export async function onRequest({ request, env }) {
  armFault(env);
  const u = new URL(request.url);
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const id = Number(u.searchParams.get("id") || body.id), sig = String(u.searchParams.get("sig") || body.sig || "");
  if (!id || !env.ARCHIVE_RELAY_TOKEN || sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `change:${id}`))
    return json({ ok: false, error: "bad link" }, 403);
  const row = await env.DB.prepare("SELECT id, publication_url, email, plan_json, created_at FROM signups WHERE id = ?").bind(id).first().catch(() => null);
  if (!row) return json({ ok: false, error: "not found" }, 404);
  let plan = null; try { plan = JSON.parse(row.plan_json || "null"); } catch {}
  const host = row.publication_url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const press = await env.DB.prepare("SELECT status, updated_at FROM press WHERE signup_id = ?").bind(id).first().catch(() => null);
  const pressDetail = await env.DB.prepare("SELECT detail FROM press WHERE signup_id = ?").bind(id).first().catch(() => null);

  if (request.method === "GET") {
    /* titles for the plan's posts, and the other routes the editor offered, from the cache */
    let titles = {}, routes = null, interiorPrices = null;
    const cached = await env.DB.prepare("SELECT payload FROM preview_cache WHERE host = ?").bind(host).first().catch(() => null);
    if (cached) { try { const pay = JSON.parse(cached.payload); routes = pay.editorial?.plan?.routes || null; } catch {} }
    if (plan && Array.isArray(plan.volumes)) {
      const r = await fetchArchive(host, env).catch(() => null);
      if (r && r.ok) for (const p of r.posts || []) titles[postId(p)] = { title: String(p.title || "").slice(0, 120), date: String(p.post_date || "").slice(0, 10), words: Number(p.wordcount) || 0, slug: String(p.slug || "") };
    }
    /* what left the book, from the last press run, plus the editor's own exclusions with reasons */
    let left_out = [];
    try { const d = JSON.parse(pressDetail?.detail || "{}"); if (Array.isArray(d.left_out)) left_out = d.left_out; } catch {}
    const slugOf = {}; for (const [pid, t] of Object.entries(titles)) if (t.slug) slugOf[pid] = t.slug;
    for (const e of (plan && Array.isArray(plan.excluded) ? plan.excluded : [])) { const t = titles[e.post_id] || {}; if (!left_out.some(x => x.slug === t.slug)) left_out.push({ slug: t.slug || String(e.post_id), title: t.title || "", reason: String(e.reason || "the editor left it out"), kind: "editor" }); }
    const included = new Set(plan && Array.isArray(plan.include) ? plan.include : []);
    left_out = left_out.map(x => ({ ...x, included: included.has(x.slug) }));
    return json({ ok: true, id, publication_url: row.publication_url, plan, titles, routes, left_out, isbn: plan?.isbn || null, status: press?.status || "reserved" });
  }
  if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  if (body.changes && typeof body.changes === "object") {
    if (!plan || !Array.isArray(plan.volumes) || !plan.volumes.length) return json({ ok: false, error: "no plan to change" }, 409);
    const ch = body.changes;
    /* the writer's own reversals of what left the book, by slug, and their ISBN (10 or 13 digits) */
    const include = (Array.isArray(ch.include) ? ch.include : []).map(x => String(x).replace(/[^a-z0-9-]/gi, "").slice(0, 200)).filter(Boolean).slice(0, 80);
    const isbnRaw = String(ch.isbn || "").replace(/[^0-9Xx]/g, "");
    const isbn = /^(97[89]\d{10}|\d{9}[0-9Xx])$/.test(isbnRaw) ? String(ch.isbn).trim().slice(0, 20) : (ch.isbn ? null : plan.isbn || null);
    if (ch.isbn && !isbn) return json({ ok: false, error: "that is not a 10- or 13-digit ISBN" }, 400);
    const r = await fetchArchive(host, env);
    if (!r.ok) return json({ ok: false, error: "could not read the archive to re-plan; try again in a minute" }, 502);
    const byId = new Map((r.posts || []).map(p => [postId(p), p]));
    const exclude = new Set((Array.isArray(ch.exclude) ? ch.exclude : []).map(Number));
    const titles = ch.titles && typeof ch.titles === "object" ? ch.titles : {};
    const interior = ch.interior === "color" ? "color" : ch.interior === "bw" ? "bw" : plan.interior;
    /* switch route: take the editor's other route from the cache, if it was offered */
    let volumes = plan.volumes;
    let cadence = plan.cadence;
    if (ch.cadence && ch.cadence !== plan.cadence) {
      const cached = await env.DB.prepare("SELECT payload FROM preview_cache WHERE host = ?").bind(host).first().catch(() => null);
      let alt = null; try { alt = JSON.parse(cached.payload).editorial.plan.routes.find(x => x.cadence === ch.cadence); } catch {}
      if (!alt) return json({ ok: false, error: "that set is not on offer any more; price it again from the site" }, 409);
      volumes = alt.volumes.map(v => ({ label: v.label, title: v.title, subtitle: v.subtitle, notes_policy: v.notes_policy, parts: v.parts, post_ids: v.post_ids }));
      cadence = ch.cadence;
    }
    const out = [];
    for (const v of volumes) {
      const ids = (v.post_ids || []).filter(pid => !exclude.has(Number(pid)));
      const posts = ids.map(pid => byId.get(Number(pid))).filter(Boolean);
      if (!ids.length) continue;
      const pages = volumePages(posts);
      out.push({ ...v, title: String(titles[v.label] || v.title || "").slice(0, 120), post_ids: ids, posts: ids.length,
        est_pages: pages, price: { bw: printCost(pages, "bw"), color: printCost(pages, "color") } });
    }
    if (!out.length) return json({ ok: false, error: "that would leave nothing to bind" }, 400);
    const fat = out.find(v => v.est_pages > 300);
    if (fat) return json({ ok: false, error: `${fat.label} would run ${fat.est_pages} pages, past the 300-page cap` }, 400);
    const newPlan = { ...plan, cadence, interior, volumes: out, dedication: String(ch.dedication || "").slice(0, 400) || plan.dedication || null,
      include, isbn,
      changed_at: new Date().toISOString(), changes: { exclude: [...exclude], include, isbn, titles, cadence: ch.cadence || null, interior: ch.interior || null } };
    await env.DB.prepare("UPDATE signups SET plan_json = ?, cadence_pref = ? WHERE id = ?").bind(JSON.stringify(newPlan).slice(0, 24000), cadence, id).run();
    await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'changed', ?, datetime('now'))
      ON CONFLICT(signup_id) DO UPDATE SET status = 'changed', detail = excluded.detail, updated_at = datetime('now')`)
      .bind(id, JSON.stringify({ changes: newPlan.changes })).run();
    const d = await dispatchPress(env, { event: "press", signup_id: id, publication_url: row.publication_url, email: row.email, plan_json: JSON.stringify(newPlan).slice(0, 60000) });
    return json({ ok: true, plan: newPlan, reproof: d.ok ? "started" : "by hand" });
  }

  const text = String(body.request || "").trim().slice(0, 4000);
  if (!text) return json({ ok: false, error: "say what should change" }, 400);
  await env.DB.prepare(`INSERT INTO press (signup_id, status, detail, updated_at) VALUES (?, 'change-requested', ?, datetime('now'))
    ON CONFLICT(signup_id) DO UPDATE SET status = 'change-requested', detail = excluded.detail, updated_at = datetime('now')`)
    .bind(id, JSON.stringify({ request: text })).run();
  await dispatchPress(env, { event: "change", signup_id: id, publication_url: row.publication_url, email: row.email, request: text });
  return json({ ok: true });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
