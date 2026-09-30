// lib/profitWorkbookRules.js — 매출원가 양식 "원천시트"(판매현황·불량차감·그 외 매출액·구매현황·지역별) 순수 규칙.
// DB/파일 의존 없음(서버·클라이언트·테스트 공용). 계약: docs/contracts/profit-workbook.json
//
// 규칙(승인된 설계, 2026-09-30):
//  - 판매현황: 수량 = sd.EstQuantity, 금액 = 저장 sd.Amount / sd.Vat (단가×수량 재계산 금지 — 환산품목 축소 사고)
//  - 거래처명 비교키 = NFKC + 공백 제거 + 괄호 별칭 제거 ('아이엠 (I am)' = '아이엠')
//  - 차감: Estimate 행을 품목(ProdKey)으로 조인. 불량차감(CodeInfo.Descr2='불량차감') → 불량차감 시트, 나머지 → 그 외 매출액.
//    ERP에 없는 행(엑셀에만 있는 운송료·수기 차감 등)은 웹 수기행으로 추가·수정한다.
//  - 구매현황: WarehouseMaster/Detail TPrice(외화), 수량 = wd.EstQuantity. 국가는 PURCHASE_COUNTRIES 만.
//  - 지역: Customer.CustArea(ERP 원본) → 경부호남/양재동/지방/기타. 별도 매핑 테이블 없음.

/**
 * 구매현황 시트에 들어가는 원산지(Product.CounName).
 * 근거: 샘플 워크북(22·25·27·28차) 구매현황 N열 분류식이 부여하는 국가 전부(콜롬비아 5화종 → 콜롬비아)와
 * DB 입고 국가 대조. 엑셀에 없는 유일한 DB 국가는 '국내'(운송료·Gross/Chargeable weight 등 BILL 비용행 —
 * 엑셀은 이 행들을 '포워딩' 시트로 따로 관리)이다. 미국·일본·뉴질랜드는 표본 4개 차수에는 입고가 없었지만
 * 엑셀 분류식(Beargrass/SALAL→미국, sweet pea→일본, PAEONIA→뉴질랜드)에 명시돼 있어 포함한다.
 */
export const PURCHASE_COUNTRIES = Object.freeze([
  '콜롬비아', '에콰도르', '네덜란드', '태국', '중국', '베트남', '호주', '미국', '일본', '뉴질랜드',
]);

export const SHEETS = Object.freeze({
  SALES: 'sales',          // 판매현황
  DEFECT: 'defect',        // 불량차감
  OTHER: 'other',          // 그 외 매출액
  PURCHASE: 'purchase',    // 구매현황
});
export const SHEET_LABEL = Object.freeze({
  sales: '판매현황', defect: '불량차감', other: '그 외 매출액', purchase: '구매현황',
});

// 화면 서브탭 → 필요한 시트
export const SUB_TABS = Object.freeze([
  { key: 'sales', label: '판매현황', sheets: ['sales'] },
  { key: 'deduct', label: '불량차감+그외매출액', sheets: ['defect', 'other'] },
  { key: 'purchase', label: '구매현황', sheets: ['purchase'] },
  { key: 'regionSales', label: '지역별 판매현황', sheets: ['sales'] },
  { key: 'regionRevenue', label: '지역별 매출현황', sheets: ['sales', 'defect', 'other'] },
]);

export const REGION_ALL = '전체';
export const REGIONS = Object.freeze(['경부호남', '양재동', '지방', '기타']);

/** Customer.CustArea(ERP) → 지역 그룹. 경부선·경부선_주광·호남선 = 경부호남, 지방·지방직매장 = 지방. */
export function regionOf(custArea) {
  const a = String(custArea ?? '').normalize('NFKC').replace(/\s+/g, '');
  if (!a) return '기타';
  if (/^(경부|호남)/.test(a)) return '경부호남';
  if (/^양재/.test(a)) return '양재동';
  if (/^지방/.test(a)) return '지방';
  return '기타';
}

export const normText = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
/** 거래처 비교키: NFKC + 괄호 별칭 제거(엑셀 '아이엠' = DB '아이엠 (I am)'·'아이엠(미우)'). */
export const custKeyOf = (s) => normText(s).replace(/\(.*?\)/g, '') || normText(s);
/** 거래처 표시명: NFKC + 괄호 제거 + 공백 정리. */
export const custDisplayName = (s) => {
  const t = String(s ?? '').normalize('NFKC').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return t || String(s ?? '').normalize('NFKC').trim();
};
/** 인보이스 비교키: 숫자만, 앞 0 제거('FC62884'='62884', 'KR006/2026'='62026'). */
export const invoiceKeyOf = (s) => String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');

const FARM_STOP = /\b(c\.?\s?i\.?|flowers?|flores|flora|farms?|finca|greens?|group|grupo|trading|export|import|s\.?\s?a\.?\s?s?\.?|sas|llc|ltda\.?|ltd\.?|inc\.?|co\.?|b\.?v\.?|company|limited|industry|development|the|de|del|la|el|agricola|grower)\b/gi;
/**
 * 농장명 정규화 토큰 집합(괄호 안 별칭 포함). 'ZELECTA TRADING GROUP(Matina Flowers)' → {zelecta, matina},
 * 'CI MAXIFLORES S.A.S. (Natuflora)' → {maxiflores, natuflora}, 'GROWER;FLORICOLA LA ROSALEDA S.A.' → {floricola, rosaleda}.
 */
export function farmTokens(s) {
  const raw = String(s ?? '').normalize('NFKC');
  const parts = [raw.replace(/\(.*?\)/g, ' '), ...[...raw.matchAll(/\((.*?)\)/g)].map((m) => m[1])];
  const out = new Set();
  for (const p of parts) {
    for (const t of p.toLowerCase().replace(/[;,&]/g, ' ').replace(FARM_STOP, ' ').replace(/[^a-z0-9가-힣 ]/g, ' ').split(/\s+/)) {
      if (t.length >= 3) out.add(t);
    }
  }
  return out;
}
export function farmNameMatches(a, b) {
  const A = farmTokens(a); const B = farmTokens(b);
  for (const t of A) if (B.has(t)) return true;
  return false;
}
/** 농장 표시명: 괄호 별칭·법인 접미를 뗀 정리명(원본 FarmName은 그대로 보존). */
export function farmDisplayName(s) {
  const t = String(s ?? '').normalize('NFKC').replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\b(S\.?\s?A\.?\s?S\.?|SAS|S\.A\.|LLC|LTDA\.?|B\.V\.|C\.I\.?)\s*$/i, '').replace(/\s+/g, ' ').trim();
  return t || String(s ?? '').trim();
}

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const round2 = (v) => Math.round(num(v) * 100) / 100;

// ── RowKey — 스냅샷 간 행 동일성(수기값 이월 기준). ERP 행은 원천 PK, 수기행은 'M:' 접두.
export const rowKeyOf = {
  sales: (r) => `S:${r.custKey}:${r.prodKey}`,
  defect: (r) => `E:${r.estimateKey}`,
  other: (r) => `E:${r.estimateKey}`,
  purchase: (r) => `W:${r.warehouseKey}:${r.prodKey}`,
};
export const isManualRowKey = (k) => String(k || '').startsWith('M:');

// 시트별 수치 필드(합계·변경분 비교 대상)
export const NUMERIC_FIELDS = Object.freeze({
  sales: ['qty', 'supply', 'vat', 'total'],
  defect: ['qty', 'supply', 'vat', 'total'],
  other: ['qty', 'supply', 'vat', 'total'],
  purchase: ['qty', 'usd'],
});
// 수기 편집 가능한 필드(수기행은 전부, ERP행은 이 필드만 셀 보정 가능)
export const EDITABLE_FIELDS = Object.freeze({
  sales: ['category', 'memo'],
  defect: ['custName', 'typeName', 'qty', 'unitCost', 'supply', 'vat', 'prodName', 'category', 'memo'],
  other: ['custName', 'typeName', 'qty', 'unitCost', 'supply', 'vat', 'prodName', 'category', 'memo'],
  purchase: ['farmName', 'prodName', 'qty', 'usd', 'invoiceNo', 'category', 'memo'],
});

/** 판매로 출고되지만 매출원가 양식에선 '그 외 매출액'에 넣는 비용성 품목 */
export const FREIGHT_SALES_RE = /운송료|현지상차\s?운임/;

/** FREIGHT_SALES_RE 와 같은 판정의 SQL 조각(품목 별칭 alias). 본표 N/O·판매현황 시트·드라이버 분석이 공유한다. */
export function freightSalesProductSql(alias = 'p') {
  const name = `ISNULL(${alias}.ProdName,N'')`;
  return `(${name} LIKE N'%운송료%' OR REPLACE(${name},N' ',N'') LIKE N'%현지상차운임%')`;
}

/** 판매현황 raw(SQL: 거래처×품목 집계) → 행 */
export function buildSalesRows(raw = []) {
  return raw.map((r) => {
    const supply = num(r.Amount); const vat = num(r.Vat); const qty = num(r.EstQuantity);
    const row = {
      custKey: r.CustKey, custName: custDisplayName(r.CustName), custNameRaw: r.CustName,
      custArea: r.CustArea || '', region: regionOf(r.CustArea),
      prodKey: r.ProdKey, prodName: r.ProdName, category: r.Category || '',
      qty, unitPrice: qty ? Math.round((supply + vat) / qty) : 0, supply, vat, total: supply + vat,
    };
    // 운송료·현지상차운임 판매행은 엑셀에서 '그 외 매출액'(품목명=운송료명, 적요 공란)에 들어간다
    if (FREIGHT_SALES_RE.test(String(r.ProdName || ''))) {
      return { sheet: 'other', rowKey: rowKeyOf.sales(row), data: { ...row, typeName: r.ProdName, prodName: '', unitCost: row.unitPrice, source: 'shipment' } };
    }
    return { sheet: 'sales', rowKey: rowKeyOf.sales(row), data: row };
  }).sort((a, b) => String(a.data.category).localeCompare(String(b.data.category), 'ko')
    || String(a.data.prodName).localeCompare(String(b.data.prodName), 'ko')
    || String(a.data.custName).localeCompare(String(b.data.custName), 'ko'));
}

/** 차감 raw(SQL: Estimate 행 단위) → 불량차감/그 외 매출액 행 */
export function buildDeductionRows(raw = []) {
  return raw.map((r) => {
    const sheet = r.TypeGroup === '불량차감' ? 'defect' : 'other';
    const supply = num(r.Amount); const vat = num(r.Vat);
    const row = {
      estimateKey: r.EstimateKey, date: r.EstimateDate || '', custKey: r.CustKey,
      custName: r.CustName, custArea: r.CustArea || '', region: regionOf(r.CustArea),
      typeName: r.TypeName || '', typeGroup: r.TypeGroup || '', qty: num(r.Quantity), unitCost: num(r.Cost),
      supply, vat, total: supply + vat, prodKey: r.ProdKey, prodName: r.ProdName || '', category: r.Category || '',
      memo: r.Descr || '',
    };
    return { sheet, rowKey: rowKeyOf[sheet](row), data: row };
  }).sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)) || a.data.estimateKey - b.data.estimateKey);
}

/** 구매현황 raw(SQL: 입고 상세 행) → 행. countries 밖(국내 비용행 등)은 제외. */
export function buildPurchaseRows(raw = [], countries = PURCHASE_COUNTRIES) {
  const allow = new Set(countries);
  return raw.filter((r) => allow.has(String(r.CounName || '').trim())).map((r) => {
    const row = {
      warehouseKey: r.WarehouseKey, date: r.InputDate || '', week: r.OrderWeek || '',
      farmName: r.FarmName || '', farmDisplay: farmDisplayName(r.FarmName), invoiceNo: r.InvoiceNo || '',
      prodKey: r.ProdKey, prodName: r.ProdName || '', country: r.CounName || '', category: r.Category || '',
      qty: num(r.EstQuantity), boxQty: num(r.BoxQuantity), unitPrice: num(r.UPrice), usd: round2(r.TPrice),
    };
    return { sheet: 'purchase', rowKey: rowKeyOf.purchase(row), data: row };
  }).sort((a, b) => String(a.data.week).localeCompare(String(b.data.week))
    || String(a.data.farmDisplay).localeCompare(String(b.data.farmDisplay)) || a.data.warehouseKey - b.data.warehouseKey);
}

/** 수기 셀 보정 적용: row.manual = { field: { value, by, at } } → 표시용 data */
export function effectiveData(row) {
  const d = { ...(row.data || {}) };
  for (const [f, m] of Object.entries(row.manual || {})) if (m && 'value' in m) d[f] = m.value;
  if (['defect', 'other', 'sales'].includes(row.sheet)) d.total = num(d.supply) + num(d.vat);
  return d;
}

export function sheetTotals(rows = []) {
  const out = {};
  for (const sheet of Object.keys(NUMERIC_FIELDS)) {
    const t = { rows: 0 }; for (const f of NUMERIC_FIELDS[sheet]) t[f] = 0;
    out[sheet] = t;
  }
  for (const r of rows) {
    const t = out[r.sheet]; if (!t) continue;
    const d = effectiveData(r); t.rows += 1;
    for (const f of NUMERIC_FIELDS[r.sheet]) t[f] += num(d[f]);
  }
  for (const t of Object.values(out)) for (const k of Object.keys(t)) if (k !== 'rows') t[k] = round2(t[k]);
  return out;
}

/**
 * 새 버전 행 = 새 원천(ERP) 행 + 이전 버전의 수기행 + 이전 버전 수기 셀보정(같은 RowKey).
 * 이전 버전에만 있던 ERP 행은 버린다(원천에서 사라짐 → 변경분 패널에 '삭제'로 보임).
 */
export function carryManual(prevRows = [], freshRows = []) {
  const prevByKey = new Map(prevRows.map((r) => [`${r.sheet}|${r.rowKey}`, r]));
  const out = freshRows.map((r) => {
    const p = prevByKey.get(`${r.sheet}|${r.rowKey}`);
    return p && p.manual && Object.keys(p.manual).length ? { ...r, manual: p.manual } : { ...r };
  });
  for (const p of prevRows) if (isManualRowKey(p.rowKey)) out.push({ ...p });
  return out;
}

/** 수기 편집(초안) 적용: edits = [{ op:'set', sheet, rowKey, field, value } | { op:'addRow', sheet, rowKey, data } | { op:'removeRow', sheet, rowKey }] */
export function applyEdits(rows = [], edits = [], { by, at } = {}) {
  let out = rows.map((r) => ({ ...r, manual: { ...(r.manual || {}) } }));
  for (const e of edits) {
    if (!e || !SHEET_LABEL[e.sheet]) throw new Error(`알 수 없는 시트: ${e?.sheet}`);
    if (e.op === 'addRow') {
      if (!isManualRowKey(e.rowKey)) throw new Error('수기행 RowKey는 M: 로 시작해야 합니다.');
      if (out.some((r) => r.sheet === e.sheet && r.rowKey === e.rowKey)) throw new Error(`중복 수기행: ${e.rowKey}`);
      const data = {};
      for (const f of EDITABLE_FIELDS[e.sheet]) if (e.data && f in e.data) data[f] = e.data[f];
      if (data.custName) data.region = e.data?.region || '기타';
      out.push({ sheet: e.sheet, rowKey: e.rowKey, isManual: true, data, manual: {}, manualBy: by, manualAt: at });
    } else if (e.op === 'removeRow') {
      if (!isManualRowKey(e.rowKey)) throw new Error('ERP 원천행은 삭제할 수 없습니다(수기행만 삭제 가능).');
      out = out.filter((r) => !(r.sheet === e.sheet && r.rowKey === e.rowKey));
    } else if (e.op === 'set') {
      const r = out.find((x) => x.sheet === e.sheet && x.rowKey === e.rowKey);
      if (!r) throw new Error(`행 없음: ${e.sheet} ${e.rowKey}`);
      if (!EDITABLE_FIELDS[e.sheet].includes(e.field)) throw new Error(`수정 불가 필드: ${e.field}`);
      const numeric = NUMERIC_FIELDS[e.sheet].includes(e.field) || ['unitCost'].includes(e.field);
      const value = numeric ? num(String(e.value).replace(/,/g, '')) : String(e.value ?? '');
      if (isManualRowKey(r.rowKey)) { r.data = { ...r.data, [e.field]: value }; r.manualBy = by; r.manualAt = at; }
      else r.manual[e.field] = { value, by, at };
    } else throw new Error(`알 수 없는 편집: ${e.op}`);
  }
  return out;
}

/** 스냅샷 vs 현재 원천 변경분(ERP 행만 비교 — 수기행은 원천이 없으므로 제외). */
export function diffRows(snapRows = [], liveRows = []) {
  const key = (r) => `${r.sheet}|${r.rowKey}`;
  const S = new Map(snapRows.filter((r) => !isManualRowKey(r.rowKey)).map((r) => [key(r), r]));
  const L = new Map(liveRows.map((r) => [key(r), r]));
  const changes = [];
  for (const [k, l] of L) {
    const s = S.get(k);
    if (!s) { changes.push({ kind: 'added', sheet: l.sheet, rowKey: l.rowKey, after: l.data }); continue; }
    const fields = NUMERIC_FIELDS[l.sheet].filter((f) => Math.abs(num(s.data[f]) - num(l.data[f])) > 0.005);
    if (fields.length) changes.push({ kind: 'changed', sheet: l.sheet, rowKey: l.rowKey, fields, before: s.data, after: l.data });
  }
  for (const [k, s] of S) if (!L.has(k)) changes.push({ kind: 'removed', sheet: s.sheet, rowKey: s.rowKey, before: s.data });
  return changes;
}

/** 지역별 매출현황: 거래처 단위 매출·차감·순매출(공급가 기준) */
export function buildRegionRevenue(rows = [], region = REGION_ALL) {
  const m = new Map();
  for (const r of rows) {
    if (!['sales', 'defect', 'other'].includes(r.sheet)) continue;
    const d = effectiveData(r);
    const reg = d.region || '기타';
    if (region !== REGION_ALL && reg !== region) continue;
    const k = `${reg}|${custKeyOf(d.custName)}`;
    const t = m.get(k) || { region: reg, custName: custDisplayName(d.custName), sales: 0, salesVat: 0, defect: 0, other: 0 };
    if (r.sheet === 'sales') { t.sales += num(d.supply); t.salesVat += num(d.vat); }
    else t[r.sheet] += num(d.supply);
    m.set(k, t);
  }
  return [...m.values()].map((t) => ({ ...t, net: t.sales + t.defect + t.other }))
    .sort((a, b) => REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region) || b.net - a.net);
}

// ── 권한 ──────────────────────────────────────────────────────────────
// 강명훈·관리자: 전체(확정/최신화/편집/다운로드). 김원영: 지역별 매출현황 조회. 정재훈·박성수: 지역별 판매현황 조회.
export const WORKBOOK_ACCESS = Object.freeze({
  full: { userIds: ['nenovams2'], userNames: ['강명훈'] },
  regionRevenue: { userIds: ['nenova1'], userNames: ['김원영'] },
  regionSales: { userIds: ['nenovasd1', 'nenovasd7'], userNames: ['정재훈', '박성수'] },
});
const inList = (user, spec) => spec.userIds.includes(String(user?.userId ?? '').trim().toLowerCase())
  || spec.userNames.includes(String(user?.userName ?? '').trim());

export function resolveWorkbookAccess(user = {}, { isAdmin = false } = {}) {
  const full = Boolean(isAdmin) || inList(user, WORKBOOK_ACCESS.full);
  const tabs = new Set();
  if (full) SUB_TABS.forEach((t) => tabs.add(t.key));
  if (inList(user, WORKBOOK_ACCESS.regionRevenue)) tabs.add('regionRevenue');
  if (inList(user, WORKBOOK_ACCESS.regionSales)) tabs.add('regionSales');
  const sheets = new Set();
  for (const t of SUB_TABS) if (tabs.has(t.key)) t.sheets.forEach((s) => sheets.add(s));
  return { full, canEdit: full, canConfirm: full, canDownload: full, tabs: [...tabs], sheets: [...sheets] };
}

/** 사용자 기본 지역 = 담당 거래처(Customer.Manager=UserName) CustArea 최빈 지역, 없으면 전체 */
export function defaultRegionFor(areaCounts = []) {
  const byRegion = new Map();
  for (const a of areaCounts) {
    const reg = regionOf(a.CustArea);
    if (reg === '기타') continue;
    byRegion.set(reg, (byRegion.get(reg) || 0) + num(a.n));
  }
  let best = REGION_ALL; let max = 0;
  for (const [reg, n] of byRegion) if (n > max) { best = reg; max = n; }
  return best;
}

// ── 엑셀 샘플 대조(골든) ────────────────────────────────────────────────
function addTo(m, k, o) { const t = m.get(k) || {}; for (const [a, v] of Object.entries(o)) t[a] = (t[a] || 0) + num(v); m.set(k, t); }
export function compareMaps(X, D, fields, tol = 1) {
  let cells = 0; let ok = 0; let onlyX = 0; let onlyD = 0;
  for (const [k, x] of X) {
    const d = D.get(k);
    if (!d) { onlyX += 1; cells += fields.length; continue; }
    for (const f of fields) { cells += 1; if (Math.abs(num(x[f]) - num(d[f])) <= tol) ok += 1; }
  }
  for (const k of D.keys()) if (!X.has(k)) onlyD += 1;
  return { keysX: X.size, keysD: D.size, onlyX, onlyD, cells, ok, pct: cells ? ok / cells : 1 };
}
/** 엑셀 판매현황 행(A:거래처,B:품목,C:수량,E:공급가,F:부가세) → 거래처×품목 맵 */
export function excelSalesMap(aoa = []) {
  const X = new Map();
  for (const r of aoa) {
    if (!r || !r[0] || !r[1] || /계$/.test(String(r[0]))) continue;
    addTo(X, `${custKeyOf(r[0])}|${normText(r[1])}`, { qty: r[2], supply: r[4], vat: r[5] });
  }
  return X;
}
export function rowsSalesMap(rows = []) {
  const D = new Map();
  for (const r of rows) if (r.sheet === 'sales') { const d = effectiveData(r); addTo(D, `${custKeyOf(d.custNameRaw || d.custName)}|${normText(d.prodName)}`, { qty: d.qty, supply: d.supply, vat: d.vat }); }
  return D;
}
/** 엑셀 차감 시트 행(B:거래처,D:수량,F:공급가,I:적요=품목) */
export function excelDeductMap(aoa = []) {
  const X = new Map();
  for (const r of aoa) { if (!r || !r[1] || typeof r[5] !== 'number') continue; addTo(X, `${custKeyOf(r[1])}|${normText(r[8])}`, { qty: r[3], supply: r[5] }); }
  return X;
}
export function rowsDeductMap(rows = [], sheet) {
  const D = new Map();
  for (const r of rows) if (r.sheet === sheet && !isManualRowKey(r.rowKey)) { const d = effectiveData(r); addTo(D, `${custKeyOf(d.custName)}|${normText(d.prodName)}`, { qty: d.qty, supply: d.supply }); }
  return D;
}
/** 구매현황: 인보이스 숫자키 우선(없으면 농장 토큰) — 농장 표기(C.I. FLORES DE FUNZA SAS ↔ Flores De Funza)가 달라도 매칭 */
export function excelPurchaseMap(aoa = []) {
  const X = new Map();
  for (const r of aoa) { if (!r || !r[1] || typeof r[6] !== 'number') continue; const inv = invoiceKeyOf(r[11]); addTo(X, inv ? `inv:${inv}` : `farm:${[...farmTokens(r[1])].sort().join('+')}`, { usd: r[6] }); }
  return X;
}
export function rowsPurchaseMap(rows = []) {
  const D = new Map();
  for (const r of rows) if (r.sheet === 'purchase' && !isManualRowKey(r.rowKey)) { const d = effectiveData(r); const inv = invoiceKeyOf(d.invoiceNo); addTo(D, inv ? `inv:${inv}` : `farm:${[...farmTokens(d.farmName)].sort().join('+')}`, { usd: d.usd }); }
  return D;
}
