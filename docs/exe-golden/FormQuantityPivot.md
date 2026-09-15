# FormQuantityPivot — 피벗 품목 검색 표시 경계

## 2026-09-15 네이티브 필드 드래그 조작 경계

- DevExpress PivotGrid의 필드 버튼은 버튼 자체를 마우스로 잡아 행·열·값·필터 영역 사이로 이동하고, 같은 영역 안에서 순서를 다시 정한다.
- 웹도 별도 이동 아이콘을 주 조작으로 사용하지 않고 필드 버튼 전체를 HTML drag 대상으로 삼는다. 드래그 중 대상 영역과 정확한 삽입 위치를 파란 선으로 표시한다.
- 필드 오른쪽 화살표는 위치 이동이 아니라 실제 값 필터를 연다. 드롭 후 집계는 기존 브라우저 피벗 모델만 다시 계산한다.
- API, SQL, 조회 범위와 ERP 원장에는 변경이 없다. Order/Shipment/Warehouse/ProductStock/Estimate/WebProfitReport를 모두 보존한다.

## 2026-09-14 간격 조절 성능 경계

- 저장된 FormQuantityPivot_Load/GetData/btnExcel_Click 근거와 동일 원본 조회를 보존한다. UI 폭·높이 성능 개선에는 SQL/SP 변경이 없다.
- 너비 드래그 중에는 안내선만 표시하고 놓을 때 최종 폭을 적용한다. 숫자·병합 구조와 크기 표시를 분리하며 엑셀은 기존 전체 모델/최종 크기를 사용한다.
- 같은 세션 운영 GET 2026-37-01 2,517행은 읽기 확인 근거다. 성능 비교는 비식별 localhost fixture로 하고 ERP 원장은 보존한다.

## 2026-09-15 필드 값 필터 조작 경계

- 네이티브 PivotGrid의 필드 필터 버튼은 해당 필드의 실제 값 목록에서 표시값을 선택하는 동작이다. 필드를 필터 영역으로 이동하는 동작과 값 선택은 서로 다른 조작이다.
- 웹은 현재 조회된 `FormQuantityPivot.GetData` 결과의 distinct 값만 체크 목록으로 표시한다. 체크 결과는 브라우저의 공통 피벗 모델에 한 번 적용하여 화면 집계와 엑셀 출력이 같은 결과를 사용한다.
- 전체 선택은 필터 없음과 같고, 전체 해제는 의도적으로 0행을 표시한다. 필터 영역의 필드명 버튼은 값 목록을 바로 열며 `전체`, 단일 선택값, `첫 값 외 N` 상태를 버튼에 표시한다.
- 이 동작은 표시 전용이다. SQL 조건을 조립하거나 Order/Shipment/Warehouse/ProductStock/Estimate 원장을 변경하지 않는다.

## 2026-09-14 자동 조회·개인 조합 후속

- 저장된 dnSpy 소스 FormQuantityPivot_Load 25~29행은 SetCombo 다음 GetData를 실행한다. 웹도 페이지 진입 시 자동 조회한다.
- 기존 GetData 원본 SQL과 선택 연도·차수 조건은 변경하지 않는다. 필드 이동은 브라우저 집계/표시만 바꾼다.
- 웹 개인 즐겨찾기는 기존 UserFavorite(/api/favorites) 현재 인증 사용자 범위로 저장하며 native ERP 원장을 변경하지 않는다. EXE 즐겨찾기와 자동 공유된다는 의미는 아니다.

## 2026-09-14 표시 후속 수정 경계

- 사용자 EXE/웹 비교 화면을 기준으로 국가·꽃 행 병합, 연도/차수/구분/업체 다단 머리글,
  셀 테두리, 열 너비/행 높이, 버튼 인접 필터와 명시 정렬을 보완한다.
- 저장된 decompile `FormQuantityPivot.cs`의 `GetData` 및 `btnExcel_Click`을 재확인했다.
  조회 원본은 그대로이며 XLSX WYSIWYG 의미에 맞춰 표시 병합·숫자 형식을 내보낸다.
- 수량/입고단가/합계의 원본 number를 소수점 표시 설정으로 반올림 저장하지 않는다.
- 이번 수정에는 API/SQL/SP/ERP 원장 변경이 없으므로 새로운 DB 보정은 실행하지 않는다.
  원본 SQL 전수 대조 완료라는 의미가 아니며 표시와 조작 검증 범위다.

## 2026-09-14 전산 피벗 모드 실제 근거

- 재확인 CLI: `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormQuantityPivot "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
- `FormQuantityPivot.GetData`의 원본 필드 `ProdName`은 Product.ProdName 그대로다. 아래 과거 검색 표시 원칙의 접두어 제거는 웹 확장 화면에 한정하며 새 전산 피벗에는 적용하지 않는다.
- `StockMaster` 전체에서 LAG(StockKey) OVER(ORDER BY OrderYearWeek)를 구한 뒤 선택 시작~종료 완전키 범위를 읽는다. 전재고는 PrevStockKey, 현재고는 StockKey의 ProductStock.Stock != 0이다.
- 주문은 ViewOrder.OutQuantity > 0, 미발주수량은 ViewOrder.NoneOutQuantity > 0인 행의 OutQuantity(원본 특이사항), 출고는 ViewShipment+ShipmentDate+PeriodDay+CodeInfo의 양수 ShipmentQuantity, 입고는 ViewWarehouse.OutQuantity다.
- `FormQuantityPivot.btnExcel_Click`은 ExportType.WYSIWYG의 XLSX를 저장한다. 조회 결과와 원장은 변경하지 않는다.
- 전산 표에는 CounName/FlowerName/ProdName 기본 행, OrderYear/OrderWeek/ListType/CustName 기본 열, Quantity 값과 나머지 필터가 있다. 실제 화면 사용자가 CustName을 필터로 옮긴 상태도 확인했다.
- 네이티브 실행 화면에서 국가/꽃/구분 필터 조합과 2025~2026 교차연도 열을 읽기 확인했다. 웹 운영 2026-37-01 조회 표도 정상 렌더를 확인했다. 원천 SQL 전체 행 DB 대조는 아직 미실행이며 화면 조회만으로 숫자 전부 일치 판정하지 않는다.
- 표 필드 메뉴의 Reload Data/Best Fit/Order(처음·왼쪽·오른쪽·끝)/Show Field List/Show Filter Editor를 확인했다. 웹 정식 접근은 최신 사용자 지시에 따라 모두 좌클릭이다.
- 새 API /api/stats/pivot-exe는 기존 sqlQuantityPivotGetData만 호출하며 별도 원장 쓰기·재계산·필터 SQL 조립을 하지 않는다. 시작/종료 연도를 각각 검증한다.
- 2026-09-15 웹 확장: FormQuantityPivot 원본 UNION/수량 의미는 변경하지 않는다. 기존 웹 피벗에서 이미 사용하던 읽기 전용 값만 후처리로 보강한다. `분배단가`는 `ShipmentDetail.Cost`를 `OutQuantity`로 가중평균하고 `OrderYear + OrderWeek + CustKey + ProdKey`로 결합한다. `도착원가`는 운송원가 스냅샷/live 계산 결과의 품목별 최고 표시원가(부가세 별도)를 입고 행에만 결합한다. 보강 조회가 실패하면 EXE 원본 표는 유지하고 누락 값을 경고한다.
- 모든 조작에서 OrderMaster/OrderDetail, ShipmentMaster/Detail/Date/Farm, WarehouseMaster/Detail, ProductStock/StockHistory, Estimate/WebProfitReport 보존.
- 웹의 배치판도 원본 피벗의 공간 관계를 따라 필터는 맨 위, 행 필드는 표 왼쪽, 열 필드는 표 위쪽, 값 필드는 숫자 영역에 고정해 드롭 결과를 위치만으로 이해할 수 있게 한다.

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

