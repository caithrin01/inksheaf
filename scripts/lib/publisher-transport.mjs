// Only the publisher's read endpoints, idempotent events and revision-bound
// state saves use this transport. A lost save response must be reconciled
// against durable state before any paid request can proceed.
const transientStatus=status=>status===408||status===429||status>=500;
const networkError=error=>['AbortError','TimeoutError'].includes(error?.name)
  ||error instanceof TypeError&&/fetch|network|terminated/i.test(error.message)
  ||/^(UND_ERR_|ECONNRESET|ETIMEDOUT|EAI_AGAIN)/.test(error?.cause?.code||error?.code||'');
const held=(detail,transient=false)=>Object.assign(Error(`Publisher work could not be saved; the book is held for recovery (${detail})`),{code:'PUBLISHER_STATE_UNAVAILABLE',transient});
export function publisherTransport({site,fetchImpl=fetch,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  async function once(path,options){
    let response;
    try{response=await fetchImpl(site+path,{...options,signal:AbortSignal.timeout(20000)});}
    catch(error){if(!networkError(error))throw error;throw held('network response unavailable',true);}
    let body;
    try{body=await response.json();}
    catch{throw held(`HTTP ${response.status}, invalid JSON`,response.ok||transientStatus(response.status));}
    if(!response.ok||body?.ok!==true)throw held(`HTTP ${response.status}`,transientStatus(response.status));
    return body;
  }
  async function request(path,options={},stateWrite){
    const method=options.method||'GET',pathname=path.split('?')[0];
    const retryable=method==='GET'||method==='POST'&&(pathname==='/api/publisher-event'||pathname==='/api/publisher-state'&&stateWrite);
    // Capture the exact serialized write, independent of concurrent in-memory
    // journal updates. Never regenerate a payload during a transport retry.
    const frozen={...options};
    for(let attempt=0;;attempt++){
      try{return await once(path,frozen);}
      catch(error){
        if(!error.transient||!retryable)throw error;
        if(stateWrite){
          const saved=await request(stateWrite.readPath,{cache:'no-store'});
          if(saved.revision===stateWrite.revision+1&&JSON.stringify(saved.state)===stateWrite.payload)return {ok:true,revision:saved.revision};
          // An unchanged revision permits retrying this same CAS. Any other
          // payload or revision belongs to conflicting work and remains held.
          if(saved.revision!==stateWrite.revision)throw held('saved revision changed');
        }
        if(attempt>=2)throw error;
        await wait([500,1500][attempt]);
      }
    }
  }
  return request;
}
