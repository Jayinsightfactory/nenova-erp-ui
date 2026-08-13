// stockSnapshotByCategory()의 recentCost(최근 매입 외화단가) cutoff 회귀 검증.
// 2026-08-11 결함수정 3: cutoff 없이 전역 최신 WarehouseDetail을 쓰면 "이 보고서가 선택한 스냅샷
// 세부차수" 이후의 미래 입고가 과거 차수의 F(기말재고평가)를 오염시킨다.
//
// lib/profitReport.js는 './db'(mssql)를 import하므로 이 worktree 실행 환경에서 직접 import하면
// 확장자 없는 ESM 해석 이슈로 실패한다(운영 번들러 Next.js에서는 문제없음, 순수 node ESM 로더만의
// 제약). DB 의존을 피하면서도 "실제로 배포되는 코드"를 검증하기 위해 splitOrderWeek/recentCostCutoffSql
// 두 순수 함수의 소스 텍스트를 파일에서 그대로 잘라내 vm으로 실행한다(로직 재구현이 아니라 실행).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

/** source에서 `export function NAME(...) { ... }` 블록을 중괄호 균형을 세어 그대로 잘라낸다. */
function extractFunctionSource(source, name) {
  const startMarker = `export function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`함수를 찾지 못함: ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  let i = bodyStart;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { i += 1; break; }
    }
  }
  return source.slice(start, i).replace('export function', 'function');
}

async function main() {
  const reportSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(
    `${extractFunctionSource(reportSource, 'splitOrderWeek')}\n${extractFunctionSource(reportSource, 'recentCostCutoffSql')}`,
    sandbox,
  );
  const { splitOrderWeek, recentCostCutoffSql } = sandbox;

  console.log('=== splitOrderWeek() 순수 함수 ===');
  check("splitOrderWeek('27-02') = {majorNum:27, minorNum:2}",
    JSON.stringify(splitOrderWeek('27-02')) === JSON.stringify({ majorNum: 27, minorNum: 2 }));
  check("splitOrderWeek('01-01') = {majorNum:1, minorNum:1}",
    JSON.stringify(splitOrderWeek('01-01')) === JSON.stringify({ majorNum: 1, minorNum: 1 }));
  check("splitOrderWeek('52-01') = {majorNum:52, minorNum:1}",
    JSON.stringify(splitOrderWeek('52-01')) === JSON.stringify({ majorNum: 52, minorNum: 1 }));
  check("splitOrderWeek(null) = null", splitOrderWeek(null) === null);
  check("splitOrderWeek('') = null", splitOrderWeek('') === null);
  check("splitOrderWeek('연간') = null(형식 아님)", splitOrderWeek('연간') === null);

  console.log('\n=== recentCostCutoffSql() — SQL 조건절 구조 ===');
  const sql = recentCostCutoffSql('wm');
  check('cutoffYear 파라미터 참조', /@cutoffYear/.test(sql));
  check('cutoffMajor 파라미터 참조(대차수 비교)', /@cutoffMajor/.test(sql));
  check('cutoffMinor 파라미터 참조(세부차수 비교, <=)', /@cutoffMinor/.test(sql) && /<=\s*@cutoffMinor/.test(sql));
  check('OrderYear를 INT로 캐스팅해 연도까지 비교(2025/2026 같은 OrderWeek 혼선 방지)',
    /CAST\(wm\.OrderYear AS INT\) < @cutoffYear/.test(sql) && /CAST\(wm\.OrderYear AS INT\) = @cutoffYear/.test(sql));
  check('과거 연도(OrderYear < cutoffYear)는 항상 허용, 같은 연도는 major/minor까지 비교',
    /OrderYear AS INT\) < @cutoffYear\s*\n\s*OR \(/.test(sql));

  console.log('\n=== stockSnapshotByCategory()가 실제로 cutoff를 적용 ===');
  const fnBlock = reportSource.slice(
    reportSource.indexOf('export async function stockSnapshotByCategory'),
    reportSource.indexOf('/** 카테고리별 구매 통화')
  );
  check('stockSnapshotByCategory 함수 블록 파싱', fnBlock.length > 100);
  check('recentCost 서브쿼리(OUTER APPLY)가 cutoff SQL을 조건부로 포함',
    /AND \$\{recentCostCutoffSql\('wm'\)\}/.test(fnBlock));
  check('cutoff가 있을 때만 파라미터를 바인딩(splitOrderWeek 실패시 무조건 필터 걸지 않음)',
    /\.\.\.\(cutoff \? \{/.test(fnBlock) && /cutoffYear: \{ type: sql\.Int, value: Number\(orderYear\) \}/.test(fnBlock));
  check('cutoff는 이 함수가 선택한 스냅샷 week(latestStockSnapshotWeek 반환값)에서 파생',
    /const cutoff = splitOrderWeek\(week\);/.test(fnBlock));
  // recentCost cutoff는 "최근 매입 외화단가" OUTER APPLY 서브쿼리에만 걸려야 한다 —
  // ProductStock 본 쿼리(WHERE smk.StockKey=@stockKey ...)의 재고수량 자체는 건드리지 않는다(회귀 방지).
  const outerApplyStart = fnBlock.indexOf('OUTER APPLY');
  const outerApplyEnd = fnBlock.indexOf(') lc');
  check('cutoff 조건이 OUTER APPLY(최근단가 서브쿼리) 안에만 있음(본 쿼리 WHERE는 그대로)',
    outerApplyStart > -1 && outerApplyEnd > outerApplyStart
    && fnBlock.slice(outerApplyStart, outerApplyEnd).includes('recentCostCutoffSql')
    && !fnBlock.slice(0, outerApplyStart).includes('recentCostCutoffSql'));

  console.log('\n=== 01차 특례 — 호출부가 이미 전년도로 orderYear를 넘김(비교식에 OrderYear 포함되어 자동 격리) ===');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('01차(currentMajor<=1)는 prevOrderYear = 전년도로 계산', /currentMajor <= 1 \? String\(Number\(orderYear\) - 1\)/.test(apiSource));
  check('01차는 prevMajor = 52차로 계산', /currentMajor <= 1 \? '52'/.test(apiSource));
  check('stockSnapshotByCategory(prevMajor, prevOrderYear) 호출 — cutoff도 전년 기준으로 자동 적용',
    /stockSnapshotByCategory\(prevMajor, prevOrderYear\)/.test(apiSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
