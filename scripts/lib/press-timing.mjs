import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
// Public diagnostic artifact: fixed phase names and numeric counts only.
// Private publication identity, source text, URLs and credentials never enter it.
export function pressTiming(file,{requestedAt='',now=Date.now}={}){
  const started=now(),requested=Date.parse(requestedAt),events=[];
  const phases=new Set(['worker_started','publication_identity_started','publication_identity_finished','volume_started','draft_available','volume_accepted','upload_started','upload_finished','version_saved','workspace_ready','operator_mail_finished','creator_mail_finished','stopped']);
  return {mark(phase,counts={}){
    if(!phases.has(phase))throw Error('Unknown press timing phase');
    const at=now(),event={phase,at:new Date(at).toISOString(),worker_elapsed_ms:at-started};
    if(Number.isFinite(requested)&&requested<=started)event.dispatch_elapsed_ms=at-requested;
    for(const key of ['volume','pages','volumes','round'])if(Number.isSafeInteger(counts[key])&&counts[key]>=0)event[key]=counts[key];
    events.push(event);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({version:1,scope:'Worker and dispatch timings; browser rendering and inbox receipt require separate observation.',events},null,2)+'\n');
  }};
}
