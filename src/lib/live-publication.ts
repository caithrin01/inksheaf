import { coverMarkup, coverStyle } from '../../functions/lib/book-design.js';
import { coverLogo } from '../../functions/lib/cover-logo.js';
import { prepareLogo } from './prepare-logo';

// An address-derived title is only a draft. Never infer the real name from an author.
export function typedPublication(raw: string) {
  const text = raw.trim();
  const handle = /^(?:https?:\/\/)?(?:www\.)?substack\.com\/@([a-z0-9_-]+)/i.exec(text);
  const address = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
  const title = address.length > 253 ? '' : handle?.[1] || address.replace(/\.substack(?:\.com?)?\.?$/i, '').replace(/\.[a-z]{2,}$/i, '');
  let host = '';
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && (!url.port || url.port === '443') &&
        url.hostname.length <= 253 && url.hostname.split('.').every(label => label.length <= 63) &&
        /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) &&
        !/(^|\.)(localhost|local|internal|home|lan|corp|test|invalid)$/.test(url.hostname)) {
      host = handle ? `${handle[1].toLowerCase()}.substack.com` : url.hostname.toLowerCase();
      // A pause partway through typing .substack.com must not send speculative reads.
      if (/\.substack(?:\.|$)/i.test(host) && !host.endsWith('.substack.com')) host = '';
    }
  } catch { /* Partial addresses still supply a draft title. */ }
  return { title: title || 'Your publication', host };
}

export function startLivePublication() {
  const input = document.querySelector<HTMLInputElement>('#tryurl');
  const specimen = document.querySelector<HTMLElement>('.press-specimen');
  if (!input || !specimen) return;
  const faces = [...specimen.querySelectorAll<HTMLElement>('.cover-face')];
  const caption = specimen.querySelector<HTMLElement>('[data-publication-caption]')!;
  const originals = faces.map(face => ({ html: face.innerHTML, style: face.getAttribute('style') || '' }));
  const originalCaption = caption.textContent;
  const identities = new Map<string, any>();
  let revision = 0, timer: ReturnType<typeof setTimeout>, controller: AbortController | null = null;
  let lastValue = '', current: any = null;

  function stop() { clearTimeout(timer); controller?.abort(); controller = null; }
  function paint(data: any, confirmed = false) {
    current = confirmed ? data : null;
    for (const face of faces) {
      const design = face.dataset.design!;
      face.setAttribute('style', coverStyle(design, data.theme || {}, data.publication));
      face.innerHTML = coverMarkup({ publication: data.publication, kind: 'Collected essays',
        dates: 'Your writing, gathered.', foot: '6 × 9 · perfect bound', ...coverLogo(data, design) });
      for (const img of face.querySelectorAll<HTMLImageElement>('img')) img.addEventListener('error', () => {
        const band = img.closest('.cv-logo-band');
        if (band) { band.remove(); face.querySelector('.edition-cover')?.classList.remove('logo-band'); } else img.hidden = true;
      }, { once: true });
    }
    caption.textContent = `${data.publication} · ${confirmed ? 'Collected essays' : 'Cover sketch'}`;
    specimen.dataset.publicationState = confirmed ? 'confirmed' : 'draft';
  }
  async function resolveIdentity(host: string, generation: number) {
    const ctl = new AbortController(); controller = ctl;
    const deadline = setTimeout(() => ctl.abort(), 10000);
    try {
      const response = await fetch(`/api/publication?url=${encodeURIComponent(host)}`, { signal: ctl.signal });
      const data = await response.json();
      clearTimeout(deadline);
      if (!response.ok || !data.ok || data.host !== host || typeof data.publication !== 'string' || !data.publication.trim()) return;
      if (generation !== revision) return;
      // The name needn't wait for image classification or a slow logo download.
      paint({ ...data, logo_url: null }, true);
      await prepareLogo(data);
      if (generation !== revision || ctl.signal.aborted) return;
      identities.set(host, data); paint(data, true);
    } catch { /* A failed decorative lookup never blocks Preview my book. */ }
    finally { clearTimeout(deadline); if (controller === ctl) controller = null; }
  }
  function update() {
    const raw = input!.value.trim();
    if (raw === lastValue) return;
    lastValue = raw; revision++; stop(); current = null;
    if (!raw) {
      faces.forEach((face, i) => { face.innerHTML = originals[i].html; face.setAttribute('style', originals[i].style); });
      caption.textContent = originalCaption; delete specimen!.dataset.publicationState; return;
    }
    const { title, host } = typedPublication(raw);
    paint({ publication: title }, false);
    if (!host || input!.matches(':invalid') && raw.includes(' ')) return;
    const cached = identities.get(host);
    if (cached) { paint(cached, true); return; }
    const generation = revision;
    timer = setTimeout(() => resolveIdentity(host, generation), 650);
  }
  input.addEventListener('input', e => { if (!(e as InputEvent).isComposing) update(); });
  input.addEventListener('compositionend', update);
  input.addEventListener('change', update);
  window.addEventListener('pageshow', update);
  document.addEventListener('publication-preview-request', update);
  document.addEventListener('hero-publication-preview', ((event: CustomEvent) => {
    const { raw, publication: data } = event.detail;
    if (input.value.trim() !== raw || !data?.publication) return;
    const { host } = typedPublication(raw);
    // A rich preview may lack a logo if origin was blocked. Keep a verified identity logo.
    const known = current || identities.get(host);
    const merged = !data.logo_url && known?.publication === data.publication ? { ...data, logo_url: known.logo_url, logo_treatment: known.logo_treatment } : data;
    if (merged.logo_url) { revision++; stop(); identities.set(host, merged); }
    paint(merged, true);
  }) as EventListener);
  update();
}
