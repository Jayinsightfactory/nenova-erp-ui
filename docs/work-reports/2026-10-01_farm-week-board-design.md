# 차수별 농장표 설계

## 합의된 화면
- 메뉴: 차수별 농장표. 상단 보기 탭: 농장별 입고 / 주문·입고 비교 / 분배·입고 비교.
- 차수와 국가·품종은 단일 선택 활성 버튼. 전체 품종 버튼/드롭다운 없음.
- 기본값: 기존 웹 getCurrentWeek 기준 다음 세부차수. 연도는 반드시 별도 전달.
- 왼쪽 품목, 위 농장, 숫자 우측 정렬, 빈 수량 공란. 헤더/품목 고정, 열 너비 조절.
- 1920×1080 우선, 작은 화면 가로 스크롤. 탭 변경 시 선택 보존.

## 읽기 계약 / 부작용
|동작|읽기|쓰기|
|---|---|---|
|품종 버튼|활성 Product의 국가+품종|없음|
|입고|WarehouseMaster/Detail, Product: 기존 pivotStats 입고 조건|없음|
|주문|활성 OrderMaster/Detail, Customer, Product의 OutQuantity|없음|
|분배|활성 ShipmentMaster, Customer, Product + ShipmentDetail.OutQuantity, 확정/미확정 모두|없음|
|재고조정 참고|StockHistory AfterValue-BeforeValue, 기존 물량표 제외유형 동일|없음|

각 자료를 UNION ALL 후 집계해 주문×입고×분배 다대다 곱집계를 방지한다.
업무키는 OrderYear+OrderWeek+ProdKey, 농장은 물량표와 동일 FarmName.
농장 미입력은 별도 미지정 열. 주문/분배만 있는 품목도 비교에서 누락하지 않는다.
수량은 저장 OutQuantity, 표시단위 Product.OutUnit. 혼합 단위 총합 금지.
입고-주문 / 입고-분배 차이는 당차수 물량 비교이며 실제 가용재고가 아니다.
재고조정은 농장 입고로 위장하지 않고 별도 참고 열. 기존 인쇄 합계와 대조 가능.
Estimate, ShipmentDate/Farm, Amount/Vat/isFix, ProductStock, WebProfitReport 모두 보존.

## 근거
- 2026-10-01 실제 dnSpy.Console.exe --no-color -t FormQuantityPivot Nenova.exe 실행: GetData, ViewOrder.OutQuantity 확인.
- docs/exe-golden/FormQuantityPivot.md 및 lib/pivotStats.js 입고/주문 원천 확인.
- 읽기 전용 DB probe 39-02: 2025 Order/Warehouse/Shipment 헤더 33/24/34, 2026 58/38/58. 연도 격리 필수.
- docs/CODEX_SUBTASK_ORCHESTRATION.md가 두 checkout에 없어 하위작업 지침은 적용 불가. 메인에서 수행.

## 완료 조건
동일 연도·차수 물량표 대조, 교차연도/혼합단위/미입고/미주문/분배만 fixture,
인증/GET전용/오류·빈값 구분, 최신 요청만 표시, layout/ERP guard/build 통과 후 배포.
