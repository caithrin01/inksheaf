import assert from 'node:assert/strict';
import {fetchArchive} from '../functions/api/preview.js';
const host='refusal-fixture.substack.com',relay='caithrin--inksheaf-archive-relay-archive.modal.run';
const pub={id:123,name:'Public Fixture',subdomain:'refusal-fixture'};
const posts=Array.from({length:9},(_,i)=>({id:i+1,title:`Essay ${i+1}`,wordcount:1800,type:'newsletter',publication:pub,publication_id:123,
 post_date:new Date(Date.now()-(i+1)*86400000).toISOString(),canonical_url:`https://${host}/p/essay-${i+1}`,
 audience:i===8?'only_paid':'everyone',publishedBylines:[{name:'Fixture Author'}]}));
const original=globalThis.fetch;let status=403,relays=0;
globalThis.fetch=async(raw,opts={})=>{
 const u=new URL(raw);assert.equal(opts.redirect,'manual');
 if(u.hostname===relay){relays++;assert.equal(u.searchParams.get('host'),host);assert.equal(u.searchParams.get('mode'),'all');assert.match(u.searchParams.get('sig'),/^[a-f0-9]{64}$/);return new Response(JSON.stringify(posts),{headers:{'x-archive-complete':'1'}});}
 assert.ok([host,'www.'+host].includes(u.hostname));return new Response('',{status});
};
const env={ARCHIVE_RELAY_TOKEN:'fixture-token',DB:{prepare(){return{bind(){return this},async first(){return null}}}}};
try{
 const result=await fetchArchive(host,env);
 assert.equal(result.ok,true);assert.equal(result.data.publication,pub.name);assert.equal(result.data.fetch_mode,'relay');assert.equal(relays,1);
 assert.equal(result.data.public_posts,8);assert.equal(result.data.paid_posts,1);assert.equal(result.data.words,8*1800);
 console.log('PASS public archive 403 uses one authenticated existing relay; paid content stays excluded');
 for(const code of [401,404]){status=code;relays=0;const r=await fetchArchive(host,env);assert.equal(r.ok,false);assert.equal(r.error,'not_substack');assert.equal(r.upstream,code);assert.equal(relays,0);console.log(`PASS direct ${code} does not invoke the relay`);}
}finally{globalThis.fetch=original;}
