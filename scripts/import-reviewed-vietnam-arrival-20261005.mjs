// Default is read-only. --apply only after deployment of the year/week parser guard.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2];
}
const {query,getPool}=await import('../lib/db.js');
const {parseArrivalCostWorkbook}=await import('../lib/arrivalCostExcel.js');
const {scopeArrivalDriveRows}=await import('../lib/arrivalDrivePolicy.js');
const {createArrivalCostImport}=await import('../lib/arrivalCost.js');
const source={id:'muaqgpob-1fef42',sha:'1fef429027f11afa8ea65fadd2a4f3902ddd646349d7f9477e243a33f2ca9128',
  filename:'VT SUNPRIDE (RB)원가자료 (2026) (38-1).xlsx',year:'2026',week:'38-1',country:'베트남',
  modified:Date.parse('2026-09-17T01:36:06.038Z'),family:'vt sunpride (rb)원가자료 (2026) (38-1).xlsx'};
try {
  const bytes=fs.readFileSync(path.join(process.env.TEMP,'arrival-audit-'+source.id+'.xlsx'));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha)throw Error('Reviewed source hash mismatch');
  const products=(await query('SELECT ProdKey,ProdName,DisplayName,FlowerName,CounName,OutUnit,BunchOf1Box,SteamOf1Box,BoxWeight,BoxCBM FROM Product WHERE isDeleted=0')).recordset;
  const farms=(await query('SELECT FarmKey,FarmName,CounKey FROM Farm WHERE isDeleted=0')).recordset;
  const workbook=parseArrivalCostWorkbook(bytes,{fileName:source.filename,orderYear:'2026',products,farms,mappings:{}});
  const parsed=scopeArrivalDriveRows(workbook,source);
  const current=(await query(`SELECT COUNT(*) AS n FROM WebArrivalCostLine WHERE OrderYear=N'2026' AND CountryName IN(N'베트남',N'') AND IsCurrent=1`)).recordset[0].n;
  if(current)throw Error('Existing current scope: preserve and review instead of replacing');
  if(parsed.rows.length!==1||parsed.rows[0].prodKey!==3074||parsed.rows[0].sourceRow!==19||Math.abs(parsed.rows[0].sourceArrivalCostKRW-10191.9375)>0.0001)throw Error('Reviewed row identity changed');
  if(workbook.rows.length!==28)throw Error('Reviewed workbook row count changed');
  const plans=[...new Set(workbook.rows.map(r=>r.orderWeek))].map(week=>({source:{...source,week},parsed:scopeArrivalDriveRows(workbook,{...source,week})}));
  if(plans.some(p=>Number(p.source.week.split('-')[0])>38))throw Error('Unexpected future scope');
  const hotelSQL=`SELECT m.PnlKey,m.OrderYear,m.MajorWeek,m.PartnerCode,i.ItemKey,i.ProdKey,i.CostPrice,i.Qty,i.SaleAmount FROM WebRaumPnl m JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey WHERE m.isDeleted=0 ORDER BY m.PnlKey,i.ItemKey`;
  const before=JSON.stringify((await query(hotelSQL)).recordset);
  console.log(JSON.stringify({mode:process.argv.includes('--apply')?'apply':'review',source,rowCount:workbook.rows.length,unmatched:workbook.rows.filter(r=>!r.prodKey).length,plans:plans.map(p=>({week:p.source.week,rows:p.parsed.rows.length})),current}));
  if(process.argv.includes('--apply')){
    const result=[];
    // Each reviewed sheet scope reuses the transaction's year/week/manual-current guard.
    // A failure stops subsequent scopes; completed scopes retain their import/hash audit.
    for(const plan of plans) result.push(await createArrivalCostImport({parsed:plan.parsed,fileName:source.filename,user:{userId:'nenovaSS3',userName:'검토된 베트남 과거 원가 등록'},orderYear:'2026',driveSource:plan.source}));
    if(before!==JSON.stringify((await query(hotelSQL)).recordset))throw Error('Hotel snapshot changed; inspect concurrent activity');
    console.log(JSON.stringify({result,hotelPreserved:true}));
  }
}finally{await (await getPool()).close();}
