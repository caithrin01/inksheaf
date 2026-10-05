// The as-you-type Substack check: a JSON archive list is a Substack (named from its posts),
// anything else is not, an unreachable host is no site, and a refusal claims nothing. No network.
import assert from 'node:assert/strict';
import {detectSubstack,onRequest} from '../functions/api/detect.js';
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('PASS',name);};
const respond=(status,body,url='')=>({status,ok:status>=200&&status<300,url,json:async()=>{if(typeof body==='string')throw SyntaxError('not json');return body;}});
const post={publication_id:7,publishedBylines:[{publicationUsers:[{publication:{id:7,name:' Locally Optimal '}}]}]};
await test('an archive list is a Substack, named from its own posts',async()=>{
  const r=await detectSubstack('chrislakin.substack.com',{fetchImpl:async()=>respond(200,[post],'https://chrislakin.blog/api/v1/archive')});
  assert.deepEqual(r,{state:'substack',name:'Locally Optimal',host:'chrislakin.blog',posts:'some'});
});
await test('a page that is not an archive list is not a Substack',async()=>{
  assert.equal((await detectSubstack('nytimes.com',{fetchImpl:async()=>respond(404,'<html>')})).state,'not_substack');
  assert.equal((await detectSubstack('example.org',{fetchImpl:async()=>respond(200,{ok:true})})).state,'not_substack');
});
await test('an unreachable host is no site; a refusal or timeout claims nothing',async()=>{
  assert.equal((await detectSubstack('asdfqwerzxcv.com',{fetchImpl:async()=>{throw new TypeError('fetch failed');}})).state,'no_site');
  assert.deepEqual(await detectSubstack('x.substack.com',{fetchImpl:async()=>respond(403,'')}),{state:'unknown',status:403});
  assert.equal((await detectSubstack('x.substack.com',{fetchImpl:async()=>{throw Object.assign(Error('t'),{name:'TimeoutError'});}})).state,'unknown');
});
await test('a refused read is retried through the relay; a relay miss claims nothing',async()=>{
  const refused=async()=>respond(403,'');
  const found=await detectSubstack('chrislakin.substack.com',{fetchImpl:refused,relay:async h=>[post]});
  assert.equal(found.state,'substack');assert.equal(found.name,'Locally Optimal');
  assert.deepEqual(await detectSubstack('nytimes.com',{fetchImpl:refused,relay:async()=>null}),{state:'unknown',status:403});
  assert.equal((await detectSubstack('x.com',{fetchImpl:refused,relay:async()=>{throw Error('down');}})).state,'unknown');
});
await test('a bare custom domain is retried once on www',async()=>{
  const seen=[];const r=await detectSubstack('caithrin.com',{fetchImpl:async url=>{seen.push(new URL(url).hostname);return new URL(url).hostname==='www.caithrin.com'?respond(200,[post],url):respond(404,'');}});
  assert.equal(r.state,'substack');assert.deepEqual(seen,['caithrin.com','www.caithrin.com']);
});
await test('an address that is not a host is answered without a read',async()=>{
  const r=await onRequest({request:new Request('https://inksheaf.com/api/detect?url=not%20a%20url'),env:{}});
  assert.deepEqual(await r.json(),{ok:true,state:'invalid'});
});
console.log(`${n} detect checks passed`);
