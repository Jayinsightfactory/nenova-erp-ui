import { createHash } from 'node:crypto';

const fail = message => { throw new Error(message); };
const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
const round = value => Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
const week = value => /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/.test(String(value));
const coordinate = row => `${row.OrderYear}/${row.OrderWeek}`;
export const stockRepairDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicitly approved cleanup only. Equality alone never establishes business intent. */
export function planHistoricalStockRepair(state, scope) {
  const { year, startWeek, offsetWeek, prodKeys, cleanupPurposeConfirmed } = scope;
  if (!/^20\d{2}$/.test(year) || +year <= 2025 || !week(startWeek) || !week(offsetWeek)
    || startWeek >= offsetWeek || cleanupPurposeConfirmed !== true || !Array.isArray(prodKeys)
    || !prodKeys.length || prodKeys.length > 20 || new Set(prodKeys).size !== prodKeys.length
    || prodKeys.some(k => !Number.isInteger(k) || k <= 0)) fail('REPAIR_SCOPE_OR_PURPOSE_REQUIRED');
  // SQL NULL never satisfies the native >=/< predicates. Do not sort String(null)
  // after numeric year keys and accidentally treat unscoped legacy rows as future.
  const masters = state.masters.filter(m=>m.OrderYearWeek!=null).sort((a,b)=>String(a.OrderYearWeek).localeCompare(String(b.OrderYearWeek)) || a.StockKey-b.StockKey);
  const first = masters.findIndex(m=>m.OrderYear===year&&m.OrderWeek===startWeek);
  if (first < 1) fail('REPAIR_ANCHOR_REQUIRED');
  const relevant = masters.slice(first - 1);
  const legacy = new Set(scope.nativeLegacyPeriods || []);
  if([...legacy].some(id=>!/^20\d{2}\/(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)[A-Z]$/.test(id))) fail('REPAIR_LEGACY_SCOPE_INVALID');
  if (new Set(relevant.map(coordinate)).size !== relevant.length) fail('REPAIR_MASTER_AMBIGUOUS');
  const invalidMaster=relevant.find(m=>(!week(m.OrderWeek)&&!legacy.has(coordinate(m)))
    || String(m.OrderYearWeek)!==String(m.OrderYear)+m.OrderWeek.replace('-',''));
  if(invalidMaster) fail(`REPAIR_MASTER_AMBIGUOUS:${coordinate(invalidMaster)}:${invalidMaster.OrderYearWeek}`);
  // Native CALC traverses these legacy backup nodes too. Acknowledge exact coordinates,
  // never silently normalize them into another week or infer movement semantics.
  if([...state.incoming,...state.outgoing,...state.adjustments].some(r=>legacy.has(coordinate(r)))) fail('REPAIR_LEGACY_HAS_MOVEMENT');
  const rows = new Map();
  for (const row of state.stocks) {
    const key=`${row.StockKey}/${row.ProdKey}`;
    if(rows.has(key)||!finite(row.Stock)) fail('REPAIR_STOCK_AMBIGUOUS');
    rows.set(key,row);
  }
  const movements = (master,pk) => {
    const match = r=>String(r.OrderYear)===String(master.OrderYear)&&r.OrderWeek===master.OrderWeek&&r.ProdKey===pk;
    const sumQty = source=>round(source.filter(match).reduce((n,r)=>{
      if(!finite(r.OutQuantity)) fail('REPAIR_QUANTITY_MISSING');return n+Number(r.OutQuantity);
    },0));
    const history=state.adjustments.filter(match).filter(r=>r.TypeMatches>0);
    if(history.some(r=>r.TypeMatches!==1||!finite(r.BeforeValue)||!finite(r.AfterValue))) fail('REPAIR_ADJUSTMENT_AMBIGUOUS');
    return { incoming:sumQty(state.incoming),outgoing:sumQty(state.outgoing),
      adjusted:round(history.reduce((n,r)=>n+Number(r.AfterValue)-Number(r.BeforeValue),0)),history };
  };
  const stock=(m,k)=>{const r=rows.get(`${m.StockKey}/${k}`);if(!r)fail('REPAIR_STOCK_ROW_MISSING');return Number(r.Stock);};
  const offset=masters.find(m=>m.OrderYear===year&&m.OrderWeek===offsetWeek);
  if(!offset) fail('REPAIR_OFFSET_MISSING');
  const items=prodKeys.map(pk=>{
    const product=state.products.find(p=>p.ProdKey===pk);
    if(!product||product.isDeleted||product.OutUnit!=='송이') fail('REPAIR_PRODUCT_OR_UNIT_CHANGED');
    const current=masters[first],move=movements(current,pk);
    const expected=round(stock(masters[first-1],pk)+move.incoming-move.outgoing+move.adjusted);
    const excess=round(stock(current,pk)-expected),cleanup=movements(offset,pk);
    if(excess<=0||cleanup.adjusted!==-excess) fail('REPAIR_OFFSET_NOT_EXACT');
    return {prodKey:pk,excess,startStored:stock(current,pk),startExpected:expected,
      cleanupHistoryKeys:cleanup.history.map(h=>h.StockHistoryKey).sort((a,b)=>a-b)};
  });
  const expected=[];
  for(const item of items){let previous=stock(masters[first-1],item.prodKey);
    for(const master of masters.slice(first)){
      const move=movements(master,item.prodKey);
      const compensation=coordinate(master)===`${year}/${offsetWeek}`?item.excess:0;
      const after=round(previous+move.incoming-move.outgoing+move.adjusted+compensation);
      if(after<0) fail('REPAIR_WOULD_CREATE_NEGATIVE');
      const before=stock(master,item.prodKey);
      expected.push({StockKey:master.StockKey,ProdKey:item.prodKey,OrderYear:master.OrderYear,OrderWeek:master.OrderWeek,before,after});
      previous=after;
    }
  }
  const sourceHash=stockRepairDigest(state);
  const repairId=`historical-stock:${year}:${startWeek}:${sourceHash.slice(0,16)}`;
  const repairDescription=`과거 재고 오류(${year}/${startWeek}) 재계산에 따른 ${offsetWeek} 전산오류 조정 중복차감 상쇄 [${repairId}]`;
  return {version:1,scope,sourceHash,repairId,repairDescription,items,expected};
}

export function verifyHistoricalStockRepair(before, after, plan) {
  for(const field of ['masters','products','incoming','outgoing','protected','procedureHash'])
    if(stockRepairDigest(before[field])!==stockRepairDigest(after[field])) fail(`REPAIR_PROTECTED_CHANGED:${field}`);
  const oldKeys=new Set(before.adjustments.map(r=>r.StockHistoryKey));
  const preserved=after.adjustments.filter(r=>oldKeys.has(r.StockHistoryKey));
  if(stockRepairDigest(preserved)!==stockRepairDigest(before.adjustments)) fail('REPAIR_EXISTING_HISTORY_CHANGED');
  const added=after.adjustments.filter(r=>!oldKeys.has(r.StockHistoryKey));
  if(added.length!==plan.items.length) fail('REPAIR_HISTORY_COUNT');
  for(const item of plan.items){const rows=added.filter(r=>r.ProdKey===item.prodKey);
    if(rows.length!==1||rows[0].OrderYear!==plan.scope.year||rows[0].OrderWeek!==plan.scope.offsetWeek
      ||rows[0].ChangeType!=='재고조정'||rows[0].BeforeValue!==0||rows[0].AfterValue!==item.excess
      ||rows[0].Descr!==plan.repairDescription||rows[0].TypeMatches!==1) fail('REPAIR_HISTORY_MISMATCH');
  }
  const expected=new Map(plan.expected.map(r=>[`${r.StockKey}/${r.ProdKey}`,r]));
  if(before.stocks.length!==after.stocks.length) fail('REPAIR_STOCK_COUNT_CHANGED');
  const originals=new Map(before.stocks.map(r=>[`${r.StockKey}/${r.ProdKey}`,r.Stock]));
  for(const r of after.stocks){const key=`${r.StockKey}/${r.ProdKey}`,value=expected.get(key)?.after??originals.get(key);
    if(value===undefined||!finite(r.Stock)||Math.abs(Number(r.Stock)-value)>1e-7) fail('REPAIR_STOCK_READBACK_MISMATCH');
  }
  return {changedSnapshots:plan.expected.filter(r=>r.before!==r.after).length,addedHistory:added.length,
    preservedProtected:true,historyKeys:added.map(r=>r.StockHistoryKey)};
}

/** The caller owns the outer transaction, rollback/commit, and source locks. No retry. */
export async function executeHistoricalStockRepair({tQuery,types,scope,expectedHash,readState,runNative,actor}) {
  if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||!actor) fail('REPAIR_APPROVED_HASH_REQUIRED');
  const gate=await tQuery(`SELECT * FROM dbo.NenovaStockWeekGate WITH (UPDLOCK,HOLDLOCK,NOWAIT) WHERE GateKey='1'`);
  const row=gate.recordset?.[0],nullable=['Mode','LockedAt','Action','OrderYear','OrderWeek','OwnerSessionID','OwnerToken','CalcProdKey'];
  if(gate.recordset?.length!==1||!row||row.ProtocolVersion!==2||row.PendingCalc||nullable.some(k=>row[k]!==null)) fail('REPAIR_GATE_BUSY');
  const before=await readState(tQuery);
  if(stockRepairDigest(before)!==expectedHash) fail('REPAIR_SOURCE_CHANGED');
  const plan=planHistoricalStockRepair(before,scope);
  if(before.adjustments.some(r=>String(r.Descr||'').includes(`historical-stock:${scope.year}:${scope.startWeek}:`))) fail('REPAIR_ALREADY_APPLIED');
  for(const item of plan.items)await tQuery(`INSERT INTO StockHistory
    (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
    VALUES(GETDATE(),@yr,@wk,@uid,N'재고조정',N'재고수량',0,@amount,@descr,@pk)`,{
      yr:{type:types.NVarChar,value:scope.year},wk:{type:types.NVarChar,value:scope.offsetWeek},
      uid:{type:types.NVarChar,value:actor},amount:{type:types.Float,value:item.excess},
      descr:{type:types.NVarChar,value:plan.repairDescription},pk:{type:types.Int,value:item.prodKey},
    });
  await runNative({tQuery,scope,actor});
  const after=await readState(tQuery);
  return {plan,verification:verifyHistoricalStockRepair(before,after,plan),afterHash:stockRepairDigest(after)};
}
