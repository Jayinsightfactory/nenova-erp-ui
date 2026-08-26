import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapExeDetailRowToWebItem, mapEstimateDeleteSnapshot, sqlEstimateGetDetail } from '../lib/exeEstimateViewSql.js';

const stored = {
  Sort: 1, DetailKey: 8694, EstimateKey: 8694, ShipmentKey: 5897, OrderWeek: '34-01',
  ProdKey: 447, Unit: '단', EstQuantity: -1, Cost: 10500.25, Amount: -7160.12,
  Vat: -715.0675, Descr: '원본 적요', EstimateTypeRaw: '불량차감',
  DeleteQuantityRaw: -0.75, DeleteUnitRaw: '박스', DeleteTypeRaw: 'FEE03-KR0010',
  DeleteDateRaw: '2026-08-25',
};
const item = mapExeDetailRowToWebItem(stored);
assert.equal(item.Quantity, -1); // Existing EXE display remains unchanged.
assert.equal(item.Unit, '단');
assert.deepEqual(item.DeleteSnapshot, {
  quantity: -0.75, cost: 10500.25, amount: -7160.12, vat: -715.0675,
  unit: '박스', estimateType: 'FEE03-KR0010', descr: '원본 적요', estimateDate: '2026-08-25',
});
assert.equal(item.ShipmentKey, 5897);
assert.equal(item.OrderWeek, '34-01');
assert.equal(mapExeDetailRowToWebItem({ ...stored, Sort: 0, EstimateKey: null }).DeleteSnapshot, null);
assert.equal(mapEstimateDeleteSnapshot({ ...stored, DeleteTypeRaw: undefined }), null);
assert.equal(mapEstimateDeleteSnapshot({ ...stored, DeleteDateRaw: null }).estimateDate, null);
assert.equal(mapEstimateDeleteSnapshot({ ...stored, DeleteUnitRaw: null }).unit, '');

const detailSql = sqlEstimateGetDetail({ orderYearWeek: '202634', custKey: 565 });
assert.match(detailSql, /COALESCE\(e\.ShipmentKey, sdt\.ShipmentKey\) AS ShipmentKey/);
assert.match(detailSql, /LEFT JOIN ShipmentMaster sm ON COALESCE\(e\.ShipmentKey, sdt\.ShipmentKey\) = sm\.ShipmentKey/);
assert.match(detailSql, /e\.Quantity AS DeleteQuantityRaw/);
assert.match(detailSql, /e\.Unit AS DeleteUnitRaw/);
assert.match(detailSql, /CONVERT\(NVARCHAR\(10\), e\.EstimateDtm, 120\) AS DeleteDateRaw/);
const api = fs.readFileSync(new URL('../pages/api/estimate/index.js', import.meta.url), 'utf8');
assert.match(api, /e\.Quantity AS DeleteQuantityRaw/);
assert.match(api, /DeleteSnapshot: mapEstimateDeleteSnapshot\(row\)/);
console.log('estimateDeductionReadSnapshot: raw quantity/unit/type/date snapshots and shipment identity PASS');
