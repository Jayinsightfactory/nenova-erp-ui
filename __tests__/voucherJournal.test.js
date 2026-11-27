// __tests__/voucherJournal.test.js — 지출결의서·전표 순수 로직 단위테스트
// 자동분개 차대변 일치 · 역분개 · 채번 규칙(yy/mm/dd-n) · 상태 전이 · 월별 소계
const assert = require('node:assert/strict');

async function main() {
  const m = await import('../lib/voucherJournal.js');
  const { nextVoucherNo, formatVoucherNo, normalizeVoucherInput, buildJournalLines, assertBalanced, reverseJournalLines, sumSide, canTransition, summarizeByMonth, ACCOUNTS } = m;

  // ── 채번: yy/mm/dd-n, 같은 날짜 최대 n+1, 다른 날짜 무시, 빈 목록이면 1
  assert.equal(formatVoucherNo('2026-10-09', 1), '26/10/09-1');
  assert.equal(nextVoucherNo('2026-10-09', []), '26/10/09-1');
  assert.equal(nextVoucherNo('2026-10-09', ['26/10/09-1', '26/10/09-3', '26/10/08-9', 'garbage']), '26/10/09-4');
  assert.equal(nextVoucherNo('2026-10-09', ['26/10/09-12', '26/10/09-2']), '26/10/09-13');
  assert.throws(() => formatVoucherNo('2026/10/09', 1), /일자 형식/);
  assert.throws(() => formatVoucherNo('2026-10-09', 0), /순번/);

  // ── 입력 검증
  assert.throws(() => normalizeVoucherInput({ voucherType: '지출', voucherDate: '2026-10-09', lines: [] }), /라인 1행/);
  assert.throws(() => normalizeVoucherInput({ voucherType: '지출', voucherDate: '2026-10-09', lines: [{ accountCode: '', amount: 10 }] }), /계정과목/);
  assert.throws(() => normalizeVoucherInput({ voucherType: '급여', voucherDate: '2026-10-09', lines: [{ accountCode: '802', amount: 10 }] }), /직원명/);
  assert.throws(() => normalizeVoucherInput({ voucherType: '지급', voucherDate: '2026-10-09', currency: 'USD', fxRate: 0, lines: [{ accountCode: '251', amount: 10 }] }), /환율/);
  assert.throws(() => normalizeVoucherInput({ voucherType: '기타', voucherDate: '2026-10-09', lines: [{ accountCode: '811', amount: 10 }] }), /유형/);

  // ── 지출결의서(명세 §7-1: 이자비용 985,341 + 130,638 + 장기차입금 30,000,000) → 각 차변 / 보통예금 대변 합계
  const expense = normalizeVoucherInput({
    voucherType: '지출', voucherDate: '2025-09-29', custName: '하나은행',
    lines: [
      { accountCode: '931', amount: 985341, descr: '대출이자' },
      { accountCode: '931', amount: '130,638', descr: '대출이자2' },
      { accountCode: '293', amount: 30000000, descr: '장기차입금 상환' },
    ],
  });
  assert.equal(expense.totalAmount, 985341 + 130638 + 30000000);
  assert.equal(expense.fiscalYear, 2025);
  const ej = buildJournalLines(expense);
  assert.equal(ej.length, 4);
  assert.deepEqual(ej.map((l) => l.side), ['DR', 'DR', 'DR', 'CR']);
  assert.equal(ej[3].accountCode, ACCOUNTS.BANK);
  assert.equal(sumSide(ej, 'DR'), sumSide(ej, 'CR'));
  assert.equal(sumSide(ej, 'CR'), 31115979);

  // ── 지급결의서(§7-2 외화송금): 장부 채무 1,353,000 / 실제 송금 USD 1,000 × 1,400 = 1,400,000 → 환차손 47,000 차변
  const payLoss = normalizeVoucherInput({ voucherType: '지급', voucherDate: '2026-08-31', currency: 'USD', fxRate: 1400, lines: [{ accountCode: '251', amount: 1353000, foreignAmount: 1000 }] });
  const pl = buildJournalLines(payLoss);
  assert.deepEqual(pl.map((l) => [l.side, l.accountCode, l.amount]), [['DR', '251', 1353000], ['CR', '103', 1400000], ['DR', '952', 47000]]);
  assert.equal(sumSide(pl, 'DR'), sumSide(pl, 'CR'));
  // 환차익: 장부 1,450,000 > 송금 1,400,000 → 외환차익 50,000 대변
  const payGain = normalizeVoucherInput({ voucherType: '지급', voucherDate: '2026-08-31', currency: 'USD', fxRate: 1400, lines: [{ accountCode: '251', amount: 1450000, foreignAmount: 1000 }] });
  const pg = buildJournalLines(payGain);
  assert.deepEqual(pg.map((l) => [l.side, l.accountCode, l.amount]), [['DR', '251', 1450000], ['CR', '103', 1400000], ['CR', '907', 50000]]);
  assert.equal(sumSide(pg, 'DR'), sumSide(pg, 'CR'));
  // 환차 없음(장부=송금) → 환차 라인 없음
  const payEven = normalizeVoucherInput({ voucherType: '지급', voucherDate: '2026-08-31', currency: 'USD', fxRate: 1400, lines: [{ accountCode: '251', amount: 1400000, foreignAmount: 1000 }] });
  assert.equal(buildJournalLines(payEven).length, 2);
  // 원화 금액 비면 외화×환율로 보충 (3,553,000 = 2,538 × 1,400)
  const payAuto = normalizeVoucherInput({ voucherType: '지급', voucherDate: '2026-08-31', currency: 'USD', fxRate: 1400, lines: [{ accountCode: '251', foreignAmount: 2537.857 }] });
  assert.equal(payAuto.lines[0].amount, Math.round(2537.86 * 1400));
  assert.equal(payAuto.totalForeign, 2537.86);

  // ── 급여(§7-3: 합계 924,028 = 기본급+은행비+기타) → 급여 차변 / 보통예금 대변
  const salary = normalizeVoucherInput({
    voucherType: '급여', voucherDate: '2026-09-15', employeeName: 'Gabriel', period: '2026/09/01~09/12',
    lines: [{ accountCode: '802', amount: 900000, descr: '기본급' }, { accountCode: '831', amount: 20028, descr: '은행비' }, { accountCode: '811', amount: 4000, descr: '기타' }],
  });
  const sj = buildJournalLines(salary);
  assert.equal(salary.totalAmount, 924028);
  assert.equal(sj.at(-1).side, 'CR');
  assert.equal(sj.at(-1).accountCode, ACCOUNTS.BANK);
  assert.equal(sj.at(-1).amount, 924028);
  assert.match(sj.at(-1).descr, /Gabriel/);

  // ── 차대변 검증
  assert.throws(() => assertBalanced([{ side: 'DR', accountCode: '811', amount: 100 }, { side: 'CR', accountCode: '103', amount: 90 }]), /차변.*대변/);
  assert.throws(() => assertBalanced([]), /전표 금액 0/);

  // ── 역분개: 차대 뒤집힘, 금액 동일, 역분개 자체도 균형, 원전표+역분개 합산 시 계정별 순액 0
  const rev = reverseJournalLines(pl);
  assert.deepEqual(rev.map((l) => [l.side, l.accountCode, l.amount]), [['CR', '251', 1353000], ['DR', '103', 1400000], ['CR', '952', 47000]]);
  assert.ok(rev.every((l) => l.descr.startsWith('[역분개]')));
  const net = {};
  for (const l of [...pl, ...rev]) net[l.accountCode] = (net[l.accountCode] || 0) + (l.side === 'DR' ? l.amount : -l.amount);
  assert.ok(Object.values(net).every((v) => v === 0), '원전표+역분개 순액 0');

  // ── 상태 전이: 작성→결재완료→송금완료→전표반영, 취소는 결재완료 이후, 작성→송금완료 불가, 취소 후 불가
  assert.equal(canTransition('작성', '결재완료'), true);
  assert.equal(canTransition('작성', '송금완료'), false);
  assert.equal(canTransition('결재완료', '송금완료'), true);
  assert.equal(canTransition('송금완료', '전표반영'), true);
  assert.equal(canTransition('전표반영', '취소'), true);
  assert.equal(canTransition('작성', '취소'), false);
  assert.equal(canTransition('취소', '작성'), false);

  // ── 월별 소계·총계(명세 §6: 월별 계·총계 행)
  const s = summarizeByMonth([{ journalDate: '2026-08-01', totalDebit: 100 }, { journalDate: '2026-08-20', totalDebit: 142300 }, { journalDate: '2026-09-02', totalDebit: 1000 }]);
  assert.deepEqual(s.byMonth, [{ ym: '2026-08', total: 142400 }, { ym: '2026-09', total: 1000 }]);
  assert.equal(s.grand, 143400);

  console.log('voucherJournal tests passed');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
