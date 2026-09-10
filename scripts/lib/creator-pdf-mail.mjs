import { createHmac } from 'node:crypto';

// Persisted and sent by the authenticated site callback. A retry of this helper does not
// rebuild the PDF and the callback reuses the original email's payload and send key.
export async function deliverCreatorPdf({ site, secret, versionId, subject, text, html, action = 'send' }, { fetcher = fetch } = {}) {
  if (!secret || !Number.isSafeInteger(versionId) || versionId <= 0) throw new Error('A saved version and delivery credential are required');
  const sig = createHmac('sha256', secret).update(`proof-email:${versionId}`).digest('hex');
  const response = await fetcher(`${site.replace(/\/$/, '')}/api/proof-email`, {
    method: 'POST', signal: AbortSignal.timeout(25_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version_id: versionId, sig, subject, text, html, action }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Creator PDF email could not be confirmed (${response.status})`);
  return result.delivery;
}
