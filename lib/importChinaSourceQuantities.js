// The legacy JSON key `pcs` means BOXES, not the printed invoice unit PCS.
// Matching a product must never replace its invoice quantities with DB defaults.
const number = value => value !== null && value !== undefined && value !== ''
  && typeof value !== 'boolean' && Number.isFinite(Number(value)) && Number(value) >= 0
  ? Number(value) : null;

export function chinaSourceQuantities(product) {
  const pcs = number(product.pcs);
  const total_bunch = number(product.total_bunch);
  let total_stems = number(product.total_stems);
  let bunch_st = number(product.bunch_st);
  let steam_box = number(product.steam_box);
  // Explicit totals, including zero and contradictions, stay untouched for review.
  if (total_stems === null && total_bunch !== null && bunch_st > 0) {
    total_stems = total_bunch * bunch_st;
  }
  if (total_stems === null && pcs !== null && steam_box > 0) {
    total_stems = pcs * steam_box;
  }
  if (bunch_st === null && total_stems !== null && total_bunch > 0) bunch_st = total_stems / total_bunch;
  if (steam_box === null && total_stems !== null && pcs > 0) steam_box = total_stems / pcs;
  return { pcs, total_bunch, total_stems, bunch_st, steam_box };
}
