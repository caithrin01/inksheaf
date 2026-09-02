// The editor: one Claude call that plans an edition, checked by plan-check, with one retry
// carrying the failing rules, and a calendar fallback so the page never depends on the model.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EditorialPlan, PLAN_VERSION, KINDS } from "./editor-schema.js";
import { buildEditorInput, KIND_HINTS, volumePages, rawPages, printCost, postId } from "./editor-input.js";
import { checkPlan } from "./plan-check.js";

export const EDITOR_MODEL = "claude-opus-5";
/* Caithrin's account is OpenRouter (2026-09-02): the Anthropic SDK speaks to it through its
   Anthropic-compatible endpoint, structured output included, at the same price. An Anthropic
   key still works when present. */
export function editorClient({ apiKey, openrouterKey } = {}) {
  const or = openrouterKey || (typeof process !== "undefined" ? process.env?.OPENROUTER_API_KEY : undefined);
  const an = apiKey || (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (an) return { client: new Anthropic({ apiKey: an }), model: EDITOR_MODEL, via: "anthropic" };
  if (or) return { client: new Anthropic({ baseURL: "https://openrouter.ai/api", apiKey: or, defaultHeaders: { "HTTP-Referer": "https://inksheaf.com", "X-Title": "Inksheaf editor" } }), model: "anthropic/" + EDITOR_MODEL, via: "openrouter" };
  return null;
}

export const SYSTEM = `You are the editor at Inksheaf. A writer has pasted their Substack. From the archive rows and the window you are given, plan their printed edition: a 6x9 perfect-bound book or set, at cost, for the writer and their readers.

You decide judgment, not arithmetic. Pages and prices are computed from your post assignments by the same formula you are shown; do not state them. Every public post in the window is either bound in every route or listed once in "excluded" with a plain reason. Never bind a post from the quarter in progress.

Routes: offer the golden route first and mark it recommended, then the alternatives that bind. Volume labels come only from the window's period labels you are given; when a period is too thin (under the minimum pages) fold it into its neighbour and join the two labels with " – " (a half-year label when two quarters make one). When a period is too fat (over the cap), that cadence is infeasible unless a finer cadence exists; say so in "infeasible" with the page count in words. A single volume is only offered when the whole window binds under the cap.

A cadence whose volumes would number fewer than two is never a route; list it in "infeasible" with the reason. A folded label such as "Sep 2025 – Oct 2025" must not sit beside a volume for the same period.

When the window holds no public posts but "paid_posts_in_window" is above zero, say so plainly to the writer: their posts are for paid subscribers, the preview can only read public ones, and a Substack export is the way in; never say the archive came through empty. When the window holds nothing at all, say the archive has no public posts in the window.

When the input says "compact": true (over 150 posts), do not list post ids: give each volume its "periods" by the window's labels and leave "post_ids" empty; name exclusions by id only when you have a reason. Use "by_month" (posts, words, estimated pages, footnotes, images, bylines per month) to shape the volumes.

When the window's label is "Everything so far" (a publication younger than a quarter), the only route is a single volume with that label; offer no other cadence.

Before offering a route, check every volume's size against "by_month": a volume under 32 estimated pages is never offered; fold it into a neighbour (join the labels with " – ") or leave that cadence out of "routes" with the reason. Every volume has a label from the window's labels; never an empty label. Contributors come only from the bylines in the rows; when a row has no byline, name no one for it, and never use the publication's name as a person.

Kinds: ${KIND_HINTS}. Contributors: everyone with a byline, principal first. The input's "cut_by_rule" posts are already out (cross-posts, threads, podcasts): never list them. Its "flagged_for_judgement" posts carry a signal (a Mailbag tag, a housekeeping-shaped slug, under 200 words): decide each on its words and title, keep the essays, exclude the housekeeping with the reason. Notes policy per volume from the footnote counts. Interior: colour only when the images carry the writing (recipes, photo essays, illustrated posts); otherwise black and white, and say why in one sentence.

Sentences are for the writer, plain and specific, no flattery, no exclamation marks. British or American spelling as the writer uses.`;

export function calendarFallback(input) {
  // Deterministic plan by the calendar: every cadence, volumes over the cap split into
  // months and then into parts at a post boundary, thin volumes folded into the previous
  // one, and the first cadence that binds is recommended (single, half, quarterly, monthly).
  const w = input._partition.window;
  const posts = [...input._partition.inWindow].sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));
  const name = input.publication.name;
  const inPeriod = (p, from, to) => { const d = String(p.post_date).slice(0, 10); return d >= from && d < to; };
  const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
  const vol = (label, subtitle, ps, why) => ({ label, title: name, subtitle, post_ids: ps.map(postId), periods: [], parts: null, notes_policy: "endnotes_per_article", why, _posts: ps });
  const pages = ps => volumePages(ps);
  /* split a period's posts into parts under the cap, at post boundaries */
  const splitParts = (label, span, ps) => {
    if (pages(ps) <= 300) return [vol(label, span, ps, "The period's posts in order.")];
    /* more parts until every part binds; posts are uneven, so a pure page ratio can leave one fat */
    for (let n = Math.ceil(pages(ps) / 300); n <= Math.min(ps.length, 12); n++) {
      const out = []; let i = 0;
      for (let k = 0; k < n && i < ps.length; k++) {
        const take = k === n - 1 ? ps.length - i : Math.ceil((ps.length - i) / (n - k));
        out.push(vol(`${label} · ${ROMAN[k] || k + 1}`, span, ps.slice(i, i + take), `${label} runs about ${pages(ps)} pages, so it is bound in ${n} parts, split at a post boundary.`));
        i += take;
      }
      if (out.every(v => pages(v._posts) <= 300)) return out;
    }
    return [vol(label, span, ps, "Over the cap even in parts.")];
  };
  const fold = vols => {
    const out = [];
    for (const v of vols) {
      if (!v._posts.length) continue;
      const prev = out[out.length - 1];
      if (prev && rawPages(v._posts) < 32 && pages([...prev._posts, ...v._posts]) <= 300) {
        prev.label = prev.label.split(" – ")[0] + " – " + v.label; prev._posts = [...prev._posts, ...v._posts]; prev.post_ids = prev._posts.map(postId);
        prev.subtitle = prev.subtitle.split(" – ")[0] + " – " + v.subtitle; prev.why = "Folded with a thin neighbour to reach the 32-page minimum.";
      } else out.push(v);
    }
    /* a thin first volume folds forward into the next */
    if (out.length > 1 && rawPages(out[0]._posts) < 32 && pages([...out[0]._posts, ...out[1]._posts]) <= 300) {
      const a = out.shift(); const b = out[0];
      b.label = a.label + " – " + b.label; b.subtitle = a.subtitle + " – " + b.subtitle; b._posts = [...a._posts, ...b._posts]; b.post_ids = b._posts.map(postId);
      b.why = "Folded with a thin neighbour to reach the 32-page minimum.";
    }
    return out;
  };
  const build = (cadence, periods) => fold(periods.flatMap(pd => splitParts(pd.label, pd.span || pd.label, posts.filter(p => inPeriod(p, pd.fromIso, pd.toIso)))));
  const totalPages = pages(posts);
  const routes = [], infeasible = [];
  const consider = (cadence, vols, why) => {
    const fat = vols.find(v => pages(v._posts) > 300);
    if (fat) { infeasible.push({ cadence, reason: `${fat.label} alone would run about ${pages(fat._posts)} pages, past what one volume can bind` }); return; }
    const thin = vols.find(v => rawPages(v._posts) < 32 && v._posts.length);
    if (cadence !== "single" && vols.length < 2) { infeasible.push({ cadence, reason: vols.length ? "the archive folds down to one volume" : "no posts in the window" }); return; }
    /* a cadence is only itself when most of its volumes are whole periods, not folds or parts */
    const whole = vols.filter(v => !/ – | · /.test(v.label)).length;
    if (cadence !== "single" && whole < Math.ceil(vols.length / 2)) {
      const unit = { half: "half-years", quarterly: "quarters", monthly: "months" }[cadence];
      infeasible.push({ cadence, reason: whole === 0 ? `every one of the ${unit} would fold or split` : `most of the ${unit} would fold or split` }); return;
    }
    if (thin && vols.length > 1) { infeasible.push({ cadence, reason: `the ${thin.label} volume would be under 32 pages` }); return; }
    routes.push({ cadence, recommended: false, why, volumes: vols.map(({ _posts, ...v }) => v) });
  };
  if (totalPages <= 300 && posts.length) consider("single", [vol(w.label, w.span, posts, "Everything in the window, in order.")], "The whole window fits one book.");
  else infeasible.push({ cadence: "single", reason: posts.length ? `one volume would run about ${totalPages} pages` : "no posts in the window" });
  consider("half", build("half", w.halves), "Two half-years, one book each.");
  consider("quarterly", build("quarterly", w.quarters), "Four quarters, one book each.");
  consider("monthly", build("monthly", w.months), "A book a month.");
  /* the golden route: the coarsest cadence whose volumes are whole periods; else the fewest volumes */
  const golden = routes.find(r => !r.volumes.some(v => /\s·\s[IVX]+$/.test(v.label)))
    || [...routes].sort((a, b) => a.volumes.length - b.volumes.length)[0];
  if (golden) golden.recommended = true;
  const bylines = {};
  for (const r of input.posts) for (const b of r.by) bylines[b] = (bylines[b] || 0) + 1;
  const contributors = Object.entries(bylines).sort((a, b) => b[1] - a[1]).map(([n, c], i) => ({ name: n, role: i === 0 ? "principal" : "contributor", posts: c }));
  const paidOnly = !posts.length && input.publication.paid_posts_in_window > 0;
  const headline = paidOnly ? "Your posts are for paid subscribers."
    : !golden ? "Your archive needs a hand-planned edition."
    : w.everythingSoFar ? "Everything so far is one book."
    : golden.cadence === "single" ? "Your year is one book."
    : golden.cadence === "half" ? "Your year is a pair of half-year volumes."
    : golden.cadence === "quarterly" ? "Your year is a quarterly set." : "Your year is a monthly set.";
  return {
    kind: "essays", rhythm: "", description: `${name}: ${posts.length} public posts in ${w.span}.`,
    routes, infeasible, contributors, excluded: [], interior: { recommended: "bw", why: "Black and white by default; choose colour if your images carry the writing." },
    dedication_post_id: null, running_head: "publication",
    sentences: { plan_headline: headline,
      plan_sub: paidOnly ? `${input.publication.paid_posts_in_window} posts in ${w.span} are for paid subscribers, which the preview cannot read. Send a Substack export and we build from it.` : `${posts.length} posts, about ${totalPages} pages, ${w.span}.`,
      proof_email_opening: "Here are the first pages of your edition." },
  };
}

function compact(input) {
  const { _partition, ...rest } = input;
  return rest;
}

/* Returns { plan, planned_by: "editor"|"calendar", attempts, errors, usage, model } */
export async function planEdition({ posts, identity, host, nowMs = Date.now(), capped = false, apiKey, openrouterKey, client, log = () => {}, deadlineMs = 0 }) {
  const started = Date.now();
  const input = buildEditorInput({ posts, identity, host, nowMs, capped });
  const out = { plan_version: PLAN_VERSION, model: EDITOR_MODEL, attempts: 0, errors: [], attempt_errors: [], usage: null, window: input.window, totals: input.totals };
  const ec = client ? { client, model: EDITOR_MODEL, via: "given" } : editorClient({ apiKey, openrouterKey });
  if (!ec) {
    const fb = checkPlan(calendarFallback(input), input);
    return { ...out, planned_by: "calendar", reason: "no api key", plan: fb.plan, errors: fb.errors };
  }
  const anthropic = ec.client; out.model = ec.model; out.via = ec.via;
  const messages = [{ role: "user", content: "Plan this edition. Input follows as JSON.\n\n" + JSON.stringify(compact(input)) }];
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    /* a second attempt only when the caller's wall clock allows it (Cloudflare answers 524 at 100 s) */
    if (attempt === 2 && deadlineMs && Date.now() - started > deadlineMs * 0.55) { log("editor", "no time for a second attempt"); break; }
    out.attempts = attempt;
    let res;
    try {
      res = await anthropic.messages.parse({
        model: ec.model, max_tokens: 16000, system: SYSTEM, messages,
        output_config: { format: zodOutputFormat(EditorialPlan), effort: "medium" },
      });
    } catch (e) {
      lastErrors = [`api: ${String(e.message || e).slice(0, 200)}`];
      log("editor", lastErrors[0]);
      break;
    }
    out.usage = res.usage ? { input: res.usage.input_tokens, output: res.usage.output_tokens } : null;
    if (res.stop_reason === "refusal") { lastErrors = ["api: refusal"]; break; }
    if (!res.parsed_output) { lastErrors = ["api: no parsed output"]; messages.push({ role: "assistant", content: res.content }, { role: "user", content: "The answer did not parse. Return the plan again as the schema requires." }); continue; }
    const check = checkPlan(res.parsed_output, input);
    if (check.ok) return { ...out, planned_by: "editor", plan: check.plan, errors: [] };
    lastErrors = check.errors;
    out.attempt_errors.push(check.errors.slice(0, 12));
    log("editor", `attempt ${attempt} failed ${check.errors.length} rules: ${check.errors.slice(0, 3).join(" | ")}`);
    messages.push({ role: "assistant", content: res.content },
      { role: "user", content: "Your plan broke these rules. Fix every one and return the whole plan again:\n- " + check.errors.slice(0, 40).join("\n- ") });
  }
  const fb = checkPlan(calendarFallback(input), input);
  return { ...out, planned_by: "calendar", reason: lastErrors[0] || "unknown", plan: fb.plan, errors: lastErrors };
}
