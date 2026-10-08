// lib/voucherJournal.js — 지출결의서·전표 1단계 순수 로직(DB 없음)
// 채번(yy/mm/dd-n), 자동분개 규칙, 차대변 일치 검증, 역분개, 상태 전이.
// 관찰 명세: nenova-work-features/observed/_kmh-ecount-spec.md §6·§7·§11
// ERP 공유 테이블은 어디서도 쓰지 않는다. 웹 전용 dbo.Web* 테이블만 대상.

export const VOUCHER_TYPES = ['지출', '지급', '급여'];
export const VOUCHER_STATUS = ['작성', '결재완료', '송금완료', '전표반영', '취소'];
export const JOURNAL_STATUS = ['작성', '확정', '취소'];

// 상태 전이: 작성→결재완료(전표 자동생성)→송금완료→전표반영(전표 확정·잠금). 취소=역분개.
export const STATUS_FLOW = {
  작성: ['결재완료'],
  결재완료: ['송금완료', '취소'],
  송금완료: ['전표반영', '취소'],
  전표반영: ['취소'],
  취소: [],
};

// 자동분개에 쓰는 고정 계정 (시드와 일치해야 함)
export const ACCOUNTS = {
  BANK: '103',          // 보통예금
  AP: '251',            // 외상매입금
  SALARY: '802',        // 급여
  FX_GAIN: '907',       // 외환차익
  FX_LOSS: '952',       // 외환차손
};

export const JOURNAL_TYPE_BY_VOUCHER = { 지출: '지출결의서', 지급: '지급결의서', 급여: '급여결의서' };

const num = (v) => {
  const x = Number(String(v ?? '').replace(/[,\s₩]/g, ''));
  return Number.isFinite(x) ? x : 0;
};
export const round0 = (v) => Math.round(num(v));

// ── 채번: 'yy/mm/dd-n' (n = 같은 날짜의 기존 최대 n + 1)
export function formatVoucherNo(dateStr, seq) {
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error(`일자 형식 오류(YYYY-MM-DD): ${dateStr}`);
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1) throw new Error(`채번 순번 오류: ${seq}`);
  return `${m[1].slice(2)}/${m[2]}/${m[3]}-${n}`;
}
export function nextVoucherNo(dateStr, existingNos = []) {
  const prefix = formatVoucherNo(dateStr, 1).slice(0, 8);
  let max = 0;
  for (const no of existingNos) {
    const s = String(no || '');
    if (!s.startsWith(prefix + '-')) continue;
    const n = Number(s.slice(prefix.length + 1));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return formatVoucherNo(dateStr, max + 1);
}
export function fiscalYearOf(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4})/);
  if (!m) throw new Error(`일자 형식 오류: ${dateStr}`);
  return Number(m[1]);
}

// ── 결의서 입력 검증(헤더+라인). 통과하면 정규화된 객체 반환.
export function normalizeVoucherInput(input = {}) {
  const errors = [];
  const voucherType = String(input.voucherType || '').trim();
  if (!VOUCHER_TYPES.includes(voucherType)) errors.push(`유형은 ${VOUCHER_TYPES.join('/')} 중 하나`);
  const voucherDate = String(input.voucherDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(voucherDate)) errors.push('일자(YYYY-MM-DD) 필요');
  const currency = String(input.currency || 'KRW').trim().toUpperCase() || 'KRW';
  const fxRate = num(input.fxRate);
  if (currency !== 'KRW' && fxRate <= 0) errors.push('외화 결의서는 환율(>0) 필요');
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = rawLines
    .map((l, i) => ({
      lineNo: i + 1,
      accountCode: String(l.accountCode || '').trim(),
      amount: round0(l.amount),
      foreignAmount: Number(num(l.foreignAmount).toFixed(2)),
      descr: String(l.descr || '').trim().slice(0, 200),
      dept: String(l.dept || '').trim().slice(0, 50),
      orderYearWeek: String(l.orderYearWeek || '').trim().slice(0, 12),
    }))
    .filter((l) => l.accountCode || l.amount || l.foreignAmount || l.descr);
  if (!lines.length) errors.push('라인 1행 이상 필요(계정과목+금액)');
  lines.forEach((l) => {
    if (!l.accountCode) errors.push(`${l.lineNo}행 계정과목 필요`);
    if (l.amount <= 0 && !(currency !== 'KRW' && l.foreignAmount > 0)) errors.push(`${l.lineNo}행 금액(>0) 필요`);
    // 외화 결의서: 원화금액 비면 외화×환율로 보충
    if (currency !== 'KRW' && l.amount <= 0 && l.foreignAmount > 0) l.amount = round0(l.foreignAmount * fxRate);
  });
  if (voucherType === '급여' && !String(input.employeeName || '').trim()) errors.push('급여 결의서는 직원명 필요');
  if (errors.length) { const e = new Error(errors.join(', ')); e.code = 'VALIDATION'; e.errors = errors; throw e; }
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const totalForeign = Number(lines.reduce((s, l) => s + l.foreignAmount, 0).toFixed(2));
  return {
    voucherType, voucherDate, fiscalYear: fiscalYearOf(voucherDate),
    custKey: input.custKey ? Number(input.custKey) : null,
    custName: String(input.custName || '').trim().slice(0, 100),
    period: String(input.period || '').trim().slice(0, 30),
    manager: String(input.manager || '').trim().slice(0, 50),
    employeeName: String(input.employeeName || '').trim().slice(0, 50),
    fundCode: String(input.fundCode || '').trim().slice(0, 20),
    currency, fxRate: currency === 'KRW' ? 1 : fxRate,
    attachUrl: String(input.attachUrl || '').trim().slice(0, 500),
    memo: String(input.memo || '').trim().slice(0, 400),
    totalAmount, totalForeign, lines,
  };
}

// ── 자동분개: 결의서(정규화된 헤더+라인) → 전표 라인[{side:'DR'|'CR', accountCode, amount, descr, dept, orderYearWeek}]
//  지출: 라인 계정(비용) 차변 / 보통예금 대변(합계)
//  지급(외화송금): 라인 계정(기본 외상매입금 251) 차변(장부 원화) / 보통예금 대변(외화×송금환율) + 환차손익 라인
//  급여: 라인 계정(기본 급여 802) 차변 / 보통예금 대변(합계)
export function buildJournalLines(voucher) {
  const v = voucher;
  const lines = v.lines || [];
  if (!lines.length) throw new Error('라인 없음');
  const out = [];
  const push = (side, accountCode, amount, src = {}) => {
    const a = round0(amount);
    if (a <= 0) return;
    out.push({ side, accountCode, amount: a, descr: src.descr || '', dept: src.dept || '', orderYearWeek: src.orderYearWeek || '' });
  };
  if (v.voucherType === '지출') {
    lines.forEach((l) => push('DR', l.accountCode, l.amount, l));
    push('CR', ACCOUNTS.BANK, lines.reduce((s, l) => s + round0(l.amount), 0), { descr: '지출결의서 출금' });
  } else if (v.voucherType === '급여') {
    lines.forEach((l) => push('DR', l.accountCode || ACCOUNTS.SALARY, l.amount, l));
    push('CR', ACCOUNTS.BANK, lines.reduce((s, l) => s + round0(l.amount), 0), { descr: `급여 송금${v.employeeName ? ' ' + v.employeeName : ''}` });
  } else if (v.voucherType === '지급') {
    const booked = lines.reduce((s, l) => s + round0(l.amount), 0);          // 장부상 채무(원화)
    const hasFx = v.currency && v.currency !== 'KRW' && lines.some((l) => num(l.foreignAmount) > 0);
    const paid = hasFx
      ? lines.reduce((s, l) => s + round0(num(l.foreignAmount) * num(v.fxRate)), 0) // 실제 출금(원화)
      : booked;
    lines.forEach((l) => push('DR', l.accountCode || ACCOUNTS.AP, l.amount, l));
    push('CR', ACCOUNTS.BANK, paid, { descr: `외화송금 ${v.currency || ''} ${v.totalForeign || ''}`.trim() });
    const diff = paid - booked; // +: 더 나감=환차손(차변), −: 덜 나감=환차익(대변)
    if (diff > 0) push('DR', ACCOUNTS.FX_LOSS, diff, { descr: '환차손' });
    if (diff < 0) push('CR', ACCOUNTS.FX_GAIN, -diff, { descr: '환차익' });
  } else {
    throw new Error(`알 수 없는 유형: ${v.voucherType}`);
  }
  assertBalanced(out);
  return out.map((l, i) => ({ lineNo: i + 1, ...l }));
}

export function sumSide(lines, side) {
  return lines.filter((l) => l.side === side).reduce((s, l) => s + round0(l.amount), 0);
}
export function assertBalanced(lines) {
  const dr = sumSide(lines, 'DR');
  const cr = sumSide(lines, 'CR');
  if (dr !== cr) { const e = new Error(`차변(${dr.toLocaleString()}) ≠ 대변(${cr.toLocaleString()})`); e.code = 'UNBALANCED'; throw e; }
  if (dr <= 0) { const e = new Error('전표 금액 0'); e.code = 'EMPTY'; throw e; }
  return { debit: dr, credit: cr };
}

// ── 역분개: 차대변을 맞바꾼 라인(확정 전표 취소용)
export function reverseJournalLines(lines) {
  const out = lines.map((l, i) => ({
    lineNo: i + 1,
    side: l.side === 'DR' ? 'CR' : 'DR',
    accountCode: l.accountCode,
    amount: round0(l.amount),
    descr: `[역분개] ${l.descr || ''}`.trim(),
    dept: l.dept || '',
    orderYearWeek: l.orderYearWeek || '',
  }));
  assertBalanced(out);
  return out;
}

export function canTransition(from, to) {
  return (STATUS_FLOW[from] || []).includes(to);
}

// 전표현황 월별 소계·총계 (행: {journalDate, totalDebit})
export function summarizeByMonth(rows) {
  const byMonth = new Map();
  let grand = 0;
  for (const r of rows) {
    const ym = String(r.journalDate || '').slice(0, 7);
    const amt = round0(r.totalDebit);
    byMonth.set(ym, (byMonth.get(ym) || 0) + amt);
    grand += amt;
  }
  return { byMonth: [...byMonth.entries()].sort().map(([ym, total]) => ({ ym, total })), grand };
}
