import { PUBLISHER_MAX_RENDERS, PUBLISHER_MAX_REPAIR_ROUNDS } from './publisher-policy.js';

export const newRenderBudget = () => ({ version: 1, volumes: {} });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVolume = value => /^[1-9][0-9]?$/.test(value);
const validEntry = entry => object(entry) && typeof entry.id === 'string' && entry.id.length > 0
  && entry.id.length <= 100 && Number.isSafeInteger(entry.selection_revision) && entry.selection_revision >= 0
  && typeof entry.run_id === 'string' && entry.run_id.length <= 200
  && typeof entry.started === 'string' && Number.isFinite(Date.parse(entry.started))
  && /^[a-f0-9]{64}$/.test(entry.settings_hash);

// Reservations are append-only. An interrupted render is still counted: a lost
// acknowledgement must never give an automatic retry a fresh allowance.
export function validRenderBudget(value) {
  if (!object(value) || value.version !== 1 || !object(value.volumes) || Object.keys(value.volumes).length > 99) return false;
  const ids = new Set();
  for (const [volume, record] of Object.entries(value.volumes)) {
    if (!validVolume(volume) || !object(record)) return false;
    for (const [field, max] of [['passes', PUBLISHER_MAX_RENDERS], ['repairs', PUBLISHER_MAX_REPAIR_ROUNDS]]) {
      if (!Array.isArray(record[field]) || record[field].length > max) return false;
      for (const entry of record[field]) {
        if (!validEntry(entry) || ids.has(entry.id)) return false;
        ids.add(entry.id);
      }
    }
  }
  return true;
}

export function renderBudgetTransition(previous, next) {
  if (next == null) return previous == null;
  if (!validRenderBudget(next) || (previous != null && !validRenderBudget(previous))) return false;
  for (const [volume, record] of Object.entries(previous?.volumes || {})) {
    const updated = next.volumes[volume];
    if (!updated) return false;
    for (const field of ['passes', 'repairs']) {
      if (updated[field].length < record[field].length) return false;
      if (record[field].some((entry, i) => JSON.stringify(entry) !== JSON.stringify(updated[field][i]))) return false;
    }
  }
  return true;
}

export function renderUsage(state, volume) {
  if (!validVolume(String(volume))) throw Error('Invalid publisher volume');
  if (state.renderBudget == null) throw Object.assign(Error('Earlier render usage is unknown. Saved work needs reconciliation before another render.'), { code: 'PUBLISHER_RENDER_HISTORY_UNKNOWN' });
  if (!validRenderBudget(state.renderBudget)) throw Error('Saved render accounting is invalid; the book is held for recovery.');
  const record = state.renderBudget.volumes[String(volume)];
  return { passes: record?.passes.length || 0, repairs: record?.repairs.length || 0 };
}

export function reserveRenderWork(state, volume, kind, entry) {
  const usage = renderUsage(state, volume);
  const field = kind === 'render' ? 'passes' : kind === 'repair' ? 'repairs' : null;
  if (!field || !validEntry(entry)) throw Error('Invalid publisher render reservation');
  const limit = field === 'passes' ? PUBLISHER_MAX_RENDERS : PUBLISHER_MAX_REPAIR_ROUNDS;
  if (usage[field] >= limit) throw Object.assign(Error('The bounded layout repairs need a closer look. Your work is saved.'), { code: 'PUBLISHER_RENDER_BUDGET_REACHED' });
  const record = state.renderBudget.volumes[String(volume)] ||= { passes: [], repairs: [] };
  record[field].push(entry);
  return renderUsage(state, volume);
}
