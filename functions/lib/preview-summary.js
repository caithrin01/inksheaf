const DATE_TITLE = /^[A-Z][a-z]+ \d{1,2},? \d{4}[.\s]*$/;
const NOUN_ONE = { essays: "essay", letters: "letter", recipes: "recipe", poems: "poem",
  stories: "story", reviews: "review", dispatches: "dispatch", pieces: "piece" };
const KIND_KEYWORDS = { recipe: "recipes", poem: "poems", poetry: "poems", letter: "letters",
  fiction: "stories", story: "stories", review: "reviews", dispatch: "dispatches" };

export function detectPreviewKind(posts) {
  const dateFrac = posts.filter(p => DATE_TITLE.test(String(p.title || "").trim())).length /
    Math.max(1, posts.length);
  if (dateFrac > 0.5) return "letters";
  const votes = {};
  for (const post of posts)
    for (const tag of [...(post.postTags || []).map(t => t?.name || t), post.section_name])
      for (const [keyword, kind] of Object.entries(KIND_KEYWORDS))
        if (String(tag || "").toLowerCase().includes(keyword)) votes[kind] = (votes[kind] || 0) + 1;
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= posts.length * 0.3 ? top[0] : "essays";
}


/* ---------- v3: the composing desk engine ---------- */
const FORM_NAMES = { essays: "a collected edition", letters: "a magazine", poems: "a book of poetry",
  recipes: "a recipe book", stories: "a story collection", reviews: "a review annual",
  dispatches: "a magazine", pieces: "a collected edition" };
const ISSUE_KINDS = new Set(["letters", "dispatches"]);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function volPages(posts) {
  const words = posts.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  return Math.round(words / 270 + posts.length + 8);
}
function spanLabel(posts) {
  const ds = posts.map(p => new Date(p.post_date));
  const a = ds[0], b = ds[ds.length - 1];
  const am = MONTHS[a.getUTCMonth()] + " " + a.getUTCFullYear();
  const bm = MONTHS[b.getUTCMonth()] + " " + b.getUTCFullYear();
  return am === bm ? am : am + " \u2013 " + bm;
}
function toVolume(posts) {
  return { label: spanLabel(posts), from: posts[0].post_date.slice(0, 10),
    to: posts[posts.length - 1].post_date.slice(0, 10), posts: posts.length,
    words: posts.reduce((s, p) => s + (Number(p.wordcount) || 0), 0), est_pages: volPages(posts) };
}
function groupBy(posts, keyFn) {
  const map = new Map();
  for (const p of posts) {
    const k = keyFn(new Date(p.post_date));
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return [...map.values()];
}
/* fold groups under 32pp into a neighbor until all bind, or give up */
function foldSmall(groups) {
  const g = groups.map(x => [...x]);
  for (let guard = 0; guard < 48; guard++) {
    const i = g.findIndex(x => volPages(x) < 32);
    if (i === -1) return g;
    if (g.length === 1) return g;
    const into = i > 0 ? i - 1 : i + 1;
    g[into] = into < i ? [...g[into], ...g[i]] : [...g[i], ...g[into]];
    g.splice(i, 1);
  }
  return g;
}
function cadenceDivision(sorted, keyFn, minVolumes) {
  const folded = foldSmall(groupBy(sorted, keyFn));
  const vols = folded.map(toVolume);
  if (vols.length < minVolumes)
    return { feasible: false, reason: "the archive folds down to " + vols.length + " volume" + (vols.length === 1 ? "" : "s"), volumes: vols };
  const fat = vols.find(v => v.est_pages > 300);
  if (fat) return { feasible: false, reason: "the " + fat.label + " volume would run " + fat.est_pages + " pages; past our 300-page binding cap", volumes: vols };
  return { feasible: true, volumes: vols };
}
export function planDivisions(publicPosts, estPages) {
  const sorted = [...publicPosts].sort((a, b) => Date.parse(a.post_date) - Date.parse(b.post_date));
  const single = estPages <= 300
    ? { feasible: true, volumes: [{ ...toVolume(sorted), est_pages: estPages }] }
    : { feasible: false, reason: "one volume would run " + estPages + " pages; past our 300-page binding cap",
        volumes: [{ ...toVolume(sorted), est_pages: estPages }] };
  const quarterly = cadenceDivision(sorted, d => d.getUTCFullYear() + "q" + Math.floor(d.getUTCMonth() / 3), 2);
  const monthly = cadenceDivision(sorted, d => d.getUTCFullYear() + "m" + d.getUTCMonth(), 2);
  return { single, quarterly, monthly };
}

export function summarizeArchive(posts, identity, host, cutoff, capped = false) {
  const inWindow = posts.filter(p => p && p.post_date && Date.parse(p.post_date) >= cutoff);
  const newsletters = inWindow.filter(p => p.type === "newsletter" || !p.type);
  const paid = newsletters.filter(p => p.audience && p.audience !== "everyone");
  const publicPosts = newsletters.filter(p => !p.audience || p.audience === "everyone");
  const podcasts = inWindow.filter(p => p.type === "podcast");
  if (!publicPosts.length) return null;

  const words = publicPosts.reduce((sum, post) => sum + (Number(post.wordcount) || 0), 0);
  const dates = publicPosts.map(p => Date.parse(p.post_date)).sort((a, b) => a - b);
  const estPages = Math.max(32, Math.round(words / 270 + publicPosts.length + 10));
  const cadence = estPages > 300 ? "Quarterly" : "Annual";
  const volumePages = cadence === "Quarterly" ? Math.max(32, Math.round(estPages / 4)) : estPages;
  const kind = detectPreviewKind(publicPosts);
  const divisions = planDivisions(publicPosts, estPages);
  const imageRate = publicPosts.filter(p => p.cover_image).length / publicPosts.length;
  const spanMonths = (dates[dates.length - 1] - dates[0]) / (30.44 * 864e5);
  const recommendedCadence = divisions.single.feasible ? "single"
    : divisions.quarterly.feasible ? "quarterly"
    : divisions.monthly.feasible ? "monthly" : "concierge";
  return {
    summary_version: 4,
    form: FORM_NAMES[kind] || "a collected edition",
    unit: ISSUE_KINDS.has(kind) ? "issue" : "volume",
    span_months: Math.round(spanMonths * 10) / 10,
    young: spanMonths < 10,
    image_rate: Math.round(imageRate * 100) / 100,
    divisions,
    recommended: { cadence: recommendedCadence, interior: imageRate >= 0.3 ? "color" : "bw" },
    host,
    publication: identity.publicationName || publicationName(publicPosts, host),
    posts: publicPosts.length,
    public_posts: publicPosts.length,
    paid_posts: paid.length,
    podcast_posts: podcasts.length,
    capped,
    words,
    est_pages: estPages,
    cadence,
    volume_pages: volumePages,
    kind,
    noun: NOUN_ONE[kind] || "piece",
    from: new Date(dates[0]).toISOString().slice(0, 10),
    to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
    titles: publicPosts.slice(0, 5).map(p => String(p.title || "").slice(0, 90)),
    sample: publicPosts.slice(0, 6).map(p => ({ t: String(p.title || "").slice(0, 80),
      d: String(p.post_date || "").slice(0, 10), w: Number(p.wordcount) || 0 })),
    theme: identity.theme,
  };
}

function publicationName(posts, host) {
  const names = {};
  for (const post of posts) for (const byline of (post.publishedBylines || []))
    if (byline?.name) names[byline.name] = (names[byline.name] || 0) + 1;
  const distinct = Object.keys(names);
  if (distinct.length === 1) return distinct[0];
  const label = host.replace(/^www\./, "").split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseRelayedArchive(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("relay returned no JSON array");
  const value = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error("relay payload is not an archive array");
  return value;
}
