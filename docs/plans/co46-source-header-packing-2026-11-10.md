# CO46 실제 AI 결과의 헤더·패킹 연결

## 기준과 부작용

설치 EXE의 FormWarehouseView를 2026-11-10 dnSpy CLI로 재확인했다.
OrderYear/OrderWeek와 WarehouseDetail.SteamOf1Box/SteamOf1Bunch는 독립 필드다.
기존 ExcelLoadingPackingList 계약과 writer/SP/재고 산식은 변경하지 않는다.
운영 DB 추가 접속·쓰기 없이 이전 SELECT-only 품목/농장 스냅샷과 실제 AI raw 6개를 사용한다.

|동작|WarehouseMaster/Detail|Product/Stock|Order/Shipment/Estimate/WebProfitReport|
|---|---|---|---|
|원문 헤더 자동 제안|보존|보존|보존|
|원가 패킹 해석·XLSX|읽기만|보존|보존|
|격리 입고 E2E|격리 fixture만 생성|격리 native writer만|sentinel 불변 확인|
|운영 코드 배포|보존|보존|보존|

## Criteria ledger

- bunch_st/steam_box: 실제 AI 원문 필드 → adapter.sourceEvidence.packing → verified receipt와 수량 일치 검증 → 원가 전용 단당 송이수. ERP bunchQuantity 누락을 임의 채우지 않는다. 명시 0/불일치/누락은 유효 양수로 치환하지 않는다.
- Farm: 활성 master의 유일 정규화 후보 우선. 같은 문자열의 과거 입고명칭은 master와 경쟁하지 않는다. 실제 master 2개는 차단. master가 없으면 원문 완전일치 이력 우선. fuzzy substring 연결 금지.
- Date: 4자리 연도가 앞에 있는 날짜는 YMD이며 date_order는 인쇄 원문 순서다. 달력 유효성·원문 충돌·선택 연도 검사는 유지한다. 오늘 날짜/현재 연도로 보정하지 않는다.
- MAWB: 같은 응답의 master_awb만 checksum 유효 11자리로 비교. 공백/하이픈만 동치. 서로 다른 유효 MAWB는 차단, HAWB는 별도 raw 필드 보존. 파일명으로 번호 추정하지 않는다.
- AIR: 유효 AWB의 기존 자동입력 정책 사용. 수기 값·COMMITTED·작업중 문서는 덮어쓰지 않는다.
- Excel: 원본 산식/계수 보존. 단당 송이수 미확인 상태로 null 문자열이나 #VALUE! 계산본을 다운로드하지 않는다.

UI/작업 순서 변경 없이 기존 자동 제안과 확인 흐름의 데이터 연결만 수정한다. 신규 안내영상 해당 없음.
검증 상태와 다운로드 근거는 work-session에 후속 기록한다.
