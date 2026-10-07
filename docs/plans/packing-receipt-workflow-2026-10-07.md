# 인보이스 → 품목 매칭 → 주문 대조 → 입고 등록 UI·데이터 설계

상태: 설계 및 로컬 조작 시안. 운영 기능 구현/배포/ERP 쓰기 검증 완료가 아니다.
기준: 1920×1080 CSS pixel, 확대 100%, 페이지 전체 세로 스크롤.

## 사용자 요구와 경계

기존 파일 변환·엑셀 다운로드·입고관리 재업로드를 패킹리스트 탭 안의 한 흐름으로 연결한다.
자동 인식 결과는 초안이며, ERP에 저장 버튼을 누르기 전에는 입고·재고를 변경하지 않는다.
주문등록수량을 변경하거나 분배를 자동 생성하지 않는다. 확정해제/재확정도 자동 실행하지 않는다.
기존 엑셀 다운로드는 유지한다. PDF 외부 AI 전송은 사용자의 명시 분석 선택에만 수행한다.

## 화면 구성

1. 상단: 패킹리스트·입고관리 / 신규 인보이스 / 저장 내역. 연도·세부차수·국가·농장·인보이스번호·AWB·입고일을 명시한다.
2. 업로드: 기존 국가별 파서와 수동 매칭을 재사용. 파일명·해시·시트/페이지·원본 행 번호·분석 방식·파서 버전을 보존한다.
3. 문서 정보: 원본 인식값과 최종 수정값 분리. GW 실중량, CW 청구중량을 kg로 각각 표시·직접 수정. 미인식은 빈칸이지 0이 아니다.
4. 검토 표: 원문 품명·길이 → ERP 품목·코드 → 박스/단/송이 → 단가·통화·합계 → 검증 상태. 행 선택 시 원본 위치와 후보, 수정 사유를 펼친다.
5. 주문 대조: 품목별 주문 / 다른 저장 입고 / 이번 입고 / 반영 후 누적 입고 / 과부족. 주문만 있고 이번 인보이스에 없는 품목도 포함한다.
6. 저장: 초안 저장과 ERP 입고 등록을 명확히 분리. 저장 확인에는 변경 범위·원장·재고 영향과 수정 전후를 표시한다.
7. 저장 내역: 인보이스·차수·농장·입고키·담당자·저장시각·상태, 다시 열기, 원본/수정/ERP 반영 이력.

표는 가로 스크롤만 허용하고 페이지 자체가 아래로 늘어난다. 본문/수량 14~16px,
어두운 글씨, 행 hover와 선택 강조. 중요한 오류를 셀마다 장문 반복하지 않고 상태와 상세에 모은다.
Tab/Shift+Tab, Enter, Escape, 후보 방향키와 닫기 후 초점 복귀를 검증한다.

## 주문·입고 대조 공식

대조 식별자 = 명시 OrderYear + 세부 OrderWeek + ProdKey + 비교 단위.
주문은 같은 범위의 활성 주문등록 합계(고객별 상세 drill-down 가능), 분배수량이 아니다.
국가/품종 필터는 양쪽 모두 같은 Product 식별 기준을 적용한다.
농장별 주문 근거가 없으면 농장별 과부족이라고 표시하지 않고 차수 전체 주문 기준이라고 표시한다.

- 신규: 반영 후 누적 = 같은 범위 기존 입고 + 이번 초안.
- 수정: 반영 후 누적 = 같은 범위 기존 입고 − 수정 대상 WarehouseKey의 기존 수량 + 수정 후 수량.
- 차이 = 반영 후 누적 − 주문. 음수는 부족, 양수는 초과, 0은 일치.
- 미입고 = max(주문 − 반영 후 누적, 0). 주문 외 입고는 별도 상태로 유지.
- 농장/인보이스 선택은 수정 대상 선택이며 주문 전체 수량을 그 농장 발주량으로 바꾸는 필터가 아니다.
- 분할 입고 중 부족은 현황이지 무조건 저장 오류가 아니다. 차이 승인 사유를 남긴다.
- 단위가 다른 품목을 총수량 한 값으로 합치지 않는다. 박스/단/송이별 합계를 제공한다.
- 입고 완료 인보이스를 다시 열 때 이번 입고를 중복 가산하지 않는다.
- 확정 매칭이 없는 행과 환산근거가 없는 값은 대조 불가이며 0으로 치환하지 않는다.

## 실제 EXE 확인 (2026-10-07)

실행: 로컬 dnSpy.Console.exe --no-color -t ExcelLoadingPackingList / FormWarehouseAdd,
대상 C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe.

ExcelLoadingPackingList:
- 5행 고정 열 검증, 품명+SIZE, Box/Bunch/Steam 별도 보관.
- TempWarehouseDetail staging → WarehouseMaster → usp_CreateWarehouse → usp_StockCalculation(연도, 세부차수, 0).
- Product.ProdName 대소문자 무시 정확 연결. 기존 엑셀 카탈로그 매칭은 DB ProdKey 확정과 다르다.
- CheckData의 미등록/확정 조회에는 논리상 의심 조건이 있다. 버그를 그대로 복제하거나 검증 완료로 표현하지 않는다.

FormWarehouseAdd:
- CheckFixSave를 먼저 호출한다.
- CommonLogic.CheckFixSave는 대상 품종의 현재차수 확정, 이전차수 미확정,
  다음차수 확정을 함께 검사한다. 기존 웹 assertWarehouseWeekEditable의 현재차수
  Master.isFix 조회만으로 native 조건과 같다고 판정하지 않는다. 이전/다음 차수 선택 및
  GetProductListFixStatus 조회 정의까지 근거를 확보한 공통 eligibility가 필요하다.
- OutQuantity는 Product.OutUnit, EstQuantity는 Product.EstUnit에 따라 박스/단/송이 중 선택한다.
- 수동 상세 수정의 TPrice는 SteamQuantity×UPrice다. 중국 인보이스의 단당 가격을 송이당 가격으로 오인하지 않는다.
- 수정에서도 StockHistory.AfterValue=Product.Stock+새 OutQuantity를 만든 뒤 ProductStockUpdate와 usp_StockCalculation을 호출한다.
  이 코드만으로 올바른 차액 적용을 보장할 수 없다. 현행 SP/트리거와 격리 DB 재현이 필요하다.

기존 웹 POST /api/warehouse는 공용 TempWarehouseDetail 전체 DELETE와 웹 앱 잠금에 의존한다.
EXE가 같은 앱 잠금을 취득하는 근거가 없으므로 EXE 업로드 동시 실행 안전성을 검증하지 않고 재사용하지 않는다.
기존 API에는 이번 요구의 영구 문서 식별/중복방지/수정 버전 계약이 없다.
운송료·GW·CW가 별도 가상 품목행으로 변환되는 기존 파서도 있으므로 꽃 수량과 분리한다.
헤더 중량과 중량 품목행을 둘 다 더하지 않으며, 서로 다르면 원천 위치와 차이를 표시한다.
외화/단당/송이당 단가는 별도 축이다. ERP 저장 단가 기준과 다르면 근거 있는 환산식과
원문 가격을 보존하고 사용자가 확인한다. 단위/통화가 불명확하면 임의 USD/송이당으로 저장하지 않는다.

## 확인된 운영 읽기와 한계

인증된 GET /api/warehouse?startDate=2026-10-01&endDate=2026-10-07: 82개 헤더 반환.
7593(2026/41-02) 상세: ProdKey866 박스10/단300/송이300/Out10,
ProdKey889 박스58/단1740/송이1740/Out58.
7592 상세: ProdKey876 박스8/단240/송이240/Out8, ProdKey889 박스20/단600/송이600/Out20.
운영 쓰기 0건. 기본 exeParity 응답에 GW/CW가 없으므로 0이라고 표시하면 안 된다.
exeParity=0으로 재조회하면 동일 날짜 입력이 InputDate 기준으로 바뀌어 62개 헤더다.
기본 parity는 UploadDtm 기준이므로 82/62 차이를 원장 누락으로 오진하지 않는다.
확인한 상위 8개 헤더의 GW/CW는 실제 NULL이다. 별도 무게 품목행 유무는 추가 확인 대상이다.
7593의 상세는 OutUnit=박스, ProdKey866 Out10/Est300, ProdKey889 Out58/Est1740이다.
즉 OutQuantity와 EstQuantity는 같지 않으며 대조·금액 계산에서 서로 대체하면 안 된다.
SQL 직접 연결 설정이 없어 현행 SP/트리거 원문, 전체 재고 부작용, 교차연도 원장 probe는 미확인.
과거 SQL 백업은 현행 운영 SP 증거를 대체하지 않는다.

## 저장 데이터 계약 (제안, DDL 미실행)

문서: documentId, revision, status, sourceHash, sourceFileName, parserVersion,
sourceLocation, selectedYear/week, farm, invoiceNo, awb, inputDate,
rawMetadata, editedMetadata, rawGw/rawCw, gw/cw, units, currency, invoiceTotal,
warehouseKey, baselineDigest, operationId, actor/time.

행: stable lineId, sourceRow/page/sheet, originalName/length/quantity/unit/price,
matchedProdKey, canonicalName, matchMethod/confidence, manualConfirmedBy,
box/bunch/stem, inputUnit, priceUnit, unitPrice/lineTotal, validationIssues, changeReason.

이력: 서버 인증 계정, 시각, 문서·행 ID, 작업, 수정 전후, 이유, ERP 작업키/입고키,
검증시점의 주문·기존입고·이번입고·차이 snapshot. 현재 대조와 당시 대조를 구분한다.
ERP commit과 성공 이력은 같은 SQL 트랜잭션에 남겨야 한다. 파일 저장과 SQL 성공을 원자적이라고 주장하지 않는다.
새 웹 전용 SQL 테이블이 필요하면 기존 승인과 혼동하지 말고 별도로 승인받는다.

## 동작별 부작용

| 동작 | 웹 문서/이력 | Warehouse | Stock | Order/Shipment/Estimate/WebProfitReport |
|---|---|---|---|---|
| 업로드·자동인식·매칭·대조 | 초안/읽기 | 읽기 | 보존 | 읽기/보존 |
| 초안 저장·수정 | revision+감사 | 보존 | 보존 | 보존 |
| 실제 신규 입고 | 문서-입고키 원자적 연결 | native 호환 신규 | 검증된 native 재계산 | 직접 쓰기 금지 |
| 실제 입고 수정 | 전후·이유·actor 감사 | 대상 입고키/상세만 수정 | 검증된 차액/재계산 | 직접 쓰기 금지 |
| 검증·동시수정·SP 실패 | 실패/재확인 상태 | 전체 rollback | 전체 rollback | 보존 |

입고 변경은 원가·손익의 읽기 결과에 간접 영향을 줄 수 있다. 확정 보고서·수기 원가를 자동 덮어쓰지 않는다.

## 출시 전 필수 조건

1. 현행 usp_CreateWarehouse/usp_StockCalculation 및 관련 트리거·잠금·PK·CheckFixSave 실제 조회.
2. 미등록/중복명/장미길이/국가불일치/0과미인식/환산누락/중국단당가격/통화/금액불일치 fixture.
3. 신규·수정·재업로드·응답유실 재시도·EXE 동시 업로드·stale revision 전체 원자성 검증.
4. 2025/2026 동일 차수 sentinel, 분할 입고 합산, 수정 대상 제외 재합산, 주문만 존재하는 품목 검사.
5. native+web 격리 SQL fixture: 증가/감소/품목변경/실패 rollback/재고 잠금 다른 owner 보존.
6. CW>GW 정상, GW>CW 확인필요, 빈값과0 구분, 기존 확정 원가/보고서 보존.
7. 전체 ERP 계약/manifest/dnSpy/write guard/build와 1920×1080·900·480 UI smoke.
8. 검증 후 PR·병합·배포·운영 읽기 smoke. 운영 시험 입고는 별도 대상·수량 승인 후만 수행.

## 기준 ledger

| 기준 | 원천 | 적용 위치 | 미확인 시 |
|---|---|---|---|
| 연도·세부차수 | 화면 명시 선택 + 실제 Order/Warehouse | 목록·대조·preflight·write 공통 scope | 저장 차단 |
| ERP 품목 | 활성 Product의 고유 ProdKey·정확명·국가·길이 | 자동 후보·수동 확정·저장 재검사 | 수동 매칭 필요 |
| 주문량 | 활성 OrderMaster/Detail 선택 범위, 품목 OutUnit | 주문대조 공통 집계 | 조회 실패 표시, 0 대체 금지 |
| 입고량 | WarehouseMaster/Detail, OutUnit별 별도 수량 | 대조·수정 preview·저장 readback | 비교 불가 |
| EstQuantity | FormWarehouseAdd.UnitQuantity + 실제 Product.EstUnit | 견적/원가용 환산, 주문량과 혼용 금지 | 저장 차단 |
| 단가·금액 | 원문 단가기준 + native UPrice/TPrice/SP | 매칭표·금액 검증·저장 | 가격단위 확인 필요 |
| CW/GW | 원문 및 WarehouseMaster/중량행의 검증된 원천 | 메타·입고원장·원가 후속 조회 | 미입력/원천충돌 |
| 확정 | native CheckFixSave·현재 SP 범위 | 표시·preflight·트랜잭션 재검사 | 자동 확정취소 금지 |
| 중복·동시 수정 | documentId/operationId/DB snapshot/version | 저장 상태조회·재시도·write | 새 POST 재시도 금지 |
| 권한·이력 | 서버 인증 수입부/관리자 계정 | 초안·ERP write·감사 | 클라이언트 actor 신뢰 금지 |

## 현재 산출물

`docs/ui/packing-receipt-prototype.html`: 예시 데이터로 수량 편집·과부족 재계산·확인필요 필터·모의 초안·변경 이력을 조작하는 로컬 UI 시안.
운영 화면/DB와 연결되어 있지 않으며 저장 버튼도 모의 동작으로 명확히 표시한다.
