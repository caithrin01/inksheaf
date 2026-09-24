import assert from 'node:assert/strict';
import {sourceJsonClient,retryDelay} from './lib/source-request.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
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
let calls=0;const blocked=sourceJsonClient({fetchImpl:async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'60'}});}});
const stopped=await Promise.allSettled(['first','queued','also-queued'].map(blocked));
assert(stopped.every(r=>r.status==='rejected'&&r.reason.code==='SOURCE_RETRY_LATER'));assert.equal(calls,1,'long server backoff prevents every queued request');
const dir=mkdtempSync(join(tmpdir(),'source-completeness-')),host='source-request-fixture-'+process.pid+'.substack.com';
try{
 const selected=join(dir,'posts.json');writeFileSync(selected,'[123]');
 const script=`const calls=[];globalThis.fetch=async url=>{const path=new URL(url).pathname;calls.push(path);if(path==='/api/v1/archive')return Response.json([{id:123,slug:'complete-essay',title:'Complete essay',audience:'everyone',type:'newsletter',post_date:'2026-01-01',wordcount:1000}]);if(path==='/api/v1/posts/complete-essay')return new Response('',{status:429,headers:{'retry-after':'60'}});throw Error('Unexpected optional source request');};process.argv=['node','build-book',${JSON.stringify(host)},'--posts',${JSON.stringify(selected)},'--publisher-dir',${JSON.stringify(join(dir,'publisher'))}];try{await import('./scripts/build-book.mjs');throw Error('Incomplete book unexpectedly built');}catch(e){console.log(JSON.stringify({calls,error:e.message}));}`;
 const answer=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.match(answer.error,/Selected source text is missing/);assert.deepEqual(answer.calls,['/api/v1/archive','/api/v1/posts/complete-essay'],'known incomplete books stop before homepage, branding or any inference');
}finally{rmSync(dir,{recursive:true,force:true});rmSync(join('proofs/.cache',host),{recursive:true,force:true});}
console.log('PASS server backoff reaches queued readers, request starts stay paced, out-of-order completion retains callers, attempts and long waits remain bounded');
