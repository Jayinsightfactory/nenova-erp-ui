const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { buildRaumPnlArrivalReferences, loadRaumPnlArrivalReferences, RAUM_PNL_ARRIVAL_REFERENCE_SQL } = await import('../lib/raumPnlArrivalReference.js');
  const items = [
    { itemKey: 10, prodKey: 456, unit: '단' },
    { itemKey: 11, prodKey: 456, unit: '송이' },
    { itemKey: 12, prodKey: null, unit: '단' },
  ];
  const rows = [
    { OrderWeek: '37-1', ProdKey: 456, ArrivalUnit: '단', SelectedArrivalCostKRW: 1000, SteamOf1Bunch: 10 },
    { OrderWeek: '37-2', ProdKey: 456, ArrivalUnit: '송이', SelectedArrivalCostKRW: 120, SteamOf1Bunch: 10 },
    { OrderWeek: '37-2', ProdKey: 456, ArrivalUnit: '송이', SelectedArrivalCostKRW: 125, SteamOf1Bunch: 10 },
    { OrderWeek: '37-1', ProdKey: 999, ArrivalUnit: '단', SelectedArrivalCostKRW: 9999, SteamOf1Bunch: 10 },
  ];
  const refs = buildRaumPnlArrivalReferences(items, rows);
  assert.deepEqual(refs[10].map(row => [row.week, row.cost, row.unit]), [['37-1', 1000, '단'], ['37-2', 1250, '단']]);
  assert.deepEqual(refs[11].map(row => [row.week, row.cost, row.unit]), [['37-1', 100, '송이'], ['37-2', 125, '송이']]);
  assert.equal(refs[12], undefined, 'unmatched P&L item never receives another product cost');

  let captured = null;
  const loaded = await loadRaumPnlArrivalReferences({ orderYear: '2026', major: 37, items }, async (sqlText, params) => {
    captured = { sqlText, params };
    return { recordset: rows };
  });
  assert.deepEqual(loaded[10].map(row => row.week), ['37-1', '37-2']);
  assert.match(captured.sqlText, /l\.OrderYear=@yr/);
  assert.match(captured.sqlText, /TRY_CONVERT\(INT, LEFT\(l\.OrderWeek/);
  assert.doesNotMatch(captured.sqlText, /fallback|TOP\s+1/i);
  assert.equal(captured.params.yr.value, '2026');
  assert.equal(captured.params.major.value, 37);
  assert.ok(Object.values(captured.params).some(param => param.value === 456));
  assert.match(RAUM_PNL_ARRIVAL_REFERENCE_SQL, /ISNULL\(l\.IsCurrent,0\)=1/);

  const api = fs.readFileSync(path.join(__dirname, '../pages/api/raum/pnl.js'), 'utf8');
  const excelBlock = api.slice(api.indexOf("if (req.query.excel === '1')"), api.indexOf('if (req.query.key)'));
  assert.doesNotMatch(excelBlock, /arrivalReference/i, 'Excel export never loads the transient web arrival reference');
  const page = fs.readFileSync(path.join(__dirname, '../pages/raum/pnl.js'), 'utf8');
  assert.match(page, /해당 차수 도착원가/);
  assert.match(page, /웹 확인용/);
  const hotelApi = fs.readFileSync(path.join(__dirname, '../pages/api/raum/hotel-purchase-costs.js'), 'utf8');
  assert.match(hotelApi, /requirePnlPartner/);
  assert.match(hotelApi, /\['raum', 'choimun'\]\.includes\(partner\.code\)/, 'shared partners cannot bypass the shared write contract');
  assert.match(hotelApi, /saveRaumPnlPurchaseCosts\(\{[\s\S]*partnerCode: partner\.code/, 'server-validated hotel code scopes the isolated save');
  assert.doesNotMatch(hotelApi, /WebRaumCostPrice|OrderDetail|ShipmentDetail|StockHistory/, 'isolated API cannot add ERP/global-cost writes');
  console.log('Hotel P&L exact-week web-only arrival reference tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
