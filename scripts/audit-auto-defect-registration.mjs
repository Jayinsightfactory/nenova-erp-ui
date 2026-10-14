// Read-only incident audit. Output contains business data: keep it outside Git.
import fs from 'node:fs';
import path from 'node:path';
import sql from 'mssql';
import { buildDefectAutoSourceSql } from '../lib/salesDefectAutoSource.js';
const [envPath, outputDir] = process.argv.slice(2);
if (!envPath || !outputDir) throw new Error('Usage: node script env-file output-directory');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = await sql.connect({server:env.DB_SERVER,port:Number(env.DB_PORT || 1433),database:env.DB_NAME,user:env.DB_USER,password:env.DB_PASSWORD,connectionTimeout:10000,requestTimeout:60000,options:{encrypt:false,trustServerCertificate:true}});
const parse = s => {try{return JSON.parse(s || '{}') || {};}catch{return {};}};
const auto = r => /kakao-defect:/i.test(String(r.SourceFileName ?? r.sourceFileName ?? '')+' '+String(r.Note ?? r.note ?? '')) || /자동처리\s*박성수\s*v[12]/i.test(String(r.Note ?? r.note ?? ''));
try {
  // All years, including archived rows; inspect history so later source edits cannot hide origin.
  const drafts = (await pool.request().query(`SELECT d.*,${buildDefectAutoSourceSql('d').projection},c.CustName AS CurrentCustName,p.ProdName AS CurrentProdName FROM dbo.WebSalesDefectDeduction d LEFT JOIN dbo.Customer c ON c.CustKey=d.CustKey LEFT JOIN dbo.Product p ON p.ProdKey=d.ProdKey`)).recordset;
  const history = (await pool.request().query('SELECT HistoryKey,DeductionKey,ActionType,ChangedBy,ChangedByName,ChangedAt,BeforeJson,AfterJson,ChangeSummary FROM dbo.WebSalesDefectDeductionHistory ORDER BY HistoryKey')).recordset;
  const byKey = new Map();
  for (const h of history) {h.before=parse(h.BeforeJson);h.after=parse(h.AfterJson); const a=byKey.get(h.DeductionKey)||[];a.push(h);byKey.set(h.DeductionKey,a);}
  const candidates = drafts.filter(d=>auto(d)||(byKey.get(d.DeductionKey)||[]).some(h=>auto(h.before)||auto(h.after)));
  const sqlKeys = drafts.filter(d=>d.AutoSourceExcluded).map(d=>d.DeductionKey).sort((a,b)=>a-b);
  const auditKeys = candidates.map(d=>d.DeductionKey).sort((a,b)=>a-b);
  if (JSON.stringify(sqlKeys)!==JSON.stringify(auditKeys)) throw new Error('SQL policy and historical audit disagree: inspect before deployment');
  const keys = [...new Set(candidates.flatMap(d=>[d.EstimateKey,...(byKey.get(d.DeductionKey)||[]).flatMap(h=>[h.before.estimateKey,h.after.estimateKey])]).map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))];
  const estimates = keys.length ? (await pool.request().query(`SELECT e.*,sm.OrderYear,sm.OrderWeek,sm.CustKey,c.CustName,p.ProdName FROM dbo.Estimate e LEFT JOIN dbo.ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey LEFT JOIN dbo.Customer c ON c.CustKey=sm.CustKey LEFT JOIN dbo.Product p ON p.ProdKey=e.ProdKey WHERE e.EstimateKey IN (${keys.join(',')})`)).recordset : [];
  const emap=new Map(estimates.map(e=>[e.EstimateKey,e]));
  const rows=candidates.map(d=>{
    const hs=byKey.get(d.DeductionKey)||[], create=hs.find(h=>h.ActionType==='CREATE'), regs=hs.filter(h=>h.ActionType==='REGISTER_ESTIMATE');
    const ek=[...new Set([d.EstimateKey,...regs.map(h=>h.after.estimateKey)].map(Number).filter(n=>n>0))];
    const live=ek.map(k=>emap.get(k)).filter(Boolean), last=regs.at(-1);
    const origin=hs.find(h=>auto(h.after))?.after;
    return {key:d.DeductionKey,customer:d.CurrentCustName||d.CustName,product:d.CurrentProdName||d.ProdName,sourceYear:d.OrderYear,sourceWeek:d.OrderWeek,quantity:d.Quantity,unit:d.SourceUnit||d.Unit,status:d.Status,archived:d.IsDeleted,confirmed:d.ImportConfirmed,assignedManager:d.CreatedByName,createActor:create?.ChangedByName,createdAt:create?.ChangedAt,registerActor:last?.ChangedByName,registerAccount:last?.ChangedBy,registeredAt:last?.ChangedAt,confirmedAtRegistration:last?.before.importConfirmed,originalNote:origin?.note||d.Note,sourceFile:origin?.sourceFileName||d.SourceFileName,estimateKeys:ek,liveEstimates:live.map(e=>({key:e.EstimateKey,year:e.OrderYear,week:e.OrderWeek,customer:e.CustName,product:e.ProdName,quantity:e.Quantity,unit:e.Unit,cost:e.Cost,amount:e.Amount,vat:e.Vat,date:e.EstimateDtm})),classification:live.length?'등록된 자동자료 — 원문 대조·보정 검토':regs.length?'등록 이력 있으나 견적 없음 — 삭제·해제 이력 확인':'미등록 자동자료 — 재등록 차단 대상',registrationEvents:regs.map(h=>({historyKey:h.HistoryKey,at:h.ChangedAt,actor:h.ChangedByName,account:h.ChangedBy,estimateKey:h.after.estimateKey,importConfirmed:h.before.importConfirmed}))};
  });
  const liveRows=rows.filter(r=>r.liveEstimates.length);
  const groups={}; for(const r of liveRows){const g=groups[r.customer]??={rows:0,totalGross:0};g.rows++;g.totalGross+=r.liveEstimates.reduce((s,e)=>s+Number(e.amount||0)+Number(e.vat||0),0);}
  rows.sort((a,b)=>Number(Boolean(b.liveEstimates.length))-Number(Boolean(a.liveEstimates.length))||a.customer.localeCompare(b.customer,'ko')||a.key-b.key);
  const result={queriedAt:new Date().toISOString(),scope:'All stored years; current source and historical source; SELECT only. Candidate is not a confirmed business error.',counts:{allDrafts:drafts.length,allHistories:history.length,automatic:rows.length,currentSource:candidates.filter(auto).length,historyOnly:candidates.filter(d=>!auto(d)).length,liveRegistered:liveRows.length,other:rows.length-liveRows.length},customers:groups,rows};
  fs.mkdirSync(outputDir,{recursive:true});
  fs.writeFileSync(path.join(outputDir,'audit.json'),JSON.stringify(result,null,2));
  const downstream = (await pool.request().query(`
    SELECT 'ViewOrder' AS Source,COUNT_BIG(*) AS [RowCount] FROM dbo.ViewOrder WHERE OrderYear=2026 AND OrderWeek IN ('41-01','41-02') AND CustKey IN (448,682)
    UNION ALL SELECT 'ViewShipment',COUNT_BIG(*) FROM dbo.ViewShipment WHERE OrderYear=2026 AND OrderWeek IN ('41-01','41-02') AND CustKey IN (448,682)
    UNION ALL SELECT 'ShipmentDate',COUNT_BIG(*) FROM dbo.ShipmentDate dt JOIN dbo.ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN dbo.ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=2026 AND sm.OrderWeek IN ('41-01','41-02') AND sm.CustKey IN (448,682)
    UNION ALL SELECT 'ShipmentFarm',COUNT_BIG(*) FROM dbo.ShipmentFarm f JOIN dbo.ShipmentDetail sd ON sd.SdetailKey=f.SdetailKey JOIN dbo.ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey WHERE sm.OrderYear=2026 AND sm.OrderWeek IN ('41-01','41-02') AND sm.CustKey IN (448,682)
  `)).recordset;
  fs.writeFileSync(path.join(outputDir,'downstream-readonly.json'),JSON.stringify(downstream,null,2));
  const columns=['판정','원장번호','거래처','품목','원차수','원수량','단위','등록견적','적용차수','등록수량','단가','차감금액(부가세포함)','등록계정','등록자','실제등록시각','생성이력계정명','생성시각','배정담당자','등록시수입확인','원문근거'];
  const data=rows.flatMap(r=>(r.liveEstimates.length?r.liveEstimates:[{}]).map(e=>[r.classification,r.key,r.customer,r.product,`${r.sourceYear}/${r.sourceWeek}`,r.quantity,r.unit,e.key||'',e.year?`${e.year}/${e.week}`:'',e.quantity??'',e.cost??'',e.key?Number(e.amount)+Number(e.vat):'',r.registerAccount,r.registerActor,r.registeredAt,r.createActor,r.createdAt,r.assignedManager,String(r.confirmedAtRegistration??''),r.originalNote]));
  const esc=v=>'"'+(typeof v==='string'&&/^[=+@-]/.test(v)?"'"+v:String(v??'')).replace(/"/g,'""')+'"';
  fs.writeFileSync(path.join(outputDir,'전체-자동자료-보정검토목록.csv'),'\uFEFF'+[columns,...data].map(a=>a.map(esc).join(',')).join('\r\n'));
  fs.writeFileSync(path.join(outputDir,'2026-41차-등록자동자료.csv'),'\uFEFF'+[columns,...data.filter(a=>a[8]==='2026/41-01')].map(a=>a.map(esc).join(',')).join('\r\n'));
  const html=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fs.writeFileSync(path.join(outputDir,'보정전-확인목록.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><title>불량 자동자료 보정 전 확인목록</title><style>body{font:15px system-ui;margin:24px;color:#172b4d}table{border-collapse:collapse;width:100%}th,td{border:1px solid #cbd5e1;padding:8px;text-align:left}th{background:#e8eef8;position:sticky;top:0}small{color:#58677d}.warn{background:#fff3cd;padding:16px}input{padding:10px;width:400px}</style><h1>불량 자동자료 · 보정 전 확인목록</h1><p class="warn">운영 자료는 변경하지 않았습니다. 아래는 같은 자동처리 경로로 등록된 보정 검토 후보입니다. 실제 잘못된 차감인지는 원문 및 담당자 확인 후 확정해야 합니다.</p><p>전체 원장 ${drafts.length}건 / 자동자료 ${rows.length}건 / 견적이 현재 남은 자동자료 ${liveRows.length}건</p><p>생성계정·배정담당자·등록계정은 서로 다른 의미입니다. 견적일이 아니라 감사 이력의 실제 등록시각을 표시했습니다.</p><input id="q" placeholder="업체·품목·차수 검색" aria-label="목록 검색"><table><thead><tr>${columns.map(c=>`<th>${html(c)}</th>`).join('')}</tr></thead><tbody>${data.map(a=>`<tr>${a.map(v=>`<td>${html(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>document.querySelector('#q').addEventListener('input',e=>{for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(e.target.value.toLowerCase())})</script></html>`);
  console.log(JSON.stringify({counts:result.counts,customers:groups,outputDir},null,2));
} finally {await pool.close();}
