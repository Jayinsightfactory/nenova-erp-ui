import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (file) => fs.readFileSync(file, 'utf8');
const farmApi = read('pages/api/shipment/farm-distribution.js');
const adjust = read('pages/api/shipment/adjust.js');
const estimateSql = read('lib/exeEstimateViewSql.js');
const estimateDiagnostic = read('pages/api/shipment/estimate-visibility.js');
const profitReport = read('lib/profitReport.js');
const salesStatus = read('pages/api/sales/status.js');
const farmCandidates = read('lib/shipmentFarmCandidates.js');

// 농장배정 저장은 ShipmentFarm + 전산 비고만 변경한다. 수량/금액/견적 원장을
// 직접 건드리면 농장 수정만으로 매출·견적이 바뀌는 회귀가 된다.
assert.match(farmApi, /DELETE FROM ShipmentFarm WHERE SdetailKey=@dk/);
assert.match(farmApi, /INSERT INTO ShipmentFarm \(FarmKey, ShipmentQuantity, SdetailKey\)/);
assert.match(farmApi, /UPDATE ShipmentDetail SET Descr=@descr WHERE SdetailKey=@dk/);
assert.doesNotMatch(farmApi, /UPDATE ShipmentDetail SET[\s\S]*?OutQuantity=/);
assert.doesNotMatch(farmApi, /\b(?:Estimate|WebProfitReport|ReceivableLedger|TaxInvoice)\b/);

// 차수피벗 ADD/CANCEL은 주문·출고 수량과 금액을 함께 다룰 수 있는 유일한
// 경로이므로 명시적 mode/policy와 ShipmentFarm 후보 검증을 유지한다.
assert.match(adjust, /isPivotDistributionMode\(mode\)/);
assert.match(adjust, /resolvePivotAdjustmentPolicy\(\{ mode, type, hasActiveOrder \}\)/);
assert.match(adjust, /FARM_CANDIDATE_SCOPE_SQL/);

// 견적은 EXE와 동일하게 ViewShipment + ViewOrder + ShipmentDate + PeriodDay
// 조인 및 확정 출고 조건을 사용한다.
assert.match(estimateSql, /JOIN ViewOrder vo/);
assert.match(estimateSql, /JOIN ShipmentDate/);
assert.match(estimateSql, /JOIN PeriodDay/);
assert.match(estimateSql, /vs\.DetailFix = 1/);
assert.equal((estimateDiagnostic.match(/vs\.DetailFix = 1/g) || []).length, 2);

// 매출/주차별 손익은 확정 출고의 저장 금액을 집계한다. 농장 배정만 바뀐
// 경우 이 원장의 수량·Amount·Vat·isFix가 바뀌지 않아야 한다.
assert.match(profitReport, /SUM\(ISNULL\(sd\.Amount,0\)\)/);
assert.match(profitReport, /ISNULL\(sm\.isFix,0\)=1/);
assert.match(salesStatus, /ISNULL\(sd\.isFix, 0\) = 1/);
assert.match(salesStatus, /ISNULL\(sd\.Amount, 0\) AS supplyAmt/);

assert.match(farmCandidates, /yearScoped:\s*false/);
assert.match(farmCandidates, /weekScoped:\s*false/);

console.log('shipmentDownstreamImpactContract: all tests passed');
