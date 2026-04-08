// lib/withActionLog.js
// 모든 쓰기 API에 감싸는 미들웨어 — SystemActionLog에 자동 기록
// 사용법: export default withAuth(withActionLog(handler, { actionType, riskLevel }))
//         또는: export default withActionLog(withAuth(handler), { ... })

import { query, sql } from './db';

// ── DB 테이블 자동 생성
async function ensureTable() {
  await query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='SystemActionLog' AND xtype='U')
    CREATE TABLE SystemActionLog (
      LogKey        INT IDENTITY PRIMARY KEY,
      ActionDtm     DATETIME DEFAULT GETDATE(),
      Actor         NVARCHAR(100),      -- userId 또는 'claude:세션ID' 또는 'unknown'
      SessionId     NVARCHAR(200),      -- JWT sub or X-Claude-Session header
      ActionType    NVARCHAR(50),       -- ECOUNT_PUSH, DB_WRITE, DATA_DELETE, API_CALL 등
      Method        NVARCHAR(10),       -- GET/POST/PUT/DELETE/PATCH
      Endpoint      NVARCHAR(300),      -- /api/ecount/sales-push 등
      AffectedTable NVARCHAR(100),      -- 영향받은 DB 테이블
      AffectedCount INT DEFAULT 0,      -- 영향받은 레코드 수
      Payload       NVARCHAR(MAX),      -- 요청 body (최대 4000자)
      Result        NVARCHAR(20),       -- SUCCESS / FAIL / ERROR
      ResultDesc    NVARCHAR(1000),     -- 결과 상세
      RiskLevel     NVARCHAR(20),       -- LOW / MEDIUM / HIGH / CRITICAL
      IpAddress     NVARCHAR(50),
      UserAgent     NVARCHAR(500)
    )
  `);
}

// ── 엔드포인트별 위험도·타입 자동 판별
function detectRisk(endpoint, method, body) {
  const ep = (endpoint || '').toLowerCase();
  const m  = (method  || '').toUpperCase();

  // CRITICAL
  if (ep.includes('ecount/sales-push'))     return { risk: 'CRITICAL', type: 'ECOUNT_PUSH',     table: 'EcountSyncLog+Ecount외부' };
  if (ep.includes('ecount/purchase-push'))  return { risk: 'CRITICAL', type: 'ECOUNT_PUSH',     table: 'EcountSyncLog+Ecount외부' };
  if (ep.includes('ecount/customers-sync')) return { risk: 'HIGH',     type: 'ECOUNT_SYNC',     table: 'Customer+Ecount외부' };

  // HIGH
  if (m === 'DELETE')                        return { risk: 'HIGH',     type: 'DATA_DELETE',     table: '?' };
  if (ep.includes('estimate') && m === 'POST') return { risk: 'HIGH',  type: 'ESTIMATE_WRITE',  table: 'Estimate' };
  if (ep.includes('sales/ar') && m === 'POST') return { risk: 'HIGH',  type: 'AR_WRITE',        table: 'ReceivableLedger' };
  if (ep.includes('shipment') && m === 'POST') return { risk: 'HIGH',  type: 'SHIPMENT_WRITE',  table: 'ShipmentMaster/Detail' };

  // MEDIUM
  if (ep.includes('master/products') && m === 'POST') return { risk: 'MEDIUM', type: 'PRODUCT_WRITE', table: 'Product' };
  if (ep.includes('master/customers') && m === 'POST') return { risk: 'MEDIUM', type: 'CUSTOMER_WRITE', table: 'Customer' };
  if (ep.includes('purchase') && m === 'POST') return { risk: 'MEDIUM', type: 'PURCHASE_WRITE',  table: 'ImportOrder' };
  if (ep.includes('ecount/session') && m === 'POST')   return { risk: 'MEDIUM', type: 'ECOUNT_SESSION', table: '-' };

  // LOW
  if (m === 'GET') return { risk: 'LOW', type: 'READ', table: '-' };
  return           { risk: 'LOW', type: 'API_CALL', table: '-' };
}

// ── 배치 규모에 따라 위험도 상향
function escalateRisk(base, count) {
  if (count >= 100) {
    if (base === 'LOW' || base === 'MEDIUM') return 'HIGH';
    if (base === 'HIGH') return 'CRITICAL';
  }
  if (count >= 10 && base === 'LOW') return 'MEDIUM';
  return base;
}

// ── 로그 기록 (오류 발생 시 무시 — 로깅 실패가 서비스를 막으면 안됨)
async function writeLog(data) {
  try {
    await ensureTable();
    await query(
      `INSERT INTO SystemActionLog
        (Actor, SessionId, ActionType, Method, Endpoint, AffectedTable, AffectedCount,
         Payload, Result, ResultDesc, RiskLevel, IpAddress, UserAgent)
       VALUES
        (@actor, @sessionId, @actionType, @method, @endpoint, @affectedTable, @affectedCount,
         @payload, @result, @resultDesc, @riskLevel, @ip, @ua)`,
      {
        actor:         { type: sql.NVarChar, value: (data.actor        || 'unknown').slice(0, 100) },
        sessionId:     { type: sql.NVarChar, value: (data.sessionId    || '').slice(0, 200) },
        actionType:    { type: sql.NVarChar, value: (data.actionType   || 'API_CALL').slice(0, 50) },
        method:        { type: sql.NVarChar, value: (data.method       || '').slice(0, 10) },
        endpoint:      { type: sql.NVarChar, value: (data.endpoint     || '').slice(0, 300) },
        affectedTable: { type: sql.NVarChar, value: (data.affectedTable|| '').slice(0, 100) },
        affectedCount: { type: sql.Int,      value: data.affectedCount || 0 },
        payload:       { type: sql.NVarChar, value: (data.payload      || '').slice(0, 4000) },
        result:        { type: sql.NVarChar, value: (data.result       || 'SUCCESS').slice(0, 20) },
        resultDesc:    { type: sql.NVarChar, value: (data.resultDesc   || '').slice(0, 1000) },
        riskLevel:     { type: sql.NVarChar, value: (data.riskLevel    || 'LOW').slice(0, 20) },
        ip:            { type: sql.NVarChar, value: (data.ip           || '').slice(0, 50) },
        ua:            { type: sql.NVarChar, value: (data.ua           || '').slice(0, 500) },
      }
    );
  } catch (e) {
    console.error('[withActionLog] 로그 기록 실패:', e.message);
  }
}

// ── 메인 미들웨어
export function withActionLog(handler, opts = {}) {
  return async (req, res) => {
    const method   = req.method || '';
    const endpoint = req.url    || '';

    // GET은 기본적으로 기록 안함 (opts.logGet=true 시 기록)
    const shouldLog = method !== 'GET' || opts.logGet;
    if (!shouldLog) return handler(req, res);

    // Actor 판별
    const claudeSession = req.headers['x-claude-session'] || '';
    const userId = req.user?.userId || req.user?.userName || '';
    const actor  = claudeSession
      ? `claude:${claudeSession.slice(0, 50)}`
      : userId || 'unknown';

    // 위험도/타입 자동 판별
    const body    = req.body || {};
    const { risk: baseRisk, type: actionType, table: affectedTable } =
      detectRisk(endpoint, method, body);

    // 페이로드 직렬화
    let payloadStr = '';
    try { payloadStr = JSON.stringify(body); } catch (_) { payloadStr = String(body); }

    // IP / UA
    const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const ua = (req.headers['user-agent'] || '').slice(0, 500);

    // 응답 가로채기 — 결과 확인 후 로깅
    const originalJson = res.json.bind(res);
    let capturedResult = 'SUCCESS';
    let capturedDesc   = '';
    let affectedCount  = opts.affectedCount || 0;

    res.json = (data) => {
      try {
        if (data?.success === false || data?.error) {
          capturedResult = 'FAIL';
          capturedDesc   = (data.error || '').slice(0, 1000);
        } else {
          capturedResult = 'SUCCESS';
          // 결과에서 건수 추출 시도
          affectedCount = data?.pushed || data?.count || data?.affected ||
                          data?.saved  || data?.total  || affectedCount;
        }
      } catch (_) {}
      return originalJson(data);
    };

    let errorOccurred = false;
    try {
      await handler(req, res);
    } catch (err) {
      errorOccurred  = true;
      capturedResult = 'ERROR';
      capturedDesc   = err.message || '';
      throw err;
    } finally {
      const finalRisk = escalateRisk(opts.riskLevel || baseRisk, affectedCount);
      await writeLog({
        actor,
        sessionId:     claudeSession || userId,
        actionType:    opts.actionType || actionType,
        method,
        endpoint,
        affectedTable: opts.affectedTable || affectedTable,
        affectedCount,
        payload:       payloadStr,
        result:        errorOccurred ? 'ERROR' : capturedResult,
        resultDesc:    capturedDesc,
        riskLevel:     finalRisk,
        ip,
        ua,
      });
    }
  };
}

// ── Claude가 직접 호출 시 사용하는 명시적 로그 함수
// 예: await logClaudeAction(req, { actionType: 'ECOUNT_PUSH', desc: '판매전송 471건', count: 471 })
export async function logClaudeAction(req, opts = {}) {
  const claudeSession = req?.headers?.['x-claude-session'] || 'direct';
  await writeLog({
    actor:         `claude:${claudeSession}`,
    sessionId:     claudeSession,
    actionType:    opts.actionType || 'CLAUDE_ACTION',
    method:        opts.method     || 'POST',
    endpoint:      opts.endpoint   || 'direct',
    affectedTable: opts.affectedTable || '',
    affectedCount: opts.count      || 0,
    payload:       opts.payload    || '',
    result:        opts.result     || 'SUCCESS',
    resultDesc:    opts.desc       || '',
    riskLevel:     opts.riskLevel  || 'HIGH',
    ip:            '',
    ua:            'Claude-Agent',
  });
}
