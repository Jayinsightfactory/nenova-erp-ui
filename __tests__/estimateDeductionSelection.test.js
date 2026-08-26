import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEstimateDeductionDeletePayload,
  eligibleEstimateDeductions,
  isAllowedDeductionEstimateType,
  resetEstimateDeductionSelection,
  selectAllEligibleEstimateDeductions,
  toggleEstimateDeductionSelection,
} from '../lib/estimateDeductionSelection.js';

const defect = {
  EstimateKey: 91, ShipmentKey: 501, ProdKey: 701,
  EstimateTypeRaw: 'FEE03-KR0010', EstimateType: '불량차감',
  Quantity: -3, Cost: 1100, Amount: -3000, Vat: -300,
  Unit: '단', DescrRaw: '파손', Descr: '표시용 비고', outDate: '2026-08-20',
  DeleteSnapshot: {
    quantity: -3.25, cost: 1100.5, amount: -3250, vat: -326.625,
    unit: '단', estimateType: 'FEE03-KR0010', descr: '파손', estimateDate: null,
  },
};
const quarantine = {
  EstimateKey: 92, ShipmentKey: 502, ProdKey: 702,
  EstimateType: '검역차감/박스', Quantity: -2, Cost: 2200, Amount: -4000, Vat: -400,
  Unit: '박스', Descr: '검역', outDate: '2026-08-21',
  DeleteSnapshot: {
    quantity: -2.5, cost: 2200.25, amount: -5000, vat: -500.625,
    unit: '박스', estimateType: '검역차감/박스', descr: '검역', estimateDate: '2026-08-21',
  },
};

assert.equal(isAllowedDeductionEstimateType('fee03-kr0009'), true);
assert.equal(isAllowedDeductionEstimateType('FEE03-KR0019'), true);
assert.equal(isAllowedDeductionEstimateType('불량차감/단'), true);
assert.equal(isAllowedDeductionEstimateType('검역차감'), true);
assert.equal(isAllowedDeductionEstimateType('판매요청'), false);
assert.equal(isAllowedDeductionEstimateType('FEE03-KR0015'), false);
for (const label of ['불량차감', '검역차감']) {
  for (const unit of ['단', '박스', '송이', '스팀', '스팀(대)', '대', '개', '봉지']) {
    assert.equal(isAllowedDeductionEstimateType(`${label}/${unit}`), true);
  }
}
for (const type of ['불량차감/아무값', '불량차감취소', '판매요청/단', '검역차감/단/박스']) {
  assert.equal(isAllowedDeductionEstimateType(type), false);
}

const normalShipment = { ...defect, EstimateKey: 93, SdateKey: 4 };
const positive = { ...defect, EstimateKey: 94, Quantity: 3, DeleteSnapshot: { ...defect.DeleteSnapshot, quantity: 3 } };
const otherDeduction = { ...defect, EstimateKey: 95, EstimateTypeRaw: 'FEE03-KR0015' };
otherDeduction.DeleteSnapshot = { ...defect.DeleteSnapshot, estimateType: 'FEE03-KR0015' };
const eligible = eligibleEstimateDeductions([defect, quarantine, normalShipment, positive, otherDeduction]);
assert.deepEqual(eligible.map((item) => item.EstimateKey), [91, 92]);

let selection = resetEstimateDeductionSelection();
selection = toggleEstimateDeductionSelection(selection, defect.EstimateKey, true);
assert.deepEqual([...selection], [91]);
selection = selectAllEligibleEstimateDeductions([defect, quarantine], selection);
assert.deepEqual([...selection].sort((a, b) => a - b), [91, 92]);
selection = selectAllEligibleEstimateDeductions([defect, quarantine], selection);
assert.equal(selection.size, 0, '전체 선택을 다시 누르면 현재 필터의 선택만 해제한다.');

const payload = buildEstimateDeductionDeletePayload({
  orderYear: 2026, orderWeek: '34', custKey: 401,
  items: [defect, quarantine, positive], selectedKeys: new Set([91, 92]),
  editGuard: { revision: 3, editDigest: 'before' },
});
assert.deepEqual(payload, {
  orderYear: '2026', orderWeek: '34', custKey: 401,
  entries: [
    {
      estimateKey: 91, shipmentKey: 501, prodKey: 701,
      expected: {
        quantity: -3.25, cost: 1100.5, amount: -3250, vat: -326.625, unit: '단',
        estimateType: 'FEE03-KR0010', descr: '파손', estimateDate: null,
      },
    },
    {
      estimateKey: 92, shipmentKey: 502, prodKey: 702,
      expected: {
        quantity: -2.5, cost: 2200.25, amount: -5000, vat: -500.625, unit: '박스',
        estimateType: '검역차감/박스', descr: '검역', estimateDate: '2026-08-21',
      },
    },
  ],
  editGuard: { revision: 3, editDigest: 'before' },
});

assert.throws(
  () => buildEstimateDeductionDeletePayload({
    orderYear: 2026, orderWeek: '34', custKey: 401,
    items: [{ ...defect, DeleteSnapshot: undefined }], selectedKeys: new Set([91]), editGuard: {},
  }),
  /삭제 확인정보가 없습니다/,
  '원본 스냅샷이 없는 행을 표시값으로 보정해서 삭제하면 안 된다.',
);

const page = fs.readFileSync('pages/estimate.js', 'utf8');
assert.match(page, /buildEstimateDeductionDeletePayload/, '화면이 공통 삭제 payload helper를 사용해야 한다.');
assert.match(page, /DeleteSnapshot/, '화면 삭제 요청은 표시값이 아닌 원본 DeleteSnapshot을 사용해야 한다.');
assert.match(page, /선택 차감 삭제 중…/, '삭제 진행 상태를 표시해야 한다.');
assert.match(page, /selectedDeductionCount/, '삭제 버튼은 선택 건수를 표시해야 한다.');
assert.match(page, /불량·검역 전체 선택/, '선택 가능한 차감 전체선택을 표시해야 한다.');
assert.match(page, /저장하지 않은 단가·수량·추가 품목이 있습니다/, '미저장 편집값이 있으면 삭제 불가 사유를 표시해야 한다.');
assert.match(page, /shouldApply/, '삭제 후 늦은 목록 응답은 scope가 같은 경우에만 화면에 적용해야 한다.');
assert.match(page, /삭제는 완료, 목록 재조회 실패/, '삭제 성공 뒤 재조회 실패를 삭제 실패로 표시하면 안 된다.');
const loadStart = page.indexOf('const load = (silent = false, opts = {}) =>');
const loadEnd = page.indexOf('// 자동조회: 차수/거래처 변경 시 자동 로드', loadStart);
const loadErrorContract = page.slice(loadStart, loadEnd).replace(/\s+/g, ' ');
assert.ok(
  loadErrorContract.includes("if (!sameEstimateSelectionScope(scope, renderedSelectionScopeRef.current) || (typeof opts.shouldApply === 'function' && !opts.shouldApply()) || !shouldApply()) return { skipped: true };")
    && loadErrorContract.includes("if (typeof opts.shouldApply === 'function') throw error;"),
  'pages/estimate.js:1479-1488 load catch는 stale scope/호출자 guard 실패를 skipped 처리하면서 현재 captured refresh 오류는 호출자에게 재전파해야 한다.',
);
for (const label of ['＋ 불량/검역등록', '＋ 불량차감등록', '＋ 판매요청', '＋ 추가 품목등록', '단가 + 업체 지정단가 함께 저장']) {
  assert.ok(page.includes(label), `${label} 기능을 유지해야 한다.`);
}

console.log('estimate deduction selection tests passed');
