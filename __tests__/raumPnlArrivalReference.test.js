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
  const refs = buildRaumPnlArrivalReferences(items, rows, 37);
  assert.deepEqual(refs[10].map(row => [row.week, row.cost, row.unit]), [['37-1', 1000, '단'], ['37-2', 1200, '단'], ['37-2', 1250, '단']]);
  assert.deepEqual(refs[11].map(row => [row.week, row.cost, row.unit]), [['37-1', 100, '송이'], ['37-2', 120, '송이'], ['37-2', 125, '송이']]);
  assert.equal(refs[12], undefined, 'unmatched P&L item never receives another product cost');

  const fallbackRows = [
    { OrderWeek: '38-2', ProdKey: 456, ArrivalUnit: '단', SelectedArrivalCostKRW: 3800, SteamOf1Bunch: 10 },
    { OrderWeek: '36-1', ProdKey: 456, ArrivalUnit: '단', SelectedArrivalCostKRW: 900, SteamOf1Bunch: 10 },
    { OrderWeek: '36-2', ProdKey: 456, ArrivalUnit: '단', SelectedArrivalCostKRW: 950, SteamOf1Bunch: 10 },
    { OrderWeek: '35-2', ProdKey: 456, ArrivalUnit: '단', SelectedArrivalCostKRW: 800, SteamOf1Bunch: 10 },
  ];
  const fallbackRefs = buildRaumPnlArrivalReferences(items, fallbackRows, 37);
  assert.deepEqual(fallbackRefs[10].map(row => [row.week, row.cost, row.isFallback, row.sourceMajor]), [
    ['36-1', 900, true, 36],
    ['36-2', 950, true, 36],
  ], 'only the latest earlier major week is used when the requested major is absent');
  assert.ok(fallbackRefs[10].every(row => row.requestedMajor === 37));

  const exactWins = buildRaumPnlArrivalReferences(items, [...fallbackRows, ...rows], 37);
  assert.deepEqual(exactWins[10].map(row => row.week), ['37-1', '37-2', '37-2'], 'requested major always wins over prior data');
  assert.ok(exactWins[10].every(row => row.isFallback === false));
  // Regression: 은화호텔 2026 39차 왁스 화이트 has a valid Product mapping;
  // its same-year 40-1 arrival belongs to the established hotel reference window.
  const waxItem = [{ itemKey: 7738, prodKey: 2330, unit: '단', costPrice: 7000 }];
  const waxRow = { OrderYear: '2026', OrderWeek: '40-1', ProdKey: 2330, ArrivalUnit: '단', SelectedArrivalCostKRW: 8641.4405 };
  const nearMisses = [
    { ...waxRow, OrderWeek: '40-2', SelectedArrivalCostKRW: 99999 },
    { ...waxRow, OrderWeek: '41-1', SelectedArrivalCostKRW: 99999 },
    { ...waxRow, OrderWeek: '40-1-2', SelectedArrivalCostKRW: 99999 },
    { ...waxRow, OrderYear: '2025', SelectedArrivalCostKRW: 99999 },
    { ...waxRow, OrderYear: '2027', SelectedArrivalCostKRW: 99999 },
    { ...waxRow, ProdKey: 2490, SelectedArrivalCostKRW: 99999 },
    { ...waxRow, SelectedArrivalCostKRW: 0 },
  ];
  const sourceSnapshot = JSON.stringify([waxItem, waxRow, nearMisses]);
  const nextHotel = buildRaumPnlArrivalReferences(waxItem, [waxRow, ...nearMisses], 39, '2026')[7738];
  assert.deepEqual(nextHotel.map(ref => [ref.week, ref.cost, ref.sourceMajor, ref.isNextHotelWeek, ref.isFallback]), [
    ['40-1', 8641.4405, 40, true, false],
  ], 'only same-year next-major first subweek is added; no further future or another Product');
  assert.equal(JSON.stringify([waxItem, waxRow, nearMisses]), sourceSnapshot, 'references never mutate source or saved CostPrice');
  const waxCurrent = [{ ...waxRow, OrderWeek: '39-1' }, { ...waxRow, OrderWeek: '39-2' }];
  const nextAndCurrent = buildRaumPnlArrivalReferences(waxItem, [waxRow, ...waxCurrent], 39, '2026')[7738];
  assert.deepEqual(nextAndCurrent.map(ref => ref.week), ['39-1', '39-2', '40-1'], 'existing current-major references stay first and next first subweek remains visible');
  const nextAndPrior = buildRaumPnlArrivalReferences(waxItem, [waxRow, { ...waxRow, OrderWeek: '38-2' }], 39, '2026')[7738];
  assert.deepEqual(nextAndPrior.map(ref => ref.week), ['40-1'], 'prior fallback is used only when the current hotel window has no reference');
  const paddedNext = buildRaumPnlArrivalReferences(waxItem, [waxRow, { ...waxRow, OrderWeek: '040-01', SelectedArrivalCostKRW: 9796.8234 }], 39, '2026')[7738];
  assert.deepEqual(paddedNext.map(ref => [ref.week, ref.cost]), [['40-1', 8641.4405], ['40-1', 9796.8234]], 'different source prices survive even when their padded week is equivalent');
  const farmRows = [
    { ...waxRow, ArrivalLineKey: 42946, FarmNameRaw: 'MELODY', SourceFileName: 'china.xlsx', SheetName: '해상', SourceRow: 42, SelectedArrivalCostKRW: 11450.6709 },
    { ...waxRow, ArrivalLineKey: 43046, FarmNameRaw: 'MELODY', SourceFileName: 'china.xlsx', SheetName: '해상 (2)', SourceRow: 42, SelectedArrivalCostKRW: 10886.0779 },
    { ...waxRow, ArrivalLineKey: 43146, FarmNameRaw: 'MELODY', SourceFileName: 'china.xlsx', SheetName: '40-1 해상', SourceRow: 46, SelectedArrivalCostKRW: 9993.8277 },
    { ...waxRow, ArrivalLineKey: 43246, FarmNameRaw: 'MELODY', SourceFileName: 'china.xlsx', SheetName: '40-1 해상 (95% 기준)', SourceRow: 46, SelectedArrivalCostKRW: 9796.8234 },
    { ...waxRow, ArrivalLineKey: 43346, FarmNameRaw: '', SourceFileName: 'china.xlsx', SheetName: '40-1 해상 (95% 기준) (2)', SourceRow: 61, SelectedArrivalCostKRW: 8641.4405 },
  ];
  const farmSnapshot = JSON.stringify(farmRows);
  const farmRefs = buildRaumPnlArrivalReferences(waxItem, farmRows, 39, '2026')[7738];
  assert.equal(farmRefs.length, 5, 'all four MELODY source sheets and unknown-farm row remain visible');
  assert.deepEqual(farmRefs.map(ref => ref.rawCost).sort((a,b)=>a-b), [8641.4405,9796.8234,9993.8277,10886.0779,11450.6709]);
  assert.equal(new Set(farmRefs.map(ref => ref.referenceKey)).size, 5, 'same-week references have stable distinct React keys');
  assert(farmRefs.every(ref => ref.referenceKey === `arrival:${ref.arrivalLineKey}`));
  assert.equal(JSON.stringify(farmRows), farmSnapshot, 'source data is read-only');
  assert.deepEqual(buildRaumPnlArrivalReferences(waxItem, [...farmRows].reverse(), 39, '2026')[7738], farmRefs, 'output order is stable across DB row order');
  const duplicatedSource = buildRaumPnlArrivalReferences(waxItem, [...farmRows, { ...farmRows[0], ArrivalLineKey: 99999, OrderWeek: '040-01' }], 39, '2026')[7738];
  assert.equal(duplicatedSource.length, 5, 'exact duplicate source with padded week counts once');
  assert(duplicatedSource.some(ref=>ref.referenceKey==='arrival:42946'), 'duplicate chooses stable lower DB key');
  const unknownSources = buildRaumPnlArrivalReferences(waxItem, [
    { ...farmRows[4], ArrivalLineKey: 43347, SourceRow: 62 }, farmRows[4],
    { ...waxRow, ArrivalLineKey: 50000, FarmNameRaw: '' },
    { ...waxRow, ArrivalLineKey: 50001, FarmNameRaw: '' },
  ], 39, '2026')[7738];
  assert.equal(unknownSources.length, 4, 'unknown farms retain separate source locations and unlocated DB lines');
  const differentFarm = buildRaumPnlArrivalReferences(waxItem, [farmRows[0], { ...farmRows[0], ArrivalLineKey: 88888, FarmNameRaw: 'OTHER' }],39,'2026')[7738];
  assert.equal(differentFarm.length, 2, 'identical cost and source labels never collapse different farms');
  const fallbackFarm = buildRaumPnlArrivalReferences(waxItem, farmRows.map(row=>({...row,OrderWeek:'38-1'})),39,'2026')[7738];
  assert.equal(fallbackFarm.length, 5, 'latest-prior references also preserve all farm/source prices');
  assert(fallbackFarm.every(ref=>ref.isFallback));
  const noDbKey = buildRaumPnlArrivalReferences(waxItem,[{...farmRows[0],ArrivalLineKey:null}],39,'2026')[7738][0];
  assert(noDbKey.referenceKey.startsWith('source:'), 'fixtures/import previews without DB key have deterministic composite key');
  const yearBoundary = buildRaumPnlArrivalReferences(waxItem, [
    { ...waxRow, OrderYear: '2027', OrderWeek: '01-1' },
    { ...waxRow, OrderWeek: '52-2' },
  ], 53, '2026')[7738];
  assert.deepEqual(yearBoundary.map(ref => ref.week), ['52-2'], 'year boundary never wraps into the next year');
  const aliases = buildRaumPnlArrivalReferences([
    { itemKey: 21, prodKey: 456, unit: '대' },
    { itemKey: 22, prodKey: 456, unit: 'st' },
    { itemKey: 23, prodKey: 456, unit: '묶음' },
  ], rows, 37);
  assert.equal(aliases[21][0].cost, 100, '대 is one stem, not one bunch');
  assert.equal(aliases[22][0].cost, 100);
  const sourceUnit = buildRaumPnlArrivalReferences([{itemKey: 21, prodKey: 456, unit: '대'}], [{OrderWeek:'37-1',ProdKey:456,ArrivalUnit:'단',SelectedArrivalCostKRW:1846,SourceStemsPerBunch:1,SteamOf1Bunch:0}],37);
  assert.equal(sourceUnit[21][0].cost,1846, 'original workbook explicitly says one stem per bunch; never changes Product');
  const sourceFive = buildRaumPnlArrivalReferences([{itemKey: 21, prodKey:456,unit:'st'}],[{OrderWeek:'37-1',ProdKey:456,ArrivalUnit:'단',SelectedArrivalCostKRW:5000,SourceStemsPerBunch:5,SteamOf1Bunch:10}],37);
  assert.equal(sourceFive[21][0].cost,1000,'original bundle size controls original cost, not a different catalog pack');
  const bundleRows = [{OrderWeek:'37-02',ProdKey:3170,ArrivalUnit:'단',SelectedArrivalCostKRW:3470,SourceStemsPerBunch:1,SteamOf1Bunch:5}];
  const bundle = buildRaumPnlArrivalReferences([{itemKey:31,prodKey:3170,unit:'단-5스팀'}],bundleRows,37);
  assert.equal(bundle[31][0].cost,17350,'Aisha source bundle is one stem; hotel bundle is five');
  assert.equal(bundle[31][0].rawCost,3470,'source price is preserved');
  assert.equal(bundle[31][0].unit,'단-5스팀','original target label is preserved');
  const duplicateWeek = buildRaumPnlArrivalReferences([{itemKey:31,prodKey:3170,unit:'단-10스팀'}],[...bundleRows,{...bundleRows[0],OrderWeek:'37-2'}],37);
  assert.equal(duplicateWeek[31].length,1,'padded and unpadded subweeks are one reference');
  assert.equal(duplicateWeek[31][0].cost,34700);
  for (const unit of ['단-0스팀','단-5~10스팀','단-5스팀?']) {
    assert.equal(buildRaumPnlArrivalReferences([{itemKey:31,prodKey:3170,unit}],bundleRows,37)[31][0].cost,null);
  }
  assert.equal(buildRaumPnlArrivalReferences([{itemKey:31,prodKey:3170,unit:'단-5스팀'}],[{...bundleRows[0],SourceStemsPerBunch:null,SteamOf1Bunch:0}],37)[31][0].cost,null,'missing source pack metadata must not assume one stem');
  const fxUnit = buildRaumPnlArrivalReferences([{itemKey:21,prodKey:456,unit:'단'}],[{OrderWeek:'37-1',ProdKey:456,ArrivalUnit:'단',SelectedArrivalCostKRW:5000,SourceStemsPerBunch:5,SourceCostPerStem:1000,AllocationBasis:'SOURCE'}],37);
  assert.equal(fxUnit[21][0].fxExpenseFactor,5,'per-stem fixed expenses scale to the original bunch unit');
  assert.equal(sourceFive[21][0].fxExpenseFactor,null,'unverified expense unit must not be guessed');
  assert.match(aliases[23][0].conversionError, /환산 확인 필요/);
  assert.equal(aliases[23][0].cost, null, 'unknown units never silently become an empty source or 0 cost');
  const { withHotelArrivalReferences } = await import('../lib/raumPnlArrivalReference.js');
  const batch = await withHotelArrivalReferences([{itemKey: 10, prodKey: 456, unit: '단', major: 37}, {itemKey: 11, prodKey: 456, unit: '단', major: 36}], '2026', async (query, params) => {
    assert.equal(params.yr.value, '2026');
    assert.equal(params.major.value, 37);
    return {recordset: [...rows, ...fallbackRows]};
  });
  assert.equal(batch[0].arrivalReferences[0].sourceMajor, 37);
  assert.equal(batch[1].arrivalReferences[0].sourceMajor, 36);
  assert.deepEqual(batch[1].arrivalReferences.map(ref => ref.week), ['36-1', '36-2', '37-1'], 'batched smaller majors apply their own exact next-first window');
  const failed = await withHotelArrivalReferences([{ itemKey: 10, prodKey: 456, major: 37 }], '2026', async () => {throw Error('offline');});
  assert.match(failed[0].arrivalReferenceError, /조회 실패/);
  const fx = await import('../lib/arrivalCostFxPreview.js');
  const preview = fx.recalcArrivalCostWithFx({selectedArrivalCostKRW: 1700, exchangeRate: 1500, customsPerUnitKRW: 100, otherPerUnitKRW: 100}, 1450);
  assert.equal(preview.cost, 1650, 'fixed KRW charges stay fixed');

  let captured = null;
  const loaded = await loadRaumPnlArrivalReferences({ orderYear: '2026', major: 37, items }, async (sqlText, params) => {
    captured = { sqlText, params };
    return { recordset: rows };
  });
  assert.deepEqual(loaded[10].map(row => row.week), ['37-1', '37-2', '37-2']);
  assert.match(captured.sqlText, /l\.ArrivalLineKey/);
  assert.match(captured.sqlText, /l\.OrderYear=@yr/);
  assert.match(captured.sqlText, /TRY_CONVERT\(INT, LEFT\(l\.OrderWeek[\s\S]*<=@major/);
  assert.match(captured.sqlText, /=@major\+1[\s\S]*TRY_CONVERT\(INT,SUBSTRING\(l\.OrderWeek,CHARINDEX\(N'-',l\.OrderWeek\)\+1,20\)\)=1/);
  assert.doesNotMatch(captured.sqlText, /TOP\s+1/i);
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
  assert.match(page, /이전 최신 차수/);
  assert.doesNotMatch(page, /if \(!detail \|\| isShilla\)/, 'Shilla also reads stored history');
  const component = fs.readFileSync(path.join(__dirname, '../components/raum/HotelArrivalCostReference.js'), 'utf8');
  assert.match(component, /환율로 원가 비교/);
  assert.doesNotMatch(component, /fetch\(|onSave|method:\s*['"]POST/, 'FX is a browser-only comparison');
  const hotelApi = fs.readFileSync(path.join(__dirname, '../pages/api/raum/hotel-purchase-costs.js'), 'utf8');
  assert.match(hotelApi, /requirePnlPartner/);
  assert.match(hotelApi, /\['raum', 'choimun'\]\.includes\(partner\.code\)/, 'shared partners cannot bypass the shared write contract');
  assert.match(hotelApi, /saveRaumPnlPurchaseCosts\(\{[\s\S]*partnerCode: partner\.code/, 'server-validated hotel code scopes the isolated save');
  assert.doesNotMatch(hotelApi, /WebRaumCostPrice|OrderDetail|ShipmentDetail|StockHistory/, 'isolated API cannot add ERP/global-cost writes');
  console.log('Hotel P&L current plus next-first, latest-prior fallback and year-isolated web-only arrival reference tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
