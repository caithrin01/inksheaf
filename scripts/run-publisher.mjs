#!/usr/bin/env node
// Local rehearsal of the application's publisher. Explicit --live makes model calls;
// no email, public artifact, payment, listing or order endpoint is used.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { publishSelection, openRouterPublisher, prepareSources, PUBLISHER_MODELS } from './lib/publisher-agent.mjs';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const fixture = arg('--fixture'), out = resolve(arg('--out') || 'output/publisher-rehearsal');
if (!fixture) throw Error('Usage: node scripts/run-publisher.mjs --fixture posts.json [--publication name] [--live] [--out directory]');
const posts = JSON.parse(readFileSync(fixture, 'utf8'));
const publication = arg('--publication') || 'The Workshop — synthetic publisher fixture';
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ live: false, publication, posts: prepareSources(posts).map(p => ({ id: p.id, title: p.title, source_characters: p.text.length })), models: PUBLISHER_MODELS }, null, 2));
  process.exit(0);
}
if (existsSync(join(out, 'run.json'))) throw Error('Evidence already exists; choose a new output directory');
let key = process.env.OPENROUTER_API_KEY;
if (!key) { try { key = readFileSync(join(homedir(), '.secrets/openrouter'), 'utf8').match(/sk-or-[A-Za-z0-9_-]+/)?.[0]; } catch {} }
if (!key) throw Error('No OpenRouter credential; no inference performed');
mkdirSync(out, { recursive: true });
const save = (name, value) => { const path = join(out, name); writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n'); renameSync(path + '.tmp', path); };
const journal = { calls: [], spent: 0 }, events = [], started = Date.now();
const run = { status: 'running', started: new Date().toISOString(), fixture: resolve(fixture), publication, models: PUBLISHER_MODELS };
save('run.json', run); save('sources.json', posts);
const ask = openRouterPublisher({ key, journal, persist: async value => save('usage.json', value) });
try {
  const result = await publishSelection({ posts, publication, ask,
    emit: async event => { const record = { ...event, sequence: events.length + 1, elapsed_ms: Date.now() - started }; events.push(record); save('events.json', events); console.log(JSON.stringify(record)); },
    saveCache: async cache => save('cache.json', [...cache]),
  });
  save('result.json', result); run.status = 'completed';
  console.log(JSON.stringify({ status: run.status, included: result.included_ids, excluded: result.excluded_ids, model_cost_usd: journal.spent, elapsed_ms: Date.now() - started }));
} catch (error) {
  run.status = 'failed'; run.error = String(error.message).replaceAll(key, '[redacted]'); console.error(run.error); process.exitCode = 1;
} finally { run.finished = new Date().toISOString(); run.model_cost_usd = journal.spent; save('run.json', run); }
