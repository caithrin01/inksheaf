// Selling from the creator's own Lulu account: the price calculator always covers both payees
// under Lulu's 80/20 split with whole-percent shares, and the hand-off endpoints are signed,
// wait for validated files, and accept only a lulu.com product page. No network.
import assert from 'node:assert/strict';
import {subscriberPrice,CREATOR_SHARE} from '../functions/lib/lulu-share.js';
import {onRequest as context} from '../functions/api/sell-context.js';
import {onRequest as link} from '../functions/api/sell-link.js';
import {hmacHex} from '../functions/lib/press-dispatch.js';
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
await test('both payees always receive at least their amounts',async()=>{
  let n=0;
  for(let cost=3.49;cost<=30;cost+=0.37)for(let markup=0;markup<=25;markup+=0.25){
    const p=subscriberPrice({printCost:Math.round(cost*100)/100,markup,perBook:2});n++;
    const paid=(p.retail-Math.round(cost*100)/100)*CREATOR_SHARE;
    assert(paid*p.sharePercent/100>=2-1e-9,`Inksheaf short at ${cost},${markup}`);
    assert(paid*(100-p.sharePercent)/100>=markup-1e-9,`creator short at ${cost},${markup}`);
    assert(Number.isInteger(p.sharePercent)&&p.sharePercent>=1&&p.sharePercent<=100);
    assert(Math.abs(p.retail*100-Math.round(p.retail*100))<1e-6,`retail ${p.retail} is not whole cents`);
  }
  assert(n>2000);
  assert.deepEqual(subscriberPrice({printCost:9.34,markup:0}),{retail:11.84,sharePercent:100,inksheaf:2,creator:0});
  assert.throws(()=>subscriberPrice({printCost:0,markup:1}));
});
const files=[{label:'2025–26',pages:176,interiorKey:'i',coverKey:'c',validated:true,interiorUrl:'https://store/i',coverUrl:'https://store/c',links_expire_at:new Date(Date.now()+86400000).toISOString()}];
const DB=(ver,links=[])=>({prepare(sql){let a=[];return{bind(...x){a=x;return this;},
  async first(){if(/FROM signups/.test(sql))return{publication_url:'https://www.caithrin.com'};if(/FROM edition_versions/.test(sql))return ver;return null;},
  async run(){links.push([sql,a]);return{meta:{changes:1}};}};}});
const env=(ver,links)=>({DB:DB(ver,links),ARCHIVE_RELAY_TOKEN:'t',INKSHEAF_LULU_PAYEE_EMAIL:'press@inksheaf.com'});
const sig=await hmacHex('t','sell:41');
const get=async(e,s=sig)=>{const r=await context({request:new Request(`https://inksheaf.com/api/sell-context?id=41&sig=${s}`),env:e});return{status:r.status,body:await r.json()};};
const ver={id:7,volumes:JSON.stringify([{label:'2025–26',pubName:'caithrin',pages:176}]),print_mode:'bw',status:'validated',files_json:JSON.stringify(files),listing_url:null};
await test('the hand-off is signed and waits for validated files',async()=>{
  assert.equal((await get(env(ver),'bad')).status,403);
  let r=await get(env({...ver,status:'proofed',files_json:null}));assert.equal(r.body.ready,false);assert.equal(r.body.pending,true);
  r=await get(env(ver));assert.equal(r.body.ready,true);assert.equal(r.body.volumes[0].print_cost,6.39);
  assert.equal(r.body.volumes[0].cover_url,'https://store/c');assert.equal(r.body.payee_email,'press@inksheaf.com');assert.equal(r.body.per_book,2);
  assert.match(r.body.settings.size,/6 × 9/);
});
await test('only a lulu.com product page becomes the button link',async()=>{
  const post=async(url,links)=>{const r=await link({request:new Request('https://inksheaf.com/api/sell-link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:41,sig,version_id:7,listing_url:url})}),env:env(ver,links)});return{status:r.status,body:await r.json()};};
  assert.equal((await post('https://example.com/shop/x',[])).status,400);
  const links=[];const ok=await post('https://www.lulu.com/shop/caithrin/collected/paperback/product-abc.html',links);
  assert.equal(ok.status,200);assert.match(ok.body.short,/^https:\/\/inksheaf\.com\/l\//);assert.match(ok.body.button_html,/Order the book/);
  assert(links.some(([sql])=>/UPDATE edition_versions SET listing_url/.test(sql)));
});
console.log(`${count} sell checks passed`);
