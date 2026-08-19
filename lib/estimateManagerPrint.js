// 담당자별 견적서 출력 — 선택 상태 계산 (순수 함수)
//
// 인쇄 대상은 기존 일괄 인쇄와 동일한 `${ParentWeek}_${CustKey}` groupId 집합이다.
// 담당자 칩은 "그 담당자의 업체 전체"를 토글하고, 개별 업체 체크박스로 추가·제외할 수 있다.
// 담당자 이름은 Customer.Manager 이며 비어 있으면 '담당자 미지정'으로 묶인다
// (`lib/estimatePrintOrder.js#getEstimateShipmentManager` 와 동일 규칙).
import { getEstimateShipmentManager, compareEstimateShipmentsForPrint } from './estimatePrintOrder.js';

export const UNASSIGNED_MANAGER = '담당자 미지정';

export function estimateShipmentGroupId(ship) {
  return `${ship?.ParentWeek ?? ''}_${ship?.CustKey ?? ''}`;
}

/**
 * 좌측 출고 목록의 "최근 2개 차수만" 필터와 동일한 규칙.
 * 모달에 보이는 업체와 그리드에 보이는 업체가 어긋나지 않도록 양쪽이 이 함수를 쓴다.
 */
export function filterRecentParentWeeks(shipments = [], recentOnly = false, limit = 2) {
  if (!recentOnly || shipments.length === 0) return [...shipments];
  const recent = [...new Set(shipments.map(s => s.ParentWeek))]
    .sort((a, b) => String(b).localeCompare(String(a)))
    .slice(0, limit);
  return shipments.filter(s => recent.includes(s.ParentWeek));
}

/**
 * 담당자별 그룹 목록. 인쇄 순서와 같은 정렬(담당자 → 거래처명 → CustKey)을 쓰므로
 * 화면 순서가 실제 인쇄 순서와 일치한다. '담당자 미지정'은 항상 마지막이다.
 */
export function buildManagerPrintGroups(shipments = []) {
  const byManager = new Map();
  for (const ship of [...shipments].sort(compareEstimateShipmentsForPrint)) {
    const manager = getEstimateShipmentManager(ship);
    if (!byManager.has(manager)) byManager.set(manager, []);
    byManager.get(manager).push({
      groupId: estimateShipmentGroupId(ship),
      custKey: ship?.CustKey,
      custName: String(ship?.CustName || '').trim(),
      parentWeek: ship?.ParentWeek,
      totalAmount: Number(ship?.totalAmount || 0),
    });
  }
  return [...byManager.entries()].map(([manager, customers]) => ({
    manager,
    customers,
    groupIds: customers.map(c => c.groupId),
    totalAmount: customers.reduce((sum, c) => sum + c.totalAmount, 0),
  }));
}

/**
 * 검색어 필터. 담당자명이 걸리면 그 담당자의 업체를 모두 남기고,
 * 아니면 거래처명이 걸리는 업체만 남긴다.
 *
 * ⚠ `groupIds`/`totalAmount`를 반드시 남은 `customers`로 재계산한다. 스프레드로
 * 원본 `groupIds`를 물려주면 담당자 칩이 검색에서 숨은 업체까지 선택해 버린다.
 */
export function filterManagerPrintGroups(groups = [], query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => {
      if (g.manager.toLowerCase().includes(q)) return g;
      const customers = g.customers.filter(c => c.custName.toLowerCase().includes(q));
      return {
        ...g,
        customers,
        groupIds: customers.map(c => c.groupId),
        totalAmount: customers.reduce((sum, c) => sum + c.totalAmount, 0),
      };
    })
    .filter(g => g.customers.length > 0);
}

/** 담당자 칩 상태 — 'all' | 'partial' | 'none' */
export function managerSelectionState(group, selected) {
  const ids = group?.groupIds || [];
  if (ids.length === 0) return 'none';
  const hit = ids.filter(id => selected.has(id)).length;
  if (hit === 0) return 'none';
  return hit === ids.length ? 'all' : 'partial';
}

/**
 * 담당자 칩 클릭 — 부분 선택 상태에서는 전체 선택으로 올린다(한 번 더 누르면 해제).
 * 다른 담당자의 선택은 건드리지 않으므로 여러 담당자를 함께 인쇄할 수 있다.
 */
export function toggleManagerSelection(selected, group) {
  const next = new Set(selected);
  const ids = group?.groupIds || [];
  if (managerSelectionState(group, selected) === 'all') {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return next;
}

export function toggleCustomerSelection(selected, groupId) {
  const next = new Set(selected);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  return next;
}

/**
 * 선택 요약. groups 에 없는 groupId(차수 재조회로 사라진 업체)는 세지 않는다.
 */
export function summarizeManagerPrintSelection(groups = [], selected = new Set()) {
  const known = new Set(groups.flatMap(g => g.groupIds));
  const selectedIds = [...selected].filter(id => known.has(id));
  const managers = groups
    .filter(g => g.groupIds.some(id => selected.has(id)))
    .map(g => g.manager);
  const totalAmount = groups
    .flatMap(g => g.customers)
    .filter(c => selected.has(c.groupId))
    .reduce((sum, c) => sum + c.totalAmount, 0);
  return { customerCount: selectedIds.length, managers, managerCount: managers.length, totalAmount };
}

/**
 * 인쇄 직전 정리 — 현재 차수에 존재하는 groupId만 남긴다.
 * 차수를 바꿔 재조회한 뒤 옛 선택이 남아 빈 인쇄가 나가는 것을 막는다.
 */
export function pruneSelectionToGroups(groups = [], selected = new Set()) {
  const known = new Set(groups.flatMap(g => g.groupIds));
  return new Set([...selected].filter(id => known.has(id)));
}
