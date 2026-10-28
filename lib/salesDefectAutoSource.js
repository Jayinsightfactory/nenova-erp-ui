export const AUTO_SOURCE_PREFIX = 'kakao-defect:';
export const AUTO_SOURCE_REVIEW_REQUIRED = 'AUTO_SOURCE_REVIEW_REQUIRED';
export const AUTO_SOURCE_ESTIMATE_CONFLICT = 'AUTO_SOURCE_ESTIMATE_CONFLICT';
export const AUTO_SOURCE_REVIEW_MESSAGE = '자동수집 자료 · 별도 검토 필요 · 일괄등록 제외';
export const AUTO_SOURCE_ESTIMATE_CONFLICT_MESSAGE = '자동수집 원장에 연결된 기존 견적과 중복됩니다. 별도 검토하세요.';

const text = (value) => String(value ?? '').trim();

export function defectSourceReview(row = {}) {
  if (Boolean(row.MissingLinkedEstimate ?? row.missingLinkedEstimate)) {
    return { code: 'LINKED_ESTIMATE_MISSING', error: '같은 업체·품목에 연결된 유효한 견적이 없습니다. 삭제 이력·원문을 확인해야 하며 자동 재등록할 수 없습니다.' };
  }
  if (Boolean(row.RejectedAutoSource ?? row.rejectedAutoSource)) {
    return { code: 'REJECTED_AUTO_SOURCE', error: '과거 견적 등록이 해제된 자동수집 자료입니다. 원문 재확인 전 등록에서 제외합니다.' };
  }
  return null;
}

export function assertDefectSourceReviewed(row = {}) {
  const review = defectSourceReview(row);
  if (review) { const error = new Error(review.error); error.code = review.code; throw error; }
}

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
                 WHEN ${history} THEN N'HISTORY_SOURCE' ELSE N'' END AS AutoSourceEvidence,
            CASE WHEN ${a}.EstimateKey IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM Estimate linkedActual
              JOIN ShipmentMaster actualMaster ON actualMaster.ShipmentKey=linkedActual.ShipmentKey
              WHERE linkedActual.EstimateKey=${a}.EstimateKey AND linkedActual.ProdKey=${a}.ProdKey
                AND linkedActual.Quantity<0 AND actualMaster.CustKey=${a}.CustKey AND ISNULL(actualMaster.isDeleted,0)=0
            ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS MissingLinkedEstimate,
            CASE WHEN ${predicate} AND EXISTS (
              SELECT 1 FROM WebSalesDefectDeductionHistory rejectedHistory
              WHERE rejectedHistory.DeductionKey=${a}.DeductionKey AND rejectedHistory.ActionType=N'ESTIMATE_UNLINK'
            ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS RejectedAutoSource`;
  return { current, history, predicate, projection };
}
