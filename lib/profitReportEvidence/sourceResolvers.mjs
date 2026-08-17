import { canonicalDigest } from './canonical.mjs';
import { createProvenance } from './provenance.mjs';

export const SOURCE_RESOLVER_CATALOG = Object.freeze({
  shipmentConfirmedSales: {
    id: 'shipment-confirmed-sales', version: 1, output: 'N',
    predicates: ['ShipmentMaster.OrderYear = @orderYear', "ShipmentMaster.OrderWeek LIKE @major + '-%'", 'ShipmentMaster.isFix = 1', 'ShipmentMaster.isDeleted = 0', 'ShipmentDetail.isFix = 1'],
  },
  confirmedProductStock: {
    id: 'product-stock-snapshot', version: 2, output: 'inventoryQuantity',
    predicates: ['StockMaster.OrderYear = @orderYear', "StockMaster.OrderWeek LIKE @major + '-%'", 'ProductStock row exists', 'StockMaster.isFix is not a FormStockView filter'],
    tieBreak: ['numeric subweek DESC', 'ProductStock row count DESC', 'StockKey DESC'],
  },
  confirmedInventoryValue: {
    id: 'confirmed-inventory-value', version: 1, output: 'E|F',
    predicates: ['confirmed ProductStock quantity', 'price evidence effective at stock snapshot', 'no direct final-value fallback'],
  },
  persistedWorkbookCell: {
    id: 'persisted-workbook-cell', version: 1, output: 'cell',
    predicates: ['source workbook SHA-256 allowlist', 'persisted worksheet cell'],
  },
  confirmedArrivalCost: {
    id: 'confirmed-arrival-cost', version: 1, output: 'inventoryUnitPrice',
    predicates: ['exact OrderYear+OrderWeek+ProdKey', 'IsCurrent=1', 'MatchStatus=MATCHED', 'current import revision', 'user MATCH/BASIS_CHANGE history', 'source file/sheet/row provenance', 'arrival unit = Product.EstUnit'],
  },
  estimateAmounts: {
    id: 'estimate-amounts', version: 1, output: 'L|O',
    predicates: ['ShipmentMaster.OrderYear = @orderYear', "ShipmentMaster.OrderWeek LIKE @major + '-%'", 'ShipmentMaster.isFix = 1', 'ShipmentMaster.isDeleted = 0', 'Estimate joins the selected ShipmentMaster', 'EstimateType 불량차감 -> L, otherwise -> O'],
  },
  warehousePurchases: {
    id: 'warehouse-purchases', version: 1, output: 'Q|purchaseQuantity',
    predicates: ['WarehouseMaster.OrderYear = @orderYear', "WarehouseMaster.OrderWeek LIKE @major + '-%'", 'WarehouseMaster.isDeleted = 0', 'WarehouseDetail stockable product rows only', 'weight/forwarding placeholders excluded'],
  },
  taxableExchangeRate: {
    id: 'taxable-exchange-rate', version: 2, output: 'R',
    predicates: ['exact OrderYear+MajorWeek', 'complete FreightCost.ExchangeRate snapshot OR exact saved taxable rate OR 2026-22~27 workbook evidence OR 2026-28+ KCS rate', 'no CurrencyMaster current-rate fallback', 'no previous-week automatic inheritance'],
  },
  customsAndForwarding: {
    id: 'customs-and-forwarding', version: 2, output: 'H|S',
    predicates: ['WarehouseMaster.OrderYear = @orderYear', "WarehouseMaster.OrderWeek LIKE @major + '-%'", 'AWB GW/CW and WarehouseDetail.BoxQuantity', 'external invoice components retain source evidence', '29+ forwarding source ledger fully reconciled'],
  },
  reportFormula: {
    id: 'weekly-profit-report-formula', version: 2, output: 'C:U',
    predicates: ['C=N+L+O', 'D=C/totalC', 'G=P+T', 'P=Q*R', 'T=S*R', 'I=E+G+H-F', 'J=C-I', 'K=J/C', 'M=-L/C', 'U=P/totalP'],
  },
});

export function normalizeEvidenceUnit(value) {
  const text = String(value || '').trim().toUpperCase();
  if (['박스', 'BOX', 'BX'].includes(text)) return '박스';
  if (['단', 'BUNCH', 'BUN'].includes(text)) return '단';
  if (['송이', '스팀', '대', 'STEM', 'EA'].includes(text)) return '송이';
  return text;
}

export function normalizeEvidenceOrderWeek(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  return match ? `${Number(match[1])}-${String(Number(match[2])).padStart(2, '0')}` : text;
}

/**
 * 도착원가가 단순 업로드/자동매칭됐다는 이유만으로 재고단가가 되지 않도록 하는 순수 판정기.
 * 사용자가 품목/농장 또는 배분기준을 저장한 이력과 완전한 셀 출처가 모두 있어야 한다.
 */
export function resolveExactArrivalPriceEvidence(rows, {
  orderYear,
  orderWeek,
  prodKey,
  estimateUnit,
} = {}) {
  const resolver = SOURCE_RESOLVER_CATALOG.confirmedArrivalCost;
  const valueOf = (row, camel, pascal) => row?.[camel] ?? row?.[pascal];
  const targetUnit = normalizeEvidenceUnit(estimateUnit);
  const targetWeek = normalizeEvidenceOrderWeek(orderWeek);
  const candidates = (rows || []).filter((row) => {
    const selected = Number(valueOf(row, 'selectedArrivalCostKRW', 'SelectedArrivalCostKRW'));
    const source = Number(valueOf(row, 'sourceArrivalCostKRW', 'SourceArrivalCostKRW'));
    const action = String(valueOf(row, 'confirmationAction', 'ConfirmationAction') || '').toUpperCase();
    return String(valueOf(row, 'orderYear', 'OrderYear')) === String(orderYear)
      && normalizeEvidenceOrderWeek(valueOf(row, 'orderWeek', 'OrderWeek')) === targetWeek
      && Number(valueOf(row, 'prodKey', 'ProdKey')) === Number(prodKey)
      && Number(valueOf(row, 'isCurrent', 'IsCurrent')) === 1
      && Number(valueOf(row, 'importIsDeleted', 'ImportIsDeleted') || 0) === 0
      && String(valueOf(row, 'matchStatus', 'MatchStatus') || '').toUpperCase() === 'MATCHED'
      && ['MATCH', 'BASIS_CHANGE'].includes(action)
      && (selected > 0 || source > 0)
      && Number(valueOf(row, 'quantity', 'Quantity')) > 0
      && normalizeEvidenceUnit(valueOf(row, 'unit', 'Unit')) === targetUnit
      && String(valueOf(row, 'sourceFileName', 'SourceFileName') || '').trim()
      && String(valueOf(row, 'sheetName', 'SheetName') || '').trim()
      && Number(valueOf(row, 'sourceRow', 'SourceRow')) > 0
      && Number(valueOf(row, 'importKey', 'ImportKey')) > 0
      && Number(valueOf(row, 'revisionNo', 'RevisionNo')) > 0
      && String(valueOf(row, 'confirmedBy', 'ConfirmedBy') || '').trim()
      && !Number.isNaN(new Date(valueOf(row, 'confirmedAt', 'ConfirmedAt')).getTime());
  }).sort((a, b) =>
    Number(valueOf(b, 'revisionNo', 'RevisionNo')) - Number(valueOf(a, 'revisionNo', 'RevisionNo'))
    || new Date(valueOf(b, 'confirmedAt', 'ConfirmedAt')).getTime() - new Date(valueOf(a, 'confirmedAt', 'ConfirmedAt')).getTime()
    || Number(valueOf(b, 'arrivalLineKey', 'ArrivalLineKey')) - Number(valueOf(a, 'arrivalLineKey', 'ArrivalLineKey')));

  if (!candidates.length) {
    return {
      status: 'INPUT_REQUIRED',
      value: null,
      requiredField: 'inventory.unit-price-evidence',
      reason: '같은 연도·차수·품목·단위의 사용자 확정 도착원가 근거가 없습니다.',
      provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs: [], inputPayload: { orderYear, orderWeek, prodKey, estimateUnit }, outputValue: null, evidenceStatus: 'INPUT_REQUIRED' }),
    };
  }
  let weightedValue = 0;
  let totalQuantity = 0;
  const sourceRefs = [];
  for (const row of candidates) {
    const selected = Number(valueOf(row, 'selectedArrivalCostKRW', 'SelectedArrivalCostKRW'));
    const source = Number(valueOf(row, 'sourceArrivalCostKRW', 'SourceArrivalCostKRW'));
    const price = selected > 0 ? selected : source;
    const quantity = Number(valueOf(row, 'quantity', 'Quantity'));
    weightedValue += price * quantity;
    totalQuantity += quantity;
    const file = String(valueOf(row, 'sourceFileName', 'SourceFileName')).trim();
    const sheet = String(valueOf(row, 'sheetName', 'SheetName')).trim();
    const sourceRow = Number(valueOf(row, 'sourceRow', 'SourceRow'));
    const importKey = Number(valueOf(row, 'importKey', 'ImportKey'));
    const revisionNo = Number(valueOf(row, 'revisionNo', 'RevisionNo'));
    sourceRefs.push(`arrival-cost:${orderYear}:${orderWeek}:import-${importKey}:rev-${revisionNo}:${file}#${sheet}!row-${sourceRow}`);
  }
  const row = candidates[0];
  const unitPrice = weightedValue / totalQuantity;
  const importKey = Number(valueOf(row, 'importKey', 'ImportKey'));
  const revisionNo = Number(valueOf(row, 'revisionNo', 'RevisionNo'));
  const confirmedBy = String(valueOf(row, 'confirmedBy', 'ConfirmedBy')).trim();
  const confirmedAt = new Date(valueOf(row, 'confirmedAt', 'ConfirmedAt')).toISOString();
  const sourceRef = sourceRefs[0];
  return {
    status: 'PASS',
    value: unitPrice,
    unitPrice,
    verified: true,
    effectiveAt: confirmedAt,
    confirmedBy,
    sourceRef,
    sourceRefs,
    importKey,
    revisionNo,
    provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs, inputPayload: { orderYear, orderWeek, prodKey, estimateUnit, arrivalLineKeys: candidates.map(item => valueOf(item, 'arrivalLineKey', 'ArrivalLineKey')) }, outputValue: unitPrice }),
  };
}

const numericSubweek = week => {
  const match = String(week || '').match(/-(\d+)$/);
  return match ? Number(match[1]) : -1;
};

export function selectConfirmedStockSnapshot(rows, { orderYear, majorWeek }) {
  const major = String(majorWeek).padStart(2, '0');
  const candidates = (rows || []).filter(row =>
    String(row.orderYear) === String(orderYear)
    && String(row.orderWeek || '').startsWith(`${major}-`)
    && Number(row.productRowCount) > 0);
  candidates.sort((a, b) =>
    numericSubweek(b.orderWeek) - numericSubweek(a.orderWeek)
    || Number(b.productRowCount) - Number(a.productRowCount)
    || Number(b.stockKey) - Number(a.stockKey));
  return candidates[0] || null;
}

/** SQL resolver와 같은 선택 규칙을 fixture에서 검증하는 순수 함수. */
export function resolveConfirmedShipmentRows(rows, { orderYear, majorWeek }) {
  const major = String(majorWeek).padStart(2, '0');
  return (rows || []).filter(row =>
    String(row.orderYear) === String(orderYear)
    && String(row.orderWeek || '').startsWith(`${major}-`)
    && Number(row.masterFix) === 1
    && Number(row.detailFix) === 1
    && Number(row.masterDeleted || 0) === 0
    && Number(row.outQuantity || 0) !== 0);
}

export function resolveInventoryValue({ category, stockSnapshot, quantities, priceEvidence }) {
  const resolver = SOURCE_RESOLVER_CATALOG.confirmedInventoryValue;
  const base = { category, stockSnapshot, quantities, priceEvidence };
  if (!stockSnapshot || !Number(stockSnapshot.stockKey)) {
    return { status: 'INPUT_REQUIRED', value: null, requiredField: 'inventory.product-stock-snapshot', reason: 'ProductStock 행이 있는 재고 스냅샷이 없습니다.', provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs: [], inputPayload: base, outputValue: null, evidenceStatus: 'INPUT_REQUIRED' }) };
  }
  const rows = quantities || [];
  const prices = new Map((priceEvidence || []).filter(item => item.verified === true && item.effectiveAt).map(item => [String(item.prodKey), item]));
  const missingProdKeys = rows.filter(row => Number(row.quantity) !== 0 && !prices.has(String(row.prodKey))).map(row => row.prodKey);
  if (missingProdKeys.length) {
    return { status: 'INPUT_REQUIRED', value: null, requiredField: 'inventory.unit-price-evidence', missingProdKeys, reason: '재고 스냅샷 시점의 확정 단가 근거가 없습니다.', provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs: [`StockMaster:${stockSnapshot.stockKey}`], inputPayload: base, outputValue: null, evidenceStatus: 'INPUT_REQUIRED' }) };
  }
  const value = rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(prices.get(String(row.prodKey))?.unitPrice || 0), 0);
  const sourceRefs = [`StockMaster:${stockSnapshot.stockKey}`, ...[...prices.values()].map(item => item.sourceRef)].filter(Boolean);
  return { status: 'PASS', value, provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs, inputPayload: base, outputValue: value }) };
}

export function shipmentResolverContractDigest() {
  return canonicalDigest(SOURCE_RESOLVER_CATALOG.shipmentConfirmedSales);
}
