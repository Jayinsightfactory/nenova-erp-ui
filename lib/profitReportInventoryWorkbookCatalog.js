import catalog from '../data/profit-report-inventory-catalog/v1/index.json' with { type: 'json' };

const WEEK_KEY_RE = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/;

export function normalizeInventoryUnit(value) {
  const unit = String(value || '').trim().toUpperCase();
  if (['BOX', 'BX', '박스'].includes(unit)) return '박스';
  if (['BUNCH', 'BUN', '단'].includes(unit)) return '단';
  if (['STEM', 'EA', '스팀', '대', '송이'].includes(unit)) return '송이';
  return unit;
}

function toComparableWeek(orderYear, orderWeek) {
  const text = `${String(orderYear || '').trim()}-${String(orderWeek || '').trim()}`;
  const match = text.match(WEEK_KEY_RE);
  if (!match) return null;
  return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3] || 0);
}

function normalizedRateEvidence(input) {
  const rate = Number(input?.rate);
  if (!(Number.isFinite(rate) && rate > 0)) return null;
  return {
    rate,
    source: String(input?.source || input?.sourceRef || '').trim(),
  };
}

function entryPrice(entry, rateEvidence = null, useSourceWeekRate = false) {
  if (entry.basis === 'KRW_VAT_INCLUDED') {
    const gross = Number(entry.grossUnitPrice);
    return Number.isFinite(gross) && gross >= 0 ? gross / 1.1 : null;
  }
  if (entry.basis === 'FOREIGN_TAXABLE') {
    const foreign = Number(entry.foreignUnitPrice);
    const resolvedRate = normalizedRateEvidence(rateEvidence)?.rate
      ?? (useSourceWeekRate ? Number(entry.sourceTaxableRate) : null);
    return Number.isFinite(foreign) && foreign >= 0 && Number.isFinite(resolvedRate) && resolvedRate > 0
      ? foreign * resolvedRate
      : null;
  }
  return null;
}

function sourceRef(entry, rateEvidence = null, useSourceWeekRate = false) {
  const source = catalog.source;
  const rateSuffix = entry.sourceRateCell ? `+${source.sheet}!${entry.sourceRateCell}` : '';
  const targetRate = normalizedRateEvidence(rateEvidence);
  const targetRateSuffix = targetRate
    ? `+target-taxable-rate:${targetRate.rate}:${targetRate.source || 'exact-major-source'}`
    : useSourceWeekRate ? rateSuffix : '';
  return `inventory-workbook:${source.orderYear}-${source.majorWeek}:${source.workbookSha256}:${source.sheet}!${entry.sourceCell}${targetRateSuffix}`;
}

/**
 * 원본 Excel 재고잔량 시트의 품목별 평가단가 catalog.
 *
 * - 정확히 승인된 ProdKey만 반환한다. 품명 fuzzy 검색은 금지한다.
 * - 이 catalog의 exact ProdKey 항목은 22~28차 7개 workbook에서 단가 안정성이 검증된 품목만 담는다.
 *   28차 이전으로 역전파하지 않고, 2026년 28차 이후에만 안정 단가 template로 재사용한다.
 * - 원화 표시단가는 원본의 VAT 포함값이므로 /1.1한 공급가 단가로 변환한다.
 * - 호주는 원본 P 외화단가만 안정 template로 재사용하고, 대상 차수의 정확한 AUD 과세환율을 곱한다.
 *   정확한 대상 환율이 없으면 미래 차수의 호주 단가를 만들지 않는다.
 * - entry.eligibleForInventoryValuation === false인 항목(N열 기반 판매·분배 단가 후보 — 태국 Jinda 계열,
 *   중국, 네덜란드 등)은 절대 후보로 반환하지 않는다. 출처 셀과 산식으로 취득원가임이 입증된 항목만
 *   (호주 FOREIGN_TAXABLE, 미국 SALAL P59 계열) eligibleForInventoryValuation=true로 반환 대상이 된다.
 * - 이 함수는 읽기 전용이며 DB에 증거를 복사하거나 승격하지 않는다.
 */
export function inventoryWorkbookPriceEvidenceByProduct(orderYear, orderWeek, options = {}) {
  const targetWeek = toComparableWeek(orderYear, orderWeek);
  const catalogWeek = toComparableWeek(catalog.source.orderYear, catalog.source.majorWeek);
  const targetMajor = String(orderWeek || '').trim().match(/^(\d{1,2})(?:-\d{1,2})?$/)?.[1];
  if (targetWeek == null || catalogWeek == null
    || String(orderYear) !== String(catalog.source.orderYear)
    || Number(targetMajor) < Number(catalog.source.majorWeek)) return {};

  const isSourceMajor = Number(targetMajor) === Number(catalog.source.majorWeek);
  const rateEvidenceByCurrency = options.rateEvidenceByCurrency || {};

  const result = {};
  for (const entry of catalog.entries || []) {
    if (entry.eligibleForInventoryValuation === false) continue;
    const rateEvidence = rateEvidenceByCurrency[String(entry.currency || '').toUpperCase()] || null;
    const price = entryPrice(entry, rateEvidence, isSourceMajor);
    if (!Number.isFinite(price) || price < 0) continue;
    result[String(entry.prodKey)] = {
      price,
      source: 'VERIFIED_WORKBOOK_CATALOG',
      sourceRefs: [sourceRef(entry, rateEvidence, isSourceMajor)],
      unit: normalizeInventoryUnit(entry.unit),
      basis: entry.basis,
      currency: entry.currency || 'KRW',
      sourceLabel: entry.sourceLabel,
      effectiveFrom: `${catalog.source.orderYear}-${String(catalog.source.majorWeek).padStart(2, '0')}`,
      effectiveScope: `${catalog.source.orderYear}-${String(catalog.source.majorWeek).padStart(2, '0')} and later in ${catalog.source.orderYear}`,
      targetTaxableRate: entry.basis === 'FOREIGN_TAXABLE'
        ? (normalizedRateEvidence(rateEvidence)?.rate ?? (isSourceMajor ? Number(entry.sourceTaxableRate) : null))
        : null,
    };
  }
  return result;
}

export function inventoryWorkbookCatalogMetadata() {
  const entries = catalog.entries || [];
  return {
    version: catalog.version,
    source: catalog.source,
    validation: catalog.validation,
    entryCount: entries.length,
    eligibleEntryCount: entries.filter((entry) => entry.eligibleForInventoryValuation !== false).length,
    ineligibleEntryCount: entries.filter((entry) => entry.eligibleForInventoryValuation === false).length,
    quarantined: catalog.quarantined || [],
  };
}
