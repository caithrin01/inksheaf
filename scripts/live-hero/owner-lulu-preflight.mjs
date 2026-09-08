// Owner-only private validation and quote. This script cannot place a print job.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {makeClient} from '../lulu-client.mjs';
import {proofKey,uploadProof,signedProofUrl} from '../lib/proof-store.mjs';
const dir='output/private-acceptance/owner-order';
const edition=JSON.parse(readFileSync(dir+'/edition.json'));
if(edition.host!=='caithrin.com'||edition.quantity!==1)throw Error('This preflight is restricted to the owner’s one copy.');
const client=makeClient({production:true});
const redact=value=>Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/url|token|signature/i.test(k)?'[private link redacted]':redact(v)])):value;
const save=(name,value)=>writeFileSync(`${dir}/${name}.json`,JSON.stringify(value,null,2),{mode:0o600});
const statePath=dir+'/lulu-preflight.json';
const state=existsSync(statePath)?JSON.parse(readFileSync(statePath)):{host:'caithrin.com',quantity:1,files:{},ordersCreated:0};
const pages=(await PDFDocument.load(readFileSync(dir+'/interior.pdf'))).getPageCount();
state.pages=pages;
if(process.argv.includes('--validate')){
 for(const name of ['interior','cover-masthead','cover-classic','cover-field','cover-midnight']){
  const file=`${dir}/${name}.pdf`,sha=createHash('sha256').update(readFileSync(file)).digest('hex');
  const kind=name==='interior'?'interior':'cover';
  let row=state.files[name];
  if(row?.sha256===sha&&['NORMALIZED','VALIDATED'].includes(row.status)){console.log(name,row.status,'cached');continue;}
  if(row&&row.sha256!==sha)save(`${name}-prior-validation-${row.sha256.slice(0,12)}`,row);
  if(!row||row.sha256!==sha){
   const key=proofKey('caithrin-private-acceptance-20260907',name,file);
   await uploadProof(file,key);row={sha256:sha,key};state.files[name]=row;save('lulu-preflight',state);
  }
  if(!row.validationId){
   const url=signedProofUrl(row.key,86400);
   const result=kind==='interior'?await client.validateInterior(url):await client.validateCover(url,pages);
   row.validationId=result.id;row.status=result.status;save('lulu-preflight',state);
  }
  const result=await client.pollValidation(kind,row.validationId,{timeoutMs:300000});
  row.status=result.status;row.result=redact(result);row.checkedAt=new Date().toISOString();save('lulu-preflight',state);
  console.log(name,row.status,'validation',row.validationId);
 }
}
if(process.argv.includes('--quote')){
 const prior=await client.printJobStatus(3012340),address=prior.shipping_address;
 if(!address||!/1680\s+Mission/i.test(address.street1)||address.postcode!=='94103')throw Error('Prior delivery address differs from the recorded Mox address; stop for confirmation.');
 const quote=await client.costQuote(pages,address,{quantity:1,level:'MAIL'});
 save('lulu-quote',{pages,quantity:1,shipping:'MAIL',addressBasis:'Prior owner order 3012340; same-address confirmation pending',quote:redact(quote),checkedAt:new Date().toISOString()});
 console.log('Quote saved for one copy, standard MAIL, using prior delivery details; no order created.');
}
