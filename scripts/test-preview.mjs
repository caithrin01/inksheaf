#!/usr/bin/env node
import { strict as assert } from "node:assert";
import { summarizeArchive } from "../functions/lib/preview-summary.js";

const now = Date.parse("2026-08-28T00:00:00Z");
const cutoff = now - 366 * 864e5;
const post = (title, wordcount, extra = {}) => ({
  title, wordcount, type: "newsletter", post_date: "2026-06-01T00:00:00Z",
  publishedBylines: [{ name: "Fixture Writer" }], ...extra,
});
const summarize = posts => summarizeArchive(posts, { publicationName: null, theme: null },
  "fixture.substack.com", cutoff, false);

const personal = summarize(Array.from({ length: 27 }, (_, i) => post(`Essay ${i + 1}`, 1900)));
assert.equal(personal.public_posts, 27);
assert.equal(personal.summary_version, 7);
assert.equal(personal.est_pages, 227);
assert.equal(personal.cadence, "Annual");
assert.equal(personal.kind, "essays");

const letters = summarize(Array.from({ length: 120 }, (_, i) =>
  post(`March ${(i % 28) + 1}, 2026`, 1500)));
assert.equal(letters.kind, "letters");
assert.equal(letters.cadence, "Quarterly");
assert.ok(letters.volume_pages <= 300);

const paidHeavy = summarize([
  ...Array.from({ length: 20 }, (_, i) => post(`Public policy essay ${i}`, 1800)),
  ...Array.from({ length: 80 }, (_, i) => post(`Paid policy essay ${i}`, 2400, { audience: "only_paid" })),
]);
assert.equal(paidHeavy.public_posts, 20);
assert.equal(paidHeavy.paid_posts, 80);
assert.equal(paidHeavy.words, 36000);

const mixedMedia = summarize([
  ...Array.from({ length: 12 }, (_, i) => post(`Genetics dispatch ${i}`, 2100,
    { postTags: [{ name: "dispatch" }] })),
  ...Array.from({ length: 18 }, (_, i) => post(`Podcast ${i}`, 300, { type: "podcast" })),
]);
assert.equal(mixedMedia.kind, "dispatches");
assert.equal(mixedMedia.podcast_posts, 18);
assert.equal(mixedMedia.public_posts, 12);
assert.ok(mixedMedia.est_pages >= 32);

/* ---------- v3 divisions fixtures ---------- */
const dated = (title, wordcount, iso, extra = {}) => post(title, wordcount, { post_date: iso, ...extra });
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString();

/* young publication: five months of writing, labeled honestly, single volume */
const young = summarize(Array.from({ length: 10 }, (_, i) => dated(`Essay ${i}`, 1800, iso(2026, 4 + Math.floor(i / 2), 1 + i))));
assert.equal(young.young, true);
assert.equal(young.recommended.cadence, "single");
assert.ok(young.divisions.single.feasible);

/* 150pp archive: a single volume, full stop; monthly folds below two volumes */
const midsize = summarize(Array.from({ length: 15 }, (_, i) => dated(`Essay ${i}`, 2300, iso(2025, 9 + (i % 12), 5))));
assert.ok(midsize.est_pages < 300 && midsize.est_pages > 100);
assert.equal(midsize.recommended.cadence, "single");

/* 900pp archive: single infeasible with the reason, quarterly feasible with real volumes */
const heavy = summarize(Array.from({ length: 96 }, (_, i) => dated(`Letter ${i}`, 2500, iso(2025, 9 + Math.floor(i / 8), 1 + (i % 8)))));
assert.ok(heavy.est_pages > 800);
assert.equal(heavy.divisions.single.feasible, false);
assert.ok(heavy.divisions.single.reason.includes("300-page"));
assert.equal(heavy.recommended.cadence, "quarterly");
assert.ok(heavy.divisions.quarterly.volumes.length >= 3);
for (const v of heavy.divisions.quarterly.volumes) assert.ok(v.est_pages >= 32 && v.est_pages <= 300, v.label);
const qsum = heavy.divisions.quarterly.volumes.reduce((s, v) => s + v.posts, 0);
assert.equal(qsum, 96);

/* a thin quarter folds into its neighbor instead of printing a pamphlet */
const lopsided = summarize([
  ...Array.from({ length: 40 }, (_, i) => dated(`Essay A${i}`, 2600, iso(2025, 10, 1 + (i % 27)))),
  ...Array.from({ length: 40 }, (_, i) => dated(`Essay B${i}`, 2600, iso(2026, 2, 1 + (i % 27)))),
  dated("Lone essay", 900, iso(2026, 6, 15)),
]);
for (const v of lopsided.divisions.quarterly.volumes) assert.ok(v.est_pages >= 32, v.label + " " + v.est_pages);

/* image-heavy publication defaults to the colour interior */
const visual = summarize(Array.from({ length: 20 }, (_, i) => dated(`Field notes ${i}`, 1400, iso(2025, 9 + (i % 12), 3), { cover_image: "https://img/" + i })));
assert.ok(visual.image_rate >= 0.99);
assert.equal(visual.recommended.interior, "bw"); /* bw default regardless of image_rate */
assert.equal(personal.recommended.interior, "bw");

/* form naming reaches the surface */
assert.equal(letters.form, "a magazine");
assert.equal(letters.unit, "issue");
assert.equal(personal.form, "a collected edition");

/* all cadences infeasible: recommended must say concierge, never an infeasible plan */
const giants = summarize(Array.from({ length: 12 }, (_, i) => dated(`Giant ${i}`, 90000, iso(2025, 9 + i, 15))));
assert.equal(giants.divisions.single.feasible, false);
assert.equal(giants.divisions.quarterly.feasible, false);
assert.equal(giants.divisions.monthly.feasible, false);
assert.equal(giants.recommended.cadence, "concierge");

console.log("PASS FIXTURE preview logic: personal, daily letters, paid-heavy, mixed-media, young, 150pp, 900pp, folding, image-heavy, forms, all-infeasible");
