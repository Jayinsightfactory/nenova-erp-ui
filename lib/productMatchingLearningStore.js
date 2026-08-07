import { query, sql } from './db.js';
import { calculateMatchingMetrics, PRODUCT_MATCH_MODEL_VERSION } from './naturalLanguageProductMatching.js';
import { loadMappings } from './parseMappings.js';

let ensurePromise = null;
export async function ensureProductMatchingLearningTables() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(`
    IF OBJECT_ID(N'dbo.WebProductMatchEvent', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebProductMatchEvent (
        MatchEventKey BIGINT IDENTITY(1,1) PRIMARY KEY,
        TenantKey NVARCHAR(100) NOT NULL, OrderYear INT NULL, OrderWeek NVARCHAR(10) NULL, CustKey INT NULL,
        SourceChannel NVARCHAR(50) NOT NULL DEFAULT N'', QueryHash VARBINARY(32) NOT NULL,
        QueryPreview NVARCHAR(120) NOT NULL DEFAULT N'', CountryName NVARCHAR(100) NOT NULL DEFAULT N'',
        FlowerName NVARCHAR(100) NOT NULL DEFAULT N'', ColorName NVARCHAR(200) NOT NULL DEFAULT N'', Unit NVARCHAR(30) NOT NULL DEFAULT N'',
        EventType NVARCHAR(40) NOT NULL, CandidateProdKeysJson NVARCHAR(MAX) NOT NULL DEFAULT N'[]',
        CandidateScoresJson NVARCHAR(MAX) NOT NULL DEFAULT N'[]', SelectedProdKey INT NULL, ReplacedProdKey INT NULL,
        ConfirmedByUser BIT NOT NULL DEFAULT 0, AutoSelected BIT NOT NULL DEFAULT 0,
        ModelVersion NVARCHAR(50) NOT NULL, RuleVersion NVARCHAR(50) NOT NULL,
        ActorId NVARCHAR(100) NOT NULL DEFAULT N'', CreatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_WebProductMatchEvent_Scope ON dbo.WebProductMatchEvent(TenantKey,OrderYear,OrderWeek,CustKey,CreatedAt DESC);
      CREATE INDEX IX_WebProductMatchEvent_Metrics ON dbo.WebProductMatchEvent(ConfirmedByUser,EventType,CreatedAt DESC);
    END;
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'SourceChannel') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD SourceChannel NVARCHAR(50) NOT NULL CONSTRAINT DF_WebProductMatchEvent_Source DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'CountryName') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD CountryName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebProductMatchEvent_Country DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'FlowerName') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD FlowerName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebProductMatchEvent_Flower DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'ColorName') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD ColorName NVARCHAR(200) NOT NULL CONSTRAINT DF_WebProductMatchEvent_Color DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'CandidateScoresJson') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD CandidateScoresJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_WebProductMatchEvent_Scores DEFAULT N'[]';
    IF COL_LENGTH(N'dbo.WebProductMatchEvent', N'AutoSelected') IS NULL ALTER TABLE dbo.WebProductMatchEvent ADD AutoSelected BIT NOT NULL CONSTRAINT DF_WebProductMatchEvent_Auto DEFAULT 0;
  `).catch((error) => { ensurePromise = null; throw error; });
  return ensurePromise;
}

function safeText(value, max) { return String(value || '').trim().slice(0, max); }
function safeKeys(values, max = 40) { return (Array.isArray(values) ? values : []).map(Number).filter((v) => v > 0).slice(0, max); }
function safeScores(values, max = 40) { return (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).map((v) => Math.max(0, Math.min(1, v))).slice(0, max); }
function queryPreview(value) {
  // 전화번호·긴 숫자·이메일을 제거하고 품목 표현 일부만 보존한다.
  return safeText(value, 300).replace(/[\w.+-]+@[\w.-]+/g, '[email]').replace(/\b\d{4,}\b/g, '[number]').slice(0, 120);
}

export async function recordProductMatchEvent(payload = {}, user = {}) {
  await ensureProductMatchingLearningTables();
  const eventType = safeText(payload.eventType, 40).toUpperCase();
  if (!['CANDIDATES_SHOWN', 'CANDIDATE_SELECTED', 'SELECTION_CONFIRMED', 'SELECTION_REPLACED', 'SELECTION_CANCELLED'].includes(eventType)) throw new Error('지원하지 않는 품목 매칭 이벤트입니다.');
  const rawQuery = safeText(payload.query, 500);
  const candidateProdKeys = safeKeys(payload.candidateProdKeys);
  const candidateScores = safeScores(payload.candidateScores);
  const confirmed = eventType === 'SELECTION_CONFIRMED' && payload.confirmedByUser === true;
  // 자동선택은 confirmed 플래그를 받을 수 없고 학습 정답 집계에서 제외된다.
  const autoSelected = payload.autoSelected === true;
  const confirmedByUser = confirmed && !autoSelected;
  if (confirmedByUser && (!Number(payload.orderYear) || !safeText(payload.orderWeek, 10) || !Number(payload.custKey) || !Number(payload.selectedProdKey))) {
    throw new Error('학습 정답은 연도·차수·거래처·선택 품목 범위가 모두 필요합니다.');
  }
  const result = await query(`
    INSERT INTO dbo.WebProductMatchEvent
      (TenantKey,OrderYear,OrderWeek,CustKey,SourceChannel,QueryHash,QueryPreview,CountryName,FlowerName,ColorName,Unit,
       EventType,CandidateProdKeysJson,CandidateScoresJson,SelectedProdKey,ReplacedProdKey,ConfirmedByUser,AutoSelected,ModelVersion,RuleVersion,ActorId)
    OUTPUT INSERTED.MatchEventKey
    VALUES (@tenant,@year,@week,@cust,@channel,HASHBYTES('SHA2_256',@hashInput),@preview,@country,@flower,@color,@unit,
      @event,@keys,@scores,@selected,@replaced,@confirmed,@auto,@model,@rule,@actor)`, {
    tenant: { type: sql.NVarChar, value: safeText(payload.tenantKey || user.tenantKey || 'nenova', 100) },
    year: { type: sql.Int, value: Number(payload.orderYear) || null }, week: { type: sql.NVarChar, value: safeText(payload.orderWeek, 10) || null },
    cust: { type: sql.Int, value: Number(payload.custKey) || null }, channel: { type: sql.NVarChar, value: safeText(payload.sourceChannel, 50) },
    hashInput: { type: sql.NVarChar, value: `${safeText(payload.tenantKey || user.tenantKey || 'nenova', 100)}|${rawQuery}` },
    preview: { type: sql.NVarChar, value: queryPreview(rawQuery) }, country: { type: sql.NVarChar, value: safeText(payload.country, 100) },
    flower: { type: sql.NVarChar, value: safeText(payload.flower, 100) }, color: { type: sql.NVarChar, value: safeText(payload.color, 200) },
    unit: { type: sql.NVarChar, value: safeText(payload.unit, 30) }, event: { type: sql.NVarChar, value: eventType },
    keys: { type: sql.NVarChar, value: JSON.stringify(candidateProdKeys) }, scores: { type: sql.NVarChar, value: JSON.stringify(candidateScores) },
    selected: { type: sql.Int, value: Number(payload.selectedProdKey) || null }, replaced: { type: sql.Int, value: Number(payload.replacedProdKey) || null },
    confirmed: { type: sql.Bit, value: confirmedByUser }, auto: { type: sql.Bit, value: autoSelected },
    model: { type: sql.NVarChar, value: safeText(payload.modelVersion || PRODUCT_MATCH_MODEL_VERSION, 50) },
    rule: { type: sql.NVarChar, value: safeText(payload.ruleVersion || 'rules-v1', 50) },
    actor: { type: sql.NVarChar, value: safeText(user.userId || user.id || '', 100) },
  });
  return { eventKey: Number(result.recordset[0]?.MatchEventKey), confirmedByUser, trainingEligible: confirmedByUser && !autoSelected };
}

function parseJsonArray(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
export async function loadProductMatchingMetrics({ days = 90, minGroupSize = 20, tenantKey = 'nenova' } = {}) {
  await ensureProductMatchingLearningTables();
  const result = await query(`
    SELECT EventType,CandidateProdKeysJson,CandidateScoresJson,SelectedProdKey,ConfirmedByUser,AutoSelected,CountryName,FlowerName,ColorName,Unit,
           CONVERT(NVARCHAR(30),CustKey) AS CustomerGroup,CreatedAt
     FROM dbo.WebProductMatchEvent
     WHERE CreatedAt >= DATEADD(day,-@days,SYSUTCDATETIME())
       AND TenantKey=@tenant
       AND EventType=N'SELECTION_CONFIRMED'`, {
    days: { type: sql.Int, value: Math.max(7, Math.min(365, Number(days) || 90)) },
    tenant: { type: sql.NVarChar, value: safeText(tenantKey, 100) || 'nenova' },
  });
  const events = result.recordset.map((row) => ({ confirmed: row.ConfirmedByUser === true, autoSelected: row.AutoSelected === true,
    candidateProdKeys: parseJsonArray(row.CandidateProdKeysJson), candidateScores: parseJsonArray(row.CandidateScoresJson), selectedProdKey: Number(row.SelectedProdKey),
    country: row.CountryName || '미지정', flower: row.FlowerName || '미지정', color: row.ColorName || '미지정', unit: row.Unit || '미지정', customerGroup: row.CustomerGroup || '미지정', createdAt: row.CreatedAt }));
  const metrics = calculateMatchingMetrics(events, { minGroupSize });
  const evidenceResult = await query(`
    SELECT SourceName,EvidenceCount FROM (
      SELECT N'learning-events' AS SourceName, COUNT_BIG(*) AS EvidenceCount FROM dbo.WebProductMatchEvent
       WHERE CreatedAt >= DATEADD(day,-@days,SYSUTCDATETIME()) AND TenantKey=@tenant
      UNION ALL
      SELECT N'defect-corrections', COUNT_BIG(*) FROM dbo.WebSalesDefectDeductionHistory
       WHERE ChangedAt >= DATEADD(day,-@days,GETDATE()) AND (ActionType LIKE N'%MATCH%' OR ChangeSummary LIKE N'%매칭%')
      UNION ALL
      SELECT N'erp-action-history', COUNT_BIG(*) FROM dbo.SystemActionLog
       WHERE CreatedAt >= DATEADD(day,-@days,GETDATE()) AND (ActionType LIKE N'%ORDER%' OR ActionType LIKE N'%ESTIMATE%' OR ActionType LIKE N'%SHIPMENT%')
    ) e`, {
    days: { type: sql.Int, value: Math.max(7, Math.min(365, Number(days) || 90)) },
    tenant: { type: sql.NVarChar, value: safeText(tenantKey, 100) || 'nenova' },
  });
  const evidence = Object.fromEntries(evidenceResult.recordset.map((row) => [row.SourceName, Number(row.EvidenceCount || 0)]));
  evidence['saved-paste-mappings'] = Object.keys(loadMappings() || {}).length;
  return { ...metrics, evidence, evidencePolicy: '확인된 사용자 선택만 accuracy/alias 승격에 사용; 카카오·붙여넣기·ERP 이력은 후보 근거와 회귀셋 소스로만 사용' };
}
