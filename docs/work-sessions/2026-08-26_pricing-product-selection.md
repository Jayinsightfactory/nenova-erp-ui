# 업체별 품목 단가관리 품목 전체/부분 선택

Q. 품목도 전체 선택 후 일부만 해제하고 싶다.

## 구현 전 기준과 부작용

- 원천: 기존 pricing-matrix 조회의 ProdKey. SQL/API/권한/단가 저장 계약 변경 없음.
- 조회 직후 반환된 품목 전체 선택. 품목 선택창에서 전체 선택/해제와 개별 체크 제공.
- 검색·단가 없는 품목 숨김·품목 선택은 별개 상태. 체크를 해제해도 선택창에서는 다시 선택할 수 있다.
- 매트릭스는 선택한 품목만 표시. 일괄 단가 지정은 선택되어 현재 표시되는 품목에만 적용.
- 선택 변경 자체는 저장이 아니며 이미 편집한 단가를 삭제하지 않는다. 기존 저장 버튼이 변경분을 저장한다.
- CustomerProdCost/Order/Shipment/Estimate/Stock/ShipmentDate/ShipmentFarm/WebProfitReport는 선택 동작에서 모두 보존.
- dnSpy CLI FormCustomerProdCost를 다시 확인: btnModify_Click은 변경행 CustKey+ProdKey 기준 Delete/Insert 트랜잭션. 이번 화면 선택 기능은 웹 전용이며 그 저장 경로를 변경하지 않는다.
- 직접 DB 환경은 준비되지 않았으며 SQL 변경이 없는 브라우저 상태 기능이다. 운영 단가 저장을 하지 않고 브라우저 선택 상태만 검증한다.

## 검증 상태

실행형 선택/일괄 적용 범위 fixture, test:erp-contract 전체, dnSpy evidence, manifest(changed-from origin/master), ERP write guard, build(98 pages), diff --check 통과.

PR366 병합 a63ab2c, 배포32930972811 성공(2분48초). 운영 화면 버전 확인. 수연원예/콜롬비아 조회1012개 초기 전체 선택 → Moon Light 해제1011개 및 해당 표 행0 → 전체 선택 복원1012개/행1 → 전체 해제0개·품목 선택 안내 → 전체 선택 복원 확인. Moon Light 검색 시 후보1개, 전체 선택 상태1012개 유지. 모든 단계 저장0개 비활성: 단가 입력·저장/운영 DB 쓰기는 실행하지 않음.
