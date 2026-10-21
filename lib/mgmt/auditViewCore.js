// 변경 감사로그 통합뷰 순수 함수(DB 무관). 테스트: __tests__/mgmtAuditView.test.js
// 통합 스키마 {at, source, kind, target, before, after, actor, week, cust}
//  - actor 는 되돌리기·문의 목적 열 하나로만 쓴다. 사람별 집계·평가 함수는 두지 않는다.
//  - 조회 로그(GET)·단가/수량/확정/한도/승인 외 변경은 제외한다.
export const AUDIT_KINDS = ['단가', '수량', '확정', '한도', '승인'];
export const AUDIT_SOURCES = ['SystemActionLog', 'ShipmentHistory', 'PriceChangeHistory', 'CreditLimitHistory', 'ApprovalAudit'];

const iso = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).replace(' ', 'T');
};
const val = (v) => (v == null ? '' : String(v));

// 컬럼명/액션명 → kind (매핑 불가는 null = 제외)
export function classifyKind(text) {
  const s = String(text || '');
  if (/isfix|fix|confirm|확정/i.test(s)) return '확정';
  if (/cost|price|단가/i.test(s)) return '단가';
  if (/quantity|qty|수량/i.test(s)) return '수량';
  return null;
}

export function normSystemActionLog(r) {
  if (!r || String(r.Method || '').toUpperCase() === 'GET') return null;
  const kind = classifyKind(`${r.ActionType || ''}`);
  if (!kind) return null;
  let p = {};
  try { p = typeof r.Payload === 'string' ? JSON.parse(r.Payload || '{}') : r.Payload || {}; } catch { p = {}; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) p = {};
  return {
    at: iso(r.ActionDtm), source: 'SystemActionLog', kind,
    target: [r.AffectedTable, r.Endpoint].filter(Boolean).join(' · '),
    before: val(p.before ?? p.beforeValue), after: val(p.after ?? p.afterValue ?? r.ResultDesc),
    actor: val(r.Actor), week: val(p.week || p.orderWeek), cust: val(p.custName),
  };
}

export function normShipmentHistory(r) {
  if (!r) return null;
  const kind = classifyKind(`${r.ColumName || ''} ${r.ChangeType || ''}`);
  if (!kind) return null;
  const target = [r.CustName, r.ProdName].filter(Boolean).join(' / ') || `출고상세 #${val(r.SdetailKey)}`;
  return {
    at: iso(r.ChangeDtm), source: 'ShipmentHistory', kind,
    target: `${val(r.OrderWeek) ? `${r.OrderWeek} · ` : ''}${target}`,
    before: val(r.BeforeValue), after: val(r.AfterValue), actor: val(r.ChangeID),
    week: val(r.OrderWeek), cust: val(r.CustName),
  };
}

export function normPriceChange(r) {
  if (!r) return null;
  return {
    at: iso(r.CreatedAt), source: 'PriceChangeHistory', kind: '단가',
    target: [r.CustName || (r.CustKey ? `거래처 #${r.CustKey}` : '기본단가'), r.ProdName || `품목 #${val(r.ProdKey)}`].join(' / '),
    before: val(r.BeforeValue), after: val(r.AfterValue), actor: val(r.CreatedBy), week: '', cust: val(r.CustName),
  };
}

export function normCreditLimit(r) {
  if (!r) return null;
  return {
    at: iso(r.CreatedAt), source: 'CreditLimitHistory', kind: '한도',
    target: r.CustName || `거래처 #${val(r.CustKey)}`,
    before: r.PrevLimit == null ? '' : val(r.PrevLimit), after: val(r.LimitKRW), actor: val(r.CreatedBy), week: '', cust: val(r.CustName),
  };
}

export function normApprovalAudit(r) {
  if (!r) return null;
  return {
    at: iso(r.CreatedAt), source: 'ApprovalAudit', kind: '승인',
    target: `${val(r.TargetKind) || '승인요청'} #${val(r.RequestId)}`,
    before: val(r.FromStatus), after: val(r.ToStatus), actor: val(r.ActorId), week: '', cust: '',
  };
}

export function mergeEvents(groups) {
  return groups.flat().filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// 필터: kind(여러 개 가능), 차수(week 접두 일치), 거래처(부분 일치), 기간(YYYY-MM-DD)
export function filterEvents(events, { kind, week, cust, from, to } = {}) {
  const kinds = kind ? String(kind).split(',').filter(Boolean) : null;
  const wk = week ? String(week).trim() : '';
  const cs = cust ? String(cust).trim().toLowerCase() : '';
  return events.filter((e) => {
    if (!AUDIT_KINDS.includes(e.kind)) return false;
    if (kinds && !kinds.includes(e.kind)) return false;
    if (wk && !String(e.week || '').startsWith(wk) && !String(e.target || '').includes(wk)) return false;
    if (cs && !`${e.cust || ''} ${e.target || ''}`.toLowerCase().includes(cs)) return false;
    const day = String(e.at || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

// 기본 기간(최근 N일) → {from,to} (YYYY-MM-DD, 로컬 날짜 문자열 기준 now 주입 가능)
export function defaultRange(days = 7, now = new Date()) {
  const d = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (Number(days) || 7));
  return { from: d(start), to: d(now) };
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // 수식 주입 방지
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_HEADER = ['일시', '원천', '구분', '대상', '변경 전', '변경 후', '실행자(되돌리기·문의용)'];
export function toCsv(events) {
  const lines = [CSV_HEADER.join(',')];
  for (const e of events) lines.push([e.at, e.source, e.kind, e.target, e.before, e.after, e.actor].map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
