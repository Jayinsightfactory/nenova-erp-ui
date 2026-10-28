// Final user-approved plan: preserve manual inputs and quotes; correct provenance.
// Default SELECT-only. --apply uses authenticated audited APIs after deployment.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash,randomUUID } from 'node:crypto';
import { parseDefectSourceExport } from '../lib/defectSourceExport.js';
const require=createRequire('C:/Users/USER/nenova-erp-ui/package.json');const sql=require('mssql');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const hash=v=>createHash('sha256').update(v).digest('hex');
const plan=JSON.parse(await fs.readFile(new URL('../docs/audits/defect-manual-provenance-final-2026-10-28.json',import.meta.url),'utf8'));
if(plan.manualKeys.length!==18||plan.quarantine.length!==2||plan.withdrawPastReplay.key!==10803)throw Error('최종 범위가 변경됐습니다.');
const source=await fs.readFile('C:/Users/USER/Downloads/KakaoTalk_20261028_1552_47_184_group.txt','utf8');if(hash(source)!==plan.sourceSha256)throw Error('원문이 변경됐습니다.');
const messages=parseDefectSourceExport(source);for(const q of plan.quarantine)if(hash(messages[q.sourceOrdinal-1].content)!==q.messageSha256)throw Error('대조 원문이 변경됐습니다.');
const pool=await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000}).connect();
const post=async(path,body)=>{const r=await fetch(new URL(path,process.env.NENOVAWEB_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.NENOVAWEB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const j=await r.json();if(!r.ok||!j.success)throw Error(`API HTTP ${r.status} code=${j.code||'API_ERROR'}`);return j;};
const api='/api/sales/defect-deductions';let lease=null;
try {
  const manualRows=(await pool.request().query(`SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey IN(${plan.manualKeys.join(',')}) ORDER BY DeductionKey`)).recordset;
  if(manualRows.length!==18||manualRows.some(r=>r.IsDeleted||r.OrderYear!==2026||Number(r.OrderWeek)<42))throw Error('수기입력 보존 범위 변경');
  const protectedSnapshot=async()=>JSON.stringify((await pool.request().query(`SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey IN(${plan.protectedManualRows.join(',')}) ORDER BY DeductionKey`)).recordset);
  const protectedBefore=await protectedSnapshot();
  for(const b of plan.manualBrowserSaves){const logs=(await pool.request().input('at',sql.NVarChar,b.at).input('count',sql.Int,b.count).query(`SELECT UserAgent,Payload FROM SystemActionLog WHERE ActionDtm=CONVERT(DATETIME,@at,126) AND Endpoint=N'/api/sales/defect-deductions' AND AffectedCount=@count`)).recordset;
    if(!logs.some(l=>/Mozilla|Chrome/.test(l.UserAgent||'')&&JSON.parse(l.Payload).action==='save'))throw Error('브라우저 수기 저장 근거가 변경됐습니다.');}
  const snapshot=async()=>{
    const result={};const custs=[...new Set(manualRows.map(r=>r.CustKey))].join(',');
    const queries={Estimate:`SELECT e.* FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs}) AND e.EstimateKey<>10803`,ShipmentDetail:`SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,ShipmentDate:`SELECT dt.* FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,ViewOrder:`SELECT * FROM ViewOrder WHERE OrderYear='2026' AND CustKey IN(${custs})`,ViewShipment:`SELECT * FROM ViewShipment WHERE OrderYear='2026' AND CustKey IN(${custs})`};
    Object.assign(queries,{ShipmentFarm:`SELECT f.* FROM ShipmentFarm f JOIN ShipmentDetail sd ON sd.SdetailKey=f.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,WebProfitReport:`SELECT * FROM WebProfitReport WHERE OrderYear='2026' AND MajorWeek IN (42,43,44)`,StockHistory:`SELECT * FROM StockHistory WHERE OrderYear='2026' AND OrderWeek IN ('42','43','44','42-01','43-01','44-01')`});
    for(const [name,q]of Object.entries(queries))result[name]=(await pool.request().query(`SELECT COUNT_BIG(*)AS N,CHECKSUM_AGG(BINARY_CHECKSUM(*))AS Fingerprint FROM(${q})probe`)).recordset[0];return result;
  };
  const before=await snapshot();const groups=new Map();
  for(const r of manualRows){const old=(await pool.request().input('key',sql.Int,r.DeductionKey).query(`SELECT AfterJson FROM WebSalesDefectDeductionHistory WHERE DeductionKey=@key AND ActionType=N'MANUAL_SOURCE_CONFIRM' ORDER BY HistoryKey DESC`)).recordset;
    if(old.some(h=>JSON.parse(h.AfterJson).reviewedSourceFileName===(r.SourceFileName||'')))continue;
    const w=Number(r.OrderWeek);if(!groups.has(w))groups.set(w,[]);groups.get(w).push({deductionKey:r.DeductionKey,expectedRowVersionNo:r.RowVersionNo,evidence:{kind:'USER_CONFIRMED_MANUAL_INPUT',sourceSha256:plan.userDirectiveSha256,messageSha256:plan.userDirectiveSha256,messageOrdinal:1,sourceYear:2026,sourceWeek:w,custKey:r.CustKey,prodKey:r.ProdKey,quantity:r.Quantity,sourceUnit:r.SourceUnit,reason:'사용자가 수기입력 묶음 전체 보존 확인. 브라우저 일괄저장 공통원천 표식 승계 오류만 정정하며 입력값·원장버전·실제견적을 변경하지 않음.'}});}
  const previewRequests=[...groups].map(([week,rows])=>({action:'review-source',mode:'manual-provenance',year:2026,week,rows}));
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'audit',manualPending:[...groups.values()].reduce((n,r)=>n+r.length,0),protectedRows:plan.protectedManualRows.length,quarantine:2,pastReplayQuote:10803}));
  if(process.argv.includes('--apply')){
    for(const req of previewRequests){const p=await post(api,{...req,preview:true});if(p.rows.length!==req.rows.length)throw Error('수기 분류 preview 건수 불일치');}
    for(const req of previewRequests){await post(api,{...req,preview:false});console.log(JSON.stringify({manualOriginConfirmed:req.rows.map(r=>r.deductionKey)}));}
    for(const q of plan.quarantine){const r=(await pool.request().input('key',sql.Int,q.key).query('SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey=@key')).recordset[0];
      if(r.IsDeleted||r.CustKey!==q.cust||r.ProdKey!==q.prod||r.Quantity!==q.quantity||r.SourceUnit!==q.unit||r.EstimateKey)throw Error('자동 원문 불일치 후보의 상태가 변경됐습니다.');
      if(String(r.Note||'').includes('[SOURCE_FACT_REVIEW]'))continue;
      const note=(r.Note||'')+' / [SOURCE_FACT_REVIEW] 제공 원문5233은 화이트25대·블루6대. 본15대 후보는 원문·사진 재확인 전 중복등록 제외.';
      const req={action:'manage-edit',year:2026,week:43,rows:[{deductionKey:q.key,sourceYear:r.OrderYear,sourceWeek:r.OrderWeek,expectedRowVersionNo:r.RowVersionNo}],changes:{note},reason:'자동 저장2건의 원문 불일치. 입력값 삭제 없이 검토 표시만 추가.'};
      await post(api,{...req,preview:true});await post(api,{...req,preview:false});console.log(JSON.stringify({sourceFactHeld:q.key}));
    }
    const d=plan.withdrawPastReplay;const e=(await pool.request().input('key',sql.Int,d.key).query(`SELECT e.*,CONVERT(NVARCHAR(10),e.EstimateDtm,23)AS EstimateDate,sm.CustKey,sm.OrderYear,sm.OrderWeek FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE e.EstimateKey=@key`)).recordset[0];
    if(e){const r=(await pool.request().input('key',sql.Int,plan.replayLedgerKey).query('SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey=@key')).recordset[0];
      const h=(await pool.request().input('key',sql.Int,r.DeductionKey).query(`SELECT HistoryKey,ActionType FROM WebSalesDefectDeductionHistory WHERE DeductionKey=@key ORDER BY HistoryKey`)).recordset;
      const unlink=h.filter(h=>h.ActionType==='ESTIMATE_UNLINK').at(-1)?.HistoryKey;
      if(!unlink||h.some(h=>h.HistoryKey>unlink&&['SOURCE_REVIEW_RELEASE','SOURCE_REVIEW_CONFIRM','MANUAL_SOURCE_CONFIRM'].includes(h.ActionType))||r.OrderYear!==2026||Number(r.OrderWeek)>=42||r.EstimateKey!==10803)throw Error('과거 해제자료 재적용 근거 변경');
      if(Number(e.OrderYear)!==2026||Number(String(e.OrderWeek).split('-')[0])!==43||e.CustKey!==d.cust||e.ProdKey!==d.prod||e.ShipmentKey!==d.shipment||e.Quantity!==d.quantity||e.Cost!==d.cost||e.Amount!==d.amount||e.Vat!==d.vat||e.Unit!==d.unit||e.EstimateType!==d.type||e.EstimateDate!==d.date||hash(e.Descr||'')!==d.descrSha256)throw Error('과거자료 재적용 견적 스냅샷 변경');
      const clientId='manual-origin-repair-'+randomUUID();const scope={orderYear:'2026',orderWeek:'43',custKey:d.cust};const a=await post('/api/erp/edit-presence',{action:'acquire',...scope,clientId,pageCode:'defect-source-reconciliation'});
      const token=a.lease?.token;if(!token||!a.digest)throw Error('편집 보호를 받지 못했습니다.');lease={...scope,editGuard:{clientId,leaseToken:token,expectedDigest:a.digest}};
      await post('/api/estimate/delete-deductions',{...lease,entries:[{estimateKey:e.EstimateKey,shipmentKey:e.ShipmentKey,prodKey:e.ProdKey,expected:{quantity:e.Quantity,cost:e.Cost,amount:e.Amount,vat:e.Vat,unit:e.Unit,estimateType:e.EstimateType,descr:e.Descr||'',estimateDate:e.EstimateDate}}]});console.log(JSON.stringify({pastReplayWithdrawn:10803}));
    }
    const old=(await pool.request().input('key',sql.Int,plan.replayLedgerKey).query('SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey=@key')).recordset[0];
    if(!old.IsDeleted){if(old.EstimateKey)throw Error('과거 재적용 연결이 아직 남았습니다.');const req={action:'manage-archive',year:2026,week:43,rows:[{deductionKey:old.DeductionKey,sourceYear:old.OrderYear,sourceWeek:old.OrderWeek,expectedRowVersionNo:old.RowVersionNo}],reason:'과거40차 자동자료의 삭제해제 이력을 무시한43차 재적용 정리. 수기입력 및 기존 정상 견적 보존.'};await post(api,{...req,preview:true});await post(api,{...req,preview:false});}
    const after=await snapshot();if(protectedBefore!==await protectedSnapshot())throw Error('수기입력 보존 스냅샷에 동시 변경 발생');
    console.log(JSON.stringify({manualInputsUnchanged:true,otherErpPreserved:JSON.stringify(before)===JSON.stringify(after),before,after}));
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('선택외 ERP 원장에 동시 변경 발생: 대조 필요');
  }
}finally{if(lease){try{await post('/api/erp/edit-presence',{action:'release',...lease});}catch{console.log('edit lease release retry needed');}}await pool.close();}
