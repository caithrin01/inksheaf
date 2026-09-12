// One shared limit for the press and durable state API. Three complete scans of
// a 150-page edition alone need 114 contact-sheet calls, before confirmations.
// The monetary cap and bounded repair rounds remain independent hard limits.
export const PUBLISHER_MAX_CALLS = 256;
export const PUBLISHER_BUDGET_USD = 2;
export const PUBLISHER_MAX_RENDERS = 6;
export const PUBLISHER_MAX_REPAIR_ROUNDS = 2;
