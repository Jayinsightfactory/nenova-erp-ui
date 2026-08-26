# 단가관리 품목도 최근 거래이력 기본 표시

Q. 업체처럼 품목도 거래이력 있는 것만 기본으로 보여달라.

## 기준 원천과 사용 위치

- 앞선 업체 기준과 동일: 한국시간 오늘 포함90일, 미래 제외. 전사 양수 주문 또는 출고 이력 기준(단가 등록 여부가 아님).
- OrderMaster.OrderDtm+활성 OrderDetail.OutQuantity, 활성 ShipmentMaster+ShipmentDetail.ShipmentDtm/OutQuantity. PK로 join하고 ProdKey로 집계. OrderWeek만 비교하지 않음.
- dnSpy ClassOrderDetail/ClassShipmentDetail CLI 재확인: ProdKey, OutQuantity, master PK, 날짜/삭제 컬럼 확인. ShipmentDetail.isDeleted 사용 금지.
- GET은 전체 조회 품목에 최근거래 메타데이터 추가. 검색 전 후보/초기선택만 최근 품목, 명시 검색시 과거 품목도 선택 가능.
- 선택한 과거 품목은 검색어를 지워도 표에 유지. 전체 선택/해제는 보이는 후보만 변경.
- 기존 일반/EXE parity 모두 같은 최근거래 판정. canonical parity SQL과 PUT 단가 저장 함수는 유지.

## 부작용

Product/OrderMaster/OrderDetail/ShipmentMaster/ShipmentDetail SELECT만. CustomerProdCost·재고·견적·출고일·농장·매출 원장 모두 preserve. 운영 단가 저장으로 테스트하지 않는다. 독립 DB 접속 환경이 없어 배포 후 읽기전용 화면 결과로 SQL 성공과 목록 축소/검색을 확인한다.

## 상태

실행형 recent flag/검색 override/과거 선택 보존/부분선택 fixture, test:erp-contract 전체, dnSpy evidence, manifest(changed-from origin/master), write guard, build98페이지, diff --check 통과. PUT 저장 함수는 기준 커밋과 문자열 동일 확인. 배포 후 실제 최근목록/과거 검색을 확인할 예정.
