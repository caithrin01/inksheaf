#!/usr/bin/env node
// gen-still.mjs <outPath> <promptFile> [refImagePath] [--title "Publication"]
// One photoreal still via OpenRouter images. Prompt files use {{TITLE}} so a publication name is
// always an explicit render parameter rather than a baked design assumption.
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const out = args.shift(), promptFile = args.shift();
let ref = null, title = "Your Newsletter", printPrompt = false;
while (args.length) {
  const arg = args.shift();
  if (arg === "--title") title = args.shift() || title;
  else if (arg === "--print-prompt") printPrompt = true;
  else if (!ref) ref = arg;
  else { console.error("unexpected argument:", arg); process.exit(2); }
}
if (!out || !promptFile) {
  console.error('usage: gen-still.mjs <outPath> <promptFile> [refImagePath] [--title "Publication"]');
  process.exit(2);
}
const prompt = readFileSync(promptFile,"utf8").trim().replaceAll("{{TITLE}}", title);
if (printPrompt) { console.log(prompt); process.exit(0); }
const key = process.env.OPENROUTER_API_KEY; if(!key){console.error("no key");process.exit(1);}
const body = { model:"google/gemini-3-pro-image", prompt, aspect_ratio:"16:9", resolution:"2K" };
if (ref){ const b=readFileSync(ref); const mt=ref.endsWith(".png")?"image/png":"image/jpeg";
  body.input_references=[{type:"image_url", image_url:{url:`data:${mt};base64,${b.toString("base64")}`}}]; }
const r = await fetch("https://openrouter.ai/api/v1/images",{method:"POST",
  headers:{authorization:`Bearer ${key}`,"content-type":"application/json"},body:JSON.stringify(body)});
const j = await r.json();
if(!r.ok){ console.error("HTTP",r.status,JSON.stringify(j).slice(0,300)); process.exit(1); }
const d = (j.data&&j.data[0])||{};
if(!d.b64_json){ console.error("no image:",JSON.stringify(j).slice(0,300)); process.exit(1); }
writeFileSync(out, Buffer.from(d.b64_json,"base64"));
console.log("saved", out, "| cost $"+(j.usage&&j.usage.cost!=null?j.usage.cost:"?"));
