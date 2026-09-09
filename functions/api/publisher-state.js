import { hmacHex } from '../lib/press-dispatch.js';
import { readLimitedText } from './preview.js';
import { PUBLISHER_MAX_CALLS } from '../lib/publisher-policy.js';
import {readPublisherSelection} from '../lib/publisher-selection.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}) {
  if (!['GET','POST'].includes(request.method)) return json({ok:false},405);
  const u=new URL(request.url); let b={};
  try { if(request.method==='POST') b=JSON.parse(await readLimitedText(request, 2_000_000)); } catch {return json({ok:false},400);}
  const id=Number(b.signup_id || u.searchParams.get('id')), sig=b.sig || u.searchParams.get('sig');
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN) return json({ok:false},403);
  const payload=request.method==='POST'?JSON.stringify(b.state):'';
  const message=request.method==='POST'?`publisher-state:${id}:${b.revision}:${payload}`:`publisher-state:${id}`;
  if(sig!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,message))return json({ok:false},403);
  try {
    if(request.method==='GET') {
      const selection=await readPublisherSelection(env.DB,id);
      if(u.searchParams.get('selection_only')==='1')return json({ok:true,selection});
      const row=await env.DB.prepare('SELECT revision,payload FROM publisher_state WHERE signup_id=?').bind(id).first();
      return json({ok:true,revision:row?.revision||0,state:row?JSON.parse(row.payload):null,selection});
    }
    if(!Number.isSafeInteger(b.revision)||b.revision<0||!b.state || !Array.isArray(b.state.journal?.calls) || b.state.journal.calls.length>PUBLISHER_MAX_CALLS || !Array.isArray(b.state.cache))return json({ok:false},400);
    const changed=await env.DB.prepare("INSERT INTO publisher_state (signup_id,revision,payload) SELECT ?,1,? WHERE ?=0 ON CONFLICT(signup_id) DO UPDATE SET revision=revision+1,payload=excluded.payload,updated_at=datetime('now') WHERE revision=?")
      .bind(id,payload,b.revision,b.revision).run();
    // Existing rows at nonzero revisions need UPDATE: SELECT above intentionally only creates revision zero.
    let n=changed.meta?.changes||0;
    if(!n && b.revision>0)n=(await env.DB.prepare("UPDATE publisher_state SET revision=revision+1,payload=?,updated_at=datetime('now') WHERE signup_id=? AND revision=?").bind(payload,id,b.revision).run()).meta?.changes||0;
    return json({ok:n===1,revision:b.revision+1},n===1?200:409);
  } catch {return json({ok:false},503);}
}
