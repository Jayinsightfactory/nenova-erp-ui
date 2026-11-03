# 신규 인보이스 전체 경로 (진행 중)

인보이스/AWB → 분석·매칭 → 명시 입고등록 → 같은 operation 재조회 → 원가 계산 → XLSX 다운로드.
기존 입고 조회·원가 재생성은 신규 업로드 E2E 증거를 대신하지 않는다. 운영 DB 시험 쓰기 금지.

## 부작용과 기준
등록은 기존 writer 계약만 사용하며 시험은 격리 DB에서만 수행한다. 이번 UI 연결 변경은 Warehouse/Stock/Order/Shipment/Estimate/WebProfitReport에 추가 쓰기를 만들지 않는다. 원가 자동 승인은 false 유지.
실제 EXE dnSpy ExcelLoadingPackingList 재확인: Box/Bunch/Steam/UPrice/TPrice 독립 매핑, InsertMaster는 uspCreateWarehouse 후 uspStockCalculation.
2026-11-03 SELECT-only 2026/44-01 WarehouseKey7863: 상세13행(비용/중량 포함), Boxes67/Bunches2387/Stems31060/TPrice24523.75. 이 합계를 상품 합계로 사용하지 않는다.

## 1차 구현
같은 operation/WarehouseKey readback 성공 후 cost 탭으로 이동. 등록 문서는 InvoiceReceiptCostReview 바로 표시, 재업로드/기존입고 선택 숨김. 실패/다른 operation/다른 WarehouseKey/선택변경은 이동 금지.
기존 워크벤치·입고 workflow·원가 workflow41 PASS; 실행형 handoff 회귀 추가 후 워크벤치17 PASS.

## 남은 검증
Docker Desktop 시작 시도 후에도 dockerDesktopLinuxEngine pipe 없음. 격리 SQL/Aside 실제 신규 업로드 E2E 미검증.
국가별 비용/단위 전달, 환율 고정, 호주44-01 인보이스+AWB 신규등록→다운로드, 국가별 원본 동등성, 전체 gate/build/배포 미완료.
기존 shell/스크롤 보존, 키보드/1920 실화면 미검증.

## 45-1 중국 총액 확인 · 입고 농장명

- 후보: 활성 Farm + 활성 WarehouseMaster의 농장명. 기존 입고는 PK 근거만 사용, 가짜 FarmKey/마스터 INSERT 없음. 자동연결은 유일한 정확 정규화 또는 원문에 단독 단어로 나오는 5자 이상 역사명만 허용.
- 저장: historical PK와 선택 이름을 preview와 locked 재검증 모두 확인. 기존 native WarehouseMaster.FarmName 문자열 저장 유지. 주문/출고/견적/손익 변경 없음; 기존 입고 writer의 승인 범위만 사용.
- 총액: CN/CO 상품금액+원문 부대비, NL 상품금액+운임+handling, AU CNF 상품금액. 통화 혼합/총액 미인식/차액 발생은 확인 버튼 차단. 원문 PDF 렌더와 사용자 체크 필요. 원문 hash/상품금액/품목/통화/부대비를 확인 기준에 묶어 변경 후 재확인.
- 새창: 사용자 확인 시 빈 창 확보, 동일 operation readback 성공 후만 /incoming의 해당 WarehouseKey로 이동. 실패/불명은 성공 조회하지 않음.
- 현재 검증상태: Docker 복구 후 격리 SQL writer 기본 시나리오 수행. 신규45-1 실파일과 Aside 전체 경로/배포는 아직 미검증.

## 45-1 격리 실파일 검증 후속 (2026-11-03)
- Docker 소켓 디렉터리는 삭제/초기화하지 않고 이름을 바꿔 보존한 후 재시작. 기존 loopback SQL fixture만 사용.
- 운영 이력의 원본 PDF와 캐시 분석, 품목/매칭 목록은 GET/SELECT로만 가져옴. 유료 AI 호출 없음.
- 원본은 HUBFRESH인데 기존 캐시는 Cloudland. 같은 송장번호와 정확한 원본 공급자 헤더를 확인할 때만 정정하며, 복수 헤더/다른 송장은 정정하지 않음.
- Aside 첫 E2E: 54행, 180박스, 1905단, 21900송이, 상품39720CNY + 부대비37375CNY = 원본77095CNY. 확인 후 격리 입고91001 생성, 해당 입고관리 새창/상세54행 조회. 주문/출고 sentinel 불변 확인 후 fixture 정리.
- 날짜02/11/2026은 기존 캐시에 February11로 들어있음. 테스트에서는45-1 문맥으로 November2를 직접 선택했으며 자동 날짜 인식 성공으로 간주하지 않음. GW1684.8도 원문 직접 확인 입력. CW는 미기재 유지.
- 신규 빌드 Aside 재검증에서 HUBFRESH 자동선택과 총액 원문2페이지 초기선택 확인. 원본 렌더 중은 상태 안내, 렌더 후 확인 허용.
- 메뉴 기준선: 기존 shell/페이지 스크롤 유지(적용), 총액 원문만 모달 내부 스크롤(예외), 신규 메뉴/권한 확대 없음(해당 없음). 전체 키보드 회귀는 미검증.
