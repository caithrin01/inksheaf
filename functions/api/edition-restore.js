// Save one creator correction before the first complete PDF exists. No archive
// fetch, inference reset, duplicate press dispatch or email is needed here.
import {hmacHex} from '../lib/press-dispatch.js';
import {readLimitedText} from './preview.js';
import {readPublisherSelection} from '../lib/publisher-selection.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}) {
  if(request.method!=='POST')return json({ok:false},405);
  let b;try{b=JSON.parse(await readLimitedText(request,4000));}catch{return json({ok:false},400);}
  const id=Number(b.id),post=String(b.post_id||'');
  if(!Number.isSafeInteger(id)||id<1||!env.ARCHIVE_RELAY_TOKEN||b.sig!==await hmacHex(env.ARCHIVE_RELAY_TOKEN,`edition-restore:${id}`))return json({ok:false},403);
  if(!/^[a-zA-Z0-9._:-]{1,200}$/.test(post))return json({ok:false,error:'This piece could not be identified.'},400);
  try{
    const current=await readPublisherSelection(env.DB,id);
    if(current.restored.includes(post))return json({ok:true,selection:current});
    // A restart may have emitted its identity before replaying the reading. Keep
    // earlier source-backed exclusions actionable during that transition.
    const excluded=await env.DB.prepare(`SELECT 1 AS found FROM publisher_events e,
      json_each(e.payload,'$.decisions') d WHERE e.signup_id=? AND e.kind='reading'
      AND CAST(json_extract(d.value,'$.post_id') AS TEXT)=?
      AND json_extract(d.value,'$.decision')='set_aside' LIMIT 1`).bind(id,post).first();
    if(!excluded)return json({ok:false,error:'Only a piece set aside from this edition can be restored here.'},400);
    const path='$.'+JSON.stringify(post);
    await env.DB.prepare(`INSERT INTO publisher_selections (signup_id,revision,restored_json)
      SELECT ?,1,json_object(?,'keep') WHERE NOT EXISTS (SELECT 1 FROM edition_versions WHERE signup_id=?)
      ON CONFLICT(signup_id) DO UPDATE SET revision=revision+1,
        restored_json=json_set(publisher_selections.restored_json,?,'keep'),updated_at=datetime('now')
      WHERE json_extract(publisher_selections.restored_json,?) IS NOT 'keep'
        AND NOT EXISTS (SELECT 1 FROM edition_versions WHERE signup_id=?)`).bind(id,post,id,path,path,id).run();
    const selection=await readPublisherSelection(env.DB,id);
    if(!selection.restored.includes(post))return json({ok:false,error:'Your first PDF has finished. Use Adjust this edition to put this piece back.',change_url:`/change?id=${id}&sig=${await hmacHex(env.ARCHIVE_RELAY_TOKEN,`change:${id}`)}`},409);
    return json({ok:true,selection});
  }catch{return json({ok:false,error:'We could not save that change. Please try again.'},503);}
}
