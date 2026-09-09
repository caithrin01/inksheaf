#!/usr/bin/env node
// Full in-app publisher path, kept entirely local except explicit model inference.
// No email, proof upload, dispatch, listing or order capability is used here.
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import {fit} from './lib/fit.mjs';
import {publisherSession} from './lib/publisher-session.mjs';
import {publishVolume} from './lib/publish-volume.mjs';
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const fixture=arg('--fixture'),out=arg('--out'),host=arg('--host')||'workshop.substack.com',brand=arg('--brand-file');
if(!fixture||!out||!process.argv.includes('--live'))throw Error('Use --fixture posts.json --out proofs/publisher/name --host publication-host --live. This spends model budget only.');
if(existsSync(out+'/result.json')){if(!process.argv.includes('--resume'))throw Error('Choose a new evidence directory, or --resume a held local rehearsal.');writeFileSync(out+'/result-before-resume-'+Date.now()+'.json',readFileSync(out+'/result.json'));}
const key=process.env.OPENROUTER_API_KEY||readFileSync(homedir()+'/.secrets/openrouter','utf8').match(/sk-or-[A-Za-z0-9_-]+/)?.[0];
if(!key)throw Error('No model credential; no inference performed.');
const env={OPENROUTER_API_KEY:key,INKSHEAF_ENV:'development'};
process.env.OPENROUTER_API_KEY=key;process.env.BOOK_ENGINE='typst';
// Child builders may only save their publisher work locally during this rehearsal.
for(const name of ['SIGNUP_ID','SITE_BASE','ARCHIVE_RELAY_TOKEN'])delete process.env[name];
mkdirSync(out,{recursive:true});const html=out+'/book.html',pdf=resolve(out+'/book.pdf'),directory=out+'/publisher';
const session=()=>publisherSession({directory,env}),events=[];
const emit=async e=>{events.push(e);writeFileSync(out+'/events.json',JSON.stringify(events,null,2));await(await session()).emit(e);};
const result={status:'running',fixture,host,started:new Date().toISOString()};
const saveResult=()=>{
  const saved=existsSync(directory+'/state.json')?JSON.parse(readFileSync(directory+'/state.json','utf8')):null;
  result.model_cost_usd=saved?.journal?.spent||0;
  result.reserved_or_spent_usd=saved?.journal?.calls.reduce((s,c)=>s+(c.cost??c.reserved),0)||0;
  writeFileSync(out+'/result.json',JSON.stringify(result,null,2));
};
saveResult();
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{
  result.status='interrupted';result.error='Stopped by operator; incomplete provider calls retain their spend reservations.';result.finished=new Date().toISOString();
  saveResult();process.exit(code);
});
try{
  const book=await publishVolume({build:({passes,initial})=>{
    const args=['scripts/build-book.mjs',host,'--fixture',fixture,'--out',html,...(brand?['--brand-file',brand]:['--no-brand']),'--cover-design','classic','--print-interior','--direct-links','--publisher-dir',directory,'--publisher-volume','1'];
    const fitted=fit({args,html,pdf,passes,initial,log:console.error});
    const report=JSON.parse(readFileSync(html.replace(/\.html$/,'.report.json'),'utf8'));report.fit=fitted;
    return{html,pdf,report};
  },session,emit,volume:'1',reviewDirectory:out+'/review',log:console.error});
  result.status='completed';result.included=book.report.postOrder;result.layout=book.report.layoutAgent;result.review=book.review;result.pdf=pdf;
}catch(error){result.status='held';result.error=String(error.message).replaceAll(key,'[redacted]');process.exitCode=1;}
finally{result.finished=new Date().toISOString();saveResult();console.log(JSON.stringify(result));}
