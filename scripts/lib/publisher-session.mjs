// One durable inference ledger/cache per edition, shared by every volume and fit pass.
import { mkdirSync,readFileSync,existsSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { z } from 'zod';
import {LayoutDecisions,validateLayout,layoutBatches} from './publisher-layout.mjs';
import { openRouterPublisher,publishSelection,PUBLISHER_MODELS,PUBLISHER_CACHE_POLICY } from './publisher-agent.mjs';
import {currentPublisherSelection,selectionChanged} from './publisher-selection.mjs';
import {newRenderBudget,renderUsage,reserveRenderWork} from '../../functions/lib/publisher-render-budget.js';
import {saveRenderCheckpoint,restoreRenderCheckpoint} from './render-checkpoint.mjs';
import {checkpointStore as privateCheckpointStore} from './proof-store.mjs';
const REVIEW_POLICY = createHash('sha256').update(PUBLISHER_CACHE_POLICY);
for(const name of ['publisher-session.mjs','publisher-layout.mjs','paragraph-boundaries.mjs','page-review.mjs','fit.mjs','typst-emit.mjs'])REVIEW_POLICY.update(readFileSync(new URL(name,import.meta.url)));
for(const name of ['render-book.sh','pdf-whitespace-audit.py','blank-measure.py'])REVIEW_POLICY.update(readFileSync(new URL('../'+name,import.meta.url)));
export const PUBLISHER_REVIEW_POLICY=REVIEW_POLICY.digest('hex');
export const publisherReviewCacheKey=({model,task,schema,input={},imageHashes=[],maxTokens,policy=PUBLISHER_REVIEW_POLICY})=>createHash('sha256')
  .update(JSON.stringify({policy,model,task,schema:z.toJSONSchema(schema),input,imageHashes,maxTokens})).digest('hex');
const LAYOUT_TASK = `Review the measured pages against the book's design. Return one decision for each supplied page.
The threshold is 30% unused body space. Every page above it needs an applicable repair or a specific design reason.
Use these structural facts and the complete printed_text:
- A complete short piece starts and finishes on ONE page. This book starts each independent piece on a new page. Trailing space after its complete text is intentional separation, whatever its genre: essay, interview, recipe, poem or dispatch. Inspect for an internal gap or content defect rather than objecting to the length of the source.
- Front and end matter have distinct jobs. A dedicated contents page or edition note does not need filler to reach a density target. Identify its actual purpose in the reason. Title leaves and binding versos also have a specific purpose.
- An ending on a MULTI-page article is different: a stranded tail or excessive gap needs repair unless the actual content gives a specific reason. The absence of a candidate is never itself a design reason.
adjacent_layout supplies the previous page's ending, the current ending and the next page's opening: actual printed lines (including captions), image rectangles, source figure IDs/sizes and compiled paragraph anchors. All coordinates are physical PDF points. Compare trailing_space_points with the following image and surrounding text/spacing. An image taller than the gap cannot fit there at its current size, but that alone does not prove its size or the gap is well designed. Check the source sequence, caption and reading role; never shrink a chart merely to fill space. same_article distinguishes a continuation from the next independent piece. Paragraph anchors describe compiled positions and may lie on the next page at a boundary; consult the printed lines before claiming a paragraph actually continues. Missing geometry is unknown, never zero. Truncated context is explicitly marked. A specific intentional-space reason must name the actual content or structural constraint, not just a chapter ending or lack of repair candidates.
Use only candidate_id operations supplied for that exact page. Never remove writing or invent a repair. Choose needs_review for unexplained space or content/overflow defects without an applicable repair. Do not excuse defects simply because a page has a structural purpose.
keep_figure_in_flow preserves the image at its original source position between paragraphs; use it when a floating image interrupts a paragraph continuation. collect_references moves the article's generated link list to the shared reference section, preserving every reference; it does not add filler to the flagged page.
set_figure_reading_size enlarges an existing image without cropping or changing pixels. Use it for an image-too-small finding: column uses the full available width, landscape turns a wide chart a quarter turn inside the portrait book. Prefer column when adequate. Neither mode proves readability; the new PDF must be checked. Never treat unresolved illegibility as intentional space.
printed_text_truncated tells you whether this request shortened the page text; do not infer missing print content from a shortened excerpt.
Give a factual reason under 180 characters. For intentional_space and needs_review, candidate_id must be null.`;
export async function publisherSession({directory, env=process.env, fetchImpl=fetch, checkpointStore}) {
  mkdirSync(directory,{recursive:true});
  const file=`${directory}/state.json`, id=Number(env.SIGNUP_ID), site=env.SITE_BASE?.replace(/\/$/,''), secret=env.ARCHIVE_RELAY_TOKEN;
  const baseRun=String(env.GITHUB_RUN_ID||'local')+'.'+String(env.GITHUB_RUN_ATTEMPT||1);
  const remote=Boolean(id&&site&&secret);
  const artifacts=checkpointStore||(remote?privateCheckpointStore(`signup-${id}`):null);
  const sign=m=>createHmac('sha256',secret).update(m).digest('hex');
  let state={journal:{calls:[],spent:0},cache:[],runs:{},renderBudget:newRenderBudget()}, revision=0, selection={revision:0,restored:[]};
  let localSnapshot=existsSync(file)?readFileSync(file,'utf8'):null;
  async function request(path, options) {
    const response=await fetchImpl(site+path,{...options,signal:AbortSignal.timeout(20000)});
    const body=await response.json();if(!response.ok||!body.ok)throw Error('Publisher work could not be saved; the book is held for recovery');return body;
  }
  if(remote){const saved=await request(`/api/publisher-state?id=${id}&sig=${sign(`publisher-state:${id}`)}`);state=saved.state||state;revision=saved.revision;selection=saved.selection;}
  else if(localSnapshot!=null)state=JSON.parse(localSnapshot);
  if(!Number.isSafeInteger(selection?.revision)||!Array.isArray(selection?.restored))throw Error('Your saved selection is unavailable.');
  if(env.PUBLISHER_SELECTION_REVISION!=null&&Number(env.PUBLISHER_SELECTION_REVISION)!==selection.revision)throw selectionChanged();
  const run=baseRun+(selection.revision?'.s'+selection.revision:'');
  const ensureSelection=async()=>{if(remote&&(await currentPublisherSelection({env,fetchImpl})).revision!==selection.revision)throw selectionChanged();};
  state.runs||={};state.runs[run]||={sequence:0,keys:{}};
  const save=async()=>{
    const payload=JSON.stringify(state),temporary=file+'.'+randomUUID()+'.tmp';
    if(remote){
      // Remote CAS is authoritative. Never start work on a reservation whose
      // acknowledgement was lost; its saved charge remains for reconciliation.
      const saved=await request('/api/publisher-state',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({signup_id:id,revision,state,sig:sign(`publisher-state:${id}:${revision}:${payload}`)})});revision=saved.revision;
      try{writeFileSync(temporary,payload,{mode:0o600});renameSync(temporary,file);}finally{if(existsSync(temporary))unlinkSync(temporary);}
      return;
    }
    // A stale rehearsal process must not overwrite another process's reserved
    // model/render work. A crashed lock holds safely for explicit recovery.
    let lock;
    try{lock=openSync(file+'.lock','wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('Publisher journal is locked by another worker; saved work is retained.');throw error;}
    try{
      writeFileSync(lock,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));
      const current=existsSync(file)?readFileSync(file,'utf8'):null;
      if(current!==localSnapshot)throw Error('Publisher journal changed in another worker; reopen the saved session.');
      writeFileSync(temporary,payload,{mode:0o600});renameSync(temporary,file);localSnapshot=payload;
    }finally{closeSync(lock);unlinkSync(file+'.lock');if(existsSync(temporary))unlinkSync(temporary);}
  };
  const reserveWork=async(volume,kind,settings)=>{
    await ensureSelection();
    const usage=reserveRenderWork(state,String(volume),kind,{id:randomUUID(),selection_revision:selection.revision,run_id:run,started:new Date().toISOString(),settings_hash:createHash('sha256').update(JSON.stringify(settings)).digest('hex')});
    await save();return usage;
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
    const schema=role==='reader'?z.object({findings:z.array(z.object({page:z.number().int().min(1),check:z.number().int().min(1).max(8),confidence:z.number().min(0).max(1),note:z.string().max(200)}))}):z.object({confirmed:z.boolean(),origin:z.enum(['rendered_layout','source_content','uncertain']),note:z.string().max(200)});
    const task=text+' Return only the requested JSON schema; notes must be under 200 characters.'+(role==='reader'?' Put the findings array in the findings field.':'');
    const key=publisherReviewCacheKey({model,task,schema,maxTokens,imageHashes:buffers.map(b=>createHash('sha256').update(b).digest('hex'))});
    const cache=new Map(state.cache);
    if(cache.has(key))return {text:JSON.stringify(cache.get(key)),usage:{prompt_tokens:0,completion_tokens:0,cost:0}};
    const ask=openRouterPublisher({key:env.OPENROUTER_API_KEY,journal:state.journal,persist:save,fetchImpl});
    const request={role,images:buffers,task,schema,maxOutput:maxTokens};
    let answer;
    try{answer=await ask(request);}catch(error){
      if(error.name!=='ZodError')throw error;
      // A complete answer can still violate the output schema (the live page-39
      // confirmation exceeded its note limit). Give it one bounded correction;
      // retain the failed charge, and never cache or truncate the invalid verdict.
      answer=await ask({...request,task:task+' The previous response failed schema validation: '+error.message+'. Recheck the specific defect and return a valid answer with a concise note under 200 characters.'});
    }
    const result=role==='reader'?answer.findings:answer;cache.set(key,result);state.cache=[...cache];await save();
    return {text:JSON.stringify(result),usage:state.journal.calls.at(-1)?.usage};
  };
  const layoutBatch=async input=>{
    await ensureSelection();
    if(!input.pages.length)return {decisions:[]};
    const key=publisherReviewCacheKey({model:PUBLISHER_MODELS.publisher.id,task:LAYOUT_TASK,schema:LayoutDecisions,input,maxTokens:5000}),cache=new Map(state.cache);
    if(cache.has(key))return validateLayout(cache.get(key),input);
    // Reuse completed larger batches with this same policy, but keep new reasoning
    // to six pages. A twelve-page review exhausted the completion ceiling before
    // returning any verdict. Smaller calls share the same ledger and cache.
    if(input.pages.length>6){
      const decisions=[];
      for(const batch of layoutBatches(input,6))decisions.push(...(await layoutBatch(batch)).decisions);
      const result=validateLayout({decisions},input);cache.clear();for(const pair of state.cache)cache.set(...pair);
      cache.set(key,result);state.cache=[...cache];await save();return result;
    }
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
  const renderScope=volume=>{
    renderUsage(state,String(volume));
    const record=state.renderBudget.volumes[String(volume)];
    return {volume:String(volume),selection_revision:selection.revision,render_ids:(record?.passes||[]).map(p=>p.id),repair_ids:(record?.repairs||[]).map(p=>p.id)};
  };
  return {emit,vision,layout,selection,
    renderScope,
    loadRender:async(volume,identity)=>{
      await ensureSelection();const reference=state.completedRenders?.[String(volume)];
      if(!reference||reference.scope.selection_revision!==selection.revision)return null;
      return restoreRenderCheckpoint({reference,directory:`${directory}/renders`,scope:renderScope(volume),identity,store:artifacts});
    },
    saveRender:async(volume,book,identity,expectedScope)=>{
      await ensureSelection();const scope=renderScope(volume);
      if(JSON.stringify(scope)!==JSON.stringify(expectedScope))throw Error('Another render started before this PDF could be saved; the book is held for recovery.');
      if(!scope.render_ids.length)throw Error('An unreserved render cannot be checkpointed.');
      const reference=await saveRenderCheckpoint({book,directory:`${directory}/renders`,scope,identity,store:artifacts});
      await ensureSelection();state.completedRenders||={};state.completedRenders[String(volume)]=reference;await save();
    },
    renderUsage:volume=>renderUsage(state,String(volume)),
    reserveRender:(volume,settings)=>reserveWork(volume,'render',settings),
    reserveRepair:(volume,settings)=>reserveWork(volume,'repair',settings),
    read:async({posts,publication,identity,overrides,volume})=>{
    await ensureSelection();
    const cache=new Map(state.cache);
    const inference=openRouterPublisher({key:env.OPENROUTER_API_KEY,journal:state.journal,persist:save,fetchImpl});
    const ask=async request=>{await ensureSelection();return inference(request);};
    const ids=new Set(posts.map(p=>String(p.id??p.slug)));
    const restored=Object.fromEntries(selection.restored.filter(id=>ids.has(id)).map(id=>[id,'keep']));
    return publishSelection({posts,publication,identity,overrides:{...overrides,...restored},cache,ask,emit:e=>emit({...e,volume}),saveCache:async c=>{state.cache=[...c];await save();}});
  }, get spent(){return state.journal.spent;}};
}
