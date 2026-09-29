import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {sourceRelay,refused,RELAY_ARCHIVE,RELAY_SAMPLE} from './lib/source-relay.mjs';
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('PASS',name);};
const token='fixture-relay-token',sign=m=>createHmac('sha256',token).update(m).digest('hex');
const now=()=>1_800_000_000_000;
await test('no token means no relay; only a 403 counts as refused',async()=>{
  assert.equal(sourceRelay({token:''}),null);
  assert(refused(Error('Source HTTP 403')));assert(refused(Error('403 https://x.substack.com/api/v1/archive')));assert(!refused(Error('Source HTTP 404')));assert(!refused(Error('Source HTTP 429 after bounded retries')));
});
await test('archive pages are signed for host and exact offset, including uneven offsets',async()=>{
  const seen=[];const relay=sourceRelay({token,now,fetchImpl:async url=>{seen.push(new URL(url));return Response.json([{id:1}]);}});
  assert.deepEqual(await relay.archive('chrislakin.substack.com',23),[{id:1}]);
  const u=seen[0];assert.equal(u.origin+u.pathname.replace(/\/$/,''),RELAY_ARCHIVE);assert.equal(u.searchParams.get('offset'),'23');
  assert.equal(u.searchParams.get('sig'),sign('chrislakin.substack.com:23'));
  assert.throws(()=>relay.archive('x.substack.com',1801),/out of range/);
});
await test('posts are read from the canonical custom domain and merged onto the archive row',async()=>{
  const row={id:7,slug:'anesthesia',title:'Anesthesia',canonical_url:'https://chrislakin.blog/p/anesthesia',section_name:'Essays',body_html:null};
  const seen=[];const relay=sourceRelay({token,now,fetchImpl:async url=>{seen.push(new URL(url));return Response.json({id:7,slug:'anesthesia',audience:'everyone',body_html:'<p>Body</p>'});}});
  const post=await relay.post(row,'chrislakin.substack.com');
  assert.equal(post.body_html,'<p>Body</p>');assert.equal(post.section_name,'Essays');assert.equal(post.canonical_url,row.canonical_url);
  const u=seen[0];assert.equal(u.origin+u.pathname.replace(/\/$/,''),RELAY_SAMPLE);assert.equal(u.searchParams.get('host'),'chrislakin.blog');
  assert.equal(u.searchParams.get('sig'),sign(`chrislakin.blog:sample:anesthesia:7:${Math.floor(now()/300000)}`));
  // A community post or missing canonical URL falls back to the publication host.
  await relay.post({...row,canonical_url:'https://chrislakin.blog/cp/1'},'chrislakin.substack.com');assert.equal(seen[1].searchParams.get('host'),'chrislakin.substack.com');
});
await test('a mismatched or failed relay answer is an error, never a substituted post',async()=>{
  const wrong=sourceRelay({token,now,fetchImpl:async()=>Response.json({id:8,slug:'other',body_html:'<p>x</p>'})});
  await assert.rejects(wrong.post({id:7,slug:'anesthesia'},'h.substack.com'),/different post/);
  const down=sourceRelay({token,now,fetchImpl:async()=>new Response('',{status:502})});
  await assert.rejects(down.archive('h.substack.com',0),/Relay HTTP 502/);
});
console.log(`${count} source relay checks passed`);
