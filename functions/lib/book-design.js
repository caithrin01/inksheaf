// Versioned print designs shared by the site, reservation, proof and cover wrap.
export const DESIGN_VERSION = 1;
export const COVER_DESIGNS = [
  { id: 'masthead', name: 'Masthead', description: 'Your publication’s colour, a large masthead and its own mark.' },
  { id: 'classic', name: 'Classic', description: 'Warm ivory, centred serif type and a fine rule.' },
  { id: 'field', name: 'Field notes', description: 'An olive spine band, oat paper and type set flush left.' },
  { id: 'midnight', name: 'Midnight', description: 'Deep green ink, warm lettering and a quiet serif title.' },
];
export function validDesign(value) {
  return !!value && value.version === DESIGN_VERSION && COVER_DESIGNS.some(d => d.id === value.cover) && (!value.palette || /^#[0-9a-f]{6}$/i.test(value.palette.cover_bg) && /^#[0-9a-f]{6}$/i.test(value.palette.cover_ink));
}
export function designSelection(cover = 'masthead', theme = {}) {
  if (!COVER_DESIGNS.some(d => d.id === cover)) throw new Error('Unknown cover design');
  const [bg,ink]=coverColors(cover,theme);
  return { version: DESIGN_VERSION, cover, palette:{cover_bg:bg,cover_ink:ink} };
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function coverColors(cover, theme = {}) {
  const fixed = { classic: ['#f6efdf','#29251f','#8e362b'], field: ['#e8e1ce','#283127','#4b5842'], midnight: ['#25322e','#f4eedf','#d9cda9'] };
  if (fixed[cover]) return fixed[cover];
  const bg = /^#[0-9a-f]{6}$/i.test(theme.cover_bg || '') ? theme.cover_bg : '#eee9de';
  const lum = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const proposed = /^#[0-9a-f]{6}$/i.test(theme.cover_ink || '') ? theme.cover_ink : '#25231e';
  const a=lum(bg), b=lum(proposed);
  const ink=(Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5?proposed:a>.179?'#111111':'#ffffff';
  return [bg,ink,ink];
}
export function coverStyle(cover, theme, title = '') {
  const [bg,ink,accent]=coverColors(cover,theme);
  const longest=Math.max(1,...String(title).split(/\s+/).map(w=>w.length));
  const size=Math.min(Math.max(7,140/longest),String(title).length>80?7:String(title).length>55?9:String(title).length>30?11:16);
  return `--cover-paper:${bg};--cover-ink:${ink};--cover-accent:${accent};--title-size:${size}cqw`;
}
export function coverMarkup({ publication='Your publication', kind='Collected edition', dates='Your writing, gathered.', foot='6 × 9 · perfect bound', logo='', ids=false }={}) {
  const id=name=>ids?` id="pv-${name}"`:'';
  const safeLogo=/^https:\/\//.test(logo)||/^data:image\/(png|jpeg|webp);base64,/.test(logo)?logo:'';
  return `<div class="edition-cover">
    <div class="cv-kind"${id('kind')}>${escapeHtml(kind)}</div>
    <img class="cv-logo"${id('logo')} alt="" ${safeLogo?`src="${escapeHtml(safeLogo)}"`:'hidden'} width="72" height="72" referrerpolicy="no-referrer">
    <div class="cv-mast"${id('mast')}>${escapeHtml(publication)}</div>
    <div class="cv-orn" aria-hidden="true"></div>
    <div class="cv-dates"${id('dates')}>${escapeHtml(dates)}</div>
    <div class="cv-mid"></div>
    <div class="cv-footwrap"><span class="cv-pages"${id('cvpages')}>${escapeHtml(foot)}</span></div>
  </div>`;
}
