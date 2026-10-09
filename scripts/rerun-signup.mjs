#!/usr/bin/env node
// Operator tool: re-make one signup's book on production after a fix.
//   node scripts/rerun-signup.mjs <signup id> [--to-operator] [--yes]
// Reads the signup and its saved plan from the production database (read-only), then dispatches
// one press run with the same plan. --to-operator sends the delivery email to the operator, so a
// corrected book can be checked before the writer sees it; the writer's own address is never
// changed in the database. Without --yes it only prints what it would send.
import { execFileSync } from 'node:child_process';

const id = Number(process.argv[2]), toOperator = process.argv.includes('--to-operator'), go = process.argv.includes('--yes');
const OPERATOR = 'caithrin@caithrin.com';
if (!Number.isSafeInteger(id) || id < 1) { console.error('usage: node scripts/rerun-signup.mjs <signup id> [--to-operator] [--yes]'); process.exit(2); }
const raw = execFileSync('wrangler', ['d1', 'execute', 'inksheaf-beta', '--remote', '--json', '--command',
  `SELECT id, publication_url, email, plan_json, dispatch_status FROM signups WHERE id = ${id}`], { encoding: 'utf8' });
const row = JSON.parse(raw.slice(raw.indexOf('[')))[0].results[0];
if (!row) { console.error(`No signup #${id}`); process.exit(1); }
const payload = { event: 'press', signup_id: row.id, publication_url: row.publication_url, email: toOperator ? OPERATOR : row.email,
  plan_json: row.plan_json || '', requested_at: new Date().toISOString(), environment: 'production', press_protocol: 'publisher-v1' };
console.log(`Signup #${row.id} ${row.publication_url}`);
console.log(`Delivery email to: ${payload.email}${toOperator ? ` (writer ${row.email} is not emailed by this run)` : ' (the writer)'}`);
console.log(`Plan: ${row.plan_json ? `${(JSON.parse(row.plan_json).volumes || []).length || 1} volume(s)` : 'none (the window default)'}`);
if (!go) { console.log('Dry run. Add --yes to dispatch.'); process.exit(0); }
execFileSync('gh', ['api', 'repos/caithrin01/inksheaf/dispatches', '--method', 'POST', '--input', '-'], { input: JSON.stringify({ event_type: 'press', client_payload: payload }) });
console.log('Dispatched. Follow it at https://github.com/caithrin01/inksheaf/actions/workflows/press.yml');
