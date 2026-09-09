// One durable inference ledger/cache per edition, shared by every volume and fit pass.
import { mkdirSync,readFileSync,existsSync,writeFileSync,renameSync } from 'node:fs';
import { createHash,createHmac } from 'node:crypto';
import { z } from 'zod';
import {LayoutDecisions,validateLayout,layoutBatches} from './publisher-layout.mjs';
import { openRouterPublisher,publishSelection,PUBLISHER_MODELS } from './publisher-agent.mjs';
import {currentPublisherSelection,selectionChanged} from './publisher-selection.mjs';
const LAYOUT_TASK = `Review the measured pages against the book's design. Return one decision for each supplied page.
The threshold is 30% unused body space. Every page above it needs an applicable repair or a specific design reason.
Use these structural facts and the complete printed_text:
- A complete short piece starts and finishes on ONE page. This book starts each independent piece on a new page. Trailing space after its complete text is intentional separation, whatever its genre: essay, interview, recipe, poem or dispatch. Inspect for an internal gap or content defect rather than objecting to the length of the source.
- Front and end matter have distinct jobs. A dedicated contents page or edition note does not need filler to reach a density target. Identify its actual purpose in the reason. Title leaves and binding versos also have a specific purpose.
- An ending on a MULTI-page article is different: a stranded tail or excessive gap needs repair unless the actual content gives a specific reason. The absence of a candidate is never itself a design reason.
Use only candidate_id operations supplied for that exact page. Never remove writing or invent a repair. Choose needs_review for unexplained space or content/overflow defects without an applicable repair. Do not excuse defects simply because a page has a structural purpose.
keep_figure_in_flow preserves the image at its original source position between paragraphs; use it when a floating image interrupts a paragraph continuation. collect_references moves the article's generated link list to the shared reference section, preserving every reference; it does not add filler to the flagged page.
printed_text_truncated tells you whether this request shortened the page text; do not infer missing print content from a shortened excerpt.
Give a factual reason under 180 characters. For intentional_space and needs_review, candidate_id must be null.`;
export async function publisherSession({directory, env=process.env, fetchImpl=fetch}) {
  mkdirSync(directory,{recursive:true});
  const file=`${directory}/state.json`, id=Number(env.SIGNUP_ID), site=env.SITE_BASE?.replace(/\/$/,''), secret=env.ARCHIVE_RELAY_TOKEN;
  const baseRun=String(env.GITHUB_RUN_ID||'local')+'.'+String(env.GITHUB_RUN_ATTEMPT||1);
  const remote=Boolean(id&&site&&secret);
  const sign=m=>createHmac('sha256',secret).update(m).digest('hex');
  let state={journal:{calls:[],spent:0},cache:[],runs:{}}, revision=0, selection={revision:0,restored:[]};
  async function request(path, options) {
    const response=await fetchImpl(site+path,{...options,signal:AbortSignal.timeout(20000)});
    const body=await response.json();if(!response.ok||!body.ok)throw Error('Publisher work could not be saved; the book is held for recovery');return body;
  }
  if(remote){const saved=await request(`/api/publisher-state?id=${id}&sig=${sign(`publisher-state:${id}`)}`);state=saved.state||state;revision=saved.revision;selection=saved.selection;}
  else if(existsSync(file))state=JSON.parse(readFileSync(file,'utf8'));
  if(!Number.isSafeInteger(selection?.revision)||!Array.isArray(selection?.restored))throw Error('Your saved selection is unavailable.');
  if(env.PUBLISHER_SELECTION_REVISION!=null&&Number(env.PUBLISHER_SELECTION_REVISION)!==selection.revision)throw selectionChanged();
  const run=baseRun+(selection.revision?'.s'+selection.revision:'');
  const ensureSelection=async()=>{if(remote&&(await currentPublisherSelection({env,fetchImpl})).revision!==selection.revision)throw selectionChanged();};
  state.runs||={};state.runs[run]||={sequence:0,keys:{}};
  const save=async()=>{
    writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file);
    if(remote){const payload=JSON.stringify(state);const saved=await request('/api/publisher-state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signup_id:id,revision,state,sig:sign(`publisher-state:${id}:${revision}:${payload}`)})});revision=saved.revision;}
  };
  const emit=async event=>{
    await ensureSelection();
    if(remote)event={...event,selection_revision:selection.revision};
    const payload=JSON.stringify(event),key=createHash('sha256').update(payload).digest('hex'),record=state.runs[run];
    if(record.keys[key])return;
    const sequence=record.sequence+1;
    if(remote)await request('/api/publisher-event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signup_id:id,run_id:run,sequence,event,sig:sign(`publisher:${id}:${run}:${sequence}:${payload}`)})});
    record.sequence=sequence;record.keys[key]=sequence;await save();
    // Public Actions logs contain stage/counts only, never private quotations or URLs.
    console.error(`[publisher] ${event.kind}${event.read!=null?` ${event.read}/${event.total}`:''}`);
  };
  const vision = async ({model,images,text,maxTokens}) => {
    await ensureSelection();
    const role = model === PUBLISHER_MODELS.reader.id ? 'reader' : model === PUBLISHER_MODELS.publisher.id ? 'publisher' : null;
    if (!role) throw Error('Page review model is outside the edition budget configuration');
    const buffers=images.map(path=>readFileSync(path));
    const key=createHash('sha256').update(JSON.stringify([model,text,buffers.map(b=>createHash('sha256').update(b).digest('hex'))])).digest('hex');
    const cache=new Map(state.cache);
    if(cache.has(key))return {text:JSON.stringify(cache.get(key)),usage:{prompt_tokens:0,completion_tokens:0,cost:0}};
    const schema=role==='reader'?z.object({findings:z.array(z.object({page:z.number().int().min(1),check:z.number().int().min(1).max(8),confidence:z.number().min(0).max(1),note:z.string().max(200)}))}):z.object({confirmed:z.boolean(),origin:z.enum(['rendered_layout','source_content','uncertain']),note:z.string().max(200)});
    const ask=openRouterPublisher({key:env.OPENROUTER_API_KEY,journal:state.journal,persist:save,fetchImpl});
    const answer=await ask({role,images:buffers,task:text+' Return only the requested JSON schema; notes must be under 200 characters.'+(role==='reader'?' Put the findings array in the findings field.':''),schema,maxOutput:maxTokens});
    const result=role==='reader'?answer.findings:answer;cache.set(key,result);state.cache=[...cache];await save();
    return {text:JSON.stringify(result),usage:state.journal.calls.at(-1)?.usage};
  };
  const layoutBatch=async input=>{
    await ensureSelection();
    if(!input.pages.length)return {decisions:[]};
    const key=createHash('sha256').update(JSON.stringify([LAYOUT_TASK,z.toJSONSchema(LayoutDecisions),input])).digest('hex'),cache=new Map(state.cache);
    if(cache.has(key))return validateLayout(cache.get(key),input);
    const ask=openRouterPublisher({key:env.OPENROUTER_API_KEY,journal:state.journal,persist:save,fetchImpl});
    const request={role:'publisher',schema:LayoutDecisions,data:input,maxOutput:5000,task:LAYOUT_TASK};
    let result;
    try{result=await ask(request);validateLayout(result,input);}catch(error){if(error.name!=='ZodError'&&error.code!=='PUBLISHER_LAYOUT_INVALID')throw error;result=await ask({...request,task:request.task+' The previous response failed validation: '+error.message+'. Check page coverage, candidate IDs, content-defect holds and character limits.'});}
    validateLayout(result,input);cache.set(key,result);state.cache=[...cache];await save();return result;
  };
  const layout=async input=>{
    const decisions=[];
    for(const batch of layoutBatches(input))decisions.push(...(await layoutBatch(batch)).decisions);
    return validateLayout({decisions},input);
  };
  return {emit,vision,layout,selection,read:async({posts,publication,identity,overrides,volume})=>{
    await ensureSelection();
    const cache=new Map(state.cache);
    const inference=openRouterPublisher({key:env.OPENROUTER_API_KEY,journal:state.journal,persist:save,fetchImpl});
    const ask=async request=>{await ensureSelection();return inference(request);};
    const ids=new Set(posts.map(p=>String(p.id??p.slug)));
    const restored=Object.fromEntries(selection.restored.filter(id=>ids.has(id)).map(id=>[id,'keep']));
    return publishSelection({posts,publication,identity,overrides:{...overrides,...restored},cache,ask,emit:e=>emit({...e,volume}),saveCache:async c=>{state.cache=[...c];await save();}});
  }, get spent(){return state.journal.spent;}};
}
