import { hmacHex } from '../lib/press-dispatch.js';
import { readLimitedText } from './preview.js';
const kinds = new Set(['identity','reading','contents','typesetting','layout','review','ready','delivery']);
export async function onRequest({request, env}) {
  if (request.method !== 'POST') return Response.json({ok:false}, {status:405});
  let b;
  try { b=JSON.parse(await readLimitedText(request, 100_000)); } catch { return Response.json({ok:false}, {status:400}); }
  const id=Number(b.signup_id), run=String(b.run_id || ''), sequence=Number(b.sequence);
  if (!Number.isSafeInteger(id) || id<1 || !/^[a-zA-Z0-9._-]{1,80}$/.test(run) || !Number.isSafeInteger(sequence) || sequence<1 || sequence>10000 || !kinds.has(b.event?.kind)) return Response.json({ok:false}, {status:400});
  const payload=JSON.stringify(b.event);
  if (!env.ARCHIVE_RELAY_TOKEN || b.sig !== await hmacHex(env.ARCHIVE_RELAY_TOKEN, `publisher:${id}:${run}:${sequence}:${payload}`)) return Response.json({ok:false}, {status:403});
  try {
    await env.DB.prepare(`INSERT INTO publisher_events (signup_id,run_id,sequence,kind,payload)
      SELECT ?,?,?,?,? WHERE ?=COALESCE((SELECT revision FROM publisher_selections WHERE signup_id=?),0)
      ON CONFLICT(signup_id,run_id,sequence) DO NOTHING`).bind(id,run,sequence,b.event.kind,payload,b.event.selection_revision??0,id).run();
    const saved=await env.DB.prepare('SELECT payload FROM publisher_events WHERE signup_id=? AND run_id=? AND sequence=?').bind(id,run,sequence).first();
    return Response.json({ok:saved?.payload===payload},{status:saved?.payload===payload?200:409});
  } catch { return Response.json({ok:false},{status:503}); }
}
