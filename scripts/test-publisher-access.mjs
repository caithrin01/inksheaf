import assert from 'node:assert/strict';
import {readPublisherAccess,requirePublisherAccess} from './lib/publisher-access.mjs';
const fake=({limit=100,remaining=0,credit=25,usage=0}={})=>async(url,options)=>{
  assert.equal(options.method,undefined,'Preflight must never make an inference POST');
  assert.equal(options.headers.Authorization,'Bearer fixture');
  assert.equal(options.redirect,'error');
  assert(options.signal);
  assert(['https://openrouter.ai/api/v1/key','https://openrouter.ai/api/v1/credits'].includes(url));
  return Response.json({data:url.endsWith('/key')?{limit,limit_remaining:remaining,label:'private key label'}:{total_credits:credit,total_usage:usage}});
};
const options={key:'fixture',requiredUsd:.5};
await assert.rejects(requirePublisherAccess({...options,fetchImpl:fake()}),e=>e.code==='PUBLISHER_KEY_LIMIT'&&e.access.account_credit_usd===25&&e.access.key_remaining_usd===0);
await assert.rejects(requirePublisherAccess({...options,fetchImpl:fake({remaining:10,credit:.2})}),e=>e.code==='PUBLISHER_ACCOUNT_CREDIT');
const exact=await requirePublisherAccess({...options,fetchImpl:fake({remaining:.5,credit:.5})});
assert.equal(exact.key_remaining_usd,.5);assert.equal(exact.account_credit_usd,.5);
const unlimited=await requirePublisherAccess({...options,fetchImpl:fake({limit:null,remaining:null})});
assert.equal(unlimited.key_remaining_usd,null);assert(!JSON.stringify(unlimited).includes('private key label'));
const overdrawn=await readPublisherAccess({key:'fixture',fetchImpl:fake({usage:26})});assert.equal(overdrawn.account_credit_usd,0);
for(const remaining of [undefined,-1,NaN,'50']){
 const fetchImpl=async url=>Response.json({data:url.endsWith('/key')?{limit:100,limit_remaining:remaining}:{total_credits:25,total_usage:0}});
 await assert.rejects(requirePublisherAccess({...options,fetchImpl}),/valid spending allowance/);
}
await assert.rejects(requirePublisherAccess({...options,fetchImpl:async()=>Response.json({error:{message:'Sensitive upstream response fixture'}},{status:403})}),e=>e.message==='Publisher access check failed (HTTP 403)');
await assert.rejects(requirePublisherAccess({...options,fetchImpl:async()=>new Response('not JSON')}),/response is unavailable/);
for(const requiredUsd of [0,-1,NaN,Infinity])await assert.rejects(requirePublisherAccess({...options,requiredUsd,fetchImpl:()=>{throw Error('Invalid reservation must not reach the provider');}}),/positive publisher reservation/);
console.log('PASS funded-account/exhausted-key refusal, independent credit refusal, exact reservation, unlimited key, malformed responses, bounded read-only requests and private-field omission');
