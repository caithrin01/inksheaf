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
assert.equal(personal.summary_version, 2);
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

console.log("PASS preview summaries: personal, daily letters, paid-heavy, mixed-media");
