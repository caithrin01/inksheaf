// Read-only post-deployment contract. No dispatch, email, upload or publishing.
import {createHash,createHmac} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';

const HOST='www.caithrin.com',SLUG='the-dream-of-ai-slide-decks-a-september',POST_ID=174572978;
const RELAY='https://caithrin--inksheaf-archive-relay-sample.modal.run';
const hash=text=>createHash('sha256').update(text).digest('hex');
export async function checkSampleRelay({secret,fetchImpl=fetch,now=Date.now()}={}){
  if(!secret)throw Error('Relay credential unavailable');
  const get=async url=>{
    try{return await fetchImpl(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000),headers:{accept:'application/json'}});}
    catch{throw Error('Public sample contract request could not complete');}
  };
  const body=async response=>{
    if(!response.ok)throw Error(`Public sample request returned HTTP ${response.status}`);
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2_000_000)throw Error('Public sample exceeded response limit');chunks.push(Buffer.from(value));}}
    finally{await reader.cancel();}
    let post;try{post=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Public sample returned invalid JSON');}
    if(post.id!==POST_ID||post.slug!==SLUG||post.audience!=='everyone'||post.is_published===false||typeof post.body_html!=='string'||!post.body_html.trim())throw Error('Public sample identity/content did not match');
    return post;
  };
  const url=new URL(RELAY);url.search=new URLSearchParams({host:HOST,slug:SLUG,post_id:String(POST_ID),sig:'invalid'});
  const denied=await get(url);await denied.body?.cancel();
  if(denied.status!==401)throw Error(`Invalid signature returned HTTP ${denied.status}; expected 401`);
  const reference=await body(await get(`https://${HOST}/api/v1/posts/${SLUG}`));
  const bucket=Math.floor(now/300000);
  url.searchParams.set('sig',createHmac('sha256',secret).update(`${HOST}:sample:${SLUG}:${POST_ID}:${bucket}`).digest('hex'));
  const relayed=await body(await get(url));
  if(hash(relayed.body_html)!==hash(reference.body_html))throw Error('Relayed public body differs from the direct reference');
  return{checked_at:new Date(now).toISOString(),invalid_signature_status:401,public_sample_status:200,post_id:POST_ID,body_sha256:hash(relayed.body_html),body_matches:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const secret=process.env.ARCHIVE_RELAY_TOKEN||readFileSync(homedir()+'/.secrets/inksheaf-relay-token','utf8').trim();
    const result=await checkSampleRelay({secret});
    const index=process.argv.indexOf('--out');if(index!==-1){if(!process.argv[index+1])throw Error('Missing evidence path');writeFileSync(process.argv[index+1],JSON.stringify(result,null,2)+'\n');}
    console.log(JSON.stringify(result));
  }catch(error){console.error(error.code==='ENOENT'?'Relay credential unavailable':error.message);process.exitCode=1;}
}
