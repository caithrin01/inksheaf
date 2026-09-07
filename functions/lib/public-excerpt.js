import { parseDocument } from 'htmlparser2';
import { escapeHtml } from './book-design.js';
const excluded = new Set(['script','style','iframe','form','button','nav','footer','noscript','figure','img','video','audio','svg','table']);
const blocks = new Set(['p','h2','h3','h4','blockquote','ul','ol','pre']);
const inline = new Set(['em','strong','b','i','sup','sub','code','br']);
function skip(n) { return excluded.has(n.name) || /(?:subscribe|subscription|button-wrapper|caption|footnote-container|paywall)/i.test(n.attribs?.class || ''); }
function safe(n) {
  if(n.type==='text')return escapeHtml(n.data);
  if(skip(n))return '';
  const children=(n.children||[]).map(safe).join('');
  if(n.name==='br')return '<br>';
  return (inline.has(n.name)||blocks.has(n.name)||n.name==='li')?`<${n.name}>${children}</${n.name}>`:children;
}
export function publicExcerpt(post) {
  if(post?.audience!=='everyone' || post?.is_published===false || !post?.body_html || post.body_html.length>2_000_000) return null;
  const doc=parseDocument(post.body_html,{decodeEntities:true});
  const found=[];
  function visit(n) {
    if(skip(n))return;
    if(blocks.has(n.name)) { const html=safe(n); if(html.replace(/<[^>]*>/g,'').trim())found.push(html); return; }
    for(const c of n.children||[])visit(c);
  }
  visit(doc);
  const chosen=[];let chars=0;
  for(const html of found) {
    // Keep whole paragraphs, never silently clip a page. Unusually long blocks get an honest failure.
    if(html.length>16000)break;
    if(chars>5500)break;
    chosen.push(html);chars+=html.length;
  }
  if(!chosen.length)return null;
  return {html:chosen.join('\n'),truncated:chosen.length<found.length};
}
