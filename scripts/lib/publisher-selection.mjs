import {createHmac} from 'node:crypto';
export const selectionChanged=()=>Object.assign(Error('Your selection changed; the publisher is picking up your correction.'),{code:'PUBLISHER_SELECTION_CHANGED'});
export async function currentPublisherSelection({env=process.env,fetchImpl=fetch}={}) {
  const id=Number(env.SIGNUP_ID),secret=env.ARCHIVE_RELAY_TOKEN,site=env.SITE_BASE?.replace(/\/$/,'');
  if(!id||!secret||!site)return {revision:0,restored:[]};
  const sig=createHmac('sha256',secret).update(`publisher-state:${id}`).digest('hex');
  const response=await fetchImpl(`${site}/api/publisher-state?id=${id}&sig=${sig}&selection_only=1`,{signal:AbortSignal.timeout(20000),cache:'no-store'});
  const body=await response.json();
  if(!response.ok||!body.ok||!Number.isSafeInteger(body.selection?.revision)||!Array.isArray(body.selection?.restored))throw Error('Your saved selection could not be checked. The book is held for recovery.');
  return body.selection;
}
// A correction invalidates an older build, never its reading cache or spend.
// Commit must also enforce this revision atomically at the version store.
export async function withPublisherSelection({load,build,commit,onChange=async()=>{},maxAttempts=4}) {
  for(let attempt=0;attempt<maxAttempts;attempt++){
    const selection=await load();
    try{
      const book=await build(selection);
      if((await load()).revision!==selection.revision)throw selectionChanged();
      return await commit(book,selection);
    }catch(error){
      const current=await load();
      if(current.revision===selection.revision)throw error;
      await onChange(current);
      if(attempt===maxAttempts-1)throw Error('Your changes are saved. The publisher needs to resume this edition before it can finish.');
    }
  }
}
