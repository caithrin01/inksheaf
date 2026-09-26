// One shared limit for the press and durable state API. Three complete scans of
// a 150-page edition alone need 114 contact-sheet calls, before confirmations.
// The monetary cap and bounded repair rounds remain independent hard limits.
export const PUBLISHER_MAX_CALLS = 256;
// Raised from $2 to $3 by the owner on 2026-09-26 so a large annual can finish
// its second review round; the $2 retail addition per printed copy is unchanged.
export const PUBLISHER_BUDGET_USD = 3;
export const PUBLISHER_MAX_RENDERS = 6;
export const PUBLISHER_MAX_REPAIR_ROUNDS = 2;
