const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    parseWarehousePackingGrid,
    parseWarehousePackingWorkbook,
    prepareExactProductMatches,
    decideWarehousePackingImport,
  } = await import('../lib/warehousePackingImport.js');

  const grid = Array.from({ length: 9 }, () => []);
  grid[1][2] = 'CLOUD';
  grid[1][6] = '33-01';
  grid[1][10] = 'INV-33';
  grid[2][2] = 'AWB-100';
  grid[2][6] = '2026/08/17';
  Object.assign(grid[4], {
    0: 'COD', 1: 'VARIETY NAME', 4: 'SIZE', 5: 'BOX',
    8: 'TOTAL\nBUNCH', 9: 'TOTALSTEAM', 11: 'T.PRICE',
  });
  Object.assign(grid[5], {
    0: 'C-01', 1: 'CARNATION Doncel', 4: '60cm', 5: 2,
    6: 20, 7: 200, 8: 40, 9: 400, 10: 0.15, 11: 60,
  });
  Object.assign(grid[6], { 0: 'TOTAL', 1: 'ignored', 5: 2 });

  const parsed = parseWarehousePackingGrid(grid);
  assert.deepEqual(parsed.meta, {
    farmName: 'CLOUD', orderWeek: '33-01', invoiceNo: 'INV-33',
    awb: 'AWB-100', orderNo: 'AWB-100', inputDate: '2026/08/17', orderYear: '2026',
  });
  assert.deepEqual(parsed.rows, [{
    prodName: 'CARNATION Doncel 60cm', orderCode: 'C-01', boxQty: 2,
    steamOf1Bunch: 20, steamOf1Box: 200, bunchQty: 40, steamQty: 400,
    unitPrice: 0.15, totalPrice: 60,
  }]);

  const fakeXlsx = {
    read(buffer, options) {
      assert.equal(buffer, 'buffer');
      assert.deepEqual(options, { type: 'array', cellDates: true });
      return { SheetNames: ['PACKING'], Sheets: { PACKING: { grid } } };
    },
    utils: { sheet_to_json(sheet, options) {
      assert.deepEqual(options, { header: 1, defval: '', raw: true });
      return sheet.grid;
    } },
  };
  assert.equal(parseWarehousePackingWorkbook('buffer', fakeXlsx).rows[0].orderCode, 'C-01');

  const product2026 = { ProdKey: 101, ProdName: 'carnation doncel 60cm', isDeleted: 0 };
  const exact = prepareExactProductMatches(parsed.rows, [product2026]);
  assert.equal(exact.ok, true);
  assert.equal(exact.items[0].prodKey, 101);

  const unmatched = prepareExactProductMatches(parsed.rows, [
    { ProdKey: 102, ProdName: 'CARNATION Doncel', isDeleted: 0 },
  ]);
  assert.equal(unmatched.ok, false);
  assert.deepEqual(unmatched.items, [], '한 품목이라도 실패하면 성공 품목도 저장 후보로 내보내지 않는다.');
  assert.equal(unmatched.errors[0].reason, 'UNREGISTERED_PRODUCT');

  const ambiguous = prepareExactProductMatches(parsed.rows, [product2026, { ...product2026, ProdKey: 999 }]);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.errors[0].reason, 'AMBIGUOUS_PRODUCT');

  assert.equal(decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '2026', orderWeek: '33-01',
  }).ok, true);
  assert.equal(decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '', orderWeek: '33-01',
  }).errors[0].reason, 'YEAR_WEEK_REQUIRED');

  // 전년도 동일 차수의 원장은 품목 매칭이나 현재 업로드 업무키를 바꾸지 않는다.
  const priorYearSameWeek = { orderYear: '2025', orderWeek: '33-01', warehouseKey: 1 };
  const current = decideWarehousePackingImport({
    rows: parsed.rows, products: [product2026], orderYear: '2026', orderWeek: priorYearSameWeek.orderWeek,
  });
  assert.equal(current.orderYear, '2026');
  assert.equal(current.orderWeek, '33-01');

  const badHeader = grid.map((row) => [...row]);
  badHeader[4][9] = 'TOTAL STEMS';
  assert.throws(() => parseWarehousePackingGrid(badHeader), /TOTALSTEAM/);

  const badNumber = grid.map((row) => [...row]);
  badNumber[5][5] = 'two';
  assert.throws(() => parseWarehousePackingGrid(badNumber), /BOX 값이 숫자가 아닙니다/);

  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages/api/warehouse/index.js'), 'utf8');
  assert.doesNotMatch(apiSource, /TempWarehouseDetail/, '신규 Excel 업로드는 EXE의 공용 staging을 변경하지 않는다');
  assert.match(apiSource, /nextInvoiceWarehouseKey\(tQuery/);
  assert.match(apiSource, /insertInvoiceWarehouseDetail\(tQuery/);
  assert.match(apiSource, /applyInvoiceWarehouseStockDelta\(tQuery/);
  assert.match(apiSource, /calculateInvoiceStock\(tQuery/);
  assert.match(apiSource, /map\(Number\)\.filter\(\(key\) => Number\.isInteger\(key\) && key >= 0\)/,
    'ProdKey=0 전체 재계산을 제거하면 안 된다.');
  assert.match(apiSource, /IF ISNULL\(@r,-1\)<>0 THROW 51001/,
    '재고계산 실패는 같은 트랜잭션 전체를 롤백해야 한다.');
  assert.doesNotMatch(apiSource, /INSERT INTO WarehouseDetail/);
  assert.doesNotMatch(apiSource, /INSERT INTO StockHistory/);

  const { resolveReceiptBunch } = await import('../lib/receiptBunchQuantity.js');
  const { WAREHOUSE_WEIGHT_ROW_SQL } = await import('../lib/warehouseWeightRows.js');
  const manualPolicy = await import('../lib/manualWarehouseUpload.js');
  const manualDb = await import('../lib/manualWarehouseUploadDb.js');
  const farmPolicy = await import('../lib/warehouseFarmChoices.js');
  const roundPolicy = await import('../lib/incomingRoundLabel.js');
  const detailActions = await import('../lib/warehouseDetailActions.js');
  const approvalPolicy = await import('../lib/incomingApprovalPolicy.js');
  const babel = require('next/dist/compiled/babel/core');
  const compiled = babel.transformSync(apiSource, {
    plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
    configFile:false,babelrc:false,
  }).code;
  const out = {exports:{}};
  const product = {ProdKey:670,CountryFlower:1,OutUnit:'박스',EstUnit:'단'};
  const transactionSql = [];
  const transactionArgs = [];
  const stored = [];
  const stock = [];
  let replaceUnit = false;
  let fixed = false;
  let applied = null;
  let allowWarehouse = true;
  const database = {
    sql:new Proxy({},{get:(_,key)=>key}),
    query:async statement=>{
      if (statement.includes('FROM dbo.StockMaster')) return {recordset:[
        {OrderYear:'2026',OrderWeek:'47-01'},{OrderYear:'2027',OrderWeek:'47-01'},
      ]};
      if (statement.includes('FROM dbo.Farm f')) return {recordset:[{FarmKey:10,FarmName:'등록 농장'}]};
      return {recordset:statement.includes('SELECT DISTINCT p.CountryFlower')?(fixed?[product]:[]):[product]};
    },
    withTransaction:async callback=>callback(async (statement,params)=>{
      transactionSql.push(statement); transactionArgs.push({statement,params});
      if (statement.includes('INSERT INTO WarehouseMaster')) return {recordset:[{WarehouseKey:9001}]};
      if (statement.includes('SELECT WdetailKey,ProdKey')) return {recordset:stored};
      if (statement.includes('SELECT DISTINCT p.CountryFlower')) return {recordset:fixed?[product]:[]};
      return {recordset: [replaceUnit ? {...product,ProdKey:999} : product]};
    }),
  };
  const mocks = {
    '../../../lib/db':database, '../../../lib/auth':{withAuth:handler=>handler},
    '../../../lib/withActionLog.js':{withActionLog:handler=>handler},
    '../../../lib/exeParity/common.js':{}, '../../../lib/exeWarehouseViewSql.js':{},
    '../../../lib/invoiceReceiptNative.js':{
      acquireInvoiceReceiptGate:async()=>({}), nextInvoiceWarehouseKey:async()=>9001,
      insertInvoiceWarehouseDetail:async (_,p)=>{
        const key=100+stored.length;
        stored.push({WdetailKey:key,ProdKey:p.pk.value,BoxQuantity:p.box.value,BunchQuantity:p.bunch.value,
          SteamQuantity:p.steam.value,OutQuantity:p.oq.value,EstQuantity:p.eq.value,UPrice:p.up.value,TPrice:p.tp.value});
        return key;
      },
      applyInvoiceWarehouseStockDelta:async(_,p)=>stock.push(p.delta.value),
      calculateInvoiceStock:async()=>{applied=9001;},
    },
    '../../../lib/invoiceReceiptAccess.js':{canManageInvoiceReceipt:()=>allowWarehouse},
    '../../../lib/receiptBunchQuantity.js':{resolveReceiptBunch},
    '../../../lib/warehouseWeightRows.js':{WAREHOUSE_WEIGHT_ROW_SQL},
    '../../../lib/manualWarehouseUpload.js':manualPolicy,
    '../../../lib/manualWarehouseUploadDb.js':{
      readManualWarehouseAttempt:async(_,__,meta,items)=>({fileName:manualDb.manualWarehouseFileName(meta,items),replay:applied}),
      assertManualWarehouseEligible:async()=>{},
    },
    '../../../lib/warehouseFarmChoices.js':farmPolicy,
    '../../../lib/incomingRoundLabel.js':roundPolicy,
    '../../../lib/warehouseDetailActions.js':detailActions,
    '../../../lib/incomingApprovalPolicy.js':approvalPolicy,
  };
  new Function('require','module','exports',compiled)(key=>mocks[key],out,out.exports);
  const handler=out.exports.default;
  const legacyBody={orderYear:'2026',orderWeek:'47-01',inputDate:'2026-11-20',
    items:[{prodName:'Douglas Fir',boxQty:150,steamQty:30000,bunchQty:null}]};
  const run=async body=>{
    const response={status(code){this.code=code;return this;},json(value){this.result=value;return this;}};
    await handler({method:'POST',body,user:{userId:'test'}},response);
    return response;
  };
  assert.equal((await run({...legacyBody,previewOnly:true})).code,400);
  assert.equal((await run(legacyBody)).code,400);
  assert.deepEqual(transactionSql,[]);
  const automatic = await run({...legacyBody,previewOnly:true,items:[{...legacyBody.items[0],steamOf1Bunch:10}]});
  assert.equal(automatic.code,200);
  assert.deepEqual(automatic.result.bunchQuantities,[3000]);
  const corrected={...legacyBody,items:[{...legacyBody.items[0],bunchQty:3000}]};
  assert.equal((await run({...corrected,previewOnly:true})).code,200);
  assert.deepEqual(transactionSql,[]);
  replaceUnit=true;
  assert.equal((await run(corrected)).code,400);
  assert.equal(transactionSql.length,1);
  assert.match(transactionSql[0], /UPDLOCK,HOLDLOCK/);

  replaceUnit = false;
  transactionSql.length = 0;
  const manualLine = {prodKey:670,prodName:'Douglas Fir',expectedOutUnit:'박스',expectedEstUnit:'단',
    quantity:'2',quantityUnit:'박스',stemsPerBox:'100',stemsPerBunch:'10',amountMode:'total',amount:'25'};
  const manualBody = {source:'manual',orderYear:'2026',orderWeek:'47-01',inputDate:'2026-11-20',farmName:'등록 농장',
    invoiceNo:'',awb:'',operationId:'58442b74-c6b2-4c7c-9e65-64e3f8162215',items:[manualLine,{...manualLine,amount:'0'}]};
  const optionsResponse={status(code){this.code=code;return this;},json(value){this.result=value;return this;}};
  await handler({method:'GET',query:{manualOptions:'1'},user:{userId:'test'}},optionsResponse);
  assert.equal(optionsResponse.code,200);
  assert.deepEqual(optionsResponse.result.periods.map(period=>period.OrderYear),['2026','2027']);
  assert.deepEqual(transactionSql,[]);
  allowWarehouse=false;
  assert.equal((await run({...manualBody,previewOnly:true})).code,403);
  await handler({method:'GET',query:{manualOptions:'1'},user:{userId:'test'}},optionsResponse);
  assert.equal(optionsResponse.code,403);
  allowWarehouse=true;
  const shaped = manualPolicy.manualWarehouseLine(manualLine,product);
  assert.equal(shaped.unitPrice,0.125);
  assert.equal(shaped.steamQty,200);
  assert.equal(shaped.estQuantity,20);
  assert.equal(shaped.outQuantity,2);
  assert.equal(manualPolicy.manualWarehouseLine({...manualLine,amountMode:'perStem',amount:'0.125'},product).totalPrice,25);
  for (const patch of [{amount:''},{amount:'-2'},{quantity:'0'},{stemsPerBox:''},{stemsPerBunch:'30'},{expectedOutUnit:'단'}]) {
    assert.throws(()=>manualPolicy.manualWarehouseLine({...manualLine,...patch},product),/./);
  }
  assert.throws(()=>manualPolicy.manualWarehouseHeader({...manualBody,inputDate:'2026-02-31'}),/실제 입고일/);
  fixed = true;
  assert.equal((await run({...manualBody,previewOnly:true})).code,409);
  fixed = false;
  const manualPreview = await run({...manualBody,previewOnly:true});
  assert.equal(manualPreview.code,200);
  assert.deepEqual(manualPreview.result.manualPreview.map(row=>row.totalPrice),[25,0]);
  assert.deepEqual(transactionSql,[]);
  assert.equal((await run({...manualBody,previewToken:'changed'})).code,409);
  assert.deepEqual(transactionSql,[]);
  const commit = {...manualBody,previewToken:manualPreview.result.previewToken};
  assert.equal((await run(commit)).code,201);
  assert.deepEqual(stored.map(row=>[row.SteamQuantity,row.OutQuantity,row.EstQuantity,row.UPrice,row.TPrice]),[[200,2,20,.125,25],[200,2,20,0,0]]);
  assert.deepEqual(stock,[4]);
  const replay = await run(commit);
  assert.equal(replay.code,200);
  assert.equal(replay.result.warehouseKey,9001);
  assert.equal(stored.length,2);

  const meta=manualPolicy.manualWarehouseHeader(manualBody);
  const attempts=[];
  const readAttempt=async (statement,params)=>{
    attempts.push({statement,params});return {recordset:[{WarehouseKey:9001,FileName:manualDb.manualWarehouseFileName(meta,[shaped]),isDeleted:false,CreateID:'test'}]};
  };
  assert.equal((await manualDb.readManualWarehouseAttempt(readAttempt,database.sql,meta,[shaped],'test')).replay,9001);
  await assert.rejects(manualDb.readManualWarehouseAttempt(readAttempt,database.sql,{...meta,orderYear:'2025'},[shaped],'test'),{code:'WAREHOUSE_MANUAL_RETRY_CONFLICT'});
  assert.match(attempts[0].statement,/WHERE LEFT\(FileName,LEN\(@filePrefix\)\)=@filePrefix/);
  assert.throws(()=>manualPolicy.manualWarehouseHeader({...manualBody,orderYear:'2025'}),/2026년 이전/);
  const currentDoc = { year:'2026', week:'47-01', invoice:'RUN-1' };
  const priorDoc = {...currentDoc,year:'2025'};
  const sourceQuery = ({farms=[{FarmKey:10,FarmName:'등록 농장'}],docs=[],blockers=[]}={}) => async (statement,params) => {
    if (statement.includes('manual-warehouse:linked-or-duplicate')) {
      assert.match(statement,/OrderYear=@year AND OrderWeek=@week/g);
      return {recordset:docs.filter(doc=>doc.year===params.year.value&&doc.week===params.week.value&&doc.invoice===params.invoice.value)};
    }
    if (statement.includes('FROM dbo.Farm f')) {
      assert.doesNotMatch(statement,/dbo.WarehouseMaster/);
      return {recordset:farms};
    }
    return {recordsets:[[{ProdKey:670,ProdName:'Douglas Fir',CountryFlower:'FIR',isDeleted:0}],
      [{CurrentYearWeek:'20264701',PreviousYearWeek:'20254601',NextYearWeek:'20264702'}],blockers]};
  };
  const invoiceMeta={...meta,invoiceNo:'RUN-1'};
  const scoped=[{...shaped,prodKey:670}];
  await manualDb.assertManualWarehouseEligible(sourceQuery({docs:[priorDoc]}),database.sql,invoiceMeta,scoped,true);
  await assert.rejects(manualDb.assertManualWarehouseEligible(sourceQuery({docs:[currentDoc]}),database.sql,invoiceMeta,scoped,true),{code:'DUPLICATE_INVOICE'});
  await assert.rejects(manualDb.assertManualWarehouseEligible(sourceQuery({farms:[]}),database.sql,invoiceMeta,scoped),{code:'WAREHOUSE_MANUAL_FARM_CHANGED'});
  await assert.rejects(manualDb.assertManualWarehouseEligible(sourceQuery({blockers:[
    {Phase:'CURRENT_FIXED',OrderYearWeek:'20264701',CountryFlower:'FIR',ProdKey:670,ProdName:'Douglas Fir'},
  ]}),database.sql,invoiceMeta,scoped),{code:'NATIVE_ELIGIBILITY_BLOCKED'});
  stored.length=0;
  transactionArgs.length=0;
  const suffixUpload={...corrected,orderWeek:'47-01.B'};
  assert.equal((await run(suffixUpload)).code,201);
  const masterWrite=transactionArgs.find(item=>item.statement.includes('INSERT INTO WarehouseMaster'));
  const labelWrite=transactionArgs.find(item=>item.statement.includes('correction:round-audit'));
  assert.equal(masterWrite.params.week.value,'47-01');
  assert.deepEqual(JSON.parse(labelWrite.params.payload.value),{
    warehouseKey:9001,orderYear:'2026',orderWeek:'47-01',before:'',after:'B',source:'PACKING_UPLOAD',
  });
  assert(transactionArgs.indexOf(labelWrite)>transactionArgs.indexOf(masterWrite));
  console.log('warehouse packing import parser/policy tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
