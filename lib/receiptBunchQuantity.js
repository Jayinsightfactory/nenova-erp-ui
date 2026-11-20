const positive = value => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function printedReceiptBunchQuantity(line) {
  return resolveReceiptBunch({OutUnit:'단'}, {
    bunchQuantity:line.total_bunch, stemQuantity:line.total_stems, boxQuantity:line.pcs,
    stemsPerBunch:line.bunch_st, stemsPerBox:line.steam_box, bunchesPerBox:line.bunches_per_box,
  }).quantity;
}

export function resolveReceiptBunch(product, row) {
  const boxes = positive(row.boxQuantity);
  const stems = positive(row.stemQuantity);
  const explicit = positive(row.bunchQuantity);
  const invalidExplicit = row.bunchQuantity != null && String(row.bunchQuantity).trim() !== '' && explicit === null;
  const source = [];
  const master = [];
  const add = (list, label, quantity, formula) => {
    if (Number.isFinite(quantity) && quantity > 0) list.push({ label, quantity, formula });
  };
  if (explicit) add(source, '원본 단 수량', explicit, `${explicit}단`);
  const ratios = (list, label, stemsPerBunch, bunchesPerBox) => {
    if (stems && stemsPerBunch) add(list, label, stems / stemsPerBunch, `${stems}송이 ÷ ${stemsPerBunch}송이/단`);
    if (boxes && bunchesPerBox) add(list, label, boxes * bunchesPerBox, `${boxes}박스 × ${bunchesPerBox}단/박스`);
  };
  const printedRatio = positive(row.stemsPerBunch);
  const uncertainLegacyRatio = row.legacyWorkbook && printedRatio === 1 && !explicit;
  const stemsPerBox = positive(row.stemsPerBox);
  ratios(source, '원본 포장 기준', uncertainLegacyRatio ? null : printedRatio, positive(row.bunchesPerBox));
  if (boxes && stemsPerBox && printedRatio && !uncertainLegacyRatio && !(row.legacyWorkbook && stemsPerBox === 1))
    add(source, '원본 포장 기준', boxes * stemsPerBox / printedRatio, `${boxes}박스 × ${stemsPerBox}송이/박스 ÷ ${printedRatio}송이/단`);
  if (uncertainLegacyRatio && stems) add(master, '엑셀 포장 기준 확인 필요', stems, `${stems}송이 ÷ 1송이/단`);
  ratios(master, '품목 마스터 기준', positive(product?.SteamOf1Bunch), positive(product?.BunchOf1Box));
  const required = [product?.OutUnit, product?.EstUnit].some(unit => String(unit ?? '').trim() === '단');
  if (!required || !(boxes || stems || explicit)) return { quantity: explicit, status: 'unchanged' };
  const consistent = source.length > 0 && source.every(item => Math.abs(item.quantity - source[0].quantity) <= 0.000001);
  if (!invalidExplicit && consistent && (explicit || Number.isSafeInteger(source[0].quantity))) {
    return { quantity: source[0].quantity, status: explicit ? 'printed' : 'derived' };
  }
  const candidates = [...source, ...master];
  const snapshot = JSON.stringify([row.scopeKey,product?.ProdKey,product?.OutUnit,product?.EstUnit,boxes,stems,
    explicit,printedRatio,stemsPerBox,positive(row.bunchesPerBox),candidates.map(item=>[item.label,item.quantity,item.formula])]);
  const confirmed = row.confirmation;
  const confirmedQuantity = positive(confirmed?.quantity);
  if (confirmed?.snapshot === snapshot && Number.isSafeInteger(confirmedQuantity) && confirmedQuantity < 1e10
      && typeof confirmed.reason === 'string' && confirmed.reason.trim() && confirmed.reason.length <= 500) {
    return {quantity:confirmedQuantity,status:'confirmed'};
  }
  return {
    quantity: null, status: 'review', candidates, snapshot,
    message: source.length ? '원본 수량·포장 기준을 대조해 단 수량을 확인하세요.' : '원본에서 단 수량 또는 포장 기준을 확인하세요.',
  };
}
