// pages/api/incoming/insight.js
// 입고 인사이트(읽기 전용) — nenova.exe 입고 원장에는 없는 교차 보기.
//   view=board     차수 × 국가·농장: 발주량 → 입고량 → 분배량 (품목 OutUnit 기준 수량, DB_STRUCTURE 규칙)
//   view=reconcile 차수 품목 단위 대사: 발주·입고·분배 수량과 차이 태그(미입고/부족/초과/미발주)
//   view=farm      농장 프로필: 차수별 입고 추이·품목 구성·평균 단가·운임(GW/CW/Rate)·인보이스
//   view=product   품목 단가·수량 추이(차수별, 농장별)
// GET = SELECT만 (규칙 1). isDeleted 필터는 마스터(om/wm/sm)로만 (ShipmentDetail·WarehouseDetail엔 isDeleted 없음).
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { makeCanon } from '../../../lib/farmAlias';
import { readCalcs, domesticByFarm } from '../../../lib/awbFreightCalc';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

// OutUnit 기준 단일 수량 (DB_STRUCTURE "수량 조회 정답 쿼리")
const QTY = (t) => `CASE
  WHEN p.OutUnit IN (N'박스','BOX','Box')  THEN ${t}.BoxQuantity
  WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ${t}.BunchQuantity
  WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ${t}.SteamQuantity
  ELSE ${t}.BoxQuantity END`;

const weekParams = (year, week) => ({ yr: { type: sql.Int, value: parseInt(year, 10) }, wk: { type: sql.NVarChar, value: week } });

async function board(year, week) {
  const P = weekParams(year, week);
  // 발주(품목별) / 입고(농장·품목별) / 분배(품목별) 세 집계를 품목으로 맞춘다. 농장은 입고에만 있으므로 국가는 Product.CounName 기준.
  const [ord, inc, shp] = await Promise.all([
    query(`SELECT od.ProdKey, ISNULL(p.DisplayName,p.ProdName) AS ProdName, ISNULL(p.CounName,'') AS Country, ISNULL(p.FlowerName,'') AS Flower,
                  SUM(${QTY('od')}) AS Qty
             FROM OrderDetail od JOIN OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey JOIN Product p ON p.ProdKey = od.ProdKey
            WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
            GROUP BY od.ProdKey, p.DisplayName, p.ProdName, p.CounName, p.FlowerName`, P),
    query(`SELECT wd.ProdKey, ISNULL(p.DisplayName,p.ProdName) AS ProdName, ISNULL(p.CounName,'') AS Country, ISNULL(p.FlowerName,'') AS Flower,
                  wm.FarmName, SUM(${QTY('wd')}) AS Qty, SUM(ISNULL(wd.BoxQuantity,0)) AS Box, AVG(NULLIF(wd.UPrice,0)) AS UPrice, COUNT(DISTINCT wm.WarehouseKey) AS Invoices
             FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey JOIN Product p ON p.ProdKey = wd.ProdKey
            WHERE wm.OrderYear=@yr AND wm.OrderWeek=@wk AND ISNULL(wm.isDeleted,0)=0
            GROUP BY wd.ProdKey, p.DisplayName, p.ProdName, p.CounName, p.FlowerName, wm.FarmName`, P),
    query(`SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity,0)) AS Qty
             FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
            WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND ISNULL(sm.isDeleted,0)=0
            GROUP BY sd.ProdKey`, P),
  ]);
  // 운임·중량 항목(Chargeable/Gross weight·운송료·Doc fee)은 품목이 아니라 인보이스 부대비용 행 → 보드/대사에서 제외 (실측 38-02: '국내 13,494' 오염)
  const isFreight = (name) => /weight|운송료|운임|freight|doc\s*fee|handling|surcharge|통관|customs/i.test(String(name || ''));
  const shpBy = new Map(shp.recordset.map((r) => [r.ProdKey, Number(r.Qty) || 0]));
  const ordBy = new Map(ord.recordset.map((r) => [r.ProdKey, r]));
  // 품목 단위 대사 행
  const prodMap = new Map();
  for (const r of ord.recordset) prodMap.set(r.ProdKey, { prodKey: r.ProdKey, name: r.ProdName, country: r.Country, flower: r.Flower, ordered: Number(r.Qty) || 0, received: 0, farms: [], shipped: shpBy.get(r.ProdKey) || 0 });
  for (const r of inc.recordset) {
    const row = prodMap.get(r.ProdKey) || (prodMap.set(r.ProdKey, { prodKey: r.ProdKey, name: r.ProdName, country: r.Country, flower: r.Flower, ordered: 0, received: 0, farms: [], shipped: shpBy.get(r.ProdKey) || 0 }), prodMap.get(r.ProdKey));
    row.received += Number(r.Qty) || 0; row.farms.push({ farm: r.FarmName, qty: Number(r.Qty) || 0, box: Number(r.Box) || 0, uprice: r.UPrice == null ? null : Number(r.UPrice) });
  }
  for (const [k, q] of shpBy) if (!prodMap.has(k)) prodMap.set(k, { prodKey: k, name: `#${k}`, country: '', flower: '', ordered: 0, received: 0, farms: [], shipped: q });
  const items = [...prodMap.values()].filter((r) => !isFreight(r.name)).map((r) => {
    const diff = r.received - r.ordered;
    const tag = r.ordered === 0 && r.received > 0 ? '미발주' : r.received === 0 && r.ordered > 0 ? '미입고' : diff < 0 ? '부족' : diff > 0 ? '초과' : '일치';
    return { ...r, diff, tag, fill: r.ordered ? Math.round(100 * r.received / r.ordered) : null, shipRate: r.received ? Math.round(100 * r.shipped / r.received) : null };
  }).sort((a, b) => (a.country || '').localeCompare(b.country || '') || (a.flower || '').localeCompare(b.flower || '') || a.name.localeCompare(b.name));
  // 카드: 국가 × 농장 (발주는 국가 단위로만 붙는다 — 농장은 입고에만 있음)
  const cards = {};
  for (const it of items) {
    const c = cards[it.country || '(국가없음)'] || (cards[it.country || '(국가없음)'] = { country: it.country || '(국가없음)', ordered: 0, received: 0, shipped: 0, products: 0, missing: 0, farms: {} });
    c.ordered += it.ordered; c.received += it.received; c.shipped += it.shipped; c.products++; if (it.tag === '미입고') c.missing++;
    for (const f of it.farms) { const fc = c.farms[f.farm] || (c.farms[f.farm] = { farm: f.farm, qty: 0, box: 0, products: 0 }); fc.qty += f.qty; fc.box += f.box; fc.products++; }
  }
  const cardList = Object.values(cards).map((c) => ({ ...c, farms: Object.values(c.farms).sort((a, b) => b.qty - a.qty), fill: c.ordered ? Math.round(100 * c.received / c.ordered) : null, shipRate: c.received ? Math.round(100 * c.shipped / c.received) : null })).sort((a, b) => b.ordered - a.ordered);
  return { cards: cardList, items, totals: { ordered: items.reduce((a, b) => a + b.ordered, 0), received: items.reduce((a, b) => a + b.received, 0), shipped: items.reduce((a, b) => a + b.shipped, 0), missing: items.filter((i) => i.tag === '미입고').length, short: items.filter((i) => i.tag === '부족').length, over: items.filter((i) => i.tag === '초과').length, unordered: items.filter((i) => i.tag === '미발주').length } };
}

async function farm(farmName, months) {
  const P = { fm: { type: sql.NVarChar, value: farmName }, since: { type: sql.Date, value: new Date(Date.now() - months * 30 * 86400e3) } };
  const [inv, prod] = await Promise.all([
    query(`SELECT wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.InvoiceNo, wm.OrderNo AS AWB, CONVERT(NVARCHAR(10), wm.InputDate, 120) AS InputDate,
                  wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, wm.DocFeeUSD,
                  SUM(ISNULL(wd.BoxQuantity,0)) AS Box, SUM(ISNULL(wd.TPrice,0)) AS Amount, COUNT(wd.WdetailKey) AS Lines
             FROM WarehouseMaster wm LEFT JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
            WHERE wm.FarmName=@fm AND ISNULL(wm.isDeleted,0)=0 AND wm.InputDate >= @since
            GROUP BY wm.WarehouseKey, wm.OrderYear, wm.OrderWeek, wm.InvoiceNo, wm.OrderNo, wm.InputDate, wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, wm.DocFeeUSD
            ORDER BY wm.InputDate DESC`, P),
    query(`SELECT wd.ProdKey, ISNULL(p.DisplayName,p.ProdName) AS ProdName, ISNULL(p.FlowerName,'') AS Flower, wm.OrderYear, wm.OrderWeek,
                  SUM(ISNULL(wd.BoxQuantity,0)) AS Box, SUM(${QTY('wd')}) AS Qty, AVG(NULLIF(wd.UPrice,0)) AS UPrice
             FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey JOIN Product p ON p.ProdKey = wd.ProdKey
            WHERE wm.FarmName=@fm AND ISNULL(wm.isDeleted,0)=0 AND wm.InputDate >= @since
            GROUP BY wd.ProdKey, p.DisplayName, p.ProdName, p.FlowerName, wm.OrderYear, wm.OrderWeek`, P),
  ]);
  const byWeek = {}; const byProd = {};
  for (const r of prod.recordset) {
    const wk = `${r.OrderYear}-${r.OrderWeek}`;
    const w = byWeek[wk] || (byWeek[wk] = { week: wk, box: 0, qty: 0, products: 0 }); w.box += Number(r.Box) || 0; w.qty += Number(r.Qty) || 0; w.products++;
    const pr = byProd[r.ProdKey] || (byProd[r.ProdKey] = { prodKey: r.ProdKey, name: r.ProdName, flower: r.Flower, box: 0, qty: 0, weeks: [] });
    pr.box += Number(r.Box) || 0; pr.qty += Number(r.Qty) || 0; pr.weeks.push({ week: wk, qty: Number(r.Qty) || 0, uprice: r.UPrice == null ? null : Number(r.UPrice) });
  }
  const invoices = inv.recordset.map((r) => ({ ...r, kgCost: r.ChargeableWeight && r.FreightRateUSD ? Number(r.FreightRateUSD) : null, freightUSD: r.ChargeableWeight && r.FreightRateUSD ? Math.round(Number(r.ChargeableWeight) * Number(r.FreightRateUSD) * 100) / 100 : null }));
  return { farm: farmName, invoices, weeks: Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week)), products: Object.values(byProd).map((p) => ({ ...p, weeks: p.weeks.sort((a, b) => a.week.localeCompare(b.week)) })).sort((a, b) => b.qty - a.qty) };
}

async function product(q, months) {
  const P = { q: { type: sql.NVarChar, value: `%${q}%` }, since: { type: sql.Date, value: new Date(Date.now() - months * 30 * 86400e3) } };
  const r = await query(`SELECT wd.ProdKey, ISNULL(p.DisplayName,p.ProdName) AS ProdName, ISNULL(p.CounName,'') AS Country, wm.FarmName, wm.OrderYear, wm.OrderWeek,
                                SUM(ISNULL(wd.BoxQuantity,0)) AS Box, SUM(${QTY('wd')}) AS Qty, AVG(NULLIF(wd.UPrice,0)) AS UPrice, MIN(NULLIF(wd.UPrice,0)) AS MinP, MAX(NULLIF(wd.UPrice,0)) AS MaxP
                           FROM WarehouseDetail wd JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey JOIN Product p ON p.ProdKey = wd.ProdKey
                          WHERE (p.ProdName LIKE @q OR p.DisplayName LIKE @q OR p.FlowerName LIKE @q) AND ISNULL(wm.isDeleted,0)=0 AND wm.InputDate >= @since
                          GROUP BY wd.ProdKey, p.DisplayName, p.ProdName, p.CounName, wm.FarmName, wm.OrderYear, wm.OrderWeek
                          ORDER BY wm.OrderYear, wm.OrderWeek`, P);
  const prods = {};
  for (const x of r.recordset) {
    const pr = prods[x.ProdKey] || (prods[x.ProdKey] = { prodKey: x.ProdKey, name: x.ProdName, country: x.Country, rows: [], farms: new Set() });
    pr.rows.push({ week: `${x.OrderYear}-${x.OrderWeek}`, farm: x.FarmName, box: Number(x.Box) || 0, qty: Number(x.Qty) || 0, uprice: x.UPrice == null ? null : Math.round(Number(x.UPrice) * 100) / 100, min: x.MinP == null ? null : Number(x.MinP), max: x.MaxP == null ? null : Number(x.MaxP) });
    pr.farms.add(x.FarmName);
  }
  return { q, products: Object.values(prods).map((p) => { const ups = p.rows.filter((r) => r.uprice != null); const last = ups[ups.length - 1], prev = ups[ups.length - 2]; return { ...p, farms: [...p.farms], lastPrice: last ? last.uprice : null, prevPrice: prev ? prev.uprice : null, changePct: last && prev && prev.uprice ? Math.round(1000 * (last.uprice - prev.uprice) / prev.uprice) / 10 : null, totalQty: p.rows.reduce((a, b) => a + b.qty, 0) }; }).sort((a, b) => b.totalQty - a.totalQty).slice(0, 60) };
}

// 농장 정산 원장(읽기): 청구 = 입고 상품 금액(TPrice, 운임행 제외) + 운임행 금액 / 크레딧(FarmCredit) / 송금(WebFarmRemit, 웹 전용) → 잔액
// WebFarmRemit.Weeks는 "38-01,38-02" 같은 목록이라 농장 단위로만 합산한다(차수 귀속은 첫 차수 기준 참고값).
const FREIGHT_RE = /weight|운송료|운임|freight|doc\s*fee|handling|surcharge|통관|customs/i;
async function ledger(months, farmName) {
  const since = new Date(Date.now() - months * 30 * 86400e3);
  const P = { since: { type: sql.Date, value: since } };
  let fw = ''; let fmIn = '';
  if (farmName) { // 별칭 포함: 대표명이 같은 원장 표기 전부
    const canon0 = makeCanon(); const names = (await query(`SELECT DISTINCT FarmName FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 AND InputDate >= @since`, P)).recordset.map((x) => x.FarmName).filter((n) => canon0(n) === canon0(farmName));
    if (!names.includes(farmName)) names.push(farmName);
    names.forEach((n, i) => { P['fm' + i] = { type: sql.NVarChar, value: n }; }); const inList = names.map((_, i) => '@fm' + i).join(',');
    fw = ` AND wm.FarmName IN (${inList})`; fmIn = inList; }
  const [inv, cr, rm, cl, pd] = await Promise.all([
    query(`SELECT wm.FarmName, wm.OrderYear, wm.OrderWeek, wm.WarehouseKey, wm.InvoiceNo, CONVERT(NVARCHAR(10), wm.InputDate, 120) AS InputDate,
                  ISNULL(p.ProdName,'') AS ProdName, SUM(ISNULL(wd.TPrice,0)) AS Amount
             FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
            WHERE ISNULL(wm.isDeleted,0)=0 AND wm.InputDate >= @since${fw}
            GROUP BY wm.FarmName, wm.OrderYear, wm.OrderWeek, wm.WarehouseKey, wm.InvoiceNo, wm.InputDate, p.ProdName`, P),
    query(`SELECT FarmName, OrderWeek, CreditUSD, Memo FROM FarmCredit WHERE ISNULL(isDeleted,0)=0${farmName ? ` AND FarmName IN (${fmIn})` : ''}`, P),
    query(`SELECT AutoKey, OrderYear, Weeks, FarmName, AmountUSD, RemitDate, Memo, ISNULL(Status,N'CONFIRMED') AS Status, ISNULL(Source,N'manual') AS Source, ISNULL(Payee,N'') AS Payee FROM WebFarmRemit WHERE ISNULL(isDeleted,0)=0 AND ISNULL(Status,N'CONFIRMED') IN (N'CONFIRMED',N'PENDING') AND (CreateDtm >= @since OR RemitDate >= CONVERT(NVARCHAR(10), @since, 120))${farmName ? ` AND FarmName IN (${fmIn})` : ''} ORDER BY RemitDate DESC`, P).catch(() => ({ recordset: [] })),
    // 클레임(불량차감, 웹 테이블 WebSalesDefectDeduction): 농장 귀속 건만. CreditApplied=농장 크레딧 반영 여부, ImportConfirmed=수입부 확인
    query(`SELECT DeductionKey, OrderYear, OrderWeek, FarmName, CustName, ProdName, ColorName, Quantity, SourceUnit, CreditApplied, ImportConfirmed, ImportReviewRequired, DeductionType, EstimateCost, Status, Note, CONVERT(NVARCHAR(10), CreatedAt, 120) AS CreatedAt
             FROM WebSalesDefectDeduction WHERE ISNULL(IsDeleted,0)=0 AND FarmName<>N'' AND CreatedAt >= @since${farmName ? ` AND FarmName IN (${fmIn})` : ''} ORDER BY CreatedAt DESC`, P).catch(() => ({ recordset: [] })),
    // 농장별 결제일(5/15/25/30, 웹 전용 설정) — 입고(인보이스 입력일) 이후 첫 결제일을 만기로 본다
    query(`SELECT FarmName, PaymentDay FROM WebImportFarmPaymentDay`).catch(() => ({ recordset: [] })),
  ]);
  const payDay = new Map(pd.recordset.map((x) => [x.FarmName, Number(x.PaymentDay) || null]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueOf = (inputDate, day) => { if (!inputDate || !day) return null; const d = new Date(inputDate + 'T00:00:00'); const mk = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())); let due = mk(d.getFullYear(), d.getMonth()); if (due <= d) due = mk(d.getFullYear(), d.getMonth() + 1); return due; };
  const ymd = (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  const invAmt = {}; // farm → [{key, date, amount}]
  const farms = {};
  const canon = makeCanon(); // 별칭 사전: 표기 변형을 대표 농장명으로 합산(원장 표기는 그대로 둔다)
  const F = (raw) => { const n = canon(raw); return farms[n] || (farms[n] = { farm: n, goods: 0, freight: 0, credit: 0, remit: 0, invoices: new Set(), weeks: {}, remits: [], credits: [], lastInput: '', lastRemit: '', claims: { n: 0, qty: 0, cost: 0, credited: 0, pending: 0, items: [] } }); };
  for (const r of inv.recordset) {
    const f = F(r.FarmName); const amt = Number(r.Amount) || 0; const wk = `${r.OrderYear}-${r.OrderWeek}`;
    const w = f.weeks[wk] || (f.weeks[wk] = { week: wk, goods: 0, freight: 0, credit: 0 });
    if (FREIGHT_RE.test(r.ProdName)) { f.freight += amt; w.freight += amt; } else { f.goods += amt; w.goods += amt; }
    f.invoices.add(r.WarehouseKey); if (r.InputDate > f.lastInput) f.lastInput = r.InputDate;
    (invAmt[r.FarmName] ||= {})[r.WarehouseKey] = { date: r.InputDate, amount: ((invAmt[r.FarmName] || {})[r.WarehouseKey]?.amount || 0) + amt };
  }
  const weekSet = new Set(inv.recordset.map((r) => r.OrderWeek));
  for (const c of cr.recordset) { if (!farms[c.FarmName] || !weekSet.has(c.OrderWeek)) continue; const f = farms[c.FarmName]; const v = Number(c.CreditUSD) || 0; f.credit += v; f.credits.push({ week: c.OrderWeek, credit: v, memo: c.Memo || '' }); for (const wk of Object.keys(f.weeks)) if (wk.endsWith('-' + c.OrderWeek)) f.weeks[wk].credit += v; }
  let pendingN = 0, pendingUSD = 0;
  for (const r of rm.recordset) {
    if (r.Status === 'PENDING') { pendingN++; pendingUSD += Number(r.AmountUSD) || 0; if (r.FarmName) { const f = F(r.FarmName); f.pendingRemit = (f.pendingRemit || 0) + (Number(r.AmountUSD) || 0); f.pendingN = (f.pendingN || 0) + 1; } continue; } // 확인 대기는 잔액에 안 넣고 표시만
    const f = F(r.FarmName); const v = Number(r.AmountUSD) || 0; f.remit += v; f.remits.push({ key: r.AutoKey, weeks: r.Weeks, amount: v, date: r.RemitDate, memo: r.Memo || '', source: r.Source, payee: r.Payee }); if ((r.RemitDate || '') > f.lastRemit) f.lastRemit = r.RemitDate;
  }
  for (const c of cl.recordset) { const f = F(c.FarmName); const q = Number(c.Quantity) || 0; const cost = Number(c.EstimateCost) || 0; f.claims.n++; f.claims.qty += q; f.claims.cost += cost; if (c.CreditApplied) f.claims.credited++; if (!c.ImportConfirmed || c.ImportReviewRequired) f.claims.pending++;
    if (f.claims.items.length < 30) f.claims.items.push({ key: c.DeductionKey, week: `${c.OrderYear}-${c.OrderWeek}`, cust: c.CustName, prod: c.ProdName, color: c.ColorName, qty: q, unit: c.SourceUnit, type: c.DeductionType, credited: !!c.CreditApplied, confirmed: !!c.ImportConfirmed, review: !!c.ImportReviewRequired, status: c.Status, note: c.Note, at: c.CreatedAt }); }
  const domestic = domesticByFarm(readCalcs(), canon, since.toISOString()); // AWB 운임 계산기 저장분(백상+선율, KRW) — 참고값
  const rows = Object.values(farms).map((f) => { const billed = Math.round((f.goods + f.freight) * 100) / 100; const balance = Math.round((billed - f.credit - f.remit) * 100) / 100;
    // FIFO: 크레딧+송금을 오래된 인보이스부터 상계 → 남은 인보이스가 미결. 첫 미결의 만기(결제일)로 D-day, 만기 지난 미결 합이 연체
    const day = payDay.get(f.farm) || null; let paid = f.credit + f.remit; const unpaid = [];
    for (const [k, v] of Object.entries(invAmt[f.farm] || {}).sort((a, b) => a[1].date.localeCompare(b[1].date))) { if (paid >= v.amount - 0.005) { paid -= v.amount; continue; } unpaid.push({ key: Number(k), date: v.date, amount: Math.round((v.amount - Math.max(0, paid)) * 100) / 100, due: ymd(dueOf(v.date, day)) }); paid = 0; }
    const first = unpaid[0] || null; const dueD = first && first.due ? new Date(first.due + 'T00:00:00') : null; const dday = dueD ? Math.round((dueD - today) / 86400e3) : null;
    const overdueUSD = Math.round(unpaid.filter((u) => u.due && new Date(u.due + 'T00:00:00') < today).reduce((a, u) => a + u.amount, 0) * 100) / 100;
    const lastRemitDays = f.lastRemit ? Math.round((today - new Date(f.lastRemit + 'T00:00:00')) / 86400e3) : null;
    const lastInputDays = f.lastInput ? Math.round((today - new Date(f.lastInput + 'T00:00:00')) / 86400e3) : null;
    const pay = { day, nextDue: first ? first.due : '', dday, overdueUSD, unpaidN: unpaid.length, oldestUnpaid: first ? first.date : '', lastRemitDays, lastInputDays, unpaid: unpaid.slice(0, 12) };
    const dom = domestic[f.farm] || null; return { domesticKRW: dom ? dom.krw : 0, domesticUSD: dom ? dom.usd : 0, domesticAwbs: dom ? dom.awbs : 0, ...f, pay, invoices: f.invoices.size, billed, balance, paidRate: billed ? Math.round(100 * (f.credit + f.remit) / billed) : null, weeks: Object.values(f.weeks).sort((a, b) => a.week.localeCompare(b.week)), status: billed === 0 ? '청구없음' : balance <= 0.5 ? '완납' : (f.credit + f.remit) > 0 ? '부분송금' : '미송금' }; })
    .sort((a, b) => b.balance - a.balance);
  const t = rows.reduce((a, r) => ({ billed: a.billed + r.billed, credit: a.credit + r.credit, remit: a.remit + r.remit, balance: a.balance + r.balance }), { billed: 0, credit: 0, remit: 0, balance: 0 });
  return { months, rows, totals: { ...t, farms: rows.length, unpaid: rows.filter((r) => r.status === '미송금').length, partial: rows.filter((r) => r.status === '부분송금').length, claims: rows.reduce((a, r) => a + r.claims.n, 0), claimsPending: rows.reduce((a, r) => a + r.claims.pending, 0), pendingRemitN: pendingN, pendingRemitUSD: Math.round(pendingUSD * 100) / 100, overdueFarms: rows.filter((r) => r.pay.overdueUSD > 0.5).length, overdueUSD: Math.round(rows.reduce((a, r) => a + r.pay.overdueUSD, 0) * 100) / 100, dueSoon: rows.filter((r) => r.pay.dday != null && r.pay.dday >= 0 && r.pay.dday <= 7).length, noPayDay: rows.filter((r) => !r.pay.day && r.balance > 0.5).length } };
}

// 농장 클레임 리스트(lista): 가브리엘이 손으로 만들던 `nenova_26-1_lista.xlsx`(Lote/Farm/Variedad/Cantidad/Unidad/Nombre/Observación)를
// 웹 불량차감(WebSalesDefectDeduction, 농장 귀속 건)에서 그대로 생성. Lote 접두 = 품목군(c 카네이션·r 장미·s 수국, 그 외 없음) + 차수.
const LOTE_PREFIX = (flower) => /카네이션|clavel|carnation/i.test(flower) ? 'c' : /장미|rosa|rose/i.test(flower) ? 'r' : /수국|hortensia|hydrangea/i.test(flower) ? 's' : '';
const UNIDAD = (unit, qty) => { const one = Math.abs(Number(qty) || 0) === 1; return /송이|stem|tallo/i.test(unit) ? (one ? 'tallo' : 'tallos') : /박스|box|caja/i.test(unit) ? (one ? 'caja' : 'cajas') : (one ? 'ramo' : 'ramos'); };
async function lista(year, week) {
  const canon = makeCanon();
  const r = await query(`SELECT d.DeductionKey, d.OrderYear, d.OrderWeek, d.FarmName, d.CustName, d.ProdName, d.ColorName, d.Quantity, d.SourceUnit, d.DeductionType, d.Note, d.ImportConfirmed, d.CreditApplied,
                                ISNULL(p.FlowerName,'') AS Flower, ISNULL(p.DisplayName,'') AS DisplayName
                           FROM WebSalesDefectDeduction d LEFT JOIN Product p ON p.ProdKey = d.ProdKey
                          WHERE ISNULL(d.IsDeleted,0)=0 AND d.OrderYear=@yr AND (d.OrderWeek=@wk OR d.OrderWeek=@major)
                          ORDER BY d.CustName, d.FarmName, d.ProdName`, { ...weekParams(year, week), major: { type: sql.NVarChar, value: String(week).split('-')[0] } }); // 불량차감 OrderWeek는 대차수('38')로 저장됨
  const short = String(week).replace(/^(\d{1,2})-0?(\d)$/, '$1-$2');
  const rows = r.recordset.map((d) => ({ key: d.DeductionKey, lote: `${LOTE_PREFIX(d.Flower)}${short}`, farm: canon(d.FarmName || ''), farmRaw: d.FarmName || '', variedad: (() => { const pn = String(d.ProdName || '').replace(/^[가-힣()\s]+/, '').trim(); const parts = [pn || (d.ColorName ? '' : d.ProdName), d.ColorName].filter(Boolean); return parts.join(' ').toLowerCase(); })() /* 가브리엘식: 농장 품종명만(한글 품목군 접두 제거) */, cantidad: Number(d.Quantity) || 0, unidad: UNIDAD(d.SourceUnit, d.Quantity), nombre: d.CustName || '', observacion: d.Note || '', tipo: d.DeductionType || '', flower: d.Flower, confirmed: !!d.ImportConfirmed, credited: !!d.CreditApplied }));
  return { rows, noFarm: rows.filter((x) => !x.farm).length, farms: [...new Set(rows.map((x) => x.farm).filter(Boolean))].length };
}

// AWB 운임 계산기 원자료: 가브리엘의 `NN차 콜롬비아 AWB운임비.xlsx`(AWB 상 운임·박스·중량 → 품목군별·농장별 박스 비율로 백상 창고비·선율 비용 분배)를
// 웹에서 재현하기 위해 해당 차수의 AWB별 원장(농장 × 품목군 박스 수, GW/CW/Rate)을 돌려준다. 분배 산식은 화면(클라이언트)에서 입력값으로 계산.
const FLOWER_GROUP = (flower, name) => { const t = `${flower} ${name}`; return /카네이션|clavel|carnation/i.test(t) ? '카네이션' : /장미|rosa|rose/i.test(t) ? '장미' : /알스트로|alstro/i.test(t) ? '알스트로' : /루스커스|ruscus/i.test(t) ? '루스커스' : /수국|hydrangea|hortensia/i.test(t) ? '수국' : '기타'; };
async function awbcalc(year, week) {
  const canon = makeCanon();
  const r = await query(`SELECT wm.WarehouseKey, wm.FarmName, ISNULL(wm.OrderNo,'') AS AWB, ISNULL(wm.InvoiceNo,'') AS InvoiceNo, wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD,
                                ISNULL(p.FlowerName,'') AS Flower, ISNULL(p.DisplayName,p.ProdName) AS ProdName, SUM(ISNULL(wd.BoxQuantity,0)) AS Box, SUM(ISNULL(wd.TPrice,0)) AS Amount
                           FROM WarehouseMaster wm JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
                          WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderYear=@yr AND wm.OrderWeek=@wk
                          GROUP BY wm.WarehouseKey, wm.FarmName, wm.OrderNo, wm.InvoiceNo, wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, p.FlowerName, p.DisplayName, p.ProdName`, weekParams(year, week));
  const awbs = {};
  for (const x of r.recordset) {
    const k = String(x.AWB || '').replace(/\D/g, '') || '(AWB 없음)';
    const a = awbs[k] || (awbs[k] = { awb: x.AWB || '(AWB 없음)', farms: {}, freightUSD: 0, gw: 0, cw: 0, rate: 0, invoices: new Set() });
    const grp = FLOWER_GROUP(x.Flower, x.ProdName);
    if (FREIGHT_RE.test(x.ProdName)) { a.freightUSD += Number(x.Amount) || 0; continue; }
    if (!a.invoices.has(x.WarehouseKey)) { a.invoices.add(x.WarehouseKey); a.gw += Number(x.GrossWeight) || 0; a.cw += Number(x.ChargeableWeight) || 0; if (Number(x.FreightRateUSD)) a.rate = Number(x.FreightRateUSD); }
    const fname = canon(x.FarmName || ''); const f = a.farms[fname] || (a.farms[fname] = { farm: fname, groups: {}, box: 0 });
    f.groups[grp] = (f.groups[grp] || 0) + (Number(x.Box) || 0); f.box += Number(x.Box) || 0;
  }
  return { awbs: Object.values(awbs).map((a) => ({ ...a, invoices: a.invoices.size, farms: Object.values(a.farms).sort((p, q) => q.box - p.box), box: Object.values(a.farms).reduce((s, f) => s + f.box, 0) })).sort((p, q) => q.box - p.box) };
}

async function weeks() {
  const r = await query(`SELECT TOP 30 OrderYear, OrderWeek, COUNT(*) AS n FROM WarehouseMaster WHERE ISNULL(isDeleted,0)=0 GROUP BY OrderYear, OrderWeek ORDER BY OrderYear DESC, OrderWeek DESC`);
  return { weeks: r.recordset.map((x) => ({ year: x.OrderYear, week: x.OrderWeek, n: x.n })) };
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const { view = 'board', year, week: rawWeek, farm: farmName, q, months = '6' } = req.query;
  try {
    if (view === 'weeks') return res.status(200).json({ success: true, ...(await weeks()) });
    if (view === 'ledger') return res.status(200).json({ success: true, ...(await ledger(Math.min(24, parseInt(months, 10) || 6), farmName ? String(farmName) : '')) });
    if (view === 'farm') { if (!farmName) return res.status(400).json({ success: false, error: 'farm 필요' }); const m = Math.min(24, parseInt(months, 10) || 6); const [f, l] = await Promise.all([farm(String(farmName), m), ledger(m, String(farmName))]); return res.status(200).json({ success: true, ...f, ledger: l.rows[0] || null }); }
    if (view === 'product') { if (!q) return res.status(400).json({ success: false, error: 'q 필요' }); return res.status(200).json({ success: true, ...(await product(String(q), Math.min(24, parseInt(months, 10) || 6))) }); }
    if (view === 'lista' && /^\d{1,2}$/.test(String(rawWeek || '')) && /^\d{4}$/.test(String(year || ''))) return res.status(200).json({ success: true, year: Number(year), week: String(rawWeek), ...(await lista(year, String(rawWeek))) });
    const week = rawWeek ? normalizeOrderWeek(rawWeek) : '';
    if (!/^\d{4}$/.test(String(year || '')) || !week) return res.status(400).json({ success: false, error: 'year·week 필요 (예: 2026, 38-02)' });
    if (view === 'lista') { const wkL = /^\d{1,2}$/.test(String(rawWeek || '')) ? String(rawWeek) : week; return res.status(200).json({ success: true, year: Number(year), week: wkL, ...(await lista(year, wkL)) }); }
    if (view === 'awbcalc') return res.status(200).json({ success: true, year: Number(year), week, ...(await awbcalc(year, week)) });
    const data = await board(year, week);
    return res.status(200).json({ success: true, year: Number(year), week, ...(view === 'reconcile' ? { items: data.items, totals: data.totals } : data) });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
});
