import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
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
check('unknown version, design, or palette rejected',()=>{for(const d of [{version:3,cover:'classic'},{version:1,cover:'evil'},{version:1,cover:'classic',palette:{cover_bg:'url(bad)',cover_ink:'#ffffff'}}])assert.equal(validDesign(d),false);});
let snapshot={summary_version:PREVIEW_SCHEMA_VERSION,host:'example.substack.com',publication:'Example',sample:[{id:12,slug:post.slug,t:post.title}]};
let expired=false, fetched=0, reply=()=>new Response(JSON.stringify(post));
const DB={ prepare(sql) { return {
  bind(){return this;}, async run(){return{};},
  async first(){return sql.startsWith('SELECT payload')?{payload:JSON.stringify(snapshot),fetched_at:expired?'2000-01-01':new Date().toISOString()}:{n:0};}
}; }};
const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{fetched++;assert.equal(opts.redirect,'manual');return reply(url);};
const request=new Request('https://inksheaf.invalid/api/sample?url=example.substack.com');
async function call(env={}){return onRequest({request,env:{DB,...env}});}
try{
 let r=await call(),j=await r.json();check('confirmed post body returns source and real text',()=>{assert.equal(r.status,200);assert.match(j.html,/Real/);assert.equal(j.source,'https://example.substack.com/p/a-real-essay');});
 reply=()=>new Response(JSON.stringify({...post,id:99}));r=await call();check('mismatched post ID rejected',()=>assert.equal(r.status,422));
 reply=()=>new Response(JSON.stringify({...post,audience:'only_paid'}));r=await call();check('paid response rejected even for cached public entry',()=>assert.equal(r.status,422));
 reply=()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/secret'}});fetched=0;r=await call();check('cross-host redirect is not followed',()=>{assert.equal(r.status,422);assert.equal(fetched,1);});
 reply=url=>url.includes('www.example')?new Response(JSON.stringify(post)):new Response('',{status:301,headers:{location:'https://www.example.substack.com/api/v1/posts/'+post.slug}});r=await call();check('www alias redirect accepted for same post only',()=>assert.equal(r.status,200));
 expired=true;fetched=0;r=await call();check('expired preview cannot initiate a body read',()=>{assert.equal(r.status,422);assert.equal(fetched,0);});expired=false;
 snapshot={...snapshot,summary_version:PREVIEW_SCHEMA_VERSION-1};fetched=0;r=await call();check('old wrong-identity caches do not supply excerpts',()=>{assert.equal(r.status,422);assert.equal(fetched,0);});
 snapshot={...snapshot,summary_version:PREVIEW_SCHEMA_VERSION};
 const secret='local-public-sample-fixture',relayHost='caithrin--inksheaf-archive-relay-sample.modal.run';let relayedUrl;
 reply=url=>{const u=new URL(url);if(u.hostname!==relayHost)return new Response('',{status:403});relayedUrl=u;return new Response(JSON.stringify(post));};
 fetched=0;r=await call({ARCHIVE_RELAY_TOKEN:secret});j=await r.json();check('blocked direct sample uses authenticated relay and remains sanitized',()=>{
   assert.equal(r.status,200);assert.equal(fetched,2);assert.doesNotMatch(j.html,/script|onclick|tracker/);
   assert.equal(relayedUrl.searchParams.get('host'),snapshot.host);assert.equal(relayedUrl.searchParams.get('slug'),post.slug);assert.equal(relayedUrl.searchParams.get('post_id'),'12');
   const bucket=Math.floor(Date.now()/300000),sig=relayedUrl.searchParams.get('sig');assert([bucket,bucket-1].some(b=>sig===createHmac('sha256',secret).update(`${snapshot.host}:sample:${post.slug}:12:${b}`).digest('hex')));
 });
 snapshot={...snapshot,fetch_mode:'relay'};fetched=0;r=await call({ARCHIVE_RELAY_TOKEN:secret});check('relayed publication uses its working path immediately',()=>{assert.equal(r.status,200);assert.equal(fetched,1);});
 for(const edit of [{id:99},{slug:'different-post'},{audience:'only_paid'},{is_published:false}]){
   reply=()=>new Response(JSON.stringify({...post,...edit}));r=await call({ARCHIVE_RELAY_TOKEN:secret});check('relayed post revalidates '+Object.keys(edit)[0],()=>assert.equal(r.status,422));
 }
 reply=()=>new Response('',{status:302,headers:{location:'https://example.substack.com/api/v1/posts/'+post.slug}});fetched=0;r=await call({ARCHIVE_RELAY_TOKEN:secret});check('relay redirect is never followed',()=>{assert.equal(r.status,422);assert.equal(fetched,1);});
 reply=()=>new Response('{}',{headers:{'content-length':'2000001'}});r=await call({ARCHIVE_RELAY_TOKEN:secret});check('oversized relay response rejected',()=>assert.equal(r.status,422));
 snapshot={...snapshot,sample:[{id:-1,slug:post.slug},{id:12,slug:'../secret'}]};fetched=0;r=await call({ARCHIVE_RELAY_TOKEN:secret});check('invalid cached IDs and slugs never reach relay',()=>{assert.equal(r.status,422);assert.equal(fetched,0);});
}finally{globalThis.fetch=original;}
console.log(`${count} public sample and design checks passed`);
