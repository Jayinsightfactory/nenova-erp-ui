// Fixed operator plan, SELECT-only by default; --apply after verified deployment.
// Uses existing audited Estimate deletion + ERP edit lease, never direct ERP SQL.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { parseDefectSourceExport } from '../lib/defectSourceExport.js';
import { assertDefectSourceFacts } from '../lib/defectSourceFacts.js';
const require=createRequire('C:/Users/USER/nenova-erp-ui/package.json');
const sql=require('mssql');process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const hash=v=>createHash('sha256').update(v).digest('hex');
const plan=JSON.parse(await fs.readFile(new URL('../docs/audits/defect-current-42-source-2026-10-28.json',import.meta.url),'utf8'));
const source=await fs.readFile('C:/Users/USER/Downloads/KakaoTalk_20261028_1552_47_184_group.txt','utf8');
if(hash(source)!==plan.sourceSha256)throw Error('원문 검토본이 변경됐습니다.');
const messages=parseDefectSourceExport(source);
for(const d of [...plan.confirm,...plan.drafts]){
  if(hash(messages[d.ordinal-1]?.content||'')!==d.sha)throw Error('원문 항목이 변경됐습니다.');
  assertDefectSourceFacts(messages[d.ordinal-1].content,d.sourceFacts);
}
const pool=await new sql.ConnectionPool({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000}).connect();
const api=async(path,body)=>{
  const r=await fetch(new URL(path,process.env.NENOVAWEB_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.NENOVAWEB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const j=await r.json();if(!r.ok||!j.success)throw Error(`운영 API 실패 HTTP ${r.status} code=${j.code||'API_ERROR'}`);return j;
};
const ledgerApi='/api/sales/defect-deductions';
const leases=[];
try {
  const liveRows=(await pool.request().query(`SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey IN(${plan.archive.map(r=>r.key).join(',')})`)).recordset;
  const archives=[];
  for(const d of plan.archive){const r=liveRows.find(r=>r.DeductionKey===d.key);
    if(!r||r.OrderYear!==d.year||r.OrderWeek!==d.week||r.CustKey!==d.cust||r.ProdKey!==d.prod||Number(r.Quantity)!==d.qty||r.SourceUnit!==d.unit)throw Error(`원장 업무키 변경 ${d.key}`);
    if(r.IsDeleted)continue;if(r.RowVersionNo!==d.version||r.EstimateKey!==d.estimate)throw Error(`원장 버전 변경 ${d.key}`);
    archives.push({deductionKey:d.key,sourceYear:d.year,sourceWeek:d.week,expectedRowVersionNo:d.version});
  }
  const quoteRows=(await pool.request().query(`SELECT e.*,CONVERT(NVARCHAR(10),e.EstimateDtm,23) AS EstimateDate,sm.CustKey,sm.OrderYear,sm.OrderWeek FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE e.EstimateKey IN(${plan.withdraw.map(e=>e.key).join(',')})`)).recordset;
  for(const d of plan.withdraw){const e=quoteRows.find(e=>e.EstimateKey===d.key);if(!e)continue;
    if(e.CustKey!==d.cust||e.ProdKey!==d.prod||e.ShipmentKey!==d.shipment||Number(e.OrderYear)!==2026||!String(e.OrderWeek).startsWith('43-')
      ||e.Quantity!==d.quantity||e.Cost!==d.cost||e.Amount!==d.amount||e.Vat!==d.vat||e.Unit!==d.unit||e.EstimateType!==d.type||e.EstimateDate!==d.date||hash(e.Descr||'')!==d.descrSha256)throw Error(`삭제 견적 스냅샷 변경 ${d.key}`);
  }
  const snapshot=async(excludeSelected=false)=>{
    const result={};
    const queries={Estimate:`SELECT e.* FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(533,565) ${excludeSelected?`AND e.EstimateKey NOT IN(${plan.withdraw.map(e=>e.key).join(',')})`:''}`,
      ShipmentDetail:`SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(533,565)`,
      ShipmentDate:`SELECT dt.* FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(533,565)`,
      ViewOrder:`SELECT * FROM ViewOrder WHERE OrderYear='2026' AND CustKey IN(533,565)`,ViewShipment:`SELECT * FROM ViewShipment WHERE OrderYear='2026' AND CustKey IN(533,565)`};
    for(const [name,q] of Object.entries(queries))result[name]=(await pool.request().query(`SELECT COUNT_BIG(*) AS N,CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS Fingerprint FROM(${q})probe`)).recordset[0];return result;
  };
  const before=await snapshot(true);
  const ratios=(await pool.request().query('SELECT ProdKey,SteamOf1Bunch,SteamOf1Box FROM Product WHERE ProdKey IN(53,3208)')).recordset;
  if(Number(ratios.find(r=>r.ProdKey===53)?.SteamOf1Bunch)!==10 || Number(ratios.find(r=>r.ProdKey===3208)?.SteamOf1Box)!==30)throw Error('검증한 품목 환산기준이 변경됐습니다.');
  const fullClaim=(await pool.request().query(`SELECT SUM(sd.BunchQuantity) AS Quantity FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.OrderWeek='43-01' AND sm.CustKey=565 AND sd.ProdKey=2328 AND ISNULL(sm.isDeleted,0)=0`)).recordset[0];
  if(Number(fullClaim.Quantity)!==20)throw Error('전량 신고의 43-01 실제 출고수량이 변경됐습니다.');
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'audit',archive:archives.length,withdrawQuotes:quoteRows.length,keepQuotes:plan.confirm.length,drafts:plan.drafts.length}));
  if(!process.argv.includes('--apply'))process.exitCode=0;
  else {
    // Acquire both customer scopes before changing any ledger; never force takeover.
    for(const cust of [...new Set(quoteRows.map(e=>e.CustKey))]){
      const clientId='source-repair-'+randomUUID();const scope={orderYear:'2026',orderWeek:'43',custKey:cust};
      const status=await api('/api/erp/edit-presence',{action:'acquire',...scope,clientId,pageCode:'estimate-source-reconciliation'});
      const token=status.lease?.token||status.lease?.leaseToken;
      if(!token||!status.digest)throw Error('편집 보호 lease/digest를 받지 못했습니다.');
      leases.push({...scope,editGuard:{leaseToken:token,clientId,expectedDigest:status.digest}});
    }
    if(archives.length){const request={action:'manage-archive',year:2026,week:43,rows:archives,reason:`사용자 42차 이후 우선 지시. 원문 대조한 현재 오등록/중복·유실 연결 원장 정리. 원문SHA ${plan.sourceSha256}. 실제 견적의 선택 정정은 별도 감사 API로 수행.`};
      const preview=await api(ledgerApi,{...request,preview:true});if(preview.rows.length!==archives.length)throw Error('archive preview count mismatch');
      const applied=await api(ledgerApi,{...request,preview:false});console.log(JSON.stringify({archived:applied.archived}));}
    for(const lease of leases){const entries=quoteRows.filter(e=>e.CustKey===lease.custKey).map(e=>({estimateKey:e.EstimateKey,shipmentKey:e.ShipmentKey,prodKey:e.ProdKey,expected:{quantity:e.Quantity,cost:e.Cost,amount:e.Amount,vat:e.Vat,unit:e.Unit,estimateType:e.EstimateType,descr:e.Descr||'',estimateDate:e.EstimateDate}}));
      if(entries.length){await api('/api/estimate/delete-deductions',{...lease,entries});console.log(JSON.stringify({withdrawn:entries.map(e=>e.estimateKey)}));}}
    // Confirm only actual, current matching estimates; never detach or modify them.
    const confirms=[];
    for(const d of plan.confirm){const r=(await pool.request().input('key',sql.Int,d.key).query('SELECT RowVersionNo FROM WebSalesDefectDeduction WHERE DeductionKey=@key')).recordset[0];
      const already=(await pool.request().input('key',sql.Int,d.key).query(`SELECT TOP 1 HistoryKey FROM WebSalesDefectDeductionHistory WHERE DeductionKey=@key AND ActionType=N'SOURCE_REVIEW_CONFIRM'`)).recordset.length;
      if(already)continue;if(r.RowVersionNo!==d.version)throw Error('confirmation version changed');
      confirms.push({deductionKey:d.key,expectedRowVersionNo:d.version,evidence:{sourceSha256:plan.sourceSha256,messageSha256:d.sha,messageOrdinal:d.ordinal,sourceYear:2026,sourceWeek:d.sourceWeek,custKey:d.cust,prodKey:d.prod,quantity:d.quantity,sourceUnit:d.unit,reason:'42차 이후 원문·실제 견적의 업체/품목/수량/단위 일치 확인. 박스 환산은 Product.SteamOf1Box=30 확인. 기존 실제 견적 보존.'}});}
    if(confirms.length){await api(ledgerApi,{action:'review-source',mode:'confirm-linked',year:2026,week:43,rows:confirms,preview:true});await api(ledgerApi,{action:'review-source',mode:'confirm-linked',year:2026,week:43,rows:confirms,preview:false});console.log(JSON.stringify({confirmed:confirms.map(r=>r.deductionKey)}));}
    for(const d of plan.drafts){const marker=`kakao-defect:review-${plan.sourceSha256.slice(0,12)}-${d.ordinal}-${d.prod}`;
      const existing=(await pool.request().input('marker',sql.NVarChar,marker).query('SELECT DeductionKey,CustKey,ProdKey,Quantity,SourceUnit FROM WebSalesDefectDeduction WHERE IsDeleted=0 AND SourceFileName=@marker')).recordset;
      if(existing.length){if(existing.length!==1||existing[0].CustKey!==d.cust||existing[0].ProdKey!==d.prod||Number(existing[0].Quantity)!==d.quantity||existing[0].SourceUnit!==d.unit)throw Error('복원 후보의 업무키가 변경됐습니다.');console.log(JSON.stringify({existingDraft:existing.map(r=>r.DeductionKey)}));continue;}
      const product=(await pool.request().input('pk',sql.Int,d.prod).query('SELECT ProdName FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0')).recordset[0];
      const customer=(await pool.request().input('ck',sql.Int,d.cust).query('SELECT CustName FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0')).recordset[0];
      if(!product||!customer)throw Error('active master changed');
      const owner=liveRows.find(r=>r.CustKey===d.cust);
      const note=`${marker}:1 / 원차수 ${d.sourceWeek}-1 / 원문 ${messages[d.ordinal-1].stamp} / 원문 ${d.original} / 원문SHA ${plan.sourceSha256}${d.unitReview?' / [SOURCE_UNIT_REVIEW]':''}`;
      const saved=await api(ledgerApi,{action:'save',year:2026,week:43,managerId:owner?.CreatedBy||'',managerName:owner?.CreatedByName||'',sourceFileName:marker,rows:[{custKey:d.cust,customerName:customer.CustName,prodKey:d.prod,productName:product.ProdName,quantity:d.quantity,sourceUnit:d.unit,deductionType:'불량차감',note}]});
      if(saved.saved!==1||saved.rows?.length!==1)throw Error('draft save count mismatch');console.log(JSON.stringify({draft:saved.rows.map(r=>r.deductionKey)}));
    }
    const after=await snapshot(true);console.log(JSON.stringify({otherErpPreserved:JSON.stringify(before)===JSON.stringify(after),before,after}));
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('다른 ERP 원장 동시 변경 감지: 전후 대조 필요');
    const remaining=(await pool.request().query(`SELECT EstimateKey FROM Estimate WHERE EstimateKey IN(${plan.withdraw.map(e=>e.key).join(',')})`)).recordset;if(remaining.length)throw Error('선택 오등록 견적 삭제 검증 실패');
  }
} finally {
  for(const lease of leases){try{await api('/api/erp/edit-presence',{action:'release',...lease});}catch{console.log(JSON.stringify({leaseRelease:'retry-needed',custKey:lease.custKey}));}}
  await pool.close();
}
