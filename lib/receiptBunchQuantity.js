const positive = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function printedReceiptBunchQuantity(line) {
  const explicit = positive(line.total_bunch);
  if (line.total_bunch != null && String(line.total_bunch).trim() !== '' && explicit === null) return null;
  const stems = positive(line.total_stems);
  const stemsPerBunch = positive(line.bunch_st);
  const boxes = positive(line.pcs);
  const bunchesPerBox = positive(line.bunches_per_box);
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (stems && stemsPerBunch) candidates.push(stems / stemsPerBunch);
  if (boxes && bunchesPerBox) candidates.push(boxes * bunchesPerBox);
  if (!candidates.length || candidates.some(value => Math.abs(value - candidates[0]) > 0.000001)) return null;
  if (explicit) return explicit;
  return Number.isInteger(candidates[0]) ? candidates[0] : null;
}

export function receiptBunchIssue(product, {boxQuantity, bunchQuantity, stemQuantity, stemsPerBunch}) {
  if (String(product?.OutUnit ?? '').trim() !== '단' && String(product?.EstUnit ?? '').trim() !== '단') return null;
  const hasGoods = positive(boxQuantity) || positive(stemQuantity) || positive(bunchQuantity);
  if (!hasGoods) return null;
  const bunches = positive(bunchQuantity);
  if (!bunches) return '단 수량을 원본에서 확인해 입력하세요.';
  const stems = positive(stemQuantity);
  const ratio = positive(stemsPerBunch);
  if (stems && ratio && Math.abs(stems - bunches * ratio) > 0.000001) {
    return '원본 단 수량과 송이 수량·단당 송이가 일치하는지 확인하세요.';
  }
  return null;
}
