#!/usr/bin/env node
// Operator tool: re-make one signup's book on production after a fix.
//   node scripts/rerun-signup.mjs <signup id> [--to-operator] [--correct-reviewed] [--yes]
// Reads the signup and its saved plan from the production database (read-only), then dispatches
// one press run with the same plan. --to-operator sends the delivery email to the operator, so a
// corrected book can be checked before the writer sees it; the writer's own address is never
// changed in the database. Without --yes it only prints what it would send.
import { execFileSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';

const id = Number(process.argv[2]), toOperator = process.argv.includes('--to-operator'), go = process.argv.includes('--yes');
const correction=process.argv.includes('--correct-reviewed');
if(correction&&!toOperator)throw Error('--correct-reviewed requires --to-operator');
const OPERATOR = 'caithrin@caithrin.com';
if (!Number.isSafeInteger(id) || id < 1) { console.error('usage: node scripts/rerun-signup.mjs <signup id> [--to-operator] [--yes]'); process.exit(2); }
const raw = execFileSync('wrangler', ['d1', 'execute', 'inksheaf-beta', '--remote', '--json', '--command',
  `SELECT id, publication_url, email, plan_json, dispatch_status, (SELECT MAX(id) FROM edition_versions WHERE signup_id=signups.id) AS reviewed_version FROM signups WHERE id = ${id}`], { encoding: 'utf8' });
const row = JSON.parse(raw.slice(raw.indexOf('[')))[0].results[0];
if (!row) { console.error(`No signup #${id}`); process.exit(1); }
if(correction&&!Number.isSafeInteger(row.reviewed_version))throw Error('No reviewed version exists');
const payload = { event: 'press', signup_id: row.id, publication_url: row.publication_url, email: toOperator ? OPERATOR : row.email,
  delivery_mode: toOperator ? 'operator' : 'creator', plan_json: row.plan_json || '', requested_at: new Date().toISOString(), environment: 'production', press_protocol: 'publisher-v1' };
console.log(`Signup #${row.id} ${row.publication_url}`);
console.log(`Delivery email to: ${payload.email}${toOperator ? ` (writer ${row.email} is not emailed by this run)` : ' (the writer)'}`);
console.log(`Plan: ${row.plan_json ? `${(JSON.parse(row.plan_json).volumes || []).length || 1} volume(s)` : 'none (the window default)'}`);
if(correction)console.log(`Correction of operator proof version ${row.reviewed_version}; the old PDF and receipts are retained.`);
if (!go) { console.log('Dry run. Add --yes to dispatch.'); process.exit(0); }
if (toOperator) {
  const release = await (await fetch('https://inksheaf.com/inksheaf-press.json', {cache:'no-store', signal:AbortSignal.timeout(15000)})).json();
  if (release.operator_review !== true || release.publisher_restart !== true) throw Error('Deploy the operator-only recovery fix before dispatching this run.');
  if(correction&&release.publisher_review_correction!==true)throw Error('Deploy the explicit operator-proof correction path first.');
}
// An old checkpoint cannot be restored by a changed renderer. Restart explicitly,
// retaining the old journal in production before dispatching a new worker.
const secret=process.env.ARCHIVE_RELAY_TOKEN||readFileSync(process.env.HOME+'/.secrets/inksheaf-relay-token','utf8').trim();
const sign=m=>createHmac('sha256',secret).update(m).digest('hex');
const current=await(await fetch(`https://inksheaf.com/api/publisher-state?id=${id}&sig=${sign(`publisher-state:${id}`)}`,{signal:AbortSignal.timeout(15000)})).json();
if(!current.ok)throw Error('Cannot inspect the saved attempt; nothing dispatched');
if(correction&&!current.state)throw Error('The reviewed proof has no saved accounting; nothing dispatched');
if(current.state){
  const request_key=randomUUID(),revision=current.revision;
  const response=await fetch('https://inksheaf.com/api/publisher-restart',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),body:JSON.stringify({signup_id:id,revision,request_key,...(correction?{reviewed_version:row.reviewed_version}:{}),sig:sign(`publisher-restart:${id}:${revision}:${request_key}${correction?`:operator-correction:${row.reviewed_version}`:''}`)})});
  const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Restart refused; nothing dispatched');
  console.log(`Archived ${correction?'operator proof':'failed attempt'} revision ${revision}; fresh attempt prepared.`);
}
execFileSync('gh', ['api', 'repos/caithrin01/inksheaf/dispatches', '--method', 'POST', '--input', '-'], { input: JSON.stringify({ event_type: 'press', client_payload: payload }) });
console.log('Dispatched. Follow it at https://github.com/caithrin01/inksheaf/actions/workflows/press.yml');
