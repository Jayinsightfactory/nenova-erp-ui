// lib/profitReportConfirm.js — 주차별 매출이익 보고서 "보고서 기준 확정(confirm snapshot)".
//
// 계약: docs/contracts/weekly-profit-report.json (REPORT_CONFIRM_SNAPSHOT/CANCEL/HISTORY_VIEW/FORCE)
//   - OrderYear+MajorWeek 당 활성(IsActive=1) revision은 정확히 0~1개.
//   - 취소는 DELETE가 아니라 IsActive=0 + CancelledBy/CancelledAt UPDATE. 재확정은 새 RevisionNo.
//   - Order/Shipment/Estimate/ProductStock/StockHistory 등 ERP 공유 원장은 이 모듈이 절대 건드리지 않는다.
//     아래 두 테이블(WebProfitReportConfirm/WebProfitReportConfirmDetail)만 쓴다.
//   - GET(조회/이력)은 스키마를 만들지 않는다 — ensureConfirmTables()는 confirmSnapshot/cancelConfirm
//     (POST 쓰기 경로)에서만 호출한다. 스키마가 없으면 조회 계열은 initialized:false로 반환한다.
import crypto from 'crypto';
import { query, sql, withTransaction } from './db.js';

// 카테고리별 원천값 — 저장 시점에 실제로 적용된(수기 override 반영 후) 최종 원천.
const SOURCE_COLS = ['N', 'L', 'O', 'Q', 'R', 'S', 'H', 'E', 'F'];
// 계산값 — 엑셀 열 전부(C~U). E/F/H/L/N/O/Q/R/S는 SOURCE와 값이 같아도 ColType으로 의미를 구분해 둘 다 저장한다.
const CALC_COLS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'];
// 환율/통관/포워딩 원천 태그
const SOURCE_TAG_COLS = ['R', 'H', 'S'];
const TOTAL_CATEGORY = '_total';

const CONFIRM_TABLES = ['WebProfitReportConfirm', 'WebProfitReportConfirmDetail'];

// ── 스키마 상태(읽기 전용) — GET/이력조회가 쓴다. CREATE 하지 않는다.
export async function confirmSchemaStatus() {
  const r = await query(
    `SELECT v.TableName
       FROM (VALUES ${CONFIRM_TABLES.map((_, i) => `(@t${i})`).join(',')}) v(TableName)
      WHERE OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL`,
    Object.fromEntries(CONFIRM_TABLES.map((t, i) => [`t${i}`, { type: sql.NVarChar, value: t }])),
  );
  const missing = r.recordset.map((row) => row.TableName);
  return { initialized: missing.length === 0, missing };
}

// ── 스키마 생성(idempotent) — POST 확정/취소 경로에서만 호출한다(GET에서 절대 호출 금지).
// docs/migrations/2026-08-11_web_profit_report_confirm.sql 의 두 테이블 정의와 동일해야 한다.
// FreightCost.CurrencyCode/CurrencyValidationStatus ALTER는 여기 포함하지 않는다 — 기존 공유
// 테이블 컬럼 추가는 운영자가 그 마이그레이션 파일을 SSMS에서 직접 실행해야 하는 별도 절차다.
let _ensured = null;
export async function ensureConfirmTables() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF OBJECT_ID(N'dbo.WebProfitReportConfirm', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.WebProfitReportConfirm (
         ConfirmKey        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
         OrderYear         NVARCHAR(4)  NOT NULL,
         MajorWeek         NVARCHAR(4)  NOT NULL,
         RevisionNo        INT          NOT NULL DEFAULT 1,
         IsActive          BIT          NOT NULL DEFAULT 1,
         BeginOrderYear    NVARCHAR(4)  NULL,
         BeginOrderWeek    NVARCHAR(10) NULL,
         BeginStockKey     INT          NULL,
         EndOrderYear      NVARCHAR(4)  NULL,
         EndOrderWeek      NVARCHAR(10) NULL,
         EndStockKey       INT          NULL,
         SourceHash        NVARCHAR(128) NULL,
         AuditStatus       NVARCHAR(20)  NULL,
         AuditIssuesJson   NVARCHAR(MAX) NULL,
         IsForced          BIT           NOT NULL DEFAULT 0,
         ForceReason       NVARCHAR(1000) NULL,
         ConfirmedBy       NVARCHAR(50)  NULL,
         ConfirmedByName   NVARCHAR(100) NULL,
         ConfirmedAt       DATETIME      NOT NULL DEFAULT GETDATE(),
         CancelledBy       NVARCHAR(50)  NULL,
         CancelledByName   NVARCHAR(100) NULL,
         CancelledAt       DATETIME      NULL,
         Notes             NVARCHAR(2000) NULL
       );
     END;
     IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_ActiveWeek')
       CREATE UNIQUE INDEX UX_WebProfitReportConfirm_ActiveWeek
       ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek) WHERE IsActive = 1;
     IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirm_Revision')
       CREATE UNIQUE INDEX UX_WebProfitReportConfirm_Revision
       ON dbo.WebProfitReportConfirm(OrderYear, MajorWeek, RevisionNo);
     IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirm_AuditStatus')
       ALTER TABLE dbo.WebProfitReportConfirm WITH NOCHECK
       ADD CONSTRAINT CK_WebProfitReportConfirm_AuditStatus
       CHECK (AuditStatus IS NULL OR AuditStatus IN (N'ready', N'needs_review', N'needs_input'));

     IF OBJECT_ID(N'dbo.WebProfitReportConfirmDetail', N'U') IS NULL
     BEGIN
       CREATE TABLE dbo.WebProfitReportConfirmDetail (
         ConfirmDetailKey  INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
         ConfirmKey        INT          NOT NULL,
         Category          NVARCHAR(60) NOT NULL,
         ColType           NVARCHAR(12) NOT NULL,
         ColKey            NVARCHAR(20) NOT NULL,
         Value             DECIMAL(38,10) NULL,
         TextValue         NVARCHAR(2000) NULL,
         CONSTRAINT FK_WebProfitReportConfirmDetail_Confirm
           FOREIGN KEY (ConfirmKey) REFERENCES dbo.WebProfitReportConfirm(ConfirmKey)
       );
     END;
     IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_WebProfitReportConfirmDetail')
       CREATE UNIQUE INDEX UX_WebProfitReportConfirmDetail
       ON dbo.WebProfitReportConfirmDetail(ConfirmKey, Category, ColType, ColKey);
     IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WebProfitReportConfirmDetail_Confirm')
       CREATE INDEX IX_WebProfitReportConfirmDetail_Confirm ON dbo.WebProfitReportConfirmDetail(ConfirmKey);
     IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_WebProfitReportConfirmDetail_ColType')
       ALTER TABLE dbo.WebProfitReportConfirmDetail WITH NOCHECK
       ADD CONSTRAINT CK_WebProfitReportConfirmDetail_ColType
       CHECK (ColType IN (N'SOURCE', N'CALC', N'SOURCE_TAG'));`,
    {},
  );
  return _ensured;
}

/** 원천 데이터 변경 감지용 해시 — rows의 auto/manual/stock 입력과 재고 스냅샷 좌표를 정규화해 sha256.
 * 확정 시점 원천을 기록해 두는 용도이며, 이후 원천이 바뀌어도 이 해시로 재계산하거나 자동 비교하지 않는다
 * (감사·수동 대조용 참고값). */
export function buildSourceHash({ rows, stockWeeks }) {
  const canonicalRows = (rows || [])
    .map((r) => ({ category: r.category, auto: r.auto || {}, manual: r.manual || {}, stock: r.stock || {} }))
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const payload = JSON.stringify({ rows: canonicalRows, stockWeeks: stockWeeks || {} });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/** 확정 저장 대상 세로행 목록 구성 — rows(계산 완료, row.calc 포함)와 totals에서
 * SOURCE(N/L/O/Q/R/S/H/E/F) + CALC(C~U) + SOURCE_TAG(R/H/S) 전부를 뽑는다. */
export function buildConfirmDetailRows(rows, totals) {
  const details = [];
  for (const row of rows || []) {
    const calc = row.calc || {};
    for (const col of SOURCE_COLS) {
      details.push({ category: row.category, colType: 'SOURCE', colKey: col, value: numOrNull(calc[col]), textValue: null });
    }
    for (const col of CALC_COLS) {
      details.push({ category: row.category, colType: 'CALC', colKey: col, value: numOrNull(calc[col]), textValue: null });
    }
    for (const col of SOURCE_TAG_COLS) {
      const tag = row.source?.[col];
      details.push({ category: row.category, colType: 'SOURCE_TAG', colKey: col, value: null, textValue: tag == null ? null : String(tag) });
    }
  }
  for (const col of CALC_COLS) {
    details.push({ category: TOTAL_CATEGORY, colType: 'CALC', colKey: col, value: numOrNull(totals?.[col]), textValue: null });
  }
  return details;
}
function numOrNull(v) {
  return v == null || Number.isNaN(Number(v)) ? null : Number(v);
}

async function insertDetailsBatch(tQuery, confirmKey, details) {
  const CHUNK = 40; // 4 파라미터/행 — 40행씩이면 파라미터 160개, SQL Server 2100 한도에 여유
  for (let i = 0; i < details.length; i += CHUNK) {
    const chunk = details.slice(i, i + CHUNK);
    const valuesSql = chunk.map((_, j) => `(@ck, @cat${j}, @ct${j}, @col${j}, @val${j}, @txt${j})`).join(',');
    const params = { ck: { type: sql.Int, value: confirmKey } };
    chunk.forEach((d, j) => {
      params[`cat${j}`] = { type: sql.NVarChar, value: d.category };
      params[`ct${j}`] = { type: sql.NVarChar, value: d.colType };
      params[`col${j}`] = { type: sql.NVarChar, value: d.colKey };
      params[`val${j}`] = { type: sql.Decimal(38, 10), value: d.value };
      params[`txt${j}`] = { type: sql.NVarChar, value: d.textValue };
    });
    await tQuery(
      `INSERT INTO dbo.WebProfitReportConfirmDetail (ConfirmKey, Category, ColType, ColKey, Value, TextValue)
       VALUES ${valuesSql}`,
      params,
    );
  }
}

class ProfitReportConfirmError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** 보고서 기준 확정 — rows/totals는 pages/api/sales/profit-report.js의 loadReportData() 결과에
 * computeProfitRow/calcRevenueRatio/calcPurchaseRatio를 적용해 넘겨야 한다(라이브 미리보기와 동일 계산).
 * audit은 buildProfitReportAudit() 결과. force가 아니면 audit.errorCount>0일 때 거부한다. */
export async function confirmSnapshot({
  orderYear, major, rows, totals, stockWeeks, audit, actor, actorName, isAdmin, force, forceReason, notes,
}) {
  if (!orderYear || !major) throw new ProfitReportConfirmError('BAD_REQUEST', 'orderYear/major가 필요합니다.');
  if (!Array.isArray(rows) || !rows.length) throw new ProfitReportConfirmError('BAD_REQUEST', '확정할 보고서 행이 없습니다.');
  const errorCount = Number(audit?.errorCount || 0);
  if (force) {
    if (!isAdmin) throw new ProfitReportConfirmError('FORCE_REQUIRES_ADMIN', '강제 확정은 관리자만 할 수 있습니다.', 403);
    if (!String(forceReason || '').trim()) throw new ProfitReportConfirmError('FORCE_REASON_REQUIRED', '강제 확정 사유를 입력해야 합니다.');
  } else if (errorCount > 0) {
    throw new ProfitReportConfirmError(
      'AUDIT_BLOCKED',
      `검증 오류 ${errorCount}건이 남아 있어 확정할 수 없습니다. 오류를 먼저 해결하거나(권장), 불가피하면 관리자 권한으로 사유를 입력해 강제 확정하세요.`,
    );
  }

  await ensureConfirmTables();
  const sourceHash = buildSourceHash({ rows, stockWeeks });
  const details = buildConfirmDetailRows(rows, totals);

  return withTransaction(async (tQuery) => {
    const activeRes = await tQuery(
      `SELECT ConfirmKey FROM dbo.WebProfitReportConfirm WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderYear=@yr AND MajorWeek=@mw AND IsActive=1`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } },
    );
    if (activeRes.recordset.length) {
      throw new ProfitReportConfirmError(
        'ACTIVE_CONFIRM_EXISTS',
        '이미 활성 확정본이 있습니다. 다시 확정하려면 먼저 확정을 취소하세요.',
        409,
      );
    }
    const revRes = await tQuery(
      `SELECT ISNULL(MAX(RevisionNo),0)+1 AS RevisionNo FROM dbo.WebProfitReportConfirm WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderYear=@yr AND MajorWeek=@mw`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } },
    );
    const revisionNo = Number(revRes.recordset[0]?.RevisionNo || 1);

    const insertRes = await tQuery(
      `INSERT INTO dbo.WebProfitReportConfirm
         (OrderYear, MajorWeek, RevisionNo, IsActive, BeginOrderYear, BeginOrderWeek, BeginStockKey,
          EndOrderYear, EndOrderWeek, EndStockKey, SourceHash, AuditStatus, AuditIssuesJson,
          IsForced, ForceReason, ConfirmedBy, ConfirmedByName, Notes)
       OUTPUT INSERTED.ConfirmKey, INSERTED.ConfirmedAt
       VALUES (@yr, @mw, @rev, 1, @begYr, @begWk, @begSk, @endYr, @endWk, @endSk, @hash, @auditStatus, @auditJson,
               @isForced, @forceReason, @actor, @actorName, @notes)`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        mw: { type: sql.NVarChar, value: major },
        rev: { type: sql.Int, value: revisionNo },
        begYr: { type: sql.NVarChar, value: stockWeeks?.beginOrderYear ?? null },
        begWk: { type: sql.NVarChar, value: stockWeeks?.begin ?? null },
        begSk: { type: sql.Int, value: stockWeeks?.beginStockKey ?? null },
        endYr: { type: sql.NVarChar, value: stockWeeks?.endOrderYear ?? null },
        endWk: { type: sql.NVarChar, value: stockWeeks?.end ?? null },
        endSk: { type: sql.Int, value: stockWeeks?.endStockKey ?? null },
        hash: { type: sql.NVarChar, value: sourceHash },
        auditStatus: { type: sql.NVarChar, value: audit?.status ?? null },
        auditJson: { type: sql.NVarChar, value: JSON.stringify(audit?.issues || []) },
        isForced: { type: sql.Bit, value: force ? 1 : 0 },
        forceReason: { type: sql.NVarChar, value: force ? String(forceReason).trim().slice(0, 1000) : null },
        actor: { type: sql.NVarChar, value: actor || 'user' },
        actorName: { type: sql.NVarChar, value: actorName || null },
        notes: { type: sql.NVarChar, value: notes == null ? null : String(notes).slice(0, 2000) },
      },
    );
    const confirmKey = insertRes.recordset[0].ConfirmKey;
    const confirmedAt = insertRes.recordset[0].ConfirmedAt;
    await insertDetailsBatch(tQuery, confirmKey, details);
    return {
      confirmKey, orderYear: String(orderYear), major, revisionNo, isForced: Boolean(force),
      forceReason: force ? forceReason : null, confirmedBy: actor, confirmedByName: actorName, confirmedAt,
      auditStatus: audit?.status ?? null, sourceHash,
    };
  });
}

/** 확정 취소 — 활성 revision을 DELETE하지 않고 IsActive=0 + Cancelled* 만 UPDATE한다. */
export async function cancelConfirm({ orderYear, major, actor, actorName }) {
  const status = await confirmSchemaStatus();
  if (!status.initialized) {
    throw new ProfitReportConfirmError('SCHEMA_NOT_INITIALIZED', '확정 스키마가 아직 초기화되지 않았습니다. 취소할 확정본이 없습니다.', 404);
  }
  return withTransaction(async (tQuery) => {
    const activeRes = await tQuery(
      `SELECT ConfirmKey, RevisionNo FROM dbo.WebProfitReportConfirm WITH (UPDLOCK, HOLDLOCK)
        WHERE OrderYear=@yr AND MajorWeek=@mw AND IsActive=1`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } },
    );
    const row = activeRes.recordset[0];
    if (!row) throw new ProfitReportConfirmError('NO_ACTIVE_CONFIRM', '취소할 활성 확정본이 없습니다.', 404);
    await tQuery(
      `UPDATE dbo.WebProfitReportConfirm
          SET IsActive=0, CancelledBy=@actor, CancelledByName=@actorName, CancelledAt=GETDATE()
        WHERE ConfirmKey=@ck`,
      {
        ck: { type: sql.Int, value: row.ConfirmKey },
        actor: { type: sql.NVarChar, value: actor || 'user' },
        actorName: { type: sql.NVarChar, value: actorName || null },
      },
    );
    return { confirmKey: row.ConfirmKey, revisionNo: row.RevisionNo, cancelled: true };
  });
}

function hydrateDetails(details) {
  const rowsByCategory = {};
  const totalsCalc = {};
  for (const d of details) {
    const value = d.Value != null ? Number(d.Value) : null;
    if (d.Category === TOTAL_CATEGORY) {
      if (d.ColType === 'CALC') totalsCalc[d.ColKey] = value;
      continue;
    }
    if (!rowsByCategory[d.Category]) rowsByCategory[d.Category] = { source: {}, calc: {}, sourceTag: {} };
    if (d.ColType === 'SOURCE') rowsByCategory[d.Category].source[d.ColKey] = value;
    else if (d.ColType === 'CALC') rowsByCategory[d.Category].calc[d.ColKey] = value;
    else if (d.ColType === 'SOURCE_TAG') rowsByCategory[d.Category].sourceTag[d.ColKey] = d.TextValue;
  }
  return { rowsByCategory, totalsCalc };
}

function mapHeader(h) {
  return {
    confirmKey: h.ConfirmKey,
    orderYear: h.OrderYear,
    major: h.MajorWeek,
    revisionNo: Number(h.RevisionNo),
    isActive: Boolean(h.IsActive),
    beginOrderYear: h.BeginOrderYear, beginOrderWeek: h.BeginOrderWeek, beginStockKey: h.BeginStockKey,
    endOrderYear: h.EndOrderYear, endOrderWeek: h.EndOrderWeek, endStockKey: h.EndStockKey,
    sourceHash: h.SourceHash,
    auditStatus: h.AuditStatus,
    auditIssues: safeParseJson(h.AuditIssuesJson),
    isForced: Boolean(h.IsForced),
    forceReason: h.ForceReason,
    confirmedBy: h.ConfirmedBy, confirmedByName: h.ConfirmedByName, confirmedAt: h.ConfirmedAt,
    cancelledBy: h.CancelledBy, cancelledByName: h.CancelledByName, cancelledAt: h.CancelledAt,
    notes: h.Notes,
  };
}
function safeParseJson(text) {
  if (!text) return [];
  try { return JSON.parse(text); } catch { return []; }
}

/** 활성 확정 스냅샷 조회 — GET(주차별 보고서 화면/엑셀)이 이 결과를 우선 사용한다.
 * 스키마 미설치/활성본 없음은 오류가 아니라 null로 정상 반환한다(라이브 미리보기로 자연스럽게 대체). */
export async function getActiveConfirm(orderYear, major) {
  const status = await confirmSchemaStatus();
  if (!status.initialized) return { initialized: false, confirm: null };
  const headerRes = await query(
    `SELECT * FROM WebProfitReportConfirm WHERE OrderYear=@yr AND MajorWeek=@mw AND IsActive=1`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } },
  );
  const header = headerRes.recordset[0];
  if (!header) return { initialized: true, confirm: null };
  const detailRes = await query(
    `SELECT Category, ColType, ColKey, Value, TextValue FROM WebProfitReportConfirmDetail WHERE ConfirmKey=@ck`,
    { ck: { type: sql.Int, value: header.ConfirmKey } },
  );
  const { rowsByCategory, totalsCalc } = hydrateDetails(detailRes.recordset);
  return { initialized: true, confirm: mapHeader(header), rowsByCategory, totalsCalc };
}

/** 확정 이력(활성+비활성 전체) — 읽기 전용, 절대 쓰지 않는다(ensureConfirmTables 호출 없음). */
export async function listConfirmHistory(orderYear, major) {
  const status = await confirmSchemaStatus();
  if (!status.initialized) return { initialized: false, revisions: [] };
  const r = await query(
    `SELECT * FROM WebProfitReportConfirm WHERE OrderYear=@yr AND MajorWeek=@mw ORDER BY RevisionNo DESC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } },
  );
  return { initialized: true, revisions: r.recordset.map(mapHeader) };
}

export { SOURCE_COLS, CALC_COLS, SOURCE_TAG_COLS, TOTAL_CATEGORY, ProfitReportConfirmError };
