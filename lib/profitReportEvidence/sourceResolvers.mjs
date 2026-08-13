import { canonicalDigest } from './canonical.mjs';
import { createProvenance } from './provenance.mjs';

export const SOURCE_RESOLVER_CATALOG = Object.freeze({
  shipmentConfirmedSales: {
    id: 'shipment-confirmed-sales', version: 1, output: 'N',
    predicates: ['ShipmentMaster.OrderYear = @orderYear', "ShipmentMaster.OrderWeek LIKE @major + '-%'", 'ShipmentMaster.isFix = 1', 'ShipmentMaster.isDeleted = 0', 'ShipmentDetail.isFix = 1'],
  },
  confirmedProductStock: {
    id: 'confirmed-product-stock', version: 1, output: 'inventoryQuantity',
    predicates: ['StockMaster.OrderYear = @orderYear', "StockMaster.OrderWeek LIKE @major + '-%'", 'StockMaster.isFix = 1', 'ProductStock row exists'],
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
});

const numericSubweek = week => {
  const match = String(week || '').match(/-(\d+)$/);
  return match ? Number(match[1]) : -1;
};

export function selectConfirmedStockSnapshot(rows, { orderYear, majorWeek }) {
  const major = String(majorWeek).padStart(2, '0');
  const candidates = (rows || []).filter(row =>
    String(row.orderYear) === String(orderYear)
    && String(row.orderWeek || '').startsWith(`${major}-`)
    && Number(row.isFix) === 1
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
  if (!stockSnapshot || Number(stockSnapshot.isFix) !== 1) {
    return { status: 'INPUT_REQUIRED', value: null, requiredField: 'inventory.confirmed-product-stock', reason: 'isFix=1 ProductStock 스냅샷이 없습니다.', provenance: createProvenance({ resolverId: resolver.id, resolverVersion: resolver.version, sourceRefs: [], inputPayload: base, outputValue: null, evidenceStatus: 'INPUT_REQUIRED' }) };
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
