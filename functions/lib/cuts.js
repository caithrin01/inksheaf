// Which posts never go into a book, by rule (plan-formatting-v1 section 8). Every cut carries a
// reason in the writer's words, so the About note and the change page can name it. Judgement
// calls (a "state of the publication" essay, a thank-you note, a mailbag) are the editor's: ruleFlag names
// the signals it should weigh, ruleCut only what never belongs.
// Fields from research-formatting part 2: type, restacked_post_id, canonical_url, postTags, slug.
const TAGS = /^(threads?|open threads?|discussion|watch|listen|podcast|audio|video)$/i;
/* tags that mean "look closer", not "leave out": a Slow Boring mailbag is a full essay */
const SOFT = /^(mailbag|housekeeping|announcements?|links?|roundup|digest|weekly|newsletter|programming note|meta)$/i;
const SLUG = /(^|-)(open-thread|discussion-post|discussion-thread|mailbag|sunday-thread|weekly-thread|comment-thread|office-hours)(-|\d|$)/i;

// Use the same canonical-domain inference in planning and printing. A writer may
// point their Substack essays at their own site; isolated foreign links and
// foreign Substacks remain cuts. This is a content heuristic, not ownership proof.
export function inferredOwnDomains(posts, host = "") {
  const h = host.replace(/^www\./, "").toLowerCase(), counts = new Map();
  const publicPosts = posts.filter(p => p && (!p.audience || p.audience === "everyone") && (!p.type || p.type === "newsletter") && !p.restacked_post_id);
  for (const p of publicPosts) {
    try {
      const url = new URL(p.canonical_url);
      const ch = url.hostname.replace(/^www\./, "").toLowerCase();
      if (/^https?:$/.test(url.protocol) && ch !== h && !/\.substack\.com$/.test(ch)) counts.set(ch, (counts.get(ch) || 0) + 1);
    } catch {}
  }
  return [...counts].filter(([, n]) => n >= Math.max(1, publicPosts.length) * 0.5).map(([domain]) => domain);
}

export function ruleCut(post, host = "", ownDomains = []) {
  if (!post) return "empty";
  const type = post.type || "newsletter";
  if (type === "restack" || post.restacked_post_id) return "a cross-post from another publication";
  if (type === "podcast") return "a podcast episode";
  if (type === "thread") return "a discussion thread";
  if (type !== "newsletter") return `not an essay (${type})`;
  if (post.is_published === false) return "unpublished";
  const canon = String(post.canonical_url || "");
  const h = host.replace(/^www\./, "").toLowerCase();
  if (h && /^https?:\/\//.test(canon)) {
    const ch = canon.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").toLowerCase();
    const own = (Array.isArray(ownDomains) ? ownDomains : [...ownDomains]).map(d => String(d).replace(/^www\./, "").toLowerCase());
    if (ch && ch !== h && !own.includes(ch)) return `first published at ${ch}`;
  }
  const tags = Array.isArray(post.postTags) ? post.postTags.map(t => String(t && (t.name || t)).trim()) : [];
  const tag = tags.find(t => TAGS.test(t));
  if (tag) return `tagged "${tag}"`;
  if (SLUG.test(String(post.slug || ""))) return "an open thread";
  return null;
}

/* a signal for the editor, never a cut: the tag or slug that suggests housekeeping */
export function ruleFlag(post) {
  const tags = Array.isArray(post?.postTags) ? post.postTags.map(t => String(t && (t.name || t)).trim()) : [];
  const tag = tags.find(t => SOFT.test(t));
  if (tag) return `tagged "${tag}"`;
  if (/(^|-)(mailbag|housekeeping|programming-note|announcement|state-of-the|thank-you|year-in-review|roundup)(-|$)/i.test(String(post?.slug || ""))) return "housekeeping-shaped slug";
  if ((post?.wordcount || 0) > 0 && post.wordcount < 200) return "under 200 words";
  return null;
}
