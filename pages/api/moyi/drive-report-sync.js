// 주차별 매출이익 보고서 → MOYI 회사 드라이브(경영지원/보고) 동기화
// ERP 주문·출고·재고 원장은 읽기만 하고, 전송 이력은 웹 전용 WebMoyiReportPush에 기록한다.
// MOYI 쪽은 drive-bridge 에이전트 프로토콜(/drive-bridge/index → /drive-bridge/content)로
// 차수별 엑셀(2번째 시트=월별)을 부서 폴더 트리에 올린다 — 브리지 PC 없이 서버가 직접 밀어넣는 구조.
import crypto from 'node:crypto';
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { composeProfitReportNote } from '../../../lib/profitReport';
import { buildProfitReportXlsx } from '../../../lib/profitReportExcel';
import { loadAnnualMonthlyReportData, loadWeeklyReportPayload, parseMajor } from '../sales/profit-report';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' }, responseLimit: '8mb' },
};

const REPORT_TYPE = 'weekly-profit-drive';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const REPORT_FOLDER = '경영지원/보고';
// 부서 트리 뼈대 — 모바일 드라이브의 "회사 드라이브"에 이 구조 그대로 보인다.
const DEPT_SKELETON = ['영업지원', '수입부', '경영지원', '영업']
  .flatMap(dept => [dept, `${dept}/전체`, `${dept}/보고`]);

function truncate(value, max = 1900) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ').slice(0, max);
}

// report-push와 같은 웹 전용 감사 테이블을 공유한다 (멱등 생성 — ERP 원장 아님).
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

async function logPush({ orderYear, major, fileName, actor, state, sizeBytes, sha256, responseStatus, responseText, remoteFileId, errorText }) {
  await query(
    `INSERT INTO dbo.WebMoyiReportPush
       (PushId, ReportType, OrderYear, OrderWeek, FileName, SizeBytes, Sha256, State, AttemptCount,
        ResponseStatus, ResponseText, RemoteFileId, ErrorText, RequestedBy, LastAttemptAt, SentAt)
     VALUES (@pushId, @reportType, @orderYear, @orderWeek, @fileName, @sizeBytes, @sha256, @state, 1,
             @responseStatus, @responseText, @remoteFileId, @errorText, @actor, GETDATE(),
             CASE WHEN @state='sent' THEN GETDATE() ELSE NULL END)`,
    {
      pushId: { type: sql.NVarChar(36), value: crypto.randomUUID() },
      reportType: { type: sql.NVarChar(40), value: REPORT_TYPE },
      orderYear: { type: sql.NVarChar(4), value: String(orderYear) },
      orderWeek: { type: sql.NVarChar(10), value: String(major) },
      fileName: { type: sql.NVarChar(255), value: fileName },
      sizeBytes: { type: sql.Int, value: sizeBytes == null ? null : Number(sizeBytes) },
      sha256: { type: sql.NVarChar(64), value: sha256 || null },
      state: { type: sql.NVarChar(16), value: state },
      responseStatus: { type: sql.Int, value: responseStatus == null ? null : Number(responseStatus) },
      responseText: { type: sql.NVarChar(2000), value: truncate(responseText) || null },
      remoteFileId: { type: sql.NVarChar(36), value: remoteFileId || null },
      errorText: { type: sql.NVarChar(2000), value: truncate(errorText) || null },
      actor: { type: sql.NVarChar(100), value: actor || null },
    },
  );
}

async function moyiFetch(base, token, path, body) {
  const upstream = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await upstream.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 원문은 이력에만 보관 */ }
  return { ok: upstream.ok, status: upstream.status, text, json };
}

function fileNameFor(orderYear, major) {
  return `${orderYear}년 ${String(major).padStart(2, '0')}차 주차별 매출이익.xlsx`;
}

async function syncReports(req, res) {
  const actor = req.user?.userName || req.user?.userId || 'user';
  const body = req.body || {};
  const orderYear = resolveActiveOrderYear('', body.year);

  const base = (process.env.MOYI_API_BASE || 'https://api.nowlink.kr').replace(/\/$/, '');
  const token = process.env.MOYI_BRIDGE_TOKEN || '';
  if (!token) {
    return res.status(503).json({ success: false, error: 'MOYI_BRIDGE_TOKEN이 배포 환경에 설정되지 않았습니다.' });
  }

  // 연간 월별 집계 한 번 — 모든 차수 파일의 2번째 시트(월별)에 동일하게 들어간다.
  const annual = await loadAnnualMonthlyReportData(orderYear);
  const availableMajors = (annual.weeks || []).filter(w => !w.error).map(w => String(w.major).padStart(2, '0'));
  let targetMajors = availableMajors;
  if (Array.isArray(body.weeks) && body.weeks.length) {
    const requested = body.weeks.map(w => parseMajor(String(w))).filter(Boolean);
    if (!requested.length) return res.status(400).json({ success: false, error: 'weeks 형식이 올바르지 않습니다 (예: ["26","27"])' });
    targetMajors = requested.filter(m => availableMajors.includes(m));
  }
  if (!targetMajors.length) {
    return res.status(400).json({ success: false, error: '동기화할 차수가 없습니다.' });
  }
  const monthly = { year: annual.year, months: annual.months, boundaryWeeks: annual.boundaryWeeks, missingWeeks: annual.missingWeeks };

  // 1) 차수별 엑셀 생성 (주차 시트 + 월별 시트)
  const files = [];
  const results = [];
  for (const major of targetMajors) {
    try {
      const data = await loadWeeklyReportPayload(major, orderYear);
      const buffer = buildProfitReportXlsx({
        major,
        rows: data.rows,
        note: composeProfitReportNote(data.note, data.autoNote),
        audit: data.audit,
        confirmedTotals: data.confirmedTotals,
        monthly,
      });
      files.push({ major, fileName: fileNameFor(orderYear, major), buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
    } catch (error) {
      results.push({ major, state: 'failed', error: truncate(`보고서 생성 실패: ${error.message}`) });
    }
  }

  // 2) 부서 트리 + 파일 메타 색인 (full=false — 다른 에이전트/기존 항목은 건드리지 않는다)
  const nowIso = new Date().toISOString();
  const indexItems = [
    ...DEPT_SKELETON.map(p => ({ path: p, name: p.split('/').pop(), kind: 'dir', size: 0 })),
    ...files.map(f => ({
      path: `${REPORT_FOLDER}/${f.fileName}`, name: f.fileName, kind: 'file',
      size: f.buffer.length, mtime: nowIso, mime: XLSX_MIME,
    })),
  ];
  const indexRes = await moyiFetch(base, token, '/drive-bridge/index', { items: indexItems, full: false });
  if (!indexRes.ok) {
    const error = truncate(`MOYI 색인 실패 (${indexRes.status}): ${indexRes.text}`);
    for (const f of files) {
      await logPush({ orderYear, major: f.major, fileName: f.fileName, actor, state: 'failed', sizeBytes: f.buffer.length, sha256: f.sha256, responseStatus: indexRes.status, responseText: indexRes.text, errorText: error });
      results.push({ major: f.major, state: 'failed', error });
    }
    return res.status(502).json({ success: false, error, results });
  }
  const itemIds = indexRes.json?.items || {};

  // 3) 파일 내용 업로드 — 색인 캐시에 의존하지 않고 매번 최신 내용으로 교체한다.
  for (const f of files) {
    const itemId = itemIds[`${REPORT_FOLDER}/${f.fileName}`];
    if (!itemId) {
      const error = '색인 응답에 항목 id가 없습니다 — MOYI 백엔드 버전 확인 필요.';
      await logPush({ orderYear, major: f.major, fileName: f.fileName, actor, state: 'failed', sizeBytes: f.buffer.length, sha256: f.sha256, errorText: error });
      results.push({ major: f.major, state: 'failed', error });
      continue;
    }
    const contentRes = await moyiFetch(base, token, '/drive-bridge/content', {
      item_id: itemId, content_base64: f.buffer.toString('base64'), mime: XLSX_MIME,
    });
    if (!contentRes.ok) {
      const error = truncate(`MOYI 업로드 실패 (${contentRes.status}): ${contentRes.text}`);
      await logPush({ orderYear, major: f.major, fileName: f.fileName, actor, state: 'failed', sizeBytes: f.buffer.length, sha256: f.sha256, responseStatus: contentRes.status, responseText: contentRes.text, errorText: error });
      results.push({ major: f.major, state: 'failed', error });
      continue;
    }
    await logPush({
      orderYear, major: f.major, fileName: f.fileName, actor, state: 'sent',
      sizeBytes: f.buffer.length, sha256: f.sha256, responseStatus: contentRes.status,
      responseText: contentRes.text, remoteFileId: contentRes.json?.file_id,
    });
    results.push({ major: f.major, state: 'sent', fileName: f.fileName, sizeBytes: f.buffer.length, sha256: f.sha256, remoteFileId: contentRes.json?.file_id || null });
  }

  const sent = results.filter(r => r.state === 'sent').length;
  const failed = results.filter(r => r.state === 'failed').length;
  return res.status(failed && !sent ? 502 : 200).json({
    success: failed === 0,
    orderYear,
    folder: REPORT_FOLDER,
    sent,
    failed,
    results: results.sort((a, b) => String(a.major).localeCompare(String(b.major))),
  });
}

export default withAuth(async function handler(req, res) {
  try {
    await query(TABLE_SQL);
    if (req.method === 'POST') return await syncReports(req, res);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[moyi/drive-report-sync]', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
