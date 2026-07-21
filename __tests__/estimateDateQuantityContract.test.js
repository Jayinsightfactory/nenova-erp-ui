const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const {
    exeDateAmountVat,
    checkExeDateQuantityTotal,
  } = await import('../lib/estimateDateQuantity.js');
  const { shipmentUnitsFromUserInput } = await import('../lib/distributeUnits.js');

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

  const api = fs.readFileSync('pages/api/estimate/update-date-quantity.js', 'utf8');
  assert.match(api, /ShipmentDate/);
  assert.match(api, /SdateKey/);
  assert.match(api, /UPDATE ShipmentDate/);
  assert.match(api, /UPDATE ShipmentDetail/);
  assert.match(api, /ShipmentQuantity/);
  assert.match(api, /FIXED_WEEK/);
  assert.match(api, /shipmentUnitsFromUserInput/);
  assert.doesNotMatch(api, /UPDATE OrderDetail/);

  const estimateApi = fs.readFileSync('pages/api/estimate/index.js', 'utf8');
  assert.match(estimateApi, /sdd\.SdateKey AS SdateKey/);
  assert.match(estimateApi, /ISNULL\(sdd\.EstQuantity, 0\)/);
  assert.doesNotMatch(estimateApi, /applyByDateRowQuantities/);

  const page = fs.readFileSync('pages/estimate.js', 'utf8');
  assert.match(page, /getQtyEditKey/);
  assert.match(page, /sdateKey/);
  assert.match(page, /update-date-quantity/);
  assert.match(page, /runEditWithFixCycle/);
  console.log('Estimate date quantity contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
