#!/usr/bin/env node
// Read-only by default. --send retries an existing message for one exact verified edition;
// it cannot create a new email, PDF, listing or order. Provider-accepted messages are no-ops.
import { readFileSync } from 'node:fs';
import { deliverCreatorPdf } from './lib/creator-pdf-mail.mjs';

const args = process.argv.slice(2);
const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const versionId = Number(value('--version'));
if (!Number.isSafeInteger(versionId) || versionId <= 0) throw new Error('Use --version VERSION_ID; add --send only to retry the saved email');
const secret = process.env.ARCHIVE_RELAY_TOKEN || readFileSync(`${process.env.HOME}/.secrets/inksheaf-relay-token`, 'utf8').trim();
const site = process.env.SITE_BASE || 'https://inksheaf.com';
const result = await deliverCreatorPdf({ site, secret, versionId, action: args.includes('--send') ? 'retry' : 'status' });
console.log(JSON.stringify({ version_id: versionId, action: args.includes('--send') ? 'retry existing email' : 'read delivery status',
  accepted: result.accepted, send_status: result.status, delivery_status: result.delivery }, null, 2));
