// Binding availability, measured from Lulu's API 2026-08-30 (see vault evidence/lulu-limits.md).
export const BINDINGS = [
  { key: "coil",     label: "Coil bound",              min: 2,  max: 470 },
  { key: "saddle",   label: "Saddle stitch",           min: 4,  max: 48  },
  { key: "casewrap", label: "Hardcover casewrap",      min: 24, max: 800 },
  { key: "linen",    label: "Linen wrap, dust jacket", min: 24, max: 800 },
  { key: "perfect",  label: "Perfect bound",           min: 32, max: 800 },
];
export const bindingOptionsFor = pages =>
  BINDINGS.filter(b => pages >= b.min && pages <= b.max).map(b => b.key);
export const SPINE_TEXT_MIN_PAGES = 80; // Lulu help guidance, not API-verified
