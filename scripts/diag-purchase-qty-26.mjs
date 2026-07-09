// 26차 매입수량 단위 진단 — WarehouseDetail 각 수량컬럼 합계를 엑셀 구매현황 D열 합계와 대조 (읽기 전용)
import fs from 'fs';
import path from 'path';
for (const f of ['.env.local', '.env']) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const { default: sql } = await import('mssql');
const pool = await sql.connect({
  server: process.env.DB_SERVER, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
});
const CASE_CATEGORY = `
  CASE
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN N'콜롬비아 수국'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.CounName,'') LIKE N'%네덜란드%' THEN N'네덜란드'
    WHEN ISNULL(p.CounName,'') LIKE N'%호주%' THEN N'호주'
    WHEN ISNULL(p.CounName,'') LIKE N'%태국%' THEN N'태국'
    WHEN ISNULL(p.CounName,'') LIKE N'%중국%' THEN N'중국'
    WHEN ISNULL(p.CounName,'') LIKE N'%에콰도르%' THEN N'에콰도르'
    WHEN ISNULL(p.CounName,'') LIKE N'%미국%' THEN N'미국'
    WHEN ISNULL(p.CounName,'') LIKE N'%이스라엘%' THEN N'이스라엘'
    WHEN ISNULL(p.CounName,'') LIKE N'%뉴질랜드%' THEN N'뉴질랜드'
    WHEN ISNULL(p.CounName,'') LIKE N'%일본%' THEN N'일본'
    WHEN ISNULL(p.CounName,'') LIKE N'%베트남%' THEN N'베트남'
    ELSE N'기타(미분류)'
  END`;
const r = await pool.request().query(`
  SELECT ${CASE_CATEGORY} AS Category,
         SUM(ISNULL(wd.BoxQuantity,0)) AS box,
         SUM(ISNULL(wd.BunchQuantity,0)) AS bunch,
         SUM(ISNULL(wd.SteamQuantity,0)) AS steam,
         SUM(ISNULL(wd.OutQuantity,0)) AS outq,
         SUM(ISNULL(wd.EstQuantity,0)) AS estq,
         SUM(CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN
                    CASE WHEN ISNULL(wd.BunchQuantity,0) > 0 THEN wd.BunchQuantity ELSE ISNULL(wd.BoxQuantity,0)*p.BunchOf1Box END
                  WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN
                    CASE WHEN ISNULL(wd.SteamQuantity,0) > 0 THEN wd.SteamQuantity
                         WHEN ISNULL(wd.BunchQuantity,0) > 0 AND ISNULL(wd.SteamOf1Bunch,0) > 0 THEN wd.BunchQuantity*wd.SteamOf1Bunch
                         ELSE ISNULL(wd.BoxQuantity,0)*p.SteamOf1Box END
                  ELSE ISNULL(wd.BoxQuantity,0) END) AS bunchFirst,
         COUNT(*) AS lines
    FROM WarehouseDetail wd
    JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
    LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
   WHERE wm.OrderWeek LIKE '26-%' AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = '2026'
   GROUP BY ${CASE_CATEGORY} ORDER BY 1`);
const EXCEL = { '콜롬비아 수국':23090,'콜롬비아 카네이션':7485,'콜롬비아 장미':2336,'콜롬비아 알스트로':3200,'네덜란드':5585,'중국':1155,'에콰도르':1400,'베트남':1600,'태국':1950,'콜롬비아 루스커스':675 };
console.log('카테고리 | 엑셀D | box | bunch | steam | out | est | bunchFirst | 행수');
for (const x of r.recordset) {
  console.log(`${x.Category} | ${EXCEL[x.Category] ?? '-'} | ${x.box} | ${x.bunch} | ${x.steam} | ${x.outq} | ${x.estq} | ${x.bunchFirst} | ${x.lines}`);
}
await pool.close();
