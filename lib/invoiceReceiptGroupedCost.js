/** Pure CO/TH calculators. Core integration calls after base/common
 * validation. costGroups.quantity is actual STEM quantity, not box count.
 * CO group weights are normalized kg allocations whose sums equal header GW/CW,
 * not the historical workbook's unscaled box-weight estimates. Per-line weights
 * and shares are derived from explicit group membership and actual STEM quantity.
 * Optional supplied line weights/shares must match these derived allocations.
 * No name classification, loss estimation, currency/rate defaults or ERP access.
 */
export const GROUPED_INVOICE_COST_FORMULAS = Object.freeze({
  CO_GROUP_42_1_V1: Object.freeze({
    formulaId: 'CO_GROUP_42_1_V1', formulaVersion: '1.0.0', country: 'CO', transportMode: 'AIR',
    formulaSourceHash: 'd5f71f57a93d3006bb889321d00e249592ab136b855f3f20a4b2b693f78a8da3',
    formulaSourceSheet: '42-1', formulaSourceCells: 'K7:M11,T7:U11,AA8:AI12,G265:O301',
    label: '콜롬비아 · 42-1 수국 포함 중량·부피 배분', priceBasis: 'STEM', freightIncluded: false,
    groupIds: Object.freeze(['ROSE', 'CARNATION', 'ALSTROMERIA', 'RUSCUS', 'HYDRANGEA']),
    costGroupFields: Object.freeze(['quantity', 'boxQuantity', 'grossWeightKg', 'volumeWeightKg']),
    lineInputFields: Object.freeze(['groupId', 'tariffRate', 'stemsPerBunch', 'bunchesPerBox', 'grossWeightKg', 'volumeWeightKg']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW', 'costGroups']),
  }),
  CO_GROUP_WEIGHT_VOLUME_V1: Object.freeze({
    formulaId: 'CO_GROUP_WEIGHT_VOLUME_V1', formulaVersion: '1.0.0', country: 'CO', transportMode: 'AIR',
    formulaSourceHash: '23d4f8065148bf31b09669d4ea8904cf07077ab7a9a843b147eacd7a5d430afc',
    formulaSourceSheet: '12-2', formulaSourceCells: 'C8:E11,J7:U10,AA8:AI11,G15:O25',
    label: '콜롬비아 · 그룹 중량·부피 배분', priceBasis: 'STEM', freightIncluded: false,
    groupIds: Object.freeze(['ROSE', 'CARNATION', 'ALSTROMERIA', 'RUSCUS']),
    costGroupFields: Object.freeze(['quantity', 'boxQuantity', 'grossWeightKg', 'volumeWeightKg']),
    lineInputFields: Object.freeze(['groupId', 'tariffRate', 'stemsPerBunch', 'bunchesPerBox', 'grossWeightKg', 'volumeWeightKg']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW', 'costGroups']),
  }),
  TH_GROUP_BOX_SHARE_V1: Object.freeze({
    formulaId: 'TH_GROUP_BOX_SHARE_V1', formulaVersion: '1.0.0', country: 'TH', transportMode: 'AIR',
    formulaSourceHash: 'dcbb0bdb1ebd8fc0011d8b0bc41877413ff794407b16baabebf469939350f900',
    formulaSourceSheet: '40', formulaSourceCells: 'C7:C11,J7:K10,N6:N10,H15:N40,P16:P40',
    label: '태국 · 포장 그룹 박스 배분', priceBasis: 'STEM', freightIncluded: false,
    groupIds: Object.freeze(['ANTHURIUM', 'OTHERS', 'LOOSE_BLOOMS']),
    costGroupFields: Object.freeze(['quantity', 'boxQuantity']),
    lineInputFields: Object.freeze(['groupId', 'tariffRate', 'stemsPerBunch', 'bunchesPerBox', 'allocationShare']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW', 'costGroups', 'lossTreatmentConfirmed']),
    sourceCaveat: 'P15 is damaged. Only N15 STEM cost and intact later bunch conversions are evidence. Customs total must include explicitly reviewed loss treatment.',
  }),
});

const text = value => typeof value === 'string' ? value.normalize('NFC').trim().toUpperCase() : '';
const num = value => typeof value === 'boolean' || value == null || typeof value === 'object'
  || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;
const error = (issues, code, message, lineId) => issues.push({ code, message, severity: 'error', ...(lineId ? { lineId } : {}) });
const empty = () => ({ lines: [], expected95: null });
const aliases = { COLOMBIA: 'CO', 콜롬비아: 'CO', THAILAND: 'TH', 태국: 'TH' };
const present = value => value != null && !(typeof value === 'string' && !value.trim());

function allocate(total, rows, key) {
  const active = rows.filter(row => row.stems > 0).sort((a, b) => a.id.localeCompare(b.id));
  const denominator = active.reduce((sum, row) => sum + row[key], 0);
  let allocated = 0, cumulativeWeight = 0;
  const result = new Map();
  active.forEach((row, index) => {
    cumulativeWeight += row[key];
    // Cumulative rounding preserves the total without a negative last residual
    // when many tiny individually rounded allocations exceed a tiny total.
    const target = index === active.length - 1 ? round(total) : round(total * cumulativeWeight / denominator);
    const amount = round(target - allocated);
    allocated = round(allocated + amount); result.set(row.id, amount);
  });
  return result;
}

export function groupedInvoiceCostPreview(document, normalizedRows, input, common, issues) {
  const profile = GROUPED_INVOICE_COST_FORMULAS[common?.formula?.formulaId ?? input?.formulaId];
  if (!profile) { error(issues, 'GROUPED_FORMULA_UNSUPPORTED', '지원하지 않는 그룹 원가 공식입니다.'); return empty(); }
  input = input || {};
  const metadata = document?.reviewedMetadata || {};
  const country = text(metadata.country ?? document?.country);
  if ((aliases[country] || country) !== profile.country) error(issues, 'FORMULA_COUNTRY_MISMATCH', '공식과 문서 국가가 다릅니다.');
  if (text(metadata.transportMode ?? document?.transportMode) !== 'AIR') error(issues, 'FORMULA_TRANSPORT_MISMATCH', '확인한 AIR 운송만 지원합니다.');
  const currency = text(common?.nativeCurrency);
  if (!/^[A-Z]{3}$/.test(currency) || text(common?.freightCurrency) !== currency)
    error(issues, 'FORMULA_CURRENCY_MISMATCH', '매입·운임 통화를 동일하게 명시하세요.');
  const fx = num(common?.exchangeRate), freight = num(common?.effectiveFreightAmount), customs = num(input.customsTotalKRW);
  if (!(fx > 0)) error(issues, 'EXCHANGE_RATE_REQUIRED', '현재 원화 환율을 명시하세요.');
  if (freight === null || freight < 0) error(issues, 'FREIGHT_AMOUNT_REQUIRED', '확인한 운임 합계를 0 이상으로 명시하세요.');
  if (customs === null || customs < 0) error(issues, 'CUSTOMS_TOTAL_REQUIRED', '확인한 통관비 합계를 원화 0 이상으로 명시하세요.');
  // Both totals already belong to this document. Prevent scaling just freight
  // while leaving group/header weights and customs at full-invoice scope.
  if (num(common?.share) !== 1) error(issues, 'GROUPED_ALLOCATION_SCOPE_REQUIRED', '이 문서에 배정된 비용과 그룹만 사용하고 배분비율은 1로 확인하세요.');
  const isCO = profile.country === 'CO';
  const groupBoxBasis = input.groupBoxBasis ?? 'RECEIPT_LINES';
  const packingGroups = !isCO && groupBoxBasis === 'PACKING_GROUP';
  if (!['RECEIPT_LINES', 'PACKING_GROUP'].includes(groupBoxBasis) || (isCO && groupBoxBasis !== 'RECEIPT_LINES'))
    error(issues, 'GROUP_BOX_BASIS_INVALID', '패킹 그룹 박스 기준은 태국에만 사용할 수 있습니다.');
  if (!isCO && input.lossTreatmentConfirmed !== true)
    error(issues, 'LOSS_TREATMENT_CONFIRMATION_REQUIRED', '통관비에 반영한 검역 손실 처리를 확인하세요.');
  if (!Array.isArray(normalizedRows) || !normalizedRows.length || normalizedRows.length > 1000) {
    error(issues, 'RECEIPT_LINES_REQUIRED', '1~1000개 실제 입고 행이 필요합니다.'); return empty();
  }
  const groups = new Map();
  if (!Array.isArray(input.costGroups) || !input.costGroups.length || input.costGroups.length > profile.groupIds.length)
    error(issues, 'COST_GROUPS_REQUIRED', '확인한 포장 그룹을 입력하세요.');
  for (const entry of Array.isArray(input.costGroups) ? input.costGroups : []) {
    const id = text(entry?.groupId), quantity = num(entry?.quantity), boxes = num(entry?.boxQuantity);
    if (!profile.groupIds.includes(id)) error(issues, 'COST_GROUP_INVALID', '지원하지 않는 포장 그룹입니다.');
    if (groups.has(id)) error(issues, 'COST_GROUP_DUPLICATE', '포장 그룹이 중복되었습니다.');
    if (!(quantity > 0) || !(boxes > 0)) error(issues, 'COST_GROUP_QUANTITY_REQUIRED', '그룹 송이수와 박스수는 0보다 커야 합니다.');
    const gross = num(entry?.grossWeightKg), volume = num(entry?.volumeWeightKg);
    if (isCO && (!(gross > 0) || !(volume > 0))) error(issues, 'COST_GROUP_WEIGHT_REQUIRED', '그룹별 정규화 실중량·부피중량 kg를 명시하세요.');
    groups.set(id, { quantity, boxes, gross, volume, actualStems: 0, actualBoxes: 0 });
  }
  const totalBoxes = [...groups.values()].reduce((s, g) => s + g.boxes, 0);
  if (packingGroups && (!(num(input.packingBoxTotal) > 0) || !near(num(input.packingBoxTotal), totalBoxes)))
    error(issues, 'PACKING_BOX_TOTAL_MISMATCH', '패킹 전체 박스수를 입력하고 그룹별 박스수 합계와 맞춰 주세요. 기존 입고 박스는 변경하지 않습니다.');
  const totalGross = [...groups.values()].reduce((s, g) => s + g.gross, 0);
  const totalVolume = [...groups.values()].reduce((s, g) => s + g.volume, 0);
  const gw = num(metadata.gw), cw = num(metadata.cw);
  if (isCO) {
    if (!(gw > 0) || !(cw > 0)) error(issues, 'HEADER_WEIGHT_REQUIRED', '현재 문서 GW·CW kg를 확인하세요.');
    // Source branch is exact equality. Do not silently change a volume branch
    // into GW because the two header values happen to be within 0.01kg.
    if (gw > cw) error(issues, 'WEIGHT_ORDER_INVALID', 'GW는 CW보다 클 수 없습니다.');
    if (!(totalGross > 0) || !near(totalGross, gw, 0.01)) error(issues, 'GROSS_WEIGHT_SUM_MISMATCH', '그룹 실중량 합계는 문서 GW와 일치해야 합니다 (0.01kg).');
    if (!(totalVolume > 0) || !near(totalVolume, cw, 0.01)) error(issues, 'VOLUME_WEIGHT_SUM_MISMATCH', '그룹 부피중량 합계는 문서 CW와 일치해야 합니다 (0.01kg).');
  }
  const lineInputs = new Map();
  if (!Array.isArray(input.lineInputs)) error(issues, 'LINE_INPUTS_REQUIRED', '행별 그룹 입력이 필요합니다.');
  for (const settings of Array.isArray(input.lineInputs) ? input.lineInputs : []) {
    const id = String(settings?.lineId || '').trim().toLowerCase();
    if (!id || lineInputs.has(id)) error(issues, 'LINE_INPUT_DUPLICATE', '행별 입력 연결이 비어 있거나 중복되었습니다.');
    lineInputs.set(id, settings);
  }
  const seen = new Set();
  const rows = normalizedRows.map(row => {
    const id = String(row.lineId || '').trim().toLowerCase(), settings = lineInputs.get(id) || {};
    if (!id || seen.has(id)) error(issues, 'LINE_ID_DUPLICATE', '입고 행 연결이 비어 있거나 중복되었습니다.', id);
    seen.add(id);
    const qty = num(row.actualQuantity), price = num(row.unitPrice), amount = num(row.lineAmount);
    const unit = text(row.unit), groupId = text(settings.groupId), group = groups.get(groupId);
    const tariff = num(settings.tariffRate);
    const cancelled = qty === 0 && amount === 0;
    const receiptBoxes = num(row.boxQuantity);
    if (qty === null || qty < 0 || amount === null || amount < 0 || price === null || price < 0)
      error(issues, 'NATIVE_AMOUNT_REQUIRED', '수량·송이 단가·원문 금액은 0 이상이어야 합니다.', id);
    if (text(row.currency) !== currency) error(issues, 'LINE_CURRENCY_MISMATCH', '행 통화와 선택한 매입 통화가 다릅니다.', id);
    if (present(settings.otherCostPerUnitKRW) && num(settings.otherCostPerUnitKRW) !== 0)
      error(issues, 'ADDITIONAL_COST_UNSUPPORTED', '그룹 공식에 없는 기타비용을 더할 수 없습니다.', id);
    if (cancelled) {
      if (present(row.boxQuantity) && receiptBoxes !== 0)
        error(issues, 'CANCELLED_LINE_BOX_QUANTITY_INVALID', '취소행의 실제 박스수는 입력한 경우 0이어야 합니다.', id);
      for (const key of ['grossWeightKg', 'volumeWeightKg', 'allocationShare'])
        if (present(settings[key]) && num(settings[key]) !== 0) error(issues, 'CANCELLED_LINE_WEIGHT_INVALID', '취소행 배분값은 0이어야 합니다.', id);
      return { row, id, qty, amount: 0, stems: 0, tariff: 0, gross: 0, volume: 0, share: 0, groupId: null };
    }
    if (qty === 0) error(issues, 'CANCELLED_LINE_AMOUNT_INVALID', '취소행 원문 금액은 0이어야 합니다.', id);
    if (!group) error(issues, 'LINE_GROUP_REQUIRED', '행의 포장 그룹을 명시적으로 선택하세요.', id);
    if ((!packingGroups && receiptBoxes === null) || (present(row.boxQuantity) && (receiptBoxes === null || receiptBoxes < 0)))
      error(issues, 'RECEIPT_BOX_QUANTITY_REQUIRED', '실제 입고 행의 박스수를 명시하세요. 누락값은 0으로 처리하지 않습니다.', id);
    if (unit === 'BOX' && receiptBoxes !== null && !near(receiptBoxes, qty))
      error(issues, 'RECEIPT_BOX_QUANTITY_MISMATCH', 'BOX 입고수량과 실제 박스수가 다릅니다.', id);
    const stemsPerBunch = num(settings.stemsPerBunch), bunchesPerBox = num(settings.bunchesPerBox);
    const factor = unit === 'STEM' ? 1 : unit === 'BUNCH' && stemsPerBunch > 0 ? stemsPerBunch
      : unit === 'BOX' && stemsPerBunch > 0 && bunchesPerBox > 0 ? stemsPerBunch * bunchesPerBox : null;
    if (!(factor > 0)) error(issues, 'UNIT_CONVERSION_REQUIRED', '가격 기준 송이수로 환산할 송이/단·단/박스를 명시하세요.', id);
    const stems = qty * factor;
    if (present(row.stemQuantity) && (num(row.stemQuantity) === null || !near(num(row.stemQuantity), stems)))
      error(issues, 'QUANTITY_CONVERSION_MISMATCH', '실제수량 환산 송이수와 확인한 송이수가 다릅니다.', id);
    if (!near(stems * price, amount)) error(issues, 'NATIVE_AMOUNT_MISMATCH', '실제 송이수×송이 단가와 원문 금액이 다릅니다.', id);
    if (tariff === null || tariff < 0 || tariff > 1) error(issues, 'TARIFF_RATE_REQUIRED', '현재 관세율을 0~1로 명시하세요.', id);
    if (isCO && tariff !== 0) error(issues, 'CO_TARIFF_UNVERIFIED', '이 콜롬비아 원본은 명시한 관세 0만 지원합니다.', id);
    if (group) {
      group.actualStems += stems;
      // Never substitute a missing receipt count with zero or an input count.
      group.actualBoxes = receiptBoxes === null ? NaN : group.actualBoxes + receiptBoxes;
    }
    const fraction = group ? stems / group.quantity : 0;
    const gross = isCO && group ? group.gross * fraction : 0;
    const volume = isCO && group ? group.volume * fraction : 0;
    const share = !isCO && group ? group.boxes / totalBoxes * fraction : 0;
    for (const [key, expected] of isCO ? [['grossWeightKg', gross], ['volumeWeightKg', volume]] : [['allocationShare', share]]) {
      if (present(settings[key]) && (num(settings[key]) === null || !near(num(settings[key]), expected)))
        error(issues, 'LINE_ALLOCATION_MISMATCH', '행 배분값이 그룹 내 실제 송이 비율과 다릅니다.', id);
    }
    return { row, id, qty, amount, stems, tariff, gross, volume, share, groupId };
  });
  for (const id of lineInputs.keys()) if (!seen.has(id)) error(issues, 'LINE_INPUT_OUT_OF_SCOPE', '다른 문서 행의 입력이 있습니다.', id);
  for (const group of groups.values()) {
    if (!near(group.quantity, group.actualStems))
      error(issues, 'GROUP_QUANTITY_MISMATCH', '그룹 송이수와 해당 실제 입고 행의 송이수 합이 다릅니다.');
    if (!packingGroups && !near(group.boxes, group.actualBoxes))
      error(issues, 'GROUP_BOX_QUANTITY_MISMATCH', '그룹 박스수와 해당 실제 입고 행의 박스수 합이 다릅니다.');
  }
  const sumShares = rows.reduce((s, row) => s + row.share, 0);
  if (!isCO && !near(sumShares, 1)) error(issues, 'ALLOCATION_SHARE_SUM_MISMATCH', '전체 활성 행 배분비율 합은 1이어야 합니다.');
  if (issues.some(item => item.severity === 'error')) return empty();
  const freightKey = isCO ? (gw === cw ? 'gross' : 'volume') : 'share';
  const freightAllocations = allocate(freight, rows, freightKey);
  const customsAllocations = allocate(customs, rows, isCO ? 'gross' : 'share');
  const lines = rows.map(row => {
    const goodsNative = row.amount, freightNative = freightAllocations.get(row.id) ?? 0;
    const goodsKRW = goodsNative * fx, freightKRW = freightNative * fx;
    const tariffKRW = (goodsKRW + freightKRW) * row.tariff;
    const customsKRW = customsAllocations.get(row.id) ?? 0;
    const total = goodsKRW + freightKRW + tariffKRW + customsKRW;
    if (![total, goodsKRW, freightKRW, tariffKRW].every(Number.isFinite)) error(issues, 'COST_OVERFLOW', '계산 금액이 허용 숫자 범위를 벗어났습니다.', row.id);
    return { lineId: row.row.lineId, prodKey: row.row.prodKey, unit: row.row.unit,
      quantity: round(row.qty), currency: 'KRW', costPerUnitKRW: row.qty === 0 ? null : round(total / row.qty), totalCostKRW: round(total),
      groupId: row.groupId, priceBasis: 'STEM', priceBasisQuantity: round(row.stems),
      grossWeightKg: round(row.gross), volumeWeightKg: round(row.volume),
      allocationShare: isCO ? null : row.share,
      freightAllocationBasis: isCO ? (gw === cw ? 'GROSS_WEIGHT_KG' : 'VOLUME_WEIGHT_KG') : 'GROUP_BOX_SHARE',
      componentAmounts: { goodsNative: round(goodsNative), freightNative, goodsKRW: round(goodsKRW), freightKRW: round(freightKRW),
        tariffKRW: round(tariffKRW), customsKRW, otherKRW: 0, ...(row.qty === 0 ? { cancellation: true } : {}) } };
  });
  return issues.some(item => item.severity === 'error') ? empty() : { lines, expected95: null };
}
