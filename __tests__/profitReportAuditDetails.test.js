// 매출이익 보고서 경고 상세(무엇이·얼마나·어디서) 메시지 빌더 회귀 테스트
// 실행: node __tests__/profitReportAuditDetails.test.js
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};

async function main() {
  const d = await import('../lib/profitReportAuditDetails.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');

  console.log('\n=== 콜롬비아 38-01 누락 / 38-02 입력 ===');
  const weeks = [
    { orderWeek: '38-01', gw: 0, total: 0, saved: false, forwardingDetected: true,
      components: { GW: null, CW: null, HandlingFee: null, ItemCount: null, Truck1t: null, Truck2_5t: null, Truck5t: null, CustomsFee: null, DisinfectFee: null, QuarantineDeductFee: null } },
    { orderWeek: '38-02', gw: 5076, total: 2708960, saved: false, forwardingDetected: true,
      components: { GW: 5076, CW: 5076, HandlingFee: null, ItemCount: null, Truck1t: 1, Truck2_5t: 0, Truck5t: 1, CustomsFee: null, DisinfectFee: null, QuarantineDeductFee: null } },
  ];
  const col = d.buildColombiaCustomsDetail(weeks, { orderYear: '2026', major: 38, currentH: 2708960 });
  check('요약에 누락 반차수와 빠진 구성요소 이름', col.summary.includes('누락 반차수 38-01(GW(kg)·CW(kg)·트럭 1t 대수·트럭 5t 대수 없음)'), col.summary);
  check('요약에 입력된 반차수', col.summary.includes('입력됨 38-02'), col.summary);
  const s01 = col.sections.find((s) => s.orderWeek === '38-01');
  check('38-01 missingVsPeers = 38-02엔 있고 38-01엔 없는 것', JSON.stringify(s01.missingVsPeers) === JSON.stringify(['GW(kg)', 'CW(kg)', '트럭 1t 대수', '트럭 5t 대수']), JSON.stringify(s01.missingVsPeers));
  const gwItem = s01.items.find((i) => i.field === 'GW');
  check('GW 항목에 38-02 비교값', gwItem.status === 'missing' && gwItem.compare === '38-02: 5,076kg', JSON.stringify(gwItem));
  check('양쪽 다 없는 구성요소는 한 줄로 접힘', s01.items.some((i) => i.label === '모든 반차수에 값 없음' && i.value.includes('선율 통관수수료') && i.value.includes('관세료')));
  check('영향: H·I·J 약 2,708,960원', col.impact.amount === 2708960 && col.impact.text.includes('약 2,708,960원'), col.impact.text);
  check('고칠 곳: 그외통관비 입력 38-01 미리선택', col.fix.action === 'customs' && col.fix.focus === '38-01'
    && col.fix.href === '/sales/customs-clearance?year=2026&week=38&focus=38-01', JSON.stringify(col.fix));

  console.log('\n=== 콜롬비아 전 반차수 누락(40차) — 영향 계산 불가 ===');
  const none = d.buildColombiaCustomsDetail([
    { orderWeek: '40-01', gw: 0, total: 0, components: {} },
    { orderWeek: '40-02', gw: 0, total: 0, components: {} },
  ], { orderYear: '2026', major: 40 });
  check('두 반차수 모두 GW 없음', none.summary.includes('40-01(GW(kg) 없음), 40-02(GW(kg) 없음)'), none.summary);
  check('영향 계산 불가 + 사유', none.impact.amount == null && none.impact.text.startsWith('영향 계산 불가'), none.impact.text);

  console.log('\n=== 국가 그외통관비 구성요소 ===');
  const ctry = d.buildCountryCustomsDetail({ category: '태국', auto: { H: 0 } },
    { orderYear: '2026', major: 39, inboundWeeks: ['39-01'], components: { GW1: 120, Customs1: 50000 } });
  check('있음/없음 구분', ctry.summary.includes('있음: 백상창고료 GW 1차(kg) 120kg, 관세 1차 50,000원') && ctry.summary.includes('없음: 백상창고료 GW 2차(kg)'), ctry.summary);
  check('국가 포커스 링크', ctry.fix.href.endsWith(`focus=${encodeURIComponent('태국')}`), ctry.fix.href);

  console.log('\n=== 과세환율 없음 — 참고환율로 영향 계산 ===');
  const rate = d.buildRateDetail({ category: '호주', currency: 'AUD', auto: { Q: 1000, S: 0 },
    rateSuggestions: [{ rate: 900, label: '39차 과세환율' }] }, { orderYear: '2026', major: 40 });
  check('요약: 통화·구매·참고환율', rate.summary === '호주 과세환율 없음 — AUD 구매 1,000 (참고 39차 과세환율 900)', rate.summary);
  check('영향 금액 = (Q+S)×참고환율', rate.impact.amount === 900000 && rate.impact.text.includes('약 900,000원'), rate.impact.text);

  console.log('\n=== 재고 단가 누락 품목 이름 ===');
  const stk = d.buildStockPriceDetail({ category: '중국', stock: { endQty: 12, week: '40-02',
    missingPriceItems: [{ prodKey: 11, displayName: '장미 레드', unit: '단' }] } }, 'F', { orderYear: '2026', major: 40 });
  check('품목명(번호)·스냅샷', stk.summary === '중국 기말상품재고액(F) — 매입단가 근거 없는 품목 1건: 장미 레드(11) (재고수량 12, 스냅샷 40-02)', stk.summary);
  check('재고 매입단가 입력 버튼', stk.fix.action === 'stockPrice');

  console.log('\n=== 항공료 누락 범위 ===');
  const fwd = d.buildForwardingDetail({ category: '콜롬비아 수국', orderYear: '2026', major: 40,
    missingScopes: [{ orderWeek: '40-01', category: '콜롬비아 수국' }, { orderWeek: '40-02', category: '콜롬비아 수국' }] });
  check('누락 반차수·품목', fwd.summary === '콜롬비아 수국 항공료(S) — 누락: 40-01 콜롬비아 수국, 40-02 콜롬비아 수국', fwd.summary);
  check('포워딩 링크 40-01', fwd.fix.href === '/sales/forwarding-clearance?year=2026&week=40&focus=40-01', fwd.fix.href);

  console.log('\n=== buildProfitReportAudit 통합 — 판정·원문 불변, detail 첨부 ===');
  const colombiaRow = (category) => ({ category, auto: { N: 1, Q: 10, S: 1, H: 677240, R: 1400 }, manual: {}, source: { H: 'partial', S: 'auto' }, stock: {} });
  const audit = buildProfitReportAudit([colombiaRow('콜롬비아 장미'), colombiaRow('콜롬비아 카네이션')],
    { major: 38, orderYear: '2026', colombiaWeeks: weeks });
  const issue = audit.issues.find((i) => i.code === 'CUSTOMS_INCOMPLETE');
  check('누락 반차수 문구(입력 화면·전산 모두 없음)', issue.message.includes('누락 반차수(입력 화면·전산 입고 모두 GW 없음): 38-01.'), issue.message);
  check('detail.summary 첨부', issue.detail?.summary?.includes('38-01(GW(kg)·CW(kg)'), issue.detail?.summary);
  check('현재 4품목 H 합계 반영', issue.detail.impact.text.includes('현재 4품목 H 합계 1,354,480원'), issue.detail.impact.text);
  check('상태·건수 불변', audit.status === 'needs_input' && audit.errorCount === 1);

  const unc = buildProfitReportAudit([{ category: '기타(미분류)', auto: { N: 0, O: 41818 }, manual: {}, source: {}, stock: {} }], { major: 38 });
  check('미분류: 0 아닌 값만 이름으로', unc.issues[0].detail.summary === '기타(미분류) — 본표 합계 밖 값: 그 외 매출(O) 41,818원', unc.issues[0].detail.summary);

  if (failed) { console.error(`\n${failed}건 실패`); process.exit(1); }
  console.log('\n모든 경고 상세 테스트 통과');
}
main().catch((e) => { console.error(e); process.exit(1); });
