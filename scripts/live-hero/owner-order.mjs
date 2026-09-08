// One owner copy only. Default invocation inspects local artifacts; no network or payment.
// --submit --address-confirmed is for use only AFTER the pending owner approvals.
import {readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PDFDocument} from 'pdf-lib';
import {makeClient} from '../lulu-client.mjs';
import {signedProofUrl} from '../lib/proof-store.mjs';

export const EXTERNAL_ID = 'inksheaf-dogfood-002-20260907';
const ROOT = 'output/private-acceptance';
const DIRECTORY = ROOT + '/owner-order';
const FILES = ['interior', 'cover-masthead', 'cover-classic', 'cover-field', 'cover-midnight'];
const TITLE = 'caithrin — Essays, July 2025–June 2026';
const valid = row => ['NORMALIZED', 'VALIDATED'].includes(row?.status);
const sha = value => createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
const addressKey = address => {
  // Lulu's quote and job endpoints use different names for these same fields.
  const normalized = {...address, name:address?.name || [address?.first_name,address?.last_name].filter(Boolean).join(' '),
    state_code:address?.state_code || address?.state, country_code:address?.country_code || address?.country};
  return JSON.stringify(['name','street1','street2','city','state_code','postcode','country_code','phone_number']
    .map(key => String(normalized[key] || '').trim().replace(/\s+/g, ' ').toUpperCase()));
};
export const sameDeliveryAddress = (a,b) => addressKey(a) === addressKey(b);

export async function inspectOwnerFiles() {
  const edition = read(DIRECTORY + '/edition.json');
  requireThat(edition.host === 'caithrin.com' && edition.quantity === 1 && edition.cover_design === 'masthead' && edition.interior === 'bw', 'Owner edition settings differ from the reviewed one-copy order.');
  const files = Object.fromEntries(FILES.map(name => [name, {sha256: sha(readFileSync(`${DIRECTORY}/${name}.pdf`))}]));
  const pages = (await PDFDocument.load(readFileSync(DIRECTORY + '/interior.pdf'))).getPageCount();
  requireThat(pages === 142, 'Owner page count changed; obtain a new cover/quote review.');
  const bounds = read(DIRECTORY + '/bounds.json');
  const whitespace = read(ROOT + '/whitespace-review-ledger.json');
  requireThat(bounds.pass && bounds.sha256 === files.interior.sha256, 'Current interior needs its bounds check.');
  const decisions = whitespace.pages.filter(row => row.host === 'owner-order');
  requireThat(decisions.length === 18 && decisions.every(row => row.pdf_sha256 === files.interior.sha256 && row.status === 'accepted intentional space'), 'Current interior needs its recorded whitespace review.');
  const covers = read(DIRECTORY + '/final-cover-manifest.json');
  requireThat(covers.length === 4 && covers.every(row => files[row.file.split('/').pop().replace('.pdf','')]?.sha256 === row.sha256 && row.pages === 1 && Math.abs(row.width - 909) < .2 && Math.abs(row.height - 666) < .2), 'Current covers differ from the reviewed geometry/hashes.');
  const preflight = existsSync(DIRECTORY + '/lulu-preflight.json') ? read(DIRECTORY + '/lulu-preflight.json') : {files:{}};
  const missing = FILES.filter(name => !valid(preflight.files[name]) || preflight.files[name].sha256 !== files[name].sha256 || !preflight.files[name].validationId || !preflight.files[name].key);
  const quote = read(DIRECTORY + '/lulu-quote.json');
  requireThat(quote.pages === pages && quote.quantity === 1 && quote.shipping === 'MAIL' && quote.quote.currency === 'USD', 'Stored quote is for different order settings.');
  const maxTotal = Number(quote.quote.total_cost_incl_tax);
  requireThat(maxTotal === 12.46, 'Stored total differs from the reviewed $12.46 quote.');
  return {pages, files, validations:preflight.files, missing, maxTotal, quotedAddress:quote.quote.shipping_address};
}

// Official GET /print-jobs/ supports search, not an external_id query filter.
// Search may match other fields, so filter exact references and inspect every result page.
export async function existingOwnerJobs(client) {
  const matches = [];
  for (let page = 1; page <= 100; page++) {
    const result = await client.api(`/print-jobs/?search=${encodeURIComponent(EXTERNAL_ID)}&page_size=100&page=${page}`);
    requireThat(Array.isArray(result.results), 'Unexpected Lulu search response; cannot rule out an existing order.');
    matches.push(...result.results.filter(job => job.external_id === EXTERNAL_ID));
    if (!result.next) return matches;
  }
  throw Error('Lulu order search did not finish; submission refused.');
}

export async function submitOwner({client, snapshot, loadState, saveState, proofUrl, addressConfirmed = false}) {
  requireThat(addressConfirmed, 'Prior Mox delivery address is not confirmed.');
  const state = loadState() || {externalId:EXTERNAL_ID};
  requireThat(state.externalId === EXTERNAL_ID, 'Unexpected order reference in local state.');
  const jobs = await existingOwnerJobs(client);
  requireThat(jobs.length <= 1, 'Multiple existing jobs match this reference; manual reconciliation required.');
  if (jobs.length) {
    const job = jobs[0];
    requireThat(job.id && job.line_items?.length === 1 && job.line_items[0].quantity === 1 && job.line_items[0].title === TITLE, 'Existing job differs from the prepared one-copy order; inspect it without resubmitting.');
    state.jobId = job.id; state.status = job.status?.name; state.reconciledAt = new Date().toISOString();
    saveState(state); return {jobId:job.id, status:state.status, existing:true};
  }
  requireThat(!state.attemptedAt && !state.jobId, 'An earlier submission has an unresolved outcome. Never retry automatically.');
  requireThat(snapshot.missing.length === 0, 'Lulu must validate the interior and all four current covers first.');
  for (const name of FILES) {
    const record = snapshot.validations[name];
    const live = await (name === 'interior' ? client.validateInteriorStatus(record.validationId) : client.validateCoverStatus(record.validationId));
    requireThat(valid(live), `Lulu ${name} validation is no longer successful.`);
  }
  const previous = await client.printJobStatus(3012340);
  const address = previous.shipping_address;
  requireThat(address && sameDeliveryAddress(address, snapshot.quotedAddress), 'Previous delivery details differ from the reviewed quote.');
  const quote = await client.costQuote(snapshot.pages, address, {quantity:1,level:'MAIL'});
  const total = Number(quote.total_cost_incl_tax);
  requireThat(quote.currency === 'USD' && Number.isFinite(total) && total > 0 && total <= snapshot.maxTotal, 'Live total exceeds the reviewed quote or has invalid currency/amount.');
  const args = {externalId:EXTERNAL_ID,title:TITLE,pages:snapshot.pages,quantity:1,level:'MAIL',address,
    interiorUrl:proofUrl(snapshot.validations.interior.key,86400),coverUrl:proofUrl(snapshot.validations['cover-masthead'].key,86400)};
  Object.assign(state, {attemptedAt:new Date().toISOString(),pages:snapshot.pages,quantity:1,cover:'masthead',files:snapshot.files,
    addressSha256:sha(addressKey(address)),quotedTotal:total,currency:'USD',status:'SUBMITTING'});
  // Durable intent is written before the single charge-capable call. No signed URLs in state.
  saveState(state);
  try {
    const job = await client.createPrintJob(args);
    requireThat(job.id, 'Lulu returned no job ID; order outcome is unknown.');
    Object.assign(state,{jobId:job.id,status:job.status?.name || 'UNKNOWN',respondedAt:new Date().toISOString()});
    saveState(state); return {jobId:job.id,status:state.status,quotedTotal:total,currency:'USD',existing:false};
  } catch {
    state.status = 'SUBMISSION_OUTCOME_UNKNOWN'; saveState(state);
    throw Error('Submission outcome is unknown. Reconcile the existing reference; do not create another order.');
  }
}

async function main() {
  const snapshot = await inspectOwnerFiles();
  if (!process.argv.includes('--submit')) {
    console.log(JSON.stringify({externalId:EXTERNAL_ID,pages:snapshot.pages,quantity:1,cover:'masthead',quotedTotal:snapshot.maxTotal,currency:'USD',missingLuluValidations:snapshot.missing,submitted:false},null,2));
    return;
  }
  requireThat(process.argv.includes('--address-confirmed'), 'Confirm the delivery address before using --address-confirmed.');
  const lock = DIRECTORY + '/order-submit.lock', statePath = DIRECTORY + '/order-state.json';
  mkdirSync(lock); // Exclusive lock; a surviving lock after interruption requires inspection.
  try {
    const result = await submitOwner({client:makeClient({production:true}),snapshot,addressConfirmed:true,proofUrl:signedProofUrl,
      loadState:()=>existsSync(statePath)?read(statePath):null,
      saveState:state=>{const temp=statePath+'.tmp';writeFileSync(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600});renameSync(temp,statePath);}});
    console.log(JSON.stringify(result));
  } finally { rmdirSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
