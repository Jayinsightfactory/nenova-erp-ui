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
import { getActiveConfirm } from './profitReportConfirm.js';
import store from './customsSettlementStore.cjs';

const _inFlightAutoRefresh = new Map();

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
  for (const sc of scopes) {
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
  }
  return sources;
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
    const actorTag = `auto-refresh:${String(trigger || 'auto')}:${String(actor || 'system')}`.slice(0, 100);
    const result = await saveCache({
      orderYear: scope.orderYear,
      major: scope.major,
      actor: actorTag,
      reason: 'REFRESH',
    });
    if (result?.action === 'saved') {
      try { await clearDutyCache(); } catch { /* ignore cache clear error */ }
      return {
        action: 'saved',
        refreshed: true,
        reason: null,
        orderYear: scope.orderYear,
        major: scope.major,
        payload: result.payload || null,
        snapshot: result.snapshot || null,
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
    results.push(await safeAutoRefreshUnconfirmedProfitSnapshot({
      ...options,
      orderYear: sc.orderYear,
      major: sc.major,
    }));
  }
  return results;
}
