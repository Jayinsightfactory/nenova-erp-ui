const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    filterEstimateShipmentsByManager,
    filterEstimateShipmentsByCustomer,
    listEstimateShipmentManagers,
    listEstimateShipmentCustomers,
  } = await import('../lib/estimatePrintOrder.js');
  const rows = [
    { CustKey: 1, CustName: '가게A', Manager: '홍길동' },
    { CustKey: 2, CustName: '가게B', Manager: '김철수' },
    { CustKey: 3, CustName: '가게C', Manager: '' },
  ];
  assert.deepEqual(filterEstimateShipmentsByManager(rows, '홍길동').map(r => r.CustKey), [1]);
  assert.deepEqual(filterEstimateShipmentsByManager(rows, '담당자 미지정').map(r => r.CustKey), [3]);
  assert.equal(filterEstimateShipmentsByManager(rows).length, 3, '담당자 미선택은 전체 업체를 유지해야 한다.');
  assert.deepEqual(listEstimateShipmentManagers(rows), ['김철수', '홍길동', '담당자 미지정']);
  assert.deepEqual(filterEstimateShipmentsByCustomer(rows, 2).map(r => r.CustKey), [2]);
  assert.equal(filterEstimateShipmentsByCustomer(rows, '').length, 3, '업체 미선택은 전체 업체를 유지해야 한다.');
  const customers = listEstimateShipmentCustomers([
    { CustKey: 1, CustName: '가게A', totalAmount: 100 },
    { CustKey: 2, CustName: '가게B', totalAmount: 250 },
    { CustKey: 1, CustName: '가게A', totalAmount: 200 },
  ]);
  assert.deepEqual(customers.map(row => [row.CustKey, row.totalAmount]), [[1, 300], [2, 250]], '중복 업체는 합산 매출순으로 한 번만 표시해야 한다.');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'estimate.js'), 'utf8');
  assert.match(pageSource, /aria-label="담당자 선택"/);
  assert.match(pageSource, /aria-label="업체 선택"/);
  assert.match(pageSource, /selectShipment\(estimateShipmentGroupId\(target\), target\.CustKey, target\.ShipmentKeys\)/, '업체 선택 즉시 기존 상세 조회 경로를 호출해야 한다.');
  console.log('estimate manager filter tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
