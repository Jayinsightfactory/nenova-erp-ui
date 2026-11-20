import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCorrectionPlan, normalizedCorrection} from '../lib/warehouseCorrectionPolicy.js';
import {writeApprovalReceiptPrice} from '../lib/incomingApprovalLinkedWriter.js';

const header={WarehouseKey:1,OrderYear:'2026',OrderWeek:'44-03',FarmName:'연습 농장',isDeleted:0};
const rows=[
  {WarehouseKey:1,WdetailKey:11,ProdKey:7,OrderCode:'1',OutQuantity:600,SteamQuantity:600,UPrice:230,TPrice:138000},
  {WarehouseKey:1,WdetailKey:12,ProdKey:8,OrderCode:'2',OutQuantity:4,UPrice:50,TPrice:200},
];
const products=[{ProdKey:7,ProdName:'호접',OutUnit:'송이',isDeleted:0}];
const request={warehouseKey:1,orderYear:'2026',orderWeek:'44-03',farmName:'연습 농장',mode:'REPLACE',editKind:'PRICE',
  price:{sourceWdetailKey:11,expectedUnitPrice:230,unitPrice:23}};
const build=(input, before=rows)=>buildCorrectionPlan(normalizedCorrection(input),header,before,products);

test('price-only change keeps the selected original row and derives its total',async()=>{
  const plan=build(request);
  assert.deepEqual(plan.after,[{...rows[0],UPrice:23,TPrice:13800},rows[1]]);
  assert.deepEqual(plan.keys,[7]);
  assert.equal(plan.changes[0].delta,0);
  const statements=[];
  const after=await writeApprovalReceiptPrice(async(sql,params)=>statements.push({sql,params}),{Int:'int',Float:'float'},request,plan);
  assert.equal(statements.length,1);
  assert.match(statements[0].sql,/SET UPrice=@price,TPrice=@total/);
  assert.match(statements[0].sql,/WdetailKey=@key AND WarehouseKey=@wk AND ProdKey=@product AND UPrice=@expected/);
  assert.equal(after[1].WdetailKey,12);
});

test('price-only change rejects stale price, farm changes, a different total basis, and unmapped legacy rows',()=>{
  assert.throws(()=>build({...request,price:{...request.price,expectedUnitPrice:229}}),{code:'CORRECTION_PRICE_STALE'});
  assert.throws(()=>build({...request,farmName:'다른 농장'}),{code:'CORRECTION_EDIT_SCOPE'});
  assert.throws(()=>build(request,[{...rows[0],TPrice:100},rows[1]]),{code:'CORRECTION_PRICE_BASIS'});
  assert.throws(()=>build(request,[rows[0],{...rows[1],ProdKey:null}]),{code:'CORRECTION_OLD_DETAILS_INVALID'});
  assert.throws(()=>normalizedCorrection({...request,items:[]}),{code:'CORRECTION_EDIT_SCOPE'});
});
