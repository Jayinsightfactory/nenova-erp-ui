// lib/morningBriefing.js — 아침 브리핑 한 장(순수 함수, DB·네트워크 없음)
//
// 원칙
//   - 새 계산식을 만들지 않는다. 기존 조회 API 응답을 그대로 받아 "오늘 볼 것" 카드로 바꾸기만 한다.
//     (숫자는 각 원본 화면과 같아야 하므로 여기서 다시 집계·보정하지 않는다.)
//   - 읽기 전용. 이 파일과 pages/briefing.js 는 어떤 원장도 쓰지 않는다.
//   - 조회에 실패한 항목은 0이나 "문제 없음"으로 보이게 하지 않고 '확인 못 함'으로 표시한다.

export const BRIEFING_SOURCES = Object.freeze([
  { id: 'orderRequests', path: '/api/m/order-request?status=pending', adminOnly: false },
  { id: 'approvals', path: '/api/mgmt/approvals?status=requested', adminOnly: true },
  { id: 'incoming', path: '/api/incoming/eta', adminOnly: false },
  { id: 'week', path: '/api/stats/dashboard', adminOnly: false },
  { id: 'receivables', path: '/api/mgmt/ar-aging', adminOnly: true },
  { id: 'creditLimit', path: '/api/mgmt/credit-limit', adminOnly: true },
]);

// 상태: red=오늘 바로 볼 것 · amber=확인 필요 · green=문제 없음 · gray=확인 못 함/권한 없음
export const STATUS_LABEL = Object.freeze({ red: '바로 확인', amber: '확인 필요', green: '문제 없음', gray: '확인 못 함' });
const STATUS_RANK = { red: 0, amber: 1, gray: 2, green: 3 };

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
export const won = (value) => `${Math.round(num(value)).toLocaleString('ko-KR')}원`;
const count = (value) => `${num(value).toLocaleString('ko-KR')}건`;

function unavailable(base, result) {
  const forbidden = result?.status === 403;
  return {
    ...base,
    status: 'gray',
    unavailable: !forbidden, // 조회 실패(권한 없음은 실패가 아님) — 요약이 '문제 없음'으로 보이지 않게 따로 센다
    statusLabel: forbidden ? '관리자 전용' : STATUS_LABEL.gray,
    headline: forbidden ? '관리자 계정에서만 보입니다' : '지금은 불러오지 못했습니다',
    lines: forbidden ? [] : [String(result?.error || '조회 실패').slice(0, 160)],
  };
}

function cardOrderRequests(result) {
  const base = { id: 'orderRequests', title: '주문 신청 승인 대기', href: '/admin/order-requests', linkLabel: '주문 신청 승인 화면 열기' };
  if (!result?.ok) return unavailable(base, result);
  const rows = Array.isArray(result.data?.requests) ? result.data.requests : [];
  if (!rows.length) return { ...base, status: 'green', headline: '대기 중인 신청 없음', lines: [] };
  return {
    ...base,
    status: 'red',
    headline: `${count(rows.length)} 대기`,
    lines: rows.slice(0, 5).map((r) => `${r.CustName || '거래처 미상'} · ${r.OrderWeek || '차수 미상'}차 · 품목 ${num(r.itemCount)}개 · ${r.RequesterName || ''}`.trim()),
    more: Math.max(0, rows.length - 5),
  };
}

function cardApprovals(result) {
  const base = { id: 'approvals', title: '결재 승인 대기', href: '/mgmt/approvals', linkLabel: '승인요청 화면 열기' };
  if (!result?.ok) return unavailable(base, result);
  const rows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  if (!rows.length) return { ...base, status: 'green', headline: '대기 중인 결재 없음', lines: [] };
  return { ...base, status: 'red', headline: `${count(rows.length)} 대기`, lines: [] };
}

function cardIncoming(result, today) {
  const base = { id: 'incoming', title: '입고 예정', href: '/incoming/insight', linkLabel: '입고 현황 화면 열기' };
  if (!result?.ok) return unavailable(base, result);
  const rows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  // 예정일 지남 = 원본 API의 late 판정(예정일이 지났는데 입고등록·도착이 아님)과 같은 규칙.
  // 원본은 '오늘'을 UTC 날짜로 봐서 한국 오전 9시 전에는 어제 예정 건을 놓치므로, 같은 규칙을 한국 날짜로 한 번 더 본다.
  const isLate = (r) => Boolean(r.late) || Boolean(today && r.eta && r.eta < today && !r.matched && r.stage !== '도착' && r.stage !== '입고등록');
  const late = rows.filter(isLate);
  const dueToday = rows.filter((r) => r.eta === today && !isLate(r));
  const noDate = rows.filter((r) => !r.eta);
  const describe = (r) => `${r.week || ''}차 · ${r.farm || '농장 미상'}${r.awb ? ` · ${r.awb}` : ''} · ${r.eta || '예정일 없음'} · ${r.stage || ''}`.trim();
  if (!rows.length) return { ...base, status: 'green', headline: '진행 중인 입고 예정 없음', lines: ['입고 예정 보드에 등록된 건이 없습니다.'] };
  const status = late.length ? 'red' : dueToday.length ? 'amber' : 'green';
  const headline = late.length
    ? `예정일 지남 ${count(late.length)}`
    : dueToday.length ? `오늘 도착 예정 ${count(dueToday.length)}` : `진행 중 ${count(rows.length)} · 지연 없음`;
  const shown = [...late, ...dueToday].slice(0, 5);
  return {
    ...base,
    status,
    headline,
    lines: [
      `진행 중 ${count(rows.length)} · 오늘 도착 ${count(dueToday.length)} · 예정일 지남 ${count(late.length)}${noDate.length ? ` · 예정일 미입력 ${count(noDate.length)}` : ''}`,
      ...shown.map(describe),
    ],
    more: Math.max(0, late.length + dueToday.length - shown.length),
  };
}

function cardWeek(result) {
  const base = { id: 'week', title: '이번 차수 현황', href: '/dashboard', linkLabel: '대시보드 열기' };
  if (!result?.ok) return unavailable(base, result);
  const kpi = result.data?.kpi || {};
  const unfixed = num(kpi.unfixedCount);
  const lowStock = num(kpi.lowStockCount);
  const label = `${result.data?.year || ''}년 ${result.data?.week || ''}차`.trim();
  return {
    ...base,
    title: `이번 차수 현황 (${label})`,
    status: unfixed > 0 || lowStock > 0 ? 'amber' : 'green',
    headline: unfixed > 0 ? `미확정 ${count(unfixed)}` : lowStock > 0 ? `재고 부족 ${count(lowStock)}` : '미확정·재고 부족 없음',
    lines: [
      `주문 ${count(kpi.orderCount)} · 거래처 ${num(kpi.custCount).toLocaleString('ko-KR')}곳`,
      `매출 ${won(kpi.totalSales)} (부가세 포함 ${won(kpi.totalWithVat)})`,
      `미확정 ${count(unfixed)} · 재고 부족 ${count(lowStock)}`,
    ],
  };
}

function cardReceivables(result) {
  const base = { id: 'receivables', title: '미수금(채권)', href: '/mgmt/ar-aging', linkLabel: '채권 연령 화면 열기' };
  if (!result?.ok) return unavailable(base, result);
  const totals = result.data?.totals || {};
  const rows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  const overdue = rows.filter((r) => num(r.d90p) > 0); // 원본 정렬(90일 초과 우선) 유지
  const d90 = num(totals.d90p);
  const d61 = num(totals.d61_90);
  return {
    ...base,
    status: d90 > 0 ? 'red' : d61 > 0 ? 'amber' : 'green',
    headline: d90 > 0 ? `90일 넘은 미수 ${won(d90)} · ${overdue.length}곳` : d61 > 0 ? `61~90일 미수 ${won(d61)}` : '오래된 미수 없음',
    lines: [
      `미수 합계 ${won(totals.total)} (기준일 ${result.data?.asOf || ''})`,
      `30일 이내 ${won(totals.d0_30)} · 31~60일 ${won(totals.d31_60)} · 61~90일 ${won(d61)} · 90일 초과 ${won(d90)}`,
      ...overdue.slice(0, 5).map((r) => `${r.custName || '거래처 미상'} · 90일 초과 ${won(r.d90p)}`),
    ],
    more: Math.max(0, overdue.length - 5),
    sourceNote: result.data?.source ? `출처: ${result.data.source}` : '',
  };
}

function cardCreditLimit(result) {
  const base = { id: 'creditLimit', title: '외상 한도', href: '/mgmt/credit-limit', linkLabel: '여신한도 화면 열기' };
  if (!result?.ok) return unavailable(base, result);
  const rows = Array.isArray(result.data?.rows) ? result.data.rows : [];
  const over = rows.filter((r) => r.status === 'over');
  const warn = rows.filter((r) => r.status === 'warn');
  const withLimit = rows.filter((r) => r.limitKRW != null).length;
  const describe = (r) => `${r.signboard || r.custName || '거래처 미상'} · 잔액 ${won(r.balance)} / 한도 ${won(r.limitKRW)}${r.pct != null ? ` (${Math.round(num(r.pct))}%)` : ''}`;
  if (!withLimit) return { ...base, status: 'gray', statusLabel: '한도 미설정', headline: '한도를 정한 거래처가 없습니다', lines: ['한도를 입력하면 초과·임박 거래처를 여기서 알려 줍니다.'] };
  return {
    ...base,
    status: over.length ? 'red' : warn.length ? 'amber' : 'green',
    headline: over.length ? `한도 초과 ${over.length}곳` : warn.length ? `한도 임박 ${warn.length}곳` : '한도 초과·임박 없음',
    lines: [`한도 설정 ${withLimit}곳 · 초과 ${over.length}곳 · 임박 ${warn.length}곳`, ...[...over, ...warn].slice(0, 5).map(describe)],
    more: Math.max(0, over.length + warn.length - 5),
  };
}

// results: { [sourceId]: { ok:true, data } | { ok:false, status, error } }
export function buildBriefing(results = {}, { today = '', isAdmin = false } = {}) {
  const cards = [
    cardOrderRequests(results.orderRequests),
    cardIncoming(results.incoming, today),
    cardWeek(results.week),
    ...(isAdmin ? [cardApprovals(results.approvals), cardReceivables(results.receivables), cardCreditLimit(results.creditLimit)] : []),
  ].map((card, index) => ({ statusLabel: STATUS_LABEL[card.status], lines: [], more: 0, unavailable: false, ...card, order: index }));
  cards.sort((a, b) => (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (a.order - b.order));
  const tally = { red: 0, amber: 0, green: 0, gray: 0 };
  for (const card of cards) tally[card.status] += 1;
  // 불러오지 못한 항목이 있으면 '급한 것이 없다'고 말하지 않는다(못 본 것이지 없는 것이 아니다).
  const failed = cards.filter((card) => card.unavailable).length;
  const failedNote = failed ? ` · 확인 못 한 항목 ${failed}가지` : '';
  const summary = tally.red
    ? `바로 확인할 것 ${tally.red}가지${failedNote}`
    : tally.amber ? `급한 것은 없고, 확인할 것 ${tally.amber}가지${failedNote}`
      : tally.gray === cards.length ? '불러온 항목이 없습니다'
        : failed ? `확인 못 한 항목 ${failed}가지 — 다시 불러와 주세요` : '오늘은 급한 것이 없습니다';
  const overall = tally.red ? 'red' : tally.amber ? 'amber' : (tally.gray === cards.length || failed) ? 'gray' : 'green';
  return { today, cards, tally, failed, summary, overall };
}

// 한국 시각 기준 오늘(YYYY-MM-DD). Date 를 getHours 로 읽지 않는다(서버·DB 시각 밀림 방지).
export function todayKst(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}
