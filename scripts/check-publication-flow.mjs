#!/usr/bin/env node
// Real public GETs through the actual API handlers, with only an in-memory DB.
// No events, email, reservations, model calls, or production database writes.
import {onRequest as preview} from '../functions/api/preview.js';
import {onRequest as sample} from '../functions/api/sample.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {reviewMemoryDb} from './lib/review-memory-db.mjs';
const DB=reviewMemoryDb();
const rows=[];
for(const [host,expected] of [['caithrin.com','caithrin'],['manifund.substack.com','The Fox Says']]){
 const response=await preview({request:new Request('https://local.inksheaf.invalid/api/preview?url='+host),env:{DB}});const p=await response.json();
 const record={host,status:response.status,publication:p.publication,expected,logo:!!p.logo_url,theme:p.theme,summary_version:p.summary_version,identity_pass:p.publication===expected};
 if(p.ok){const r=await sample({request:new Request('https://local.inksheaf.invalid/api/sample?url='+p.host),env:{DB}});const s=await r.json();Object.assign(record,{sample_status:r.status,sample_ok:s.ok,source:s.source,sample_title:s.title,sample_characters:s.html?.length,message:s.message});}
 else record.message=p.message;
 rows.push(record);console.log(JSON.stringify(record));
}
mkdirSync('evidence/frontend-review/integrated',{recursive:true});writeFileSync('evidence/frontend-review/integrated/public-reads.json',JSON.stringify({at:new Date().toISOString(),environment:'Local handlers, memory DB, real public GETs. No production mutations or email.',rows},null,2));
if(rows.some(r=>!r.identity_pass||!r.sample_ok))process.exitCode=1;
