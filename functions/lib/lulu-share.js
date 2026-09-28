// Selling through the creator's own Lulu account. Lulu's Bookstore rule (help.lulu.com,
// "Creator Revenue Guide"): gross profit is the retail price less the print cost, split 80%
// to the creator's payees and 20% to Lulu. Payee shares must total 100%.
// Inksheaf is one payee: its whole-percent share is rounded up, so it never receives less
// than its amount per printed book; the creator's markup is what remains.
export const CREATOR_SHARE = 0.8;
const cents = x => Math.ceil(Math.round(x * 1e6) / 1e4) / 100;
export function subscriberPrice({ printCost, markup = 0, perBook = 2 }) {
  if (![printCost, markup, perBook].every(x => Number.isFinite(x) && x >= 0) || printCost <= 0 || perBook <= 0) throw Error('Invalid price inputs');
  const payees = markup + perBook;
  const sharePercent = Math.min(100, Math.ceil((perBook / payees) * 100 - 1e-9));
  // Retail makes 80% of the gross profit at least the payees' total, and at least enough for
  // Inksheaf's rounded share to reach its amount.
  // With whole-percent shares, the payees' gross must cover both amounts at their percentages.
  const gross = Math.max(perBook * 100 / sharePercent, sharePercent < 100 ? markup * 100 / (100 - sharePercent) : 0);
  const retail = cents(printCost + gross / CREATOR_SHARE);
  const paid = (retail - printCost) * CREATOR_SHARE;
  return { retail, sharePercent, inksheaf: Math.floor(paid * sharePercent + 1e-6) / 100, creator: Math.floor(paid * (100 - sharePercent) + 1e-6) / 100 };
}
