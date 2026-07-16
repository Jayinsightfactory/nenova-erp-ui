// pages/api/stats/pivot-import.js
// 수입부 Pivot 데이터 — 입고(WarehouseMaster/Detail) 관점
// 행: 주문차수 → AWB(OrderNo) → 인보이스(InvoiceNo) / 농장명 · 값: 입고총단가(Σ WarehouseDetail.TPrice, USD)
//
// GET  ?weekStart&weekEnd                       → 인보이스 단위 집계 + 수기항목(adjustments)
// GET  ?weekStart&weekEnd&excel=1&payDate=7/15  → 농장별 정산서 엑셀 (실양식: 일자-No./거래처명/품목명(규격)/
//                                                  외화금액/차수·품목/인보이스넘버/결제일 + 농장 계 + 총계)
// POST { week, awb, invoiceNo?, farmName, label, refNo?, amount } → 수기항목(Claim/은행수수료, 음수 허용)
// DELETE { key }                                → 수기항목 삭제 (soft)

import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek, resolveActiveOrderYear, buildOrderYearWeek } from '../../../lib/orderUtils';

// 웹 전용 수기항목 테이블 (ensure 패턴 — WeekProdCost/WebRaumPnl 과 동일)
let _adjEnsured = null;
function ensureAdjTable() {
  if (_adjEnsured) return _adjEnsured;
  _adjEnsured = query(
    `IF OBJECT_ID(N'dbo.WebImportPivotAdj', N'U') IS NULL
     CREATE TABLE dbo.WebImportPivotAdj (
       AutoKey INT IDENTITY(1,1) PRIMARY KEY,
       OrderYear NVARCHAR(4) NOT NULL,
       OrderWeek NVARCHAR(10) NOT NULL,
       Awb NVARCHAR(60) NOT NULL DEFAULT N'',
       InvoiceNo NVARCHAR(60) NOT NULL DEFAULT N'',
       FarmName NVARCHAR(120) NOT NULL DEFAULT N'',
       Label NVARCHAR(120) NOT NULL,
       RefNo NVARCHAR(120) NOT NULL DEFAULT N'',
       Amount FLOAT NOT NULL,
       CreateID NVARCHAR(50) NOT NULL,
       CreateDtm DATETIME NOT NULL DEFAULT GETDATE(),
       isDeleted BIT NOT NULL DEFAULT 0
     )`
  ).catch(e => { _adjEnsured = null; throw e; });
  return _adjEnsured;
}

// 품목명(규격) — ProdName 선두 영문 패밀리 우선, 없으면 FlowerName 영문 사전
const FLOWER_FAMILY = {
  '장미': 'ROSE', '카네이션': 'CARNATION', '수국': 'HYDRANGEA', '알스트로': 'ALSTROMERIA',
  '루스커스': 'RUSCUS', '튤립': 'TULIP', '리시안': 'LISIANTHUS', '거베라': 'GERBERA',
  '아마릴리스': 'AMARYLLIS', '델피늄': 'DELPHINIUM', '안시리움': 'ANTHURIUM', '카라': 'CALLA',
};
const FEE_RE = /(service\s*fee|fee|운송료|수수료|freight|상차|charge)/i;
function productFamily(prodName, flowerName) {
  const pn = String(prodName || '').trim();
  if (FEE_RE.test(pn)) return pn.toUpperCase();
  const m = pn.match(/^([A-Za-z][A-Za-z .']*?)(?:\s*\/|\s+[A-Z][a-z]|\s+\d|$)/);
  if (m && m[1].trim().length >= 3) return m[1].trim().toUpperCase();
  const fl = String(flowerName || '').trim();
  return FLOWER_FAMILY[fl] || fl || pn.toUpperCase() || '(미분류)';
}

// 차수 표기: '22-01' → '22-1'
const weekShort = (w) => String(w || '').replace(/-0?(\d+)$/, '-$1');

function parseRange(reqQuery) {
  const { weekStart, weekEnd, orderYear } = reqQuery;
  if (!weekStart) throw new Error('weekStart 필요');
  const ws = normalizeOrderWeek(weekStart);
  const we = normalizeOrderWeek(weekEnd || weekStart);
  const startYear = resolveActiveOrderYear(weekStart, orderYear);
  const endYear = resolveActiveOrderYear(weekEnd || weekStart, orderYear, startYear);
  const yws = buildOrderYearWeek(startYear, ws);
  const ywe = buildOrderYearWeek(endYear, we);
  if (yws > ywe) throw new Error('차수 범위가 올바르지 않습니다.');
  return { ws, we, startYear, yws, ywe };
}

const rangeParams = (r) => ({
  startYear: { type: sql.NVarChar, value: r.startYear },
  yws: { type: sql.NVarChar, value: r.yws },
  ywe: { type: sql.NVarChar, value: r.ywe },
});

async function loadAdjustments(r) {
  await ensureAdjTable();
  const result = await query(
    `SELECT AutoKey, OrderYear, OrderWeek, Awb, InvoiceNo, FarmName, Label, RefNo, Amount,
            CreateID, CONVERT(varchar(10), CreateDtm, 111) AS CreateDate
       FROM WebImportPivotAdj
      WHERE isDeleted = 0
        AND OrderYear + REPLACE(OrderWeek, '-', '') BETWEEN @yws AND @ywe
      ORDER BY AutoKey`,
    rangeParams(r)
  );
  return result.recordset.map(a => ({
    key: a.AutoKey, orderYear: a.OrderYear, week: a.OrderWeek, awb: a.Awb,
    invoiceNo: a.InvoiceNo, farmName: a.FarmName, label: a.Label, refNo: a.RefNo || '',
    amount: Number(a.Amount), createId: a.CreateID, createDate: a.CreateDate,
  }));
}

// ── 결제파일 실양식 규칙 (26.07월 결제.xlsx 역분석, 2026-07-16) ──
// 농장 정식 결제명 매핑 (data/import-farm-paynames.json — 결제파일↔DB 인보이스 대조로 자동 생성된 시드)
let _payNames = null;
function farmPayName(dbFarm) {
  if (!_payNames) {
    try {
      _payNames = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'import-farm-paynames.json'), 'utf8'));
    } catch { _payNames = {}; }
  }
  return _payNames[String(dbFarm || '').trim()] || String(dbFarm || '').trim();
}

// 포워더(운송료 시트 대상): FreightWise 계열 + EXCEL(=Excel Transport International, 중국 운송)
const FORWARDER_RE = /^(freightwise|excel$)/i;
const isForwarder = (farm) => /^freightwise/i.test(String(farm)) || String(farm).trim().toUpperCase() === 'EXCEL';

// 일자 = 차수 기준수요일 + 5일(차주 월요일) — 결제파일 실측: 22차→06/01, 23차→06/08 …
function weekPayDate(year, week) {
  const weekNum = parseInt(String(week).split('-')[0], 10);
  if (!weekNum) return '';
  const dateStart = new Date(Number(year), 0, (weekNum - 1) * 7 + 1, 12, 0, 0);
  const wednesday = new Date(dateStart);
  wednesday.setDate(wednesday.getDate() - ((wednesday.getDay() - 3 + 7) % 7));
  wednesday.setDate(wednesday.getDate() + 5);
  const p = n => String(n).padStart(2, '0');
  return `${wednesday.getFullYear()}/${p(wednesday.getMonth() + 1)}/${p(wednesday.getDate())}`;
}

// 차수/품목 태그 폴백 (AWB 에 포워더 한글태그 마스터가 없을 때) — 결제파일 실측 태그 4종
function tagFallback(counName, flowerName) {
  const c = String(counName || ''), f = String(flowerName || '');
  if (/콜롬비아/.test(c)) return /수국/.test(f) ? '콜수국' : '콜카장';
  if (/에콰도르/.test(c)) return '에콰';
  if (/호주/.test(c)) return '호주';
  return '';
}

async function buildSettlementExcel(r, payDate) {
  // 라인 레벨 조회 — JS 에서 (농장, 차수, 인보이스, 품목패밀리) 로 그룹
  const detail = await query(
    `SELECT
        ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) AS orderYear,
        wm.OrderWeek AS week,
        LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))) AS awb,
        LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))) AS invoiceNo,
        LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) AS farmName,
        CONVERT(varchar(10), wm.InputDate, 111) AS inputDate,
        p.ProdName, ISNULL(p.FlowerName, N'') AS flowerName, ISNULL(p.CounName, N'') AS counName,
        ISNULL(wd.TPrice, 0) AS tprice
      FROM WarehouseMaster wm
      JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
      JOIN Product p ON p.ProdKey = wd.ProdKey
     WHERE ISNULL(wm.isDeleted, 0) = 0
       AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) + REPLACE(wm.OrderWeek, '-', '')
           BETWEEN @yws AND @ywe`,
    rangeParams(r)
  );

  // AWB → 카테고리 태그 (같은 AWB 의 포워더 마스터 InvoiceNo 가 '콜카장'/'콜수국' 태그)
  const tagByAwb = {};
  detail.recordset.forEach(d => {
    if (d.awb && /[가-힣]/.test(d.invoiceNo)) tagByAwb[d.awb] = d.invoiceNo;
  });

  // (농장, 차수, 인보이스, 패밀리) 그룹 — 포워더는 별도 시트(운송료)
  const groups = new Map();
  let maxInputDate = '';
  for (const d of detail.recordset) {
    const isFwd = isForwarder(d.farmName);
    const family = isFwd ? '운송료' : productFamily(d.ProdName, d.flowerName);
    const key = `${d.farmName}|${d.week}|${d.invoiceNo}|${family}`;
    if (!groups.has(key)) {
      groups.set(key, {
        farm: d.farmName || '(농장미상)', week: d.week, awb: d.awb, invoice: d.invoiceNo,
        family, amount: 0, isFwd, orderYear: d.orderYear,
        tag: tagByAwb[d.awb] || tagFallback(d.counName, d.flowerName),
      });
    }
    const g = groups.get(key);
    g.amount += Number(d.tprice) || 0;
    if (!g.tag) g.tag = tagByAwb[d.awb] || tagFallback(d.counName, d.flowerName);
    if (d.inputDate && d.inputDate > maxInputDate) maxInputDate = d.inputDate;
  }

  const adjustments = await loadAdjustments(r);
  const farmOfAwb = {};
  detail.recordset.forEach(d => { if (d.awb && !farmOfAwb[d.awb]) farmOfAwb[d.awb] = d.farmName; });

  // 시트별(상품대/포워딩) 농장 그룹 구성 — 수기항목은 해당 농장 마지막에 배치
  const buildFarmMap = (isFwdSheet) => {
    const byFarm = new Map();
    const push = (farm, row) => { if (!byFarm.has(farm)) byFarm.set(farm, []); byFarm.get(farm).push(row); };
    [...groups.values()]
      .filter(g => g.isFwd === isFwdSheet)
      .sort((a, b) => a.week.localeCompare(b.week) || a.invoice.localeCompare(b.invoice) || a.family.localeCompare(b.family))
      .forEach(g => push(g.farm, {
        date: weekPayDate(g.orderYear, g.week),
        item: g.isFwd ? '운송료' : g.family,
        amount: Math.round(g.amount * 100) / 100,
        weekTag: `${weekShort(g.week)} ${g.isFwd ? (/[가-힣]/.test(g.invoice) ? g.invoice : g.tag) : g.tag}`.trim(),
        // 포워더 마스터의 InvoiceNo 는 태그(콜카장 등)라 인보이스 칸은 비움 — FEX 번호는 수기항목으로
        invoice: g.isFwd ? '' : g.invoice,
      }));
    adjustments.forEach(a => {
      const farm = a.farmName || farmOfAwb[a.awb] || '(농장미상)';
      if (isForwarder(farm) !== isFwdSheet) return;
      const isBankFee = /수수료/.test(a.label);
      push(farm, {
        date: (a.createDate || '').replace(/-/g, '/'),
        item: isBankFee ? '' : a.label,                       // 은행수수료: 품목명 비움 (실양식)
        amount: Math.round(a.amount * 100) / 100,
        weekTag: '',
        invoice: isBankFee ? a.label : (a.refNo || a.invoiceNo || a.label),
      });
    });
    return byFarm;
  };

  // 시트 렌더 — 실양식: 제목 / 헤더 / 행들 / 농장 계 / 총합계 / 생성 타임스탬프
  const now = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const yoil = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
  const ampm = now.getHours() < 12 ? '오전' : '오후';
  const h12 = now.getHours() % 12 || 12;
  const stamp = `${now.getFullYear()}/${p2(now.getMonth() + 1)}/${p2(now.getDate())} (${yoil}) ${ampm} ${h12}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  const rangeEnd = (maxInputDate || `${r.startYear}/12/31`);

  const renderSheet = (byFarm, isFwdSheet) => {
    const title = `회사명 : (주) 네노바 /${isFwdSheet ? ' 운송료 /' : ''} ${r.startYear}/01/01  ~ ${rangeEnd} `;
    const aoa = [[title], ['일자-No.', '거래처명', '품목명(규격)', '외화금액', '차수/품목', '인보이스넘버', '결제일']];
    const seqByDate = {};
    const numberOf = (date) => {
      if (!date) return '';
      seqByDate[date] = (seqByDate[date] || 0) + 1;
      return `${date} -${seqByDate[date]}`;
    };
    let grand = 0;
    const entries = [...byFarm.entries()]
      .map(([farm, rows]) => [farmPayName(farm), rows])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en', { sensitivity: 'base' }));
    for (const [payName, rows] of entries) {
      let sub = 0;
      rows.forEach(x => {
        aoa.push([numberOf(x.date), payName, x.item, x.amount, x.weekTag, x.invoice, payDate]);
        sub += x.amount;
      });
      aoa.push([`${payName} 계`, '', '', Math.round(sub * 100) / 100, '', '', '']);
      grand += sub;
    }
    aoa.push(['총합계', '', '', Math.round(grand * 100) / 100, '', '', '']);
    aoa.push([stamp, '', '', '', '', '', '']);
    const wsx = XLSX.utils.aoa_to_sheet(aoa);
    wsx['!cols'] = [{ wch: 15 }, { wch: 36 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 20 }, { wch: 8 }];
    const range = XLSX.utils.decode_range(wsx['!ref']);
    for (let R = 2; R <= range.e.r; R++) {
      const cell = wsx[XLSX.utils.encode_cell({ r: R, c: 3 })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
    return wsx;
  };

  // 시트명: 결제일 기준 'YY.MM.DD(상품대)'
  const yy = String(now.getFullYear()).slice(2);
  const pd = String(payDate || '').match(/^(\d{1,2})\/(\d{1,2})$/);
  const sheetDate = pd ? `${yy}.${p2(pd[1])}.${p2(pd[2])}` : `${yy}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}`;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, renderSheet(buildFarmMap(false), false), `${sheetDate}(상품대)`);
  XLSX.utils.book_append_sheet(wb, renderSheet(buildFarmMap(true), true), `${sheetDate}(포워딩)`);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export default withAuth(async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      await ensureAdjTable();
      const { week, awb, invoiceNo, farmName, label, refNo, amount } = req.body || {};
      const wk = normalizeOrderWeek(week || '');
      const amt = parseFloat(amount);
      if (!wk || !String(label || '').trim() || Number.isNaN(amt)) {
        return res.status(400).json({ success: false, error: 'week, label, amount 필요' });
      }
      const orderYear = resolveActiveOrderYear(week, '');
      await query(
        `INSERT INTO WebImportPivotAdj (OrderYear, OrderWeek, Awb, InvoiceNo, FarmName, Label, RefNo, Amount, CreateID)
         VALUES (@yr, @wk, @awb, @inv, @farm, @label, @ref, @amt, @uid)`,
        {
          yr: { type: sql.NVarChar, value: orderYear },
          wk: { type: sql.NVarChar, value: wk },
          awb: { type: sql.NVarChar, value: String(awb || '').trim() },
          inv: { type: sql.NVarChar, value: String(invoiceNo || '').trim() },
          farm: { type: sql.NVarChar, value: String(farmName || '').trim() },
          label: { type: sql.NVarChar, value: String(label).trim().slice(0, 120) },
          ref: { type: sql.NVarChar, value: String(refNo || '').trim().slice(0, 120) },
          amt: { type: sql.Float, value: amt },
          uid: { type: sql.NVarChar, value: req.user?.userId || 'admin' },
        }
      );
      return res.status(200).json({ success: true });
    }

    if (req.method === 'DELETE') {
      await ensureAdjTable();
      const key = parseInt(req.body?.key, 10);
      if (!key) return res.status(400).json({ success: false, error: 'key 필요' });
      await query(`UPDATE WebImportPivotAdj SET isDeleted=1 WHERE AutoKey=@k`, { k: { type: sql.Int, value: key } });
      return res.status(200).json({ success: true });
    }

    if (req.method !== 'GET') return res.status(405).end();

    const r = parseRange(req.query);

    if (req.query.excel === '1') {
      const payDate = String(req.query.payDate || '').trim()
        || `${new Date().getMonth() + 1}/${new Date().getDate()}`;
      const buf = await buildSettlementExcel(r, payDate);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(`수입부정산서_${r.startYear}_${r.ws}_${r.we}.xlsx`)}`);
      return res.status(200).send(buf);
    }

    const result = await query(
      `SELECT
          ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) AS orderYear,
          wm.OrderWeek AS week,
          LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))) AS awb,
          LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))) AS billNo,
          LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) AS farmName,
          CONVERT(varchar(10), MIN(wm.InputDate), 23) AS inputDate,
          ROUND(SUM(ISNULL(wd.TPrice, 0)), 2) AS inTotal,
          COUNT(wd.WdetailKey) AS lineCount,
          ROUND(SUM(ISNULL(wd.OutQuantity, 0)), 2) AS qty
        FROM WarehouseMaster wm
        JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       WHERE ISNULL(wm.isDeleted, 0) = 0
         AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear) + REPLACE(wm.OrderWeek, '-', '')
             BETWEEN @yws AND @ywe
       GROUP BY ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @startYear), wm.OrderWeek,
                LTRIM(RTRIM(ISNULL(wm.OrderNo, N''))), LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))),
                LTRIM(RTRIM(ISNULL(wm.FarmName, N'')))
       ORDER BY wm.OrderWeek, awb, billNo`,
      rangeParams(r)
    );

    const adjustments = await loadAdjustments(r);

    return res.status(200).json({
      success: true,
      orderYear: r.startYear,
      weekStart: r.ws,
      weekEnd: r.we,
      rows: result.recordset,
      adjustments,
    });
  } catch (err) {
    const status = /필요|형식|범위/.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});
