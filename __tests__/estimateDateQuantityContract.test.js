const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const {
    exeDateAmountVat,
    checkExeDateQuantityTotal,
  } = await import('../lib/estimateDateQuantity.js');
  const { shipmentUnitsFromUserInput } = await import('../lib/distributeUnits.js');
  const {
    dedupeEstimatePhysicalRows,
    estimatePhysicalRowKey,
    estimateQuantityEditKey,
  } = await import('../lib/estimatePhysicalRow.js');

  const amountVat = exeDateAmountVat(700, 190);
  assert.equal(amountVat.roundedQty, 190);
  assert.equal(amountVat.amount, 120909);
  assert.equal(amountVat.vat, 12091);

  const rows = [
    { SdateKey: 1, EstQuantity: 180 },
    { SdateKey: 2, EstQuantity: 20 },
  ];
  assert.equal(checkExeDateQuantityTotal(rows, 200, new Map([['1', 190], ['2', 10]])).ok, true);
  assert.equal(checkExeDateQuantityTotal(rows, 200, new Map([['1', 190]])).ok, false);

  const physical = shipmentUnitsFromUserInput(190, '단', {
    OutUnit: '박스',
    EstUnit: '단',
    BunchOf1Box: 10,
    SteamOf1Bunch: 0,
    SteamOf1Box: 0,
  });
  assert.equal(physical.outQuantity, 19);
  assert.equal(physical.estQty, 190);

  const repeatedJoinRow = {
    SdetailKey: 41,
    SdateKey: 501,
    ProdKey: 824,
    ProdName: 'Hydrangea Burgundy',
    outDate: '2026-09-02',
  };
  assert.deepEqual(
    dedupeEstimatePhysicalRows([repeatedJoinRow, { ...repeatedJoinRow }]).map(estimatePhysicalRowKey),
    ['sdate:501'],
    '같은 ShipmentDate 행이 JOIN으로 반복되면 한 번만 표시해야 한다.'
  );
  const distinctPhysicalRows = [
    repeatedJoinRow,
    { ...repeatedJoinRow, SdateKey: 502 },
  ];
  assert.equal(
    dedupeEstimatePhysicalRows(distinctPhysicalRows).length,
    2,
    '같은 품목·날짜라도 서로 다른 ShipmentDate 행은 합치면 안 된다.'
  );
  assert.notEqual(
    estimateQuantityEditKey(distinctPhysicalRows[0]),
    estimateQuantityEditKey(distinctPhysicalRows[1]),
    '서로 다른 실제 출고일 행의 수량 입력 상태는 독립적이어야 한다.'
  );
  assert.equal(
    dedupeEstimatePhysicalRows([
      { EstimateKey: 701, SdetailKey: null },
      { EstimateKey: 701, SdetailKey: null },
    ]).length,
    1,
    '같은 불량·검역 차감 행이 반복되어도 한 번만 표시해야 한다.'
  );

  const api = fs.readFileSync('pages/api/estimate/update-date-quantity.js', 'utf8');
  assert.match(api, /ShipmentDate/);
  assert.match(api, /SdateKey/);
  assert.match(api, /UPDATE ShipmentDate/);
  assert.match(api, /Descr=CASE WHEN @hasDescr=1 THEN @descr ELSE Descr END/);
  assert.match(api, /expectedOldDescr/);
  assert.match(api, /UPDATE ShipmentDetail/);
  assert.match(api, /ShipmentQuantity/);
  assert.match(api, /buildDirectionalQuantityPlan/);
  assert.match(api, /positiveIncreaseByProduct/);
  assert.match(api, /assertDirectionalGateCapability/);
  assert.match(api, /lockDirectionalGate/);
  assert.match(api, /usp_StockCalculation/);
  assert.doesNotMatch(api, /FIXED_WEEK|EXEC[^\n]*usp_ShipmentFix(?:Cancel)?\b/);
  assert.doesNotMatch(api, /SET\s+isFix\s*=/i);
  assert.match(api, /shipmentUnitsFromUserInput/);
  assert.match(api, /purgeZeroOutShipmentDetail/);
  assert.match(api, /isActiveShipmentOutQty/);
  assert.doesNotMatch(api, /전체 출고수량을 0으로 만들 때는/);
  assert.doesNotMatch(api, /UPDATE OrderDetail/);

  const estimateApi = fs.readFileSync('pages/api/estimate/index.js', 'utf8');
  assert.match(estimateApi, /sdd\.SdateKey AS SdateKey/);
  assert.match(estimateApi, /ISNULL\(sdd\.EstQuantity, 0\)/);
  assert.match(estimateApi, /GROUP BY LEFT\(sm\.OrderWeek, CHARINDEX\('-', sm\.OrderWeek\) - 1\), sm\.OrderYear, sm\.CustKey/);
  assert.match(estimateApi, /dedupeEstimatePhysicalRows/);
  assert.match(estimateApi, /SELECT TOP 1 cpc1\.Cost/);
  assert.match(estimateApi, /ORDER BY cpc1\.AutoKey DESC/);
  assert.match(estimateApi, /SELECT TOP 1 sdMatch\.\*/);
  assert.doesNotMatch(estimateApi, /applyByDateRowQuantities/);

  const page = fs.readFileSync('pages/estimate.js', 'utf8');
  assert.match(page, /getQtyEditKey/);
  assert.match(page, /estimatePhysicalRowKey\(item\)/);
  assert.match(page, /sdateKey/);
  assert.match(page, /update-date-quantity/);
  assert.match(page, /descr: editor\.descr/);
  assert.match(page, /expectedOldDescr/);
  assert.match(page, /runEditWithFixCycle/);
  assert.match(page, /formatAutoUnfixSaveLog/);
  assert.doesNotMatch(page, /먼저 확정취소 후 출고일별 분배를 수정하세요/);
  console.log('Estimate date quantity contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
