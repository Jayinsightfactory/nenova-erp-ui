/** Pure, source-bound calculators. No ERP/DB access or historical rate defaults.
 * Integration: merge ADDITIONAL_INVOICE_COST_FORMULAS into the core registry,
 * then dispatch additionalInvoiceCostPreview after core common/base validation.
 * Preserve top-level customsTotalKRW and per-line tariffRate, stemsPerBunch,
 * bunchesPerBox in approved editable snapshots. CNF profiles require explicit
 * freightAmount=0; EC FOB allocates explicit freight by price-basis quantity.
 */
export const ADDITIONAL_INVOICE_COST_FORMULAS = Object.freeze({
  US_CNF_BOX_V1: Object.freeze({
    formulaId: 'US_CNF_BOX_V1', formulaVersion: '1.0.0', country: 'US', transportMode: 'AIR',
    formulaSourceHash: '49d523cd457f0e6c36cd4fb50f72705344899968b91b1142f8da5130b4d589df',
    formulaSourceSheet: '40-1', formulaSourceCells: 'C6,C9,M9,D13:L13,D21:F22',
    label: '미국 · CNF 박스 기준', priceBasis: 'BOX', freightIncluded: true,
    lineInputFields: Object.freeze(['tariffRate', 'stemsPerBunch', 'bunchesPerBox']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW']),
    sourceCaveat: 'E12 says CNF(단), but F13=D13*E13 and L13=J13/K13 establish BOX price. D23:D24 use a different flat-fee shortcut and are not this profile.',
  }),
  VN_CNF_STEM_V1: Object.freeze({
    formulaId: 'VN_CNF_STEM_V1', formulaVersion: '1.0.0', country: 'VN', transportMode: 'AIR',
    formulaSourceHash: '81123f0c69859eab1b78ed6d4d722c7738d4395df9e0d2b8d7cd25a7e39969c6',
    formulaSourceSheet: '24-1', formulaSourceCells: 'D6,D9,N9,E19:M21',
    label: '베트남 · CNF 송이 기준', priceBasis: 'STEM', freightIncluded: true,
    lineInputFields: Object.freeze(['tariffRate', 'stemsPerBunch', 'bunchesPerBox']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW']),
    sourceCaveat: 'CNF already includes freight. Historical row tariff rates differ; no rate or customs fee is defaulted.',
  }),
  AU_CNF_BUNCH_V1: Object.freeze({
    formulaId: 'AU_CNF_BUNCH_V1', formulaVersion: '1.0.0', country: 'AU', transportMode: 'AIR',
    formulaSourceHash: '7cb66ca12afce9ff937ea8bd6fda597c4ce411174961638fa276ed6713dfd320',
    formulaSourceSheet: '38-1', formulaSourceCells: 'D6,D9,N9,E13:M16',
    label: '호주 · CNF 단 기준', priceBasis: 'BUNCH', freightIncluded: true,
    lineInputFields: Object.freeze(['tariffRate', 'stemsPerBunch', 'bunchesPerBox']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW']),
    sourceCaveat: '39-1 D5/F5 omit rows17:24 (8040 difference). Never reuse truncated historical totals or assume currency/rates.',
  }),
  NZ_CNF_STEM_V1: Object.freeze({
    formulaId: 'NZ_CNF_STEM_V1', formulaVersion: '1.0.0', country: 'NZ', transportMode: 'AIR',
    formulaSourceHash: 'c58848b2daf200d650548d932b514acc8499e2d020ed721cd6bfff7bbdf692a4',
    formulaSourceSheet: 'Sheet1', formulaSourceCells: 'C6,C9,N9,E13:M19',
    label: '뉴질랜드 · CNF 송이 기준', priceBasis: 'STEM', freightIncluded: true,
    lineInputFields: Object.freeze(['tariffRate', 'stemsPerBunch', 'bunchesPerBox']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW']),
    sourceCaveat: 'C5 invoice4403.1 versus F5 detail3701.1 differs702; unresolved, never distribute or hide it. Zero-quantity template costs are not goods.',
  }),
  EC_FOB_STEM_V1: Object.freeze({
    formulaId: 'EC_FOB_STEM_V1', formulaVersion: '1.0.0', country: 'EC', transportMode: 'AIR',
    formulaSourceHash: '9f889056cbed364d30b20edd51cc803f2ba8a4c789ac17cf9908ab80976406eb',
    formulaSourceSheet: '40-2', formulaSourceCells: 'C7,C10,C11,P10,E14:O27',
    label: '에콰도르 · FOB 송이 수량 배분', priceBasis: 'STEM', freightIncluded: false,
    lineInputFields: Object.freeze(['tariffRate', 'stemsPerBunch', 'bunchesPerBox']),
    requiredTopLevelInputs: Object.freeze(['customsTotalKRW', 'freightAmount']),
    sourceCaveat: 'G heading says amount but formula allocates quantity. 26-1 cached formulas are null, not zero/proof. No historical fee/rate/currency defaults.',
  }),
});

const text = value => typeof value === 'string' ? value.normalize('NFC').trim().toUpperCase() : '';
const number = value => !['number', 'string'].includes(typeof value) || value === null || value === undefined
  || typeof value === 'string' && !value.trim() ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const near = (a, b) => Math.abs(a - b) <= 0.000001;
const country = value => ({ USA: 'US', 'UNITED STATES': 'US', 미국: 'US', VIETNAM: 'VN', 'VIET NAM': 'VN', 베트남: 'VN', AUSTRALIA: 'AU', 호주: 'AU', 'NEW ZEALAND': 'NZ', 뉴질랜드: 'NZ', ECUADOR: 'EC', 에콰도르: 'EC' })[text(value)] || text(value);
const addIssue = (issues, code, message, lineId) => issues.push({ code, message, severity: 'error', ...(lineId ? { lineId } : {}) });

/** normalizedRows are core baseValidation rows, not raw browser receipt rows.
 * common is core validateCommon output (including formula descriptor).
 * Errors append to issues and return no output lines; caller owns approval.
 */
export function additionalInvoiceCostPreview(document, normalizedRows, input, common, issues) {
  const empty = { lines: [], expected95: null };
  const profile = ADDITIONAL_INVOICE_COST_FORMULAS[common?.formula?.formulaId ?? input?.formulaId];
  if (!profile) { addIssue(issues, 'ADDITIONAL_FORMULA_UNSUPPORTED', '지원하지 않는 추가 국가 공식입니다.'); return empty; }
  const metadata = document?.reviewedMetadata || {};
  if (country(metadata.country ?? document?.country) !== profile.country)
    addIssue(issues, 'FORMULA_COUNTRY_MISMATCH', '공식과 문서 국가가 다릅니다.');
  if (text(metadata.transportMode ?? document?.transportMode) !== profile.transportMode)
    addIssue(issues, 'FORMULA_TRANSPORT_MISMATCH', '현재 공식은 명시적으로 확인한 AIR 운송만 지원합니다.');
  const nativeCurrency = text(common?.nativeCurrency);
  if (!/^[A-Z]{3}$/.test(nativeCurrency) || text(common?.freightCurrency) !== nativeCurrency
    || ['US', 'VN'].includes(profile.country) && nativeCurrency !== 'USD')
    addIssue(issues, 'FORMULA_CURRENCY_MISMATCH', '현재 가격·운임 통화를 명시하고 일치시켜 주세요.');
  const fx = number(common?.exchangeRate), customs = number(input?.customsTotalKRW);
  if (!(fx > 0)) addIssue(issues, 'EXCHANGE_RATE_REQUIRED', '현재 KRW/외화 환율을 명시하세요.');
  if (customs === null || customs < 0) addIssue(issues, 'CUSTOMS_TOTAL_REQUIRED', '현재 통관비 합계 KRW를 0 이상으로 명시하세요.');
  const freight = number(common?.effectiveFreightAmount);
  if (profile.freightIncluded && (number(input?.freightAmount) !== 0 || freight !== 0))
    addIssue(issues, 'CNF_FREIGHT_DOUBLE_COUNT', 'CNF에는 운임이 포함됩니다. 별도 운임은 명시적으로 0이어야 합니다.');
  if (!profile.freightIncluded && (number(input?.freightAmount) === null || number(input.freightAmount) < 0 || freight === null || freight < 0))
    addIssue(issues, 'FREIGHT_AMOUNT_REQUIRED', '현재 FOB 항공료를 동일 외화로 0 이상 명시하세요.');
  // Customs total is document-specific, not another application of AWB share.
  if (number(common?.share) !== 1)
    addIssue(issues, 'CNF_ALLOCATION_SCOPE_REQUIRED', '현재 문서의 CNF와 통관 합계를 사용하고 배분비율을 1로 명시하세요.');
  if (!Array.isArray(normalizedRows) || !normalizedRows.length || normalizedRows.length > 1000) {
    addIssue(issues, 'RECEIPT_LINES_REQUIRED', '1~1000개 실제 입고 행이 필요합니다.'); return empty;
  }
  const inputs = new Map();
  if (!Array.isArray(input?.lineInputs)) addIssue(issues, 'LINE_INPUTS_REQUIRED', '행별 원가 입력 목록이 필요합니다.');
  for (const line of Array.isArray(input?.lineInputs) ? input.lineInputs : []) {
    const id = String(line?.lineId || '').toLowerCase();
    if (!id || inputs.has(id)) addIssue(issues, 'LINE_INPUT_DUPLICATE', '행별 입력 연결이 중복되거나 비어 있습니다.');
    inputs.set(id, line);
  }
  const seen = new Set();
  const rows = normalizedRows.map(row => {
    const id = String(row.lineId || '').toLowerCase(), settings = inputs.get(id) || {};
    if (seen.has(id)) addIssue(issues, 'LINE_ID_DUPLICATE', '입고 행 연결이 중복되었습니다.', id);
    seen.add(id);
    const qty = number(row.actualQuantity), price = number(row.unitPrice), amount = number(row.lineAmount);
    const unit = text(row.unit), tariff = number(settings.tariffRate);
    const bunches = number(settings.bunchesPerBox), stems = number(settings.stemsPerBunch);
    const extra = settings.otherCostPerUnitKRW;
    if (extra != null && !(typeof extra === 'string' && !extra.trim()) && number(extra) !== 0)
      addIssue(issues, 'ADDITIONAL_COST_UNSUPPORTED', '이 원본 공식에 없는 기타비용은 자동 합산하지 않습니다.', id);
    // Core already validates identity, unit, currency and source price. A zero
    // quantity/amount row carries no allocation and needs no tariff/conversion.
    if (qty === 0 && amount === 0)
      return { row, id, qty: 0, basisQuantity: 0, amount: 0, tariff: 0 };
    if (qty === 0 && amount !== 0)
      addIssue(issues, 'CANCELLED_LINE_AMOUNT_INVALID', '취소행의 원문 라인 금액은 0이어야 합니다.', id);
    let factor = null;
    if (unit === profile.priceBasis) factor = 1;
    else if (profile.priceBasis === 'BOX' && unit === 'BUNCH' && bunches > 0) factor = 1 / bunches;
    else if (profile.priceBasis === 'BOX' && unit === 'STEM' && bunches > 0 && stems > 0) factor = 1 / (bunches * stems);
    else if (profile.priceBasis === 'STEM' && unit === 'BUNCH' && stems > 0) factor = stems;
    else if (profile.priceBasis === 'STEM' && unit === 'BOX' && bunches > 0 && stems > 0) factor = bunches * stems;
    else if (profile.priceBasis === 'BUNCH' && unit === 'BOX' && bunches > 0) factor = bunches;
    else if (profile.priceBasis === 'BUNCH' && unit === 'STEM' && stems > 0) factor = 1 / stems;
    if (factor === null) addIssue(issues, 'UNIT_CONVERSION_REQUIRED', '실제 단위와 CNF 단위 사이의 단/박스·송이/단 환산을 명시하세요.', id);
    if (qty === null || qty < 0 || price === null || price < 0 || amount === null || amount < 0)
      addIssue(issues, 'CNF_AMOUNT_REQUIRED', '실제수량·CNF 단가·라인 금액은 0 이상이어야 합니다.', id);
    if (text(row.currency) !== nativeCurrency) addIssue(issues, 'LINE_CURRENCY_MISMATCH', '행별 가격 통화와 승인 입력 통화가 다릅니다.', id);
    if (tariff === null || tariff < 0 || tariff > 1) addIssue(issues, 'TARIFF_RATE_REQUIRED', '현재 행 관세율을 0~1로 명시하세요.', id);
    const basisQuantity = qty * factor;
    if (![factor, basisQuantity, basisQuantity * price].every(Number.isFinite))
      addIssue(issues, 'COST_NUMERIC_OVERFLOW', '수량 환산 또는 가격 계산이 숫자 범위를 초과했습니다.', id);
    // Do not substitute EXE EstQuantity or assume SteamQuantity==OutQuantity.
    // Compare supplied physical quantities only where explicit factors establish
    // the relationship; a missing physical quantity remains unknown.
    const quantities = {
      BOX: unit === 'BOX' ? qty : bunches > 0 ? (unit === 'BUNCH' ? qty / bunches : stems > 0 ? qty / stems / bunches : null) : null,
      BUNCH: unit === 'BUNCH' ? qty : unit === 'BOX' && bunches > 0 ? qty * bunches : unit === 'STEM' && stems > 0 ? qty / stems : null,
      STEM: unit === 'STEM' ? qty : unit === 'BUNCH' && stems > 0 ? qty * stems : unit === 'BOX' && bunches > 0 && stems > 0 ? qty * bunches * stems : null,
    };
    for (const [physicalUnit, field] of [['BOX', 'boxQuantity'], ['BUNCH', 'bunchQuantity'], ['STEM', 'stemQuantity']]) {
      if (row[field] == null) continue;
      const supplied = number(row[field]), expected = quantities[physicalUnit];
      if (supplied === null || supplied < 0 || expected !== null && (!Number.isFinite(expected) || !near(supplied, expected)))
        addIssue(issues, 'RECEIPT_UNIT_QUANTITY_MISMATCH', '입고 박스·단·송이 수량과 명시 환산값이 다릅니다.', id);
    }
    if (factor !== null && qty !== null && price !== null && amount !== null && !near(basisQuantity * price, amount))
      addIssue(issues, 'CNF_AMOUNT_MISMATCH', 'CNF 기준 수량×단가와 원문 금액이 다릅니다.', id);
    return { row, id, qty, basisQuantity, amount, tariff };
  });
  for (const id of inputs.keys()) if (!seen.has(id)) addIssue(issues, 'LINE_INPUT_OUT_OF_SCOPE', '다른 문서 행의 원가 입력이 있습니다.', id);
  const denominator = rows.reduce((sum, row) => sum + row.basisQuantity, 0);
  if (!Number.isFinite(denominator)) addIssue(issues, 'COST_NUMERIC_OVERFLOW', '배분 총수량이 숫자 범위를 초과했습니다.');
  if (!(denominator > 0)) addIssue(issues, 'ALLOCATION_QUANTITY_REQUIRED', 'CNF 기준 총수량은 0보다 커야 합니다.');
  if (issues.some(item => item.severity === 'error')) return empty;
  const active = rows.filter(row => row.basisQuantity > 0).sort((a, b) => a.id.localeCompare(b.id));
  const allocateCumulative = total => {
    const result = new Map(); let weight = 0, previous = 0;
    active.forEach((row, i) => {
      weight += row.basisQuantity;
      const cumulative = i === active.length - 1 ? round(total) : round(total * Math.min(1, weight / denominator));
      const value = round(cumulative - previous); previous = cumulative; result.set(row.id, value);
      if (!Number.isFinite(value) || value < 0) addIssue(issues, 'COST_NUMERIC_OVERFLOW', '비용 배분이 유효한 숫자 범위를 벗어났습니다.');
    });
    return result;
  };
  const allocation = allocateCumulative(customs);
  const freightAllocation = profile.freightIncluded ? new Map() : allocateCumulative(freight);
  const lines = rows.map(({ row, id, qty, amount, tariff }) => {
    const freightNative = freightAllocation.get(id) ?? 0;
    const cnfKRW = (amount + freightNative) * fx, tariffKRW = cnfKRW * tariff, customsKRW = allocation.get(id) ?? 0;
    const total = cnfKRW + tariffKRW + customsKRW;
    return { lineId: row.lineId, prodKey: row.prodKey, unit: row.unit, quantity: round(qty), currency: 'KRW',
      costPerUnitKRW: qty === 0 ? null : round(total / qty), totalCostKRW: round(total),
      // CNF is deliberately not relabeled as goods-only. No invented breakup.
      componentAmounts: { ...(profile.freightIncluded
        ? { cnfNative: round(amount), cnfKRW: round(cnfKRW), freightIncluded: true }
        : { goodsNative: round(amount), goodsKRW: round(amount * fx), freightNative,
          freightKRW: round(freightNative * fx), freightIncluded: false }),
        tariffKRW: round(tariffKRW), customsKRW, otherKRW: 0, ...(qty === 0 ? { cancellation: true } : {}) } };
  });
  const numericValues = lines.flatMap(line => [line.quantity, line.totalCostKRW, ...(line.costPerUnitKRW === null ? [] : [line.costPerUnitKRW]),
    ...Object.values(line.componentAmounts).filter(value => typeof value === 'number')]);
  if (numericValues.some(value => !Number.isFinite(value) || value < 0)
    || !Number.isFinite(lines.reduce((sum, line) => sum + line.totalCostKRW, 0)))
    addIssue(issues, 'COST_NUMERIC_OVERFLOW', '원가 계산 또는 합계가 유효한 숫자 범위를 벗어났습니다.');
  return issues.some(item => item.severity === 'error') ? empty : { expected95: null, lines };
}
