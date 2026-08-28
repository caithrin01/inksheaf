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
  return {
    summary_version: 2,
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
