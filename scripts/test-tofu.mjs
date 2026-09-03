// Tofu gate test: Chinese renders clean when the CJK font is bundled (fallback works), and the
// detector FAILS when no covering font is present (the old broken state). Needs typst + pymupdf,
// the same deps the render path uses. No network.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const HERE = new URL("..", import.meta.url).pathname;
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const d = mkdtempSync(join(tmpdir(), "tofu-"));
writeFileSync(join(d, "cjk.typ"), `#set text(font: ("Source Serif 4", "Noto Serif SC"))\nHello 国产模型涨价 world.\n`);
// a font dir with ONLY the Latin faces, to simulate "no CJK font bundled"
const latin = mkdtempSync(join(tmpdir(), "latin-"));
for (const f of readdirSync(join(HERE, "fonts"))) if (/SourceSerif4|EBGaramond/.test(f)) copyFileSync(join(HERE, "fonts", f), join(latin, f));
const render = (fontPath, out) => execFileSync("typst", ["compile", "--font-path", fontPath, "--ignore-system-fonts", join(d, "cjk.typ"), join(d, out)], { stdio: ["ignore", "ignore", "ignore"] });
const check = out => { try { execFileSync("python3", [join(HERE, "scripts/tofu-check.py"), join(d, out)], { stdio: ["ignore", "pipe", "pipe"] }); return 0; } catch (e) { return e.status || 1; } };

render(join(HERE, "fonts"), "good.pdf");   // CJK font bundled -> fallback covers Chinese
ok(check("good.pdf") === 0, "Chinese renders clean when Noto Serif SC is bundled");
render(latin, "bad.pdf");                  // no CJK font -> Chinese is tofu
ok(check("bad.pdf") === 1, "the detector fails the build when a covering font is missing");

console.log(`tofu: ${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
