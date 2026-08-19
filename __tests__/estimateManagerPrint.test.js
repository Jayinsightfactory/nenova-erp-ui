import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNASSIGNED_MANAGER,
  estimateShipmentGroupId,
  filterRecentParentWeeks,
  buildManagerPrintGroups,
  managerSelectionState,
  toggleManagerSelection,
  toggleCustomerSelection,
  summarizeManagerPrintSelection,
  pruneSelectionToGroups,
} from '../lib/estimateManagerPrint.js';

let pass = 0;
const fails = [];
function check(name, cond) {
  if (cond) pass += 1;
  else fails.push(name);
}

const ships = [
  { ParentWeek: '26', CustKey: 11, CustName: '주광농원', Manager: '김영업', totalAmount: 3000 },
  { ParentWeek: '26', CustKey: 12, CustName: '가나꽃', Manager: '김영업', totalAmount: 1000 },
  { ParentWeek: '26', CustKey: 13, CustName: '다라플라워', Manager: '이영업', totalAmount: 2000 },
  { ParentWeek: '26', CustKey: 16, CustName: '마바플라워', Manager: '이영업', totalAmount: 800 },
  { ParentWeek: '26', CustKey: 14, CustName: '무담당상회', Manager: '', totalAmount: 500 },
  { ParentWeek: '25', CustKey: 15, CustName: '지난차수꽃', Manager: '김영업', totalAmount: 700 },
];

// ── groupId 는 기존 일괄 인쇄와 같은 형식이어야 한다
check('groupId = ParentWeek_CustKey', estimateShipmentGroupId(ships[0]) === '26_11');

// ── 최근 차수 필터
check('recentOnly=false 면 전체', filterRecentParentWeeks(ships, false).length === 6);
check('recentOnly limit=1 이면 26차만', filterRecentParentWeeks(ships, true, 1).every(s => s.ParentWeek === '26'));
check('recentOnly limit=1 결과 5건', filterRecentParentWeeks(ships, true, 1).length === 5);
check('빈 배열 안전', filterRecentParentWeeks([], true).length === 0);

// ── 담당자 그룹
const groups = buildManagerPrintGroups(ships);
check('담당자 3그룹', groups.length === 3);
check('담당자 미지정은 마지막', groups[groups.length - 1].manager === UNASSIGNED_MANAGER);
check('빈 Manager 는 미지정으로 묶임', groups[groups.length - 1].customers.length === 1);
const kim = groups.find(g => g.manager === '김영업');
check('김영업 3업체', kim.customers.length === 3);
check('김영업 합계 4700', kim.totalAmount === 4700);
check('그룹 내 거래처명 가나다순', kim.customers.map(c => c.custName)[0] === '가나꽃');
check('groupIds 가 customers 와 일치', kim.groupIds.length === kim.customers.length);

// ── 담당자 칩 토글: 빈 상태에서 한 담당자만 누르면 그 담당자 업체만 선택된다
let sel = new Set();
check('초기 none', managerSelectionState(kim, sel) === 'none');
sel = toggleManagerSelection(sel, kim);
check('칩 클릭 후 all', managerSelectionState(kim, sel) === 'all');
check('김영업 업체만 3건 선택', sel.size === 3);
const lee = groups.find(g => g.manager === '이영업');
check('이영업 2업체', lee.customers.length === 2);
check('다른 담당자는 미선택', managerSelectionState(lee, sel) === 'none');

// ── 나머지 업체를 개별로 추가하면 함께 인쇄된다
sel = toggleCustomerSelection(sel, lee.groupIds[0]);
check('개별 추가 후 4건', sel.size === 4);
check('이영업 partial', managerSelectionState(lee, sel) === 'partial');
check('김영업은 여전히 all', managerSelectionState(kim, sel) === 'all');

// ── partial 상태에서 칩을 누르면 전체 선택으로 올라간다
sel = toggleManagerSelection(sel, lee);
check('partial → all', managerSelectionState(lee, sel) === 'all');
// ── all 상태에서 다시 누르면 해제되고 다른 담당자 선택은 유지된다
sel = toggleManagerSelection(sel, lee);
check('all → none', managerSelectionState(lee, sel) === 'none');
check('김영업 선택 유지', managerSelectionState(kim, sel) === 'all');

// ── 개별 토글은 두 번 누르면 원복
const before = sel.size;
sel = toggleCustomerSelection(sel, kim.groupIds[0]);
sel = toggleCustomerSelection(sel, kim.groupIds[0]);
check('개별 토글 왕복', sel.size === before);

// ── 요약
const summary = summarizeManagerPrintSelection(groups, sel);
check('요약 업체수 3', summary.customerCount === 3);
check('요약 담당자 1명', summary.managerCount === 1);
check('요약 담당자명', summary.managers[0] === '김영업');
check('요약 금액 4700', summary.totalAmount === 4700);

// ── 차수를 바꿔 재조회하면 사라진 선택은 세지도, 인쇄하지도 않는다
const staleSel = new Set(['99_999', ...kim.groupIds]);
check('없는 groupId 는 요약에서 제외', summarizeManagerPrintSelection(groups, staleSel).customerCount === 3);
const pruned = pruneSelectionToGroups(groups, staleSel);
check('prune 후 3건', pruned.size === 3);
check('prune 가 유령 groupId 제거', !pruned.has('99_999'));

// ── 원본 Set 을 변형하지 않는다 (React state 안전)
const original = new Set(kim.groupIds);
const snapshot = [...original];
toggleManagerSelection(original, kim);
toggleCustomerSelection(original, 'x');
pruneSelectionToGroups(groups, original);
check('입력 Set 불변', [...original].join() === snapshot.join());

// ── 페이지 배선 계약: 기존 일괄 인쇄 파이프라인을 재사용해야 한다
const page = fs.readFileSync('pages/estimate.js', 'utf8');
check('담당자별 출력 버튼 존재', page.includes('담당자별 견적서 출력'));
check('공용 groupId 헬퍼 사용', page.includes('estimateShipmentGroupId'));
check('좌측 목록도 공용 최근차수 필터 사용', page.includes('filterRecentParentWeeks'));
check('인쇄 직전 유령 선택 정리', page.includes('pruneSelectionToGroups(managerPrintGroups, managerPrintSel)'));
check('선택을 기존 selectedGroups 로 넘김', page.includes('setSelectedGroups(picked)'));
check('인쇄는 기존 openPrintDialog 재사용', page.includes('openPrintDialog(managerPrintFormat)'));
check('담당자별 전용 인쇄 경로를 새로 만들지 않음', !page.includes('doActualManagerPrint'));
check('좌측 전체선택도 보이는 업체 기준', page.includes('setSelectedGroups(new Set(visibleShipments.map(estimateShipmentGroupId)))'));

if (fails.length) {
  console.error(`\n=== 실패 ${fails.length}건 ===`);
  for (const f of fails) console.error(` ✗ ${f}`);
  assert.fail(`estimateManagerPrint: ${fails.length} failed`);
}
console.log(`estimate manager print: ${pass} passed, 0 failed`);
