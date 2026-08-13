// 이익률 분석(profit-analysis) 신규 모듈 — GET 읽기 전용 정적 검증 확장.
// __tests__/profitReportGetReadOnlyDdl.test.js와 같은 스타일: 주석을 제거한 소스에서
// 쓰기/DDL 계열 키워드(INSERT|UPDATE|DELETE|MERGE|CREATE TABLE|ALTER TABLE|ensure[A-Z]\w*() 가
// 전혀 없는지 확인한다. CLAUDE.md 규칙 1 "GET 요청 = 읽기 전용. SELECT만 허용."
//
// 실행: node __tests__/profitReportAnalysisGetReadOnlyDdl.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const WRITE_DDL_PATTERN = /\b(INSERT|UPDATE|DELETE|MERGE|CREATE\s+TABLE|ALTER\s+TABLE)\b|\bensure[A-Z]\w*\(/;

const TARGET_FILES = [
  'lib/kcsTaxableRate.js',
  'lib/kcsRateDateWeights.js',
  'lib/profitReportDeclarationDate.js',
  'lib/profitReportCustomerMixSql.js',
  'lib/profitReportRateAnalysis.js',
  'lib/profitReportPriceMixCandidates.js',
  'lib/profitReportDriverExplanation.js',
  'pages/api/sales/profit-analysis.js',
];

async function main() {
  console.log('=== 신규 KCS/이익률분석 모듈 — 쓰기/DDL 키워드(INSERT/UPDATE/DELETE/MERGE/CREATE TABLE/ALTER TABLE/ensure*) 없음 ===');
  for (const relPath of TARGET_FILES) {
    const fullPath = path.join(__dirname, '..', relPath);
    check(`${relPath} 파일 존재`, fs.existsSync(fullPath), fullPath);
    if (!fs.existsSync(fullPath)) continue;
    const source = fs.readFileSync(fullPath, 'utf8');
    check(`${relPath} 파싱(비어있지 않음)`, source.length > 50);
    const stripped = stripComments(source);
    const match = stripped.match(WRITE_DDL_PATTERN);
    check(`${relPath}에 쓰기/DDL 키워드 없음`, !match, match ? `matched="${match[0]}"` : '');
  }

  console.log('\n=== pages/api/sales/profit-analysis.js — GET 전용, 다른 메서드는 405 거부 ===');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-analysis.js'), 'utf8');
  const stripped = stripComments(apiSource);
  check('핸들러 안에 method !== GET 체크 존재', /req\.method\s*!==\s*'GET'/.test(stripped));
  check('그 체크 블록이 405를 반환', /req\.method\s*!==\s*'GET'\)\s*\{\s*return res\.status\(405\)/.test(stripped));
  check('POST 분기가 별도로 존재하지 않음(GET 전용, 쓰기 경로 없음)', !/req\.method\s*===\s*'POST'/.test(stripped));
  check('withAuth로 감싸져 있음(인증 없이 호출 불가)', /export default withAuth\(/.test(stripped));
  check('핸들러 전체가 try/catch로 감싸져 있어 500 스택트레이스 대신 JSON 오류를 반환', /try\s*\{[\s\S]*catch\s*\(e\)\s*\{[\s\S]*res\.status\(e\?\.statusCode \|\| 500\)/.test(stripped));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
