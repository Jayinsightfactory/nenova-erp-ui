// lib/profitReportSnapshot.js — 주차별 매출이익 보고서 "계산 결과 스냅샷"(웹 전용, INSERT 전용).
//
// 사장님 요구(2026-09-30): "변경내역 없으면 확정된 상태로 과거 차수 매출자료는 있게 해서
// 매번 페이지 들어갈 때마다 로딩 오래 걸리게 하는 현상 없애줘".
//
// 동작
//  1) 조회 시 입력 지문(fingerprint)만 먼저 계산한다 — 원천 테이블별 COUNT/CHECKSUM_AGG/MAX(시각)
//     (차수 n 과 그 앞 4개 차수, 연도 경계 포함) + 웹 입력 테이블 + 전역값(통화마스터·통관 단가표·
//     분류 오버라이드 파일) + 계산식 지문(calcVersion). 수백 ms.
//  2) 저장본 지문 == 현재 지문 && 전차수 저장본이 그때와 같음 → 저장본을 즉시 반환("확정됨(변경 없음)").
//  3) 다르면 저장본을 즉시 반환 + "원천 변경 감지: 무엇이(테이블·차수)" 배너, 백그라운드에서 재계산 후
//     새 버전 INSERT(이력 보존). [최신화]는 동기 재계산.
//  4) E(n)=F(n-1) 이므로 저장본은 계산 당시 전차수(n-1) 최신 저장본의 결과 해시(PrevPayloadHash)를 기억한다.
//     n-1 이 재계산되어 결과가 달라지면 n 은 "전차수 재계산됨"으로 stale 이 된다(연쇄).
//
// ERP 테이블은 SELECT 만 한다. 쓰기는 WebProfitReportSnapshot(웹 전용, 트리거로 UPDATE/DELETE 차단)뿐이다.
import crypto from 'crypto';
import { query, sql } from './db.js';
import { loadProfitCategoryOverrides } from './profitReportCategoryOverrides.js';
import calcHashModule from './profitReportCalcHash.cjs';

export const SNAPSHOT_TABLE = 'WebProfitReportSnapshot';
export const FINGERPRINT_WINDOW = 4; // 차수 n 의 앞 4개 차수까지(최근 매입 단가 fallback·이월 범위)

let _calcVersion = null;
export function profitReportCalcVersion() {
  if (_calcVersion) return _calcVersion;
  _calcVersion = process.env.PROFIT_REPORT_CALC_HASH || (() => {
    try { return calcHashModule.computeProfitReportCalcHash(process.cwd()); } catch { return calcHashModule.PROFIT_REPORT_CALC_VERSION; }
  })();
  return _calcVersion;
}

export const pad2 = (m) => String(Number(m)).padStart(2, '0');

/** 차수 n 의 지문 창(자기 자신 + 앞 FINGERPRINT_WINDOW 개) — [{ year, major }] (연도 경계: 01차 앞은 전년 52차). */
export function fingerprintWindow(orderYear, major, size = FINGERPRINT_WINDOW) {
  const out = [];
  let y = Number(orderYear);
  let m = Number(major);
  for (let i = 0; i <= size; i += 1) {
    out.push({ year: String(y), major: pad2(m) });
    m -= 1;
    if (m < 1) { m = 52; y -= 1; }
  }
  return out;
}

// 지문 구성요소 → 사람이 읽는 이름
const COMPONENT_LABELS = {
  SHIP: '출고(판매) 상세', EST: '견적 차감/그외매출', WH: '입고(구매) 상세·GW/CW', FC: '운임 전표(FreightCost)',
  STOCK: '재고 스냅샷(ProductStock)', SH: '재고 변경이력(StockHistory)',
  WPR: '보고서 수기값·비고', WCUS: '그외통관비 입력(국가)', WFWD: '포워딩 입력', WCOL: '콜롬비아 통관 입력',
  WSPE: '재고 매입단가 입력', WACL: '원가자료 업로드(환율·도착원가)', WTXR: '과세환율 입력',
  CUR: '통화마스터 환율', RATECFG: '통관 단가표', RATEHIST: '통관 단가 이력', CUSHIST: '통관 입력 이력',
  ARRIMP: '원가자료 업로드 목록', PRODUCT: '품목 마스터', CATFILE: '보고서 분류 오버라이드', CALC: '계산식(배포 버전)',
};

const WEEK2 = (col) => `RIGHT('0' + LEFT(${col}, CASE WHEN CHARINDEX('-', ${col}) > 0 THEN CHARINDEX('-', ${col}) - 1 ELSE LEN(${col}) END), 2)`;

async function tableExists(name) {
  const r = await query(`SELECT OBJECT_ID(@n, N'U') AS id`, { n: { type: sql.NVarChar, value: `dbo.${name}` } });
  return Boolean(r.recordset?.[0]?.id);
}

const _existsCache = new Map();
async function cachedExists(name) {
  const hit = _existsCache.get(name);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v;
  const v = await tableExists(name);
  _existsCache.set(name, { v, at: Date.now() });
  return v;
}

/**
 * 연도(들) 전체 차수별 원천 지문 — 한 번의 배치로 모든 테이블을 (연도, 대차수) 단위로 집계한다.
 * 결과는 Map<"T:YYYY:WW", "count|checksum|max"> + 전역값. 15초 메모리 캐시(월별 보기처럼 여러 차수를 연달아 볼 때).
 */
const _fpCache = new Map();
export async function loadSourceFingerprints(years) {
  const ys = [...new Set(years.map(String))].sort();
  const cacheKey = ys.join(',');
  const hit = _fpCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 15000) return hit;
  const [hasTxr, hasCol, hasCus, hasFwd, hasSpe, hasAcl, hasAci, hasRc, hasRh, hasCh, hasWpr] = await Promise.all([
    'WebTaxableExchangeRate', 'WebColombiaWeekly', 'WebCustomsWeekly', 'WebForwardingWeekly', 'WebStockPriceEvidence',
    'WebArrivalCostLine', 'WebArrivalCostImport', 'WebCustomsRateConfig', 'WebCustomsRateHistory', 'WebCustomsHistory', 'WebProfitReport',
  ].map(cachedExists));
  const yIn = ys.map((_, i) => `@y${i}`).join(',');
  const params = Object.fromEntries(ys.map((y, i) => [`y${i}`, { type: sql.NVarChar, value: y }]));
  const parts = [
    `SELECT 'SHIP' T, sm.OrderYear Y, ${WEEK2('sm.OrderWeek')} W, COUNT_BIG(sd.SdetailKey) C,
       CHECKSUM_AGG(CHECKSUM(sd.SdetailKey, sd.EstQuantity, sd.OutQuantity, sd.BoxQuantity, sd.Amount, sd.Vat, sd.Cost, sd.isFix, sd.ProdKey, sd.CustKey, sm.isDeleted, sm.isFix)) H,
       CONVERT(varchar(30), MAX(sm.LastUpdateDtm), 126) M
     FROM ShipmentMaster sm LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
     WHERE sm.OrderYear IN (${yIn}) GROUP BY sm.OrderYear, ${WEEK2('sm.OrderWeek')}`,
    `SELECT 'EST' T, sm.OrderYear Y, ${WEEK2('sm.OrderWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(e.EstimateKey, e.Amount, e.Vat, e.Quantity, e.Cost, e.ProdKey, e.EstimateType, sm.isDeleted)) H,
       CONVERT(varchar(30), MAX(e.EstimateDtm), 126) M
     FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
     WHERE sm.OrderYear IN (${yIn}) GROUP BY sm.OrderYear, ${WEEK2('sm.OrderWeek')}`,
    `SELECT 'WH' T, wm.OrderYear Y, ${WEEK2('wm.OrderWeek')} W, COUNT_BIG(wd.WdetailKey) C,
       CHECKSUM_AGG(CHECKSUM(wd.WdetailKey, wd.ProdKey, wd.EstQuantity, wd.OutQuantity, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.UPrice, wd.TPrice,
         wm.isDeleted, wm.GrossWeight, wm.ChargeableWeight, wm.FreightRateUSD, wm.DocFeeUSD, wm.InputDate, wm.OrderNo, wm.FarmName, wm.InvoiceNo)) H,
       CONVERT(varchar(30), MAX(wm.LastUpdateDtm), 126) M
     FROM WarehouseMaster wm LEFT JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
     WHERE wm.OrderYear IN (${yIn}) GROUP BY wm.OrderYear, ${WEEK2('wm.OrderWeek')}`,
    `SELECT 'FC' T, wm.OrderYear Y, ${WEEK2('wm.OrderWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(fc.FreightKey, fc.isDeleted, fc.ExchangeRate, fc.GrossWeight, fc.ChargeableWeight, fc.FreightRateUSD, fc.DocFeeUSD, fc.InvoiceTotalUSD,
         fc.BakSangRate, fc.HandlingFee, fc.QuarantinePerItem, fc.DomesticFreight, fc.DeductFee, fc.ExtraFee)) H,
       CONVERT(varchar(30), MAX(ISNULL(fc.UpdateDtm, fc.CreateDtm)), 126) M
     FROM FreightCost fc JOIN WarehouseMaster wm ON wm.WarehouseKey = fc.WarehouseKey
     WHERE wm.OrderYear IN (${yIn}) GROUP BY wm.OrderYear, ${WEEK2('wm.OrderWeek')}`,
    `SELECT 'STOCK' T, st.OrderYear Y, ${WEEK2('st.OrderWeek')} W, COUNT_BIG(ps.ProdKey) C,
       CHECKSUM_AGG(CHECKSUM(st.StockKey, st.isFix, ps.ProdKey, ps.Stock)) H,
       CONVERT(varchar(30), MAX(st.LastUpdateDtm), 126) M
     FROM StockMaster st LEFT JOIN ProductStock ps ON ps.StockKey = st.StockKey
     WHERE st.OrderYear IN (${yIn}) GROUP BY st.OrderYear, ${WEEK2('st.OrderWeek')}`,
    `SELECT 'SH' T, OrderYear Y, ${WEEK2('OrderWeek')} W, COUNT_BIG(*) C, CHECKSUM_AGG(CHECKSUM(StockHistoryKey, AfterValue)) H,
       CONVERT(varchar(30), MAX(ChangeDtm), 126) M
     FROM StockHistory WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('OrderWeek')}`,
  ];
  if (hasWpr) parts.push(`SELECT 'WPR' T, OrderYear Y, ${WEEK2('MajorWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(Category, ColKey, Value, TextValue, SourceRef, EffectiveAt)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M
     FROM WebProfitReport WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('MajorWeek')}`);
  if (hasCus) parts.push(`SELECT 'WCUS' T, OrderYear Y, ${WEEK2('MajorWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(BINARY_CHECKSUM(*)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M
     FROM WebCustomsWeekly WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('MajorWeek')}`);
  if (hasFwd) parts.push(`SELECT 'WFWD' T, OrderYear Y, ${WEEK2('MajorWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(Category, AmountUSD)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M
     FROM WebForwardingWeekly WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('MajorWeek')}`);
  if (hasCol) parts.push(`SELECT 'WCOL' T, OrderYear Y, ${WEEK2('OrderWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(BINARY_CHECKSUM(*)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M
     FROM WebColombiaWeekly WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('OrderWeek')}`);
  if (hasSpe) parts.push(`SELECT 'WSPE' T, OrderYear Y, ${WEEK2('OrderWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(ProdKey, Price, EvidenceStatus, SourceRef)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M
     FROM WebStockPriceEvidence WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('OrderWeek')}`);
  if (hasAcl) parts.push(`SELECT 'WACL' T, OrderYear Y, ${WEEK2('OrderWeek')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(CHECKSUM(ArrivalLineKey, IsCurrent, ExchangeRate, ProdKey, Quantity, FobUSD, SelectedArrivalCostKRW, GrossWeight, ChargeableWeight)) H,
       CONVERT(varchar(30), MAX(ISNULL(UpdatedAt, CreatedAt)), 126) M
     FROM WebArrivalCostLine WHERE OrderYear IN (${yIn}) GROUP BY OrderYear, ${WEEK2('OrderWeek')}`);
  if (hasTxr) parts.push(`SELECT 'WTXR' T, CAST(OrderYear AS NVARCHAR(4)) Y, ${WEEK2('CAST(MajorWeek AS NVARCHAR(10))')} W, COUNT_BIG(*) C,
       CHECKSUM_AGG(BINARY_CHECKSUM(*)) H, NULL M
     FROM WebTaxableExchangeRate WHERE CAST(OrderYear AS NVARCHAR(4)) IN (${yIn}) GROUP BY CAST(OrderYear AS NVARCHAR(4)), ${WEEK2('CAST(MajorWeek AS NVARCHAR(10))')}`);
  // 전역값(연도 무관 또는 연도 단위)
  parts.push(`SELECT 'CUR' T, '' Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(CHECKSUM(CurrencyCode, ExchangeRate, IsActive)) H, MAX(UpdateDtm) M FROM CurrencyMaster`);
  parts.push(`SELECT 'PRODUCT' T, '' Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(BINARY_CHECKSUM(*)) H, NULL M FROM Product`);
  if (hasRc) parts.push(`SELECT 'RATECFG' T, '' Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(CHECKSUM(ConfigKey, Value)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M FROM WebCustomsRateConfig`);
  if (hasRh) parts.push(`SELECT 'RATEHIST' T, '' Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(BINARY_CHECKSUM(*)) H, CONVERT(varchar(30), MAX(UpdatedAt), 126) M FROM WebCustomsRateHistory`);
  if (hasCh) parts.push(`SELECT 'CUSHIST' T, OrderYear Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(CHECKSUM(HistoryKey)) H, CONVERT(varchar(30), MAX(ChangedAt), 126) M FROM WebCustomsHistory WHERE OrderYear IN (${yIn}) GROUP BY OrderYear`);
  if (hasAci) parts.push(`SELECT 'ARRIMP' T, OrderYear Y, '' W, COUNT_BIG(*) C, CHECKSUM_AGG(CHECKSUM(ImportKey, IsDeleted, RevisionNo)) H, CONVERT(varchar(30), MAX(UploadedAt), 126) M FROM WebArrivalCostImport WHERE OrderYear IN (${yIn}) GROUP BY OrderYear`);

  const r = await query(parts.join(';\n'), params);
  const map = new Map();
  for (const rs of r.recordsets || [r.recordset]) {
    for (const row of rs || []) {
      map.set(`${row.T}:${row.Y || ''}:${row.W || ''}`, `${row.C}|${row.H ?? ''}|${row.M ?? ''}`);
    }
  }
  const v = { map, at: Date.now() };
  _fpCache.set(cacheKey, v);
  return v;
}

const WEEK_TABLES = ['SHIP', 'EST', 'WH', 'FC', 'STOCK', 'SH', 'WPR', 'WCUS', 'WFWD', 'WCOL', 'WSPE', 'WACL', 'WTXR'];
const YEAR_TABLES = ['CUSHIST', 'ARRIMP'];
const GLOBAL_TABLES = ['CUR', 'PRODUCT', 'RATECFG', 'RATEHIST'];

function stableHash(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

/** 순수 함수 — 원천 지문 Map 에서 차수 n 의 지문 구성요소(객체)를 뽑는다. */
export function composeWeekFingerprint(map, orderYear, major, { calcVersion, categoryFileHash = '' } = {}) {
  const win = fingerprintWindow(orderYear, major);
  const components = {};
  for (const t of WEEK_TABLES) {
    for (const w of win) {
      const key = `${t}:${w.year}:${w.major}`;
      components[key] = map.get(key) || '';
    }
  }
  for (const t of YEAR_TABLES) {
    for (const y of [...new Set(win.map((w) => w.year))]) components[`${t}:${y}:`] = map.get(`${t}:${y}:`) || '';
  }
  for (const t of GLOBAL_TABLES) components[`${t}::`] = map.get(`${t}::`) || '';
  components['CATFILE::'] = categoryFileHash;
  components['CALC::'] = calcVersion || profitReportCalcVersion();
  return { components, hash: stableHash(Object.entries(components).sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/** 순수 함수 — 두 지문 구성요소를 비교해 "무엇이(테이블·차수) 바뀌었는지" 사람이 읽는 목록으로. */
export function describeFingerprintChanges(prev = {}, next = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const changes = [];
  for (const key of [...keys].sort()) {
    if ((prev || {})[key] === (next || {})[key]) continue;
    const [t, y, w] = key.split(':');
    const label = COMPONENT_LABELS[t] || t;
    const scope = w ? `${y} ${Number(w)}차` : y ? `${y}년` : '전체';
    changes.push({ key, table: t, label, scope, text: `${label} (${scope})` });
  }
  return changes;
}

export async function computeWeekFingerprint(orderYear, major) {
  const years = [...new Set(fingerprintWindow(orderYear, major).map((w) => w.year))];
  const { map } = await loadSourceFingerprints(years);
  let categoryFileHash = '';
  try { categoryFileHash = stableHash(loadProfitCategoryOverrides(true) || {}).slice(0, 16); } catch { categoryFileHash = 'unreadable'; }
  return composeWeekFingerprint(map, orderYear, major, { calcVersion: profitReportCalcVersion(), categoryFileHash });
}

// ── 저장소 ─────────────────────────────────────────────────────────────
let _schemaOk = null;
export async function snapshotSchemaReady() {
  if (_schemaOk === true) return true;
  _schemaOk = await tableExists(SNAPSHOT_TABLE);
  return _schemaOk;
}

function parseSnapshotRow(row, { withPayload = true } = {}) {
  if (!row) return null;
  let fingerprint = {};
  try { fingerprint = JSON.parse(row.FingerprintJson || '{}'); } catch { fingerprint = {}; }
  let payload = null;
  if (withPayload && row.PayloadJson) { try { payload = JSON.parse(row.PayloadJson); } catch { payload = null; } }
  return {
    snapKey: row.SnapKey,
    orderYear: row.OrderYear,
    major: row.MajorWeek,
    versionNo: row.VersionNo,
    calcVersion: row.CalcVersion,
    fingerprintHash: row.FingerprintHash,
    fingerprint,
    payloadHash: row.PayloadHash,
    prevPayloadHash: row.PrevPayloadHash || null,
    reason: row.Reason,
    changedFromPrev: Boolean(row.ChangedFromPrev),
    computeMs: row.ComputeMs,
    createdBy: row.CreatedBy,
    createdAt: row.CreatedAt,
    payload,
  };
}

export async function latestSnapshots(orderYear, majors, { withPayload = true } = {}) {
  if (!(await snapshotSchemaReady()) || !majors.length) return new Map();
  const params = { y: { type: sql.NVarChar, value: String(orderYear) } };
  majors.forEach((m, i) => { params[`m${i}`] = { type: sql.NVarChar, value: pad2(m) }; });
  const r = await query(
    `SELECT s.SnapKey, s.OrderYear, s.MajorWeek, s.VersionNo, s.CalcVersion, s.FingerprintHash, s.FingerprintJson,
            s.PayloadHash, s.PrevPayloadHash, s.Reason, s.ChangedFromPrev, s.ComputeMs, s.CreatedBy,
            CONVERT(varchar(33), s.CreatedAt, 126) + 'Z' AS CreatedAt ${withPayload ? ', s.PayloadJson' : ''}
       FROM dbo.${SNAPSHOT_TABLE} s
       JOIN (SELECT MajorWeek, MAX(VersionNo) AS V FROM dbo.${SNAPSHOT_TABLE}
              WHERE OrderYear = @y AND MajorWeek IN (${majors.map((_, i) => `@m${i}`).join(',')})
              GROUP BY MajorWeek) x ON x.MajorWeek = s.MajorWeek AND x.V = s.VersionNo
      WHERE s.OrderYear = @y`,
    params,
  );
  const out = new Map();
  for (const row of r.recordset || []) out.set(row.MajorWeek, parseSnapshotRow(row, { withPayload }));
  return out;
}

export async function latestSnapshot(orderYear, major, opts) {
  return (await latestSnapshots(orderYear, [pad2(major)], opts)).get(pad2(major)) || null;
}

export async function snapshotHistory(orderYear, major, limit = 20) {
  if (!(await snapshotSchemaReady())) return [];
  const r = await query(
    `SELECT TOP (@n) SnapKey, OrderYear, MajorWeek, VersionNo, CalcVersion, FingerprintHash, FingerprintJson, PayloadHash, PrevPayloadHash,
            Reason, ChangedFromPrev, ComputeMs, CreatedBy, CONVERT(varchar(33), CreatedAt, 126) + 'Z' AS CreatedAt
       FROM dbo.${SNAPSHOT_TABLE} WHERE OrderYear = @y AND MajorWeek = @m ORDER BY VersionNo DESC`,
    { n: { type: sql.Int, value: limit }, y: { type: sql.NVarChar, value: String(orderYear) }, m: { type: sql.NVarChar, value: pad2(major) } },
  );
  return (r.recordset || []).map((row) => {
    const s = parseSnapshotRow(row, { withPayload: false });
    delete s.fingerprint;
    return s;
  });
}

function prevWeekOf(orderYear, major) {
  const m = Number(major);
  return m <= 1 ? { year: String(Number(orderYear) - 1), major: '52' } : { year: String(orderYear), major: pad2(m - 1) };
}

/** 저장 대상 payload — 정적 import 값(manualInputManifest)은 빼고 응답 시 다시 붙인다. */
export function payloadForStorage(payload = {}) {
  const { manualInputManifest, snapshot, ...rest } = payload || {};
  return rest;
}

export function payloadHashOf(payload) {
  return stableHash(payloadForStorage(payload));
}

export async function insertSnapshot({ orderYear, major, fingerprint, payload, prevPayloadHash, reason, computeMs, actor, previous }) {
  const stored = payloadForStorage(payload);
  const json = JSON.stringify(stored);
  const hash = stableHash(stored);
  const params = {
    y: { type: sql.NVarChar, value: String(orderYear) },
    m: { type: sql.NVarChar, value: pad2(major) },
    cv: { type: sql.NVarChar, value: String(profitReportCalcVersion()).slice(0, 60) },
    fh: { type: sql.NVarChar, value: fingerprint.hash },
    fj: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(fingerprint.components) },
    pj: { type: sql.NVarChar(sql.MAX), value: json },
    ph: { type: sql.NVarChar, value: hash },
    pph: { type: sql.NVarChar, value: prevPayloadHash || null },
    rs: { type: sql.NVarChar, value: String(reason || 'AUTO').slice(0, 20) },
    ch: { type: sql.Bit, value: previous ? (previous.payloadHash !== hash ? 1 : 0) : 1 },
    ms: { type: sql.Int, value: Math.round(Number(computeMs) || 0) },
    by: { type: sql.NVarChar, value: String(actor || 'system').slice(0, 100) },
  };
  // VersionNo 는 (연도,차수)별 MAX+1. 동시 INSERT 로 UNIQUE 충돌이 나면 한 번 재시도한다.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const r = await query(
        `INSERT INTO dbo.${SNAPSHOT_TABLE}
           (OrderYear, MajorWeek, VersionNo, CalcVersion, FingerprintHash, FingerprintJson, PayloadJson, PayloadHash, PrevPayloadHash, Reason, ChangedFromPrev, ComputeMs, CreatedBy)
         OUTPUT INSERTED.SnapKey, INSERTED.VersionNo, CONVERT(varchar(33), INSERTED.CreatedAt, 126) + 'Z' AS CreatedAt
         SELECT @y, @m, ISNULL(MAX(VersionNo), 0) + 1, @cv, @fh, @fj, @pj, @ph, @pph, @rs, @ch, @ms, @by
           FROM dbo.${SNAPSHOT_TABLE} WITH (UPDLOCK, HOLDLOCK) WHERE OrderYear = @y AND MajorWeek = @m`,
        params,
      );
      const row = r.recordset?.[0] || {};
      return {
        snapKey: row.SnapKey, versionNo: row.VersionNo, createdAt: row.CreatedAt, payloadHash: hash,
        fingerprintHash: fingerprint.hash, fingerprint: fingerprint.components, prevPayloadHash: prevPayloadHash || null,
        reason, changedFromPrev: Boolean(params.ch.value), computeMs: params.ms.value, calcVersion: params.cv.value,
        orderYear: String(orderYear), major: pad2(major),
      };
    } catch (e) {
      if (attempt === 0 && /UNIQUE|duplicate/i.test(e.message || '')) continue;
      throw e;
    }
  }
  return null;
}

/**
 * 순수 함수 — 저장본이 지금도 유효한지 판정.
 *  fresh      : 지문 동일 + 전차수 저장본 결과 동일
 *  stale      : 원천/계산식 변경 또는 전차수 재계산으로 결과가 달라짐 → changes[] 에 이유
 */
export function evaluateSnapshot(stored, current, prevLatest) {
  if (!stored) return { state: 'missing', changes: [] };
  const changes = stored.fingerprintHash === current.hash ? [] : describeFingerprintChanges(stored.fingerprint, current.components);
  if (stored.fingerprintHash !== current.hash && !changes.length) {
    changes.push({ key: 'FP', table: 'FP', label: '입력 지문', scope: '', text: '입력 지문 형식 변경' });
  }
  if (prevLatest && stored.prevPayloadHash && prevLatest.payloadHash !== stored.prevPayloadHash) {
    changes.push({
      key: `PREV:${prevLatest.orderYear}:${prevLatest.major}`, table: 'PREV', label: '전차수 재계산 결과 변경',
      scope: `${prevLatest.orderYear} ${Number(prevLatest.major)}차`,
      text: `전차수(${Number(prevLatest.major)}차) 재계산 결과가 바뀜 — 기초재고 E(=전차수 F) 영향`,
    });
  }
  return { state: changes.length ? 'stale' : 'fresh', changes };
}

// ── 계산·서빙 ──────────────────────────────────────────────────────────
const _inflight = new Map(); // "Y:M" → Promise

/**
 * 재계산 후 새 버전 저장(POST/스크립트 전용 — GET 은 절대 호출하지 않는다: CLAUDE.md 규칙 1).
 * computeFn(major, orderYear) 는 원래 보고서 계산(loadReportData). 같은 차수 동시 요청은 하나로 합친다(single-flight).
 */
export function recomputeAndStore(orderYear, major, computeFn, { reason = 'REFRESH', actor = 'system' } = {}) {
  const key = `${orderYear}:${pad2(major)}`;
  if (_inflight.has(key)) return _inflight.get(key);
  const p = (async () => {
    const pw = prevWeekOf(orderYear, major);
    const [fingerprint, previous, prevLatest] = await Promise.all([
      computeWeekFingerprint(orderYear, major),
      latestSnapshot(orderYear, major, { withPayload: false }),
      latestSnapshot(pw.year, pw.major, { withPayload: false }),
    ]);
    const t0 = Date.now();
    const payload = await computeFn(pad2(major), String(orderYear));
    const computeMs = Date.now() - t0;
    if (!(await snapshotSchemaReady())) return { payload, saved: null, computeMs, fingerprint, previous };
    const saved = await insertSnapshot({
      orderYear, major, fingerprint, payload, prevPayloadHash: prevLatest?.payloadHash || null, reason, computeMs, actor, previous,
    });
    return { payload, saved, computeMs, fingerprint, previous };
  })().finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

export function snapshotMeta(saved, { state, changes = [], servedFrom, needsRefresh = false, previous = null } = {}) {
  return {
    state, // fresh | stale | missing | computed | disabled
    servedFrom, // snapshot | live
    needsRefresh, // 화면이 곧바로 POST snapshotRefresh 를 호출해 새 버전을 저장해야 함
    snapKey: saved?.snapKey ?? null,
    versionNo: saved?.versionNo ?? null,
    savedAt: saved?.createdAt ?? null,
    reason: saved?.reason ?? null,
    changedFromPrev: saved?.changedFromPrev ?? null,
    previousVersionNo: previous?.versionNo ?? null,
    computeMs: saved?.computeMs ?? null,
    calcVersion: saved?.calcVersion ?? null,
    changes: changes.slice(0, 40),
    changeCount: changes.length,
  };
}

/**
 * GET 조회 진입점(읽기 전용 — INSERT 없음).
 *  - 저장본 fresh  → 저장본 즉시 반환
 *  - 저장본 stale  → 저장본 즉시 반환 + changes(무엇이 바뀌었는지) + needsRefresh
 *                    (preferLive=true 면 저장 없이 라이브 계산값 반환 — 엑셀 다운로드용)
 *  - 저장본 없음   → 라이브 계산 반환 + needsRefresh(화면이 POST 로 저장)
 */
export async function readProfitReportWithSnapshot(major, orderYear, computeFn, { preferLive = false } = {}) {
  if (!(await snapshotSchemaReady().catch(() => false))) {
    const payload = await computeFn(pad2(major), String(orderYear));
    return { ...payload, snapshot: snapshotMeta(null, { state: 'disabled', servedFrom: 'live' }) };
  }
  const pw = prevWeekOf(orderYear, major);
  const [stored, current, prevLatest] = await Promise.all([
    latestSnapshot(orderYear, major),
    computeWeekFingerprint(orderYear, major),
    latestSnapshot(pw.year, pw.major, { withPayload: false }),
  ]);
  const verdict = evaluateSnapshot(stored, current, prevLatest);
  if (verdict.state === 'fresh' && stored.payload) {
    return { ...stored.payload, snapshot: snapshotMeta(stored, { state: 'fresh', servedFrom: 'snapshot' }) };
  }
  if (verdict.state === 'stale' && stored?.payload && !preferLive) {
    return {
      ...stored.payload,
      snapshot: snapshotMeta(stored, { state: 'stale', changes: verdict.changes, servedFrom: 'snapshot', needsRefresh: true }),
    };
  }
  const payload = await computeFn(pad2(major), String(orderYear));
  return {
    ...payload,
    snapshot: snapshotMeta(stored, { state: stored ? 'stale' : 'missing', changes: verdict.changes, servedFrom: 'live', needsRefresh: true }),
  };
}

/** 월별/차수범위 보기용 — 저장본이 있으면(신선도 무관) 저장본, 없으면 라이브. 지문 계산 없이 한 번에 읽는다. */
export async function readStoredOrLive(orderYear, majors, computeFn) {
  const stored = await latestSnapshots(orderYear, majors).catch(() => new Map());
  const out = new Map();
  for (const m of majors) {
    const s = stored.get(pad2(m));
    out.set(pad2(m), s?.payload
      ? { ...s.payload, snapshot: snapshotMeta(s, { state: 'stored', servedFrom: 'snapshot' }) }
      : null);
  }
  return out;
}

/** POST [최신화] — 동기 재계산 + 새 버전 저장. */
export async function refreshProfitReportSnapshot(major, orderYear, computeFn, { actor = 'user', reason = 'REFRESH' } = {}) {
  const { payload, saved, previous } = await recomputeAndStore(orderYear, major, computeFn, { reason, actor });
  return { ...payload, snapshot: snapshotMeta(saved, { state: 'computed', servedFrom: 'live', previous }) };
}

/** 과거 차수 일괄 워밍업 — 순차 실행(차수 사이 pauseMs 휴식), 지문이 같으면 건너뜀. 1차부터 올라가 연쇄(E=F(n-1))가 맞게 쌓인다. */
export async function warmupProfitReportSnapshots(orderYear, majors, computeFn, { pauseMs = 1500, log = () => {}, actor = 'warmup' } = {}) {
  const results = [];
  for (const m of majors) {
    const t0 = Date.now();
    try {
      const pw = prevWeekOf(orderYear, m);
      const [stored, current, prevLatest] = await Promise.all([
        latestSnapshot(orderYear, m, { withPayload: false }),
        computeWeekFingerprint(orderYear, m),
        latestSnapshot(pw.year, pw.major, { withPayload: false }),
      ]);
      const verdict = evaluateSnapshot(stored, current, prevLatest);
      if (verdict.state === 'fresh') { results.push({ major: pad2(m), action: 'skip', ms: Date.now() - t0 }); log(results.at(-1)); continue; }
      const { saved, computeMs } = await recomputeAndStore(orderYear, m, computeFn, { reason: stored ? 'WARMUP' : 'FIRST', actor });
      results.push({ major: pad2(m), action: 'saved', versionNo: saved?.versionNo, changed: saved?.changedFromPrev, computeMs, why: verdict.changes.slice(0, 3).map((c) => c.text) });
    } catch (e) {
      results.push({ major: pad2(m), action: 'error', error: e.message });
    }
    log(results.at(-1));
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return results;
}
