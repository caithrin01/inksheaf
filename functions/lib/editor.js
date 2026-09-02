// The editor: one Claude call that plans an edition, checked by plan-check, with one retry
// carrying the failing rules, and a calendar fallback so the page never depends on the model.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EditorialPlan, PLAN_VERSION, KINDS } from "./editor-schema.js";
import { buildEditorInput, KIND_HINTS, volumePages, printCost } from "./editor-input.js";
import { checkPlan } from "./plan-check.js";

export const EDITOR_MODEL = "claude-opus-5";

export const SYSTEM = `You are the editor at Inksheaf. A writer has pasted their Substack. From the archive rows and the window you are given, plan their printed edition: a 6x9 perfect-bound book or set, at cost, for the writer and their readers.

You decide judgment, not arithmetic. Pages and prices are computed from your post assignments by the same formula you are shown; do not state them. Every public post in the window is either bound in every route or listed once in "excluded" with a plain reason. Never bind a post from the quarter in progress.

Routes: offer the golden route first and mark it recommended, then the alternatives that bind. Volume labels come only from the window's period labels you are given; when a period is too thin (under the minimum pages) fold it into its neighbour and join the two labels with " – " (a half-year label when two quarters make one). When a period is too fat (over the cap), that cadence is infeasible unless a finer cadence exists; say so in "infeasible" with the page count in words. A single volume is only offered when the whole window binds under the cap.

Kinds: ${KIND_HINTS}. Contributors: everyone with a byline, principal first. Notes policy per volume from the footnote counts. Interior: colour only when the images carry the writing (recipes, photo essays, illustrated posts); otherwise black and white, and say why in one sentence.

Sentences are for the writer, plain and specific, no flattery, no exclamation marks. British or American spelling as the writer uses.`;

export function calendarFallback(input) {
  // Deterministic plan from the window's quarters (and a single volume when it fits).
  const w = input._partition.window;
  const posts = input._partition.inWindow;
  const byQ = w.quarters.map(q => ({ q, posts: posts.filter(p => { const d = String(p.post_date).slice(0, 10); return d >= q.fromIso && d < q.toIso; }) }));
  const bylines = {};
  for (const r of input.posts) for (const b of r.by) bylines[b] = (bylines[b] || 0) + 1;
  const contributors = Object.entries(bylines).sort((a, b) => b[1] - a[1]).map(([name, n], i) => ({ name, role: i === 0 ? "principal" : "contributor", posts: n }));
  const totalPages = volumePages(posts);
  const routes = [];
  const quarterly = { cadence: "quarterly", recommended: totalPages > 300, why: "Four quarters, one book each.",
    volumes: byQ.filter(x => x.posts.length).map(x => ({ label: x.q.label, title: input.publication.name, subtitle: x.q.span,
      post_ids: x.posts.map(p => Number(p.id)), parts: null, notes_policy: "endnotes_per_article", why: "The quarter's posts in order." })) };
  const single = { cadence: "single", recommended: totalPages <= 300, why: "The whole window fits one book.",
    volumes: [{ label: w.label, title: input.publication.name, subtitle: w.span, post_ids: posts.map(p => Number(p.id)), parts: null, notes_policy: "endnotes_per_article", why: "Everything in the window, in order." }] };
  const infeasible = [];
  if (totalPages <= 300) routes.push(single); else infeasible.push({ cadence: "single", reason: `one volume would run about ${totalPages} pages` });
  if (quarterly.volumes.length >= 2) routes.push(quarterly); else infeasible.push({ cadence: "quarterly", reason: "fewer than two quarters have posts" });
  if (!routes.some(r => r.recommended) && routes[0]) routes[0].recommended = true;
  return {
    kind: "essays", rhythm: "", description: `${input.publication.name}: ${posts.length} public posts in ${w.span}.`,
    routes, infeasible, contributors, excluded: [], interior: { recommended: "bw", why: "Planned by the calendar; black and white by default." },
    dedication_post_id: null, running_head: "publication",
    sentences: { plan_headline: totalPages > 300 ? "Your year is a quarterly set." : "Your year is one book.", plan_sub: `${posts.length} posts, about ${totalPages} pages, ${w.span}.`, proof_email_opening: "Here are the first pages of your edition." },
  };
}

function compact(input) {
  const { _partition, ...rest } = input;
  return rest;
}

/* Returns { plan, planned_by: "editor"|"calendar", attempts, errors, usage, model } */
export async function planEdition({ posts, identity, host, nowMs = Date.now(), capped = false, apiKey, client, log = () => {} }) {
  const input = buildEditorInput({ posts, identity, host, nowMs, capped });
  const out = { plan_version: PLAN_VERSION, model: EDITOR_MODEL, attempts: 0, errors: [], usage: null, window: input.window, totals: input.totals };
  const key = apiKey || (typeof process !== "undefined" ? process.env?.ANTHROPIC_API_KEY : undefined);
  if (!client && !key) {
    const fb = checkPlan(calendarFallback(input), input);
    return { ...out, planned_by: "calendar", reason: "no api key", plan: fb.plan, errors: fb.errors };
  }
  const anthropic = client || new Anthropic({ apiKey: key });
  const messages = [{ role: "user", content: "Plan this edition. Input follows as JSON.\n\n" + JSON.stringify(compact(input)) }];
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    out.attempts = attempt;
    let res;
    try {
      res = await anthropic.messages.parse({
        model: EDITOR_MODEL, max_tokens: 16000, system: SYSTEM, messages,
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
    log("editor", `attempt ${attempt} failed ${check.errors.length} rules`);
    messages.push({ role: "assistant", content: res.content },
      { role: "user", content: "Your plan broke these rules. Fix every one and return the whole plan again:\n- " + check.errors.slice(0, 40).join("\n- ") });
  }
  const fb = checkPlan(calendarFallback(input), input);
  return { ...out, planned_by: "calendar", reason: lastErrors[0] || "unknown", plan: fb.plan, errors: lastErrors };
}
