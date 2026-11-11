const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
function load(file, deps = {}) {
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*;\s*$/gm, '').replace(/export default /g, 'return ').replace(/export /g, '');
  return new Function(...Object.keys(deps), source)(...Object.values(deps));
}
const accessSource = fs.readFileSync('lib/userAccess.js','utf8').replace(/export /g,'');
const userAccess = new Function(accessSource+';return {hasFullWebAccess,isAdminUser};')();
const canManageInvoiceReceipt = new Function(...Object.keys(userAccess),fs.readFileSync('lib/invoiceReceiptAccess.js','utf8').replace(/^import .*;\s*$/gm,'').replace(/export /g,'')+';return canManageInvoiceReceipt;')(...Object.values(userAccess));
function response(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(p){this.payload=p;return this;}};}
function fixture(year='2026', fixed=false) {
  const calls=[];let transactions=0;
  const query=async (q,p)=>{calls.push({q,p});if(q.includes('SELECT wm.OrderYear'))return {recordset:[{OrderYear:year,OrderWeek:'44-01',ProdKey:1,OutQuantity:10}]};if(q.includes('SELECT DISTINCT p.CountryFlower'))return {recordset:fixed?[{CountryFlower:'fixture'}]:[]};return {recordset:[]};};
  const handler=load('pages/api/warehouse/index.js',{query,withTransaction:async fn=>{transactions++;return fn(query);},sql:{Int:'int',NVarChar:'nvarchar',Bit:'bit',Float:'float'},withAuth:fn=>fn,useExeParityFlag:()=>false,sqlWarehouseViewGetData:()=>'',canManageInvoiceReceipt});
  return {handler,calls,get transactions(){return transactions;}};
}
test('warehouse mutations reject unrelated, inactive and missing identity before DB',async()=>{
  for(const user of [{userId:'sales',authority:6},{userId:'office',authority:3},{userId:'field',authority:5},{userId:'bad',authority:'4x'},{authority:4},{userId:'import',authority:4,accountActive:false},{userId:'import',authority:7,isDeleted:true}]) {
    for(const method of ['DELETE','PATCH','POST']) {
      const f=fixture(),res=response();await f.handler({method,user,body:{warehouseKey:101,orderYear:'2026',orderWeek:'44-01',inputDate:'2026-11-01',items:[{}]}},res);
      assert.equal(res.statusCode,403);assert.equal(f.calls.length,0);assert.equal(f.transactions,0);
    }
  }
});
test('native import roles with empty DeptName and administrator can delete selected year only',async()=>{
  for(const authority of [4,'4',' 4 ',7,'7',1])for(const year of ['2025','2026']){
    const f=fixture(year),res=response();await f.handler({method:'DELETE',user:{userId:'fixture',authority,deptName:''},body:{warehouseKey:year==='2025'?101:202}},res);
    assert.equal(res.statusCode,200);assert.equal(f.transactions,1);
    const update=f.calls.find(c=>c.q.includes('UPDATE WarehouseMaster'));assert.equal(update.p.wk.value,year==='2025'?101:202);
    const stock=f.calls.find(c=>c.q.includes('EXEC dbo.usp_StockCalculation'));assert.equal(stock.p.year.value,year);assert.equal(stock.p.week.value,'44-01');assert.equal(stock.p.uid.value,'fixture');
    assert.equal(f.calls.length,4);
  }
});
test('authorized import still cannot delete fixed week',async()=>{
  const f=fixture('2026',true),res=response();await f.handler({method:'DELETE',user:{userId:'fixture',authority:4},body:{warehouseKey:202}},res);
  assert.equal(res.statusCode,409);assert.equal(res.payload.code,'WAREHOUSE_WEEK_FIXED');assert.equal(f.calls.length,2);
});
test('freight patch shares import authorization',async()=>{
  for(const authority of [4,7]){const f=fixture(),res=response();await f.handler({method:'PATCH',user:{userId:'fixture',authority},body:{warehouseKey:202}},res);assert.equal(res.statusCode,200);assert.equal(f.calls.length,1);}
});

test('packing upload accepts native import role then performs product validation',async()=>{
  for(const authority of [4,7]){const f=fixture(),res=response();await f.handler({method:'POST',user:{userId:'fixture',authority},body:{orderYear:'2026',orderWeek:'44-01',inputDate:'2026-11-01',items:[{prodName:'unregistered fixture'}]}},res);assert.equal(res.statusCode,400);assert.equal(res.payload.code,'WAREHOUSE_PRODUCT_VALIDATION_FAILED');assert.equal(f.calls.length,1);assert.equal(f.transactions,0);}
});
