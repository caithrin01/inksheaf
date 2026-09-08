import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendOperatorPdfNotice, OPERATOR_LINK_TTL } from "./lib/operator-pdf-mail.mjs";

const dir = mkdtempSync(join(tmpdir(), "inksheaf-operator-pdf-"));
const first = Buffer.from("%PDF-1.7\nfirst complete volume\n%%EOF");
const second = Buffer.from("%PDF-1.7\nsecond complete volume\n%%EOF");
writeFileSync(join(dir, "v1.pdf"), first);
writeFileSync(join(dir, "v2.pdf"), second);
const assets = [first, second].map((_, i) => ({ label: `Volume ${i + 1}`, pages: 100 + i,
  key: `proofs/fixture/v${i + 1}.pdf`, pdf: join(dir, `v${i + 1}.pdf`) }));
const input = { to: "operator@example.com", subject: "PDF ready: Fixture", text: "Version 12", assets };
const makeUrl = (key, ttl) => { assert.equal(ttl, OPERATOR_LINK_TTL); return `https://proof.example.invalid/${key}?private=1`; };
let count = 0;
async function test(name, run) { await run(); count++; console.log("PASS", name); }
try {
  await test("every complete volume is linked and attached to the operator only", async () => {
    let message;
    const r = await sendOperatorPdfNotice(input, { makeUrl, send: async m => { message = m; return { ok: true, id: "test-id" }; } });
    assert.equal(r.id, "test-id"); assert.equal(message.to, "operator@example.com");
    assert.equal(message.attachments.length, 2);
    assert.deepEqual(message.attachments[0].content, first);
    assert.deepEqual(message.attachments[1].content, second);
    for (const a of assets) assert.ok(message.text.includes(makeUrl(a.key, OPERATOR_LINK_TTL)));
    assert.match(message.text, /does not confirm delivery to the writer/);
    assert.equal(message.timeoutMs, 20_000);
  });
  await test("a large set retains all private links when attachments exceed the cap", async () => {
    let message;
    await sendOperatorPdfNotice(input, { makeUrl, maxAttachmentBytes: first.length,
      send: async m => { message = m; return { ok: true }; } });
    assert.equal(message.attachments.length, 1);
    assert.match(message.text, /1 of 2 complete PDFs attached/);
    assert.ok(message.text.includes("v2.pdf?private=1"));
  });
  await test("a missing local attachment does not hide the uploaded PDF or later files", async () => {
    let message;
    await sendOperatorPdfNotice({ ...input, assets: [{ ...assets[0], pdf: join(dir, "missing.pdf") }, assets[1]] },
      { makeUrl, send: async m => { message = m; return { ok: true }; } });
    assert.equal(message.attachments.length, 1);
    assert.equal(message.attachments[0].filename, "v2.pdf");
    assert.ok(message.text.includes("v1.pdf?private=1"));
  });
  await test("operator provider failure is isolated and does not leak its response into logs", async () => {
    const logs = [];
    const r = await sendOperatorPdfNotice(input, { makeUrl, log: m => logs.push(m), send: async () => { throw Error("private-recipient@example.com provider detail"); } });
    assert.equal(r.ok, false); assert.match(logs.join(" "), /creator delivery will continue/);
    assert.doesNotMatch(logs.join(" "), /private-recipient/);
  });
  await test("link signing failure cannot stop writer delivery or send incomplete notification", async () => {
    let sent = false;
    const r = await sendOperatorPdfNotice(input, { makeUrl: () => { throw Error("no signing key"); }, send: async () => { sent = true; } });
    assert.equal(r.ok, false); assert.equal(sent, false);
  });
  await test("wrap covers and interiors are independently available in the print-files notice", async () => {
    let message;
    await sendOperatorPdfNotice({ ...input, assets: [assets[0], { ...assets[1], label: "Volume 1 — wrap cover", pages: null }] },
      { makeUrl, send: async m => { message = m; return { ok: true }; } });
    assert.match(message.text, /wrap cover\nhttps:/); assert.equal(message.attachments.length, 2);
  });
  await test("real mail adapter respects staging recipient isolation and carries complete attachments", async () => {
    const names = ["RESEND_API_KEY", "INKSHEAF_ENV", "STAGING_EMAIL"];
    const old = Object.fromEntries(names.map(k => [k, process.env[k]]));
    const originalFetch = global.fetch;
    try {
      Object.assign(process.env, { RESEND_API_KEY: "fixture-not-a-key", INKSHEAF_ENV: "staging", STAGING_EMAIL: "sink@example.com" });
      let call;
      global.fetch = async (url, options) => { call = { url, ...options }; return new Response(JSON.stringify({ id: "stub" }), { status: 200 }); };
      const r = await sendOperatorPdfNotice(input, { makeUrl });
      assert.equal(r.id, "stub");
      const message = JSON.parse(call.body);
      assert.deepEqual(message.to, ["sink@example.com"]);
      assert.match(message.subject, /^\[staging\]/);
      assert.deepEqual(Buffer.from(message.attachments[1].content, "base64"), second);
      assert.ok(call.signal instanceof AbortSignal);
      delete process.env.STAGING_EMAIL; call = null;
      assert.equal((await sendOperatorPdfNotice(input, { makeUrl })).ok, false);
      assert.equal(call, null, "missing staging inbox makes no request");
    } finally {
      global.fetch = originalFetch;
      for (const k of names) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
    }
  });
  await test("network timeout reports notification failure without stalling the press", async () => {
    const originalFetch = global.fetch;
    const old = { RESEND_API_KEY: process.env.RESEND_API_KEY, INKSHEAF_ENV: process.env.INKSHEAF_ENV };
    try {
      process.env.RESEND_API_KEY = "fixture-not-a-key"; process.env.INKSHEAF_ENV = "production";
      global.fetch = async (_url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        throw new DOMException("The operation timed out", "TimeoutError");
      };
      assert.equal((await sendOperatorPdfNotice(input, { makeUrl })).ok, false);
    } finally {
      global.fetch = originalFetch;
      for (const [k,v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(`${count} operator PDF notification checks passed`);
