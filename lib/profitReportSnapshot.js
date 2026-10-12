import fs from 'fs';
import path from 'path';
import { query, sql, withTransaction } from './db.js';
import { computeProfitRow, computeProfitTotals } from './profitReportCalc.js';

export const PROFIT_REPORT_SNAPSHOT_STATE = Object.freeze({
  LIVE: 'LIVE_UNCONFIRMED',
  CONFIRMED: 'CONFIRMED',
});

export const PROFIT_REPORT_SNAPSHOT_SOURCE = Object.freeze({
  EXCEL: 'EXCEL_BASELINE',
  WEB: 'WEB_CALCULATION',
});

const REGISTRY_PATH = path.join(process.cwd(), 'data', 'profit-report-confirmed-snapshots.json');
let registryCache = null;

export function normalizeSnapshotKey(orderYear, majorWeek) {
  const year = String(orderYear || '').trim();
  const match = String(majorWeek || '').trim().match(/^(\d{1,2})(?:-\d{2})?$/);
  if (!/^\d{4}$/.test(year) || !match) throw new Error('스냅샷 연도·차수가 올바르지 않습니다.');
  return { orderYear: year, majorWeek: match[1].padStart(2, '0') };
}

export function readProfitReportSnapshotRegistry() {
  if (!registryCache) registryCache = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  return registryCache;
}

export function findSnapshotRecord(registry, orderYear, majorWeek) {
  const key = normalizeSnapshotKey(orderYear, majorWeek);
  return (registry?.weeks || []).find((item) =>
    String(item.orderYear) === key.orderYear && String(item.majorWeek).padStart(2, '0') === key.majorWeek) || null;
}

export function findBundledConfirmedSnapshot(orderYear, majorWeek) {
  const record = findSnapshotRecord(readProfitReportSnapshotRegistry(), orderYear, majorWeek);
  return record?.state === PROFIT_REPORT_SNAPSHOT_STATE.CONFIRMED ? record : null;
}

export function confirmedSnapshotMeta(record, origin = 'bundled_fixture') {
  return {
    state: PROFIT_REPORT_SNAPSHOT_STATE.CONFIRMED,
    immutable: true,
    recalculationAllowed: false,
    sourceType: record.sourceType,
    sourceRef: record.sourceRef || null,
    sourceSha256: record.sourceSha256 || null,
    payloadVersion: Number(record.payloadVersion || 1),
    confirmedBy: record.confirmedBy || null,
    confirmedAt: record.confirmedAt || null,
    origin,
    lineage: record.lineage || null,
    sourceAudit: record.sourceAudit || null,
  };
}

export function liveSnapshotMeta(orderYear, majorWeek) {
  const key = normalizeSnapshotKey(orderYear, majorWeek);
  const evidence = findSnapshotRecord(readProfitReportSnapshotRegistry(), key.orderYear, key.majorWeek);
  return {
    state: PROFIT_REPORT_SNAPSHOT_STATE.LIVE,
    immutable: false,
    recalculationAllowed: true,
    sourceType: PROFIT_REPORT_SNAPSHOT_SOURCE.WEB,
    sourceRef: null,
    sourceSha256: null,
    payloadVersion: 1,
    evidenceState: evidence?.state || 'UNVERIFIED',
    evidenceReason: evidence?.reason || null,
  };
}

function frozenRow(row) {
  const values = { ...(row.values || {}) };
  return {
    category: row.category,
    sourceCategory: row.sourceCategory || row.category,
    variant: row.variant || 'normal',
    currency: null,
    stock: {},
    stockAnchored: { begin: null, end: null },
    auto: {
      N: values.N ?? 0, L: values.L ?? 0, O: values.O ?? 0, Q: values.Q ?? 0,
      S: values.S ?? null, H: values.H ?? null, E: values.E ?? null,
      F: values.F ?? null, R: values.R ?? null,
    },
    manual: {},
    inheritedE: false,
    source: { C: 'confirmed_snapshot', E: 'confirmed_snapshot', F: 'confirmed_snapshot', G: 'confirmed_snapshot', H: 'confirmed_snapshot', I: 'confirmed_snapshot', J: 'confirmed_snapshot' },
    confirmedSnapshot: { values },
  };
}

export function materializeBundledSnapshot(record) {
  const auditIssues = Number(record.sourceAudit?.workbookErrorCount || 0) > 0 ? [{
    severity: 'warning',
    code: 'SOURCE_WORKBOOK_FORMULA_ERRORS',
    category: '원본 Excel',
    columns: [],
    message: `보고서 기준 범위 밖 보조 셀에 캐시 오류 ${record.sourceAudit.workbookErrorCount}개가 있습니다. 확정 기준 범위에는 오류가 없습니다.`,
  }] : [];
  return {
    rows: (record.rows || []).map(frozenRow),
    note: '',
    autoNote: '',
    unclassifiedDetails: [],
    rates: [],
    stockWeeks: { begin: null, end: null, selection: 'confirmed_snapshot' },
    audit: {
      status: auditIssues.length ? 'needs_review' : 'ready',
      errorCount: 0,
      warningCount: auditIssues.length,
      issues: auditIssues,
    },
    expectedTotals: record.totals || null,
    snapshot: confirmedSnapshotMeta(record),
  };
}

export function freezeLiveReportData(data, source = {}) {
  const rows = (data.rows || []).map((row) => ({
    category: row.category,
    sourceCategory: row.sourceCategory || row.category,
    variant: row.variant || 'normal',
    currency: row.currency || null,
    stock: {},
    stockAnchored: { begin: null, end: null },
    auto: {},
    manual: {},
    inheritedE: false,
    source: { C: 'confirmed_snapshot', E: 'confirmed_snapshot', F: 'confirmed_snapshot', G: 'confirmed_snapshot', H: 'confirmed_snapshot', I: 'confirmed_snapshot', J: 'confirmed_snapshot' },
    confirmedSnapshot: { values: computeProfitRow(row) },
  }));
  return {
    rows,
    note: data.note || '',
    autoNote: data.autoNote || '',
    unclassifiedDetails: data.unclassifiedDetails || [],
    rates: [],
    stockWeeks: { ...(data.stockWeeks || {}), selection: 'confirmed_snapshot' },
    audit: data.audit || { status: 'ready', errorCount: 0, warningCount: 0, issues: [] },
    expectedTotals: computeProfitTotals(rows.map((row) => ({ ...row, calc: computeProfitRow(row) }))),
    snapshot: {
      state: PROFIT_REPORT_SNAPSHOT_STATE.CONFIRMED,
      immutable: true,
      recalculationAllowed: false,
      sourceType: source.sourceType || PROFIT_REPORT_SNAPSHOT_SOURCE.WEB,
      sourceRef: source.sourceRef || 'server-side loadReportData capture',
      sourceSha256: source.sourceSha256 || null,
      payloadVersion: 1,
      confirmedBy: source.confirmedBy || null,
      confirmedAt: source.confirmedAt || null,
      origin: 'database_snapshot',
    },
  };
}

async function loadPersistedSnapshot(orderYear, majorWeek) {
  const key = normalizeSnapshotKey(orderYear, majorWeek);
  const exists = await query(
    `SELECT CASE WHEN OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') IS NULL THEN 0 ELSE 1 END AS TableExists`,
    {},
  );
  if (Number(exists.recordset?.[0]?.TableExists || 0) !== 1) return null;
  const result = await query(
    `SELECT TOP 1 PayloadJson
       FROM WebProfitReportSnapshot
      WHERE OrderYear=@yr AND MajorWeek=@mw AND State=N'CONFIRMED'
      ORDER BY SnapshotKey DESC`,
    {
      yr: { type: sql.NVarChar, value: key.orderYear },
      mw: { type: sql.NVarChar, value: key.majorWeek },
    },
  );
  const text = result.recordset?.[0]?.PayloadJson;
  return text ? JSON.parse(text) : null;
}

export async function loadConfirmedProfitReportSnapshot(orderYear, majorWeek) {
  const bundled = findBundledConfirmedSnapshot(orderYear, majorWeek);
  if (bundled) return materializeBundledSnapshot(bundled);
  return loadPersistedSnapshot(orderYear, majorWeek);
}

async function assertSnapshotMigrationReady() {
  const exists = await query(
    `SELECT CASE WHEN OBJECT_ID(N'dbo.WebProfitReportSnapshot', N'U') IS NULL THEN 0 ELSE 1 END AS TableExists`,
    {},
  );
  if (Number(exists.recordset?.[0]?.TableExists || 0) === 1) return;
  const error = new Error('확정 스냅샷 migration이 적용되지 않았습니다. docs/migrations/2026-08-13_web_profit_report_snapshot.sql을 먼저 적용하세요.');
  error.code = 'PROFIT_REPORT_SNAPSHOT_MIGRATION_REQUIRED';
  error.statusCode = 503;
  throw error;
}

export async function confirmProfitReportSnapshot({ orderYear, majorWeek, data, actor }) {
  const key = normalizeSnapshotKey(orderYear, majorWeek);
  if (findBundledConfirmedSnapshot(key.orderYear, key.majorWeek)) {
    const error = new Error('이 차수는 Excel 기준 확정 스냅샷이 이미 고정되어 있습니다.');
    error.code = 'PROFIT_REPORT_ALREADY_CONFIRMED';
    error.statusCode = 409;
    throw error;
  }
  await assertSnapshotMigrationReady();
  const confirmedAt = new Date().toISOString();
  const payload = freezeLiveReportData(data, { confirmedBy: actor, confirmedAt });
  return withTransaction(async (tQuery) => {
    const existing = await tQuery(
      `SELECT TOP 1 SnapshotKey FROM WebProfitReportSnapshot WITH (UPDLOCK,HOLDLOCK)
        WHERE OrderYear=@yr AND MajorWeek=@mw AND State=N'CONFIRMED'`,
      { yr: { type: sql.NVarChar, value: key.orderYear }, mw: { type: sql.NVarChar, value: key.majorWeek } },
    );
    if (existing.recordset.length) {
      const error = new Error('이미 확정된 차수입니다. 확정 payload는 덮어쓸 수 없습니다.');
      error.code = 'PROFIT_REPORT_ALREADY_CONFIRMED';
      error.statusCode = 409;
      throw error;
    }
    const inserted = await tQuery(
      `INSERT INTO WebProfitReportSnapshot
         (OrderYear, MajorWeek, State, SourceType, SourceRef, SourceSha256, PayloadVersion, PayloadJson, ConfirmedBy)
       OUTPUT INSERTED.SnapshotKey, INSERTED.ConfirmedAt
       VALUES (@yr,@mw,N'CONFIRMED',@sourceType,@sourceRef,NULL,1,@payload,@actor)`,
      {
        yr: { type: sql.NVarChar, value: key.orderYear },
        mw: { type: sql.NVarChar, value: key.majorWeek },
        sourceType: { type: sql.NVarChar, value: PROFIT_REPORT_SNAPSHOT_SOURCE.WEB },
        sourceRef: { type: sql.NVarChar, value: 'server-side loadReportData capture' },
        payload: { type: sql.NVarChar, value: JSON.stringify(payload) },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      },
    );
    return { ...inserted.recordset[0], payload };
  });
}

export async function assertProfitReportMutable(orderYear, majorWeek) {
  const snapshot = await loadConfirmedProfitReportSnapshot(orderYear, majorWeek);
  if (!snapshot) return;
  const error = new Error('확정 스냅샷 차수는 재계산·수기값·비고·재고단가를 변경할 수 없습니다.');
  error.code = 'PROFIT_REPORT_CONFIRMED_IMMUTABLE';
  error.statusCode = 409;
  throw error;
}
