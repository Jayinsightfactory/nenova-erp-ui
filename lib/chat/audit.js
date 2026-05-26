// lib/chat/audit.js - chatbot conversation audit log
import { query, sql } from '../db';

let ensured = false;
let ensuring = null;

async function ensureTable() {
  if (ensured) return;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='_chat_audit' AND xtype='U')
      CREATE TABLE _chat_audit (
        AuditKey INT IDENTITY(1,1) PRIMARY KEY,
        UserID NVARCHAR(100) NULL,
        UserName NVARCHAR(100) NULL,
        UserMessage NVARCHAR(MAX) NULL,
        PayloadJson NVARCHAR(MAX) NULL,
        ClientHistoryCount INT NOT NULL DEFAULT 0,
        BotText NVARCHAR(MAX) NULL,
        ResponseJson NVARCHAR(MAX) NULL,
        DebugJson NVARCHAR(MAX) NULL,
        RouteFlags NVARCHAR(500) NULL,
        RiskFlags NVARCHAR(1000) NULL,
        Success BIT NOT NULL DEFAULT 1,
        ErrorMessage NVARCHAR(MAX) NULL,
        DurationMs INT NULL,
        CreateDtm DATETIME NOT NULL DEFAULT GETDATE()
      )
    `);
    await query(`
      IF COL_LENGTH('_chat_audit', 'ClientHistoryCount') IS NULL
        ALTER TABLE _chat_audit ADD ClientHistoryCount INT NOT NULL CONSTRAINT DF_chat_audit_ClientHistoryCount DEFAULT 0
      IF COL_LENGTH('_chat_audit', 'DebugJson') IS NULL
        ALTER TABLE _chat_audit ADD DebugJson NVARCHAR(MAX) NULL
      IF COL_LENGTH('_chat_audit', 'RouteFlags') IS NULL
        ALTER TABLE _chat_audit ADD RouteFlags NVARCHAR(500) NULL
      IF COL_LENGTH('_chat_audit', 'RiskFlags') IS NULL
        ALTER TABLE _chat_audit ADD RiskFlags NVARCHAR(1000) NULL
      IF COL_LENGTH('_chat_audit', 'Success') IS NULL
        ALTER TABLE _chat_audit ADD Success BIT NOT NULL CONSTRAINT DF_chat_audit_Success DEFAULT 1
      IF COL_LENGTH('_chat_audit', 'ErrorMessage') IS NULL
        ALTER TABLE _chat_audit ADD ErrorMessage NVARCHAR(MAX) NULL
      IF COL_LENGTH('_chat_audit', 'DurationMs') IS NULL
        ALTER TABLE _chat_audit ADD DurationMs INT NULL
      IF COL_LENGTH('_chat_audit', 'CreateDtm') IS NULL
        ALTER TABLE _chat_audit ADD CreateDtm DATETIME NOT NULL CONSTRAINT DF_chat_audit_CreateDtm DEFAULT GETDATE()
    `);
    ensured = true;
  })();
  try {
    return await ensuring;
  } finally {
    ensuring = null;
  }
}

export async function ensureChatAuditTable() {
  return ensureTable();
}

function safeJson(value, max = 4000) {
  if (value == null) return '';
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return '';
  }
}

export function flattenMessages(messages = []) {
  const parts = [];
  for (const m of messages || []) {
    if (m.type === 'text' && m.content) {
      parts.push(m.content);
    } else if (m.type === 'card' && m.card) {
      const c = m.card;
      const rowsStr = (c.rows || []).slice(0, 20)
        .map(r => `${r.label}: ${r.value}`).join(', ');
      parts.push(`[${c.title || 'card'}${c.subtitle ? ` - ${c.subtitle}` : ''}] ${rowsStr}${c.footer ? ` (${c.footer})` : ''}`);
    } else if (m.type === 'cards' && Array.isArray(m.cards)) {
      for (const c of m.cards) {
        const rowsStr = (c.rows || []).slice(0, 10)
          .map(r => `${r.label}: ${r.value}`).join(', ');
        parts.push(`[${c.title || 'card'}] ${rowsStr}`);
      }
    } else if (m.type === 'actions' && Array.isArray(m.actions)) {
      parts.push(`[actions] ${m.actions.map(a => a.label || a.text).filter(Boolean).join(', ')}`);
    } else if (m.type === 'choices' && Array.isArray(m.choices)) {
      parts.push(`[choices] ${m.choices.map(c => c.label || c.text).filter(Boolean).join(', ')}`);
    }
  }
  return parts.join('\n').slice(0, 2000);
}

export function analyzeChatResult(result, err = null) {
  const routeFlags = [];
  const riskFlags = [];
  const debug = result?._debug || null;
  const sqlText = String(debug?.sql || '');
  const messages = result?.messages || [];

  if (debug?.sql) routeFlags.push('LLM_SQL');
  if (result?._askback) routeFlags.push('ASKBACK');
  if (result?._contextFollowup) routeFlags.push('CONTEXT_FOLLOWUP');
  if (result?._investigative) routeFlags.push('INVESTIGATIVE');
  if (!debug?.sql && !result?._askback && !result?._contextFollowup && !result?._investigative) {
    routeFlags.push('RULE_HANDLER');
  }

  if (err) riskFlags.push('ERROR');
  if (!messages.length) riskFlags.push('EMPTY_RESPONSE');
  if (debug?.sql) {
    if (!/^\s*(SELECT|WITH)\b/i.test(sqlText)) riskFlags.push('NON_SELECT_SQL');
    if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|MERGE|EXEC|EXECUTE)\b/i.test(sqlText)) {
      riskFlags.push('DANGEROUS_SQL_TOKEN');
    }
    if (!/\bTOP\s+\d+/i.test(sqlText) && !/^\s*SELECT\s+(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sqlText)) {
      riskFlags.push('NO_TOP_LIMIT');
    }
  }
  const text = flattenMessages(messages);
  if (/잘 모르|찾을 수 없|이해하지 못|확인.*필요|조건.*부족/.test(text)) {
    riskFlags.push('UNCERTAIN_ANSWER');
  }
  if ((debug?.rowCount || 0) >= 100) riskFlags.push('LARGE_RESULT');

  return {
    routeFlags: routeFlags.join(','),
    riskFlags: riskFlags.join(','),
    debugJson: safeJson(debug, 4000),
  };
}

export async function logChatAudit({ user, userMessage, payload, clientHistory, result, error, durationMs }) {
  try {
    await ensureTable();
    const analysis = analyzeChatResult(result, error);
    await query(
      `INSERT INTO _chat_audit
         (UserID, UserName, UserMessage, PayloadJson, ClientHistoryCount, BotText,
          ResponseJson, DebugJson, RouteFlags, RiskFlags, Success, ErrorMessage, DurationMs)
       VALUES
         (@uid, @uname, @msg, @payload, @histCount, @botText,
          @response, @debug, @routeFlags, @riskFlags, @success, @error, @duration)`,
      {
        uid: { type: sql.NVarChar, value: user?.userId || '' },
        uname: { type: sql.NVarChar, value: user?.userName || '' },
        msg: { type: sql.NVarChar, value: String(userMessage || '').slice(0, 4000) },
        payload: { type: sql.NVarChar, value: safeJson(payload, 4000) },
        histCount: { type: sql.Int, value: Array.isArray(clientHistory) ? clientHistory.length : 0 },
        botText: { type: sql.NVarChar, value: flattenMessages(result?.messages || []) },
        response: { type: sql.NVarChar, value: safeJson(result, 8000) },
        debug: { type: sql.NVarChar, value: analysis.debugJson },
        routeFlags: { type: sql.NVarChar, value: analysis.routeFlags },
        riskFlags: { type: sql.NVarChar, value: analysis.riskFlags },
        success: { type: sql.Bit, value: error ? 0 : 1 },
        error: { type: sql.NVarChar, value: error?.message || '' },
        duration: { type: sql.Int, value: Number(durationMs) || 0 },
      }
    );
  } catch (e) {
    console.warn('[chat-audit] log failed:', e.message);
  }
}
