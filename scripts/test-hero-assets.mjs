#!/usr/bin/env node
// The hero is four full-viewport frames. Keep its preferred payload bounded and its durable render
// recipe present; a visual redesign must not quietly become a multi-megabyte first experience.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const names = ["s1-desk", "s2-open", "s3-turn", "s4-title"];
const caps = { avif: 90_000, webp: 220_000, jpg: 400_000 };
const totals = { avif: 260_000, webp: 600_000, jpg: 1_500_000 };
let pass = 0, fail = 0;
function check(condition, label) {
  if (condition) { pass++; console.log("ok  ", label); }
  else { fail++; console.error("FAIL", label); }
}

for (const format of Object.keys(caps)) {
  let total = 0;
  for (const name of names) {
    const file = join(root, "public", "storyboard", `${name}.${format}`);
    check(existsSync(file), `${name}.${format} exists`);
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    total += size;
    check(size <= caps[format], `${name}.${format} is within ${caps[format] / 1000} kB (${Math.ceil(size / 1000)} kB)`);
  }
  check(total <= totals[format], `${format} set is within ${totals[format] / 1000} kB (${Math.ceil(total / 1000)} kB)`);
}

const component = readFileSync(join(root, "src", "components", "ScrollHero.astro"), "utf8");
check(!component.includes("data:image/jpeg;base64"), "no padded inline JPEG placeholder ships in the component");
check(names.every(name => component.includes(`${name}.avif`)), "every frame advertises its AVIF source");

const promptDir = join(root, "assets", "storyboard", "prompts");
const prompts = ["scene1.txt", "scene2.txt", "scene3.txt", "scene4.txt", "edit1.txt", "edit2.txt", "edit3.txt", "s3-fix.txt"];
check(prompts.every(name => existsSync(join(promptDir, name))), "all eight storyboard prompts are durable");
check(readFileSync(join(promptDir, "scene1.txt"), "utf8").includes("{{TITLE}}"), "cover title remains a render parameter");

console.log(`hero assets: ${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
