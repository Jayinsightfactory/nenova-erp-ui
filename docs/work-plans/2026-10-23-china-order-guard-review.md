# 중국 물량표 주문 보존 및 native 신규 주문 재검토

사용자: 기존 주문100에서 물량표80은 주문100/분배80, 새 업체·품목 양수는 주문+분배 동시 등록. 기존 등록분배 MD와 dnSpy를 함께 검토.

## 구현 전 근거와 범위
- 기준 b30bb5a8. 실제 dnSpy CLI로 FormOrderAdd와 FormShipmentDistribution 재추출.
- FormOrderAdd 셀 환산: 단→송이는 SteamOf1Bunch, 박스→송이는 SteamOf1Box 우선. UnitQuantity(false)는 EstUnit의 실제 환산 열을 그대로 읽으며 주문에 출고용 정수 반올림을 적용하지 않는다.
- FormShipmentDistribution은 ShipmentDetail→명시 Farm→ShipmentDate 순서이며 기존 주문을 수정하지 않는다. GetShipmentMaster는 연도/차수/업체로 조회하고 삭제 헤더를 제외하지 않는다.
- NATIVE_SHIPMENT_HEADER_CONTRACT: 삭제 헤더를 무시한 신규 생성 금지. 미리보기와 저장 재검사 모두 같은 snapshot reader 사용.
- 실제 SQL 반례: 새 업체535/품목2232/8단 입력 후 주문 EstQuantity8(기대80) 재현. 기존 주문100/분배80/날짜80은 통과. 기존 helper의 신규 INSERT가 OutQuantity를 EstQuantity에 복제했다.
- FormOrderAdd.md의 '분배 양수가 기존 주문 덮어쓰기'는 현행 resolveImportOrderSyncPlan 및 최신 사용자 계약과 충돌하므로 정정한다.

## 부작용 및 기준
|동작|OrderDetail|Shipment/Date|그 외 원장|
|---|---|---|---|
|기존 주문100→물량표80/0/120|모든 열 보존|입력 최종값 SET|기존 계약 보존|
|주문 없는 양수|신규만 native 단위별 Out/Est 및 환산열|같은 transaction 신규|Estimate/Stock/WebProfitReport 보존|
|삭제 출고헤더 존재|보존|전체 거부, 자동복구 없음|보존|

중국 전용 신규 주문 환산 helper를 미리보기/쓰기/커밋전 검증에서 공유한다. 다른 source의 과거 신규 주문 동작은 이번 범위에서 바꾸지 않는다. 기존 주문의 불일치도 자동 보정하지 않는다.

## 운영 SELECT-only 기준선
2026/43-03 Cust533 Prod2295 주문200/분배200/Date합200/ViewOrder1/ViewShipment1/DetailFix1/견적join2(날짜행), Prod3279 100/100/Date100/견적join1.
2026/43-01 Cust13 Prod2158 20/20 및2226 10/10, 양쪽 View1, Date합 일치, Farm0, DetailFix1/견적join1.
43-01 중국 주문행2025=172/2026=166, 2026 확정136행 Amount24151183/Vat2415117. 읽기 기준선이며 새 저장 성공 증거가 아님. 운영 DML 없음.

## 검증 계획
격리 SQL: 정확100→80, 신규 업체/헤더8단→80송이, 반복 적용, 감소/0, 이전연도, 삭제헤더/삭제경합, 신규 Est 변조 rollback. 단위 helper: 박스/단/송이/소수/0/환산없음. 공용 네덜란드 SQL 회귀 및 필수 ERP gates. 메뉴 기준선: 기존 정책 적용, UI 변경/신규 메뉴 해당 없음.
