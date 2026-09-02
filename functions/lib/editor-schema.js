// The editorial plan: what the model decides about an edition. Page counts, prices and every
// invariant are computed and enforced in plan-check.js; the model never states a number we
// can compute. Shared by the API call (structured output) and the checker.
import { z } from "zod";

export const KINDS = ["essays","letters","recipes","poems","stories","reviews","dispatches","serial","notes","mixed"];
export const CADENCES = ["single","half","quarterly","monthly"];
export const NOTES = ["footnotes","endnotes_per_article","back_of_book","none"];

const Volume = z.object({
  label: z.string().describe("The period name from the window given: exactly one of the offered quarter, half, month or year labels, or two adjacent ones joined by ' – ' when folded."),
  title: z.string().describe("Title printed on this volume's title page and spine. Usually the publication name."),
  subtitle: z.string().describe("Subtitle under the title: the period in words, or a theme when the volume has one."),
  post_ids: z.array(z.number().int()).describe("Every post bound in this volume, in reading order."),
  parts: z.array(z.object({ name: z.string(), post_ids: z.array(z.number().int()) })).nullable()
    .describe("Named parts when the archive has clear series or sections; null for a plain chronological volume."),
  notes_policy: z.enum(NOTES).describe("footnotes at the page foot when notes are short and few; endnotes_per_article when long; back_of_book for a letters magazine; none when there are no notes."),
  why: z.string().describe("One sentence for the writer on why this volume is shaped this way."),
});

const Route = z.object({
  cadence: z.enum(CADENCES),
  recommended: z.boolean(),
  why: z.string().describe("One sentence for the writer. The recommended route says why it is the golden route."),
  volumes: z.array(Volume),
});

export const EditorialPlan = z.object({
  kind: z.enum(KINDS),
  rhythm: z.string().describe("How often and when they publish, in plain words: 'weekly, most Sundays'."),
  description: z.string().describe("One sentence about what this publication is, written for its author, no flattery."),
  routes: z.array(Route).min(1).max(4).describe("The golden route first and recommended, then up to three alternatives. Include every cadence that binds; mark the rest absent."),
  infeasible: z.array(z.object({ cadence: z.enum(CADENCES), reason: z.string() }))
    .describe("Cadences left out and the plain reason: 'one volume would run about 690 pages'."),
  contributors: z.array(z.object({ name: z.string(), role: z.enum(["principal","contributor","guest"]), posts: z.number().int() }))
    .describe("Everyone with a byline in the window, principal first."),
  excluded: z.array(z.object({ post_id: z.number().int(), reason: z.string() }))
    .describe("Posts left out of every route: housekeeping, subscription pitches, open threads, duplicates. Keep this short."),
  interior: z.object({ recommended: z.enum(["bw","color"]), why: z.string() }),
  dedication_post_id: z.number().int().nullable().describe("A post that reads as a preface or dedication, to open the edition; else null."),
  running_head: z.enum(["publication","volume","author"]),
  sentences: z.object({
    plan_headline: z.string().describe("The one line at the top of the plan page, e.g. 'Your year is a quarterly set of four.'"),
    plan_sub: z.string().describe("One sentence under it with the shape and the reason."),
    proof_email_opening: z.string().describe("The first sentence of the proof email, addressed to the writer."),
  }),
});

export const PLAN_VERSION = 1;
