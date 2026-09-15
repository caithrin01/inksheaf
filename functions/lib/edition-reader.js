// The finished reader is bound to a committed version and its original ready event.
// It never signs a new proof-store URL or extends that event's expiry.
export const EDITION_MAX_BYTES=150_000_000;
export const privateHeaders={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex, nofollow','x-content-type-options':'nosniff'};
export function validReaderMap(map,total){
  if(!Number.isSafeInteger(total)||total<1||total>10000||!map||!Array.isArray(map.folios)||!Array.isArray(map.labels)||!Array.isArray(map.prose))return false;
  const ranges=(rows,folio=false)=>{let end=0;return rows.every(r=>Array.isArray(r)&&r.length===(folio?3:2)&&Number.isSafeInteger(r[0])&&Number.isSafeInteger(r[1])&&r[0]>end&&r[1]>=r[0]&&r[1]<=total&&(!folio||Number.isSafeInteger(r[2])&&r[2]>=0)&&(end=r[1]));};
  return Boolean(ranges(map.folios,true)&&ranges(map.prose)&&map.labels.length<=total&&map.labels.every(r=>Array.isArray(r)&&r.length===2&&Number.isSafeInteger(r[0])&&r[0]>=1&&r[0]<=total&&typeof r[1]==='string'&&r[1].length>0&&r[1].length<=80&&!map.folios.some(([a,b])=>a<=r[0]&&b>=r[0]))&&new Set(map.labels.map(r=>r[0])).size===map.labels.length);
}
export function readerPages(map,total){
  return Array.from({length:total},(_,i)=>{const number=i+1,folio=map.folios.find(([a,b])=>a<=number&&b>=number);return {number,label:folio?`Page ${folio[2]+number-folio[0]}`:map.labels.find(([p])=>p===number)?.[1]||`Leaf ${number}`,text_mode:map.prose.some(([a,b])=>a<=number&&b>=number)?'prose':'lines'};});
}
export function finishedVolumes(version,event,revision){
  if(!version||version.status==='superseded'||event?.kind!=='ready'||event.version_id!==version.id||(version.selection_revision??0)!==revision||(event.selection_revision??0)!==revision)return null;
  let volumes;try{volumes=JSON.parse(version.volumes);}catch{return null;}
  const expiry=Date.parse(event.expires_at);
  if(!Number.isFinite(expiry)||!Array.isArray(volumes)||!volumes.length||volumes.length>24||!Array.isArray(event.files)||event.files.length!==volumes.length)return null;
  const result=[];
  for(const [i,v] of volumes.entries()){
    const file=event.files[i];let source;try{source=new URL(file.url);}catch{return null;}
    if(typeof v.label!=='string'||!v.label||v.label.length>120||!/^proofs\/[a-z0-9][a-z0-9-]{0,63}\/i-[a-f0-9]{12}\.pdf$/.test(v.key)||!/^[a-f0-9]{64}$/.test(v.sha256)||!v.key.endsWith(`i-${v.sha256.slice(0,12)}.pdf`)||!validReaderMap(v.reader_map,v.pages)||file.label!==v.label||file.pages!==v.pages)return null;
    if(source.origin!=='https://caithrin--inksheaf-proof-store-web.modal.run'||source.pathname!=='/proof'||source.username||source.password||source.hash||[...source.searchParams.keys()].sort().join(',')!=='exp,key,sig'||source.searchParams.get('key')!==v.key||!/^[a-f0-9]{64}$/.test(source.searchParams.get('sig')||'')||!/^\d+$/.test(source.searchParams.get('exp')||''))return null;
    const exp=Number(source.searchParams.get('exp'));
    if(!Number.isSafeInteger(exp)||exp<=0||exp*1000>expiry)return null;
    result.push({volume:String(i+1),label:v.label,pages:v.pages,sha256:v.sha256,reader_map:v.reader_map,source:source.href,expires_at:Math.min(exp*1000,expiry)});
  }
  return result;
}
export async function readFinishedEdition(DB,id,run,sequence,versionId){
  const current=await DB.prepare('SELECT run_id FROM publisher_events WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
  const version=await DB.prepare('SELECT id,status,volumes,selection_revision FROM edition_versions WHERE signup_id=? ORDER BY id DESC LIMIT 1').bind(id).first();
  const row=await DB.prepare("SELECT sequence,payload FROM publisher_events WHERE signup_id=? AND run_id=? AND kind='ready' ORDER BY sequence DESC LIMIT 1").bind(id,run).first();
  const selection=await DB.prepare('SELECT revision FROM publisher_selections WHERE signup_id=?').bind(id).first();
  if(current?.run_id!==run||version?.id!==versionId||row?.sequence!==sequence)return null;
  let event;try{event=JSON.parse(row.payload);}catch{return null;}
  return finishedVolumes(version,event,selection?.revision??0);
}
