// Bound concurrent readers' request starts and share server backoff. A slow
// response may overlap the next request; a 429 pauses every queued reader.
export function retryDelay(value,now=Date.now()){
  if(!value)return null;
  const seconds=Number(value);
  const delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
  return Number.isFinite(delay)?Math.max(0,delay):null;
}
export function sourceJsonClient({fetchImpl=fetch,headers={},intervalMs=350,timeoutMs=15000,maxAttempts=5,maxWaitMs=15000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  let next=0,queue=Promise.resolve(),failure;
  const slot=()=>{
    const work=queue.then(async()=>{while(next>now()){if(failure)throw failure;await sleep(next-now());}if(failure)throw failure;next=now()+intervalMs;});
    queue=work.catch(()=>{});return work;
  };
  return async url=>{
    for(let attempt=0;attempt<maxAttempts;attempt++){
      await slot();
      const r=await fetchImpl(url,{headers,redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});
      if(r.status!==429&&r.status<500){if(!r.ok)throw Error(`Source HTTP ${r.status}`);return r.json();}
      const delay=retryDelay(r.headers.get('retry-after'),now())??1500*(attempt+1);
      // Keep the shared pause even when this reader has exhausted its attempts.
      next=Math.max(next,now()+Math.min(delay,maxWaitMs));
      if(delay>maxWaitMs)failure=Error('Source asks for a longer retry delay; retrieval remains incomplete');
      await r.body?.cancel();
      if(failure)throw failure;
      if(attempt===maxAttempts-1)throw Error(`Source HTTP ${r.status} after bounded retries`);
    }
  };
}
