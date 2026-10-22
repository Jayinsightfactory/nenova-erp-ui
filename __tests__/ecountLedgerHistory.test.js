import assert from 'node:assert/strict';
import {
  monthRange, monthBounds, formatForInput, isMonth, isMaster, descendingMonths, shouldStopBackfill,
  historyFileName, historyRelPath, failShotName, loadedKey, isAlreadyLoaded, isDuplicateSha, nextMonth, prevMonth,
  EMPTY_STREAK_STOP, DEFAULT_START_MONTH,
} from '../lib/ecountLedger/history.js';
import { buildSalesWeek, VIEW_NAMES } from '../lib/ecountLedger/views.js';

// 월 범위 생성(연도 경계 포함)
assert.deepEqual(monthRange('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
assert.deepEqual(monthRange('2026-07', '2026-07'), ['2026-07']);
assert.deepEqual(monthRange('2026-08', '2026-07'), []);
assert.equal(monthRange('2024-01', '2026-10').length, 34);
assert.throws(() => monthRange('2026-13', '2026-12'));
assert.equal(isMonth('2026-02'), true);
assert.equal(isMonth('2026-2'), false);
assert.equal(nextMonth('2026-12'), '2027-01');
assert.equal(prevMonth('2026-01'), '2025-12');

// 월 경계(윤년 포함)
assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
assert.deepEqual(monthBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', to: '2026-12-31' });

// 화면 입력 형식
assert.equal(formatForInput('2026-09-30', 'yy/mm/dd'), '26/09/30');
assert.equal(formatForInput('2026-09-30', 'yyyy/mm/dd'), '2026/09/30');
assert.equal(formatForInput('2026-09-01', 'yy/mm'), '26/09');

// 빈 달 중단: --from 없으면 최신부터 과거로, 연속 6개월 빈 결과에서 중단
{
  const order = descendingMonths('2026-03', '2025-10');
  assert.deepEqual(order, ['2026-03', '2026-02', '2026-01', '2025-12', '2025-11', '2025-10']);
  assert.equal(descendingMonths('2026-10').at(-1), DEFAULT_START_MONTH);
  let streak = 0; const visited = [];
  const empty = new Set(['2026-02', '2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
  for (const m of descendingMonths('2026-03', '2025-01')) {
    if (shouldStopBackfill(streak)) break;
    visited.push(m);
    streak = empty.has(m) ? streak + 1 : 0;
  }
  assert.equal(EMPTY_STREAK_STOP, 6);
  assert.equal(visited.at(-1), '2025-09'); // 2026-02 부터 6개 연속 빈 달 뒤 중단
  assert.equal(shouldStopBackfill(5), false);
  assert.equal(shouldStopBackfill(6), true);
}

// 파일명·경로
assert.equal(historyFileName('2026-07'), '2026-07.xlsx');
assert.equal(historyRelPath('E040207', '2026-07'), 'E040207/2026-07.xlsx');
assert.equal(failShotName('E040207', '2026-07'), 'E040207-2026-07.png');

// 마스터는 기간 없음 1회
assert.equal(isMaster('E010101'), true);
assert.equal(isMaster('E040103'), true);
assert.equal(isMaster('E040207'), false);

// 재실행 중복 판정
{
  const loaded = new Set([loadedKey('E040207', '2026-07')]);
  assert.equal(isAlreadyLoaded('E040207', '2026-07', loaded), true);
  assert.equal(isAlreadyLoaded('E040207', '2026-08', loaded), false);
  assert.equal(isAlreadyLoaded('E040214', '2026-07', loaded), false);
  const shas = new Set(['a'.repeat(64)]);
  assert.equal(isDuplicateSha('a'.repeat(64), shas), true);
  assert.equal(isDuplicateSha('b'.repeat(64), shas), false);
  assert.equal(isDuplicateSha('', shas), false);
}

// 차수 대조 뷰 SQL: 열이 있으면 생성, 없으면 null. 차수 환산식·연도 명시 비교 포함
{
  assert.ok(VIEW_NAMES.includes('cmp_sales_week'));
  assert.equal(buildSalesWeek(['거래처명']), null);
  const ddl = buildSalesWeek(['일자-No.', '거래처명', '합계']);
  assert.match(ddl, /CREATE OR ALTER VIEW ecount\.cmp_sales_week/);
  assert.match(ddl, /DATEDIFF\(DAY, '19000103', SaleDate\) % 7/); // 수요일 시작
  assert.match(ddl, /DATEPART\(DAYOFYEAR, Sat\) - 1\) \/ 7 \+ 1/);
  assert.match(ddl, /sm\.OrderYear/);
  assert.doesNotMatch(ddl, /ShipmentDtm/); // 타임스탬프로 차수 유도 금지
}

console.log('ecountLedgerHistory.test OK');
