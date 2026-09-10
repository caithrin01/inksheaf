import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publisherSession} from './lib/publisher-session.mjs';
const directory=mkdtempSync(join(tmpdir(),'inksheaf-layout-batch-')),env={OPENROUTER_API_KEY:'fixture'};
const input={pdf_hash:'same-checked-pdf',pages:Array.from({length:14},(_,i)=>({page:i+1,findings:[],printed_text:'A complete short poem.',unused_body_fraction_lower_bound:.5})),candidates:[]};
const counts=[];let failSecond=true;
const fetchImpl=async(url,opts)=>{
 const body=JSON.parse(opts.body),data=JSON.parse(body.messages[1].content.split('\n\nSource data:\n')[1]);
 counts.push(data.pages.length);assert(data.pages.length<=6);
 if(failSecond&&data.pages[0].page===7){failSecond=false;return Response.json({choices:[{finish_reason:'length'}],usage:{cost:.002}});}
 return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:data.pages.map(p=>({page:p.page,decision:'intentional_space',candidate_id:null,reason:'The complete short poem has ended.'}))})}}],usage:{cost:.001}});
};
await assert.rejects((await publisherSession({directory,env,fetchImpl})).layout(input),/incomplete/);
const first=JSON.parse(readFileSync(directory+'/state.json'));assert.equal(first.journal.calls.length,2);assert.equal(first.journal.calls[1].status,'failed');
const result=await(await publisherSession({directory,env,fetchImpl})).layout(input);
assert.equal(result.decisions.length,14);assert.deepEqual(counts,[6,6,6,2]);
assert.equal(JSON.parse(readFileSync(directory+'/state.json')).journal.calls.length,4);
const replay=await(await publisherSession({directory,env,fetchImpl:()=>{throw Error('Cached review must not spend again');}})).layout(input);
assert.deepEqual(replay,result);
console.log('PASS six-page layout requests, partial recovery, retained failed cost, complete coverage and paid-call-free replay');
