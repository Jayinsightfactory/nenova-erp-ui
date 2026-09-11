import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
const operationHistory = fs.readFileSync('components/orders/PasteOperationHistory.js', 'utf8');

assert.match(page, /① 영업방 원문 · 최신 전산 이력/);
assert.match(page, /<DistributionSalesInbox key=\{`\$\{selectedYearFromWeek\(week\)\}:\$\{week\}`\}/);
assert.match(page, /disabled=\{parsing \|\| bulkRunning \|\| adjustSaving \|\| orders\.some\(order => order\.saving\)\}/);
assert.match(page, /② 입력/);
assert.match(page, /③ 분석 · 검토/);
assert.match(page, /④ 결과 · 최근 이력/);
assert.match(page, /@media \(min-width: 1600px\) \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); grid-template-rows: minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)/);
assert.match(page, /@media \(max-width: 768px\) \{[\s\S]*?\.paste-input-grid \{ grid-template-columns: 1fr; \}/);
assert.match(page, /\.paste-col-baseline \{ grid-column: 1 \/ span 2; grid-row: 1 \/ span 3;/);
assert.match(page, /\.paste-column-order-input \{ grid-column: 3; grid-row: 1;/);
assert.match(page, /\.paste-column-base-input \{ grid-column: 3; grid-row: 2;/);
assert.match(page, /\.paste-column-analysis \{ grid-column: 4; grid-row: 1;/);
assert.match(page, /\.paste-col-work-results \{ grid-column: 4; grid-row: 2 \/ span 2;/);
assert.match(page, /max-height: calc\(100vh - 230px\); overflow: auto/);
assert.match(page, /height: calc\(100vh - 310px\); max-height: calc\(100vh - 310px\); min-height: 0;/);
assert.match(page, /\.paste-input-grid > \.paste-col > \* \{ flex-shrink: 0; \}/);
assert.match(page, /\.paste-work-history \{ margin-top: 8px; min-width: 0; min-height: 120px; max-height: 260px; overflow: auto;/);
assert.match(page, /paste-connected-save[\s\S]*작업 결과 · 진행 상태/);
assert.match(page, /paste-connected-result-details/);
assert.match(page, /최근 붙여넣기 작업 이력/);
assert.match(page, /week && selectedYearFromWeek\(week\) \? \(/);
assert.match(page, /차수를 선택하면 해당 차수의 최근 붙여넣기 작업 이력을 불러옵니다/);
assert.match(page, /<PasteOperationHistory compact key=\{`paste-operation-history:[\s\S]*?bulkResult\?\.orderId/);
assert.match(page, /\.paste-work-success-row \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important; \}/);
assert.match(page, /처리 실패 · 전산 변경 없음/);
assert.match(page, /실패 \{bulkResult\.failCount\}건 · 성공 0건 · 전체 롤백되었습니다/);
assert.match(page, /<details className="paste-order-history-reference">\s*<summary>전체 주문 변경 이력 · 참고<\/summary>\s*<OrderHistoryPanel loading=\{orderHistoryLoading\} error=\{orderHistoryError\}/);
assert.doesNotMatch(page, /<details className="paste-order-history-reference" open/);
assert.ok(page.indexOf('최근 붙여넣기 작업 이력') < page.indexOf('paste-order-history-reference'), '붙여넣기 작업 이력은 전체 주문 이력 참고 영역 밖에서 계속 보인다.');
assert.match(page, /주문 원장 변경만 표시합니다/);
assert.match(page, /!loading && !error && rows\.length === 0/);

assert.match(page, /orderHistoryRequestRef\.current \+= 1;/);
assert.match(page, /return \(\) => \{ orderHistoryRequestRef\.current \+= 1; \};/);
assert.match(page, /d\.success !== true \|\| !Array\.isArray\(d\.history\)/);
assert.match(page, /if \(requestId !== orderHistoryRequestRef\.current\) return;/);
assert.match(page, /if \(orderHistoryRowsScopeRef\.current !== scope\) setOrderHistoryRows\(\[\]\);/);

assert.match(operationHistory, /\{ initial = \{\}, compact = false \}/);
assert.match(operationHistory, /if \(compact\) return <section aria-label="최근 붙여넣기 작업 이력">/);
assert.match(operationHistory, /<details style=\{\{ marginTop: 5 \}\}>/);
assert.match(operationHistory, /filters\.year}년 \{filters\.week \|\| '전체 차수'\}/);
assert.match(operationHistory, /filters\.who === 'mine' \? '내 작업' : '전체 작업'/);
assert.match(operationHistory, /현재 조회 구간에는 붙여넣기 작업 이력이 없습니다/);
assert.match(operationHistory, /onClick=\{\(\) => load\(data\.nextCursor\)\}/);
assert.match(operationHistory, />다음 기록 검색<\/button>/);
assert.match(operationHistory, /useEffect\(\(\) => \{ load\(\); return \(\) => \{ seq\.current \+= 1; \}; \}, \[\]\);/);

const normalizedPage = page.replace(/\r\n/g, '\n');
const loaderStart = normalizedPage.indexOf('  const loadOrderHistorySummary = async');
const loaderEnd = normalizedPage.indexOf('\n\n  useEffect(() => {', loaderStart);
assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'history loader must remain directly executable for its read-only race contract');
const loaderSource = normalizedPage.slice(loaderStart, loaderEnd);

function deferred() {
  let resolve; let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function historyHarness({ rows = [], scope = '', responses = [] } = {}) {
  const state = { rows, error: '', loading: false, rowWrites: [] };
  const orderHistoryRequestRef = { current: 0 };
  const orderHistoryRowsScopeRef = { current: scope };
  const loadOrderHistorySummary = new Function('deps', `
    const { apiGet, resolveOrderWeekQuery, orderHistoryRequestRef, orderHistoryRowsScopeRef, setOrderHistoryRows, setOrderHistoryError, setOrderHistoryLoading } = deps;
    const week = '2026-36-01'; const orders = [];
    ${loaderSource}
    return loadOrderHistorySummary;
  `)({
    apiGet: () => responses.shift().promise,
    resolveOrderWeekQuery: targetWeek => ({ year: targetWeek.slice(0, 4) }),
    orderHistoryRequestRef,
    orderHistoryRowsScopeRef,
    setOrderHistoryRows: next => { state.rows = next; state.rowWrites.push(next); },
    setOrderHistoryError: next => { state.error = next; },
    setOrderHistoryLoading: next => { state.loading = next; },
  });
  return { state, loadOrderHistorySummary };
}

// The old request finishes after the newest selected year/week request. It must not replace it.
{
  const oldRequest = deferred();
  const newRequest = deferred();
  const harness = historyHarness({ responses: [oldRequest, newRequest] });
  const oldLoad = harness.loadOrderHistorySummary('2026-35-01', []);
  const newLoad = harness.loadOrderHistorySummary('2026-36-01', []);
  newRequest.resolve({ success: true, history: [{ id: 'new-scope' }] });
  await newLoad;
  oldRequest.resolve({ success: true, history: [{ id: 'old-scope' }] });
  await oldLoad;
  assert.deepEqual(harness.state.rows, [{ id: 'new-scope' }], 'a delayed old scope response cannot overwrite the newest scope');
  assert.equal(harness.state.loading, false, 'only the newest request may settle the visible loading state');
}

// A failed refresh for the same explicit scope keeps the previously shown read-only list.
{
  const failedRequest = deferred();
  const scope = '2026:2026-36-01:';
  const priorRows = [{ id: 'known-good' }];
  const harness = historyHarness({ rows: priorRows, scope, responses: [failedRequest] });
  const load = harness.loadOrderHistorySummary('2026-36-01', []);
  failedRequest.reject(new Error('network unavailable'));
  await load;
  assert.deepEqual(harness.state.rows, priorRows, 'same-scope history failure preserves the last successful rows');
  assert.match(harness.state.error, /network unavailable/, 'failure remains distinguishable from an empty history response');
}

console.log('paste four-column layout tests passed');
