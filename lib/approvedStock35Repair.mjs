import {planStockCascadeRepair,stockRepairDigest} from './stockCascadeRepair.mjs';
export {stockRepairDigest};
const keys=[1062,2322,2601];
export const STOCK35_MARKER='[owner-approved-stock35:2026-11-13:+1:1062,2322,2601]';
const fail=message=>{throw new Error(message);};
export function planApprovedStock35Repair(state,scope){
 if(scope?.year!=='2026'||scope.startWeek!=='35-02'||scope.ownerApproved!==true||scope.delta!==1
  ||JSON.stringify(scope.prodKeys)!==JSON.stringify(keys))fail('APPROVED35_SCOPE_REQUIRED');
 if(state.adjustments.some(h=>String(h.Descr||'').includes(STOCK35_MARKER)))fail('APPROVED35_ALREADY_APPLIED');
 const target=state.masters.filter(m=>m.OrderYear==='2026'&&m.OrderWeek==='35-02');
 if(target.length!==1)fail('APPROVED35_TARGET_AMBIGUOUS');
 const injected=structuredClone(state);
 for(const pk of keys){
  const p=state.products.filter(p=>p.ProdKey===pk);
  const stock=state.stocks.filter(r=>r.StockKey===target[0].StockKey&&r.ProdKey===pk);
  if(p.length!==1||p[0].isDeleted||p[0].OutUnit!=='박스'||Number(p[0].BunchOf1Box)!==30
    ||!Number.isFinite(p[0].Stock)||stock.length!==1||stock[0].Stock!==-1)fail('APPROVED35_PRODUCT_OR_STOCK_CHANGED');
  injected.adjustments.push({StockHistoryKey:-pk,OrderYear:'2026',OrderWeek:'35-02',ProdKey:pk,
   BeforeValue:-1,AfterValue:0,ChangeType:'재고조정',TypeMatches:1});
 }
 const calculation=planStockCascadeRepair(injected,scope);
 if(calculation.expected.some(r=>Math.abs(r.after-r.before-1)>1e-7||r.after<0))fail('APPROVED35_NOT_EXACT_PLUS_ONE');
 return {scope,sourceHash:stockRepairDigest(state),expected:calculation.expected,
  description:`대표 승인: 2026/35-02 카네이션 3품목 −1→0박스 및 후속재고 +1 이월, 기존 이력 보존 ${STOCK35_MARKER}`};
}
export function verifyApprovedStock35Repair(before,after,plan,actor){
 for(const field of ['masters','incoming','outgoing','protected','procedureHash'])
  if(stockRepairDigest(before[field])!==stockRepairDigest(after[field]))fail(`APPROVED35_PROTECTED_CHANGED:${field}`);
 const expectedProducts=before.products.map(p=>({...p,Stock:Number(p.Stock)+1}));
 if(stockRepairDigest(expectedProducts)!==stockRepairDigest(after.products))fail('APPROVED35_PRODUCT_READBACK');
 const old=new Set(before.adjustments.map(h=>h.StockHistoryKey));
 if(stockRepairDigest(before.adjustments)!==stockRepairDigest(after.adjustments.filter(h=>old.has(h.StockHistoryKey))))fail('APPROVED35_OLD_HISTORY_CHANGED');
 const added=after.adjustments.filter(h=>!old.has(h.StockHistoryKey));
 if(added.length!==3)fail('APPROVED35_HISTORY_COUNT');
 for(const pk of keys){const rows=added.filter(h=>h.ProdKey===pk);
  if(rows.length!==1||rows[0].OrderYear!=='2026'||rows[0].OrderWeek!=='35-02'||rows[0].BeforeValue!==-1||rows[0].AfterValue!==0
    ||rows[0].ChangeType!=='재고조정'||rows[0].ChangeID!==actor||rows[0].Descr!==plan.description||rows[0].TypeMatches!==1)fail('APPROVED35_HISTORY_READBACK');
 }
 const expected=new Map(before.stocks.map(r=>[`${r.StockKey}/${r.ProdKey}`,r.Stock]));
 for(const r of plan.expected)expected.set(`${r.StockKey}/${r.ProdKey}`,r.after);
 if(after.stocks.length!==before.stocks.length)fail('APPROVED35_CARDINALITY');
 const seen=new Set();
 for(const r of after.stocks){const id=`${r.StockKey}/${r.ProdKey}`;
  if(seen.has(id)||!expected.has(id)||!Number.isFinite(r.Stock)||Math.abs(r.Stock-expected.get(id))>1e-7)fail('APPROVED35_STOCK_READBACK');seen.add(id);
 }
 return {addedHistory:3,checkedSnapshots:plan.expected.length,changedSnapshots:plan.expected.length,
  historyKeys:added.map(h=>h.StockHistoryKey),live:after.products.map(p=>({prodKey:p.ProdKey,stock:p.Stock})),protectedPreserved:true};
}
// Caller owns SERIALIZABLE transaction, backup, commit/rollback and no-retry policy.
export async function executeApprovedStock35Repair({tQuery,types,scope,expectedHash,actor,readState,runNative}){
 if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||!actor)fail('APPROVED35_HASH_ACTOR_REQUIRED');
 const gate=(await tQuery("SELECT *,@@TRANCOUNT TransactionCount,XACT_STATE() TransactionState FROM dbo.NenovaStockWeekGate WITH(UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'")).recordset;
 if(gate.length!==1||gate[0].TransactionCount<1||gate[0].TransactionState!==1||gate[0].ProtocolVersion!==2||gate[0].PendingCalc
  ||['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'].some(k=>gate[0][k]!==null))fail('APPROVED35_GATE_BUSY');
 if((await tQuery("SELECT Descr FROM CodeInfo WITH(HOLDLOCK) WHERE Category=N'StockType' AND Descr=N'재고조정'")).recordset.length!==1)fail('APPROVED35_CODE_INVALID');
 const before=await readState(tQuery);
 if(stockRepairDigest(before)!==expectedHash)fail('APPROVED35_SOURCE_CHANGED');
 const plan=planApprovedStock35Repair(before,scope);
 for(const pk of keys){
  const p=before.products.find(p=>p.ProdKey===pk);
  await tQuery(`INSERT INTO StockHistory(ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
   VALUES(GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',-1,0,@descr,@pk);
   UPDATE Product SET Stock=ROUND(@after,2) WHERE ProdKey=@pk AND Stock=@before AND ISNULL(isDeleted,0)=0;
   IF @@ROWCOUNT<>1 THROW 51080,N'APPROVED35_LIVE_STALE',1;`,{
    yr:{type:types.NVarChar,value:'2026'},wk:{type:types.NVarChar,value:'35-02'},uid:{type:types.NVarChar,value:actor},
    descr:{type:types.NVarChar,value:plan.description},pk:{type:types.Int,value:pk},before:{type:types.Float,value:p.Stock},after:{type:types.Float,value:p.Stock+1}});
 }
 await runNative({tQuery,scope,actor});
 const after=await readState(tQuery);
 return {plan,verification:verifyApprovedStock35Repair(before,after,plan,actor),afterHash:stockRepairDigest(after)};
}
