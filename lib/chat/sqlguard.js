// lib/chat/sqlguard.js — LLM 생성 SQL 검증기
//
// 필수: 읽기 전용. SELECT 외 모두 거부.
// TOP 100 미만이 아니면 강제 삽입.

const DANGEROUS_PATTERNS = [
  /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|BACKUP|RESTORE|SHUTDOWN)\b/i,
  /\b(sp_|xp_|fn_msxxxxxx)/i,            // 시스템 프로시저
  /--[^\n]*?\b(DROP|DELETE|UPDATE)/i,    // 주석 우회
  /;\s*\w/,                              // 세미콜론 뒤 추가 문장 (문장 체이닝)
  /\bINTO\s+\w/i,                        // SELECT ... INTO (테이블 생성)
  /\bOPENROWSET|OPENQUERY|OPENDATASOURCE/i,
  /\bWAITFOR\b/i,
  /\bDBCC\b/i,
];

export function validateSql(rawSql) {
  if (!rawSql || typeof rawSql !== 'string') {
    return { ok: false, reason: 'empty sql' };
  }

  // 마크다운 코드 블록 제거
  let sql = rawSql.trim()
    .replace(/^```[a-zA-Z]*\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  // 세미콜론 여러 개 또는 끝 세미콜론 처리
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trim();

  // 반드시 SELECT or WITH (CTE) 로 시작
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    return { ok: false, reason: 'SELECT 또는 WITH(CTE) 만 허용됩니다.' };
  }

  // 위험 패턴 거부
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.test(sql)) {
      return { ok: false, reason: `금지된 패턴: ${pat}` };
    }
  }

  // 세미콜론이 여러 개면 거부 (배치 실행 방지)
  const semiCount = (sql.match(/;/g) || []).length;
  if (semiCount > 0) {
    return { ok: false, reason: '세미콜론 사용 금지 (단일 문장만 허용)' };
  }

  // 너무 긴 쿼리 거부
  if (sql.length > 8000) {
    return { ok: false, reason: '쿼리 길이 초과 (8000자)' };
  }

  // TOP 강제: SELECT 뒤에 TOP N (N≤500) 가 없으면 자동 삽입
  //   단, SELECT COUNT/SUM/... 같은 단일 스칼라 집계는 TOP 불필요
  const hasTop = /\bSELECT\s+TOP\s+\d+/i.test(sql);
  const isScalarAgg = /^\s*SELECT\s+(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql);
  if (!hasTop && !isScalarAgg && /^\s*SELECT\b/i.test(sql)) {
    sql = sql.replace(/^\s*SELECT\b/i, 'SELECT TOP 100');
  }

  return { ok: true, sql };
}
