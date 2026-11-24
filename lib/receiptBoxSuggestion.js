export function receiptBoxSuggestion(row) {
  if (row.BoxQuantity !== null || row.IsWeightRow !== false || row.ReceiptGoodsLines !== 1) return null;
  const stems = row.SteamQuantity;
  const perBox = row.박스송이;
  if (!Number.isSafeInteger(stems) || !Number.isSafeInteger(perBox) || stems <= 0 || perBox <= 1) return null;
  const quantity = stems / perBox;
  if (!Number.isSafeInteger(quantity)) return null;

  const bunches = row.BunchQuantity;
  const perBunch = row.단송이;
  if (bunches !== null && (!Number.isSafeInteger(bunches) || bunches <= 0 ||
      !Number.isSafeInteger(perBunch) || perBunch <= 0 || bunches * perBunch !== stems || perBox % perBunch !== 0)) {
    return null;
  }
  const stockQuantities = { 송이: stems, 단: bunches, 박스: quantity };
  const stockQuantity = stockQuantities[row.단위];
  if (!Number.isSafeInteger(stockQuantity) || stockQuantity <= 0 || stockQuantity !== row.OutQuantity) return null;

  return { quantity, description: `원장행 ${stems}송이 ÷ ${perBox}송이/박스` };
}
