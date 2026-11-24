// lib/profitReportAutoRefresh.js — 미확정 주차별 매출이익 스냅샷 자동 새로고침 (Push + Stale-on-Read).
//
// 원칙:
//  1. 확정 차수(WebProfitReportConfirm IsActive=1)는 어떤 경우에도 재계산·덮어쓰기·무효화 금지.
//  2. 모든 원천 시각 비교는 정확한 OrderYear + MajorWeek 스코프로 격리(타 연도 혼입 금지).
//  3. MSSQL Web* 테이블 UpdatedAt(GETDATE(), 서버 로컬 KST)은 SQL TZOFFSET으로 UTC 변환해
//     WebProfitReportSnapshot.CreatedAt(SYSUTCDATETIME(), UTC) 및 선율 정산서 파일 원장(ISO UTC)과
//     동일 기준(UTC epoch ms)으로 비교한다.
//  4. ERP 공유 원장 테이블(Order*/Shipment*/Warehouse*/Estimate/ProductStock/StockHistory) 쓰기 0건.
//     저장은 반드시 기존 정식 경로(saveProfitReportCache -> saveProfitCache -> WebProfitReportSnapshot)만 재사용한다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { query, sql } from './db.js';
import { currentErpReadContext, erpContextCache } from './erpReadContext.js';
import { getActiveConfirm } from './profitReportConfirm.js';
import store from './customsSettlementStore.cjs';

const _inFlightAutoRefresh = new Map();
const RESTORABLE_KCS_SOURCES = new Set(['kcs_api', 'approved_customs_timing_estimate']);
export const KCS_OUTAGE_REASONS = new Set([
  'http_error',
  'parse_error',
  'timeout',
  'network_error',
  'auth_failed',
  'read_error',
  'fetch_failed',
  'date_weight_load_failed',
]);

export function normalizeAutoRefreshScope(orderYear, major) {
  const y = String(orderYear ?? '').trim();
  const rawMajor = String(major ?? '').trim();
  const match = rawMajor.match(/^(\d{1,2})(?:-\d{2})?$/);
  const num = match ? Number(match[1]) : NaN;
  if (!/^\d{4}$/.test(y) || !Number.isInteger(num) || num < 1 || num > 53) {
    throw Object.assign(new Error('자동 새로고침 대상 연도·차수가 올바르지 않습니다.'), {
      code: 'INVALID_REPORT_PERIOD',
      statusCode: 400,
    });
  }
  return { orderYear: y, major: String(num).padStart(2, '0') };
}

export function parseTimestampMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 순수 함수 — 저장된 스냅샷 시각(UTC)보다 최신 원천 수정 시각(UTC)이 더 뒤인지 판정한다.
 * snapshotSavedAt 이 없으면(구형 fixture/미저장) 오탐 방지를 위해 isStale=false 반환.
 */
export function isSnapshotStaleComparedToSources({ snapshotSavedAt, sources = [], toleranceMs = 0 } = {}) {
  const snapshotMs = parseTimestampMs(snapshotSavedAt);
  if (snapshotMs == null) {
    return { isStale: false, snapshotMs: null, latestSourceMs: null, latestSource: null, staleSources: [] };
  }
  let latestSourceMs = null;
  let latestSource = null;
  const staleSources = [];
  for (const item of sources || []) {
    if (!item) continue;
    const ms = parseTimestampMs(item.updatedAt);
    if (ms == null) continue;
    if (latestSourceMs == null || ms > latestSourceMs) {
      latestSourceMs = ms;
      latestSource = item;
    }
    if (ms > snapshotMs + toleranceMs) {
      staleSources.push({
        source: item.source,
        scope: item.scope || null,
        updatedAt: new Date(ms).toISOString(),
        deltaMs: ms - snapshotMs,
      });
    }
  }
  return {
    isStale: staleSources.length > 0,
    snapshotMs,
    latestSourceMs,
    latestSource: latestSource ? {
      source: latestSource.source,
      scope: latestSource.scope || null,
      updatedAt: new Date(latestSourceMs).toISOString(),
    } : null,
    staleSources,
  };
}

async function readSettlementUpdatedAtUtc(orderYear, major, { readLedger = store.readLedger, root = store.ROOT, statFn = fs.stat } = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  const ledger = await readLedger(root, scope.orderYear, scope.major);
  const hasEvidence = Boolean(
    (ledger?.revision || 0) > 0
    || (Array.isArray(ledger?.documents) && ledger.documents.length > 0)
    || (Array.isArray(ledger?.manualPhase03) && ledger.manualPhase03.length > 0)
  );
  if (!hasEvidence) return null;

  let maxMs = null;
  for (const entry of ledger.history || []) {
    const ms = parseTimestampMs(entry?.at);
    if (ms != null && (maxMs == null || ms > maxMs)) maxMs = ms;
  }
  for (const row of ledger.manualPhase03 || []) {
    const ms = parseTimestampMs(row?.updatedAt);
    if (ms != null && (maxMs == null || ms > maxMs)) maxMs = ms;
  }
  if (maxMs == null && typeof statFn === 'function') {
    try {
      const filePath = path.join(root, `${scope.orderYear}-${scope.major}.json`);
      const st = await statFn(filePath);
      const ms = parseTimestampMs(st?.mtime);
      if (ms != null) maxMs = ms;
    } catch {
      // 파일이 없거나 커스텀 readLedger 모킹이면 무시
    }
  }
  return maxMs != null ? new Date(maxMs).toISOString() : null;
}

async function queryDbSourceUpdatedAtUtc(orderYear, major, { queryFn = query, sqlTypes = sql } = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  // WebCustomsWeekly / WebColombiaWeekly / WebForwardingWeekly / WebProfitReport.UpdatedAt 은 GETDATE()(KST)로 저장된다.
  // SQL Server TZOFFSET(예: KST +540분)을 빼서 UTC ISO(Z)로 통일한다.
  const statement = `
    DECLARE @tzOffsetMin int = DATEPART(TZOFFSET, SYSDATETIMEOFFSET());
    IF OBJECT_ID(N'dbo.WebCustomsWeekly', N'U') IS NOT NULL
      SELECT N'WebCustomsWeekly' AS SourceName,
             CASE WHEN MAX(UpdatedAt) IS NULL THEN NULL
                  ELSE CONVERT(varchar(33), DATEADD(MINUTE, -@tzOffsetMin, MAX(UpdatedAt)), 126) + 'Z' END AS UpdatedAtUtc
        FROM dbo.WebCustomsWeekly
       WHERE OrderYear = @y AND MajorWeek = @m;
    IF OBJECT_ID(N'dbo.WebColombiaWeekly', N'U') IS NOT NULL
      SELECT N'WebColombiaWeekly' AS SourceName,
             CASE WHEN MAX(UpdatedAt) IS NULL THEN NULL
                  ELSE CONVERT(varchar(33), DATEADD(MINUTE, -@tzOffsetMin, MAX(UpdatedAt)), 126) + 'Z' END AS UpdatedAtUtc
        FROM dbo.WebColombiaWeekly
       WHERE OrderYear = @y AND (OrderWeek = @m OR OrderWeek LIKE @mPrefix);
    IF OBJECT_ID(N'dbo.WebForwardingWeekly', N'U') IS NOT NULL
      SELECT N'WebForwardingWeekly' AS SourceName,
             CASE WHEN MAX(UpdatedAt) IS NULL THEN NULL
                  ELSE CONVERT(varchar(33), DATEADD(MINUTE, -@tzOffsetMin, MAX(UpdatedAt)), 126) + 'Z' END AS UpdatedAtUtc
        FROM dbo.WebForwardingWeekly
       WHERE OrderYear = @y AND MajorWeek = @m;
    IF OBJECT_ID(N'dbo.WebProfitReport', N'U') IS NOT NULL
      SELECT N'WebProfitReport' AS SourceName,
             CASE WHEN MAX(UpdatedAt) IS NULL THEN NULL
                  ELSE CONVERT(varchar(33), DATEADD(MINUTE, -@tzOffsetMin, MAX(UpdatedAt)), 126) + 'Z' END AS UpdatedAtUtc
        FROM dbo.WebProfitReport
       WHERE OrderYear = @y AND MajorWeek = @m;
    IF OBJECT_ID(N'dbo.WebTaxableExchangeRate', N'U') IS NOT NULL
      SELECT N'WebTaxableExchangeRate' AS SourceName,
             CASE WHEN MAX(UpdatedAt) IS NULL THEN NULL
                  ELSE CONVERT(varchar(33), DATEADD(MINUTE, -@tzOffsetMin, MAX(UpdatedAt)), 126) + 'Z' END AS UpdatedAtUtc
        FROM dbo.WebTaxableExchangeRate
       WHERE CAST(OrderYear AS NVARCHAR(4)) = @y
         AND RIGHT('0' + CAST(MajorWeek AS NVARCHAR(10)), 2) = @m;
  `;
  const params = {
    y: { type: sqlTypes.NVarChar, value: scope.orderYear },
    m: { type: sqlTypes.NVarChar, value: scope.major },
    mPrefix: { type: sqlTypes.NVarChar, value: `${scope.major}-%` },
  };
  const result = await queryFn(statement, params);
  const recordsets = Array.isArray(result?.recordsets) && result.recordsets.length
    ? result.recordsets
    : (result?.recordset ? [result.recordset] : []);
  const out = [];
  for (const rs of recordsets) {
    for (const row of rs || []) {
      if (row?.SourceName && row?.UpdatedAtUtc) {
        out.push({
          source: row.SourceName,
          scope: `${scope.orderYear}:${scope.major}`,
          updatedAt: row.UpdatedAtUtc,
        });
      }
    }
  }
  return out;
}

/**
 * 읽기 전용: 정확한 (orderYear, major) (및 선택적 직전 차수 prevPeriod)의 통관비·수기·선율 정산서 최신 수정 시각(UTC) 수집.
 * SELECT + 파일 읽기만 수행하며 DB 쓰기·DDL을 절대 실행하지 않는다.
 */
export async function loadLatestProfitSourceTimestamps(orderYear, major, {
  prevPeriod = null,
  queryFn = query,
  sqlTypes = sql,
  readLedger = store.readLedger,
  root = store.ROOT,
  statFn = fs.stat,
} = {}) {
  const scopes = [normalizeAutoRefreshScope(orderYear, major)];
  if (prevPeriod?.orderYear && prevPeriod?.major) {
    const prev = normalizeAutoRefreshScope(prevPeriod.orderYear, prevPeriod.major);
    if (prev.orderYear !== scopes[0].orderYear || prev.major !== scopes[0].major) {
      scopes.push(prev);
    }
  }
  const sources = [];
  for (let i = 0; i < scopes.length; i += 1) {
    const sc = scopes[i];
    const [dbItems, settlementAt] = await Promise.all([
      queryDbSourceUpdatedAtUtc(sc.orderYear, sc.major, { queryFn, sqlTypes }),
      readSettlementUpdatedAtUtc(sc.orderYear, sc.major, { readLedger, root, statFn }),
    ]);
    sources.push(...dbItems);
    if (settlementAt) {
      sources.push({
        source: 'customsSettlementStore',
        scope: `${sc.orderYear}:${sc.major}`,
        updatedAt: settlementAt,
      });
    }
    // 직전 차수(prevPeriod)의 스냅샷 자체가 현재 차수 스냅샷보다 최근에 갱신됐다면
    // 기말재고 F -> 다음 차수 기초재고 E 연쇄 반영을 위해 stale로 감지한다.
    if (i > 0) {
      const prevSnapAt = await queryLatestSnapshotCreatedAtUtc(sc.orderYear, sc.major, { queryFn, sqlTypes });
      if (prevSnapAt) {
        sources.push({
          source: 'WebProfitReportSnapshot:prev',
          scope: `${sc.orderYear}:${sc.major}`,
          updatedAt: prevSnapAt,
        });
      }
    }
  }
  return sources;
}

export async function queryLatestSnapshotCreatedAtUtc(orderYear, major, { queryFn = query, sqlTypes = sql } = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  try {
    const exists = await queryFn(`SELECT OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') AS id`, {});
    if (!exists?.recordset?.[0]?.id) return null;
    const r = await queryFn(
      `SELECT CASE WHEN MAX(CreatedAt) IS NULL THEN NULL
                   ELSE CONVERT(varchar(33), MAX(CreatedAt), 126) + 'Z' END AS CreatedAtUtc
         FROM dbo.WebProfitReportSnapshot
        WHERE OrderYear = @y AND MajorWeek = @m`,
      {
        y: { type: sqlTypes.NVarChar, value: scope.orderYear },
        m: { type: sqlTypes.NVarChar, value: scope.major },
      },
    );
    return r?.recordset?.[0]?.CreatedAtUtc || null;
  } catch {
    return null;
  }
}

export function nextAutoRefreshScope(orderYear, major) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  const num = Number(scope.major);
  if (num >= 53) return null;
  return { orderYear: scope.orderYear, major: String(num + 1).padStart(2, '0') };
}

export async function hasStoredProfitSnapshot(orderYear, major, { queryFn = query, sqlTypes = sql } = {}) {
  const createdAt = await queryLatestSnapshotCreatedAtUtc(orderYear, major, { queryFn, sqlTypes });
  return Boolean(createdAt);
}

export async function detectStaleProfitSnapshot({
  orderYear,
  major,
  snapshotSavedAt,
  prevPeriod = null,
  toleranceMs = 0,
  ...deps
} = {}) {
  const snapshotMs = parseTimestampMs(snapshotSavedAt);
  if (snapshotMs == null) {
    return { isStale: false, snapshotMs: null, latestSourceMs: null, latestSource: null, staleSources: [] };
  }
  const sources = await loadLatestProfitSourceTimestamps(orderYear, major, { prevPeriod, ...deps });
  return isSnapshotStaleComparedToSources({ snapshotSavedAt: snapshotMs, sources, toleranceMs });
}

async function defaultSaveProfitReportCache(options) {
  const mod = await import('../pages/api/sales/profit-report.js');
  return mod.saveProfitReportCache(options);
}

async function defaultClearTemplateDutyCache() {
  const mod = await import('./profitTemplateDutyData.js');
  if (typeof mod.clearTemplateDutyCache === 'function') mod.clearTemplateDutyCache();
}

/**
 * 미확정 차수 스냅샷 자동 새로고침 (확정 차수 WebProfitReportConfirm 불변 하드 가드 내장).
 *  - 동일 (orderYear, major) 동시 호출은 single-flight로 합쳐 락 경합 최소화.
 *  - 저장은 기존 정식 saveProfitReportCache(WebProfitReportSnapshot 전용)만 호출하며 ERP 공유 테이블 쓰기 0건.
 */
export async function autoRefreshUnconfirmedProfitSnapshot({
  orderYear,
  major,
  actor = 'system',
  trigger = 'auto',
  saveCache = defaultSaveProfitReportCache,
  checkConfirm = getActiveConfirm,
  clearDutyCache = defaultClearTemplateDutyCache,
  cascadeNext = false,
  hasSnapshot = hasStoredProfitSnapshot,
  scheduleCascade = (fn) => {
    const t = setImmediate(fn);
    t?.unref?.();
  },
} = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  const key = `${scope.orderYear}:${scope.major}`;
  if (_inFlightAutoRefresh.has(key)) return _inFlightAutoRefresh.get(key);

  const run = (async () => {
    const activeConfirm = await checkConfirm(scope.orderYear, scope.major);
    if (activeConfirm?.initialized && activeConfirm.confirm) {
      return {
        action: 'skipped',
        refreshed: false,
        reason: 'confirmed',
        orderYear: scope.orderYear,
        major: scope.major,
      };
    }
    const trig = String(trigger || 'auto').trim() || 'auto';
    const act = String(actor || '').trim();
    const actorTag = (act && act !== trig ? `auto-refresh:${trig}:${act}` : `auto-refresh:${trig}`).slice(0, 100);
    const result = await saveCache({
      orderYear: scope.orderYear,
      major: scope.major,
      actor: actorTag,
      reason: 'REFRESH',
    });
    if (result?.action === 'saved') {
      try { await clearDutyCache(); } catch { /* ignore cache clear error */ }
      let cascadedTo = null;
      if (cascadeNext === true) {
        const next = nextAutoRefreshScope(scope.orderYear, scope.major);
        if (next) {
          cascadedTo = `${next.orderYear}:${next.major}`;
          scheduleCascade(async () => {
            try {
              const exists = await hasSnapshot(next.orderYear, next.major);
              if (!exists) return;
              await safeAutoRefreshUnconfirmedProfitSnapshot({
                orderYear: next.orderYear,
                major: next.major,
                actor: act || trig,
                trigger: `cascade-from-${scope.major}`,
                saveCache,
                checkConfirm,
                clearDutyCache,
                cascadeNext: false,
              });
            } catch {
              // 비동기 연쇄 실패는 본 차수 응답에 영향을 주지 않는다(Stale-on-Read가 재감지).
            }
          });
        }
      }
      return {
        action: 'saved',
        refreshed: true,
        reason: null,
        orderYear: scope.orderYear,
        major: scope.major,
        payload: result.payload || null,
        snapshot: result.snapshot || null,
        ...(cascadedTo ? { cascadedTo } : {}),
      };
    }
    return {
      action: result?.action || 'skipped',
      refreshed: false,
      reason: result?.reason || 'not_saved',
      orderYear: scope.orderYear,
      major: scope.major,
      payload: result?.payload || null,
      snapshot: result?.snapshot || null,
    };
  })().finally(() => {
    _inFlightAutoRefresh.delete(key);
  });

  _inFlightAutoRefresh.set(key, run);
  return run;
}

/**
 * Push 훅용 안전 래퍼: 원천 저장(정산서 등록/통관비 저장 등) 성공 후 호출하며,
 * 락 경합(PROFIT_CACHE_BUSY)이나 일시 오류로 스냅샷 갱신이 실패해도 원천 저장 자체는 실패시키지 않는다.
 */
export async function safeAutoRefreshUnconfirmedProfitSnapshot(options = {}) {
  try {
    return await autoRefreshUnconfirmedProfitSnapshot(options);
  } catch (error) {
    const code = String(error?.code || 'AUTO_REFRESH_FAILED');
    return {
      action: 'error',
      refreshed: false,
      reason: code,
      errorCode: code,
      orderYear: options?.orderYear ? String(options.orderYear) : null,
      major: options?.major ? String(options.major).padStart(2, '0') : null,
    };
  }
}

export async function triggerProfitSnapshotAutoRefreshForScopes(scopes = [], options = {}) {
  const unique = [];
  const seen = new Set();
  for (const item of scopes || []) {
    if (!item?.orderYear && !item?.year) continue;
    const sc = normalizeAutoRefreshScope(item.orderYear ?? item.year, item.major);
    const key = `${sc.orderYear}:${sc.major}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(sc);
  }
  unique.sort((a, b) => a.orderYear.localeCompare(b.orderYear) || a.major.localeCompare(b.major));
  const results = [];
  for (const sc of unique) {
    const next = nextAutoRefreshScope(sc.orderYear, sc.major);
    const shouldCascade = options.cascadeNext !== false && Boolean(next && !seen.has(`${next.orderYear}:${next.major}`));
    results.push(await safeAutoRefreshUnconfirmedProfitSnapshot({
      ...options,
      orderYear: sc.orderYear,
      major: sc.major,
      cascadeNext: shouldCascade,
    }));
  }
  return results;
}

/**
 * 순수 함수 — 동일 (OrderYear, MajorWeek) 스냅샷 payload에서 공식 KCS 환율(kcs_api / approved_customs_timing_estimate)만 추출한다.
 * 타 연도·타 차수 payload나 비-KCS 원천(carried/manual/missing/sunyul)은 절대 복원하지 않는다.
 */
export function extractKcsRatesFromSnapshotPayload(payload, { orderYear, major, versionNo = null } = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  if (!payload || typeof payload !== 'object') return {};
  if (String(payload.orderYear ?? '') !== scope.orderYear) return {};
  const payloadMajorMatch = String(payload.major ?? '').trim().match(/^(\d{1,2})$/);
  if (!payloadMajorMatch || payloadMajorMatch[1].padStart(2, '0') !== scope.major) return {};

  const out = {};
  for (const row of Array.isArray(payload.rows) ? payload.rows : []) {
    const category = row?.category;
    const src = row?.source?.R;
    if (!category || !RESTORABLE_KCS_SOURCES.has(src)) continue;
    const rate = Number(row?.auto?.R ?? row?.calc?.R);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const baseDetail = row?.rateDetail && typeof row.rateDetail === 'object' ? row.rateDetail : {};
    out[category] = {
      rate,
      detail: {
        ...baseDetail,
        source: src,
        estimated: src === 'approved_customs_timing_estimate' || baseDetail.estimated === true,
        orderYear: scope.orderYear,
        major: scope.major,
        currency: row?.currency || baseDetail.currency || null,
        restoredFromSnapshotVersion: versionNo,
        kcsFallbackReason: 'kcs_api_unavailable',
      },
    };
  }
  return out;
}

/**
 * 읽기 전용 SELECT — 동일 (OrderYear, MajorWeek)의 기존 WebProfitReportSnapshot 이력(최신순 최대 10개)에서
 * 카테고리별 최신 유효 공식 KCS 환율을 복원한다. 타 연도·타 차수 조회 및 DB 쓰기 0건.
 */
export async function loadPriorSnapshotKcsRates(orderYear, major, { queryFn = query, sqlTypes = sql } = {}) {
  const scope = normalizeAutoRefreshScope(orderYear, major);
  const cacheKey = `${scope.orderYear}:${scope.major}`;
  const ctx = currentErpReadContext();
  if (ctx && !ctx.allowExternalEvidenceReads) return { byCategory: {}, versionsByCategory: {} };
  const memo = ctx ? erpContextCache('profit:prior-snapshot-kcs', new Map()) : null;
  if (memo?.has(cacheKey)) return memo.get(cacheKey);

  const loadPromise = (async () => {
    // erpReadContext.js는 SELECT/WITH로 시작하는 순수 읽기 SQL만 허용한다(IF OBJECT_ID 금지).
    const exists = await queryFn(
      `SELECT OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') AS id`,
      {},
    );
    if (!exists?.recordset?.[0]?.id) return { byCategory: {}, versionsByCategory: {} };
    const r = await queryFn(
      `SELECT TOP 10 VersionNo, PayloadJson
         FROM dbo.WebProfitReportSnapshot
        WHERE OrderYear = @y AND MajorWeek = @m
        ORDER BY VersionNo DESC`,
      {
        y: { type: sqlTypes.NVarChar, value: scope.orderYear },
        m: { type: sqlTypes.NVarChar, value: scope.major },
      },
    );
    const byCategory = {};
    const versionsByCategory = {};
    for (const row of r?.recordset || []) {
      if (!row?.PayloadJson) continue;
      let payload;
      try { payload = JSON.parse(row.PayloadJson); } catch { continue; }
      const extracted = extractKcsRatesFromSnapshotPayload(payload, {
        orderYear: scope.orderYear,
        major: scope.major,
        versionNo: row.VersionNo ?? null,
      });
      for (const [category, entry] of Object.entries(extracted)) {
        if (!byCategory[category]) {
          byCategory[category] = entry;
          versionsByCategory[category] = row.VersionNo ?? null;
        }
      }
    }
    return { byCategory, versionsByCategory };
  })();

  if (memo) memo.set(cacheKey, loadPromise);
  return loadPromise;
}

function hasKcsOutageFailure(failures) {
  return Array.isArray(failures) && failures.some((item) => KCS_OUTAGE_REASONS.has(item?.reason));
}

/**
 * 외부 관세청 KCS API 장애(HTTP 500/HTML 시스템 에러/타임아웃 등)로 누락된 카테고리에 한해
 * 동일 (OrderYear, MajorWeek) 직전 스냅샷의 공식 KCS 환율을 무손실 폴백 병합한다.
 * - 실시간 KCS 성공값과 상위 우선순위(수기·입고·저장·선율 정산서)는 절대 덮어쓰지 않는다.
 * - missing_declaration_date / disabled / approval_evidence_required 는 장애가 아니므로 복원하지 않는다.
 */
export async function mergeKcsRatesWithSnapshotFallback(orderYear, major, liveKcs, {
  loadPrior = loadPriorSnapshotKcsRates,
  queryFn = query,
  sqlTypes = sql,
} = {}) {
  const base = liveKcs && typeof liveKcs === 'object' ? liveKcs : { byCategory: {}, failuresByCategory: {} };
  const failuresByCategory = base.failuresByCategory || {};
  const allOutage = hasKcsOutageFailure(failuresByCategory._all);
  const outageCategories = Object.entries(failuresByCategory)
    .filter(([cat, fails]) => cat !== '_all' && !base.byCategory?.[cat] && hasKcsOutageFailure(fails))
    .map(([cat]) => cat);
  if (!allOutage && !outageCategories.length) return base;

  const ctx = currentErpReadContext();
  if (ctx && !ctx.allowExternalEvidenceReads) return base;

  let prior;
  try {
    prior = await loadPrior(orderYear, major, { queryFn, sqlTypes });
  } catch {
    return base;
  }
  const priorByCategory = prior?.byCategory || {};
  const mergedByCategory = { ...(base.byCategory || {}) };
  const mergedFailures = { ...failuresByCategory };
  const targetCategories = allOutage
    ? Object.keys(priorByCategory).filter((cat) => !mergedByCategory[cat])
    : outageCategories;

  let restoredCount = 0;
  for (const cat of targetCategories) {
    if (mergedByCategory[cat] || !priorByCategory[cat]) continue;
    mergedByCategory[cat] = priorByCategory[cat];
    delete mergedFailures[cat];
    restoredCount += 1;
  }
  if (allOutage && restoredCount > 0) delete mergedFailures._all;

  return {
    ...base,
    byCategory: mergedByCategory,
    failuresByCategory: mergedFailures,
    snapshotFallbackRestoredCount: restoredCount,
  };
}

