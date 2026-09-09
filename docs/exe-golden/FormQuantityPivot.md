# FormQuantityPivot — 피벗 품목 검색 표시 경계

source: `C:\Users\USER\nenova-decompiled\Nenova\FormQuantityPivot.cs`
verification: `docs/exe-golden/README.md`의 FormQuantityPivot 등록 및 기존 피벗 계약·읽기 전용 조회 구조

## 검색·표시 원칙

- 피벗 행의 업무 식별자는 `OrderYear`, `OrderWeek`, `ProdKey`를 포함한다.
- 화면의 품목명(색상)은 `Product.ProdName`에서 꽃 접두어를 제거한 canonical 값으로 표시한다.
- 검색어는 표시값만 변경하지 않고 국가·품종·영문 품목명·한글 표시명을 별칭으로 추가한다.
- 검색 별칭은 선택 시 canonical `prodName`으로 되돌아가므로 피벗 집계행이나 ERP 원장을 쓰지 않는다.
- 이 보강은 피벗 통계 검색 UI의 read-only 후보 필터에만 적용한다.

## 변경 범위

`lib/pivotProductSearch.js`는 `수국화이트`, `수국 화이트`, `Hydrangea White`를 같은 canonical 품목 후보로 찾기 위한 정규화 모듈이다. `pages/stats/pivot.js`는 기존 옵션 목록과 exact filter 값을 유지하고, 후보 표시 단계에서만 별칭을 사용한다.

## 2026-09-09 차수피벗 표시 전용 보강 근거

- 실제 설치 `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`를 로컬 `dnSpy.Console.exe --no-color -t Nenova.FormQuantityPivot`로 재확인했다.
- `GetData`는 StockMaster 연도·차수 범위와 ViewOrder, ViewShipment/ShipmentDate, ViewWarehouse, ProductStock을 조회한다. 업체 강조·품명 검색에는 별도 저장 작업이 없다.
- 웹 `/shipment/week-pivot`의 기존 조회는 그대로 유지한다. 새 검색은 원본 `prodKeys`/집계 이후 화면 `visibleProdKeys`만 거르고, 업체 강조는 선택 범위의 현재 주문·출고 양수 여부만 읽는다.
- 2026-37-01 운영 GET 근거: customers 1,024행 및 시작/확정재고 조회 모두 HTTP 200/success=true, 원장 변경 0건. 고객별 원문은 커밋하지 않는다.
- 비고 원문과 삭제 시 사용하는 고객·품목·차수·행 인덱스는 보존하고 표시 방향만 가로 한 줄로 바꾼다. 기존 Excel 입력, Amount/Vat/isFix, Estimate, WebProfitReport에 변화 없음.

