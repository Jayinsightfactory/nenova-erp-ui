// 정산서 농장 정식명 매핑 시드 v2 — (차수+인보이스) 복합키 다수결. 선행0 제거 정규화.
import * as XLSX from 'xlsx';
import fs from 'fs';
fs.readFileSync('.env.local','utf8').split(/\r?\n/).forEach(l=>{const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);if(m)process.env[m[1]]=m[2];});
const sql=(await import('mssql')).default;
const buf = fs.readFileSync(String.raw`C:\Users\USER\Documents\카카오톡 받은 파일\26.07월 결제 (4).xlsx`);
const wb = XLSX.read(buf, { type: 'buffer' });
const pool=await sql.connect({server:process.env.DB_SERVER,port:+(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,options:{encrypt:false,trustServerCertificate:true}});
const db=(await pool.request().query(`
  SELECT wm.OrderWeek AS wk, LTRIM(RTRIM(ISNULL(wm.InvoiceNo,''))) AS inv, LTRIM(RTRIM(ISNULL(wm.FarmName,''))) AS farm,
         ROUND(SUM(wd.TPrice),2) AS total
    FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
   WHERE wm.isDeleted=0 AND CAST(wm.OrderYear AS NVARCHAR(4))='2026'
   GROUP BY wm.OrderWeek, LTRIM(RTRIM(ISNULL(wm.InvoiceNo,''))), LTRIM(RTRIM(ISNULL(wm.FarmName,'')))`)).recordset;
const normInv = s => String(s||'').trim().replace(/^0+/,'').toUpperCase();
const wkFromTag = t => { const m = String(t||'').match(/^(\d{1,2})-(\d)/); return m ? `${m[1].padStart(2,'0')}-0${m[2]}` : ''; };
const byKey = {};   // week|inv → [{farm,total}]
db.forEach(r=>{ if(r.inv) (byKey[`${r.wk}|${normInv(r.inv)}`] ||= []).push(r); });
const votes = {};   // dbFarm → { payName: count }
for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '' });
  for (let i=2;i<rows.length;i++){
    const [dn, farm, item, amt, tag, inv] = rows[i];
    if (!farm || String(farm).includes('계') || String(dn).includes('계')) continue;
    if (/claim/i.test(String(item)) || String(inv)==='은행수수료' || !inv) continue;
    const wk = wkFromTag(tag);
    if (!wk) continue;
    const cands = byKey[`${wk}|${normInv(inv)}`] || [];
    // 금액까지 일치하는 후보만 채택 (복합키 유일성 보강)
    const exact = cands.filter(c => Math.abs(Number(c.total) - Number(amt)) < 0.51);
    const use = exact.length ? exact : (cands.length === 1 ? cands : []);
    for (const c of use) {
      (votes[c.farm] ||= {});
      votes[c.farm][String(farm).trim()] = (votes[c.farm][String(farm).trim()]||0) + 1;
    }
  }
}
const mapping = {}; const report = [];
for (const [dbFarm, v] of Object.entries(votes)) {
  const best = Object.entries(v).sort((a,b)=>b[1]-a[1])[0];
  const totalVotes = Object.values(v).reduce((s,n)=>s+n,0);
  mapping[dbFarm] = best[0];
  report.push(`${dbFarm} → ${best[0]} (${best[1]}/${totalVotes}표${Object.keys(v).length>1?' ⚠경합:'+JSON.stringify(v):''})`);
}
report.sort().forEach(r=>console.log(' ', r));
fs.writeFileSync('data/import-farm-paynames.json', JSON.stringify(mapping, null, 2));
console.log('\n저장:', Object.keys(mapping).length, '건 → data/import-farm-paynames.json');
await pool.close();
