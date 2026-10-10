// Live-book battery: every publication in a tier of corpus.json through scripts/live-book/run.mjs,
// two at a time, each allocated and reconciled in the campaign spend ledger. Writes a report with
// pass rates, time to PDF, cost per book and every failed check, and exits 1 below the bar.
//
// Bar (owner's goal, 2026-09): every book delivered, identical, complete, bounded and readable.
// Time is reported against the one-minute goal; it does not fail the battery on its own.
//
// Usage: node scripts/live-book/battery.mjs --tier standard --ledger <spend.json> [--only host,host] [--concurrency 2]
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';

const arg=(f,d=null)=>{const i=process.argv.indexOf(f);return i<0?d:process.argv[i+1];};
const tier=arg('--tier','standard'),ledger=arg('--ledger'),only=arg('--only'),concurrency=Number(arg('--concurrency',2));
assert(ledger&&existsSync(ledger),'--ledger <spend.json> is required');
const corpus=JSON.parse(readFileSync('scripts/live-book/corpus.json','utf8'))[tier];assert(Array.isArray(corpus),`No tier ${tier}`);
const picks=only?corpus.filter(c=>only.split(',').includes(c.host)):corpus;
const stamp=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19),root=resolve(`output/live-book/battery-${tier}-${stamp}`);mkdirSync(root,{recursive:true});
const perBook=tier==='prolific'?36:6;
const round=n=>Math.round(n*1e8)/1e8;
const updateLedger=fn=>{const s=JSON.parse(readFileSync(ledger,'utf8'));fn(s);writeFileSync(ledger,JSON.stringify(s,null,2)+'\n');};
function allocate(id,perBook){
  updateLedger(s=>{
    assert(!s.allocations.some(a=>a.id===id),'already allocated');
    assert(round(s.reserved_campaign_usd+perBook)<=s.campaign_cap_usd,`Campaign cap $${s.campaign_cap_usd} would be exceeded`);
    s.allocations.push({id,status:'active',reserved_usd:perBook,limit_usd:perBook,created_at:new Date().toISOString(),scope:'live-book battery: one real publication, live reads, real models, captured mail'});
    s.reserved_campaign_usd=round(s.reserved_campaign_usd+perBook);
  });
}
function reconcile(id,spent,status){
  updateLedger(s=>{
    const a=s.allocations.find(a=>a.id===id);assert(a&&a.status==='active');
    s.known_campaign_usd=round(s.known_campaign_usd+spent);s.reserved_campaign_usd=round(s.reserved_campaign_usd-a.reserved_usd+spent);
    Object.assign(a,{status:'reconciled-'+status,reserved_usd:0,actual_or_unknown_usd:spent,finished_at:new Date().toISOString()});
    s.runs.push({run:id,spent_usd:spent,reserved_or_spent_usd:spent,status});
  });
}
const runOne=entry=>new Promise(done=>{
  const id=`live-book-${entry.host}-${stamp}`,out=join(root,entry.host),allowance=entry.budget_usd||perBook;allocate(id,allowance);
  const child=spawn(process.execPath,['scripts/live-book/run.mjs','--host',entry.host,'--out',out,'--minutes',String(entry.minutes||(tier==='prolific'?180:40)),'--budget',String(allowance)],{stdio:['ignore','pipe','pipe']});
  let tail='';child.stdout.on('data',b=>tail=(tail+b).slice(-4000));child.stderr.on('data',b=>tail=(tail+b).slice(-4000));
  child.on('close',()=>{
    let j=null;try{j=JSON.parse(readFileSync(join(out,'journey.json'),'utf8'));}catch{}
    const quality=(j?.volumes||[]).reduce((t,v)=>t+(v.quality?.cost_usd||0),0),spent=round(j?.unknown_model_charges?allowance:(j?.total_model_cost_usd??((j?.model?.cost_usd||0)+quality)));
    // An unreadable journey keeps the whole reservation as unknown spend.
    if(entry.expected==='empty-archive'&&j?.error?.startsWith('Error: Preview failed: The public archive there looks empty for the last year.')&&!j.dispatched&&!j.sends?.length)j.status='expected-empty-archive';
    reconcile(id,j?spent:allowance,j?.status||'unknown');
    done({...entry,status:j?.status||'harness-failed',checks:j?.checks||{},seconds_to_pdf:j?.seconds_to_pdf??null,cost_usd:spent,pages:(j?.volumes||[]).map(v=>v.pages),
      volumes:j?.plan?.volumes??null,major:(j?.volumes||[]).flatMap(v=>v.quality?.major||[]),open:j?.open_issues||[],error:j?.error?.split('\n')[0]||(j?null:tail.slice(-300)),out});
  });
});
const results=[];let next=0;
await Promise.all(Array.from({length:Math.min(concurrency,picks.length)},async()=>{while(next<picks.length){const e=picks[next++];console.log('start',e.host);const r=await runOne(e);results.push(r);console.log('done ',e.host,r.status,JSON.stringify(r.checks));}}));
const delivered=results.filter(r=>r.checks.delivered),passed=results.filter(r=>r.status==='pass'),expected=results.filter(r=>r.status==='expected-empty-archive'),times=delivered.map(r=>r.seconds_to_pdf).filter(Number.isFinite).sort((a,b)=>a-b);
const pct=p=>times.length?times[Math.min(times.length-1,Math.floor(p*times.length))]:null;
const lines=[`# Live-book battery: ${tier}, ${new Date().toISOString().slice(0,16)}Z`,'',
  `Delivered ${delivered.length}/${results.length}; passed every check ${passed.length}/${results.length-expected.length} nonempty archives; expected empty ${expected.length}. Time to PDF p50 ${pct(.5)}s, p90 ${pct(.9)}s. Spend $${round(results.reduce((t,r)=>t+r.cost_usd,0)).toFixed(2)}.`,'',
  '| Publication | Tests | Status | Delivered | Identical | Complete | Bounded | Readable | Seconds | Pages | Cost | Majors |','|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map(r=>`| ${r.host} | ${r.tests} | ${r.status} | ${['delivered','identical','complete','bounded','readable'].map(k=>r.checks[k]===true?'yes':r.checks[k]===false?'**no**':'—').join(' | ')} | ${r.seconds_to_pdf??'—'} | ${r.pages.join('+')||'—'} | $${r.cost_usd.toFixed(2)} | ${r.major.join(', ')||'—'} |`),'',
  ...results.filter(r=>r.error).map(r=>`- ${r.host}: ${r.error}`)];
writeFileSync(join(root,'report.md'),lines.join('\n')+'\n');writeFileSync(join(root,'results.json'),JSON.stringify(results,null,2)+'\n');
console.log(lines.join('\n'));process.exit(passed.length+expected.length===results.length?0:1);
