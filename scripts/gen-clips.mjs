#!/usr/bin/env node
// Teaser clip generation via OpenRouter's async video API (submit -> poll -> download).
// Reads assets/shots.json; writes assets/clips/<name>.mp4 + assets/gen-log.json.
// Key from env only (OPENROUTER_API_KEY). generate_audio false everywhere: the plan
// discards model audio for one licensed music bed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(2); }
const H = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const only = process.argv.slice(2);
const shots = JSON.parse(readFileSync(process.env.SHOTS_FILE || "assets/shots.json", "utf-8"))
  .filter(s => !only.length || only.includes(s.name));
mkdirSync("assets/clips", { recursive: true });
const log = [];

// submit all jobs
for (const s of shots) {
  const body = { model: s.model, prompt: s.prompt, duration: s.duration,
    aspect_ratio: s.aspect_ratio, resolution: s.resolution || "1080p", generate_audio: false,
    ...(s.frame_images ? { frame_images: s.frame_images } : {}) };
  const r = await fetch("https://openrouter.ai/api/v1/videos", { method: "POST", headers: H, body: JSON.stringify(body) });
  const d = await r.json();
  if (!d.id) { console.error(`SUBMIT FAIL ${s.name}:`, JSON.stringify(d).slice(0, 300)); log.push({ name: s.name, error: d }); continue; }
  console.log(`submitted ${s.name}: ${d.id} (${d.status})`);
  log.push({ name: s.name, model: s.model, id: d.id, polling_url: d.polling_url, status: d.status });
}
writeFileSync("assets/gen-log.json", JSON.stringify(log, null, 1));

// poll all until terminal
const pending = () => log.filter(j => j.id && j.status !== "completed" && j.status !== "failed");
const t0 = Date.now();
while (pending().length && Date.now() - t0 < 30 * 60_000) {
  await new Promise(r => setTimeout(r, 30_000));
  for (const j of pending()) {
    try {
      const d = await (await fetch(j.polling_url, { headers: H })).json();
      j.status = d.status;
      if (d.status === "completed") {
        const url = (d.unsigned_urls || [])[0];
        if (url) {
          const buf = Buffer.from(await (await fetch(url, { headers: H })).arrayBuffer());
          writeFileSync(`assets/clips/${j.name}.mp4`, buf);
          j.bytes = buf.length;
          console.log(`DONE ${j.name}: ${buf.length} bytes`);
        } else { j.status = "failed"; j.error = "no content url"; }
      } else if (d.status === "failed") {
        j.error = d.error || "unknown";
        console.error(`FAILED ${j.name}:`, JSON.stringify(j.error).slice(0, 200));
      } else console.log(`  ${j.name}: ${d.status}`);
    } catch (e) { console.error(`poll error ${j.name}:`, String(e.message).slice(0, 100)); }
    writeFileSync("assets/gen-log.json", JSON.stringify(log, null, 1));
  }
}
const ok = log.filter(j => j.bytes).length;
const key = await (await fetch("https://openrouter.ai/api/v1/key", { headers: H })).json();
console.log(`\n${ok}/${shots.length} clips done. Key usage now: $${key.data?.usage}`);
