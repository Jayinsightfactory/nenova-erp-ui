import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { attachWarehouseRoundLabels, changeWarehouseRoundLabel, readWarehouseDetailActions } from '../lib/warehouseDetailActions.js';
import { splitIncomingRound, receiptRoundLabel, normalizeRoundSearch, matchesRound } from '../lib/incomingRoundLabel.js';
import { approvalPermissions } from '../lib/incomingApprovalPolicy.js';

const types={Int:'int',NVarChar:'nvarchar'};
const scope={warehouseKey:8249,orderYear:'2026',orderWeek:'47-02'};
const master={WarehouseKey:8249,OrderYear:'2026',OrderWeek:'47-02'};
const target='warehouse-round:2026:47-02:8249';
const success={recordset:[]};

test('file accepts raw, dotted and lowercase suffixes without writing a new ERP round or suggesting missing values',()=>{
  for(const value of ['47-02A','47-02.A','47-02.a']){
    assert.deepEqual(splitIncomingRound(value),{orderWeek:'47-02',suffix:'A'});
  }
  for(const value of ['47-02AB','47/02B','47-02.C','47-02.'])assert.equal(splitIncomingRound(value),null);
  assert.deepEqual(splitIncomingRound('47-02'),{orderWeek:'47-02',suffix:''});
  assert.equal(receiptRoundLabel(master),'47-02');
  assert.equal(receiptRoundLabel({...master,RoundSuffix:'B'}),'47-02.B');
  assert.equal(matchesRound(receiptRoundLabel({...master,RoundSuffix:'B'}),normalizeRoundSearch('47-02B')),true);
});

test('receipt label writes one compare-and-set audit row; stale and cross-year requests cannot write',async()=>{
  const calls=[];
  const query=async(statement,params)=>{
    const p=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,v.value]));
    calls.push({statement,p});
    if(statement.includes('round-header'))return {recordset:p.year==='2026'&&p.week==='47-02'&&p.wk===8249?[master]:[]};
    if(statement.includes('round-current'))return {recordset:[{Payload:'{"after":"A"}'}]};
    return success;
  };
  assert.deepEqual(await changeWarehouseRoundLabel(query,types,{...scope,expectedSuffix:'A',suffix:'B'},'tester'),{warehouseKey:8249,suffix:'B'});
  const write=calls.at(-1);
  assert.match(write.statement,/INSERT dbo.SystemActionLog/);
  assert.equal(write.p.target,target);
  assert.deepEqual(JSON.parse(write.p.payload),{...scope,before:'A',after:'B',source:'INLINE'});
  const writeCount=()=>calls.filter(c=>c.statement.includes('round-audit')).length;
  await assert.rejects(()=>changeWarehouseRoundLabel(query,types,{...scope,expectedSuffix:'B',suffix:'A'},'tester'),{code:'CORRECTION_ROUND_STALE'});
  await assert.rejects(()=>changeWarehouseRoundLabel(query,types,{...scope,orderYear:'2027',expectedSuffix:'A',suffix:'B'},'tester'),{code:'CORRECTION_NOT_FOUND'});
  await changeWarehouseRoundLabel(query,types,{...scope,expectedSuffix:'A',suffix:'A'},'tester');
  assert.equal(writeCount(),1);
});

test('listing and audit read use year plus raw round and selected receipt; history exposes changes, actor and time',async()=>{
  const before={WdetailKey:901,BoxQuantity:2,BunchQuantity:8,SteamQuantity:80,OutQuantity:8,EstQuantity:80,TPrice:7};
  const after={...before,BoxQuantity:4};
  const query=async(statement,p)=>{
    if(statement.includes('round-list')){
      assert.deepEqual(JSON.parse(p.keys.value),[target,'warehouse-round:2027:47-02:8249','warehouse-round:2026:47-02:8250']);
      return {recordset:[{SessionId:target,Payload:'{"after":"B"}'}]};
    }
    if(statement.includes('round-header'))return {recordset:[master]};
    assert.equal(p.year.value,'2026');assert.equal(p.week.value,'47-02');assert.equal(p.target.value,target);
    return {recordset:[{LogKey:1,ActionType:'WAREHOUSE_CORRECTION',Actor:'tester',ActionDtm:'2026-11-25T01:00:00.000Z',Payload:JSON.stringify({
      reason:'수량 수정',nativeQuantity:{prodName:'연습 꽃',before,after},
    })}]};
  };
  const labels=await attachWarehouseRoundLabels(query,types,[master,{...master,OrderYear:'2027'},{...master,WarehouseKey:8250}]);
  assert.deepEqual(labels.map(x=>x.RoundSuffix),['B','','']);
  const [record]=await readWarehouseDetailActions(query,types,scope);
  assert.equal(record.actor,'tester');assert.equal(record.at,'2026-11-25T01:00:00.000Z');
  assert.equal(record.detailKey,901);assert.equal(record.before.BoxQuantity,2);assert.equal(record.after.BoxQuantity,4);
  assert.equal(record.before.WdetailKey,undefined);
});

test('sales support can review history without gaining modification rights',async()=>{
  const source=fs.readFileSync(new URL('../pages/api/warehouse/detail-actions.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replace('export default withAuth','const handler=withAuth');
  const handler=new Function('withAuth','query','withTransaction','sql','canManageInvoiceReceipt','approvalPermissions','changeWarehouseRoundLabel','readWarehouseDetailActions',`${source}; return handler;`)(
    h=>h,()=>{},()=>{throw Error('unexpected transaction')},types,()=>false,approvalPermissions,()=>{},()=>[],
  );
  const user={userId:'sales-support',deptName:'영업지원'};
  const res=()=>({setHeader(){},status(n){this.code=n;return this},json(b){this.data=b;return this}});
  const read=res(),write=res();
  await handler({method:'GET',user,query:scope},read);
  await handler({method:'POST',user,body:scope},write);
  assert.deepEqual(read.data,{success:true,canEdit:false,history:[]});
  assert.equal(write.code,403);
});
