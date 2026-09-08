// Publication identity is not an author's display name or their first other newsletter.
export const PREVIEW_SCHEMA_VERSION = 9;
const cleanHost = host => String(host || '').toLowerCase().replace(/^www\./, '');
const cleanName = name => typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : '';

export function matchesPublication(pub, host, ids = []) {
  if (!pub || !cleanName(pub.name)) return false;
  const wanted = cleanHost(host);
  return cleanHost(pub.custom_domain) === wanted
    || (pub.subdomain && cleanHost(`${pub.subdomain}.substack.com`) === wanted)
    || (pub.id != null && ids.some(id => String(id) === String(pub.id)));
}

export function publicationFromArchive(posts, host) {
  const candidates = [];
  for (const post of posts) {
    if (post?.publication) candidates.push({ pub: post.publication, id: post.publication_id });
    for (const byline of post?.publishedBylines || [])
      for (const membership of byline?.publicationUsers || [])
        if (membership?.publication) candidates.push({ pub: membership.publication, id: post.publication_id });
  }
  return candidates.find(({pub}) => matchesPublication(pub, host))?.pub
    || candidates.find(({pub, id}) => id != null && matchesPublication(pub, host, [id]))?.pub
    || null;
}

export function publicationFromHomepage(html, host, posts = []) {
  // Parse JSON only; never evaluate a script fetched from a publication.
  const match = html.match(/window\._preloads\s*=\s*JSON\.parse\("((?:[^"\\]|\\.)*)"\)/);
  if (!match) return null;
  try {
    const preloads = JSON.parse(JSON.parse(`"${match[1]}"`));
    const pub = preloads.pub;
    const ids = posts.map(p => p?.publication_id).filter(id => id != null);
    return matchesPublication(pub, host, ids) ? pub : null;
  } catch { return null; }
}

export function publicationLogo(pub, host) {
  if (typeof pub?.logo_url !== 'string' || pub.logo_url.length > 2048) return null;
  try {
    const url = new URL(pub.logo_url, `https://${host}/`);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const domain = cleanHost(url.hostname);
    if (domain !== cleanHost(host) && domain !== 'substackcdn.com' && !domain.endsWith('.substackcdn.com')
      && domain !== 'substack-post-media.s3.amazonaws.com') return null;
    return url.href;
  } catch { return null; }
}

export function publicationLabel(pub) { return cleanName(pub?.name) || null; }
