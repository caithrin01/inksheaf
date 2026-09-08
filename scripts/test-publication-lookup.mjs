import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/publication.js';
import {PREVIEW_SCHEMA_VERSION} from '../functions/lib/publication-identity.js';
const host='thezvi.substack.com',pub={id:1,name:"Don't Worry About the Vase",subdomain:'thezvi',logo_url:'https://substackcdn.com/logo.png',theme_var_background_pop:'#9a6600'};
const html=p=>`<script>window._preloads = JSON.parse(${JSON.stringify(JSON.stringify({pub:p}))});</script>`;
let calls=[],writes=[],row=null,quota=0,home=()=>new Response(html(pub)),page=()=>new Response(JSON.stringify([{publication:pub}]));
const DB={prepare(sql){return{
 bind(){return this},
 async first(){return sql.startsWith('SELECT payload')?row:{n:quota}},
 async run(){writes.push(sql);return {}}
}}};
const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{const u=new URL(url);calls.push(u);assert.equal(opts.redirect,'manual');return u.hostname===host && u.pathname==='/'?home():page()};
const get=async(raw=host,options={})=>{calls=[];writes=[];const r=await onRequest({request:new Request('https://inksheaf.com/api/publication?url='+encodeURIComponent(raw),{method:options.method||'GET'}),env:{DB,ARCHIVE_RELAY_TOKEN:options.relay?'test-secret':undefined}});return{status:r.status,body:await r.json()}};
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
try{
 let r=await get();check('one bounded homepage read supplies exact name, logo and contrasting theme',()=>{assert.equal(r.body.publication,pub.name);assert.equal(r.body.logo_url,pub.logo_url);assert.equal(r.body.theme.cover_bg,'#9a6600');assert.equal(calls.length,1)});
 check('typing does not log a funnel event or mutate preview cache',()=>assert.ok(writes.every(sql=>sql.startsWith('INSERT INTO quota_hits'))));
 for(const raw of ['javascript:alert(1)','127.0.0.1','intranet.local','not a URL']){r=await get(raw);check('rejects '+raw,()=>{assert.equal(r.status,400);assert.equal(calls.length,0)});}
 r=await get(host,{method:'POST'});check('GET only',()=>assert.equal(r.status,405));
 quota=121;r=await get();check('bounded per-caller and per-host reads',()=>{assert.equal(r.status,429);assert.equal(calls.length,0)});quota=0;
 row={payload:JSON.stringify({summary_version:PREVIEW_SCHEMA_VERSION,publication:pub.name,logo_url:pub.logo_url,host}),fetched_at:new Date().toISOString()};r=await get();check('fresh full-preview identity avoids origin work',()=>{assert.equal(calls.length,0);assert.equal(r.body.publication,pub.name)});
 row.payload=JSON.stringify({summary_version:1,publication:'Wrong author',logo_url:pub.logo_url});r=await get();check('old identity schema cannot supply a guessed name',()=>{assert.equal(r.body.publication,pub.name);assert.equal(calls.length,1)});row=null;
 home=()=>new Response('blocked',{status:403});r=await get(host,{relay:true});check('existing authenticated page relay supplies metadata only',()=>{assert.equal(r.body.publication,pub.name);assert.equal(r.body.logo_url,pub.logo_url);assert.equal(calls.length,2);assert.equal(calls[1].hostname,'caithrin--inksheaf-archive-relay-archive.modal.run');assert.equal(calls[1].searchParams.get('offset'),'0');assert.equal(calls[1].searchParams.get('mode'),null);assert.match(calls[1].searchParams.get('sig'),/^[a-f0-9]{64}$/)});
 r=await get();check('without relay credentials, reads only first ten archive rows',()=>{assert.equal(calls[1].pathname,'/api/v1/archive');assert.equal(calls[1].searchParams.get('limit'),'10');assert.equal(r.body.publication,pub.name)});
 page=()=>new Response(JSON.stringify([{publishedBylines:[{name:'An unrelated author'}]}]));r=await get();check('byline alone is never publication identity',()=>assert.equal(r.status,422));
 page=()=>new Response('[]',{headers:{'content-length':'3000000'}});r=await get();check('response size bound',()=>assert.equal(r.status,422));
 home=()=>new Response(html({...pub,logo_url:null}));page=()=>new Response(JSON.stringify([{publication:{...pub,id:2,logo_url:'https://substackcdn.com/wrong.png'}}]));r=await get();check('no logo from different publication id',()=>assert.equal(r.body.logo_url,null));
 page=()=>new Response(JSON.stringify([{publication:pub}]));r=await get();check('matched publication id can fill missing homepage logo',()=>assert.equal(r.body.logo_url,pub.logo_url));
 home=()=>new Response(html({...pub,logo_url:'https://evil.invalid/logo.png'}));page=()=>new Response('[]');r=await get();check('logo allowlist preserved',()=>assert.equal(r.body.logo_url,null));
 home=()=>new Response('unavailable',{status:503});page=()=>new Response('broken JSON');r=await get();check('unavailable identity remains a quiet optional failure',()=>assert.equal(r.status,422));
}finally{globalThis.fetch=original;}
console.log(`publication lookup: ${count} checks passed`);
