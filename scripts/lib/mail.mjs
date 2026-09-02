// One email, one recipient, through Resend. Without RESEND_API_KEY the message is written to
// proofs/press/outbox/*.json so a dry run leaves the exact email on disk instead of sending.
// Outbound rule: every call names one address; nothing here loops over a list.
import { mkdirSync, writeFileSync } from "node:fs";

export async function sendMail({ to, subject, text, html, attachments = [], from = "Inksheaf <press@inksheaf.com>", replyTo = "caithrin@caithrin.com" }) {
  if (!to || typeof to !== "string" || to.includes(",")) throw new Error("sendMail: exactly one recipient");
  const msg = { from, to: [to], reply_to: replyTo, subject, text, html,
    attachments: attachments.map(a => ({ filename: a.filename, content: a.content.toString("base64") })) };
  if (!process.env.RESEND_API_KEY) {
    mkdirSync("proofs/press/outbox", { recursive: true });
    const f = `proofs/press/outbox/${Date.now()}-${subject.replace(/\W+/g, "-").slice(0, 40)}.json`;
    writeFileSync(f, JSON.stringify({ ...msg, attachments: attachments.map(a => ({ filename: a.filename, bytes: a.content.length })) }, null, 1));
    return { ok: true, dry: true, file: f };
  }
  const r = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify(msg) });
  const body = await r.text();
  if (!r.ok) throw new Error(`resend ${r.status}: ${body.slice(0, 200)}`);
  return { ok: true, id: JSON.parse(body).id };
}
