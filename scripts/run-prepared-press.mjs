// No dependency installation on the customer path. The protected site artifact
// names one immutable image; its baked commit must match that deployed artifact.
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const PRESS_IMAGE=/^ghcr\.io\/caithrin01\/inksheaf-press@sha256:[a-f0-9]{64}$/;
export function preparedPressArgs({image,sha,output,env}){
  if(!PRESS_IMAGE.test(image)||!/^[a-f0-9]{40}$/.test(sha))throw Error('Invalid prepared press release');
  const names=['INKSHEAF_ENV','BOOK_ENGINE','PRESS_EVENT','SIGNUP_ID','PUBLICATION_URL','WRITER_EMAIL','PLAN_JSON','VERSION_ID','CHANGE_REQUEST','MAILING_ID','INVOICE_JSON','ADDRESSES_JSON','FILES_JSON','LEVEL','ARCHIVE_RELAY_TOKEN','PROOF_STORE_TOKEN','RESEND_API_KEY','LULU_CLIENT_KEY','LULU_CLIENT_SECRET','ANTHROPIC_API_KEY','OPENROUTER_API_KEY','OPERATOR_EMAIL','SITE_BASE','GITHUB_RUN_ID','PRESS_REQUESTED_AT'];
  return ['run','--rm','--init',...names.filter(n=>env[n]!=null).flatMap(n=>['--env',n]),'--env',`GITHUB_SHA=${sha}`,'--mount',`type=bind,source=${resolve(output)},target=/app/output`,image];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const image=process.argv[2],sha=process.env.PRESS_CODE_SHA,output=resolve('output'),started=Date.now();
  const args=preparedPressArgs({image,sha,output,env:process.env});mkdirSync(output,{recursive:true});
  const timing={started_at:new Date(started).toISOString(),code_sha:sha,image};
  try{
    execFileSync('docker',['pull',image],{stdio:'inherit'});timing.pull_ms=Date.now()-started;
    const actual=execFileSync('docker',['image','inspect','--format','{{index .Config.Labels "org.opencontainers.image.revision"}}',image],{encoding:'utf8'}).trim();
    if(actual!==sha)throw Error('Prepared press image does not match the deployed source commit');
    const runStarted=Date.now(),result=spawnSync('docker',args,{stdio:'inherit'});timing.press_ms=Date.now()-runStarted;
    if(result.error)throw result.error;process.exitCode=result.status??1;
  }finally{timing.total_ms=Date.now()-started;writeFileSync(output+'/press-runtime-timing.json',JSON.stringify(timing,null,2)+'\n');}
}
