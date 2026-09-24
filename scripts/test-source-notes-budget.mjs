import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {publisherSession} from './lib/publisher-session.mjs';
const dir=mkdtempSync(join(tmpdir(),'source-notes-budget-'));
try{
 let calls=0;
 const fetchImpl=async(url,options)=>{
  const saved=JSON.parse(readFileSync(join(dir,'state.json'))),id=options.headers['X-Inksheaf-Request-Id'],reservation=saved.journal.calls.find(c=>c.id===id);
  assert(reservation&&reservation.status==='reserved','Exact request is reserved durably before sending');
  assert.equal(reservation.request_sha256,createHash('sha256').update(options.body).digest('hex'));
  const body=JSON.parse(options.body);assert.equal(body.max_tokens,40);assert(options.signal);calls++;
  return Response.json({choices:[{finish_reason:'stop',message:{content:'{"notes":false}'}}],usage:{cost:.001}});
 };
 const session=()=>publisherSession({directory:dir,env:{OPENROUTER_API_KEY:'fixture'},fetchImpl});
 const input={heading:'A closing thought',tailHtml:'<p>Ordinary prose with a linked citation. '+ 'x'.repeat(1600)+'</p>'};
 assert.equal(await(await session()).sourceNotes(input),false);
 assert.equal(await(await session()).sourceNotes(input),false);assert.equal(calls,1,'rebuild reuses a settled source decision');
 await(await session()).sourceNotes({...input,tailHtml:input.tailHtml+'<p>Changed beyond the excerpt</p>'});assert.equal(calls,2,'full tail hash invalidates even outside the excerpt');
 let saved=JSON.parse(readFileSync(join(dir,'state.json')));assert.equal(saved.journal.spent,.002);assert(saved.journal.calls.every(c=>c.status==='completed'&&c.cost===.001));
 saved.journal.calls.push({id:'historical-unknown',reserved:2,status:'reserved'});writeFileSync(join(dir,'state.json'),JSON.stringify(saved));
 await assert.rejects((await session()).sourceNotes({...input,heading:'Uncached'}),/budget/);assert.equal(calls,2,'budget refusal never contacts provider');
 console.log('PASS source-notes request identity, prior reservation, settled cost, cross-build cache, full-tail invalidation and budget refusal');
}finally{rmSync(dir,{recursive:true,force:true});}
