// A read-only private workspace. Knowing a signup number or email cannot open it.
import { hmacHex } from '../lib/press-dispatch.js';
import {readPublisherSelection} from '../lib/publisher-selection.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow'}});
export async function onRequest({request,env}) {
  if(request.method!=='GET')return json({ok:false},405);
  const u=new URL(request.url),id=Number(u.searchParams.get('id'));
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN||u.searchParams.get('sig')!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition:${id}`))return json({ok:false,error:'This private link is incomplete. Open the link from your Inksheaf email.'},403);
  try {
    const row=await env.DB.prepare('SELECT publication_url,email,plan_json,dispatch_status FROM signups WHERE id=?').bind(id).first();
    if(!row)return json({ok:false,error:'Edition not found.'},404);
    const press=await env.DB.prepare('SELECT status,updated_at FROM press WHERE signup_id=?').bind(id).first();
    const latest=await env.DB.prepare('SELECT run_id FROM publisher_events WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
    const events=latest?(await env.DB.prepare('SELECT sequence,payload,created_at FROM publisher_events WHERE signup_id=? AND run_id=? ORDER BY sequence LIMIT 1000').bind(id,latest.run_id).all()).results:[];
    const version=await env.DB.prepare('SELECT id,status FROM edition_versions WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
    const selection=await readPublisherSelection(env.DB,id);
    const email=version?await env.DB.prepare("SELECT send_status AS status,delivery_status FROM email_outbox WHERE version_id=? AND kind='proof-ready' ORDER BY created_ms DESC LIMIT 1").bind(version.id).first():null;
    let plan;try{plan=JSON.parse(row.plan_json||'null');}catch{}
    return json({ok:true,id,publication_url:row.publication_url,email:row.email,design:plan?.design||null,status:press?.status||row.dispatch_status||'queued',run_id:latest?.run_id||null,
      selection,restore_sig:version?null:await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition-restore:${id}`),
      events:events.map(e=>({...JSON.parse(e.payload),sequence:e.sequence,created_at:e.created_at})),email_status:email?.delivery_status||email?.status||null, retry_email_sig:email?await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition-email:${id}`):null,
      change_url:version?`/change?id=${id}&sig=${await hmacHex(env.ARCHIVE_RELAY_TOKEN,`change:${id}`)}`:null});
  }catch{return json({ok:false,error:'Your book is saved. We could not refresh its progress just now.'},503);}
}
