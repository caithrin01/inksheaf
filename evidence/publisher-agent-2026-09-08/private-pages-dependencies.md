# Page reader dependencies

PDF.js 6.3.289 is pinned. The library loads only when Pages is opened. Its module worker,
fonts, character maps and image decoders ship on our own origin; no CDN receives a private
PDF URL. The local server recognizes the worker's module MIME type. Node requires 22.13+.
Reference: https://mozilla.github.io/pdf.js/examples/ and
https://github.com/mozilla/pdf.js/releases/tag/v6.3.289 (checked September 9).

Installing the reader surfaced three pre-existing audit findings. The candidate now uses
Astro 7.2.8, Sharp 0.35.4 and js-yaml 4.3.2, with no forced major migration. The initial
range install briefly resolved Astro 7.3.2 locally; the final lockfile pins the minimal
7.2.8 repair. The final npm audit reports zero known vulnerabilities. This does not
constitute a comprehensive security review or a claim about exploitability in production.

Primary advisory references:
- https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2
- https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c
- https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh

No production dependency update or deployment has occurred. Validation uses the final
lockfile. The protected GitHub release path is unchanged.
