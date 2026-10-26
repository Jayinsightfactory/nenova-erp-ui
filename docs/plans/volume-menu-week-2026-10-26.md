# 물량표 메뉴 기본차수·단일 선택

## 기준 / 구현 전 근거
- 대상 `/stats/volume-board`만. 네덜란드·중국 편집 화면 및 원장 쓰기는 변경하지 않는다.
- 기존 사용자 요청의 실제 입고 최신차수 우선 정책(`defaultPivotBoardWeek`)을 공통 물량표에도 적용한다. 입고가 없을 때만 선택 연도 최신 주문, 둘 다 없으면 빈 선택. 미래 주문 MAX를 입고보다 우선하지 않는다.
- 운영 SELECT 2026: 최대 주문 50-01, 양수 ViewWarehouse 최신 입고 44-01(273행), 43-03(5행), 43-02(269행). API는 명시 OrderYear로 격리한다.
- 설치 EXE dnSpy `FormQuantityPivot.SetCombo/GetData/btnExcel_Click` 재실행: 최초 시작/끝 동일, ViewWarehouse 조회, ExportToXlsx 확인. 웹의 사용자 지정 기본값은 native 최상위 목록값을 그대로 복제하지 않는다.
- SELECT-only downstream 2026/43-02/CustKey533/ProdKey1487: 출고200, DetailFix1, Amount381818/Vat38182, 날짜조인1, 농장0; 확정272행/Amount64195123/Vat6419507. 이번 UI 조회 변경으로 값을 수정하지 않는다.

| 동작 | 기준 / 소비자 | 원장 부작용 |
|---|---|---|
| 진입·연도변경 | 선택연도 양수 입고 최신 → 주문 최신 → 빈값; 이전연도 선택 폐기 | SELECT만 |
| 단일차수 선택(기본) | 시작=끝; 버튼 앞뒤5개, 01~04 세부차수 공통 순서, 연도경계 순환금지 | 브라우저만 |
| 범위 조회(명시 활성화) | 기존 시작/끝 기능 유지, 끄면 끝=시작 및 합산false | 브라우저만 |
| 직접입력 | 01-01~52-04 정규화; 목록 범위 밖 허용 | 브라우저만 |
| 조회·다운로드 | 동일 OrderYear/weekStart/weekEnd; 범위 변경시 이전 품종목록 폐기 | 기존 GET만 |

Order/Shipment/Warehouse/Stock/Product/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport 및 Amount/Vat/isFix 보존. SQL 쓰기·환산·수량/매출 집계 로직 변경 없음.

## 검증 계획
- 미래주문50-01 대 실제입고44-01, 누락/빈값/0/false, 입고없는연도, 교차연도, +/-5 및 연초말 경계 실행 fixture.
- 단일/범위 전환, 직접입력, 키보드, 조회·다운로드 동일차수, 변경후 이전목록 무효화.
- ERP 계약/dnSpy/manifest/write guard/week검증/build, 로컬 브라우저 및 배포 후 운영 GET 스모크.
