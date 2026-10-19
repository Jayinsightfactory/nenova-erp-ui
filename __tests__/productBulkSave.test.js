import assert from 'node:assert/strict';
import {saveProductBulk} from '../lib/productBulkSave.js';
import {productSnapshot} from '../lib/productBulkEdit.js';
const initial=[1,2].map(ProdKey=>({ProdKey,ProdName:`p${ProdKey}`,BunchOf1Box:10,SteamOf1Bunch:5,SteamOf1Box:50,BoxWeight:null,BoxCBM:0.1,TariffRate:0.25,Stock:20,Cost:100,OutUnit:'박스',EstUnit:'단',CounName:'NL',FlowerName:'rose'}));
const sql={Int:'int',Float:'float',Decimal:()=> 'decimal',NVarChar:()=> 'string',MAX:'max'};
const changes=initial.map(r=>({prodKey:r.ProdKey,expected:productSnapshot(r),values:{BoxWeight:0.125,TariffRate:0,BunchOf1Box:12}}));
async function run(mode){
  let committed=structuredClone(initial),logs=[];const working=structuredClone(committed),pending=[];
  const sentinel=[2025,2026].map(OrderYear=>({OrderYear,OrderWeek:'42-01',OrderDetail:10,ShipmentDetail:10,WarehouseDetail:20,Estimate:100,WebProfitReport:100,Stock:10}));
  const before=JSON.stringify(sentinel);
  const q=async(query,params)=>{
    assert.ok(!/UPDATE (?:Order|Shipment|Warehouse|Stock|Estimate)|usp_|CREATE|ALTER|DELETE/.test(query));
    if(query.startsWith('SELECT')){
      const row=working.find(r=>r.ProdKey===params.pk.value);
      if(mode==='missing'&&row.ProdKey===2)return {recordset:[]};
      if(mode==='stale'&&row.ProdKey===2&&query.includes('UPDLOCK'))row.BoxCBM=0.2;
      if(mode==='readback'&&!query.includes('UPDLOCK'))return {recordset:[{...row,BoxWeight:99}]};
      return {recordset:[{...row}]};
    }
    if(query.startsWith('UPDATE Product')){
      assert.ok(!/SET Stock|, Stock=/.test(query));
      Object.entries(params).filter(([k])=>!['pk','actor'].includes(k)).forEach(([k,v])=>working.find(r=>r.ProdKey===params.pk.value)[k]=v.value);
      return {rowsAffected:[1]};
    }
    if(query.startsWith('INSERT INTO SystemActionLog')){if(mode==='audit')throw Error('audit unavailable');pending.push(JSON.parse(params.payload.value));return {};}
    throw Error(query);
  };
  try{const result=await saveProductBulk(q,sql,changes,'tester');committed=working;logs=pending;assert.equal(result.length,2);assert.equal(mode,'ok');}catch(e){assert.notEqual(mode,'ok',e.message);}
  if(mode==='ok'){assert.equal(committed[0].BoxWeight,0.125);assert.equal(committed[0].SteamOf1Box,60);assert.equal(logs.length,1);assert.equal(logs[0].changes[0].before.BoxWeight,null);}
  else{assert.deepEqual(committed,initial);assert.equal(logs.length,0);}
  assert.equal(JSON.stringify(sentinel),before);
}
for(const mode of ['ok','stale','missing','readback','audit'])await run(mode);
console.log('productBulkSave: success, second-row conflict/missing, readback/audit rollback; protected/cross-year passed');
