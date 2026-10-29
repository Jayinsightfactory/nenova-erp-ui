# 2026-10-29 네덜란드 52차 연도 오등록

## 원인과 근거
사용자: 52차는 12월인데 2026년이 아닌 네덜란드 도착원가가 표시되는 것 같다.
SELECT-only 운영 probe: 2026/NL/52-2 현재본 Import23 54행, 파일 `37-2 NL 원가자료 (2).xlsx`, 시트52-2, 저장2026-09-22. RawJson에 연도 근거 없음. 이전 Import3/15 각54행은 이미 비활성. 현재54행 MATCH/BASIS_CHANGE 이력0. 실제 연도는 미확인으로 2025라고 재배정하지 않는다.
실제 dnSpy CLI `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseView "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"` 재실행: GetData WarehouseMaster.OrderYear/OrderWeek, GetDetail WarehouseDetail/Product 조회 확인. 웹 원가 변경은 native 원장과 분리한다.

## 기준 및 부작용
|동작|WebArrivalCostLine/History|Order/Shipment/Date/Farm/Stock/Warehouse|Estimate/ShipmentDetail.Amount·Vat·isFix/WebProfitReport|
|---|---|---|---|
|파싱/검증|쓰기 전 conflict 판정|보존|보존|
|정상 업로드|기존 동일연도·차수·국가 계약|보존|보존|
|배포 후54행 격리|IsCurrent만0, 전체 before/after 감사|보존|보존|

기준 원천: 실제DB 원본메타+공통파서. UI 선택연도는 원본 연도 증거가 아니다. 파일명 차수보다 늦은 시트이고 파일/시트 내부에 명시연도가 없으면 conflict. 파일명 차수 미확인 시 순서를 추정하지 않는다. 월/현재날짜/파일mtime으로 연도를 재배정하지 않는다. 원가·수량·환율 계산 불변. 공통 inferArrivalYearEvidence → validateArrivalImportYear 경로는 업로드와 자동입력에서 사용하며 rejectedRows도 검사한다. 기존 자동등록 verified 필수 조건 유지.
수정 범위52-2 외 Import23의47~51차에도 유사한 미확인자료가 있지만 운영 보정은 이번에 확인한52-2 54행만 제한한다.
메뉴기준: 적용=선택근거/실패이유/이력보존. 해당없음=새메뉴/레이아웃/키보드 변경.

## 검증
양성=36-2/37-2 선택연도 및 명시2026년52-2. 반례=2025/2026 선택연도 각각의 미확인52-2, 52-02/52-2A/47-1, rejectedRows, 명시2025와 선택2026 충돌. 명시연도없는 파일명의 차수도 없으면 추정하지 않음.
관련 단위검사 통과. 전체계약/빌드/CI/배포/브라우저/운영격리는 진행 중이며 아직 미검증.

- 2026-10-29 범위 보완: 동일 Import23의47-1(73),48-1(66),49-1(66),50-1(15),50-2(51),51-1(7),51-2(50),52-2(54), 총382행 모두 연도근거/수동수정이력0. 같은원인의 미확인 연말범위 전체를 격리 대상으로 확정(위54행 한정계획 대체).1~37차 및 다른Import/연도/국가는 보존. 아직 실행 전.
