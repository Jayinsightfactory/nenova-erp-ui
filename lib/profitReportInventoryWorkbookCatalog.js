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

function entryPrice(entry) {
  if (entry.basis === 'KRW_VAT_INCLUDED') {
    const gross = Number(entry.grossUnitPrice);
    return Number.isFinite(gross) && gross >= 0 ? gross / 1.1 : null;
  }
  if (entry.basis === 'FOREIGN_TAXABLE') {
    const foreign = Number(entry.foreignUnitPrice);
    const sourceRate = Number(entry.sourceTaxableRate);
    return Number.isFinite(foreign) && foreign >= 0 && Number.isFinite(sourceRate) && sourceRate > 0
      ? foreign * sourceRate
      : null;
  }
  return null;
}

function sourceRef(entry) {
  const source = catalog.source;
  const rateSuffix = entry.sourceRateCell ? `+${source.sheet}!${entry.sourceRateCell}` : '';
  return `inventory-workbook:${source.orderYear}-${source.majorWeek}:${source.workbookSha256}:${source.sheet}!${entry.sourceCell}${rateSuffix}`;
}

/**
 * 원본 Excel 재고잔량 시트의 품목별 평가단가 catalog.
 *
 * - 정확히 승인된 ProdKey만 반환한다. 품명 fuzzy 검색은 금지한다.
 * - 28차 이후에만 적용한다. 22~27차는 각 workbook F 셀의 역사 parity 경로를 유지한다.
 * - 원화 표시단가는 원본의 VAT 포함값이므로 /1.1한 공급가 단가로 변환한다.
 * - 호주는 원본 P 외화단가 × 원본 O37 AUD 과세환율로 평가한 취득원가를 보존한다.
 * - 이 함수는 읽기 전용이며 DB에 증거를 복사하거나 승격하지 않는다.
 */
export function inventoryWorkbookPriceEvidenceByProduct(orderYear, orderWeek) {
  const targetWeek = toComparableWeek(orderYear, orderWeek);
  const effectiveFrom = toComparableWeek(catalog.source.orderYear, catalog.source.majorWeek);
  if (targetWeek == null || effectiveFrom == null || targetWeek < effectiveFrom) return {};

  const result = {};
  for (const entry of catalog.entries || []) {
    const price = entryPrice(entry);
    if (!Number.isFinite(price) || price < 0) continue;
    result[String(entry.prodKey)] = {
      price,
      source: 'VERIFIED_WORKBOOK_CATALOG',
      sourceRefs: [sourceRef(entry)],
      unit: normalizeInventoryUnit(entry.unit),
      basis: entry.basis,
      currency: entry.currency || 'KRW',
      sourceLabel: entry.sourceLabel,
      effectiveFrom: `${catalog.source.orderYear}-${String(catalog.source.majorWeek).padStart(2, '0')}`,
    };
  }
  return result;
}

export function inventoryWorkbookCatalogMetadata() {
  return {
    version: catalog.version,
    source: catalog.source,
    validation: catalog.validation,
    entryCount: (catalog.entries || []).length,
    quarantined: catalog.quarantined || [],
  };
}
