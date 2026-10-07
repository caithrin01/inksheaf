// One shared limit for the press and durable state API. Three complete scans of
// a 150-page edition alone need 114 contact-sheet calls, before confirmations.
// The monetary cap and bounded repair rounds remain independent hard limits.
export const PUBLISHER_MAX_CALLS = 256;
// Raised from $2 to $3 by the owner on 2026-09-26 so a large annual can finish
// its second review round; the retail addition per printed copy is print-prices.json inksheaf_per_book.
export const PUBLISHER_BUDGET_USD = 3;
// An edition of several volumes is several books, so each volume gets the per-book
// allowance, up to twelve volumes (owner, 2026-10-06, funding a twelve-volume monthly
// edition: "added 50 bucks, raised cap"). Renders and repairs were already per volume.
export const PUBLISHER_MAX_VOLUMES = 12;
export function planVolumeCount(plan) {
  try { const p = typeof plan === 'string' ? JSON.parse(plan) : plan; return Array.isArray(p?.volumes) && p.volumes.length ? p.volumes.length : 1; }
  catch { return 1; }
}
export function publisherAllowance(volumes = 1) {
  const n = Math.min(PUBLISHER_MAX_VOLUMES, Math.max(1, Math.floor(Number(volumes)) || 1));
  return { volumes: n, usd: PUBLISHER_BUDGET_USD * n, calls: PUBLISHER_MAX_CALLS * n };
}
export const PUBLISHER_MAX_RENDERS = 6;
export const PUBLISHER_MAX_REPAIR_ROUNDS = 2;
