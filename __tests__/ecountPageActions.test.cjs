'use strict';
const assert=require('node:assert/strict');
const h=require('../lib/ecountPageActions.cjs');
assert.equal(h.compareDecimal('999999999999999999999999.00000001','999999999999999999999999.00000002'),-1);
assert.equal(h.compareDecimal('-0.00000002','-0.00000001'),-1);
assert.equal(h.compareDecimal('-0.00000000','0'),0);
assert.equal(h.compareDecimal('1.25000000','1.25'),0);
assert.equal(h.compareDecimal(null,'0'),1);
assert.throws(()=>h.compareDecimal('1e6','0'),/INVALID_DECIMAL/);
assert.throws(()=>h.compareDecimal('9,999,999,999,999,999,999,999,999','0'),/INVALID_DECIMAL/);
assert.deepEqual(h.datePreset('yesterday','2026-01-01'),{from:'2025-12-31',to:'2025-12-31'});
assert.deepEqual(h.datePreset('previousMonth','2024-03-03'),{from:'2024-02-01',to:'2024-02-29'});
assert.deepEqual(h.datePreset('recent7','2026-01-03'),{from:'2025-12-28',to:'2026-01-03'});
assert.deepEqual(h.datePreset('thisWeek','2026-01-04',{weekStartsOn:1}),{from:'2025-12-29',to:'2026-01-04'});
assert.deepEqual(h.datePreset('previousWeek','2026-01-04',{weekStartsOn:0}),{from:'2025-12-28',to:'2026-01-03'});
// E040207 source observation: this-week button sets Sunday through today and submits (UI owns submit).
assert.deepEqual(h.datePreset('thisWeek','2026-10-20',{weekStartsOn:0}),{from:'2026-10-18',to:'2026-10-20'});
assert.throws(()=>h.datePreset('thisWeek','2026-01-04'),/WEEK_START_REQUIRED/);
assert.throws(()=>h.datePreset('endDate','2026-01-04'),/UNVERIFIED_PRESET/);
assert.throws(()=>h.datePreset('today','2026-02-30'),/INVALID_DATE/);
const original={from:'2026-01-01',nested:{flow:'all'}};const reset=h.resetSearch(original);reset.nested.flow='in';assert.equal(original.nested.flow,'all');
assert.equal(h.keyboardAction({key:'F3'}),'open-search');assert.equal(h.keyboardAction({key:'F8'}),'run-search');assert.equal(h.keyboardAction({key:'F8',ctrlKey:true}),null);assert.equal(h.keyboardAction({key:'Enter'}),null);
const rows=[{amount:'999999999999999999.00000002',balance:'10',refDate:'2026/01/02 오전  1:00:00',flow:'입금',account:'PRIVATE'},{amount:'999999999999999999.00000001',balance:'20',refDate:'2025/12/31 오전  1:00:00',flow:'출금'},{amount:'0',balance:'0',refDate:null,flow:'입금'},{amount:'-0.00000001',balance:'0',refDate:'2026-01-01',flow:'in'},{amount:'0',balance:null,refDate:'2026-01-01',flow:'in'}];
const saved=JSON.stringify(rows);
const sorted=h.filterSortRows({dataset:'cash',rows,sortKey:'amount'});assert.deepEqual(sorted.rows.map(r=>r.rowNumber),[4,3,5,2,1]);assert.equal(JSON.stringify(rows),saved);assert(!JSON.stringify(sorted).includes('PRIVATE'));
const desc=h.filterSortRows({dataset:'cash',rows,sortKey:'balance',direction:'desc'});assert.equal(desc.rows.at(-1).balance,null);
const ranged=h.filterSortRows({dataset:'cash',rows,from:'2026-01-01',to:'2026-01-02',flow:'in'});assert.equal(ranged.rows.length,3);assert.equal(ranged.unknownDateCount,1);
const exact=h.filterSortRows({dataset:'cash',rows,numericFilter:{key:'amount',min:'999999999999999999.00000001',max:'999999999999999999.00000001'}});assert.equal(exact.rows.length,1);assert.equal(exact.rows[0].rowNumber,2);
const quote=h.filterSortRows({dataset:'quote',rows:[{estimateTotal:'2.00000001',refDate:'2026/01/03 -12'},{estimateTotal:'2.00000000',refDate:'2025/01/03 -1'}],from:'2026-01-01',to:'2026-01-31',sortKey:'estimateTotal'});assert.equal(quote.rows.length,1);assert.equal(quote.rows[0].sourceDateLabel,'2026/01/03 -12');
const purchaseRows=[{amountTotal:'999999999999999999.00000002',foreignTotal:'2',exchangeRate:'1300',refDate:'2026/01/03 -2'},{amountTotal:'999999999999999999.00000001',foreignTotal:'1',exchangeRate:'1300',refDate:'2025/01/03 -1'},{amountTotal:'0',refDate:null}];
const purchase=h.filterSortRows({dataset:'purchase',rows:purchaseRows,from:'2026-01-01',to:'2026-01-31',sortKey:'amountTotal'});assert.equal(purchase.rows.length,1);assert.equal(purchase.unknownDateCount,1);assert.equal(purchase.rows[0].sourceDateLabel,'2026/01/03 -2');
assert.deepEqual(h.filterSortRows({dataset:'purchase',rows:purchaseRows,sortKey:'amountTotal'}).rows.map(r=>r.rowNumber),[3,2,1]);
const purchaseExact=h.filterSortRows({dataset:'purchase',rows:purchaseRows,numericFilter:{key:'amountTotal',min:'999999999999999999.00000001',max:'999999999999999999.00000001'}});assert.equal(purchaseExact.rows.length,1);assert.equal(purchaseExact.rows[0].rowNumber,2);
const purchaseModel=h.buildExportModel({dataset:'purchase',rows:purchase.rows,columns:[{key:'sourceDateLabel',label:'일자'},{key:'amountTotal',label:'금액'},{key:'custName',label:'거래처'}]});assert.equal(purchaseModel.rows[0][1],'999999999999999999.00000002');assert.equal(purchaseModel.rows[0][2],'');
const statusRows=[{qty:'1',total:'999999999999999999.00000002',refDate:'2026/01/03 -1'},{qty:'2',total:'999999999999999999.00000001',refDate:'2025/01/03 -1'},{qty:'0'}];
const statusFilter=h.filterSortRows({dataset:'buyStatus',rows:statusRows,from:'2026-01-01',to:'2026-01-31'});assert.equal(statusFilter.rows.length,1);assert.equal(statusFilter.unknownDateCount,1);
assert.deepEqual(h.filterSortRows({dataset:'buyStatus',rows:statusRows,sortKey:'total'}).rows.map(r=>r.rowNumber),[2,1,3]);
assert.equal(h.filterSortRows({dataset:'buyStatus',rows:statusRows,numericFilter:{key:'total',min:'999999999999999999.00000001',max:'999999999999999999.00000001'}}).rows[0].rowNumber,2);
const statusModel=h.buildExportModel({dataset:'buyStatus',rows:statusFilter.rows,columns:[{key:'sourceDateLabel',label:'일자'},{key:'total',label:'합계'},{key:'invoiceNumber',label:'인보이스'}]});assert.equal(statusModel.rows[0][1],'999999999999999999.00000002');assert.equal(statusModel.rows[0][2],'');
for(const [dataset,key] of [['buyTaxStat','supplyAmt'],['taxStat','supplyAmt'],['buyTax','supplyAmt'],['salesTax','supplyAmt'],['journal','amount'],['saleQuery','amount'],['poQuery','orderTotal'],['receipt','amount'],['payment','amount']]){const rows=[{[key]:'999999999999999999.00000002',refDate:'2026/01/03 -1'},{[key]:'999999999999999999.00000001',refDate:'2025/01/03 -1'},{[key]:'0'}];const dated=h.filterSortRows({dataset,rows,from:'2026-01-01',to:'2026-01-31'});assert.equal(dated.rows.length,1);assert.equal(dated.unknownDateCount,1);assert.deepEqual(h.filterSortRows({dataset,rows,sortKey:key}).rows.map(r=>r.rowNumber),[3,2,1]);assert.equal(h.filterSortRows({dataset,rows,numericFilter:{key,min:'999999999999999999.00000001',max:'999999999999999999.00000001'}}).rows[0].rowNumber,2);assert.throws(()=>h.filterSortRows({dataset,rows,quoteStatus:'completed'}),/INVALID_QUOTE_STATUS_FILTER/);}
assert.throws(()=>h.filterSortRows({dataset:'discount',rows:[],from:'2026-10-20',to:'2026-10-20'}),/DATE_FILTER_UNAVAILABLE/);
assert.equal(h.filterSortRows({dataset:'discount',rows:[]}).rows.length,0);
assert.throws(()=>h.filterSortRows({dataset:'buyDisc',rows:[],from:'2026-10-20'}),/DATE_FILTER_UNAVAILABLE/);assert.equal(h.filterSortRows({dataset:'buyDisc',rows:[]}).rows.length,0);
for(const dataset of ['unsold','unbought','orderQuery','orderStat','poStat']){assert.throws(()=>h.filterSortRows({dataset,rows:[],from:'2026-10-20'}),/DATE_FILTER_UNAVAILABLE/);assert.equal(h.filterSortRows({dataset,rows:[]}).rows.length,0);}
const stockRows=[{productCode:'A',quantity:'1.00000002'},{productCode:'B',quantity:'1.00000001'}];assert.deepEqual(h.filterSortRows({dataset:'stock',rows:stockRows,sortKey:'quantity'}).rows.map(r=>r.productCode),['B','A']);assert.throws(()=>h.filterSortRows({dataset:'stock',rows:stockRows,from:'2026-10-20'}),/DATE_FILTER_UNAVAILABLE/);const stockModel=h.buildExportModel({dataset:'stock',rows:stockRows,columns:[{key:'productCode',label:'품목코드'},{key:'prodName',label:'품목명'},{key:'quantity',label:'수량'}]});assert.deepEqual(stockModel.rows[0],['A','','1.00000002']);
const stockVersion={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:stockRows};assert.equal(h.selectStockSnapshot({version:stockVersion,asOf:'2026-10-20'}).available,true);assert.equal(h.selectStockSnapshot({version:stockVersion,asOf:'2025-10-20'}).available,false);assert.equal(h.selectStockSnapshot({version:{...stockVersion,periodTo:'2026-10-21'},asOf:'2026-10-20'}).available,false);assert.equal(h.selectStockSnapshot({version:null,asOf:'2026-10-20'}).reason,'no-version');assert.throws(()=>h.selectStockSnapshot({version:stockVersion,asOf:''}),/INVALID_SNAPSHOT_DATE/);assert.equal(h.selectStockSnapshot({version:{...stockVersion,rows:[]},asOf:'2026-10-20'}).available,true);
const stateRows=[...Array.from({length:3},(_,i)=>({estimateTotal:`2.0000000${i}`,refDate:'2026-01-03',quoteStatus:'in_progress',statusEvidence:i===2?'query_filter':'row_cell'})),{estimateTotal:'3.00000000',refDate:'2026-01-03'}];
const stateBefore=JSON.stringify(stateRows);
const progress=h.filterSortRows({dataset:'quote',rows:stateRows,quoteStatus:'in_progress'});
assert.equal(progress.rows.length,3);assert.equal(progress.unknownStatusCount,1);assert.equal(progress.excludedUnknownStatusCount,1);assert.equal(progress.statusCoverage,'partial');assert.equal(JSON.stringify(stateRows),stateBefore);
const allStatus=h.filterSortRows({dataset:'quote',rows:stateRows});assert.equal(allStatus.rows.length,4);assert.equal(allStatus.excludedUnknownStatusCount,0);
const unobserved=h.filterSortRows({dataset:'quote',rows:[stateRows[3]],quoteStatus:'in_progress'});assert.equal(unobserved.rows.length,0);assert.equal(unobserved.statusCoverage,'unknown');assert.equal(unobserved.excludedUnknownStatusCount,1);
const emptyStatus=h.filterSortRows({dataset:'quote',rows:[],quoteStatus:'in_progress'});assert.equal(emptyStatus.statusCoverage,'unknown');
// Synthetic mixed-status fixture; these counts do not establish source total/completeness.
const mixedStates=Array.from({length:17},(_,i)=>({estimateTotal:'1.00000000',refDate:'2026-01-03',quoteStatus:i<3?'in_progress':'completed',statusEvidence:'row_cell'}));
assert.equal(h.filterSortRows({dataset:'quote',rows:mixedStates}).rows.length,17);
const matchedProgress=h.filterSortRows({dataset:'quote',rows:mixedStates,quoteStatus:'in_progress'});assert.equal(matchedProgress.rows.length,3);assert.equal(matchedProgress.statusCoverage,'known');
const matchedCompleted=h.filterSortRows({dataset:'quote',rows:mixedStates,quoteStatus:'completed'});assert.equal(matchedCompleted.rows.length,14);assert.equal(matchedCompleted.unknownStatusCount,0);
const datedStatus=h.filterSortRows({dataset:'quote',rows:stateRows,from:'2025-01-01',to:'2025-01-31',quoteStatus:'in_progress'});assert.equal(datedStatus.rows.length,0);assert.equal(datedStatus.unknownStatusCount,1);assert.equal(datedStatus.excludedUnknownStatusCount,0);
assert.throws(()=>h.filterSortRows({dataset:'quote',rows:stateRows,quoteStatus:'done'}),/INVALID_QUOTE_STATUS_FILTER/);
assert.throws(()=>h.filterSortRows({dataset:'sales',rows:[],quoteStatus:'in_progress'}),/INVALID_QUOTE_STATUS_FILTER/);
assert.throws(()=>h.filterSortRows({dataset:'ar',rows:[{balance:'0'}],from:'2026-01-01'}),/DATE_FILTER_UNAVAILABLE/);
assert.throws(()=>h.filterSortRows({dataset:'cash',rows,sortKey:'account'}),/INVALID_SORT_KEY/);
assert.throws(()=>h.filterSortRows({dataset:'cash',rows,numericFilter:{key:'amount',min:'2',max:'1'}}),/INVALID_NUMERIC_RANGE/);
const model=h.buildExportModel({dataset:'cash',rows:sorted.rows,columns:[{key:'rowNumber',label:'번호'},{key:'amount',label:'금액'},{key:'account',label:'계좌번호'},{key:'sourceDateLabel',label:'일자'}],title:'조회'});
assert.equal(model.rows[0][0],4);assert.equal(model.rows[0][2],'');assert.equal(model.rows.at(-1)[1],'999999999999999999.00000002');assert.equal(model.sourceLayoutVerified,false);
const csv=h.toCsv(model);assert(csv.startsWith('\uFEFF'));assert(!csv.includes('PRIVATE'));assert(csv.includes("'-0.00000001"));
const attack={format:'safe-projection',columns:[{label:'=SUM(1)'}],rows:[['\t=HYPERLINK("x")'],['@formula'],['line\r\nquote"']]};const safeCsv=h.toCsv(attack);assert(safeCsv.includes("'=SUM(1)"));assert(safeCsv.includes("'\t=HYPERLINK"));assert(safeCsv.includes('quote""'));
console.log('PASS page actions: exact decimal bounds, cross-year presets, unknown dates, immutable filtering, source order, safe export, shortcuts/reset. Original preset/output parity remains unverified.');

const warehouseRows=[{productCode:'P1',warehouseCode:'W1',quantity:'999999999999999999.00000001'},{productCode:'P1',warehouseCode:'W2',quantity:'0.00000002'},{productCode:'P2',warehouseCode:'W2',quantity:'-0.5'}];
const whGrid=h.buildWarehouseStockGrid(warehouseRows);assert.deepEqual(whGrid.warehouseCodes,['W1','W2']);assert.equal(whGrid.rows[0].total,'999999999999999999.00000003');assert.equal(whGrid.rows[1].quantities.W1,null);assert.equal(whGrid.rows[1].total,'-0.5');assert.equal(whGrid.completeness,'unknown');assert.throws(()=>h.buildWarehouseStockGrid([...warehouseRows,warehouseRows[0]]),/DUPLICATE_WAREHOUSE_PRODUCT/);
assert.equal(h.selectStockSnapshot({dataset:'whStock',version:{periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:warehouseRows},asOf:'2026-10-20'}).rows.length,3);assert.equal(h.selectStockSnapshot({dataset:'whStock',version:{periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:warehouseRows},asOf:'2025-10-20'}).available,false);assert.throws(()=>h.selectStockSnapshot({dataset:'sales',asOf:'2026-10-20'}),/INVALID_SNAPSHOT_DATASET/);
assert.deepEqual(h.buildExportModel({dataset:'whStock',rows:[warehouseRows[0]],columns:[{key:'productCode',label:'코드'},{key:'warehouseCode',label:'창고'},{key:'quantity',label:'수량'},{key:'warehouseName',label:'이름'}]}).rows[0],['P1','W1','999999999999999999.00000001','']);
assert.equal(h.buildWarehouseStockGrid([{productCode:'__proto__',warehouseCode:'__proto__',quantity:'0'}]).rows[0].quantities.__proto__,'0');

const moveRows=[{productCode:'P-1',openingQuantity:'1.00000001',inQuantity:'0.00000002',outQuantity:'0',quantity:'1.00000003'}],moveVersion={periodFrom:'2026-10-01',periodTo:'2026-10-20',rows:moveRows};assert.equal(h.selectStockPeriod({version:moveVersion,from:'2026-10-01',to:'2026-10-20'}).available,true);assert.equal(h.selectStockPeriod({version:moveVersion,from:'2026-10-10',to:'2026-10-20'}).available,false);assert.equal(h.selectStockPeriod({version:moveVersion,from:'2025-10-01',to:'2025-10-20'}).available,false);assert.throws(()=>h.selectStockPeriod({version:moveVersion,from:'2026-10-21',to:'2026-10-20'}),/INVALID_SNAPSHOT_PERIOD/);assert.equal(h.selectStockPeriod({version:null,from:'2026-10-01',to:'2026-10-20'}).reason,'no-version');assert.throws(()=>h.filterSortRows({dataset:'stockMove',rows:moveRows,from:'2026-10-01'}),/DATE_FILTER_UNAVAILABLE/);

assert.equal(h.selectStockPeriod({dataset:'stkLedger',version:moveVersion,from:'2026-10-01',to:'2026-10-20'}).rows[0].quantity,'1.00000003');assert.equal(h.selectStockPeriod({dataset:'stkLedger',version:moveVersion,from:'2026-10-02',to:'2026-10-20'}).available,false);assert.equal(h.selectStockPeriod({dataset:'stkLedger',version:moveVersion,from:'2025-10-01',to:'2025-10-20'}).available,false);assert.throws(()=>h.selectStockPeriod({dataset:'sales',from:'2026-10-01',to:'2026-10-20'}),/INVALID_SNAPSHOT_DATASET/);assert.throws(()=>h.filterSortRows({dataset:'stkLedger',rows:moveRows,from:'2026-10-01'}),/DATE_FILTER_UNAVAILABLE/);

const balanceFixture={productCode:'P-1',monthLabels:[1,12,11,10],quantity:'1',currentMonthQuantity:'0',previousMonthQuantity:'1',twoMonthsAgoQuantity:'0',threeMonthsAgoQuantity:'0',otherQuantity:'0',unsoldQuantity:'0'},balanceVersion={periodFrom:'2026-01-01',periodTo:'2026-01-01',rows:[balanceFixture]};assert.deepEqual(h.selectStockSnapshot({dataset:'stkBalance',version:balanceVersion,asOf:'2026-01-01'}).rows[0].monthLabels,[1,12,11,10]);assert.equal(h.selectStockSnapshot({dataset:'stkBalance',version:balanceVersion,asOf:'2027-01-01'}).available,false);assert.throws(()=>h.filterSortRows({dataset:'stkBalance',rows:[balanceFixture],from:'2026-01-01'}),/DATE_FILTER_UNAVAILABLE/);

const bomVersion={periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:[{productCode:'P-1',quantity:'1.00000001',convertedQuantity:'0',upperResult:'empty_observed'}]};assert.equal(h.selectBomStockSnapshot({version:bomVersion,asOf:'2026-10-20',productCode:'P-1'}).upperResult,'empty_observed');for(const change of [{asOf:'2025-10-20'},{productCode:'P-2'}]){const result=h.selectBomStockSnapshot({version:bomVersion,asOf:'2026-10-20',productCode:'P-1',...change});assert.equal(result.available,false);assert.equal(result.upperResult,'uncollected');}assert.throws(()=>h.selectBomStockSnapshot({version:bomVersion,asOf:'2026-10-20',productCode:''}),/INVALID_PRODUCT_CODE/);assert.equal(h.selectBomStockSnapshot({version:null,asOf:'2026-10-20',productCode:'P-1'}).reason,'no-version');
