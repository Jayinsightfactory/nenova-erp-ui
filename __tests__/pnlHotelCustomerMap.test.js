const assert = require('node:assert/strict');
async function main() {
 const {saveHotelCustomerMap,normalizeHotelCustomerRequest,loadHotelCustomerShipments}=await import('../lib/pnlHotelCustomerMap.js');
 for(const raw of [{partnerCode:'shilla',custKey:0,revision:0},{partnerCode:'shilla',custKey:2,revision:-1},{custKey:2,revision:0}]) assert.throws(()=>normalizeHotelCustomerRequest(raw));
 const state=new Map(), calls=[];
 const query=async (statement,params)=>{
  calls.push(statement);const pc=params?.pc?.value;
  if(statement.includes('OBJECT_ID'))return {recordset:[{Ready:1}]};
  if(statement.includes('dbo.WebPnlHotel') && statement.includes('WHERE PartnerCode=@code')) return {recordset:[{PartnerCode:params.code.value,Name:'은화',IsActive:1}]};
  if(statement.includes('SELECT Revision'))return {recordset:state.has(pc)?[state.get(pc)]:[]};
  if(statement.startsWith('SELECT CustKey FROM Customer'))return {recordset:params.ck.value===99?[]:[{CustKey:params.ck.value}]};
  if(statement.startsWith('INSERT')){state.set(pc,{CustKey:params.ck.value,Revision:1});return {recordset:[]};}
  if(statement.startsWith('UPDATE')){state.set(pc,{CustKey:params.ck.value,Revision:state.get(pc).Revision+1});return {recordset:[]};}
  if(statement.includes('LEFT JOIN Customer'))return {recordset:state.has(pc)?[{...state.get(pc),CustName:'선택 업체',Active:state.get(pc).CustKey?1:0}]:[]};
  if(statement.includes('FROM ShipmentMaster')) {
   assert.match(statement,/sm.CustKey=@ck AND sm.OrderYear=@yr/);
   return {recordset:[{OrderWeek:params.week.value,ProdKey:1,OutQuantity:params.yr.value==='2026'?7:3,CustKey:params.ck.value}]};
  }
  throw Error(statement);
 };
 const tx=fn=>fn(query);
 for(const partnerCode of ['raum','choimun','shilla','hotel_87bc41c16ae5']) {
  const result=await saveHotelCustomerMap({partnerCode,custKey:446,revision:0},'tester',tx);
  assert.equal(result.custKey,446);assert.equal(result.revision,1);
 }
 await assert.rejects(saveHotelCustomerMap({partnerCode:'shilla',custKey:690,revision:0},'tester',tx),e=>e.statusCode===409);
 await assert.rejects(saveHotelCustomerMap({partnerCode:'shilla',custKey:99,revision:1},'tester',tx));
 assert.equal(state.get('shilla').CustKey,446);
 const cleared=await saveHotelCustomerMap({partnerCode:'shilla',custKey:null,revision:1},'tester',tx);
 assert.equal(cleared.custKey,null);assert.equal(state.get('raum').CustKey,446);
 const current=await loadHotelCustomerShipments('raum','2026','40',query);
 const prior=await loadHotelCustomerShipments('raum','2025','40',query);
 assert.equal(current.rows[0].OutQuantity,7);assert.equal(prior.rows[0].OutQuantity,3);
 assert.equal(current.rows[0].CustKey,446);
 await assert.rejects(loadHotelCustomerShipments('shilla','2026','40',query));
 assert.ok(!calls.some(q=>/^(INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:Customer|Product|OrderDetail|ShipmentDetail|Estimate|StockHistory)\b/i.test(q)));
 console.log('Hotel customer mapping: all hotels, stale revision, inactive customer, unlink, isolation, ERP preservation passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
