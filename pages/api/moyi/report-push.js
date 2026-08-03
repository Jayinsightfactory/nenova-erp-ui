// 주차별 매출이익 보고서 → MOYI Drive 전송
// ERP 주문·출고·재고 원장은 읽기만 하고, 전송 감사 이력은 웹 전용 테이블에 기록한다.
import crypto from 'node:crypto';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { composeProfitReportNote } from '../../../lib/profitReport';
import { buildProfitReportXlsx } from '../../../lib/profitReportExcel';
import { loadReportData, parseMajor } from '../sales/profit-report';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } },
};

const TABLE_SQL = `
IF OBJECT_ID(N'dbo.WebMoyiReportPush', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.WebMoyiReportPush (
    PushId NVARCHAR(36) NOT NULL CONSTRAINT PK_WebMoyiReportPush PRIMARY KEY,
    ReportType NVARCHAR(40) NOT NULL,
    OrderYear NVARCHAR(4) NOT NULL,
    OrderWeek NVARCHAR(10) NOT NULL,
    FileName NVARCHAR(255) NOT NULL,
    SizeBytes INT NULL,
    Sha256 NVARCHAR(64) NULL,
    State NVARCHAR(16) NOT NULL CONSTRAINT DF_WebMoyiReportPush_State DEFAULT 'pending',
    AttemptCount INT NOT NULL CONSTRAINT DF_WebMoyiReportPush_AttemptCount DEFAULT 0,
    ResponseStatus INT NULL,
    ResponseText NVARCHAR(2000) NULL,
    RemoteFileId NVARCHAR(36) NULL,
    ErrorText NVARCHAR(2000) NULL,
    RequestedBy NVARCHAR(100) NULL,
    RequestedAt DATETIME2 NOT NULL CONSTRAINT DF_WebMoyiReportPush_RequestedAt DEFAULT GETDATE(),
    LastAttemptAt DATETIME2 NULL,
    SentAt DATETIME2 NULL
  );
END
`;

const REPORT_TYPE = 'weekly-profit-report';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function truncate(value, max = 1900) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').slice(0, max);
}

function rowFromRecord(row) {
  if (!row) return null;
  return {
    pushId: row.PushId,
    reportType: row.ReportType,
    orderYear: row.OrderYear,
    orderWeek: row.OrderWeek,
    fileName: row.FileName,
    sizeBytes: row.SizeBytes,
    sha256: row.Sha256,
    state: row.State,
    attemptCount: row.AttemptCount,
    responseStatus: row.ResponseStatus,
    responseText: row.ResponseText,
    remoteFileId: row.RemoteFileId,
    errorText: row.ErrorText,
    requestedBy: row.RequestedBy,
    requestedAt: row.RequestedAt?.toISOString?.() || row.RequestedAt || null,
    lastAttemptAt: row.LastAttemptAt?.toISOString?.() || row.LastAttemptAt || null,
    sentAt: row.SentAt?.toISOString?.() || row.SentAt || null,
  };
}

async function ensureTable() {
  await query(TABLE_SQL);
}

async function getPush(pushId) {
  const result = await query(
    `SELECT TOP (1) PushId, ReportType, OrderYear, OrderWeek, FileName, SizeBytes, Sha256,
            State, AttemptCount, ResponseStatus, ResponseText, RemoteFileId, ErrorText,
            RequestedBy, RequestedAt, LastAttemptAt, SentAt
       FROM dbo.WebMoyiReportPush
      WHERE PushId=@pushId`,
    { pushId: { type: sql.NVarChar(36), value: pushId } },
  );
  return result.recordset?.[0] || null;
}

async function createPending({ pushId, orderYear, major, fileName, actor }) {
  await query(
    `INSERT INTO dbo.WebMoyiReportPush
       (PushId, ReportType, OrderYear, OrderWeek, FileName, State, AttemptCount, RequestedBy, LastAttemptAt)
     VALUES (@pushId, @reportType, @orderYear, @orderWeek, @fileName, 'pending', 1, @actor, GETDATE())`,
    {
      pushId: { type: sql.NVarChar(36), value: pushId },
      reportType: { type: sql.NVarChar(40), value: REPORT_TYPE },
      orderYear: { type: sql.NVarChar(4), value: String(orderYear) },
      orderWeek: { type: sql.NVarChar(10), value: String(major) },
      fileName: { type: sql.NVarChar(255), value: fileName },
      actor: { type: sql.NVarChar(100), value: actor || null },
    },
  );
}

async function markAttempt(pushId, { state, sizeBytes, sha256, responseStatus, responseText, remoteFileId, errorText, sent }) {
  await query(
    `UPDATE dbo.WebMoyiReportPush
        SET State=@state,
            SizeBytes=@sizeBytes,
            Sha256=@sha256,
            ResponseStatus=@responseStatus,
            ResponseText=@responseText,
            RemoteFileId=@remoteFileId,
            ErrorText=@errorText,
            SentAt=CASE WHEN @sent=1 THEN GETDATE() ELSE NULL END
      WHERE PushId=@pushId`,
    {
      pushId: { type: sql.NVarChar(36), value: pushId },
      state: { type: sql.NVarChar(16), value: state },
      sizeBytes: { type: sql.Int, value: sizeBytes == null ? null : Number(sizeBytes) },
      sha256: { type: sql.NVarChar(64), value: sha256 || null },
      responseStatus: { type: sql.Int, value: responseStatus == null ? null : Number(responseStatus) },
      responseText: { type: sql.NVarChar(2000), value: responseText || null },
      remoteFileId: { type: sql.NVarChar(36), value: remoteFileId || null },
      errorText: { type: sql.NVarChar(2000), value: errorText || null },
      sent: { type: sql.Bit, value: sent ? 1 : 0 },
    },
  );
}

async function retryPending(pushId, actor) {
  await query(
    `UPDATE dbo.WebMoyiReportPush
        SET State='pending', AttemptCount=AttemptCount+1, RequestedBy=@actor,
            LastAttemptAt=GETDATE(), ResponseStatus=NULL, ResponseText=NULL,
            RemoteFileId=NULL, ErrorText=NULL, SentAt=NULL
      WHERE PushId=@pushId`,
    {
      pushId: { type: sql.NVarChar(36), value: pushId },
      actor: { type: sql.NVarChar(100), value: actor || null },
    },
  );
}

async function listPushes(req, res) {
  const weekRaw = String(req.query.week || '').trim();
  const major = weekRaw ? parseMajor(weekRaw) : null;
  if (weekRaw && !major) return res.status(400).json({ success: false, error: 'week 형식이 올바르지 않습니다.' });
  const year = req.query.year ? String(req.query.year).trim() : '';
  const result = await query(
    `SELECT TOP (30) PushId, ReportType, OrderYear, OrderWeek, FileName, SizeBytes, Sha256,
            State, AttemptCount, ResponseStatus, ResponseText, RemoteFileId, ErrorText,
            RequestedBy, RequestedAt, LastAttemptAt, SentAt
       FROM dbo.WebMoyiReportPush
      WHERE (@week='' OR OrderWeek=@week) AND (@year='' OR OrderYear=@year)
      ORDER BY RequestedAt DESC`,
    {
      week: { type: sql.NVarChar(10), value: major || '' },
      year: { type: sql.NVarChar(4), value: year },
    },
  );
  return res.status(200).json({ success: true, rows: (result.recordset || []).map(rowFromRecord) });
}

async function pushReport(req, res) {
  const body = req.body || {};
  const actor = req.user?.userName || req.user?.userId || 'user';
  const retryId = String(body.retryPushId || '').trim();
  let existing = null;
  if (retryId) {
    existing = await getPush(retryId);
    if (!existing) return res.status(404).json({ success: false, error: '재시도할 전송 이력을 찾을 수 없습니다.' });
  }

  const major = existing?.OrderWeek || parseMajor(body.week);
  if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 30)' });
  const orderYear = existing?.OrderYear || resolveActiveOrderYear(`${major}-01`, body.year);
  const fileName = existing?.FileName || `주차별 매출이익 보고서-${orderYear}-${Number(major)}차.xlsx`;
  const pushId = existing?.PushId || crypto.randomUUID();

  if (existing) await retryPending(pushId, actor);
  else await createPending({ pushId, orderYear, major, fileName, actor });

  let buffer;
  let sha256 = '';
  try {
    const data = await loadReportData(major, orderYear);
    buffer = buildProfitReportXlsx({
      major,
      rows: data.rows,
      note: composeProfitReportNote(data.note, data.autoNote),
      audit: data.audit,
    });
    sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    const message = truncate(`보고서 생성 실패: ${error.message}`);
    await markAttempt(pushId, { state: 'failed', errorText: message, sent: false });
    return res.status(500).json({ success: false, pushId, state: 'failed', error: message });
  }

  const base = (process.env.MOYI_API_BASE || 'https://api.nowlink.kr').replace(/\/$/, '');
  const token = process.env.MOYI_PUSH_TOKEN || process.env.MOYI_API_TOKEN || '';
  if (!token) {
    const message = 'MOYI_PUSH_TOKEN 또는 MOYI_API_TOKEN이 배포 환경에 설정되지 않았습니다.';
    await markAttempt(pushId, { state: 'failed', sizeBytes: buffer.length, sha256, errorText: message, sent: false });
    return res.status(503).json({ success: false, pushId, state: 'failed', error: message });
  }

  try {
    const upstream = await fetch(`${base}/integrations/nenovaweb/inbound`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        file_id: pushId,
        filename: fileName,
        mime: XLSX_MIME,
        tags: ['nenovaweb', REPORT_TYPE, `year:${orderYear}`, `week:${major}`],
        content_base64: buffer.toString('base64'),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const responseText = truncate(await upstream.text());
    let responseJson = null;
    try { responseJson = responseText ? JSON.parse(responseText) : null; } catch { /* 응답이 JSON이 아니어도 원문을 이력에 보관 */ }
    if (!upstream.ok) {
      const error = truncate(`MOYI 수신 실패 (${upstream.status}): ${responseText || upstream.statusText}`);
      await markAttempt(pushId, {
        state: 'failed', sizeBytes: buffer.length, sha256, responseStatus: upstream.status,
        responseText, errorText: error, sent: false,
      });
      return res.status(502).json({ success: false, pushId, state: 'failed', error, responseStatus: upstream.status });
    }
    await markAttempt(pushId, {
      state: 'sent', sizeBytes: buffer.length, sha256, responseStatus: upstream.status,
      responseText, remoteFileId: responseJson?.file_id, sent: true,
    });
    return res.status(200).json({
      success: true,
      pushId,
      state: 'sent',
      fileName,
      sizeBytes: buffer.length,
      sha256,
      remoteFileId: responseJson?.file_id || pushId,
    });
  } catch (error) {
    const message = truncate(`MOYI 전송 오류: ${error.message}`);
    await markAttempt(pushId, { state: 'failed', sizeBytes: buffer.length, sha256, errorText: message, sent: false });
    return res.status(502).json({ success: false, pushId, state: 'failed', error: message });
  }
}

export default withAuth(async function handler(req, res) {
  try {
    await ensureTable();
    if (req.method === 'GET') return listPushes(req, res);
    if (req.method === 'POST') return pushReport(req, res);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[moyi/report-push]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
