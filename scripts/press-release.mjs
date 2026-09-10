// The protected Pages artifact selects compatible press code. A merge alone must
// not enable callbacks/migrations that production has not received yet.
import {appendFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export const LEGACY_PRESS_SHA='a560d91a6d4862989b9ea02769945fd9477c0ea8';
export const PRESS_PROTOCOL='publisher-v1';
const shaPattern=/^[a-f0-9]{40}$/;
export async function deployedPress({fetchImpl=fetch,requiredProtocol=''}={}){
  const response=await fetchImpl('https://inksheaf.com/inksheaf-press.json',{
    headers:{'cache-control':'no-cache'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000),
  });
  // This one pinned legacy release predates the manifest. Never fall back on
  // outages, malformed manifests, or a request from the new free-PDF flow.
  if(response.status===404&&!requiredProtocol)return {sha:LEGACY_PRESS_SHA,protocol:'legacy'};
  if(!response.ok)throw Error('The deployed press release could not be confirmed');
  const body=await response.json();
  if(body.repository!=='caithrin01/inksheaf'||!shaPattern.test(body.sha)||body.protocol!==PRESS_PROTOCOL)
    throw Error('Invalid deployed press release');
  if(requiredProtocol&&body.protocol!==requiredProtocol)throw Error('The deployed site does not support this press request');
  return {sha:body.sha,protocol:body.protocol};
}
export function writeRelease(sha,directory='dist'){
  if(!shaPattern.test(sha))throw Error('A full commit SHA is required for the press release');
  mkdirSync(directory,{recursive:true});
  writeFileSync(directory+'/inksheaf-press.json',JSON.stringify({repository:'caithrin01/inksheaf',sha,protocol:PRESS_PROTOCOL})+'\n');
  appendFileSync(directory+'/_headers','\n/inksheaf-press.json\n  Cache-Control: no-store\n  X-Robots-Tag: noindex\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv[2]==='write')writeRelease(process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
  else if(process.argv[2]==='select'){
    const release=await deployedPress({requiredProtocol:process.env.PRESS_PROTOCOL_REQUIRED||''});
    if(!process.env.GITHUB_OUTPUT)throw Error('This selector runs inside the press workflow');
    appendFileSync(process.env.GITHUB_OUTPUT,`sha=${release.sha}\n`);
    console.log(`Deployed press: ${release.sha} (${release.protocol})`);
  }else throw Error('Use write or select');
}
