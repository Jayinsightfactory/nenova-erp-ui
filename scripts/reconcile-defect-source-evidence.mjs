// Default SELECT/preview only. --apply requires the exact user-supplied source
// and versioned 92-row audit plan. Never creates/deletes/changes an Estimate.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseDefectSourceExport } from '../lib/defectSourceExport.js';
const require = createRequire('C:/Users/USER/nenova-erp-ui/package.json');
const sql = require('mssql');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const hash = value => createHash('sha256').update(value).digest('hex');
const planText = await fs.readFile(new URL('../docs/audits/defect-source-92-2026-10-28.json', import.meta.url), 'utf8');
const plan = JSON.parse(planText);
const sourcePath = process.argv.find(arg => arg.startsWith('--source='))?.slice(9);
if (!sourcePath) throw new Error('사용자가 제공한 원문 파일을 --source=절대경로로 지정하세요.');
const source = await fs.readFile(sourcePath, 'utf8');
if (hash(source) !== plan.sourceSha256) throw new Error('원문 파일 지문이 검토본과 다릅니다.');
const messages = parseDefectSourceExport(source);
if (messages.length !== plan.sourceMessageCount || plan.decisions.length !== 92 || new Set(plan.decisions.map(d=>d.deductionKey)).size !== 92) throw new Error('원문/계획 범위가 변경됐습니다.');
const pool = await new sql.ConnectionPool({ server: process.env.DB_SERVER, port:Number(process.env.DB_PORT||1433), database:process.env.DB_NAME,
  user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000 }).connect();
try {
  const keys = plan.decisions.map(d=>d.deductionKey);
  const rows = (await pool.request().query(`SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey IN (${keys.join(',')})`)).recordset;
  const pending = [];
  for (const d of plan.decisions) {
    const row = rows.find(r=>r.DeductionKey===d.deductionKey);
    if (!row || Number(row.OrderYear)!==d.sourceYear || String(row.OrderWeek)!==String(d.sourceWeek)
      || row.CustKey!==d.custKey || row.ProdKey!==d.prodKey || Number(row.Quantity)!==d.quantity || row.SourceUnit!==d.sourceUnit) throw new Error(`업무키가 변경됐습니다: ${d.deductionKey}`);
    if (d.messageOrdinal && hash(messages[d.messageOrdinal-1]?.content||'')!==d.messageSha256) throw new Error(`원문 항목이 변경됐습니다: ${d.deductionKey}`);
    if (d.canonicalEstimate) {
      const c=d.canonicalEstimate;
      const actual=(await pool.request().input('ek',sql.Int,c.key).query(`SELECT e.ProdKey,e.Quantity,e.Unit,sm.CustKey,sm.OrderYear,sm.OrderWeek FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE e.EstimateKey=@ek AND ISNULL(sm.isDeleted,0)=0`)).recordset[0];
      if (!actual || actual.ProdKey!==c.prodKey || actual.CustKey!==c.custKey || Number(actual.OrderYear)!==c.year || actual.OrderWeek!==c.week || Number(actual.Quantity)!==c.quantity || actual.Unit!==c.unit) throw new Error(`보존 견적이 변경됐습니다: ${d.deductionKey}`);
    }
    if (d.action==='hold' || row.IsDeleted) continue;
    // A successfully released row is recognized by its audit, never by status alone.
    if (d.action==='release' && row.RowVersionNo!==d.expectedRowVersionNo) {
      const done=(await pool.request().input('key',sql.Int,d.deductionKey).query(`SELECT TOP 1 AfterJson FROM WebSalesDefectDeductionHistory WHERE DeductionKey=@key AND ActionType=N'SOURCE_REVIEW_RELEASE' ORDER BY HistoryKey DESC`)).recordset[0];
      if (done && JSON.parse(done.AfterJson).sourceReviewEvidence?.sourceSha256===plan.sourceSha256) continue;
    }
    if (row.RowVersionNo!==d.expectedRowVersionNo || row.EstimateKey!==d.expectedEstimateKey) throw new Error(`조회 버전이 변경됐습니다: ${d.deductionKey}`);
    pending.push(d);
  }
  const api = async(body)=>{
    const response=await fetch(new URL('/api/sales/defect-deductions',process.env.NENOVAWEB_URL),{method:'POST',headers:{Authorization:`Bearer ${process.env.NENOVAWEB_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    const result=await response.json(); if(!response.ok || !result.success) throw new Error(`원문 정리 API 실패: HTTP ${response.status}: ${result.error||''}`); return result;
  };
  const archive = pending.filter(d=>d.action==='archive');
  const release = pending.filter(d=>d.action==='release');
  const requests=[];
  if(archive.length) requests.push({action:'manage-archive',year:plan.year,week:plan.week,
    rows:archive.map(d=>({deductionKey:d.deductionKey,sourceYear:d.sourceYear,sourceWeek:d.sourceWeek,expectedRowVersionNo:d.expectedRowVersionNo})),
    reason:`사용자 제공 원문 전수대조: 중복/단위·규격 오연결 후보 정리. 원문SHA ${plan.sourceSha256}; 검토계획SHA ${hash(planText)}. 실제견적·ERP·적용이력 보존.`});
  if(release.length) requests.push({action:'review-source',year:plan.year,week:plan.week,rows:release.map(d=>({deductionKey:d.deductionKey,expectedRowVersionNo:d.expectedRowVersionNo,
    evidence:{sourceSha256:plan.sourceSha256,messageSha256:d.messageSha256,messageOrdinal:d.messageOrdinal,sourceYear:2026,sourceWeek:d.originalParentWeek,custKey:d.custKey,prodKey:d.prodKey,quantity:d.quantity,sourceUnit:d.sourceUnit,reason:'사용자 제공 카톡 원문 업체·품목·수량·단위 일치 및 실제 견적 미존재 대조 완료. 정상 후보로 복원하며 일괄등록 전 중복·EXE 조건 재검증.'}}))});
  if(process.argv.includes('--audit-only') && process.argv.includes('--apply')) throw new Error('audit-only와 apply를 함께 지정할 수 없습니다.');
  if(!process.argv.includes('--audit-only')) for(const request of requests){const preview=await api({...request,preview:true});if(preview.rows?.length!==request.rows.length)throw new Error('미리보기 건수 불일치');}
  const custs=[...new Set(plan.decisions.map(d=>d.custKey))].join(',');
  const snapshot = async()=>{
    const sources={Estimate:`SELECT e.* FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,ShipmentDetail:`SELECT sd.* FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,ShipmentDate:`SELECT dt.* FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear='2026' AND sm.CustKey IN(${custs})`,ViewOrder:`SELECT * FROM ViewOrder WHERE OrderYear='2026' AND CustKey IN(${custs})`,ViewShipment:`SELECT * FROM ViewShipment WHERE OrderYear='2026' AND CustKey IN(${custs})`};
    const result={};for(const [name,q] of Object.entries(sources)){result[name]=(await pool.request().query(`SELECT COUNT_BIG(*) AS N,CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS Fingerprint FROM (${q}) probe`)).recordset[0];}return result;
  };
  console.log(JSON.stringify({sourceMessages:messages.length,archive:archive.length,release:release.length,hold:plan.decisions.filter(d=>d.action==='hold').length,mode:process.argv.includes('--apply')?'apply':'preview'}));
  if(process.argv.includes('--apply')){
    const before=await snapshot();
    for(const request of requests){const applied=await api({...request,preview:false});console.log(JSON.stringify({action:request.action,archived:applied.archived,released:applied.released,keys:applied.rows.map(r=>r.deductionKey)}));}
    const after=await snapshot();console.log(JSON.stringify({erpPreserved:JSON.stringify(before)===JSON.stringify(after),before,after}));
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('동시 ERP 원장 변경 감지: 전후 대조 필요');
  }
} finally { await pool.close(); }
