import {hmacHex} from '../lib/press-dispatch.js';
import {newRenderBudget} from '../lib/publisher-render-budget.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}){
  if(request.method!=='POST')return json({ok:false},405);
  let body;try{body=await request.json();}catch{return json({ok:false},400);}
  const id=Number(body.signup_id),revision=Number(body.revision),key=body.request_key;
  if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(revision)||revision<1||!/^[-a-zA-Z0-9]{16,80}$/.test(key||'')||!env.ARCHIVE_RELAY_TOKEN)return json({ok:false},403);
  if(body.sig!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`publisher-restart:${id}:${revision}:${key}`))return json({ok:false},403);
  try{
    const saved=await env.DB.prepare('SELECT signup_id,revision FROM publisher_recovery_history WHERE request_key=?').bind(key).first();
    if(saved)return json({ok:saved.signup_id===id&&saved.revision===revision,replayed:true},saved.signup_id===id&&saved.revision===revision?200:409);
    const state={journal:{calls:[],spent:0},cache:[],runs:{},renderBudget:newRenderBudget(),recovery:{request_key:key,previous_revision:revision}};
    // D1 batches are transactional. The revision and failed status predicates
    // protect both writes against a worker resuming between the dry run and reset.
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO publisher_recovery_history(request_key,signup_id,revision,payload)
        SELECT ?,s.signup_id,s.revision,s.payload FROM publisher_state s JOIN press p ON p.signup_id=s.signup_id
        WHERE s.signup_id=? AND s.revision=? AND p.status='failed'`).bind(key,id,revision),
      env.DB.prepare(`UPDATE publisher_state SET revision=revision+1,payload=?,updated_at=datetime('now')
        WHERE signup_id=? AND revision=? AND EXISTS(SELECT 1 FROM publisher_recovery_history WHERE request_key=? AND signup_id=? AND revision=?)
        AND EXISTS(SELECT 1 FROM press WHERE signup_id=? AND status='failed')`).bind(JSON.stringify(state),id,revision,key,id,revision,id),
    ]);
    if(result[0].meta?.changes!==1||result[1].meta?.changes!==1)return json({ok:false,error:'The book is active or its saved attempt changed. Inspect it before restarting.'},409);
    return json({ok:true,revision:revision+1,archived_revision:revision});
  }catch{return json({ok:false,error:'The failed attempt could not be archived; restart was not confirmed.'},503);}
}
