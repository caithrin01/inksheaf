import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pressTiming} from './lib/press-timing.mjs';
const dir=mkdtempSync(join(tmpdir(),'press-timing-'));
try{
 let now=2000;const file=join(dir,'timing.json'),trace=pressTiming(file,{requestedAt:new Date(1000).toISOString(),now:()=>now});
 trace.mark('worker_started');now=4000;trace.mark('workspace_ready',{pages:10,volumes:2,secret:'private-value',publication:'private-title'});
 const content=readFileSync(file,'utf8'),result=JSON.parse(content);assert(!/private-value|private-title/.test(content));assert.equal(result.events[1].dispatch_elapsed_ms,3000);assert.equal(result.events[1].worker_elapsed_ms,2000);assert.equal(result.events[1].pages,10);assert.throws(()=>trace.mark('private-title'));
 console.log('PASS dispatch/worker clocks and timing artifact excludes private fields');
}finally{rmSync(dir,{recursive:true,force:true});}
