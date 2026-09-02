// The edition window: the last four completed calendar quarters (plan-end-to-end-v1, R1).
// All dates are UTC, as Substack's post_date is. Every cadence describes the same posts.

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = d => d.toISOString().slice(0, 10);
const utc = (y, m, d = 1) => new Date(Date.UTC(y, m, d));

export function quarterIndex(d) { return Math.floor(d.getUTCMonth() / 3); }          // 0..3
export function quarterLabel(y, q) { return `Q${q + 1} ${y}`; }
export function halfLabel(y, h) { return `H${h + 1} ${y}`; }
export function monthLabel(y, m) { return `${MONTHS[m]} ${y}`; }
export function spanLabel(from, to) {
  // from, to: Date (to exclusive). "Jul – Sep 2025", "Jul 2025 – Jun 2026", "Sep 2025"
  const last = new Date(to.getTime() - 864e5);
  const a = `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
  const b = `${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  if (a === b) return a;
  if (from.getUTCFullYear() === last.getUTCFullYear())
    return `${MONTHS[from.getUTCMonth()]} – ${MONTHS[last.getUTCMonth()]} ${last.getUTCFullYear()}`;
  return `${a} – ${b}`;
}

/* Quarter containing `d`, as {y, q, from, to} with `to` exclusive. */
export function quarterOf(d) {
  const y = d.getUTCFullYear(), q = quarterIndex(d);
  return { y, q, from: utc(y, q * 3), to: utc(y, q * 3 + 3), label: quarterLabel(y, q) };
}
export function prevQuarter({ y, q }) { return q === 0 ? quarterOf(utc(y - 1, 9)) : quarterOf(utc(y, (q - 1) * 3)); }

/* The window at `now` (ms). Four completed quarters, oldest first, plus the quarter in progress. */
export function editionWindow(nowMs) {
  const current = quarterOf(new Date(nowMs));
  const quarters = [];
  let q = current;
  for (let i = 0; i < 4; i++) { q = prevQuarter(q); quarters.unshift(q); }
  const from = quarters[0].from, to = quarters[3].to;
  const y0 = from.getUTCFullYear(), y1 = new Date(to.getTime() - 864e5).getUTCFullYear();
  const halves = [
    { label: `${quarters[0].label} – ${quarters[1].label}`, from: quarters[0].from, to: quarters[1].to, quarters: [quarters[0], quarters[1]] },
    { label: `${quarters[2].label} – ${quarters[3].label}`, from: quarters[2].from, to: quarters[3].to, quarters: [quarters[2], quarters[3]] },
  ];
  for (const h of halves) if (h.quarters[0].q % 2 === 0) h.label = halfLabel(h.quarters[0].y, h.quarters[0].q / 2);
  const months = [];
  for (let d = new Date(from); d < to; d = utc(d.getUTCFullYear(), d.getUTCMonth() + 1))
    months.push({ label: monthLabel(d.getUTCFullYear(), d.getUTCMonth()), from: d, to: utc(d.getUTCFullYear(), d.getUTCMonth() + 1) });
  return {
    from, to, fromIso: iso(from), toIso: iso(to),
    label: y0 === y1 ? String(y0) : `${y0}–${String(y1).slice(2)}`,
    span: spanLabel(from, to),
    quarters: quarters.map(x => ({ ...x, fromIso: iso(x.from), toIso: iso(x.to), span: spanLabel(x.from, x.to) })),
    halves: halves.map(x => ({ label: x.label, fromIso: iso(x.from), toIso: iso(x.to), span: spanLabel(x.from, x.to) })),
    months: months.map(x => ({ label: x.label, fromIso: iso(x.from), toIso: iso(x.to) })),
    inProgress: { label: current.label, fromIso: iso(current.from), toIso: iso(new Date(nowMs)), span: spanLabel(current.from, new Date(nowMs + 864e5)) },
  };
}

/* Which named period (by label) a date belongs to, for the checker. */
export function periodOf(window, dateMs, cadence) {
  const list = cadence === "quarterly" ? window.quarters : cadence === "half" ? window.halves : cadence === "monthly" ? window.months : [window];
  const d = new Date(dateMs).toISOString().slice(0, 10);
  return list.find(p => d >= (p.fromIso || window.fromIso) && d < (p.toIso || window.toIso)) || null;
}
