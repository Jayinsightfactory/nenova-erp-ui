import { createHash } from 'node:crypto';
import { withErpReadContext } from './erpReadContext.js';
import { buildConfirmDetailRows, buildSourceHash } from './profitReportConfirm.js';
import { materializeProfitPayload } from './profitReportStoredCalculation.js';
import { insertSnapshot, payloadHashOf, profitReportCalcVersion } from './profitReportSnapshot.js';
import { loadProfitCategoryOverrides } from './profitReportCategoryOverrides.js';

const p=(type,value)=>({type,value});
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:409});
const rows=result=>{if(!Array.isArray(result?.recordset))throw fail('APPROVAL_REPORT_READ_FAILED','손익 자료를 완전히 읽지 못했습니다.');return result.recordset;};
const canonical=value=>Array.isArray(value)?value.map(canonical):value instanceof Date?value.toISOString():value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const approvalProfitHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const approvalProfitPolicyHash=()=>approvalProfitHash({version:profitReportCalcVersion(),classification:loadProfitCategoryOverrides(true)});
const keyOf=row=>`${row.orderYear}:${row.major}`;
const detailsSemantic=details=>details.map(d=>({category:d.category??d.Category,colType:d.colType??d.ColType,colKey:d.colKey??d.ColKey,value:(d.value??d.Value)==null?null:Number(Number(d.value??d.Value).toFixed(10)),textValue:d.textValue??d.TextValue??null})).sort((a,b)=>`${a.category}:${a.colType}:${a.colKey}`.localeCompare(`${b.category}:${b.colType}:${b.colKey}`));
export function summarizeStoredApprovalProfit(facts){
  return facts.periods.map(period=>{
    let totals;
    if(period.confirm)totals=Object.fromEntries(period.confirmDetails.filter(d=>d.Category==='_total'&&d.ColType==='CALC').map(d=>[d.ColKey,d.Value==null?null:Number(d.Value)]));
    else{try{totals=JSON.parse(period.snapshot?.PayloadJson??'null')?.totals??null;}catch{throw fail('APPROVAL_REPORT_STORED_INVALID','기존 손익 계산본을 읽지 못했습니다.');}}
    return {orderYear:period.orderYear,major:period.major,confirmKey:period.confirm?.ConfirmKey??null,revisionNo:period.confirm?.RevisionNo??null,sourceHash:period.confirm?.SourceHash??period.snapshot?.FingerprintHash??null,totals};
  });
}

/** Read every saved/confirmed later period, including later years; no DDL or ERP writes. */
export async function readIncomingApprovalProfit(q,types,scope,locked=false){
  const params={year:p(types.NVarChar,String(scope.orderYear)),major:p(types.Int,Number(String(scope.orderWeek).slice(0,2)))};
  const schema=rows(await q(`SELECT OBJECT_ID(N'dbo.WebProfitReportConfirm',N'U') ConfirmTable,
    OBJECT_ID(N'dbo.WebProfitReportConfirmDetail',N'U') DetailTable,OBJECT_ID(N'dbo.WebProfitReportSnapshot',N'U') SnapshotTable`))[0];
  if(!schema?.ConfirmTable||!schema.DetailTable||!schema.SnapshotTable)throw fail('APPROVAL_REPORT_SCHEMA_REQUIRED','손익 확정·계산본 저장소를 확인하세요.');
  const scopeSql=`(OrderYear>@year OR (OrderYear=@year AND TRY_CONVERT(int,MajorWeek)>=@major))`;
  const meta=rows(await q(`SELECT OrderYear,MajorWeek FROM WebProfitReportConfirm WHERE IsActive=1 AND ${scopeSql}
    UNION SELECT OrderYear,MajorWeek FROM WebProfitReportSnapshot WHERE ${scopeSql} ORDER BY OrderYear,MajorWeek`,params));
  if(locked)for(const r of meta)await q(`DECLARE @r int; EXEC @r=sys.sp_getapplock @Resource=@resource,@LockMode=N'Exclusive',@LockOwner=N'Transaction',@LockTimeout=10000;
    IF @r<0 THROW 51104,'INCOMING_PROFIT_BUSY',1;`,{resource:p(types.NVarChar,`profit-cache:${r.OrderYear}:${String(r.MajorWeek).padStart(2,'0')}`)});
  const hint=locked?'WITH (UPDLOCK,HOLDLOCK)':'';
  const confirms=rows(await q(`SELECT * FROM WebProfitReportConfirm ${hint} WHERE IsActive=1 AND ${scopeSql} ORDER BY OrderYear,MajorWeek`,params));
  const snapshots=rows(await q(`SELECT * FROM WebProfitReportSnapshot ${hint} WHERE ${scopeSql} ORDER BY OrderYear,MajorWeek,VersionNo DESC`,params));
  const periods=new Map();
  for(const c of confirms){const period={orderYear:String(c.OrderYear),major:String(c.MajorWeek).padStart(2,'0')};const key=keyOf(period);if(periods.has(key))throw fail('APPROVAL_REPORT_DUPLICATE','같은 기간의 활성 손익 확정본이 여러 개입니다.');periods.set(key,{...period,confirm:c,confirmDetails:rows(await q(`SELECT Category,ColType,ColKey,Value,TextValue FROM WebProfitReportConfirmDetail ${hint} WHERE ConfirmKey=@key ORDER BY Category,ColType,ColKey`,{key:p(types.Int,c.ConfirmKey)})),snapshot:null});}
  for(const s of snapshots){const period={orderYear:String(s.OrderYear),major:String(s.MajorWeek).padStart(2,'0')},key=keyOf(period);if(!periods.has(key))periods.set(key,{...period,confirm:null,confirmDetails:[],snapshot:null});if(!periods.get(key).snapshot)periods.get(key).snapshot=s;}
  return {periods:[...periods.values()].sort((a,b)=>keyOf(a).localeCompare(keyOf(b))),policyHash:approvalProfitPolicyHash()};
}

/** Same live calculation/materialization used by the existing confirmation and cache APIs. */
export async function computeIncomingApprovalProfit({q,types,facts,externalEvidence={},loadReportDataFn}){
  if(facts.policyHash!==approvalProfitPolicyHash())throw fail('APPROVAL_REPORT_POLICY_CHANGED','손익 계산 기준이 바뀌었습니다. 미리보기를 다시 실행하세요.');
  const periods=[];
  if(!facts.periods.length)return {...facts,periods};
  const compute=loadReportDataFn??(await import('../pages/api/sales/profit-report.js')).loadReportData;
  for(const period of facts.periods){
    const payload=await withErpReadContext({queryFn:q,externalEvidence},async()=>materializeProfitPayload({...await compute(period.major,period.orderYear),orderYear:period.orderYear,major:period.major}));
    const sourceHash=buildSourceHash(payload);
    const detailRows=buildConfirmDetailRows(payload.rows,payload.totals);
    periods.push({orderYear:period.orderYear,major:period.major,confirmKey:period.confirm?.ConfirmKey??null,revisionNo:period.confirm?.RevisionNo??null,payload,sourceHash,detailRows,
      semanticHash:approvalProfitHash({sourceHash,details:detailsSemantic(detailRows),stockWeeks:payload.stockWeeks,audit:payload.audit})});
  }
  if(facts.policyHash!==approvalProfitPolicyHash())throw fail('APPROVAL_REPORT_POLICY_CHANGED','손익 계산 기준이 바뀌었습니다. 전체 변경을 취소합니다.');
  return {periods,policyHash:facts.policyHash};
}

/** Append revisions inside caller's receipt transaction. Never calls independent confirm/cancel APIs. */
export async function writeIncomingApprovalProfit({q,types,before,after,actor,requestId,reason}){
  if(before.policyHash!==after.policyHash||after.policyHash!==approvalProfitPolicyHash())throw fail('APPROVAL_REPORT_POLICY_CHANGED','손익 계산 기준이 바뀌었습니다.');
  const evidence=[];
  for(const period of before.periods){
    const computed=after.periods.find(r=>keyOf(r)===keyOf(period));
    if(!computed)throw fail('APPROVAL_REPORT_INCOMPLETE','영향 손익 기간의 계산 결과가 누락되었습니다.');
    const changed=!!period.confirm&&(period.confirm.SourceHash!==computed.sourceHash||approvalProfitHash(detailsSemantic(period.confirmDetails))!==approvalProfitHash(detailsSemantic(computed.detailRows)));
    let confirmKey=period.confirm?.ConfirmKey??null,revisionNo=period.confirm?.RevisionNo??null;
    const params={year:p(types.NVarChar,period.orderYear),major:p(types.NVarChar,period.major),actor:p(types.NVarChar,actor),notes:p(types.NVarChar,`입고 정정 요청 #${requestId}: ${reason}`.slice(0,2000))};
    if(changed){
      if(Number(computed.payload.audit?.errorCount??0)>0)throw fail('APPROVAL_REPORT_AUDIT_FAILED',`${period.orderYear}/${period.major} 손익 검산 오류: ${(computed.payload.audit.issues??[]).filter(i=>i.severity==='error'||i.level==='error').slice(0,3).map(i=>i.message??i.code).join(', ')||'입력 근거를 확인하세요.'}`);
      const oldKey=period.confirm.ConfirmKey;
      await q(`UPDATE WebProfitReportConfirm SET IsActive=0,CancelledBy=@actor,CancelledAt=GETDATE()
        WHERE ConfirmKey=@key AND OrderYear=@year AND MajorWeek=@major AND IsActive=1 AND RevisionNo=@revision;
        IF @@ROWCOUNT<>1 THROW 51104,'INCOMING_PROFIT_STALE',1;`,{...params,key:p(types.Int,oldKey),revision:p(types.Int,period.confirm.RevisionNo)});
      const stock=computed.payload.stockWeeks??{};
      const result=rows(await q(`INSERT WebProfitReportConfirm(OrderYear,MajorWeek,RevisionNo,IsActive,BeginOrderYear,BeginOrderWeek,BeginStockKey,EndOrderYear,EndOrderWeek,EndStockKey,SourceHash,AuditStatus,AuditIssuesJson,IsForced,ConfirmedBy,Notes)
        OUTPUT inserted.ConfirmKey,inserted.RevisionNo
        SELECT @year,@major,ISNULL(MAX(RevisionNo),0)+1,1,@beginYear,@beginWeek,@beginKey,@endYear,@endWeek,@endKey,@hash,@audit,@issues,0,@actor,@notes
        FROM WebProfitReportConfirm WITH (UPDLOCK,HOLDLOCK) WHERE OrderYear=@year AND MajorWeek=@major`,{
        ...params,beginYear:p(types.NVarChar,stock.beginOrderYear??null),beginWeek:p(types.NVarChar,stock.begin??null),beginKey:p(types.Int,stock.beginStockKey??null),endYear:p(types.NVarChar,stock.endOrderYear??null),endWeek:p(types.NVarChar,stock.end??null),endKey:p(types.Int,stock.endStockKey??null),hash:p(types.NVarChar,computed.sourceHash),audit:p(types.NVarChar,computed.payload.audit?.status??null),issues:p(types.NVarChar,JSON.stringify(computed.payload.audit?.issues??[])),
      }))[0];
      if(!result?.ConfirmKey)throw fail('APPROVAL_REPORT_WRITE_FAILED','손익 정정본 저장을 확인하지 못했습니다.');
      confirmKey=result.ConfirmKey;revisionNo=result.RevisionNo;
      for(let offset=0;offset<computed.detailRows.length;offset+=40){const chunk=computed.detailRows.slice(offset,offset+40),dp={key:p(types.Int,confirmKey)};chunk.forEach((d,i)=>{dp[`category${i}`]=p(types.NVarChar,d.category);dp[`type${i}`]=p(types.NVarChar,d.colType);dp[`column${i}`]=p(types.NVarChar,d.colKey);dp[`value${i}`]=p(types.Decimal(38,10),d.value);dp[`text${i}`]=p(types.NVarChar,d.textValue);});await q(`INSERT WebProfitReportConfirmDetail(ConfirmKey,Category,ColType,ColKey,Value,TextValue) VALUES ${chunk.map((_,i)=>`(@key,@category${i},@type${i},@column${i},@value${i},@text${i})`).join(',')}`,dp);}
      const saved=rows(await q('SELECT Category,ColType,ColKey,Value,TextValue FROM WebProfitReportConfirmDetail WHERE ConfirmKey=@key ORDER BY Category,ColType,ColKey',{key:p(types.Int,confirmKey)}));
      const expected=detailsSemantic(computed.detailRows),actual=detailsSemantic(saved);
      if(actual.length!==expected.length||actual.some((r,i)=>r.category!==expected[i].category||r.colType!==expected[i].colType||r.colKey!==expected[i].colKey||r.textValue!==expected[i].textValue|| (r.value==null)!==(expected[i].value==null)||r.value!=null&&Math.abs(r.value-expected[i].value)>1e-7))throw fail('APPROVAL_REPORT_READBACK_FAILED','손익 정정본 저장 검산이 일치하지 않습니다.');
      const active=rows(await q('SELECT ConfirmKey FROM WebProfitReportConfirm WHERE OrderYear=@year AND MajorWeek=@major AND IsActive=1',params));
      if(active.length!==1||active[0].ConfirmKey!==confirmKey)throw fail('APPROVAL_REPORT_READBACK_FAILED','활성 손익 정정본이 유일하지 않습니다.');
    }
    let snapshotKey=period.snapshot?.SnapKey??null;
    if(!period.snapshot||period.snapshot.PayloadHash!==payloadHashOf(computed.payload)){
      const fingerprint={hash:computed.sourceHash,components:{INCOMING_APPROVAL:{requestId,sourceHash:computed.sourceHash,policyHash:after.policyHash}}};
      const saved=await insertSnapshot({orderYear:period.orderYear,major:period.major,fingerprint,payload:computed.payload,prevPayloadHash:null,reason:'RECEIPT_CORRECTION',computeMs:0,actor,previous:period.snapshot?{payloadHash:period.snapshot.PayloadHash}:null,runQuery:q});
      snapshotKey=saved?.snapKey;
      if(!snapshotKey)throw fail('APPROVAL_REPORT_WRITE_FAILED','손익 계산본 저장을 확인하지 못했습니다.');
      const readback=rows(await q('SELECT PayloadHash,PayloadJson FROM WebProfitReportSnapshot WHERE SnapKey=@key AND OrderYear=@year AND MajorWeek=@major',{...params,key:p(types.Int,snapshotKey)}))[0];
      if(readback?.PayloadHash!==payloadHashOf(computed.payload)||payloadHashOf(JSON.parse(readback.PayloadJson))!==readback.PayloadHash)throw fail('APPROVAL_REPORT_READBACK_FAILED','손익 계산본 저장 검산이 일치하지 않습니다.');
    }
    evidence.push({orderYear:period.orderYear,major:period.major,previousConfirmKey:period.confirm?.ConfirmKey??null,confirmKey,revisionNo,changed,snapshotKey,sourceHash:computed.sourceHash,semanticHash:computed.semanticHash,totals:computed.payload.totals});
  }
  return evidence;
}
