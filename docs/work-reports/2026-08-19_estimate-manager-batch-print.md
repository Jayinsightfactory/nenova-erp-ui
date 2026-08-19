# 2026-08-19 견적서관리 — 담당자별 견적서 출력

## 요청

견적서 출력 버튼 옆에 「담당자별 견적서 출력」 버튼 추가.

1. 누르면 담당자와 해당 차수에 분배가 있는 업체만 표시
2. 담당자 선택 후 인쇄하면 그 담당자의 업체만 인쇄
3. 나머지 업체 중에서도 선택 활성화하면 함께 인쇄

## 구현

기존 일괄 인쇄 파이프라인을 그대로 재사용한다. 좌측 목록의 체크박스가 이미
`selectedGroups`(`${ParentWeek}_${CustKey}` 집합)로 다중 인쇄를 지원하고,
`doActualPrint`가 이를 담당자순으로 정렬해 한 번에 인쇄한다. 이번 작업은 그 앞단에
담당자 기준 선택 UI를 붙인 것이고, **담당자별 전용 인쇄 경로는 만들지 않았다.**

- `lib/estimateManagerPrint.js` (신규) — 선택 상태 계산 순수 함수
  - `buildManagerPrintGroups` — 담당자 → 업체 그룹. 정렬은 인쇄 순서와 동일
    (`compareEstimateShipmentsForPrint`)이라 화면 순서 = 인쇄 순서
  - `managerSelectionState` — `all` / `partial` / `none`
  - `toggleManagerSelection` — 담당자 칩 클릭. 다른 담당자 선택은 건드리지 않아
    여러 담당자를 함께 인쇄할 수 있고, `partial`에서는 전체 선택으로 올라간다
  - `toggleCustomerSelection` — 개별 업체 추가·제외 (요청 3번)
  - `pruneSelectionToGroups` — 차수를 바꿔 재조회한 뒤 남은 유령 선택 제거
  - `filterRecentParentWeeks` — 좌측 목록의 "최근 2개 차수" 필터를 공용화
- `pages/estimate.js`
  - 툴바에 `👤 담당자별 견적서 출력` 버튼
  - 담당자 칩 + 업체 체크박스 모달 (검색, 전체 선택/해제, 선택 요약)
  - 확정 시 `setSelectedGroups(picked)` → 기존 `openPrintDialog` → `doActualPrint`

### "해당 차수에 분배가 있는 업체"의 근거

별도 조회를 추가하지 않았다. `GET /api/estimate?week=&year=`가 돌려주는 `shipments`가
이미 그 정의다 — `sqlEstimateGetData`에서 `vs.OrderYearWeek` + `vs.DetailFix=1` +
`sdd.EstQuantity > 0`(또는 해당 차수 `Estimate` 차감)인 업체만 나오고, 각 행에
`Customer.Manager`가 붙어 있다.

### 곁들여 고친 버그

좌측 목록 헤더의 "전체 선택" 체크박스가 화면에 보이는 업체(`recentOnly` 필터 적용)가
아니라 `shipments` 전체를 대상으로 삼고 있었다. "최근 2개 차수" 상태에서 전체 선택을
누르면 보이지도 않는 지난 차수 업체까지 선택되고, 체크박스는 끝까지 완전 체크로
표시되지 않았다. 양쪽 모두 `visibleShipments` 기준으로 통일했다.

`${ParentWeek}_${CustKey}` 문자열을 조립하던 10곳을 `estimateShipmentGroupId()`로
통일해 모달과 그리드의 키가 어긋날 수 없게 했다.

## ERP 영향

없음 — 읽기 전용 기능이다. 새 API도, SQL 변경도, DB 쓰기도 없다. 인쇄 데이터는 기존
`printDetail=1` 경로를 그대로 쓴다. `OrderDetail`·`ShipmentDetail`·`Estimate` 무변경.

## 검증

- `node __tests__/estimateManagerPrint.test.js` — 40 passed (신규)
- `npm run test:estimate`
- `npm run test:erp-contract`
- `npm run test:ui-layout`
- `npm run test:erp-manifest -- --changed-from HEAD^`
- `npm run guard:erp-writes -- --changed-from HEAD^`
- `npm run build`
