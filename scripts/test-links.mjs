import { normalizeUrl, linkCode } from "../functions/lib/links.js";
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
ok(normalizeUrl("https://www.linkedin.com/posts/x?utm_source=a&amp;utm_medium=b&amp;rcm=c") === "https://www.linkedin.com/posts/x?rcm=c", "entities decoded, tracking stripped: " + normalizeUrl("https://www.linkedin.com/posts/x?utm_source=a&amp;utm_medium=b&amp;rcm=c"));
ok(normalizeUrl("https://example.com/p/a?utm_campaign=x&ref=y&id=5") === "https://example.com/p/a?id=5", "utm and ref stripped, id kept");
ok(normalizeUrl("https://Example.com/") === "https://example.com", "host lowercased, bare slash dropped");
ok(normalizeUrl("mailto:x@y") === null, "non-http refused");
ok(await linkCode("https://example.com/p/a?id=5") === await linkCode(normalizeUrl("https://example.com/p/a?utm_source=z&id=5")), "same target, same code after normalisation");
ok(/^[a-z0-9]{6}$/.test(await linkCode("x")) && !/[01ilo]/.test(await linkCode("x")), "six characters, none confusable");
console.log(`${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
