// 골든 테스트: 강명훈 '매출원가 양식 - N차' 워크북의 원천시트(판매현황/불량차감/그 외 매출액/구매현황) ↔ ERP DB 재생성 대조. READ-ONLY.
// 사용: node scripts/golden/profit-workbook.mjs [xlsx경로] [연도] [차수]
import { createRequire } from 'module'; import path from 'path'; import os from 'os';
const require = createRequire(import.meta.url); const XLSX = require('xlsx'); const { q, close } = require('./_db.js');
const file = process.argv[2] || path.join(os.homedir(), 'Documents/카카오톡 받은 파일/매출원가 양식 - 28차_재고수정.xlsx');
const year = process.argv[3] || '2026', wk = (process.argv[4] || '28').padStart(2, '0');
const wb = XLSX.readFile(file); const rows = (s, hdr) => XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, defval: null }).slice(hdr);
const norm = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const cust = (s) => norm(s).replace(/\(.*?\)/g, '') || norm(s); // 거래처: 괄호 별칭 제거(엑셀 '아이엠' = DB '아이엠 (I am)'+'아이엠(미우)')
const inv = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
const add = (m, k, o) => { const t = m.get(k) || {}; for (const [a, v] of Object.entries(o)) t[a] = (t[a] || 0) + (+v || 0); m.set(k, t); };
function cmp(name, X, D, fields, tol = 1) {
  let cells = 0, ok = 0, onlyX = 0, onlyD = 0; const bad = [];
  for (const [k, x] of X) { const d = D.get(k); if (!d) { onlyX++; cells += fields.length; if (bad.length < 6) bad.push(['엑셀만', k, x]); continue; }
    for (const f of fields) { cells++; if (Math.abs((x[f] || 0) - (d[f] || 0)) <= tol) ok++; else if (bad.length < 12) bad.push(['불일치', k, f, x[f], d[f]]); } }
  for (const k of D.keys()) if (!X.has(k)) onlyD++;
  const sx = [...X.values()].reduce((a, v) => a + (v[fields[fields.length - 1]] || 0), 0), sd = [...D.values()].reduce((a, v) => a + (v[fields[fields.length - 1]] || 0), 0);
  console.log(`\n[${name}] 키 엑셀 ${X.size} / DB ${D.size} | 엑셀만 ${onlyX} DB만 ${onlyD} | 셀일치 ${ok}/${cells} = ${(100 * ok / Math.max(cells, 1)).toFixed(1)}% | 합계 ${fields.at(-1)} 엑셀 ${Math.round(sx)} DB ${Math.round(sd)}`);
  bad.forEach((b) => console.log('  ', JSON.stringify(b)));
}
const W = { y: year, w: `${wk}-%` };
// A. 판매현황: 거래처×품목 → 수량/공급가액/부가세 (금액=저장 sd.Amount)
{ const X = new Map(); for (const r of rows('판매현황', 3)) { if (!r[0] || !r[1] || /계$/.test(r[0])) continue; add(X, cust(r[0]) + '|' + norm(r[1]), { qty: r[2], supply: r[4], vat: r[5] }); }
  const db = await q(`SELECT c.CustName, p.ProdName, SUM(sd.EstQuantity) qty, SUM(sd.Amount) supply, SUM(sd.Vat) vat FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Customer c ON c.CustKey=sm.CustKey JOIN Product p ON p.ProdKey=sd.ProdKey WHERE sm.isDeleted=0 AND sm.OrderYear=@y AND sm.OrderWeek LIKE @w GROUP BY c.CustName,p.ProdName HAVING SUM(sd.Amount)<>0 OR SUM(sd.OutQuantity)<>0`, W);
  const D = new Map(); db.forEach((r) => add(D, cust(r.CustName) + '|' + norm(r.ProdName), r)); cmp('판매현황 거래처×품목', X, D, ['qty', 'vat', 'supply']);
  const XC = new Map(), DC = new Map(); for (const [k, v] of X) add(XC, k.split('|')[0], v); for (const [k, v] of D) add(DC, k.split('|')[0], v); cmp('판매현황 거래처 합계', XC, DC, ['supply']); }
// B. 불량차감 + 그 외 매출액(검역차감 등) ↔ Estimate(음수 차감)
{ const X = new Map(); for (const s of ['불량차감', '그 외 매출액']) for (const r of rows(s, 2)) { if (!r[1] || typeof r[5] !== 'number') continue; add(X, cust(r[1]) + '|' + norm(r[8]), { qty: r[3], supply: r[5] }); }
  const db = await q(`SELECT c.CustName, p.ProdName, SUM(e.Quantity) qty, SUM(e.Amount) supply FROM ShipmentMaster sm JOIN Estimate e ON e.ShipmentKey=sm.ShipmentKey JOIN Customer c ON c.CustKey=sm.CustKey LEFT JOIN Product p ON p.ProdKey=e.ProdKey
    WHERE sm.isDeleted=0 AND sm.OrderYear=@y AND sm.OrderWeek LIKE @w GROUP BY c.CustName, p.ProdName`, W);
  const D = new Map(); db.forEach((r) => add(D, cust(r.CustName) + '|' + norm(r.ProdName), r)); cmp('차감(불량/검역 등) 거래처×품목', X, D, ['qty', 'supply']); }
// C. 구매현황 ↔ 입고(WarehouseMaster/Detail): 농장×인보이스 → 외화금액
{ const X = new Map(); for (const r of rows('구매현황', 2)) { if (!r[1] || typeof r[6] !== 'number') continue; add(X, norm(r[1]).slice(0, 4) + '|' + inv(r[11]), { usd: r[6] }); }
  const db = await q(`SELECT wm.FarmName, wm.InvoiceNo, SUM(wd.TPrice) usd FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey WHERE wm.isDeleted=0 AND wm.OrderYear=@y AND wm.OrderWeek LIKE @w GROUP BY wm.FarmName, wm.InvoiceNo`, W);
  const D = new Map(); db.forEach((r) => add(D, norm(r.FarmName).slice(0, 4) + '|' + inv(r.InvoiceNo), r)); cmp('구매현황 농장×인보이스 외화', X, D, ['usd'], 0.05); }
await close();
