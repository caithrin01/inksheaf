import assert from 'node:assert/strict';
import {publicExcerpt} from '../functions/lib/public-excerpt.js';
import {onRequest} from '../functions/api/sample.js';
import {PREVIEW_SCHEMA_VERSION} from '../functions/lib/publication-identity.js';
import {coverMarkup,coverStyle,designSelection,validDesign,COVER_DESIGNS} from '../functions/lib/book-design.js';
let count=0;function check(name,f){f();console.log('PASS',name);count++;}
const post={id:12,slug:'a-real-essay',title:'A real essay',audience:'everyone',body_html:'<p>Real <em>words</em> and <strong>meaning</strong>.</p><script>throw Error("bad")</script><p onclick="bad()">More words <img src="https://tracker.invalid/x">.</p>'};
check('public prose preserves emphasis and drops active content',()=>{const x=publicExcerpt(post);assert.match(x.html,/<em>words<\/em>/);assert.doesNotMatch(x.html,/script|onclick|img|tracker|bad\(/);});
check('paid/unpublished/empty bodies never enter sample',()=>{for(const edit of [{audience:'only_paid'},{is_published:false},{body_html:''}])assert.equal(publicExcerpt({...post,...edit}),null);});
check('whole paragraphs retained, truncation stated',()=>{const x=publicExcerpt({...post,body_html:'<p>'+('a sentence. '.repeat(300))+'</p><p>'+('b sentence. '.repeat(300))+'</p><p>Last paragraph.</p>'});assert.equal(x.truncated,true);assert.ok(x.html.endsWith('</p>'));assert.doesNotMatch(x.html,/Last paragraph/);});
check('cover title and logo attributes are escaped',()=>{const s=coverMarkup({publication:'<img onerror=bad()>',logo:'javascript:bad()'});assert.doesNotMatch(s,/<img onerror|src="javascript/);assert.match(s,/&lt;img/);});
check('all four designs have safe versioned snapshots',()=>{for(const d of COVER_DESIGNS){assert.ok(validDesign(designSelection(d.id)));assert.match(coverStyle(d.id,{},'The Fox Says'),/--cover-paper:#[a-f0-9]{6}/);}});
check('unknown version, design, or palette rejected',()=>{for(const d of [{version:2,cover:'classic'},{version:1,cover:'evil'},{version:1,cover:'classic',palette:{cover_bg:'url(bad)',cover_ink:'#ffffff'}}])assert.equal(validDesign(d),false);});
let snapshot={summary_version:PREVIEW_SCHEMA_VERSION,host:'example.substack.com',publication:'Example',sample:[{id:12,slug:post.slug,t:post.title}]};
let expired=false, fetched=0, reply=()=>new Response(JSON.stringify(post));
const DB={ prepare(sql) { return {
  bind(){return this;}, async run(){return{};},
  async first(){return sql.startsWith('SELECT payload')?{payload:JSON.stringify(snapshot),fetched_at:expired?'2000-01-01':new Date().toISOString()}:{n:0};}
}; }};
const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{fetched++;assert.equal(opts.redirect,'manual');return reply(url);};
const request=new Request('https://inksheaf.invalid/api/sample?url=example.substack.com');
async function call(){return onRequest({request,env:{DB}});}
try{
 let r=await call(),j=await r.json();check('confirmed post body returns source and real text',()=>{assert.equal(r.status,200);assert.match(j.html,/Real/);assert.equal(j.source,'https://example.substack.com/p/a-real-essay');});
 reply=()=>new Response(JSON.stringify({...post,id:99}));r=await call();check('mismatched post ID rejected',()=>assert.equal(r.status,422));
 reply=()=>new Response(JSON.stringify({...post,audience:'only_paid'}));r=await call();check('paid response rejected even for cached public entry',()=>assert.equal(r.status,422));
 reply=()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/secret'}});fetched=0;r=await call();check('cross-host redirect is not followed',()=>{assert.equal(r.status,422);assert.equal(fetched,1);});
 reply=url=>url.includes('www.example')?new Response(JSON.stringify(post)):new Response('',{status:301,headers:{location:'https://www.example.substack.com/api/v1/posts/'+post.slug}});r=await call();check('www alias redirect accepted for same post only',()=>assert.equal(r.status,200));
 expired=true;fetched=0;r=await call();check('expired preview cannot initiate a body read',()=>{assert.equal(r.status,422);assert.equal(fetched,0);});expired=false;
 snapshot={...snapshot,summary_version:PREVIEW_SCHEMA_VERSION-1};fetched=0;r=await call();check('old wrong-identity caches do not supply excerpts',()=>{assert.equal(r.status,422);assert.equal(fetched,0);});
}finally{globalThis.fetch=original;}
console.log(`${count} public sample and design checks passed`);
