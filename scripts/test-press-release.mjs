import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deployedPress,writeRelease,LEGACY_PRESS_SHA,PRESS_PROTOCOL} from './press-release.mjs';
let passed=0;const test=async(name,fn)=>{await fn();console.log('PASS',name);passed++;};
const valid={repository:'caithrin01/inksheaf',sha:'b'.repeat(40),protocol:PRESS_PROTOCOL};
await test('the press selects the deployed commit instead of merged main',async()=>{
  let request;const release=await deployedPress({requiredProtocol:PRESS_PROTOCOL,fetchImpl:async(url,options)=>{request={url,options};return Response.json(valid);}});
  assert.equal(release.sha,valid.sha);assert.equal(request.options.redirect,'error');assert.equal(request.options.cache,'no-store');
});
await test('only a legacy request can use the pinned pre-manifest release',async()=>{
  const fetchImpl=async()=>new Response('',{status:404});
  assert.equal((await deployedPress({fetchImpl})).sha,LEGACY_PRESS_SHA);
  await assert.rejects(deployedPress({fetchImpl,requiredProtocol:PRESS_PROTOCOL}));
});
await test('outage or a malformed manifest never selects a fallback',async()=>{
  for(const response of [new Response('',{status:503}),Response.json({...valid,sha:'main'}),Response.json({...valid,repository:'someone/else'}),Response.json({...valid,protocol:'future'}),new Response('<html>')])
    await assert.rejects(deployedPress({fetchImpl:async()=>response}));
});
await test('artifact contains the exact commit and disables manifest caching',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'inksheaf-release-'));writeRelease(valid.sha,dir);
  assert.deepEqual(JSON.parse(readFileSync(dir+'/inksheaf-press.json')),valid);
  assert.match(readFileSync(dir+'/_headers','utf8'),/Cache-Control: no-store/);
  assert.throws(()=>writeRelease('main',dir));
});
console.log(`${passed} press release compatibility checks passed`);
