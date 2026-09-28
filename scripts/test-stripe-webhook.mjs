// The payment webhook acts once per Stripe event, only for a mailing at checkout, only for the
// amount agreed, and dispatches the print run with the paid version's own validated files.
// In-memory D1 stand-in and a captured GitHub dispatch; no network.
import assert from 'node:assert/strict';
import {onRequest} from '../functions/api/stripe-webhook.js';
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const secret='whsec_fixture';
async function sign(payload,t=Math.floor(Date.now()/1000)){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,'0')).join('')}`;
}
const files=[{label:'2025–26',pages:176,interiorKey:'i1',coverKey:'c1',validated:true}];
function world(mailing){
  const events=new Map(),dispatched=[],db={mailing:{...mailing},outcomes:events};
  const DB={prepare(sql){let a=[];return{bind(...x){a=x;return this;},
    async run(){
      if(/INSERT INTO stripe_events/.test(sql)){if(events.has(a[0]))return{meta:{changes:0}};events.set(a[0],'claimed');return{meta:{changes:1}};}
      if(/UPDATE stripe_events SET outcome/.test(sql)){events.set(a[1]??a[0],/'dispatched'/.test(sql)?'dispatched':'amount-mismatch');return{meta:{changes:1}};}
      if(/UPDATE mailings SET status = 'paid'/.test(sql)){if(db.mailing.status!=='checkout')return{meta:{changes:0}};db.mailing.status='paid';return{meta:{changes:1}};}
      if(/UPDATE mailings SET status = 'checkout'/.test(sql)){if(db.mailing.status==='paid')db.mailing.status='checkout';return{meta:{changes:1}};}
      if(/DELETE FROM stripe_events/.test(sql)){events.delete(a[0]);return{meta:{changes:1}};}
      throw Error('unexpected run '+sql);},
    async first(){
      if(/FROM mailings/.test(sql))return db.mailing.id===a[0]?{...db.mailing}:null;
      if(/FROM signups/.test(sql))return{email:'writer@example.com',publication_url:'https://www.caithrin.com',plan_json:null};
      if(/FROM edition_versions/.test(sql))return a[0]===7&&a[1]===41?{files_json:JSON.stringify(files)}:null;
      throw Error('unexpected first '+sql);}};}};
  const env={DB,STRIPE_WEBHOOK_SECRET:secret,MAILINGS_ENABLED:'1',GITHUB_DISPATCH_TOKEN:'gh',INKSHEAF_ENV:'production'};
  globalThis.fetch=async(url,init)=>{if(db.failDispatch)return new Response(null,{status:500});dispatched.push(JSON.parse(init.body));return new Response(null,{status:204});};
  return {env,db,dispatched};
}
const paidEvent=(id,amount=4130)=>JSON.stringify({id,type:'checkout.session.completed',data:{object:{id:'cs_1',payment_intent:'pi_1',amount_total:amount,metadata:{mailing_id:'9',signup_id:'41'}}}});
const post=async(env,payload,header)=>onRequest({request:new Request('https://inksheaf.com/api/stripe-webhook',{method:'POST',headers:{'stripe-signature':header??await sign(payload)},body:payload}),env});
const mailing={id:9,signup_id:41,status:'checkout',addresses:JSON.stringify([{name:'A',country_code:'GB',quantity:1}]),level:'MAIL',version_id:7,amount_cents:4130};

await test('a paid checkout dispatches one print run with the paid version files',async()=>{
  const w=world(mailing);const r=await post(w.env,paidEvent('evt_1'));
  assert.equal(await r.text(),'ok');assert.equal(w.db.mailing.status,'paid');assert.equal(w.dispatched.length,1);
  const p=w.dispatched[0].client_payload;assert.equal(p.event,'mail');assert.equal(typeof p.files,'string');
  assert.deepEqual(JSON.parse(p.files),{files,version_id:7});assert.equal(w.db.outcomes.get('evt_1'),'dispatched');
});
await test('a redelivered event does nothing',async()=>{
  const w=world(mailing);await post(w.env,paidEvent('evt_1'));const again=await post(w.env,paidEvent('evt_1'));
  assert.equal(await again.text(),'already');assert.equal(w.dispatched.length,1);
});
await test('a different amount than agreed is not printed',async()=>{
  const w=world(mailing);const r=await post(w.env,paidEvent('evt_2',100));
  assert.equal(await r.text(),'amount mismatch');assert.equal(w.db.mailing.status,'checkout');assert.equal(w.dispatched.length,0);
});
await test('a mailing that is not at checkout is not printed',async()=>{
  const w=world({...mailing,status:'quoted'});const r=await post(w.env,paidEvent('evt_3'));
  assert.equal(await r.text(),'already');assert.equal(w.dispatched.length,0);
});
await test('a failed dispatch is retried by Stripe, not lost',async()=>{
  const w=world(mailing);w.db.failDispatch=true;const r=await post(w.env,paidEvent('evt_5'));
  assert.equal(r.status,503);assert.equal(w.db.mailing.status,'checkout');assert(!w.db.outcomes.has('evt_5'));
  w.db.failDispatch=false;const again=await post(w.env,paidEvent('evt_5'));
  assert.equal(await again.text(),'ok');assert.equal(w.dispatched.length,1);assert.equal(w.db.mailing.status,'paid');
});
await test('a bad signature is refused',async()=>{
  const w=world(mailing);const r=await post(w.env,paidEvent('evt_4'),'t=1,v1=00');
  assert.equal(r.status,400);assert.equal(w.dispatched.length,0);
});
console.log(`${count} stripe webhook checks passed`);
