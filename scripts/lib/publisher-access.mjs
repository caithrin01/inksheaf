// Account credit and an API key's allowance are independent limits. These
// read-only checks reserve nothing and never make an inference request.
const money=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
export async function readPublisherAccess({key,fetchImpl=fetch}){
  if(!key)throw Error('Publisher model credential is unavailable');
  const records=await Promise.all(['/key','/credits'].map(async path=>{
    const response=await fetchImpl('https://openrouter.ai/api/v1'+path,{
      headers:{Authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(20000),
    });
    if(!response.ok)throw Error(`Publisher access check failed (HTTP ${response.status})`);
    try{return (await response.json()).data;}catch{throw Error('Publisher access response is unavailable');}
  }));
  const [allowance,credits]=records;
  if(!allowance||!credits||!money(credits.total_credits)||!money(credits.total_usage)
    ||!(allowance.limit===null||money(allowance.limit))
    ||(allowance.limit!==null&&!money(allowance.limit_remaining)))
    throw Error('Publisher access response has no valid spending allowance');
  return {checked_at:new Date().toISOString(),
    account_credit_usd:Math.max(0,credits.total_credits-credits.total_usage),
    key_limit_usd:allowance.limit,key_remaining_usd:allowance.limit===null?null:allowance.limit_remaining};
}
export async function requirePublisherAccess({requiredUsd,...options}){
  if(!money(requiredUsd)||requiredUsd<=0)throw Error('A positive publisher reservation is required');
  const access=await readPublisherAccess(options);
  if(access.key_remaining_usd!==null&&access.key_remaining_usd<requiredUsd)
    throw Object.assign(Error('OpenRouter API key spending allowance is below the required reservation'),{code:'PUBLISHER_KEY_LIMIT',access});
  if(access.account_credit_usd<requiredUsd)
    throw Object.assign(Error('OpenRouter account credit is below the required reservation'),{code:'PUBLISHER_ACCOUNT_CREDIT',access});
  return access;
}
