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

// AWB 정규화 — 같은 운송장이 '16010740553'/'160-10740553' 로 섞여 입력됨 (그룹·태그 매칭용)
const normAwb = (a) => String(a || '').replace(/[^0-9A-Za-z]/g, '');

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

// 포워더(운송료 시트 대상): FreightWise 계열 + EXCEL(=Excel Transport International, 중국 운송) + Apollo
const FORWARDER_RE = /^(freightwise|excel$|apollo$)/i;
const isForwarder = (farm) => FORWARDER_RE.test(String(farm).trim());

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

// 차수/품목 태그 폴백 (AWB 에 포워더 한글태그 마스터가 없을 때) — 결제파일 실측 태그
// 네덜란드는 '네'+농장 이니셜 (EZ FLOWER→네E, HOLEX→네H)
function tagFallback(counName, flowerName, farmName) {
  const c = String(counName || ''), f = String(flowerName || '');
  if (/콜롬비아/.test(c)) return /수국/.test(f) ? '콜수국' : '콜카장';
  if (/에콰도르/.test(c)) return '에콰';
  if (/호주/.test(c)) return '호주';
  if (/네덜란드/.test(c)) {
    const initial = (String(farmName || '').match(/[A-Za-z]/) || [''])[0].toUpperCase();
    return `네${initial}`;
  }
  return '';
}

// 상품대 시트 통화 섹션 (실양식: 본문(USD) → 네덜란드<EUR> → 호주<AUD>, 섹션마다 헤더·총합계 반복)
const CURRENCY_SECTIONS = [
  { label: null, test: c => !/네덜란드|호주/.test(c) },
  { label: '네덜란드<EUR>', test: c => /네덜란드/.test(c) },
  { label: '호주<AUD>', test: c => /호주/.test(c) },
];

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
    if (d.awb && /[가-힣]/.test(d.invoiceNo)) tagByAwb[normAwb(d.awb)] = d.invoiceNo;
  });

  // 농장 대표 국가 (라인 최다 기준) — 통화 섹션(EUR/AUD) 분류·태그 판정용
  // (운송료 라인은 CounName 이 '국내'로 들어와 라인 국가만으론 오판)
  const counCount = new Map();
  detail.recordset.forEach(d => {
    if (isForwarder(d.farmName)) return;
    const m = counCount.get(d.farmName) || {};
    m[d.counName] = (m[d.counName] || 0) + 1;
    counCount.set(d.farmName, m);
  });
  const counOfFarm = (farm) => {
    const m = counCount.get(farm) || {};
    return (Object.entries(m).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  };

  // 실양식: 상품대 시트의 운송료 라인은 'SERVICE FEE', 네덜란드/호주는 인보이스당 꽃 전체를 한 줄로 축약
  const FREIGHT_LINE_RE = /운송료|운송비|운임|service\s*fee|freight/i;
  const NONUSD_ITEM = [[/네덜란드/, 'Tulip'], [/호주/, 'Banker Bush']];

  // (농장, 차수, 인보이스, 패밀리) 그룹 — 포워더는 별도 시트(운송료)
  const groups = new Map();
  let maxInputDate = '';
  for (const d of detail.recordset) {
    const isFwd = isForwarder(d.farmName);
    const farmCoun = counOfFarm(d.farmName) || d.counName;
    let family;
    if (isFwd) family = '운송료';
    else if (FREIGHT_LINE_RE.test(d.ProdName || '')) family = 'SERVICE FEE';
    else {
      const nu = NONUSD_ITEM.find(([re]) => re.test(farmCoun));
      family = nu ? nu[1] : productFamily(d.ProdName, d.flowerName);
    }
    const key = `${d.farmName}|${d.week}|${d.invoiceNo}|${family}`;
    if (!groups.has(key)) {
      groups.set(key, {
        farm: d.farmName || '(농장미상)', week: d.week, awb: d.awb, invoice: d.invoiceNo,
        family, amount: 0, isFwd, orderYear: d.orderYear,
        tag: tagByAwb[normAwb(d.awb)] || tagFallback(farmCoun, d.flowerName, d.farmName),
      });
    }
    const g = groups.get(key);
    g.amount += Number(d.tprice) || 0;
    if (!g.tag) g.tag = tagByAwb[normAwb(d.awb)] || tagFallback(farmCoun, d.flowerName, d.farmName);
    if (d.inputDate && d.inputDate > maxInputDate) maxInputDate = d.inputDate;
  }

  const adjustments = await loadAdjustments(r);
  const fwdInvoices = await loadFwdInvoices(r);
  const farmOfAwb = {};
  detail.recordset.forEach(d => { if (d.awb && !farmOfAwb[normAwb(d.awb)]) farmOfAwb[normAwb(d.awb)] = d.farmName; });

  // 시트별(상품대/포워딩) 농장 그룹 구성 — 수기항목은 해당 농장 마지막에 배치
  const buildFarmMap = (isFwdSheet) => {
    const byFarm = new Map();
    const push = (farm, row) => { if (!byFarm.has(farm)) byFarm.set(farm, []); byFarm.get(farm).push(row); };
    // 금액 0 그룹 제외 (GW/CW 메타라인 — 실파일에 없음), SERVICE FEE 는 인보이스 내 마지막 (실파일 순서)
    const famOrder = (f) => (f === 'SERVICE FEE' ? '￿' : f);
    [...groups.values()]
      .filter(g => g.isFwd === isFwdSheet && Math.round(g.amount * 100) !== 0)
      .sort((a, b) => a.week.localeCompare(b.week) || a.invoice.localeCompare(b.invoice) || famOrder(a.family).localeCompare(famOrder(b.family)))
      .forEach(g => push(g.farm, {
        date: weekPayDate(g.orderYear, g.week),
        item: g.isFwd ? '운송료' : g.family,
        amount: Math.round(g.amount * 100) / 100,
        weekTag: `${weekShort(g.week)} ${g.isFwd ? (/[가-힣]/.test(g.invoice) ? g.invoice : g.tag) : g.tag}`.trim(),
        // 포워더 마스터의 InvoiceNo 는 태그(콜카장 등) — FEX 번호는 웹 매핑(WebForwarderInvoice)에서
        invoice: g.isFwd ? (fwdInvoices[`${g.week}|${normAwb(g.awb)}`] || '') : g.invoice,
      }));
    adjustments.forEach(a => {
      const farm = a.farmName || farmOfAwb[normAwb(a.awb)] || '(농장미상)';
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

  // aoa 생성 — 엑셀·웹(정산서 보기) 공용. 행 타입(kind): title/header/row/subtotal/grand/section/blank/stamp
  // 상품대는 실양식대로 통화 섹션 분리(본문 → 네덜란드<EUR> → 호주<AUD>), 섹션마다 헤더·총합계 반복.
  // 일자-No. 순번은 시트 전체로 이어짐(실파일 실측: EUR 첫 행이 본문 순번을 이어받음).
  const buildSheetRows = (byFarm, isFwdSheet) => {
    const title = `회사명 : (주) 네노바 /${isFwdSheet ? ' 운송료 /' : ''} ${r.startYear}/01/01  ~ ${rangeEnd} `;
    const HEADER = { kind: 'header', cells: ['일자-No.', '거래처명', '품목명(규격)', '외화금액', '차수/품목', '인보이스넘버', '결제일'] };
    const out = [
      { kind: 'title', cells: [title, '', '', '', '', '', ''] },
      HEADER,
    ];
    const seqByDate = {};
    const numberOf = (date) => {
      if (!date) return '';
      seqByDate[date] = (seqByDate[date] || 0) + 1;
      return `${date} -${seqByDate[date]}`;
    };
    const allEntries = [...byFarm.entries()]
      .sort((a, b) => String(farmPayName(a[0])).localeCompare(String(farmPayName(b[0])), 'en', { sensitivity: 'base' }));
    const sections = isFwdSheet
      ? [{ label: null, entries: allEntries }]
      : CURRENCY_SECTIONS.map(s => ({
          label: s.label,
          entries: allEntries.filter(([farm]) => s.test(counOfFarm(farm))),
        }));
    sections.forEach((sec, si) => {
      if (sec.entries.length === 0) return;
      if (sec.label) {
        out.push({ kind: 'blank', cells: ['', '', '', '', '', '', ''] });
        out.push({ kind: 'blank', cells: ['', '', '', '', '', '', ''] });
        out.push({ kind: 'section', cells: [sec.label, '', '', '', '', '', ''] });
        out.push(HEADER);
      }
      let grand = 0;
      for (const [farm, rows] of sec.entries) {
        const payName = farmPayName(farm);
        let sub = 0;
        rows.forEach(x => {
          out.push({ kind: 'row', cells: [numberOf(x.date), payName, x.item, x.amount, x.weekTag, x.invoice, payDate] });
          sub += x.amount;
        });
        out.push({ kind: 'subtotal', cells: [`${payName} 계`, '', '', Math.round(sub * 100) / 100, '', '', ''] });
        grand += sub;
      }
      out.push({ kind: 'grand', cells: ['총합계', '', '', Math.round(grand * 100) / 100, '', '', ''] });
    });
    out.push({ kind: 'stamp', cells: [stamp, '', '', '', '', '', ''] });
    return out;
  };

  // 시트명: 결제일 기준 'YY.MM.DD(상품대)'
  const yy = String(now.getFullYear()).slice(2);
  const pd = String(payDate || '').match(/^(\d{1,2})\/(\d{1,2})$/);
  const sheetDate = pd ? `${yy}.${p2(pd[1])}.${p2(pd[2])}` : `${yy}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}`;

  return {
    sheets: [
      { name: `${sheetDate}(상품대)`, rows: buildSheetRows(buildFarmMap(false), false) },
      { name: `${sheetDate}(포워딩)`, rows: buildSheetRows(buildFarmMap(true), true) },
    ],
  };
}

function settlementToXlsx(data) {
  const wb = XLSX.utils.book_new();
  for (const sheet of data.sheets) {
    const aoa = sheet.rows.map(x => x.cells);
    const wsx = XLSX.utils.aoa_to_sheet(aoa);
    wsx['!cols'] = [{ wch: 15 }, { wch: 36 }, { wch: 16 }, { wch: 12 }, { wch: 13 }, { wch: 20 }, { wch: 8 }];
    const range = XLSX.utils.decode_range(wsx['!ref']);
    for (let R = 2; R <= range.e.r; R++) {
      const cell = wsx[XLSX.utils.encode_cell({ r: R, c: 3 })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
    XLSX.utils.book_append_sheet(wb, wsx, sheet.name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// 포워더 인보이스 번호 (FEX-#### 등) — 입고관리 InvoiceNo 칸은 태그(콜카장 등)로 쓰여 DB 에 없음.
// 웹 전용 매핑: (연도, 차수, AWB) → 인보이스번호. upsert (기존 soft-delete 후 insert)
let _fwdEnsured = null;
function ensureFwdTable() {
  if (_fwdEnsured) return _fwdEnsured;
  _fwdEnsured = query(
    `IF OBJECT_ID(N'dbo.WebForwarderInvoice', N'U') IS NULL
     CREATE TABLE dbo.WebForwarderInvoice (
       AutoKey INT IDENTITY(1,1) PRIMARY KEY,
       OrderYear NVARCHAR(4) NOT NULL,
       OrderWeek NVARCHAR(10) NOT NULL,
       Awb NVARCHAR(60) NOT NULL,
       InvoiceNo NVARCHAR(120) NOT NULL,
       CreateID NVARCHAR(50) NOT NULL,
       CreateDtm DATETIME NOT NULL DEFAULT GETDATE(),
       isDeleted BIT NOT NULL DEFAULT 0
     )`
  ).catch(e => { _fwdEnsured = null; throw e; });
  return _fwdEnsured;
}

async function loadFwdInvoices(r) {
  await ensureFwdTable();
  const result = await query(
    `SELECT OrderWeek, Awb, InvoiceNo FROM WebForwarderInvoice
      WHERE isDeleted = 0 AND OrderYear + REPLACE(OrderWeek, '-', '') BETWEEN @yws AND @ywe`,
    rangeParams(r)
  );
  const map = {};
  result.recordset.forEach(x => { map[`${x.OrderWeek}|${normAwb(x.Awb)}`] = x.InvoiceNo; });
  return map;
}

export default withAuth(async function handler(req, res) {
  try {
    // 포워더 인보이스 upsert — { type:'fwdInvoice', week, awb, invoiceNo } (invoiceNo 빈값 = 삭제)
    if (req.method === 'POST' && req.body?.type === 'fwdInvoice') {
      await ensureFwdTable();
      const { week, awb, invoiceNo } = req.body || {};
      const wk = normalizeOrderWeek(week || '');
      if (!wk || !String(awb || '').trim()) {
        return res.status(400).json({ success: false, error: 'week, awb 필요' });
      }
      const orderYear = resolveActiveOrderYear(week, '');
      const params = {
        yr: { type: sql.NVarChar, value: orderYear },
        wk: { type: sql.NVarChar, value: wk },
        awb: { type: sql.NVarChar, value: String(awb).trim() },
        inv: { type: sql.NVarChar, value: String(invoiceNo || '').trim().slice(0, 120) },
        uid: { type: sql.NVarChar, value: req.user?.userId || 'admin' },
      };
      await query(
        `UPDATE WebForwarderInvoice SET isDeleted=1
          WHERE OrderYear=@yr AND OrderWeek=@wk AND Awb=@awb AND isDeleted=0`, params);
      if (String(invoiceNo || '').trim()) {
        await query(
          `INSERT INTO WebForwarderInvoice (OrderYear, OrderWeek, Awb, InvoiceNo, CreateID)
           VALUES (@yr, @wk, @awb, @inv, @uid)`, params);
      }
      return res.status(200).json({ success: true });
    }

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

    // 정산서 데이터 — excel=1 은 xlsx 다운로드, settlement=1 은 웹 "정산서 보기"용 JSON (동일 생성 경로)
    if (req.query.excel === '1' || req.query.settlement === '1') {
      const payDate = String(req.query.payDate || '').trim()
        || `${new Date().getMonth() + 1}/${new Date().getDate()}`;
      const data = await buildSettlementExcel(r, payDate);
      if (req.query.settlement === '1') {
        return res.status(200).json({ success: true, ...data });
      }
      const buf = settlementToXlsx(data);
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
          ROUND(SUM(ISNULL(wd.OutQuantity, 0)), 2) AS qty,
          SUM(CASE WHEN ISNULL(wd.TPrice, 0) <> 0 THEN 1 ELSE 0 END) AS pricedLines,
          SUM(CASE WHEN ISNULL(wd.TPrice, 0) <> 0
                    AND (p.ProdName LIKE N'%운송%' OR p.ProdName LIKE N'%운임%') THEN 1 ELSE 0 END) AS pricedFreightLines
        FROM WarehouseMaster wm
        JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
        LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
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
    const fwdInvoices = await loadFwdInvoices(r);

    // 특이사항 자동탐지 — 조회 시 화면 배너로 바로 노출
    const notices = [];
    // ① 금액 있는 품목이 전부 운송료(운임)인데 농장명이 포워더가 아닌 마스터 (예: 29-01 'Apollo' 오등록)
    //    GW/CW 등 금액 0 메타라인은 판정에서 제외
    result.recordset
      .filter(x => x.pricedLines > 0 && x.pricedFreightLines === x.pricedLines && !isForwarder(x.farmName))
      .forEach(x => notices.push({
        level: 'warn',
        text: `${x.week} · AWB ${x.awb || '(미상)'} · ${Number(x.inTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })} — 품목이 전부 운송료인데 농장명이 '${x.farmName || '(미상)'}'로 등록됨. 입고관리에서 포워더명(FREIGHTWISE 등)으로 수정해야 정산서 포워딩 시트로 분류됩니다.`,
      }));
    // ② 같은 운송장이 대시 유무 등 표기 차이로 여러 개로 입력된 경우 (화면에선 한 그룹으로 합쳐 표시)
    const awbSpellings = new Map();
    result.recordset.forEach(x => {
      if (!x.awb) return;
      const k = `${x.week}|${normAwb(x.awb)}`;
      if (!awbSpellings.has(k)) awbSpellings.set(k, new Set());
      awbSpellings.get(k).add(x.awb);
    });
    [...awbSpellings.entries()]
      .filter(([, s]) => s.size > 1)
      .forEach(([k, s]) => notices.push({
        level: 'info',
        text: `${k.split('|')[0]} — 같은 운송장이 ${[...s].map(a => `'${a}'`).join(' / ')} 로 표기가 달라 한 그룹으로 합쳐 표시했습니다. 입고관리에서 표기를 통일해 주세요.`,
      }));

    return res.status(200).json({
      success: true,
      orderYear: r.startYear,
      weekStart: r.ws,
      weekEnd: r.we,
      rows: result.recordset,
      adjustments,
      fwdInvoices,
      notices,
    });
  } catch (err) {
    const status = /필요|형식|범위/.test(err.message) ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});
