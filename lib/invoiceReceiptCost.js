const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/i;
const CURRENCY_RE = /^[A-Z]{3}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LINES = 1000;
const MAX_SNAPSHOT_BYTES = 256 * 1024;

export const INVOICE_COST_FORMULAS = Object.freeze({
  CN_SEA_ACTUAL_V1: Object.freeze({
    formulaId: 'CN_SEA_ACTUAL_V1',
    formulaVersion: '1.0.0',
    formulaSourceHash: '5e9241ac85d3152b976419422d2cce6498c02346563e2dc1a637e7eace9187a7',
    formulaSourceSheet: '41-1 해상 (95% 기준)',
    formulaSourceCells: 'AK8=C11*AJ8/AH8',
    label: '중국 해상 · 실제 입고수량 배분',
  }),
  NL_AMOUNT_V1: Object.freeze({
    formulaId: 'NL_AMOUNT_V1',
    formulaVersion: '1.0.0',
    formulaSourceHash: 'fc9448ed983d18f0c180b4b8e1f27c1a7ef935b2e657c429eb42f2251b836d42',
    formulaSourceSheet: '40-2',
    formulaSourceCells: 'G15,H15,J15,K15,L15,M15,O15,P15',
    label: '네덜란드 · 상품금액 비율 배분',
  }),
});

export class InvoiceReceiptCostError extends Error {
  constructor(code, message, statusCode = 400, issues = undefined) {
    super(message);
    this.name = 'InvoiceReceiptCostError';
    this.code = code;
    this.statusCode = statusCode;
    this.issues = issues;
  }
}

const param = (type, value) => ({ type, value });
const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;
const close = (left, right, tolerance = 0.000001) => Math.abs(Number(left) - Number(right)) <= tolerance;

function normalizeText(value) {
  return typeof value === 'string' ? value.normalize('NFC').trim() : '';
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(number) ? number : null;
}

function normalizeCurrency(value) {
  const currency = normalizeText(value).toUpperCase();
  return CURRENCY_RE.test(currency) ? currency : null;
}

function normalizeUnit(value) {
  const unit = normalizeText(value).toUpperCase();
  if (['STEM', 'STEMS', '송이'].includes(unit)) return 'STEM';
  if (['BUNCH', 'BUNCHES', '단'].includes(unit)) return 'BUNCH';
  if (['BOX', 'BOXES', '박스'].includes(unit)) return 'BOX';
  return null;
}

function countryCode(document) {
  const country = normalizeText(document?.reviewedMetadata?.country ?? document?.country).toUpperCase();
  if (['CN', 'CHINA', '중국'].includes(country)) return 'CN';
  if (['NL', 'NETHERLANDS', 'HOLLAND', '네덜란드'].includes(country)) return 'NL';
  return country || null;
}

function costInputOf(document) {
  return document?.costInput ?? document?.reviewedMetadata?.invoiceCostInput ?? document?.reviewedMetadata?.costInput ?? {};
}

function issue(list, code, message, options = {}) {
  list.push({ code, message, severity: options.severity || 'error', ...(options.lineId ? { lineId: options.lineId } : {}) });
}

function lineInputMap(input) {
  const rows = Array.isArray(input?.lineInputs) ? input.lineInputs : [];
  return new Map(rows.map(row => [String(row?.lineId || '').toLowerCase(), row || {}]));
}

function allocate(total, weightedRows, weightKey) {
  const amount = Number(total);
  const denominator = weightedRows.reduce((sum, row) => sum + Number(row[weightKey]), 0);
  if (!Number.isFinite(amount) || !(denominator > 0)) return null;
  const sorted = [...weightedRows].sort((a, b) => String(a.lineId).localeCompare(String(b.lineId)));
  let allocated = 0;
  const result = new Map();
  sorted.forEach((row, index) => {
    const value = index === sorted.length - 1
      ? round6(amount - allocated)
      : round6(amount * Number(row[weightKey]) / denominator);
    allocated = round6(allocated + value);
    result.set(row.lineId, value);
  });
  return result;
}

function baseValidation(document, receiptLines, input, issues) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    issue(issues, 'DOCUMENT_REQUIRED', '저장된 인보이스 문서가 필요합니다.');
  }
  if (!Array.isArray(receiptLines) || receiptLines.length < 1 || receiptLines.length > MAX_LINES) {
    issue(issues, 'RECEIPT_LINES_REQUIRED', `입고 연결 행은 1~${MAX_LINES}개여야 합니다.`);
    return [];
  }
  const seen = new Set();
  return receiptLines.map((line, index) => {
    const lineId = normalizeText(line?.lineId).toLowerCase();
    if (!UUID_RE.test(lineId)) issue(issues, 'LINE_ID_REQUIRED', `${index + 1}행의 lineId를 확인하세요.`);
    if (seen.has(lineId)) issue(issues, 'LINE_ID_DUPLICATE', 'lineId가 중복되었습니다.', { lineId });
    seen.add(lineId);
    const prodKey = finite(line?.prodKey);
    const quantity = finite(line?.outQuantity);
    const unit = normalizeUnit(line?.outUnit);
    const lineAmount = finite(line?.lineAmount);
    const unitPrice = finite(line?.unitPrice);
    const currency = normalizeCurrency(line?.currency);
    if (!Number.isInteger(prodKey) || prodKey <= 0) issue(issues, 'PRODUCT_REQUIRED', '연결된 전산 품목이 필요합니다.', { lineId });
    if (quantity === null || quantity < 0) issue(issues, 'ACTUAL_QUANTITY_REQUIRED', '실제 입고수량은 0 이상이어야 합니다.', { lineId });
    if (!unit) issue(issues, 'UNIT_REQUIRED', '실제 입고단위를 확인하세요.', { lineId });
    if (lineAmount === null || lineAmount < 0) issue(issues, 'LINE_AMOUNT_REQUIRED', '원문 라인 금액을 0 이상으로 명시하세요.', { lineId });
    if (quantity === 0 && lineAmount !== null && lineAmount > 0) {
      issue(issues, 'CANCELLED_LINE_AMOUNT_INVALID', '취소행은 실제 입고수량과 원문 라인 금액이 모두 0이어야 합니다.', { lineId });
    }
    if (unitPrice === null || unitPrice < 0) issue(issues, 'UNIT_PRICE_REQUIRED', '원문 단가를 0 이상으로 명시하세요.', { lineId });
    if (!currency) issue(issues, 'CURRENCY_REQUIRED', '원문 가격 통화를 세 글자로 명시하세요.', { lineId });
    return {
      ...line,
      lineId,
      prodKey,
      actualQuantity: quantity,
      unit,
      lineAmount,
      unitPrice,
      currency,
      stemQuantity: finite(line?.stemQuantity),
      bunchQuantity: finite(line?.bunchQuantity),
      boxQuantity: finite(line?.boxQuantity),
    };
  });
}

function validateCommon(document, rows, input, issues) {
  const formula = INVOICE_COST_FORMULAS[normalizeText(input.formulaId)];
  if (!formula) {
    issue(issues, 'FORMULA_UNSUPPORTED', '현재 승인된 인보이스 원가 공식은 중국 해상 실제량과 네덜란드 금액배분뿐입니다.');
    return null;
  }
  if (normalizeText(input.formulaVersion) !== formula.formulaVersion) {
    issue(issues, 'FORMULA_VERSION_UNVERIFIED', `공식 버전 ${formula.formulaVersion}을 사용하세요.`);
  }
  if (normalizeText(input.formulaSourceHash).toLowerCase() !== formula.formulaSourceHash) {
    issue(issues, 'FORMULA_SOURCE_UNVERIFIED', '검증된 원가 원본 해시와 일치하지 않습니다.');
  }
  if (normalizeText(input.formulaSourceSheet) !== formula.formulaSourceSheet
    || normalizeText(input.formulaSourceCells) !== formula.formulaSourceCells) {
    issue(issues, 'FORMULA_SOURCE_LOCATION_UNVERIFIED', '검증된 공식 원본의 시트·셀 근거와 일치하지 않습니다.');
  }
  const reviewedInputDate = normalizeText(document?.reviewedMetadata?.inputDate);
  const formulaEffectiveDate = normalizeText(input.formulaEffectiveDate);
  if (input.formulaApplicabilityConfirmed !== true) {
    issue(issues, 'FORMULA_APPLICABILITY_CONFIRMATION_REQUIRED', '이 입고일·운송·품목에 원본 계산식을 적용한다는 확인이 필요합니다.');
  }
  if (!ISO_DATE_RE.test(reviewedInputDate) || formulaEffectiveDate !== reviewedInputDate) {
    issue(issues, 'FORMULA_EFFECTIVE_DATE_REQUIRED', '공식 적용일은 검토된 입고일과 동일하게 명시해야 합니다.');
  }
  const nativeCurrency = normalizeCurrency(input.nativeCurrency);
  const freightCurrency = normalizeCurrency(input.freightCurrency);
  if (!nativeCurrency) issue(issues, 'NATIVE_CURRENCY_REQUIRED', '매입 가격 통화를 명시하세요.');
  if (!freightCurrency) issue(issues, 'FREIGHT_CURRENCY_REQUIRED', '운임 통화를 명시하세요.');
  if (nativeCurrency && freightCurrency && nativeCurrency !== freightCurrency) {
    issue(issues, 'FREIGHT_CURRENCY_MISMATCH', '현재 공식은 매입 통화와 운임 통화가 같은 경우만 지원합니다.');
  }
  for (const row of rows) {
    if (nativeCurrency && row.currency && row.currency !== nativeCurrency) {
      issue(issues, 'LINE_CURRENCY_MISMATCH', `행 통화 ${row.currency}가 선택 통화 ${nativeCurrency}와 다릅니다.`, { lineId: row.lineId });
    }
  }
  const exchangeRate = finite(input.exchangeRateKRW);
  if (!(exchangeRate > 0)) issue(issues, 'EXCHANGE_RATE_REQUIRED', '원화 환율은 0보다 큰 값이어야 합니다.');
  if (!normalizeText(input.exchangeRateType)) issue(issues, 'EXCHANGE_RATE_TYPE_REQUIRED', '환율 종류를 명시하세요.');
  if (!ISO_DATE_RE.test(normalizeText(input.exchangeRateDate))) issue(issues, 'EXCHANGE_RATE_DATE_REQUIRED', '환율 기준일을 YYYY-MM-DD로 명시하세요.');
  const freightAmount = finite(input.freightAmount);
  if (freightAmount === null || freightAmount < 0) issue(issues, 'FREIGHT_AMOUNT_REQUIRED', '운임은 0 이상으로 명시하세요.');
  if (normalizeText(input.allocationScope) !== 'SINGLE_INVOICE') {
    issue(issues, 'SHARED_COST_SCOPE_UNSUPPORTED', '공동 AWB 비용은 이 인보이스에 명시적으로 배정된 몫만 저장할 수 있습니다.');
  }
  const costSourceId = normalizeText(input.costSourceId);
  if (!costSourceId || costSourceId.length > 200) issue(issues, 'COST_SOURCE_ID_REQUIRED', '중복 확인용 비용 원천 ID를 1~200자로 입력하세요.');
  const shareNumerator = finite(input.allocationShareNumerator);
  const shareDenominator = finite(input.allocationShareDenominator);
  if (shareNumerator === null || shareNumerator < 0 || !(shareDenominator > 0) || shareNumerator > shareDenominator) {
    issue(issues, 'ALLOCATION_SHARE_REQUIRED', '단일 인보이스 배분 분자/분모를 0≤분자≤분모, 분모>0으로 명시하세요.');
  }
  const share = shareNumerator !== null && shareDenominator > 0 ? shareNumerator / shareDenominator : null;
  return {
    formula,
    nativeCurrency,
    freightCurrency,
    exchangeRate,
    freightAmount,
    effectiveFreightAmount: share === null || freightAmount === null ? null : freightAmount * share,
    share,
    shareNumerator,
    shareDenominator,
    costSourceId,
    formulaEffectiveDate,
  };
}

function outputLine(row, costPerUnit, totalCost, components) {
  return {
    lineId: row.lineId,
    prodKey: row.prodKey,
    unit: row.unit,
    quantity: round6(row.actualQuantity),
    currency: 'KRW',
    costPerUnitKRW: costPerUnit === null ? null : round6(costPerUnit),
    totalCostKRW: round6(totalCost),
    componentAmounts: Object.fromEntries(Object.entries(components).map(([key, value]) => [key,
      typeof value === 'boolean' || value === null ? value : round6(value)])),
  };
}

function cancelledOutputLine(row) {
  return outputLine(row, null, 0, {
    cancellation: true,
    goodsNative: 0,
    freightNative: 0,
    goodsKRW: 0,
    freightKRW: 0,
    tariffKRW: 0,
    otherKRW: 0,
    customsKRW: 0,
  });
}

function chinaPreview(document, rows, input, common, issues) {
  if (countryCode(document) !== 'CN') issue(issues, 'FORMULA_COUNTRY_MISMATCH', '중국 해상 공식은 중국 문서에만 사용할 수 있습니다.');
  if (normalizeText(document?.reviewedMetadata?.transportMode).toUpperCase() !== 'SEA') {
    issue(issues, 'FORMULA_TRANSPORT_MISMATCH', '중국 실제량 공식은 SEA 운송에만 사용할 수 있습니다.');
  }
  const activeRows = rows.filter(row => row.actualQuantity > 0);
  const units = new Set(activeRows.map(row => row.unit).filter(Boolean));
  if (units.size > 1) issue(issues, 'ACTUAL_UNIT_MIXED', '실제량 운임 배분은 같은 입고단위 행만 함께 계산할 수 있습니다.');
  const inputs = lineInputMap(input);
  for (const row of rows) {
    if (row.actualQuantity === 0) continue;
    const lineInput = inputs.get(row.lineId) || {};
    const tariffRate = finite(lineInput.tariffRate);
    const otherCost = finite(lineInput.otherCostPerUnitKRW);
    if (tariffRate === null || tariffRate < 0 || tariffRate > 1) issue(issues, 'TARIFF_RATE_REQUIRED', '관세율을 0~1로 명시하세요.', { lineId: row.lineId });
    if (otherCost === null || otherCost < 0) issue(issues, 'OTHER_COST_REQUIRED', '기타비용/입고단위를 0 이상으로 명시하세요.', { lineId: row.lineId });
    row.tariffRate = tariffRate;
    row.otherCostPerUnitKRW = otherCost;
  }
  if (activeRows.length === 0 && common.effectiveFreightAmount > 0) {
    issue(issues, 'ACTUAL_ALLOCATION_REQUIRED', '실제 입고수량이 모두 0이어서 남은 운임을 배분할 수 없습니다.');
  }
  if (issues.some(item => item.severity === 'error')) return { lines: [], expected95: null };
  const freight = activeRows.length > 0 ? allocate(common.effectiveFreightAmount, activeRows, 'actualQuantity') : new Map();
  const lines = rows.map(row => {
    if (row.actualQuantity === 0) return cancelledOutputLine(row);
    const goodsNative = row.lineAmount;
    const freightNative = freight.get(row.lineId);
    const cnfKRW = (goodsNative + freightNative) * common.exchangeRate;
    const tariffKRW = cnfKRW * row.tariffRate;
    const otherKRW = row.otherCostPerUnitKRW * row.actualQuantity;
    const totalCost = cnfKRW + tariffKRW + otherKRW;
    return outputLine(row, totalCost / row.actualQuantity, totalCost, {
      goodsNative,
      freightNative,
      goodsKRW: goodsNative * common.exchangeRate,
      freightKRW: freightNative * common.exchangeRate,
      tariffKRW,
      otherKRW,
    });
  });
  const expectedQuantity = finite(input.expected95Quantity);
  let expected95 = null;
  if (input.expected95Quantity !== null && input.expected95Quantity !== undefined && input.expected95Quantity !== '') {
    if (!(expectedQuantity > 0)) {
      issue(issues, 'EXPECTED_95_QUANTITY_INVALID', '95% 예상수량은 0보다 커야 하며 실제량 원가를 대신하지 않습니다.', { severity: 'warning' });
    } else {
      const expectedFreightPerUnit = common.effectiveFreightAmount / expectedQuantity;
      expected95 = {
        basis: 'EXPECTED_95',
        status: 'COMPARISON_ONLY',
        quantity: round6(expectedQuantity),
        unit: [...units][0] || null,
        freightPerUnitNative: round6(expectedFreightPerUnit),
        lines: rows.map(row => {
          if (row.actualQuantity === 0) return cancelledOutputLine(row);
          const goodsPerUnitNative = row.lineAmount / row.actualQuantity;
          const cnfPerUnitKRW = (goodsPerUnitNative + expectedFreightPerUnit) * common.exchangeRate;
          const tariffPerUnitKRW = cnfPerUnitKRW * row.tariffRate;
          const costPerUnit = cnfPerUnitKRW + tariffPerUnitKRW + row.otherCostPerUnitKRW;
          return outputLine(row, costPerUnit, costPerUnit * row.actualQuantity, {
            goodsKRW: goodsPerUnitNative * common.exchangeRate * row.actualQuantity,
            freightKRW: expectedFreightPerUnit * common.exchangeRate * row.actualQuantity,
            tariffKRW: tariffPerUnitKRW * row.actualQuantity,
            otherKRW: row.otherCostPerUnitKRW * row.actualQuantity,
          });
        }),
      };
    }
  }
  return { lines, expected95 };
}

function netherlandsPreview(document, rows, input, common, issues) {
  if (countryCode(document) !== 'NL') issue(issues, 'FORMULA_COUNTRY_MISMATCH', '네덜란드 금액배분 공식은 네덜란드 문서에만 사용할 수 있습니다.');
  if (normalizeText(document?.reviewedMetadata?.transportMode).toUpperCase() !== 'AIR') {
    issue(issues, 'FORMULA_TRANSPORT_MISMATCH', '네덜란드 금액배분 공식은 AIR 운송에만 사용할 수 있습니다.');
  }
  const customsTotalKRW = finite(input.customsTotalKRW);
  if (customsTotalKRW === null || customsTotalKRW < 0) issue(issues, 'CUSTOMS_TOTAL_REQUIRED', '통관비 합계를 원화 0 이상으로 명시하세요.');
  const activeRows = rows.filter(row => row.actualQuantity > 0);
  const inputs = lineInputMap(input);
  for (const row of rows) {
    if (row.actualQuantity === 0) {
      row.amountWeight = 0;
      continue;
    }
    const lineInput = inputs.get(row.lineId) || {};
    const tariffRate = finite(lineInput.tariffRate);
    const stemsPerBunch = finite(lineInput.stemsPerBunch);
    if (!(row.stemQuantity > 0)) issue(issues, 'STEM_QUANTITY_REQUIRED', 'NL 금액배분에는 실제 송이수 E가 필요합니다.', { lineId: row.lineId });
    if (tariffRate === null || tariffRate < 0 || tariffRate > 1) issue(issues, 'TARIFF_RATE_REQUIRED', '관세율을 0~1로 명시하세요.', { lineId: row.lineId });
    if (row.unit === 'BOX') issue(issues, 'NL_BOX_FORMULA_UNVERIFIED', '검증된 NL 표본은 송이·단 원가만 지원합니다.', { lineId: row.lineId });
    if (row.unit === 'BUNCH' && !(stemsPerBunch > 0)) issue(issues, 'STEMS_PER_BUNCH_REQUIRED', '단 원가에는 단당 송이수 N이 필요합니다.', { lineId: row.lineId });
    if (row.stemQuantity > 0 && row.unitPrice !== null && row.lineAmount !== null
      && !close(row.unitPrice * row.stemQuantity, row.lineAmount, Math.max(0.000001, Math.abs(row.lineAmount) * 0.000001))) {
      issue(issues, 'NATIVE_AMOUNT_MISMATCH', '원문 단가×송이수와 라인 금액이 일치하지 않습니다.', { lineId: row.lineId });
    }
    const factor = row.unit === 'STEM' ? 1 : stemsPerBunch;
    if (factor > 0 && row.stemQuantity > 0 && !close(row.actualQuantity * factor, row.stemQuantity, 0.00001)) {
      issue(issues, 'QUANTITY_CONVERSION_MISMATCH', '실제 입고수량×단당 송이수와 원문 송이수가 일치하지 않습니다.', { lineId: row.lineId });
    }
    row.tariffRate = tariffRate;
    row.stemsPerBunch = stemsPerBunch;
    row.outputFactor = factor;
    row.amountWeight = row.lineAmount;
  }
  const invoiceGoodsTotal = activeRows.reduce((sum, row) => sum + (row.lineAmount ?? 0), 0);
  if (activeRows.length === 0) {
    const effectiveCustoms = customsTotalKRW === null || common.share === null ? null : customsTotalKRW * common.share;
    if (common.effectiveFreightAmount > 0 || effectiveCustoms > 0) {
      issue(issues, 'ACTUAL_ALLOCATION_REQUIRED', '실제 입고수량이 모두 0이어서 남은 운임·통관비를 배분할 수 없습니다.');
    }
  } else if (!(invoiceGoodsTotal > 0)) {
    issue(issues, 'INVOICE_GOODS_TOTAL_REQUIRED', 'NL 금액배분 분모 D6는 0보다 커야 합니다.');
  }
  if (issues.some(item => item.severity === 'error')) return { lines: [], expected95: null };
  const freight = activeRows.length > 0 ? allocate(common.effectiveFreightAmount, activeRows, 'amountWeight') : new Map();
  const effectiveCustoms = customsTotalKRW * common.share;
  const customs = activeRows.length > 0 ? allocate(effectiveCustoms, activeRows, 'amountWeight') : new Map();
  const lines = rows.map(row => {
    if (row.actualQuantity === 0) return cancelledOutputLine(row);
    const freightNative = freight.get(row.lineId);
    const customsKRW = customs.get(row.lineId);
    const cnfPerStemNative = row.unitPrice + freightNative / row.stemQuantity;
    const cnfPerStemKRW = cnfPerStemNative * common.exchangeRate;
    const tariffPerStemKRW = cnfPerStemKRW * row.tariffRate;
    const customsPerStemKRW = customsKRW / row.stemQuantity;
    const arrivalPerStemKRW = cnfPerStemKRW + tariffPerStemKRW + customsPerStemKRW;
    const costPerUnit = arrivalPerStemKRW * row.outputFactor;
    const totalCost = costPerUnit * row.actualQuantity;
    return outputLine(row, costPerUnit, totalCost, {
      amountShare: row.lineAmount / invoiceGoodsTotal,
      goodsKRW: row.lineAmount * common.exchangeRate,
      freightNative,
      freightKRW: freightNative * common.exchangeRate,
      tariffKRW: tariffPerStemKRW * row.stemQuantity,
      customsKRW,
      arrivalPerStemKRW,
      vatIncludedCostPerUnitKRW: costPerUnit * 1.1,
    });
  });
  return { lines, expected95: null };
}

function totalsOf(lines) {
  if (!lines.length) return null;
  const componentTotals = {};
  for (const line of lines) {
    for (const [key, value] of Object.entries(line.componentAmounts || {})) {
      if (key === 'amountShare' || key === 'arrivalPerStemKRW' || key === 'vatIncludedCostPerUnitKRW'
        || key === 'cancellation' || typeof value !== 'number') continue;
      componentTotals[key] = round6((componentTotals[key] || 0) + value);
    }
  }
  return {
    totalCostKRW: round6(lines.reduce((sum, line) => sum + line.totalCostKRW, 0)),
    componentAmounts: componentTotals,
  };
}

export function previewInvoiceCost(document, receiptLines) {
  const input = costInputOf(document);
  const issues = [];
  const rows = baseValidation(document, receiptLines, input, issues);
  const common = validateCommon(document, rows, input, issues);
  let result = { lines: [], expected95: null };
  if (common?.formula?.formulaId === 'CN_SEA_ACTUAL_V1') result = chinaPreview(document, rows, input, common, issues);
  if (common?.formula?.formulaId === 'NL_AMOUNT_V1') result = netherlandsPreview(document, rows, input, common, issues);
  const hasErrors = issues.some(item => item.severity === 'error');
  return {
    status: hasErrors ? 'REVIEW_REQUIRED' : 'APPROVED',
    basis: 'ACTUAL',
    currency: 'KRW',
    formulaId: common?.formula?.formulaId ?? (normalizeText(input.formulaId) || null),
    formulaVersion: common?.formula?.formulaVersion ?? (normalizeText(input.formulaVersion) || null),
    formulaSourceHash: common?.formula?.formulaSourceHash ?? (normalizeText(input.formulaSourceHash).toLowerCase() || null),
    costSourceId: common?.costSourceId || null,
    allocationShare: common?.share ?? null,
    issues,
    lines: hasErrors ? [] : result.lines,
    totals: hasErrors ? null : totalsOf(result.lines),
    expected95: hasErrors ? null : result.expected95,
    note: '실제 입고량 계산이 공식 원가입니다. 95% 예상 계산은 비교 전용이며 실제값 누락을 대체하지 않습니다.',
  };
}

function sqlType(types, name, ...args) {
  const candidate = types?.[name];
  if (!candidate) throw new TypeError(`SQL type ${name} is required`);
  return typeof candidate === 'function' ? candidate(...args) : candidate;
}

function assertUuid(value, name) {
  const id = normalizeText(value).toLowerCase();
  if (!UUID_RE.test(id)) throw new InvoiceReceiptCostError('INVALID_ID', `${name} must be a UUID`, 400);
  return id;
}

function assertActor(value) {
  const actor = normalizeText(value);
  if (!actor || actor.length > 200) throw new InvoiceReceiptCostError('ACTOR_REQUIRED', '로그인 사용자를 확인하세요.', 403);
  return actor;
}

function assertReason(value) {
  const reason = normalizeText(value);
  if (!reason || reason.length > 1000) throw new InvoiceReceiptCostError('REASON_REQUIRED', '승인 사유를 1~1,000자로 입력하세요.', 400);
  return reason;
}

function latestCommittedOperation(document, revision) {
  const matches = (document?.operations || []).filter(operation => operation.status === 'COMMITTED'
    && Number(operation.documentRevision) === revision && operation.warehouseKey > 0);
  if (matches.length !== 1) {
    throw new InvoiceReceiptCostError('COMMITTED_RECEIPT_REQUIRED', '현재 문서 버전의 확정 입고 작업이 정확히 하나 필요합니다.', 409);
  }
  const operation = matches[0];
  if (!HASH_RE.test(normalizeText(operation.result?.receiptDigest)) || !Array.isArray(operation.result?.lineMappings)) {
    throw new InvoiceReceiptCostError('RECEIPT_MAPPING_REQUIRED', '확정 작업의 receiptDigest와 lineMappings가 필요합니다.', 409);
  }
  return operation;
}

function buildReceiptLines(document, operation) {
  const mappings = operation.result.lineMappings;
  const mappingByLine = new Map();
  for (const mapping of mappings) {
    const lineId = normalizeText(mapping?.lineId).toLowerCase();
    if (!UUID_RE.test(lineId) || mappingByLine.has(lineId) || !Number.isInteger(Number(mapping?.wdetailKey)) || Number(mapping.wdetailKey) <= 0) {
      throw new InvoiceReceiptCostError('RECEIPT_MAPPING_INVALID', '확정 입고의 lineId↔WdetailKey 연결이 유일하지 않습니다.', 409);
    }
    mappingByLine.set(lineId, mapping);
  }
  if (mappingByLine.size !== document.lines.length) {
    throw new InvoiceReceiptCostError('RECEIPT_MAPPING_INCOMPLETE', '문서 행과 확정 입고 상세 연결 수가 다릅니다.', 409);
  }
  const detailKeys = new Set();
  return document.lines.map(line => {
    const mapping = mappingByLine.get(String(line.lineId).toLowerCase());
    if (!mapping || Number(mapping.prodKey) !== Number(line.prodKey)) {
      throw new InvoiceReceiptCostError('RECEIPT_MAPPING_CHANGED', '문서 품목과 확정 입고 상세 연결이 다릅니다.', 409);
    }
    const detailKey = Number(mapping.wdetailKey);
    if (detailKeys.has(detailKey)) throw new InvoiceReceiptCostError('RECEIPT_MAPPING_DUPLICATE', '한 입고 상세키를 여러 문서 행에 연결할 수 없습니다.', 409);
    detailKeys.add(detailKey);
    const mapped = (key, fallback) => Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : fallback;
    return {
      ...line,
      outQuantity: mapping.outQuantity,
      outUnit: mapping.unit,
      boxQuantity: mapped('boxQuantity', line.boxQuantity),
      bunchQuantity: mapped('bunchQuantity', line.bunchQuantity),
      stemQuantity: mapped('stemQuantity', line.stemQuantity),
      unitPrice: mapped('unitPrice', line.unitPrice),
      lineAmount: mapped('lineAmount', line.lineAmount),
      wdetailKey: detailKey,
    };
  });
}

function sameNullableNumber(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  const actualNumber = finite(actual);
  const expectedNumber = finite(expected);
  return actualNumber !== null && expectedNumber !== null && close(actualNumber, expectedNumber);
}

const RECEIPT_DETAIL_FIELDS = Object.freeze([
  ['BoxQuantity', 'boxQuantity'],
  ['BunchQuantity', 'bunchQuantity'],
  ['SteamQuantity', 'stemQuantity'],
  ['OutQuantity', 'outQuantity'],
  ['EstQuantity', 'estQuantity'],
  ['UPrice', 'unitPrice'],
  ['TPrice', 'lineAmount'],
]);

const RECEIPT_HEADER_TEXT_FIELDS = Object.freeze([
  ['OrderYear', 'orderYear'],
  ['OrderWeek', 'orderWeek'],
  ['FarmName', 'farmName'],
  ['InvoiceNo', 'invoiceNo'],
  ['OrderNo', 'orderNo'],
]);
const RECEIPT_HEADER_NUMBER_FIELDS = Object.freeze([
  ['GrossWeight', 'grossWeight'],
  ['ChargeableWeight', 'chargeableWeight'],
  ['FreightRateUSD', 'freightRateUSD'],
  ['DocFeeUSD', 'docFeeUSD'],
]);

function sameNullableText(actual, expected) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  return String(actual) === String(expected);
}

function deletedFlag(value) {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  return null;
}

function normalizeReceiptHeader(header) {
  if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
  return {
    warehouseKey: Number(header.WarehouseKey ?? header.warehouseKey),
    orderYear: header.OrderYear ?? header.orderYear ?? null,
    orderWeek: header.OrderWeek ?? header.orderWeek ?? null,
    farmName: header.FarmName ?? header.farmName ?? null,
    invoiceNo: header.InvoiceNo ?? header.invoiceNo ?? null,
    orderNo: header.OrderNo ?? header.orderNo ?? null,
    inputDateISO: header.InputDateISO ?? header.InputDate ?? header.inputDateISO ?? null,
    grossWeight: finite(header.GrossWeight ?? header.grossWeight),
    chargeableWeight: finite(header.ChargeableWeight ?? header.chargeableWeight),
    freightRateUSD: finite(header.FreightRateUSD ?? header.freightRateUSD),
    docFeeUSD: finite(header.DocFeeUSD ?? header.docFeeUSD),
    isDeleted: deletedFlag(header.isDeleted),
  };
}

function normalizeReceiptDetail(detail, lineId = null) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  return {
    ...(lineId ? { lineId } : {}),
    wdetailKey: Number(detail.WdetailKey ?? detail.wdetailKey),
    prodKey: Number(detail.ProdKey ?? detail.prodKey),
    boxQuantity: finite(detail.BoxQuantity ?? detail.boxQuantity),
    bunchQuantity: finite(detail.BunchQuantity ?? detail.bunchQuantity),
    stemQuantity: finite(detail.SteamQuantity ?? detail.stemQuantity),
    outQuantity: finite(detail.OutQuantity ?? detail.outQuantity),
    estQuantity: finite(detail.EstQuantity ?? detail.estQuantity),
    unitPrice: finite(detail.UPrice ?? detail.unitPrice),
    lineAmount: finite(detail.TPrice ?? detail.lineAmount),
  };
}

function committedReceiptSnapshot(operation, receiptLines) {
  const source = operation.result?.receiptSnapshot;
  const header = normalizeReceiptHeader(source?.header);
  if (!header || !Array.isArray(source?.details)) {
    throw new InvoiceReceiptCostError('RECEIPT_SNAPSHOT_REQUIRED',
      '확정 입고의 헤더·상세 스냅샷이 없어 원가 승인을 검증할 수 없습니다.', 409);
  }
  if (header.warehouseKey !== Number(operation.warehouseKey) || header.isDeleted !== false) {
    throw new InvoiceReceiptCostError('RECEIPT_SNAPSHOT_INVALID', '확정 입고 헤더 스냅샷의 범위 또는 삭제 상태가 올바르지 않습니다.', 409);
  }
  const sourceByKey = new Map();
  for (const detail of source.details) {
    const normalized = normalizeReceiptDetail(detail);
    if (!Number.isInteger(normalized?.wdetailKey) || normalized.wdetailKey <= 0 || sourceByKey.has(normalized.wdetailKey)) {
      throw new InvoiceReceiptCostError('RECEIPT_SNAPSHOT_INVALID', '확정 입고 상세 스냅샷의 연결키가 유일하지 않습니다.', 409);
    }
    sourceByKey.set(normalized.wdetailKey, normalized);
  }
  const details = receiptLines.map(line => {
    const detail = sourceByKey.get(Number(line.wdetailKey));
    if (!detail || detail.prodKey !== Number(line.prodKey)
      || RECEIPT_DETAIL_FIELDS.filter(([, key]) => key !== 'estQuantity')
        .some(([, key]) => !sameNullableNumber(detail[key], line[key]))) {
      throw new InvoiceReceiptCostError('RECEIPT_SNAPSHOT_INVALID',
        '확정 입고 매핑의 실제 수량·가격과 입고 상세 스냅샷이 다릅니다.', 409);
    }
    return { ...detail, lineId: line.lineId };
  });
  if (details.length !== source.details.length) {
    throw new InvoiceReceiptCostError('RECEIPT_SNAPSHOT_INVALID', '확정 입고 상세 스냅샷의 행 수가 매핑과 다릅니다.', 409);
  }
  return { warehouseKey: Number(operation.warehouseKey), receiptDigest: operation.result.receiptDigest, header, details };
}

async function validateLiveReceiptDetails({ queryFn, types, operation, receiptLines, locked = false }) {
  const committedSnapshot = committedReceiptSnapshot(operation, receiptLines);
  const params = {
    warehouseKey: param(sqlType(types, 'Int'), Number(operation.warehouseKey)),
  };
  const headerResult = await queryFn(`/* invoice-cost:validate-live-receipt-header */ SELECT
      WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
      CONVERT(varchar(10),InputDate,23) AS InputDateISO,
      GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted
    FROM dbo.WarehouseMaster ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE WarehouseKey=@warehouseKey`, params);
  const result = await queryFn(`/* invoice-cost:validate-live-receipt-details */ SELECT
      WdetailKey,WarehouseKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,UPrice,TPrice
      ,EstQuantity
    FROM dbo.WarehouseDetail ${locked ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE WarehouseKey=@warehouseKey ORDER BY WdetailKey`, params);
  const liveHeader = normalizeReceiptHeader(headerResult.recordset?.[0]);
  const rows = Array.isArray(result.recordset) ? result.recordset : [];
  const byKey = new Map(rows.map(row => [Number(row.WdetailKey), row]));
  const issues = [];
  const expectedHeader = committedSnapshot.header;
  const headerChanged = !liveHeader || headerResult.recordset?.length !== 1
    || liveHeader.warehouseKey !== committedSnapshot.warehouseKey
    || liveHeader.isDeleted !== false
    || !sameNullableText(liveHeader.inputDateISO, expectedHeader.inputDateISO)
    || RECEIPT_HEADER_TEXT_FIELDS.some(([, key]) => !sameNullableText(liveHeader[key], expectedHeader[key]))
    || RECEIPT_HEADER_NUMBER_FIELDS.some(([, key]) => !sameNullableNumber(liveHeader[key], expectedHeader[key]));
  if (headerChanged) issues.push({ code: 'ERP_RECEIPT_HEADER_CHANGED',
    message: '승인 대상 입고 헤더의 범위·일자·중량·운임 또는 삭제 상태가 전산에서 변경되었습니다.' });
  for (const expected of committedSnapshot.details) {
    const actual = byKey.get(Number(expected.wdetailKey));
    if (!actual || Number(actual.WarehouseKey) !== Number(operation.warehouseKey)
      || Number(actual.ProdKey) !== Number(expected.prodKey)) {
      issues.push({ code: 'ERP_RECEIPT_CHANGED', lineId: expected.lineId,
        message: '승인 대상 입고 상세의 품목 또는 연결키가 전산에서 변경되었습니다.' });
      continue;
    }
    const changedFields = RECEIPT_DETAIL_FIELDS
      .filter(([actualKey, expectedKey]) => !sameNullableNumber(actual[actualKey], expected[expectedKey]))
      .map(([, expectedKey]) => expectedKey);
    if (changedFields.length) {
      issues.push({ code: 'ERP_RECEIPT_CHANGED', lineId: expected.lineId, fields: changedFields,
        message: '승인 대상 입고 상세의 수량 또는 가격이 전산에서 변경되었습니다.' });
      continue;
    }
  }
  if (rows.length !== committedSnapshot.details.length) {
    issues.push({ code: 'ERP_RECEIPT_CHANGED', message: '승인 대상 입고 상세 행 수가 전산에서 변경되었습니다.' });
  }
  return {
    matches: issues.length === 0,
    issues,
    snapshot: committedSnapshot,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(stableValue(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error('crypto.randomUUID is required');
  return globalThis.crypto.randomUUID();
}

function safeJson(value, name) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new InvoiceReceiptCostError('COST_SNAPSHOT_TOO_LARGE', `${name} is too large`, 400);
  }
  return json;
}

function revisionInputSnapshot({ document, operation, input, preview, saveFingerprint, basis, receiptSnapshot }) {
  const applicabilityScope = {
    country: countryCode(document),
    transportMode: normalizeText(document?.reviewedMetadata?.transportMode).toUpperCase() || null,
    prodKeys: [...new Set(preview.lines.map(line => Number(line.prodKey)))].sort((left, right) => left - right),
  };
  return {
    schemaVersion: 1,
    basis,
    saveFingerprint,
    costSourceId: preview.costSourceId,
    receiptDigest: operation.result.receiptDigest,
    receiptSnapshot,
    invoiceSourceHash: document.sourceHash,
    formula: {
      id: preview.formulaId,
      version: preview.formulaVersion,
      sourceHash: preview.formulaSourceHash,
      sheet: normalizeText(input.formulaSourceSheet),
      cells: normalizeText(input.formulaSourceCells),
      applicabilityConfirmed: input.formulaApplicabilityConfirmed === true,
      effectiveDate: normalizeText(input.formulaEffectiveDate),
      applicabilityScope,
    },
    currency: normalizeCurrency(input.nativeCurrency),
    exchangeRate: {
      krw: finite(input.exchangeRateKRW),
      type: normalizeText(input.exchangeRateType),
      date: normalizeText(input.exchangeRateDate),
    },
    allocation: {
      scope: 'SINGLE_INVOICE',
      numerator: finite(input.allocationShareNumerator),
      denominator: finite(input.allocationShareDenominator),
      share: preview.allocationShare,
    },
    input: stableValue(input),
    totals: basis === 'ACTUAL' ? preview.totals : totalsOf(preview.expected95?.lines || []),
    comparisonOnly: basis === 'EXPECTED_95',
  };
}

async function insertCostRevision({ queryFn, types, document, operation, actor, now, preview, input, basis, lines, saveFingerprint, receiptSnapshot }) {
  const costRevisionId = randomUuid();
  const revisionResult = await queryFn(`/* invoice-cost:next-revision */
    SELECT ISNULL(MAX(RevisionNo),0)+1 AS RevisionNo
    FROM dbo.WebInvoiceCostRevision WITH (UPDLOCK,HOLDLOCK)
    WHERE DocumentId=@documentId AND OperationId=@operationId AND Basis=@basis`, {
    documentId: param(sqlType(types, 'UniqueIdentifier'), document.documentId),
    operationId: param(sqlType(types, 'UniqueIdentifier'), operation.operationId),
    basis: param(sqlType(types, 'NVarChar', 20), basis),
  });
  const revisionNo = Number(revisionResult.recordset?.[0]?.RevisionNo);
  if (!Number.isInteger(revisionNo) || revisionNo < 1) throw new InvoiceReceiptCostError('COST_REVISION_UNAVAILABLE', '원가 변경 번호를 만들지 못했습니다.', 503);
  const snapshot = revisionInputSnapshot({ document, operation, input, preview, saveFingerprint, basis, receiptSnapshot });
  const snapshotJson = safeJson(snapshot, 'input snapshot');
  const common = {
    costRevisionId: param(sqlType(types, 'UniqueIdentifier'), costRevisionId),
    documentId: param(sqlType(types, 'UniqueIdentifier'), document.documentId),
    documentRevision: param(sqlType(types, 'Int'), document.revision),
    operationId: param(sqlType(types, 'UniqueIdentifier'), operation.operationId),
    warehouseKey: param(sqlType(types, 'Int'), Number(operation.warehouseKey)),
    revisionNo: param(sqlType(types, 'Int'), revisionNo),
    basis: param(sqlType(types, 'NVarChar', 20), basis),
    currency: param(sqlType(types, 'Char', 3), 'KRW'),
    formulaId: param(sqlType(types, 'NVarChar', 100), preview.formulaId),
    formulaVersion: param(sqlType(types, 'NVarChar', 50), preview.formulaVersion),
    formulaSourceHash: param(sqlType(types, 'Binary', 32), Buffer.from(preview.formulaSourceHash, 'hex')),
    snapshot: param(sqlType(types, 'NVarChar', types.MAX), snapshotJson),
    actor: param(sqlType(types, 'NVarChar', 200), actor),
    now: param(sqlType(types, 'DateTime2', 3), now),
  };
  await queryFn(`/* invoice-cost:insert-revision */ INSERT INTO dbo.WebInvoiceCostRevision
    (CostRevisionId,DocumentId,DocumentRevision,OperationId,WarehouseKey,RevisionNo,Basis,Status,Currency,
     FormulaId,FormulaVersion,FormulaSourceHash,InputSnapshotJson,ApprovedBy,ApprovedAt,CreatedBy,CreatedAt)
    VALUES(@costRevisionId,@documentId,@documentRevision,@operationId,@warehouseKey,@revisionNo,@basis,N'APPROVED',@currency,
      @formulaId,@formulaVersion,@formulaSourceHash,@snapshot,@actor,@now,@actor,@now)`, common);
  const mappingByLine = new Map(operation.result.lineMappings.map(mapping => [String(mapping.lineId).toLowerCase(), mapping]));
  for (const line of lines) {
    const mapping = mappingByLine.get(line.lineId);
    await queryFn(`/* invoice-cost:insert-line */ INSERT INTO dbo.WebInvoiceCostLine
      (CostRevisionId,LineId,DocumentId,DocumentRevision,OperationId,WarehouseKey,WdetailKey,ProdKey,Unit,Quantity,CostPerUnit,TotalCost,ComponentAmountsJson)
      VALUES(@costRevisionId,@lineId,@documentId,@documentRevision,@operationId,@warehouseKey,@wdetailKey,@prodKey,@unit,@quantity,@costPerUnit,@totalCost,@components)`, {
      ...common,
      lineId: param(sqlType(types, 'UniqueIdentifier'), line.lineId),
      wdetailKey: param(sqlType(types, 'Int'), Number(mapping.wdetailKey)),
      prodKey: param(sqlType(types, 'Int'), Number(line.prodKey)),
      unit: param(sqlType(types, 'NVarChar', 40), line.unit),
      quantity: param(sqlType(types, 'Decimal', 18, 6), line.quantity),
      costPerUnit: param(sqlType(types, 'Decimal', 18, 6), line.costPerUnitKRW),
      totalCost: param(sqlType(types, 'Decimal', 18, 6), line.totalCostKRW),
      components: param(sqlType(types, 'NVarChar', types.MAX), JSON.stringify(line.componentAmounts)),
    });
  }
  const verify = await queryFn(`/* invoice-cost:verify-save */ SELECT COUNT_BIG(1) AS LineCount,
      SUM(TotalCost) AS TotalCost FROM dbo.WebInvoiceCostLine WHERE CostRevisionId=@costRevisionId`, common);
  if (Number(verify.recordset?.[0]?.LineCount) !== lines.length
    || !close(Number(verify.recordset?.[0]?.TotalCost), totalsOf(lines).totalCostKRW, 0.00001)) {
    throw new InvoiceReceiptCostError('COST_READBACK_FAILED', '저장한 원가 행과 합계가 readback 결과와 다릅니다.', 503);
  }
  return { costRevisionId, revisionNo, basis, lines };
}

export async function saveInvoiceCostRevision({ withTransactionFn, types, documentId, revision, actor, input, reason }) {
  if (typeof withTransactionFn !== 'function') throw new TypeError('withTransactionFn is required');
  const id = assertUuid(documentId, 'documentId');
  const expectedRevision = Number(revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new InvoiceReceiptCostError('EXPECTED_REVISION_REQUIRED', '현재 문서 버전이 필요합니다.', 400);
  const approvedBy = assertActor(actor);
  const approvalReason = assertReason(reason);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvoiceReceiptCostError('COST_INPUT_REQUIRED', '원가 입력이 필요합니다.', 400);
  return withTransactionFn(async queryFn => {
    await queryFn(`/* invoice-cost:transaction-lock */ DECLARE @lockResult int;
      EXEC @lockResult=sys.sp_getapplock @Resource=N'NenovaWeb:InvoiceCostRevision',@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
      IF @lockResult<0 THROW 51070,N'INVOICE_COST_LOCK_BUSY',1;`, {});
    const lock = await queryFn(`/* invoice-cost:lock-document */ SELECT DocumentId,Revision
      FROM dbo.WebInvoiceDocument WITH (UPDLOCK,HOLDLOCK) WHERE DocumentId=@documentId`, {
      documentId: param(sqlType(types, 'UniqueIdentifier'), id),
    });
    if (!lock.recordset?.length) throw new InvoiceReceiptCostError('DOCUMENT_NOT_FOUND', '저장된 인보이스를 찾을 수 없습니다.', 404);
    if (Number(lock.recordset[0].Revision) !== expectedRevision) throw new InvoiceReceiptCostError('STALE_REVISION', '문서 버전이 변경되었습니다.', 409);
    const { getInvoiceDocument } = await import('./invoiceReceiptDocuments.js');
    const document = await getInvoiceDocument({ queryFn, types, documentId: id });
    const operation = latestCommittedOperation(document, expectedRevision);
    const receiptLines = buildReceiptLines(document, operation);
    const liveReceipt = await validateLiveReceiptDetails({ queryFn, types, operation, receiptLines, locked: true });
    if (!liveReceipt.matches) {
      throw new InvoiceReceiptCostError('ERP_RECEIPT_CHANGED', liveReceipt.issues[0]?.message
        || '승인 대상 입고 상세가 전산에서 변경되었습니다.', 409, liveReceipt.issues);
    }
    const preview = previewInvoiceCost({ ...document, costInput: input }, receiptLines);
    if (preview.status !== 'APPROVED') {
      throw new InvoiceReceiptCostError('COST_REVIEW_REQUIRED', preview.issues[0]?.message || '원가 입력 검토가 필요합니다.', 422, preview.issues);
    }
    const sourceConflict = await queryFn(`/* invoice-cost:check-source-identity */ SELECT TOP (1) DocumentId,CostRevisionId
      FROM dbo.WebInvoiceCostRevision WITH (UPDLOCK,HOLDLOCK)
      WHERE Status IN (N'APPROVED',N'STALE') AND DocumentId<>@documentId
        AND JSON_VALUE(InputSnapshotJson,N'$.costSourceId') COLLATE Latin1_General_100_BIN2
          = @costSourceId COLLATE Latin1_General_100_BIN2`, {
      documentId: param(sqlType(types, 'UniqueIdentifier'), id),
      costSourceId: param(sqlType(types, 'NVarChar', 200), preview.costSourceId),
    });
    if (sourceConflict.recordset?.length) {
      throw new InvoiceReceiptCostError('COST_SOURCE_ALREADY_APPROVED', '같은 비용 원천 ID가 다른 승인 문서에 이미 사용되었습니다.', 409);
    }
    const saveFingerprint = await sha256Hex({
      documentId: id,
      revision: expectedRevision,
      operationId: operation.operationId,
      receiptDigest: operation.result.receiptDigest,
      receiptSnapshot: liveReceipt.snapshot,
      input: stableValue(input),
      result: { actual: preview.lines, expected95: preview.expected95?.lines || null },
    });
    const existing = await queryFn(`/* invoice-cost:idempotent-read */ SELECT TOP (1) CostRevisionId,RevisionNo,WarehouseKey
      FROM dbo.WebInvoiceCostRevision WITH (UPDLOCK,HOLDLOCK)
      WHERE DocumentId=@documentId AND DocumentRevision=@documentRevision AND Basis=N'ACTUAL' AND Status=N'APPROVED'
        AND JSON_VALUE(InputSnapshotJson,N'$.saveFingerprint')=@saveFingerprint
      ORDER BY RevisionNo DESC`, {
      documentId: param(sqlType(types, 'UniqueIdentifier'), id),
      documentRevision: param(sqlType(types, 'Int'), expectedRevision),
      saveFingerprint: param(sqlType(types, 'VarChar', 64), saveFingerprint),
    });
    if (existing.recordset?.length) {
      const costs = await readInvoiceCosts({ queryFn, types, warehouseKey: Number(existing.recordset[0].WarehouseKey) });
      return { ...costs, idempotent: true, savedCostRevisionId: String(existing.recordset[0].CostRevisionId).toLowerCase() };
    }
    await queryFn(`/* invoice-cost:stale-prior */ UPDATE dbo.WebInvoiceCostRevision
      SET Status=N'STALE' WHERE DocumentId=@documentId AND Status=N'APPROVED'`, {
      documentId: param(sqlType(types, 'UniqueIdentifier'), id),
    });
    const now = new Date();
    const saved = [];
    saved.push(await insertCostRevision({ queryFn, types, document, operation, actor: approvedBy, now,
      preview, input, basis: 'ACTUAL', lines: preview.lines, saveFingerprint, receiptSnapshot: liveReceipt.snapshot }));
    if (preview.expected95?.lines?.length) {
      saved.push(await insertCostRevision({ queryFn, types, document, operation, actor: approvedBy, now,
        preview, input, basis: 'EXPECTED_95', lines: preview.expected95.lines,
        saveFingerprint: await sha256Hex(`${saveFingerprint}:EXPECTED_95`), receiptSnapshot: liveReceipt.snapshot }));
    }
    await queryFn(`/* invoice-cost:approve-document */ UPDATE dbo.WebInvoiceDocument
      SET CostStatus=N'APPROVED',UpdatedBy=@actor,UpdatedAt=@now
      WHERE DocumentId=@documentId AND Revision=@documentRevision;
      IF @@ROWCOUNT<>1 THROW 51071,N'INVOICE_COST_DOCUMENT_CHANGED',1;
      INSERT INTO dbo.WebInvoiceHistory(DocumentId,Revision,OperationId,Action,AfterJson,Reason,Actor,CreatedAt)
      VALUES(@documentId,@documentRevision,@operationId,N'APPROVE_INVOICE_COST',@afterJson,@reason,@actor,@now)`, {
      documentId: param(sqlType(types, 'UniqueIdentifier'), id),
      documentRevision: param(sqlType(types, 'Int'), expectedRevision),
      operationId: param(sqlType(types, 'UniqueIdentifier'), operation.operationId),
      actor: param(sqlType(types, 'NVarChar', 200), approvedBy),
      now: param(sqlType(types, 'DateTime2', 3), now),
      afterJson: param(sqlType(types, 'NVarChar', types.MAX), JSON.stringify({
        warehouseKey: operation.warehouseKey,
        formulaId: preview.formulaId,
        formulaVersion: preview.formulaVersion,
        basis: saved.map(item => item.basis),
        costRevisionIds: saved.map(item => item.costRevisionId),
        actualTotalCostKRW: preview.totals.totalCostKRW,
        expected95ComparisonOnly: Boolean(preview.expected95),
      })),
      reason: param(sqlType(types, 'NVarChar', 1000), approvalReason),
    });
    const costs = await readInvoiceCosts({ queryFn, types, warehouseKey: Number(operation.warehouseKey) });
    return { ...costs, idempotent: false, savedCostRevisionIds: saved.map(item => item.costRevisionId) };
  }, { retries: 0 });
}

function parseComponents(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function parseSnapshot(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function receiptHeaderMatches(actual, expected, warehouseKey) {
  return Boolean(actual && expected
    && actual.warehouseKey === warehouseKey && expected.warehouseKey === warehouseKey
    && actual.isDeleted === false && expected.isDeleted === false
    && sameNullableText(actual.inputDateISO, expected.inputDateISO)
    && RECEIPT_HEADER_TEXT_FIELDS.every(([, key]) => sameNullableText(actual[key], expected[key]))
    && RECEIPT_HEADER_NUMBER_FIELDS.every(([, key]) => sameNullableNumber(actual[key], expected[key])));
}

function revisionLiveStatus(revision, snapshot, liveHeader, liveRows) {
  const receiptSnapshot = snapshot?.receiptSnapshot;
  const expectedHeader = normalizeReceiptHeader(receiptSnapshot?.header);
  const expectedDetails = Array.isArray(receiptSnapshot?.details) ? receiptSnapshot.details : null;
  if (!expectedHeader || !expectedDetails || Number(receiptSnapshot.warehouseKey) !== revision.warehouseKey
    || expectedDetails.length !== liveRows.length || expectedDetails.length !== revision.lines.length) {
    return 'UNVERIFIABLE';
  }
  if (!receiptHeaderMatches(liveHeader, expectedHeader, revision.warehouseKey)) return 'STALE';
  const liveByKey = new Map(liveRows.map(row => [Number(row.WdetailKey), row]));
  for (const expected of expectedDetails) {
    const live = liveByKey.get(Number(expected.wdetailKey));
    const savedLine = revision.lines.find(line => line.lineId === String(expected.lineId).toLowerCase());
    if (!live || !savedLine || savedLine.wdetailKey !== Number(expected.wdetailKey)
      || savedLine.prodKey !== Number(expected.prodKey) || Number(live.ProdKey) !== Number(expected.prodKey)) {
      return 'STALE';
    }
    if (RECEIPT_DETAIL_FIELDS.some(([actualKey, expectedKey]) => !sameNullableNumber(live[actualKey], expected[expectedKey]))) {
      return 'STALE';
    }
  }
  return 'MATCH';
}

export async function readInvoiceCosts({ queryFn, types, warehouseKey }) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn is required');
  const key = Number(warehouseKey);
  if (!Number.isInteger(key) || key <= 0) throw new InvoiceReceiptCostError('WAREHOUSE_KEY_REQUIRED', '양수 WarehouseKey가 필요합니다.', 400);
  const queryParams = { warehouseKey: param(sqlType(types, 'Int'), key) };
  const scopeResult = await queryFn(`/* invoice-cost:read-warehouse-scope */ SELECT TOP (1)
      d.DocumentId,d.Revision AS CurrentDocumentRevision,d.CostStatus,o.OperationId,o.DocumentRevision,
      d.OrderYear,d.OrderWeek,d.InvoiceNo
    FROM dbo.WebInvoiceOperation o
    JOIN dbo.WebInvoiceDocument d ON d.DocumentId=o.DocumentId
    WHERE o.WarehouseKey=@warehouseKey AND o.Status=N'COMMITTED'
    ORDER BY o.CompletedAt DESC,o.CreatedAt DESC,o.OperationId DESC`, queryParams);
  const scope = scopeResult.recordset?.[0] || null;
  const result = await queryFn(`/* invoice-cost:read-warehouse-revisions */ SELECT
      r.CostRevisionId,r.DocumentId,r.DocumentRevision,r.OperationId,r.WarehouseKey,r.RevisionNo,r.Basis,r.Status,r.Currency,
      r.FormulaId,r.FormulaVersion,r.FormulaSourceHash,r.InputSnapshotJson,r.ApprovedBy,r.ApprovedAt,r.CreatedAt,
      d.OrderYear,d.OrderWeek,d.InvoiceNo,
      l.LineId,l.WdetailKey,l.ProdKey,l.Unit,l.Quantity,l.CostPerUnit,l.TotalCost,l.ComponentAmountsJson
    FROM dbo.WebInvoiceCostRevision r
    JOIN dbo.WebInvoiceDocument d ON d.DocumentId=r.DocumentId
    LEFT JOIN dbo.WebInvoiceCostLine l ON l.CostRevisionId=r.CostRevisionId
    WHERE r.WarehouseKey=@warehouseKey
    ORDER BY CASE r.Status WHEN N'APPROVED' THEN 0 WHEN N'DRAFT' THEN 1 ELSE 2 END,
      CASE r.Basis WHEN N'ACTUAL' THEN 0 ELSE 1 END,r.RevisionNo DESC,l.WdetailKey,l.LineId`, queryParams);
  const liveHeaderResult = await queryFn(`/* invoice-cost:read-live-receipt-header */ SELECT
      WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,OrderNo,
      CONVERT(varchar(10),InputDate,23) AS InputDateISO,
      GrossWeight,ChargeableWeight,FreightRateUSD,DocFeeUSD,isDeleted
    FROM dbo.WarehouseMaster WHERE WarehouseKey=@warehouseKey`, queryParams);
  const liveHeader = liveHeaderResult.recordset?.length === 1
    ? normalizeReceiptHeader(liveHeaderResult.recordset[0]) : null;
  const liveResult = await queryFn(`/* invoice-cost:read-live-receipt-details */ SELECT
      WdetailKey,WarehouseKey,ProdKey,BoxQuantity,BunchQuantity,SteamQuantity,OutQuantity,EstQuantity,UPrice,TPrice
    FROM dbo.WarehouseDetail WHERE WarehouseKey=@warehouseKey ORDER BY WdetailKey`, queryParams);
  const liveRows = Array.isArray(liveResult.recordset) ? liveResult.recordset : [];
  const revisions = [];
  const byId = new Map();
  for (const row of result.recordset || []) {
    const id = String(row.CostRevisionId).toLowerCase();
    let revision = byId.get(id);
    if (!revision) {
      revision = {
        costRevisionId: id,
        documentId: String(row.DocumentId).toLowerCase(),
        documentRevision: Number(row.DocumentRevision),
        operationId: String(row.OperationId).toLowerCase(),
        warehouseKey: Number(row.WarehouseKey),
        revisionNo: Number(row.RevisionNo),
        basis: row.Basis,
        status: row.Status,
        currency: row.Currency,
        formulaId: row.FormulaId,
        formulaVersion: row.FormulaVersion,
        formulaSourceHash: Buffer.from(row.FormulaSourceHash).toString('hex'),
        approvedBy: row.ApprovedBy,
        approvedAt: row.ApprovedAt,
        createdAt: row.CreatedAt,
        orderYear: row.OrderYear,
        orderWeek: row.OrderWeek,
        invoiceNo: row.InvoiceNo ?? null,
        comparisonOnly: row.Basis === 'EXPECTED_95',
        lines: [],
        _snapshot: parseSnapshot(row.InputSnapshotJson),
      };
      byId.set(id, revision);
      revisions.push(revision);
    }
    if (row.LineId) revision.lines.push({
      lineId: String(row.LineId).toLowerCase(),
      wdetailKey: Number(row.WdetailKey),
      prodKey: Number(row.ProdKey),
      unit: row.Unit,
      quantity: finite(row.Quantity),
      costPerUnitKRW: finite(row.CostPerUnit),
      totalCostKRW: finite(row.TotalCost),
      componentAmounts: parseComponents(row.ComponentAmountsJson),
    });
  }
  const documentCostStatus = scope?.CostStatus ?? null;
  const currentDocumentId = scope?.DocumentId ? String(scope.DocumentId).toLowerCase() : null;
  const currentOperationId = scope?.OperationId ? String(scope.OperationId).toLowerCase() : null;
  const currentDocumentRevision = scope ? Number(scope.CurrentDocumentRevision) : null;
  for (const revision of revisions) {
    const storedStatus = revision.status;
    revision.liveReceiptStatus = revisionLiveStatus(revision, revision._snapshot, liveHeader, liveRows);
    revision.storedStatus = storedStatus;
    const currentScopeMatches = documentCostStatus === 'APPROVED'
      && revision.documentId === currentDocumentId
      && revision.documentRevision === currentDocumentRevision
      && revision.operationId === currentOperationId;
    if (storedStatus === 'APPROVED' && (revision.liveReceiptStatus !== 'MATCH' || !currentScopeMatches)) revision.status = 'STALE';
    const totals = revision.lines.map(line => line.totalCostKRW);
    revision.totalCostKRW = totals.length > 0 && totals.every(value => value !== null)
      ? round6(totals.reduce((sum, value) => sum + value, 0))
      : null;
    delete revision._snapshot;
  }
  const approvedBecameStale = revisions.some(revision => revision.storedStatus === 'APPROVED' && revision.status === 'STALE');
  const status = documentCostStatus === 'APPROVED' && approvedBecameStale ? 'STALE' : documentCostStatus;
  return {
    warehouseKey: key,
    status,
    documentCostStatus,
    documentId: scope?.DocumentId ? String(scope.DocumentId).toLowerCase() : null,
    documentRevision: scope ? Number(scope.CurrentDocumentRevision) : null,
    operationId: scope?.OperationId ? String(scope.OperationId).toLowerCase() : null,
    currentActual: revisions.find(revision => revision.basis === 'ACTUAL' && revision.status === 'APPROVED') || null,
    comparisons: revisions.filter(revision => revision.basis === 'EXPECTED_95' && revision.status === 'APPROVED'),
    revisions,
  };
}
