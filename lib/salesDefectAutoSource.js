export const AUTO_SOURCE_PREFIX = 'kakao-defect:';
export const AUTO_SOURCE_REVIEW_REQUIRED = 'AUTO_SOURCE_REVIEW_REQUIRED';
export const AUTO_SOURCE_ESTIMATE_CONFLICT = 'AUTO_SOURCE_ESTIMATE_CONFLICT';
export const AUTO_SOURCE_REVIEW_MESSAGE = '자동수집 자료 · 별도 검토 필요 · 일괄등록 제외';
export const AUTO_SOURCE_ESTIMATE_CONFLICT_MESSAGE = '자동수집 원장에 연결된 기존 견적과 중복됩니다. 별도 검토하세요.';

const text = (value) => String(value ?? '').trim();

export function hasKakaoDefectMarker(value) {
  return text(value).toLowerCase().startsWith(AUTO_SOURCE_PREFIX);
}

export function parseAutoSourceHistoryJson(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readSourceFields(value) {
  if (!value || typeof value !== 'object') return [];
  const entries = Object.entries(value);
  return entries
    .filter(([key]) => ['sourcefilename', 'note'].includes(String(key).toLowerCase()))
    .map(([, fieldValue]) => fieldValue);
}

export function detectDefectAutoSource({ row = {}, histories = [] } = {}) {
  const currentValues = [
    row.SourceFileName ?? row.sourceFileName,
    row.Note ?? row.note,
  ];
  if (currentValues.some(hasKakaoDefectMarker)) {
    return { excluded: true, evidence: 'KAKAO_SOURCE', code: AUTO_SOURCE_REVIEW_REQUIRED, message: AUTO_SOURCE_REVIEW_MESSAGE };
  }
  for (const history of histories || []) {
    for (const raw of [history?.BeforeJson ?? history?.beforeJson, history?.AfterJson ?? history?.afterJson]) {
      const parsed = parseAutoSourceHistoryJson(raw);
      if (readSourceFields(parsed).some(hasKakaoDefectMarker)) {
        return { excluded: true, evidence: 'HISTORY_SOURCE', code: AUTO_SOURCE_REVIEW_REQUIRED, message: AUTO_SOURCE_REVIEW_MESSAGE };
      }
    }
  }
  return { excluded: false, evidence: '', code: '', message: '' };
}

export function autoSourceStateFromRow(row = {}) {
  const current = detectDefectAutoSource({ row });
  if (current.excluded) return current;
  if (row.AutoSourceExcluded != null || row.autoSourceExcluded != null) {
    const excluded = Boolean(row.AutoSourceExcluded) || Boolean(row.autoSourceExcluded);
    return {
      excluded,
      evidence: excluded ? String(row.AutoSourceEvidence || row.autoSourceEvidence || 'KAKAO_SOURCE') : '',
      code: excluded ? AUTO_SOURCE_REVIEW_REQUIRED : '',
      message: excluded ? AUTO_SOURCE_REVIEW_MESSAGE : '',
    };
  }
  return current;
}

export function assertNotDefectAutoSource(row = {}) {
  const state = autoSourceStateFromRow(row);
  if (!state.excluded) return true;
  const error = new Error(AUTO_SOURCE_REVIEW_MESSAGE);
  error.code = AUTO_SOURCE_REVIEW_REQUIRED;
  error.statusCode = 409;
  error.autoSourceEvidence = state.evidence;
  throw error;
}

function assertSqlAlias(alias) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(alias || ''))) throw new Error('SQL alias is invalid.');
  return alias;
}

export function buildDefectAutoSourceSql(alias = 'd') {
  const a = assertSqlAlias(alias);
  const prefix = "N'kakao-defect:%'";
  const current = `(LOWER(LTRIM(ISNULL(${a}.SourceFileName,N''))) LIKE ${prefix}
        OR LOWER(LTRIM(ISNULL(${a}.Note,N''))) LIKE ${prefix})`;
  const history = `EXISTS (
        SELECT 1
          FROM WebSalesDefectDeductionHistory autoHistory
         WHERE autoHistory.DeductionKey=${a}.DeductionKey
           AND (
             LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.BeforeJson)=1 THEN autoHistory.BeforeJson ELSE N'{}' END,N'$.sourceFileName'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.BeforeJson)=1 THEN autoHistory.BeforeJson ELSE N'{}' END,N'$.SourceFileName'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.BeforeJson)=1 THEN autoHistory.BeforeJson ELSE N'{}' END,N'$.note'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.BeforeJson)=1 THEN autoHistory.BeforeJson ELSE N'{}' END,N'$.Note'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.AfterJson)=1 THEN autoHistory.AfterJson ELSE N'{}' END,N'$.sourceFileName'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.AfterJson)=1 THEN autoHistory.AfterJson ELSE N'{}' END,N'$.SourceFileName'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.AfterJson)=1 THEN autoHistory.AfterJson ELSE N'{}' END,N'$.note'),N''))) LIKE ${prefix}
             OR LOWER(LTRIM(ISNULL(JSON_VALUE(CASE WHEN ISJSON(autoHistory.AfterJson)=1 THEN autoHistory.AfterJson ELSE N'{}' END,N'$.Note'),N''))) LIKE ${prefix}
           )
      )`;
  const predicate = `(${current} OR ${history})`;
  const projection = `CASE WHEN ${predicate} THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS AutoSourceExcluded,
            CASE WHEN ${current} THEN N'KAKAO_SOURCE'
                 WHEN ${history} THEN N'HISTORY_SOURCE' ELSE N'' END AS AutoSourceEvidence`;
  return { current, history, predicate, projection };
}
