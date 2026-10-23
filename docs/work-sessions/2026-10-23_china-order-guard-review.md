# 중국 물량표 dnSpy 및 등록·분배 지침 재검토

## 질문과 결과
Q. 기존 주문100에서 물량표80이면 주문100/분배80인가? 새 업체·품목은 주문등록+분배인가? 기존 MD와 dnSpy까지 검토.
A. 기존 주문100/분배80/날짜80을 실제 격리 MSSQL에서 확인했다. 기존 주문의 수량·환산·이력 필드 전체를 비교해 보존을 검증했다. 새 업체의 주문·출고 헤더와 주문8단/분배8단도 함께 생성된다.

## 발견 및 보완
- FormOrderAdd.md에 과거 양수 주문 덮어쓰기 설명이 남아 있어 현행 주문 보존 정책으로 정정.
- 신규 주문 EstQuantity가 OutQuantity로 복제되는 반례8단→Est8을 검출. 중국 전용 native helper로 Est80을 저장하고 미리보기/쓰기/커밋전 재검증에서 공유. 기존 주문과 다른 source 동작은 보존.
- native GetShipmentMaster의 삭제필터 부재 때문에 삭제 헤더가 있는 중국 동일 업무키는 저장 차단. 앞선 연도 삭제 헤더는 제외하고, preview 이후 등장한 삭제 헤더도 transaction에서 거부.

## 검토한 기준
ERP_CHANGE_GUARD, ERP_FEATURE_CHANGE_CHECKLIST, ERP_COMPAT_INVARIANTS, WEB_VS_ERP_CONFLICTS(ViewOrder/ViewShipment), DB_STRUCTURE, NENOVA_DNSPY_CLI_WORKFLOW, NATIVE_SHIPMENT_HEADER_CONTRACT, FormOrderAdd/FormShipmentDistribution/DutchVolumeDistribution golden, week-pivot-distribution/china-volume-distribution 계약, 2026-07-20 견적매출 영향 및2026-08-12 분배 수정 가드.
오래된 문서의 단독 예시는 실제 dnSpy/현재 SQL 및 최신 계약보다 우선하지 않는다. 예: 과거 Manager 표시명/연도 없는 Master 조회/Order.Est=Out 복제는 재사용하지 않는다.

## 근거와 검증
- 실제 설치 EXE CLI 재실행(소스는 로컬 .tmp). 원본 FormOrderAdd 셀 환산/UnitQuantity, FormShipmentDistribution 저장 순서 확인.
- 운영 SELECT-only ViewOrder/ViewShipment/ShipmentDate/Farm/견적 DetailFix=1/확정매출 기준선은 work-plans/2026-10-23-china-order-guard-review.md.
- 중국 실제 SQL:100→80, 신규8단/80송이, 반복 no-op, 감소 후 원주문 보존, 신규 Est 변조 rollback, 삭제헤더/전년도/경합, 기존 전체 시나리오 통과.
- 네덜란드 실제 SQL 회귀 통과. 필수 전체 gate/PR/배포 결과 후속 기록.
- 운영 주문·분배 시험쓰기 없음. 실제 EXE GUI 저장은 미검증이며 공유 원장/native JOIN/격리 SQL 검증과 구분한다.
- 메뉴 기준선: 기존 주문보존 정책 적용, 신규 UI/메뉴/레이아웃 변경 해당 없음.

검색어: china-order-guard-review 주문100 분배80 신규주문 견적환산 삭제헤더
