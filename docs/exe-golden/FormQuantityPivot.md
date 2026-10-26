# FormQuantityPivot — 피벗 품목 검색 표시 경계

## 2026-10-26 물량표 메뉴 단일차수·입고 우선 기본
- 실제 설치 EXE dnSpy.Console `FormQuantityPivot` 재확인: SetCombo는 시작/끝에 같은 첫 항목을 지정하며 GetData의 ViewWarehouse 및 btnExcel_Click의 ExportToXlsx 유지.
- 웹은 기존 사용자 요청에 맞춰 선택연도 최신 양수 입고→최신 주문→빈값으로 기본 선택. 미래 주문50-01을 실제입고44-01보다 우선하던 오류 제거. native StockMaster 최상위값 기본과 의도적 UI 차이이며 SQL 원장 계약 변경 없음.
- 운영 SELECT 2026 ViewWarehouse44-01 273행 / OrderMaster MAX50-01. 2026/43-02/Cust533/Prod1487 출고200·확정·금액/날짜/농장 및 확정매출 조회 근거는 `docs/plans/volume-menu-week-2026-10-26.md`.
- `volumeMenuWeeks` 앞뒤5/연도경계/단일·명시범위 helper와 실제 pivot-weeks handler 2025/2026/invalid fixture. 조회·다운로드 GET만 사용하며 주문/분배/입고/재고/견적/매출 보존.

## 2026-09-29 피벗 환율 미리보기
- 실제 dnSpy.Console.exe --no-color -t FormQuantityPivot 재확인: GetData/ViewWarehouse/ExportToXlsx. native 조회/수량과 모든 원장 보존.
- 운영 SELECT 2026 current 원가의 RawJson CNF 외화/원화/도착원가/단당수량 확인. 기존 환율 helper의 비용 누락0 역산을 쓰지 않고 원본 대조된 SOURCE 행만 외화 비용 재계산. 관세 포함 KRW 구성은 유지.
- 기존 국가별 통화 명시 매핑, 연도/품목/세부차수 기준 유지. 38-01 BeSweet50cm 원본1450/10205, 외화 단당6.787302840599327와 KRW363.4108811309761 분리 확인. 복수농장은 새 환율로 각각 계산 후 MAX.
- UI 메모리만 변경, XLSX 동일 모델 + 환율 기준 시트. 근거 없는 행은 빈칸/이유 표시. pivotArrivalFx.test.js 교차연도·실패·복원·농장MAX·엑셀 실행 검증.

## 2026-09-29 업로드 도착원가 연결

- 실제 dnSpy.Console FormQuantityPivot GetData/ViewWarehouse/ExportToXlsx 재실행. 원본 피벗 SQL·수량 보존.
- 2026-09-15의 운송원가/입고전용 확장 정의를 대체: 업로드 WebArrivalCostLine 현재본을 OrderYear+정규화 세부차수+ProdKey로 결합, 없으면 같은 연도 이전 최신 세부차수. 복수농장 MAX, Product.OutUnit 환산. 모든 구분의 참고값으로 표시하며 원장 쓰기 없음.
- 운영 SELECT에서 Be Sweet50cm1330 최신37-1=10,205/9,625,60cm1371=10,495 확인. 38/39 콜롬비아 원가 없음. 화면은 이전차수 참조임을 명시.
- 그리드·엑셀 도착원가 표시만 소수0자리, 저장 원본과 엑셀 숫자 소수 보존. fixture는 pivotArrivalReference.test.js.

## 2026-09-28 로딩 표시

- dnSpy.Console FormQuantityPivot GetData/ViewOrder/ViewWarehouse/ExportToXlsx 재확인. 원본8,066행/콜롬비아장미 입고01차4,858·02차4,330 읽기 probe 재확인.
- 필터·모델 함수를 동일하게 worker에서 호출하고 화면 표시 후만100%. 단계 진행률은 서버 처리량 백분율이 아니다. SQL/ERP/단위/집계 정책 보존. worker 전송에서 lazy aoa 제외.

## 2026-09-28 필터 요약·메인차수 합산

- 실제 dnSpy.Console --no-color -t FormQuantityPivot 재실행: GetData 입고는 ViewWarehouse.OutQuantity/FarmName, 주문은 ViewOrder.OutQuantity/CustName, btnExcel_Click WYSIWYG 확인.
- 운영 읽기 probe 2026 01-01~02-02:8,066행. 콜롬비아 장미 입고01-01=4,148/01-02=710, 주문5,010/1,220. 입고 CustKey=NULL. 두 사용자 화면은 필터와 배치가 달랐다.
- 원본 필터 후 브라우저 합산; OrderYear 격리, 원본/API/ERP 보존. snapshot 수량 합산 경고, 단가 기존 집계 유지. 자세한 기준/부작용은 work-sessions/2026-09-28_pivot-main-week.md.

## 2026-09-16 필터 값 사용자 순서

- 실제 dnSpy.Console -t FormQuantityPivot 재확인: GetData 조회 및 btnExcel_Click의 ExportToXlsx. SQL/원장 쓰기는 변경하지 않는다.
- 웹에서 필터 값 순서를 사용자 지정하며 피벗 양 축과 WYSIWYG XLSX는 같은 모델을 소비한다. EXE 자체에 개인 순서를 저장한다는 의미는 아니다.
- 개인 설정 valueOrders만 확장하며 주문·분배·재고·견적·매출 및 원본 수량은 보존한다. 2026 37-01 운영 읽기 2,604행/거래처 코드58개는 직전 동일 세션 근거다.

## 2026-09-16 거래처 주문코드 표시 필드

- 설치 EXE를 `dnSpy.Console.exe --no-color -t FormQuantityPivot` 및 `-t ClassCustomer`로 재확인. 피벗 GetData는 주문/미발주/출고에 CustKey, 전재고/입고/현재고에는 NULL CustKey를 반환한다.
- ClassCustomer.OrderCode는 Customer에서 읽는 문자열이며 CustCode와 별개다. ViewOrder.OrderCode는 주문별 값이므로 사용자 요청인 거래처 정보 값으로 대체해서 추정하지 않는다.
- 웹 원본 피벗 SQL을 보존하고 활성 Customer(CustKey,OrderCode) SELECT 후 일대일 map 보강한다. 신규 필드 CustOrderCode(거래처 주문코드)는 기본 필터이며 다른 필드와 동일하게 행/열/값/필터 배치·정렬·엑셀·개인 조합 저장이 가능하다.
- 2026-09-16 운영 거래처관리 읽기 전용 확인: 673행 및 주문코드 CL22/CL77/CL88 확인. 원장 쓰기 없음. 코드 필드 추가는 native EXE 자체의 UI 변경이 아니다.
- Customer, Order, Shipment, Warehouse, ProductStock, Estimate, WebProfitReport 보존. 수량·원본 행수 불변, 보강 실패는 경고하며 기존 표 유지.

## 2026-09-15 상단 가로 이동바·도구 공간 재배치

- 긴 피벗 표의 본문 가로 스크롤과 동일한 위치를 공유하는 상단 이동바를 제공한다. 어느 쪽을 움직여도 다른 쪽과 가상 열 창이 즉시 동기화된다.
- 1920×1080에서는 필드 배치판 오른쪽의 빈 공간에 표시 옵션·크기 설정·즐겨찾기 도구를 배치한다. 1450px 이하에서는 한 열로 내려가 핵심 조작이 잘리지 않게 한다.
- 표시 구조만 바꾸며 `FormQuantityPivot.GetData` SQL, 조회 범위, 집계 원본, 엑셀 및 ERP 원장은 변경하지 않는다.

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

### 2026-09-16 페이지 스크롤 표시 변경

- 로컬 dnSpy CLI 실제 설치본의 `FormQuantityPivot.GetData`, `btnExcel_Click` / `ExportToXlsx(ExportType.WYSIWYG)`를 재확인했다.
- 이번 변경은 웹 표의 세로 스크롤 소유권과 렌더링 구간만 바꾼다. 기존 원본 조회·연도/차수·집계·엑셀 모델은 보존하며 API/DB 호출을 추가하지 않는다.
- 직전 거래처 주문코드 작업의 2026-37-01 운영 GET 2,604행 근거를 재사용한다. 이번 표시 검증은 DB 대신 12,000건 합성 fixture로 수행한다.

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



## 2026-10-20 웹 음수 주문 표시 확장
실제 설치 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`의 FormQuantityPivot.GetData를 dnSpy.Console로 재추출: 주문 분기는 OutQuantity > 0. 실제 EXE 화면 전체의 표시 여부를 단정하지 않는다.
사용자 요청으로 웹 공통 SQL의 주문 분기만 `OutQuantity <> 0`으로 변경한다. 모든 국가와 조회 연도·차수에 적용하며, 음수는 원본 부호 그대로 표시·SUM·엑셀에 반영한다. 기존 전산 SQL 완전 동일이라는 설명보다 이 확장 계약이 우선한다. EXE 파일과 공유 원장은 변경하지 않는다.
2026/44-01 운영 읽기 근거: 콜롬비아 수국4행/-17, 카네이션26행/-76이 ViewOrder에 존재하며 기존 피벗 주문 분기에서 제외됨. StockList 연결은 모두 충족. Stock/입고/출고/미발주 분기는 보존한다.
회귀: `__tests__/pivotNegativeOrders.test.js`의 2025/2026, 01-01/44-01/44-02, 3국가, 양음수 합계7, 음수전용-7, 상쇄0, XLSX 숫자 보존.


## 2026-10-20 NENOVA.EXE 음수 주문 피벗
사용자가 native EXE의 모든 차수·국가 음수 표시와 합계 차감을 명시 요청. 기존 4033996D SHA256 버전은 unsigned/IL-only이고 ` WHERE vo.OutQuantity > 0 `의 IL 참조는 FormQuantityPivot.GetData 한 곳이다. 같은 길이 ` WHERE vo.OutQuantity <>0 `로 #US 내용 2바이트만 변경한다. 메타데이터/IL/입고·출고·재고/엑셀 경로 그대로 유지.
기준: 동일 연도 포함 OrderYearWeek BETWEEN/StockList 조인, 0/NULL 제외, SUM 부호 유지, 모든 국가 공통. 동작별 부작용: 조회/합계/엑셀 모두 OrderDetail·ShipmentDetail·ShipmentDate·ShipmentFarm·ProductStock·StockHistory·Estimate·WebProfitReport 보존. DB 쓰기 없음.
실제 수정 EXE를 .NET Framework x86에서 로드해 FormQuantityPivot의 grid 생성(Load/GetData 미호출), 2025/2026×01-01/44-01/44-02×3국가의 +10/-3를 바인딩. native SummaryType=Sum, -3/7/총126 확인. 실제 WYSIWYG XLSX도 -3/7/126 numeric cell 확인.
원본/수정 EXE에서 추출한 SQL 직접 SELECT 비교: 20264401 기존1227행 동일+음수31행/-103, 대상 콜롬비아 카네이션 여분26행/-76. 20264402 588행,20254401 3336행 동일. 개인정보 출력/저장 없음.
원본/수정 hash: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63 / FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 배포는 사용자 PC만, 다른 직원 실행파일 자동변경 아님. 실행중 프로세스 강제종료 금지, 닫힌 뒤 원본 백업과 atomic replace.
메뉴 기준선: 적용—기존 화면/키보드/스크롤/필터 보존. 해당 없음—웹 shell/입력/매칭/DB쓰기. 화면상 실제 로그인 조회는 아직 미검증. native control 시험과 실제SQL 읽기검증은 완료.

## 2026-10-26 피벗 필터 동기화·복구
- 기존 헤더/필드 선택 상태 동기화 및 마지막 체크 해제 0행 유지. EXE 국가/품종/품목 조건을 명시 초기화하며 고급조건은 보존. 양쪽 상단 전체 초기화 제공.
- dnSpy.Console -t FormQuantityPivot 실제 EXE GetData ViewOrder/ViewWarehouse/ExportToXlsx 재확인. SELECT-only 2026/43-02/CustKey533/ProdKey1487 수량200/DetailFix1, NativeDateJoins1. SQL·수식·ERP 원장 불변.
- 기준/검증: docs/work-sessions/2026-10-26_pivot-filter-sync.md.
