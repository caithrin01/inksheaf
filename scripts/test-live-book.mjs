import assert from 'node:assert/strict';
import {completeness} from './live-book/completeness.mjs';
import {createServer} from 'node:http';
import {sendAdapterError} from './live-book/http-error.mjs';
import {openRouterPublisher} from './lib/publisher-agent.mjs';
import {z} from 'zod';
const report={guestCuts:[{slug:'guest'}],ruleCuts:[],editorExcluded:3,mediaOnly:0};
const result=completeness({selected:[1,2,3,4,5],printed:[1],asides:[2],reports:[report],sourcePosts:[{id:3,slug:'guest'},{id:4,slug:'lost'}]});
assert.deepEqual(result.cut_by_rule,[{id:'3',slug:'guest',reason:'guest post'}]);
assert.deepEqual(result.missing,[{id:'4',slug:'lost'},{id:'5',slug:null}]);
assert.equal(completeness({selected:[6],printed:[],reports:[{mediaCuts:[{id:6,slug:'video',reason:'No printable text'}]}]}).missing.length,0);
assert.equal(completeness({selected:[7],printed:[],reports:[{editorExcluded:7,mediaOnly:7}]}).missing.length,1);
assert.equal(completeness({selected:[],printed:[1,2]}).selection_known,false,'an unplanned fallback cannot claim selected-post completeness');
console.log('PASS real report counts, named guest cuts, identified media cuts, unknown IDs and missing posts');
let attempts=0;
const server=createServer((req,res)=>{
 if(req.url==='/early'){sendAdapterError(res,Error('before headers'));return;}
 attempts++;
 if(attempts===1){res.writeHead(200,{'content-type':'application/json'});res.write('{');setTimeout(()=>sendAdapterError(res,Error('body timed out')),20);return;}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}],usage:{cost:.001}}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,journal={calls:[],spent:0};
try{
 const early=await fetch(origin+'/early');assert.equal(early.status,500);assert.match((await early.json()).error,/before headers/);
 const ask=openRouterPublisher({key:'fixture',journal,fetchImpl:()=>fetch(origin)});
 assert.deepEqual(await ask({role:'reader',task:'Read',schema:z.object({ok:z.boolean()})}),{ok:true});
 assert.equal(attempts,2);assert.equal(journal.calls.length,2);assert.equal(journal.calls[0].status,'failed');
 assert.equal(journal.calls[0].cost,undefined,'interrupted inference retains its unknown reservation');assert.equal(journal.calls[1].cost,.001);
 console.log('PASS interrupted provider stream survives in the harness, retries once and retains both receipts');
}finally{await new Promise(resolve=>server.close(resolve));}
