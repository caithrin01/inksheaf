import assert from 'node:assert/strict';
import {sourceJsonClient,retryDelay} from './lib/source-request.mjs';
assert.equal(retryDelay('3',0),3000);assert.equal(retryDelay('Thu, 01 Jan 1970 00:00:03 GMT',1000),2000);assert.equal(retryDelay('invalid'),null);
const rateLimited=new Response('',{status:429,headers:{'retry-after':'.08'}});
const starts=[],base=Date.now();let first=true;
const read=sourceJsonClient({intervalMs:15,maxWaitMs:1000,fetchImpl:async url=>{
 starts.push({url,at:Date.now()-base});
 if(first){first=false;return rateLimited;}
 await new Promise(r=>setTimeout(r,url==='first'?5:30));return Response.json({url});
}});
assert.deepEqual(await Promise.all(['first','second','third'].map(read)),[{url:'first'},{url:'second'},{url:'third'}]);
assert(starts[1].at-starts[0].at>=70,'server backoff pauses already queued requests');
for(let i=2;i<starts.length;i++)assert(starts[i].at-starts[i-1].at>=10,'concurrent callers share paced starts');
let failures=0;await assert.rejects(sourceJsonClient({intervalMs:0,maxAttempts:2,fetchImpl:async()=>{failures++;return new Response('',{status:503,headers:{'retry-after':'0'}});}})('source'),/bounded retries/);assert.equal(failures,2);
let calls=0;await assert.rejects(sourceJsonClient({fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}});}})('source'),/longer retry delay/);assert.equal(calls,1);
console.log('PASS server backoff reaches queued readers, request starts stay paced, out-of-order completion retains callers, attempts and long waits remain bounded');
