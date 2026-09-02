import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPreShipmentHistoryAvailableWeeksSql,
  buildPreShipmentHistoryConfirmedShipmentSql,
  buildPreShipmentHistoryCustomerDistributionSql,
  buildPreShipmentHistoryShipmentDateSql,
  buildPreShipmentHistorySnapshotSql,
  buildPreShipmentHistoryStatus,
  buildPreShipmentHistoryStockHistorySql,
  buildPreShipmentHistoryWarehouseSql,
  isManualStockAdjustment,
  normalizePreShipmentHistoryItems,
  normalizePreShipmentHistoryScope,
  resolveNormalHistoryWeek,
} from '../lib/preShipmentHistory.js';

assert.deepEqual(normalizePreShipmentHistoryScope({ orderYear: '2026', preWeek: '35-01', normalWeek: '35-02', custKey: '680' }), {
  orderYear: '2026', preWeek: '35-01', normalWeek: '35-02', custKey: 680,
});
assert.throws(() => normalizePreShipmentHistoryScope({ orderYear: '', preWeek: '35-01', custKey: 1 }), /orderYear/);
assert.throws(() => normalizePreShipmentHistoryScope({ orderYear: '2026', preWeek: '35-1', custKey: 1 }), /NN-NN/);
assert.throws(() => normalizePreShipmentHistoryScope({ orderYear: '2026', preWeek: '35-01', custKey: 0 }), /custKey/);
assert.deepEqual(normalizePreShipmentHistoryItems([{ prodKey: '456', quantity: 0, unit: '박스' }]), [{ prodKey: 456, quantity: 0, unit: '박스' }], '명시적 0 수량은 보존한다.');
assert.throws(() => normalizePreShipmentHistoryItems([{ prodKey: 1, quantity: -1 }]), /수량/);
assert.deepEqual(resolveNormalHistoryWeek('35-01', null, ['35-01', '35-03', '35-02']), { normalWeek: '35-02', source: 'next-stock-snapshot' });
assert.deepEqual(resolveNormalHistoryWeek('35-01', '35-03', ['35-02']), { normalWeek: '35-03', source: 'requested' });
assert.deepEqual(resolveNormalHistoryWeek('53-02', null, ['53-02']), { normalWeek: null, source: 'unavailable' });
assert.equal(isManualStockAdjustment('재고조정'), true);
assert.equal(isManualStockAdjustment('출고'), false);
assert.deepEqual(buildPreShipmentHistoryStatus({ snapshot: { HasSnapshot: 1 }, stockHistory: [{ ChangeType: '재고조정' }] }), {
  hasStockSnapshot: true, hasStockHistory: true, hasManualStockAdjustment: true, stockAdjustmentLabel: '수동 재고조정 있음',
});

const sqlBlocks = [
  buildPreShipmentHistoryAvailableWeeksSql(),
  buildPreShipmentHistorySnapshotSql(['prod0']),
  buildPreShipmentHistoryStockHistorySql(['prod0']),
  buildPreShipmentHistoryWarehouseSql(['prod0']),
  buildPreShipmentHistoryConfirmedShipmentSql(['prod0']),
  buildPreShipmentHistoryCustomerDistributionSql(['prod0']),
  buildPreShipmentHistoryShipmentDateSql(['prod0']),
];
for (const block of sqlBlocks) {
  assert.doesNotMatch(block, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i, '선출고 후출고 이력은 SELECT-only여야 한다.');
  assert.match(block, /@orderYear|StockMaster/, '모든 이력 SQL은 연도 기준 또는 연도 범위 후보를 사용한다.');
}
assert.match(sqlBlocks[0], /sm\.OrderYear=@orderYear/);
assert.match(sqlBlocks[0], /EXISTS \(SELECT 1 FROM ProductStock/);
assert.doesNotMatch(sqlBlocks[1], /sm\.isFix\s*=/, 'ProductStock 스냅샷은 StockMaster.isFix로 제외하지 않는다.');
assert.match(sqlBlocks[2], /sh\.OrderYear=@orderYear/);
assert.match(sqlBlocks[3], /vw\.OrderYear=@orderYear/);
assert.match(sqlBlocks[4], /vs\.OrderYear=@orderYear/);
assert.match(sqlBlocks[4], /vs\.DetailFix/);
assert.match(sqlBlocks[5], /vs\.CustKey=@custKey/);
assert.match(sqlBlocks[6], /JOIN ShipmentDate/);

const source = fs.readFileSync(new URL('../lib/preShipmentHistory.js', import.meta.url), 'utf8');
assert.match(source, /StockHistory는 거래처 FK가 없으므로/);
assert.doesNotMatch(source, /(?:INSERT\s+INTO|UPDATE\s+\w+|DELETE\s+FROM|MERGE\s+)/i, '읽기 helper에 ERP DML을 추가하면 안 된다.');
console.log('preShipmentHistory.test.js passed');
