# EXE Pivot 통계 전체 조작 웹 구현

## 요청 및 고정 기준

- 사용자는 FormQuantityPivot의 필드·필터·버튼 전체를 웹에서도 실제 작동하게 요청했다.
- 최신 정정: 모든 조작은 좌클릭으로 접근한다. 우클릭 전용 기능은 금지한다. 드래그는 선택적 보조 수단이다.
- 기본 검증 viewport 1920×1080 CSS px,100%; 작은 화면에서도 기능 접근 보장.
- 기존 물량표·도착원가·웹 확장 화면과 원장 쓰기 경로를 보존한다.
- 조회/배치/필터/내보내기는 Order/Shipment/Warehouse/ProductStock/Estimate/WebProfitReport 전체 보존.

## 실제 확인 근거

- 설치 EXE: C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe
- dnSpy: C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe
- 실행: --no-color -t FormQuantityPivot (2026-09-14 재실행)
- GetData: StockMaster 범위, LAG 이전 StockKey, ProductStock, ViewOrder, ViewShipment+ShipmentDate+PeriodDay+CodeInfo, ViewWarehouse+Country를 UNION ALL.
- 출고 수량은 ShipmentDate.ShipmentQuantity. 미발주 분기는 NoneOutQuantity>0 조건에 OutQuantity 반환(원본 특이사항, 임의 수정 금지).
- 15필드: CustName,CounName,OrderWeek,Quantity,FlowerName,ProdName,CountryFlower,CustArea,ListType,ShipmentDtm,OrderYear,UPrice,OrderNo,CustDescr,TPrice.
- 버튼: 새로고침 GetData, 엑셀 WYSIWYG XLSX, 닫기.
- 실행 중 원본 화면 접근성에서 2025 36-01부터 이어지는 연도/차수 열, 출고 구분·콜롬비아·수국/카네이션 필터 확인. 시작/종료 연도 각각 필요.
- 필드 메뉴 실제 확인: Reload Data, Best Fit, Order(처음/왼쪽/오른쪽/끝), Show Field List, Show Filter Editor. 사용자 입력 감지 후 추가 EXE 조작 중단. 필터·배치·원장 변경 없음.
- 웹 운영 /stats/pivot?popup=1 2026 37-01 조회 표 정상 렌더. 고정 국가/꽃/품목 및 제한된 영역 이동 확인.
- 브라우저 직접 API 문서 열기는 ERR_BLOCKED_BY_CLIENT, 우회하지 않음. 로컬 작업공간 DB 자격증명 없음. 원천 전체 DB 대조는 아직 미실행.

## 진행 상태

- 기준 a5129d78, 독립 worktree pivot-full-controls.
- 설계/누락 감사 sol xhigh 하위 작업; 운영 쓰기는 메인만.
- 구현·검증·배포 미완료.

## 중간 검증 (최종 완료 아님)

- `npm run test:pivot-exe`: 범위/GET 전용 API fixture, 집계 모델, XLSX roundtrip 통과.
- `npm run test:erp-manifest`: 58개 계약 검사 및 연결 회귀 검사 통과.
- `npm run test:nenova-dnspy-evidence`: 통과.
- 첫 `NEXT_DIST_DIR=outputs/.next-pivot-exe npm run build`: 통과. 이후 UI/모델 통합 변경은 재빌드 필요.
- `npm run start -- --port 3018`은 기존 web.js의 개발 모드 실행으로 junction/Turbopack 오류가 나 종료됨. 별도 `next start --port 3018 --hostname 127.0.0.1` production 실행으로 복구. 기존 서버 중단 없음.
- 현재 표 머리글의 전체 연도/차수 경로, 좌클릭 문자열 Count 배치, 공통 XLSX 내보내기, 필터 빈 선택, 대규모 집계 메모리를 추가 검토 중.
- 실제 화면 smoke/최종 자동검사/운영 배포는 아직 미완료. 로컬 mock을 실제 운영 DB 대조로 간주하지 않음.

## 배포 전 통합 결과

- 좌클릭 전용 15필드 이동, 숫자/문자 집계, 다중값 및 AST 필터, 정렬, 재정렬, 숨김, 너비 자동맞춤, 소계/총계와 접힘, 시작/종료 독립 연도, XLSX 공통 모델 구현.
- 기존 웹 피벗 모드와 원장 쓰기 API 보존. 신규 API는 GET/StockMaster·EXE 기존 SQL 조회만 허용.
- Chrome localhost mock smoke 통과 (1920×1080,1366×768): 15필드×4영역 이동, 빈 필터, 거래처 조건 필터, 정렬, 접기/펼치기, XLSX 다운로드, 503 마지막 표 보존. 외부 요청 0/변경 API 요청 0/화면 오류 0.
- 증거: 로컬 outputs/pivot-exe-ui-1920.png 및 outputs/pivot-exe-downloads/*.xlsx (빌드/fixture 파일은 git 제외).
- changed-from origin/master 쓰기 가드: 신규 API 1개 검사 통과. UI shell 검사 및 58개 ERP manifest 통과.
- 최신 기본 소수점 2자리(원본 N2)와 저장된 설정 안전 정규화 보완. 이 변경 후 최종 빌드·검사 재실행 중.
- PR/병합/배포 결과는 다음 기록에 갱신한다.
