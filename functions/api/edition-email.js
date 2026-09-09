import {hmacHex} from '../lib/press-dispatch.js';
import {sendQueuedEmail} from '../lib/email-outbox.js';
import {readLimitedText} from './preview.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}){
  if(request.method!=='POST')return json({ok:false},405);
  let b;try{b=JSON.parse(await readLimitedText(request,2000));}catch{return json({ok:false},400);}
  const id=Number(b.id);
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN||b.sig!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition-email:${id}`))return json({ok:false},403);
  try{
    const row=await env.DB.prepare("SELECT e.id FROM email_outbox e JOIN edition_versions v ON v.id=e.version_id WHERE v.signup_id=? AND v.id=(SELECT MAX(id) FROM edition_versions WHERE signup_id=?) AND e.kind='proof-ready' ORDER BY e.created_ms DESC LIMIT 1").bind(id,id).first();
    if(!row)return json({ok:false,error:'Your PDF email is not ready to retry yet.'},409);
    const delivery=await sendQueuedEmail(env,row.id,{requireCurrentProof:true});
    return json({ok:true,delivery},delivery.accepted?200:202);
  }catch{return json({ok:false,error:'Your PDF is saved. Delivery could not be confirmed.'},503);}
}
