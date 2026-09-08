// Versioned print designs shared by the site, reservation, proof and cover wrap.
import * as legacy from './book-design-v1.js';
export const DESIGN_VERSION = 2;
export const COVER_DESIGNS = [
  { id: 'masthead', name: 'Masthead', description: 'Your publication’s colour, a large masthead and its own mark.' },
  { id: 'classic', name: 'Classic', description: 'Warm ivory, centred literary type and open space.' },
  { id: 'field', name: 'Field notes', description: 'Pale green and olive, with an asymmetric editorial structure.' },
  { id: 'midnight', name: 'Midnight', description: 'Blue-black, expressive italic type and open space.' },
];
export function validDesign(value) {
  return !!value && [1,DESIGN_VERSION].includes(value.version) && COVER_DESIGNS.some(d => d.id === value.cover) && validLogoTreatment(value.logo) && (!value.palette || /^#[0-9a-f]{6}$/i.test(value.palette.cover_bg) && /^#[0-9a-f]{6}$/i.test(value.palette.cover_ink));
}
export function designSelection(cover = 'masthead', theme = {}, logo) {
  if (!COVER_DESIGNS.some(d => d.id === cover)) throw new Error('Unknown cover design');
  const [bg,ink]=coverColors(cover,theme);
  return { version: DESIGN_VERSION, cover, palette:{cover_bg:bg,cover_ink:ink}, ...(logo && validLogoTreatment(logo) ? {logo} : {}) };
}
export function validLogoTreatment(value){
  return value === undefined || !!value && ['transparent','original','band'].includes(value.treatment) && (value.treatment !== 'band' || /^#[0-9a-f]{6}$/i.test(value.background));
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function coverColors(cover, theme = {}, version = DESIGN_VERSION) {
  theme = theme || {};
  if(version===1)return legacy.coverColors(cover,theme);
  const fixed = { classic: ['#f2efe5','#262724','#262724'], field: ['#dce4c4','#243e32','#243e32'], midnight: ['#172c40','#f1f0e4','#c8d4d7'] };
  if (fixed[cover]) return fixed[cover];
  const bg = /^#[0-9a-f]{6}$/i.test(theme.cover_bg || '') ? theme.cover_bg : '#eee9de';
  const lum = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const proposed = /^#[0-9a-f]{6}$/i.test(theme.cover_ink || '') ? theme.cover_ink : '#25231e';
  const a=lum(bg), b=lum(proposed);
  const ink=(Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5?proposed:a>.179?'#111111':'#ffffff';
  return [bg,ink,ink];
}
export function coverStyle(cover, theme, title = '', version = DESIGN_VERSION) {
  if(version===1)return legacy.coverStyle(cover,theme,title);
  const [bg,ink,accent]=coverColors(cover,theme);
  const longest=Math.max(1,...String(title).split(/\s+/).map(w=>w.length));
  const wide=(String(title).match(/[MW@\u2e80-\u9fff\uf900-\ufaff]/g)||[]).length;
  const density=String(title).length+wide;
  const size=Math.min(density>160?(cover==='field'?4.5:5.5):density>110?6.2:16,Math.max(7,140/longest),String(title).length>80?7:String(title).length>55?9:String(title).length>30?11:String(title).length>20?14:16);
  // The heavy masthead needs room for whole normal words: a bounding-box fit alone
  // accepted "SemiAnalysi / s" and "Knowledg / e" because anywhere-wrap hid overflow.
  const display=Math.min(String(title).length>20?size:size*1.18,longest>=9&&longest<=24?120/longest:Infinity);
  return `--cover-paper:${bg};--cover-ink:${ink};--cover-accent:${accent};--title-size:${size}cqw;--classic-title-gap:${String(title).length>20?22:37}cqw;--display-size:${display}cqw`;
}
export function coverMarkup({ publication='Your publication', kind='Collected edition', dates='Your writing, gathered.', foot='6 × 9 · perfect bound', logo='', logoTreatment='transparent', logoBackground='#1d1e1d', logoInk='#f2efe5', version=DESIGN_VERSION, ids=false }={}) {
  if(version===1)return legacy.coverMarkup({publication,kind,dates,foot,logo,ids});
  const id=name=>ids?` id="pv-${name}"`:'';
  const safeLogo=/^(?:\/book\/|assets\/)[a-z0-9._-]+\.(?:png|jpe?g|webp|svg)$/i.test(logo)||/^https:\/\//.test(logo)||/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo)?logo:'';
  return `<div class="edition-cover ${safeLogo && logoTreatment==='band' ? 'logo-band' : safeLogo && logoTreatment==='original' ? 'logo-original' : ''}" style="--logo-ground:${/^#[0-9a-f]{6}$/i.test(logoBackground)?logoBackground:'#1d1e1d'};--logo-ink:${/^#[0-9a-f]{6}$/i.test(logoInk)?logoInk:'#f2efe5'}">
    <div class="cv-kind"${id('kind')}>${escapeHtml(kind)}</div>
    ${safeLogo && logoTreatment==='band' ? `<div class="cv-logo-band"><img class="cv-logo"${id('logo')} alt="" src="${escapeHtml(safeLogo)}" width="72" height="72"><span class="cv-band-copy"><span class="cv-band-foot"${id('cvpages')}>${escapeHtml(foot)}</span></span></div>` : `<img class="cv-logo"${id('logo')} alt="" ${safeLogo?`src="${escapeHtml(safeLogo)}"`:'hidden'} width="72" height="72" referrerpolicy="no-referrer">`}
    <div class="cv-mast" dir="auto"${id('mast')}>${escapeHtml(publication)}</div>
    <div class="cv-orn" aria-hidden="true"></div>
    <div class="cv-dates"${id('dates')}>${escapeHtml(dates)}</div>
    <div class="cv-mid"></div>
    <div class="cv-footwrap"><span class="cv-pages"${safeLogo && logoTreatment==='band' ? '' : id('cvpages')}>${escapeHtml(foot)}</span></div>
  </div>`;
}
