import assert from 'node:assert/strict';
import { buildSalesPasteAiPreview, buildSalesPasteMatchName, buildSalesPasteOrderChanges, buildSalesPasteRows, buildSalesPasteText, buildSalesPasteWeekChoices, chooseSalesPasteParsedOrders, convertSalesPasteQtyToOutUnit, countSalesPasteQuantityLines, normalizeDetectedSalesPasteWeek, normalizeSalesPasteInputText, replaceSalesPasteProduct, replaceSalesPasteUnit, resolveDetectedSalesPasteScope, salesManagerCustomers, salesManagerOptions, salesPasteCountryContext, salesPasteUnitOptions } from '../lib/salesPasteOrder.js';

const weeks = buildSalesPasteWeekChoices(new Date(2026, 7, 31));
assert.equal(weeks.length, 8, '베이스부터 +3까지 각 1·2 세부차수를 보여야 합니다.');
assert.deepEqual([...new Set(weeks.map(row => row.offset))], [0, 1, 2, 3]);
assert.equal(weeks.filter(row => row.offset === 0).length, 2);
assert.equal(weeks[0].week, '36-01', '2026-08-31 영업 베이스 차수는 36차부터 보여야 합니다.');
assert.deepEqual(resolveDetectedSalesPasteScope('36-2', weeks), { year: '2026', week: '36-02' });
assert.equal(normalizeDetectedSalesPasteWeek('37차'), '37-01', '원문 단일 차수는 1차로 해석');
assert.equal(normalizeDetectedSalesPasteWeek('37-2차'), '37-02', '원문 세부차수 표기를 우선');
assert.equal(normalizeDetectedSalesPasteWeek('2026년 36-2차'), '2026-36-02', '연도 포함 원문 차수를 보존');
assert.equal(normalizeDetectedSalesPasteWeek('2026년 37차'), '2026-37-01', '연도 포함 단일 차수도 1차로 해석');
assert.equal(normalizeDetectedSalesPasteWeek('2026-36-02'), '2026-36-02', 'API가 반환한 정규형을 화면에서 다시 해석할 수 있어야 함');
assert.deepEqual(resolveDetectedSalesPasteScope('2026년 36-2차', weeks), { year: '2026', week: '36-02' });
assert.equal(normalizeDetectedSalesPasteWeek('36-3'), '', '지원하지 않는 세부차수는 자동 선택하면 안 됩니다.');
assert.equal(resolveDetectedSalesPasteScope('40-1', weeks), null, '베이스~+3 밖의 차수는 조용히 다른 연도로 추정하면 안 됩니다.');
assert.equal(salesPasteCountryContext('36-2 콜 수국 추가 발주'), '콜롬비아');
assert.equal(buildSalesPasteMatchName('수국 화이트', '수국', '콜롬비아'), '콜롬비아 수국 화이트');
assert.match(buildSalesPasteText({ year: 2026, week: '36-01', customerName: '꽃길', text: '돈셀 2박스' }), /^2026년 36-01차\n꽃길\n돈셀 2박스$/);
const slashInput = `36-2 콜 수국 추가 발주
진핑크 8박스\\
블루 7박스\\
화이트 44박스\\
연핑크 3박스\\
진핑크 4박스`;
assert.equal(normalizeSalesPasteInputText(slashInput), `36-2 콜 수국 추가 발주
진핑크 8박스
블루 7박스
화이트 44박스
연핑크 3박스
진핑크 4박스`, '줄 끝 역슬래시 때문에 수량행이 누락되면 안 됩니다.');
assert.doesNotMatch(buildSalesPasteText({ year: 2026, week: '36-02', customerName: '꽃길', text: slashInput }), /박스\\/);
assert.equal(countSalesPasteQuantityLines(slashInput), 5);
const completeLlm = { orders: [{ custName: '꽃길', items: [
  { inputName: '진핑크', qty: 8 }, { inputName: '블루', qty: 7 }, { inputName: '화이트', qty: 44 }, { inputName: '연핑크', qty: 3 }, { inputName: '진핑크', qty: 4 },
] }] };
const partialRules = { orders: [{ custName: '꽃길', items: [{ inputName: '진핑크', qty: 4 }] }] };
assert.equal(chooseSalesPasteParsedOrders({ text: slashInput, llmParsed: completeLlm, naturalParsed: partialRules }).source, 'llm', 'LLM이 5개 수량행을 모두 찾고 규칙 파서가 일부만 찾으면 LLM을 사용해야 합니다.');
assert.equal(chooseSalesPasteParsedOrders({ text: slashInput, llmParsed: { orders: [{ items: [...completeLlm.orders[0].items, { inputName: '환각', qty: 1 }] }] }, naturalParsed: completeLlm }).source, 'rules', 'LLM 품목이 원문 수량행보다 많으면 완전한 규칙 결과를 우선해 과잉 등록을 막아야 합니다.');
assert.deepEqual(buildSalesPasteAiPreview({ orders: [{ custName: '꽃길', custMatch: { CustName: '꽃길 전산' }, items: [{ inputName: '화이트', qty: 44, unit: '박스', action: '추가', prodKey: 101, displayName: '수국 화이트' }] }] }).map((row) => [row.customerName, row.inputName, row.qty, row.matchedName]), [['꽃길 전산', '화이트', 44, '수국 화이트']]);
const customers = [{ ManagerName: '김영업', CustKey: 1 }, { ManagerName: '이영업', CustKey: 2 }];
assert.deepEqual(salesManagerOptions(customers, { userName: '박영업' }), ['김영업', '박영업', '이영업']);
assert.deepEqual(salesManagerCustomers(customers, '이영업').map(row => row.CustKey), [2]);
const rows = buildSalesPasteRows([{ custName: '꽃길', items: [{ prodKey: 7, prodName: 'Doncel', qty: 2, unit: '박스' }, { inputName: '미매칭', qty: 1 }] }], [{ ProdKey: 7, CurrentQty: 3 }]);
assert.deepEqual(rows.map(row => [row.prodKey || null, row.currentQty, row.finalQty]).sort((a, b) => Number(b[0] || 0) - Number(a[0] || 0)), [[7, 3, 5], [null, 0, null]]);
const merged = buildSalesPasteRows([{ items: [{ prodKey: 7, qty: 2, unit: '박스' }, { prodKey: 7, qty: 3, unit: '박스' }] }], [{ ProdKey: 7, CurrentQty: 4 }]);
assert.deepEqual(merged.map(row => [row.qty, row.currentQty, row.finalQty]), [[5, 4, 9]], '같은 품목·단위는 등록 전 합산해야 합니다.');
assert.deepEqual(buildSalesPasteOrderChanges(merged).map(row => [row.beforeQty, row.afterQty, row.deltaQty]), [[4, 9, 5]], '현재 주문 최상단 변경 요약은 기존→변경 수량과 증감량을 보여야 합니다.');
assert.deepEqual(buildSalesPasteOrderChanges([{ prodKey: 7, currentQty: 4, finalQty: 4, unit: '박스' }]), [], '수량이 달라지지 않은 품목은 변경 강조하면 안 됩니다.');
const mixedUnits = buildSalesPasteRows([{ items: [{ prodKey: 7, qty: 2, unit: '박스' }, { prodKey: 7, qty: 3, unit: '단' }] }], [{ ProdKey: 7, CurrentQty: 4 }]);
assert.equal(mixedUnits.every(row => row.unitConflict && row.finalQty === null), true, '동일 품목의 혼합 단위는 환산 근거 없이 합산하면 안 됩니다.');
const repeatedPink = buildSalesPasteRows([{ items: [{ prodKey: 9, qty: 8, unit: '박스' }, { prodKey: 9, qty: 4, unit: '박스' }] }], []);
assert.deepEqual(repeatedPink.map(row => row.qty), [12], '같은 진핑크 두 줄은 한 품목 12박스로 합산해야 합니다.');
const unitProduct = { ProdKey: 10, OutUnit: '송이', BunchOf1Box: 10, SteamOf1Bunch: 20, SteamOf1Box: 200, CurrentQty: 40 };
assert.equal(convertSalesPasteQtyToOutUnit(2, '단', unitProduct), 40, '단 선택은 FormOrderAdd와 같은 SteamOf1Bunch 기준으로 OutUnit 송이로 환산해야 합니다.');
assert.deepEqual(salesPasteUnitOptions(unitProduct), ['박스', '단', '송이'], '환산 근거가 있는 단위만 선택지로 보여야 합니다.');
assert.deepEqual(salesPasteUnitOptions({ unit: '박스', outUnit: '송이' }), ['박스', '송이'], '환산 계수가 없는 near-miss에서는 단을 선택 가능하다고 표시하면 안 됩니다.');
const changedUnit = replaceSalesPasteUnit(buildSalesPasteRows([{ items: [{ prodKey: 10, qty: 2, unit: '송이', outUnit: '송이', bunchOf1Box: 10, steamOf1Bunch: 20, steamOf1Box: 200 }] }], [unitProduct]), 0, '단', [unitProduct]);
assert.deepEqual(changedUnit.map(row => [row.qty, row.unit, row.deltaOutQty, row.currentQty, row.finalQty]), [[2, '단', 40, 40, 80]], '단위를 바꾸면 입력수량은 보존하고 현재/등록 후 수량은 OutUnit으로 다시 계산해야 합니다.');
const rematched = replaceSalesPasteProduct([
  { inputName: '화이트', qty: 44, unit: '박스', currentQty: 0, finalQty: null },
  { inputName: '기존 화이트', prodKey: 101, qty: 2, unit: '박스' },
], 0, { ProdKey: 101, ProdName: 'Hydrangea White', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '콜롬비아' }, [{ ProdKey: 101, CurrentQty: 3 }]);
assert.deepEqual(rematched.map(row => [row.prodKey, row.qty, row.currentQty, row.finalQty]), [[101, 46, 3, 49]], '수동 매칭 뒤 동일 품목은 합산하고 현재/등록 후 수량을 다시 계산해야 합니다.');
const { matchImportRow } = await import('../lib/orderImportMatch.js');
const colombiaWhite = { ProdKey: 101, ProdName: 'Hydrangea White (화이트)', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '콜롬비아', OutUnit: '박스' };
const ecuadorWhite = { ProdKey: 102, ProdName: 'Hydrangea White (화이트)', DisplayName: '수국 화이트', FlowerName: '수국', CounName: '에콰도르', OutUnit: '박스' };
const contextualWhite = matchImportRow({ rowNo: 1, inputName: '수국 화이트', matchName: '콜롬비아 수국 화이트', qty: 44, unit: '박스' }, {
  allProducts: [ecuadorWhite, colombiaWhite], productByKey: new Map([[101, colombiaWhite], [102, ecuadorWhite]]), prodUnitMap: { 101: '박스', 102: '박스' }, savedMappings: {}, unitCatalog: {},
});
assert.equal(contextualWhite.prodKey, 101, '콜 수국 헤더의 화이트는 콜롬비아 Hydrangea White로 확정해야 합니다.');
console.log('sales paste order helper tests passed');
