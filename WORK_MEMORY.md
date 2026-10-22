# 작업 기록

## 2026-10-19 인보이스 직접 입력 보완
- 관세율 퍼센트 입력, 직접 입력 필요행 필터, 서버 승인 저장/복원 안내. 빈칸과0 구분, ERP writer/계산식 불변.
- 실제41-02/1214205: 웹 revision3 입고일 저장 후 기존7662 원가연결 COMMITTED. native85행 동일, 활성입고1건. 실제 원가승인·다운로드는 레우코취2관세율 필요로 미검증.
- 격리SQL 원가저장/재조회/엑셀/ERP보존 통과. 상세 docs/work-sessions/2026-10-19_invoice-manual-cost.md.
- 검색어: 인보이스 직접입력 관세율 퍼센트 LINK_EXISTING_COST 7662

## 2026-10-19 전체 분배 교체 누락 방지
- 현재 최종 분배에서 양재동 카네이션 6품목 제외가 맞다. 주문을 복원하지 않는다.
- 서버 서명으로 전체교체 행 누락/변조 차단, 주문 없는 기존 분배도 원본 Shipment 기준 재검증, 저장 직전 확정 변경 시 전체 중단.
- 운영 DB 수정/보정/마이그레이션/재계산 없이 코드만 배포한다.
- 전체 ERP 회귀검사, 빌드, 계약 및 쓰기 범위 검사 통과. 운영 실제 저장은 미검증(금지 범위).
- 상세: docs/plans/distribution-replacement-2026-10-19.md. 배포 결과는 PR/Actions에서 확인.
- 검색어: 양재동 36-01 카네이션 전체교체 누락 분배 replacementPlan coverage
## 2026-10-19 네덜란드 패킹 미매칭·원문 검산
- 실제 `41-2 NL H CI.pdf`의 Y2 주문코드로 Holex 로컬 파서가 중단되던 원인 수정. 146행, 16,251송이, EUR31,141.91, 소계/CBS/총액 검산 통과.
- source invoice/line identity로 반복 품명 미매칭 오표시 수정. NL 품종/규격 후보를 미리보기·생성에 공유. 후보는 수동 승인 상태 유지.
- 검산 완료한 로컬 Holex만 일회용 원문 증명으로 행별 체크 생략. AI 또는 변경된 행은 그대로 검토 대상.
- 실제 dnSpy ExcelLoadingPackingList 조회. SELECT로 송장1214205는2026/41-02 WarehouseKey7662에 이미 입고된 점 확인. 신규 입고/매칭/재고/원가 운영 쓰기 없음.
- 기존 저장 GW2296.5/CW2553과 PDF2298.3/2555 차이 확인. 기존 입고 보정은 이번 범위에 포함하지 않음. WebInvoiceCostRevision 해당WarehouseKey 0건. 도착원가 실제 저장은 미검증.
- 검색어: Holex Y2 1214205 Aisha Casablanca packingSourceMatchedName LOCAL_NL_HOLEX_VERIFIED_V1
- 2026-10-19 배포39190519519는 이전 빌드의 generated JSON2개/package-lock.json 변경 때문에 안전 중단. 이 세 파일만 원본+binary patch 백업 후 HEAD로 복원하여 ff-only 진행하도록 보완. 다른 tracked/staged 변경은 중단, untracked 운영 파일은 보존. DB 쓰기 없음. 검색어: BUILD_OUTPUTS_BACKED_UP DEPLOY_CHECKOUT_DIRTY

## 2026-10-19 Holex 후속 검증
- 운영 3df9f1c0 배포 확인. 35개 공용 매칭 보정 후 146/146, 패킹82행/16251송이 생성 확인. 기존 Warehouse7662 재등록 안 함.
- rawMetadata 382420bytes가 기존256KiB 제한에 막힘을 실제 PDF로 재현. 문서 감사근거만1MiB 허용, 행256KiB/전체2MiB 유지. 상세 docs/work-sessions/2026-10-19_nl-packing-finish.md.
- 사용자 허용: 업로드 시 네이버 환율, 유사 과거 통관비 추정. 현재 조회 EUR1493.64, 비용 저장은 아직 안 함. 기존native입고와 웹 원가 연결 경로 미완료/실저장 미검증.
- 검색어: rawMetadata 382420 1214205 7662 추정통관비

## 2026-10-19 Claude 인수: 출고 견적 누락 방지 #1076
- 사용자 결정: 주문을 먼저 등록해야 분배 가능. 기존 같은 트랜잭션 주문생성→분배 계약 유지.
- #1076 검토 중 금액정렬의 NULL 수량 재쓰기 재현/수정, 혼합단가 보존, 신규 DELETE API 제외.
- 기존67+회귀4=71검사 통과, 운영 SELECT 골든10검사 통과. 전체 ERP/빌드 통과, 미배포·운영저장 미검증.
- 상세 docs/work-sessions/2026-10-19_claude-handoff-guard.md. #1085 원가연결은 별도 작업.
- 검색어: Claude 인수 1076 주문먼저 EstQuantity NULL 혼합단가 DELETE CRLF

## 2026-10-19 기존 입고 보존 원가 연결
- LINK_EXISTING_COST 웹 전용 연결: 원문 다대일 합계 검증, 전체 입고 스냅샷 보존, 이후 native 입고 변경 경로 차단.
- 추정 비용 근거 저장/복원/엑셀 표시, 다운로드 시트명 연도·세부차수. 분리 SQL fixture에서 링크/재시도/원가 저장·조회/엑셀 및 ERP 보존 통과.
- 운영 7662는 원문 146행/상품82행/16251송이. 매칭3건(20/25/113행)을 기존 입고와 대조하여 웹 초안 revision2로 보정. 입고 미변경.
- 사용자 '추가해줘' 승인으로 웹 CHECK 허용값만 추가, 신뢰/활성 상태 및 입고 전후 동일 확인. 배포·운영 원가 저장·실제 다운로드 최종 대조는 아직 미검증.
- 검색어: LINK_EXISTING_COST 7662 1214205 추정통관비 차수시트

## 2026-10-19 품목관리 품종 버튼·카탈로그 사진
- 품종은 사용자 확인대로 목록 복수선택 필터이며 ERP 활성상태 변경 없음.
- 품목명 hover/focus 사진, 클릭/Enter 기존 공용 이미지 관리. 같은 ProdKey/이미지 ID 사용, 카탈로그 복귀 재조회 및 변경시각 URL로 캐시 갱신.
- 운영 GET: Product3350개, ProdKey447과 대표사진1 대조. 운영 이미지/ERP 쓰기 없음. 실제 교체 미검증. verify:erp-change(빌드 포함), test:ui-layout 통과. 로컬 브라우저 필터/사진/키보드 검증 통과. 배포 진행 중.
- 검색어: ProductCatalogPhoto productCatalogFilter 품종 버튼 공용 사진

## 2026-10-19 품종별 하위 품목 단일 전환
- 사용자 후속 확정: 카네이션/장미 등 상위 품종 버튼 하나 선택 → 해당 하위 품목 표시. 다른 품종은 교체 선택, 같은 버튼은 유지, 전체로 복귀. 검색은 선택 품종 안에서 기존대로 적용.
- 변경은 React 필터/묶음 제목/행 선택 초기화뿐. Product/Flower 및 모든 주문·출고·재고·견적·매출 원장 보존, 사진 공용 연동 유지.
- 실제 dnSpy FormOrderAdd.GetDataProduct 재확인. 운영 읽기에서 카네이션379/장미814 품목 분류 확인. 실제 버튼 핸들러 회귀 통과, 전체 검사/배포 진행 중.
- 검색어: 품종 하위 품목 단일선택 flower-groups

## 2026-10-19 국가 → 품종 → 하위 품목 정정
- 사용자 최종 요구는 품종이 아닌 국가(네덜란드/콜롬비아/중국 등) 상위 버튼. 국가 선택 시 해당 국가의 품종 버튼과 품종별 구분 행 아래 품목을 표시한다.
- 실제 dnSpy FormOrderAdd.GetDataProduct의 CounName/FlowerName 조회 확인. 운영 읽기 3351개: 네덜란드1306/콜롬비아1025/중국433. 국가/품종은 DB 값으로만 묶고 누락은 미지정, 원장 변경 없음.
- 국가 변경 시 하위 품종/행 선택 초기화, 검색 조건 유지, 사진 공유 기능 유지. 실제 페이지 핸들러와 교차연도/동일품종 타국/누락 분류 회귀 통과. 전체 검사·배포 진행 중.
- 검색어: productCountry groupProductsByCountryFlower 국가 품종 하위품목
- 검증 완료: verify:erp-change(ERP 계약/dnSpy/manifest/write guard/프로덕션 빌드), test:ui-layout, 실제 페이지 버튼 회귀 및 로컬 브라우저 국가·품종 전환/키보드 통과. PR·운영 배포 진행.

## 2026-10-19 수입부 10 품목관리 · 영역 일괄 입력
- 기존 국가/품종/검색을 유지하고 5항목 영역 드래그·개별/일괄입력·변경 확인·명시 저장 추가. 수입부 탭 전환 시 초안 보존.
- 실제 ClassProduct/FormProductAdd CLI, 운영 schema/trigger SELECT 확인. ProdKey+6필드 CAS, 전체 transaction, 사후 대조, SystemActionLog 전후 감사. 주문/입고/출고/재고/견적/손익 원장 미수정.
- 격리 MSSQL 저장/소수/0/파생값/rollback/Stock-trigger/교차연도 검증 통과. 전체 ERP검사·빌드 및 Chrome 마우스드래그 시험 통과. 운영 배포 스모크 아직 미검증(진행 중).
- 검색어: ProductBulkEditor products-bulk 수입부10 영역드래그 품목일괄입력

## 2026-10-19 품목 입력 히스토리 · 인보이스 문제 로그
- 기존 10 품목관리 PR1090/9ced3744 운영 배포 성공. 추가 이력은 전체/선택 품목의 전후 값과 수정자·시각 표시; 개별 저장도 같은 transaction 감사.
- 초안 이전 업로드 문제 분류·건수는 SystemActionLog, 서버 검증 행별 문제는 WebInvoiceHistory. 사용자별 같은 탭 대기 로그 복원/명시 로그만 재시도. ERP 입고/재고 재실행 없음.
- 테스트/최종 배포 확인 진행 중. 운영 업무 데이터 수정 테스트 미실시. docs/work-sessions/2026-10-19_import-audit-history.md 참고.
- 검색어: ProductInputHistory INVOICE_UPLOAD_ISSUE invoiceValidationAudit

## 2026-10-19 중국 발주 다운로드 HF 별도 셀
- 품목명 A열/HF CODE B열/단위 C열/합계 D열, 업체 E열부터. banner와 원수량/환산/정렬/매칭 유지. SQL/API/운영 DB 미수정.
- 실제 XLSX round-trip 열/선행0/빈칸/수식형코드/합계/교차연도/260업체 통과. 전체 guard/빌드·배포 스모크 진행 중.
- 상세 docs/work-sessions/2026-10-19_china-hf-columns.md.
- 검색어: 중국발주 HF CODE 별도셀 별도열 chinaOrderWorkbook

## 2026-10-19 패킹 원문 확인 안내
- Cloudland 캡처의 품목매칭/원문 확인 의미를 구분. 구체 사유·행 수정 초점·남은 건수·다음 단계 안내 추가.
- 적용된 원문 검토는 기존 validator 통과시 미리보기에서 재요구하지 않음. 파일/수량/송장연도 변경시 경고 유지.
- 원장/API/SQL 쓰기 변경 없음. 대상 63통과1skip, 전체 계약/가드 통과, 격리 Chrome callback/키보드 확인. 배포 진행 중, 실제 원본 재업로드/입고 미검증.
- 검색어: packing-review-guide VERIFIED_BASELINE_UNAVAILABLE Cloudland 원문확인
- 추가 캡처의 숨겨진 확인 열을 품목 상단으로 이동. 중첩 표 스크롤 제거, 한글 입력명·진행 건수. 로컬 실제 PDF/13행 확인→제출 성공, 대상25/25 및 전체 계약/빌드 통과. PR1094 배포 진행; 운영 입고는 미실행.

## 2026-10-19 주차별 매출이익 범위 출력·이상비율 진단
- 조회 완료된 연도 기준 1~선택 차수 표시/원본 시트 다운로드, 차수 선택 인쇄 미리보기, 진행률·취소·교차연도 응답 차단.
- 공통 보고서 읽기/확정값을 보존하며 출력 GET은 ERP 및 Web snapshot 쓰기 없음. 기존 수기 저장은 기존 명시 경로 유지.
- 운영 SELECT 진단: 재고조정 영향, 재고 평가근거 누락, 근사 평가, 오래된 계산 snapshot을 구분. 실제 금액·거래 데이터는 공개 저장소에 저장하지 않음.
- 계약·dnSpy·manifest·쓰기 가드·빌드 통과 후 마지막 보완 재검증 진행. 합성 자료 1/26/41 선택 미리보기 확인. 실제 프린터 출력은 미검증.
- 상세 docs/work-sessions/2026-10-19_profit-range-output.md.
- 검색어: 주차별매출이익 전체차수 엑셀 선택인쇄 profitRangeOutput 재고평가 누락 snapshot

## 2026-10-19 보고서 엑셀 한 차수 한 시트 후속 명시
- 사용자가 원본/표시용 중복을 원치 않음을 명시. 범위 다운로드는 차수당 한 시트만 제공하고 웹 실제 표시열 순서·품명 숨김·프리셋을 반영, 비고는 같은 시트 하단 보존.
- 기존 단건/MOYI 원본 호환 API는 유지. 미조회 연도/차수 입력 상태의 출력은 차단. 원장 수정 없음.
- 검색어: 한차수한시트 표시필터 품명숨김 profitRangeOutput

## 2026-10-19 배포 차단 학습 단위 파일 보존
- 읽기 전용 GitHub SSH 진단으로 data/order-import-units.json 운영 학습 변경이 원인임을 확인. 설정 내용은 공개 로그/저장소에 미포함.
- 같은 파일의 upstream 변경이 없을 때만 원본을 그대로 유지해 fast-forward. 비공개 백업, 충돌/잘못된 JSON/미확인·staged 수정 차단. 원장·단위 판정 로직 변경 없음.
- 실제 임시 Git fixture에서 설정 보존·백업·동시 저장 유지·upstream 충돌·비정상 JSON 차단 통과. 전체 검사/CI·배포 진행 중, 운영 반영은 아직 미검증.
- 상세 docs/work-sessions/2026-10-19_deploy-learned-units.md.
- 검색어: DEPLOY_CHECKOUT_DIRTY order-import-units diagnose_checkout_only 운영학습보존

## 2026-10-19 수익률 검증 별도 창
- 매출이익 보고서 상단 및 공용 메뉴에 별도 검증창 연결. 조회 연도/차수 전달, 기존 보고서 경고·원천 점검·StockHistory 참고 이력 표시.
- 원장/계산/확정/재고 보존, GET-only. 독립 검증 엔진은 미구현으로 명시. 오류·stale·다른 연도 응답을 정상 결과로 숨기지 않는다.
- 실제 FormStockView CLI 및 2026/32 Stock/확정매출 존재 SELECT probe 확인. 기능검사와 배포 결과는 세션 MD에 기록하며 성공 전 운영 완료로 판정하지 않는다.
- 검색어: profit-validation 수익률검증 새창 popup 연도차수 읽기전용
- 로컬 verify:erp-change(build 포함), dnSpy evidence, UI layout, 합성 Chrome 교차연도/실패/390px/키보드/GET-only 통과. PR·배포·운영 새창은 아직 미검증.

## 2026-10-19 패킹 매칭 완료 후 다음 단계
- 사용자 요구에 따라 원본 품명 옆 DB 품목 매칭을 완료하면 별도 원문확인 체크 없이 다음 단계로 이동. PDF 렌더 실패 자체가 입고 준비를 취소하지 않도록 분리.
- 실제 필수 숫자/음수/원본 해시/수정 스냅샷/날짜·통화·총액/단위 검증은 보존. 기존 입고 writer와 중복/연도 검증 변경 없음. ERP 원장 쓰기 수행하지 않음.
- 수정 전 로컬 dnSpy 및 2025/2026 42-02 읽기 전용 probe. 전체 ERP 계약, dnSpy, 변경 manifest/write guard, build 통과. 격리 브라우저에서 체크 없이 10→20 수정 적용, VALUES_APPLIED/confirmed=false 검증. 후속 문구 수정 빌드와 운영 배포는 진행 중(아직 미검증).
- 검색어: packing-match-next assertPackingSourceValues VALUES_APPLIED 원문확인체크제거
- 배포 전 추가 점검: 분석 완료 상태문에 남아 있던 과거 원문 검토 안내 2곳도 DB 매칭→다음 버튼 안내로 통일. 실제 수량/가격 오류 안내는 유지. 검색어: packing-match-next-copy
- 후속 CI에서 예전 원문 검토 문구를 요구하던 화면 회귀 1개 확인; 새 사용자 요구의 매칭→다음 안내를 검증하도록 수정. 숫자/중복/쓰기 검증은 삭제하지 않음.

## 2026-10-19 품목 저장 EXE 호환성
- 웹 그룹/사진/일괄 편집 유지. 실제 dnSpy·운영 SELECT 후 CountryFlower 분류키와 독립 SteamOf1Box 보존, 최소 수정값 저장, 충돌·단위 변경 확인, 원자적 감사/읽기 대조 추가.
- 격리 실제 MSSQL 신규/수정/실패 롤백 및 교차연도 sentinel 검증 통과. 운영 DB 쓰기/스키마 변경 없음. 전체 검사·PR·배포 진행 중(운영 미검증).
- 상세: docs/work-sessions/2026-10-19_product-save-compat.md.
- 검색어: product-save-compat CountryFlower SteamOf1Box 독립값 EXE 품목저장

## 2026-10-19 독립 재고·수익률 검산
- 검증 새창에 1~선택 차수 수량 대사, 기초 이월/이번 차이 분리, 조정 포함 식, 최초 관측 구간, 직접 단가 곱셈 및 별도 수익률 산술을 구현. 원장/보고서 공식/확정본 보존.
- 비표준/누락 차수를 넘어 최초 원인을 단정하지 않음. FIFO/평균/판매단가 원가 증빙은 미확인으로 분리. 전후 SHA256 변경 시 판정 보류, NULL은 0 정상 처리 금지.
- 실제 dnSpy/SP/2026년 1~41차 SELECT probe, 합성 회귀 및 verify:erp-change 통과. 최종 브라우저·CI·배포는 진행 중(완료 전 미검증).
- 검색어: profitIndependentAudit 독립검산 기초기말 원인추적 STALE 조정포함

## 2026-10-19 패킹 차수 날짜 자동 적용
- 원본 날짜 없는 경우에만 표시 연도와 파일 세부차수로 PeriodDay 기준일 조회. 원본 날짜·수정 날짜 보존, 자동 적용 근거 화면/Excel/입고초안 기록.
- 실제 dnSpy 및 2025/2026 42차 읽기 전용 달력 검증. 숫자/단가·중복 검증 및 기존 입고/재고/매출 writer 보존. 실제 입고 저장하지 않음.
- 빌드·날짜 회귀 통과, 전체 계약과 배포·운영 브라우저는 진행 중(미검증).
- 검색어: packing-week-date DATE_SOURCE_UNAVAILABLE PeriodDay AUTO_ORDER_WEEK 중국패킹

## 2026-10-19 에콰도르 기초재고 실제 매입 근거
- 41차 기초의 일부 품목만 최근 4차수 밖 매입이 제외되어 판매단가를 사용함을 실제 dnSpy/SELECT/모듈 비교로 확인. 같은 연도·과거 매입·정확 과세환율·완전한 동일 단위 도착원가 재현이 있을 때만 이월 우선.
- 기초/기말 자동 제안의 기간을 분리하고 오래된 원가 변경도 캐시 지문에 포함. ERP 수량·판매·견적·수기·확정 revision 보존.
- 1~41차 전후 비교, 36~41차 실제 보고서 비교 및 기초 단가 화면 동등성 확인. 다른 국가 변경 없음. 이전 차수 원가 부족은 남아 있으며 41차 기말 0은 실제 감소 조정과 구분해 설명한다.
- 신규 회귀와 전체 verify:erp-change(build 포함) 통과. CI·배포·운영 스모크 진행 중(아직 미검증). 상세 docs/work-sessions/2026-10-19_ecuador-acquisition-cost.md.
- 검색어: ecu-acquisition-carry profitReportAcquisitionCarry 최근4차수 판매단가 기초기말 과거매입
- PR #1105/ea015ab0 및 Cafe24 39257930494 성공, 운영 41차 평가값 변경 확인. 브라우저 스모크에서 week-check만 과거 캐시 경고를 읽는 불일치 발견하여 후속 보완 중. 검증창의 본표·원천 점검 모두 auditLive GET, 확정본·기본 호출 보존. 후속 배포 완료 전 미검증.

## 2026-10-19 중국 기존 입고 원가 연결 진행 중
- 별도 nw-china-existing-cost에서 CN 단기준 원가 연결 및 compact PDF 파서 초안. 운영 입고7671 읽기만 수행. 관련73테스트 통과9생략; 전체검사/배포/실저장/다운로드 미검증.
- 원본 Populus 10송이×15단과 총300송이 불일치 확인, 임의보정 안 함. docs/work-sessions/2026-10-19_china-existing-cost.md 참조.
- 검색어: china-existing-cost HUBFRESH 7671 Populus 150 300

## 2026-10-20 중국 단기준 원가 연결 후속
- 사용자 결정: Populus 원가 15단 기준, 송이 수는 직접 수정. 원본 송이값과 수정 사유·파생 박스당 송이를 별도 보존하며 단수/금액은 유지.
- 실제 PDF 파서 및 합성 오류 사례, CN 비용 저장/재조회 모의 SQL 및 NULL 품목 보존 검사 통과. 전체 ERP 검사·dnSpy·manifest/write guard·빌드 통과. 운영 로그인 확인.
- PR/운영 배포 및 실제 원가 저장·Excel 다운로드는 아직 미검증. 기존 운영 입고 수정 없음.
- 검색어: china-existing-cost EXISTING_CN 15단 송이수수정 null-product

## 2026-10-20 ECOUNT 기능 이관 자동 작업 설계
- 최신 origin/master abe88d34에서 별도 작업트리. 실제 Chrome 사이트맵·입출금·세금계산서 표/버튼과 기존 수집·은행·증빙 코드를 조회.
- docs/ECOUNT_REPLACEMENT_DESIGN_2026-10-20.md 및 docs/ecount-migration/work-plan.json에 자체 DB 범위, 외부 API, 14개 의존 작업, 수집 보강·원장 호환·전환 게이트 기록.
- ECOUNT/MSSQL 쓰기, 거래자료 적재, REA 설치, 실행 스케줄, 앱 배포 없음. 전체 기능 동등성·운영 API·실제 이관 미검증. 문서/JSON 구조 확인만 수행.
- 검색어: ECOUNT_REPLACEMENT_DESIGN ecount-migration REA 자체회계 은행대사 전자세금계산서

## 2026-10-20 전체 차수 계산식 검산
- 원장 76개 연도·차수 28,001항목 + 자동 저장 입력 116 revision 42,451항목 독립 산술 일치. 수동 확정 revision 0건. 원본 fixture 898셀 회귀 통과.
- 확정 AC/AJ 보존, 0/null 표시, 분모 0 합계 비율의 가짜 100%를 수정. 검증 새창·범위 검산에 전체 항목 검사 및 원천 누락 별도 경고 추가. ERP 원장/기존 확정본 변경 없음.
- 원천 누락 59차수 334행 및 NULL 연도/범위 밖 60차는 정상 인증하지 않음. 전체 gate/배포/운영 smoke 진행 중(미검증). 상세 docs/work-sessions/2026-10-20_profit-formula-complete.md.
- 검색어: profit-formula-complete 전체항목검산 AC AJ 확정조정누락 합계100퍼센트

## 2026-10-20 ECOUNT 전체 메뉴 작업실 초기 구현
- 8개 탭/537개 경로/423개 말단을 실제 사이트맵 메타데이터로 목록화. /ecount/workbench에서 18개 기능군, 430개 화면 계약, 합성 입력·계산·조회·수정·검토·취소·변경이력 및 저장 설계 제공.
- 외부 API 28개 말단도 화면/저장 로직 설계 포함. 실제 DB/API/영속 저장 없음, 민감정보 수집 없음. 인증/활동 수집기의 부수 호출도 제외한 독립 shell.
- 신규/전체 ERP/UI/manifest/write scope/dnSpy guard 및 첫 빌드 통과. 브라우저 견적 추가·수정/은행·세금계산서 설계 확인, 로컬 API 시도 0건. 최종 빌드 재검증 중. 원본 전체 상세 동등성/좁은 화면/운영 배포는 아직 미검증.
- 상세: docs/work-sessions/2026-10-20_ecount-replacement-design.md, docs/ecount-migration/menu-inventory.md, docs/ECOUNT_WORKBENCH_CONTRACT.md.
- 검색어: ecount-workbench 전체메뉴537 DB미연결 메모리초안 외부API저장설계

## 2026-10-20 44-1차 음수 주문 Pivot 통계 진단
- 2026/44-01 콜롬비아 카네이션26행 -76박스/수국4행 -17박스 정상저장 확인. 전산피벗 OutQuantity>0 조건으로30음수행 제외. 실제dnSpy/운영SELECT 동일 확인. 원장/코드/배포 변경없음. 사용자로그인화면 필터상태 미검증.
- 상세 docs/work-sessions/2026-10-20_pivot-negative-44-diagnosis.md
- 검색어: 44-1 음수주문 Pivot통계 OutQuantity 양수필터 카네이션 수국

## 2026-10-20 음수주문 이전표시와 모드전환 원인
- git기록: b46355a8(2026-09-14)에서 Pivot 기본mode=exe 도입, statsPivotMode 브라우저저장값으로legacy/exe복원. 기존웹피벗 주문SQL에는양수제한없음, EXE SQL OutQuantity>0은 c5feda67(2026-07-06) 도입이후변경없음. 사용자가이전에어떤모드였는지는미검증. 코드변경일과실제배포일은구분.
- 검색어: statsPivotMode b46355a8 전산피벗 기존웹피벗 음수주문 2026-09-14

## 2026-10-20 음수 주문 피벗 수정
- 주문 조회를 OutQuantity<>0으로 변경, 모든 국가·연도차수에 공통 적용. 원장 쓰기 없음. 20264401 음수31행/-103 추가(콜롬비아 수국·카네이션30행/-93), 기존1112행 동일. 20264402/20254001 원본 동일.
- signedOrders 18조합·XLSX 회귀, 1920/1280 브라우저(+10/-3=7), build/manifest/write guard 통과. 로컬 전체ERP 검사는 C: 여유558MB로 activity health 테스트 실패; CI 전체검사 통과 전 배포 금지. 캐시삭제 자동승인차단, 삭제없음.
- 검색어: Pivot 음수주문 signedOrders OutQuantity 44-1 -103

## 2026-10-20 기존 입고 농장 조회 조건
- HUBFRESH 입고 7671은 존재하나 Farm 목록에는 없어 원가 연결이 차단됨. native FarmName 직접 저장/LEFT JOIN 근거에 맞춰 Farm 미선택은 연도·차수·송장·입고연도의 유일 입고 조회로 수정. 명시 Farm 선택은 기존 좁힘 조건 유지.
- 품목/수량/금액 대조와 잠금 재검증 유지. ERP 원장 쓰기 없음. 신규 회귀 30개 통과, 전체 검사·배포·운영 저장/Excel 검증 진행 중(미검증).
- 검색어: existing-receipt-farm-scope HUBFRESH 7671 FarmName Farm누락 원가연결

## 2026-10-20 ECOUNT 별도 SQL·원본 UI·하위 작업
- 사용자 별도 SQL 생성·적재 승인. ECOUNT는 조회/다운로드만, 기존 ERP 원장 보존. ecount_work Version/Head/Audit와 고정 루트 nenova-ecount 구현 및 스키마 생성.
- 실제 SQL rollback-only9개 검사 통과, 검사 데이터 전부 rollback. 원본 안전 투영4종을 구현하고 날짜 형식 차이를 보완 중. 실자료 적재/배포 최종 결과는 세션 문서 참조.
- UI 통계·개발 안내 제거, 원본4개 조회화면의 열 순서 부분 대조. 완전 동등성0개, 373프로그램/59작업묶음. SQL/UI/명세 하위 작업3개 시작, 사용량26% 기준.
- 상세 docs/work-sessions/2026-10-20_ecount-data-workspace.md. 원본 입력/수정/삭제/발행/전송 없음.
- 검색어: ecount_work nenova-ecount 원본버튼팝업 parity-packets 별도SQL롤백
- 후속: 4종 안전 투영 실자료 cash21/ar89/ap174/sales5001(소계 포함) 적재·readback·멱등 재실행 성공. UUID 비교 정규화. SQL rollback-only9개 재통과. 사용량34%. 운영 배포 결과는 세션 문서 후속 기록 확인.
## 2026-10-20 SQL 원장 기준 손익 대사
- 76개 차수 SQL 직접 합산 N/L/O/Q 5,044개, 재고수량 1,261개 비교 일치. 산술 28,001개 + 저장 입력118revision 43,205개 일치. 원장 수량식 차이·연도키 충돌·원가근거 누락은 별도이며 정상 인증 아님.
- 검증 새창에 SQL 원행 대사/연도키 제외/매입 존재와 원가 연결 누락 구별 추가. ERP 원장/확정본/수기값 보존. 전체 gate/CI/배포 진행 중; 인증 운영 화면은 로그인 만료로 미검증.
- 상세 docs/work-sessions/2026-10-20_profit-sql-lineage.md. 검색어: profit-sql-lineage SQL독립합산 연도키충돌 매입시점 원가연결 FLOAT해시

## 2026-10-20 ECOUNT 이력 조회 후속
- PR1111 배포 성공, 운영 cash21/ar89 조회 확인. 이력 SQL 별칭 ROWCOUNT 예약어 오류 발견·수정, 실제 읽기8건 및 회귀검사 통과. 기존자료·원장 변경 없음. 재배포/운영 이력창 최종결과는 세션 문서 참조.
- 검색어: ecount-history-query-fix ROWCOUNT SQL156 이력조회
- 후속 완료: PR1113/17fcac04 Cafe24 배포 success. 운영4종 행수 확인 및 작업 이력 창 열기·닫기 통과. 전체 기능100%는 미완료. 주간사용38%, 남음62%. 상세 docs/work-sessions/2026-10-20_ecount-data-workspace.md.

## 2026-10-20 ECOUNT 버튼별 Excel 보고서 추가 요구
- 최종 산출물에 페이지/모든 버튼 라벨과 양쪽 화면 캡처, 기능/새창/동일 조건 조회값 비교 Excel 포함. 지속 매칭 JSON/근거 검사 구현, 현재 373페이지 중 전체 동등성 확인0; 관찰버튼88. 최종Excel 아직 미생성.
- 판매 F3/조회/고객선택창 껍데기/출력드롭다운/새탭 안전 미리보기, 견적조회 별도 화면과 quote 업로드 전용 데이터셋 추가. 기존 ERP 원장/ECOUNT 쓰기 없음. quote 실제적재 미실행.
- 표적검사 통과. 전체 ERP검사에서 신규계약 requiredCommands 누락 발견 후 보완중, 빌드 진행중. 배포/실브라우저 신규화면 미검증.
- 검색어: ecount-button-matches report-contract E040202 E040207 새탭미리보기 Excel동등성88버튼

## 2026-10-20 중국 원가 엑셀 표시 누락
- CN SEA format-only 자산의 상단 항목명이 출력에서 누락됨. 현재 승인 상품·운임·관세·기타비 합계와 개별비용 미보유 표기, 관세율 요약·추정근거 복원. 기존 64행/2,280단/29,048,581.029768원 불변.
- SELECT-only 실자료 export 및 렌더 검증. ERP gate/빌드 통과, 배포 후 다운로드는 아직 미검증(세션 문서 후속 참조).
- 검색어: china-cost-export-layout 상단누락 format-only 중국해상 #### 엑셀요약
- 후속 재개: C: 여유41GB 확인. 캐시삭제는 정책 거부로 미실행. 최신master94c512bf 병합 후 빌드 통과. quote 날짜/금액3행 별도SQL revision1 적재·내용hash/readback·멱등 검증 통과. 원본/운영원장 쓰기없음. 원본관찰94버튼, 최종Excel/배포스모크 진행중.

## 2026-10-20 ECOUNT 캐시 정리·배포·비교 보고서 후속
- 캐시 삭제 후속 성공: 이번 작업트리 .next/cache/webpack의 정확한 pack 파일 8개만 삭제해 약1.164GB 확보. 앞선 재귀삭제 거부를 우회하지 않고 범위를 한정해 승인된 삭제 실행. 소스/자료/다른 작업 캐시 보존.
- PR1116 squash 7ef617e8, CI39359021910·Cafe2439359353928 성공. ERP 계약/dnSpy/manifest131/쓰기guard/build 통과. ECOUNT 입력·수정·삭제 없음, 공유 ERP 원장 변경 없음.
- 운영 견적 안전 투영3행 날짜·금액6값 대조 차이0. 원본 진행중 상태 제한 자료이며 대상 상태필터 미구현이므로 전체 조건 일치 아님. 금일 양쪽0건. 판매 금주10/18~20 양쪽0건; SQL총5001행 중 날짜5000/미상1, 해당 미상행은 기간조회 제외.
- 운영 미리보기 새 탭 생성 확인. blob 프로토콜 브라우저 정책으로 내용·캡처 미검증, 우회하지 않음.
- outputs/ecount-parity-20261020/ECOUNT_버튼별_비교보고서.xlsx 생성: 10시트, 전체373페이지/59묶음/관측94버튼, 원본5장+대상2장과 버튼 표식·범례, 제한된 값 비교. 렌더·ZIP·이미지hash·보고서 검사 통과. 전체 기능/버튼 완전일치 완료0, 나머지 미구현·미검증을 보존한 진행 보고서임.
- 검색어: PR1116 ecount-parity-20261020 버튼비교Excel 캐시8파일 1.164GB quote6값 blob미검증

## 2026-10-20 신라호텔 3자료 조회·분석
- 최신 origin/master 분리 작업트리. 신라 손익 화면의 조회·분석 링크, 별도 비교표, SELECT-only multipart API, 기간 월별 순차 SRM 조회 전용 Chrome 확장 구현. 최초 설치 승인 전 실제 브라우저 연결 미검증.
- 첨부 실제 원본 41차수/226행, 운영 DB 41문서/225행. 합계 DB405,127,966/엑셀403,671,966원(차이1,456,000), 이름/단가 수정 포함 가능하므로 오류 확정 아님. 원본/원장 변경 없음.
- 신규 10개 회귀/실제 파일 파싱/운영 SELECT/첫 전체 ERP·dnSpy·manifest·쓰기 guard·빌드 통과. 최종 빌드·CI·배포 후속 기록은 세션 문서 참조.
- 검색어: shilla-reconciliation shilla-connector 신라호텔 입고실적 세자료대조 findGrSpListEai

## 2026-10-20 신라 3자료 분석 배포 검증 후속
- PR #1117 squash 병합 07dbf6aa. 최종 병합본 로컬 build 성공, GitHub ERP verify/Windows installer 성공. 운영 배포39359785762 success.
- 운영 /raum/shilla-analysis 실제 브라우저: 원본 XLSX multipart 제출 후 41차수/DB225행 표시 확인. 조회·분석의 확장 미설치 오류 및 설치 안내 정상. 단일 shell·페이지 스크롤 확인.
- 비교표 합성자료 데스크톱/좁은 화면·키보드 원본 펼치기 검증, 실파일226행 파싱/운영SELECT 대조 검증. 실제 SRM collector 연결은 확장 설치 승인 대기이므로 미검증. 기존 원장/원본 변경 없음.
- 설치파일/안내/운영 화면 증빙: Documents/Codex/2026-10-20/new-chat/outputs. 이 후속 기록은 로컬 보존, 배포된 구현은 PR #1117.
- 검색어: 신라3자료 운영검증 shilla-analysis 1117 07dbf6aa 확장설치대기

## 2026-10-20 실제 SRM 날짜 전환 보정
- 사용자 최초 확장 설치 완료. 운영 버튼→확장→신라 실제 첫 조회 성공(12 rows loaded). 다음 월 시작일이 이전 종료일보다 늦으면 SRM 범위 위젯이 시작일을 지워 필수값 알림/timeout 발생 확인.
- collector에서 양쪽 날짜를 비우고 종료일→시작일 순으로 설정. 과거 기간 이동·월 전환 제약 재현 회귀10개 통과. 설치 폴더 수정 반영, 확장 새로고침 사용자 요청. 전체 기간 종단 비교는 아직 미검증.
- 검색어: shilla-date-transition cc-from-to-date 시작일초기화 월별조회

## 2026-10-20 ECOUNT 상태 조회와 구매 원본 관찰 후속
- 기존 하위 작업자 3개 재사용. 계정 주간 사용69%→81% 확인(계정 전체 사용량이며 이 작업 단독 비용 아님). 크레딧 구매/사용량 리셋 없음.
- quote 상태 in_progress/completed와 row_cell/query_filter 근거만 허용. 과거 상태 미상 행·해시 보존, 상태별 실제 필터 및 새 버전의 근거 소실 시 전체로 복귀. 검색 라벨3개·Option6항목 표시/닫기 보완. 미관찰 실행은 비활성.
- 원본 전체 탭 DOM17행은 총수가 아니었음. 페이지1..10/스크롤 렌더를 확인하고 부분 수집으로 정정. 날짜·금액·상태 안전26행(진행중3/완료23)을 별도SQL revision2 적재·내용readback·멱등 검증 통과; 원본 전체 건수 unknown, 이전revision1 보존.
- 구매조회 E040304의 금일0건, 검색패널, 인쇄드롭다운(프린트문제해결만), 거래처 검색 같은탭overlay 열기/닫기 관찰. 원본 수정/선택적용/신규/발행/삭제 없음. 대상 구매조회는 준비중 화면으로 미구현이며 양쪽 캡처 확보.
- PR1119 squash3ee7aabb. 필수5gate/build·CI39366175404·Cafe24배포39366377648(hydration포함) 성공. 기존 공유ERP 원장 변경 없음.
- 운영 quote26행 날짜·금액·상태78값과 수집snapshot 대조 mismatch0. 진행중3/완료23 실제필터, 금일+진행중 양쪽0건. 전체 원본수집/다른검색조건/모든버튼 동등성은 미검증. Option6개 disabled 표시 및 Escape닫힘/포커스 복원 확인.
- 관측138버튼/부분관찰6프로그램, 전체373프로그램·59묶음 완전동등성 완료0 유지. 비교Excel 후속갱신 중; 결과는 동일 outputs/ecount-parity-20261020 경로.
- 검색어: PR1119 quoteStatus statusEvidence revision2 26행78값 구매조회E040304 138버튼 전체건수unknown
- 보고서 후속 완료: 동일 Excel10시트/360842bytes 갱신, 원본·대상11장 원본이미지hash 보존 및 ZIP/렌더/보고서검사 통과. 26행78값 비교는 요약수록, 개별행26건 boolean대조는 row-comparison-evidence.json 별도보존(이번Excel 미포함). 전체구현 완료 판정은 하지 않음.

## 2026-10-20 국가별 도착원가 수식 비교
- 10개 원본 양식의 배분식과 누락 헤더 대조. 승인값 첫 시트 보존 + 원본수식 비교 시트(계산/저장/차이).
- 사용자 승인: 원본 계산값과 저장값·차이 동시 표시. 입고/재고/승인원가 쓰기 없음.
- 원본 포함 38검사, 별도 계산기10양식, 실제42-01 SELECT 출력·기존 숫자672셀 동일. CBM 미보유는 입력 필요, 부분 합산 금지.
- ERP/dnSpy/manifest/write guard/build 통과. 최종 배포·운영 브라우저 다운로드는 미검증.
- 검색어: country-cost-formula-comparison 원본수식비교 CBM 672셀 승인원가보존

### 2026-10-20 구매조회 구현 및 독립 SQL 표본
- 최신 master e685a123 병합 193951c7. 구매 E040304 10열, F3/F8, 금일, 거래처 검색 오버레이 열기/닫기, 구매 전용 인쇄 펼침 구현. 관측38 ID 중37개 UI 연결(A14 위치 미확정); 원본 미관찰·미수집 기능은 비활성, 전체 동등성 미완료.
- 원본 조회기간2026-09-20~11-19 화면표본26행의 일자/금액/외화금액/환율만 안전 투영. 별도 ecount_work purchase revision1 적재, readback/idempotent true. 원본전체건수 unknown, ECOUNT 쓰기0/공유원장 쓰기0. import-latest 구매 차단, 파일 업로드·버전복원만 지원.
- 안전필드·소수정밀도·교차연도·정정/복원·멱등 표적3검사 PASS. 최종 빌드/CI/배포/운영비교는 후속기록 전까지 미검증.
- 검색어: E040304 purchase-safe-projection purchase-revision1 26rows 37buttonIDs source-readonly

- 후속 실제 검증: 사용자가 확장 새로고침·신라 접근 허용을 확인했으나 확장 query 결과 로그인 탭 없음 반복. 도구에서 기존 로그인 탭은 관찰됨. 신라 새로고침/입고실적 재선택 후에도 동일. 전체 대조는 미완료이며 오류를 자료 없음/정상으로 오인 처리하지 않음.
- 날짜 수정 PR #1118 병합60260689, CI verify 성공, 운영배포39365420613 진행중. 설치 폴더 collector 반영 완료. background 진단(권한여부·신라탭수·시크릿 여부) 추가는 로컬 미커밋, 설치 폴더 반영 후 확장 카드 ↻ 사용자 응답 대기. 권한 확대 없음.
- 검색어: 신라확장 탭발견실패 연결진단 permissions.contains 1118

## 2026-10-20 신라 실제 월별 조회 종단 성공
- v1.0.1 설치 경로 일치 확인. 진단에서 신라 host permission 미허용 확인 후 사용자가 허용, 실제 조회 성공. 2026-01-05~10-06 월별 조회523행/378,794,030원, DB225행/405,127,966원, 원본226행/403,671,966원. DB/엑셀 차수별차이69건. 범위/단위 정합성 확정 전 총액 차이를 오류로 단정하지 않음.
- 히야신스 5EA/PK↔단-5스팀 factor1 연결 후 세 자료 qty4/price9990/amount39960 일치. 나머지36자재 단위확인 대기. 월 전환 초기화 실제 통과. 원본15차 매입단가누락,37차수량누락,39/40차상세-합계불일치 검출.
- 확장 버전 표시/권한·탭수·시크릿 진단 추가, 권한확대/원장쓰기 없음. PR1118 배포39365420613 성공 확인.
- 검색어: 신라523행 종단검증 히야신스39960 hostpermission v1.0.1



### 2026-10-20 구매조회 운영 검증
- PR1122 squash30bce7de8d8ec8b5141e1cf689ea46428e464d03, CI39376044008 및 Cafe2439376327510 success. 로컬 필수5종·신규파일 stage 후 manifest/writeguard PASS. 배포 hydration 스모크 PASS.
- 운영 구매조회26행/키26유일, 원본 안전표본26행의 날짜·금액·외화금액·환율104값 mismatch0. 전체원본건수/개인정보필드/모든조건 동등성은 미검증.
- F3 열기, 실제키로 날짜변경 후 F8 기간2025-10-20~2026-10-20 표본26건, 금일10/20~20 원본/대상0건 확인. CUA date fill은 DOM값만 바뀌고 상태반영되지 않아 근거에서 제외, 실제 ArrowDown 입력·F8으로 재검증.
- 구매 인쇄 펼침 프린트문제해결1개(disabled), Escape닫힘/포커스복원; 거래처검색 overlay5열·닫기 확인. 선택/적용/신규 등 미관찰 동작 비활성. 대상 인쇄메뉴 캡처는 CDP timeout으로 미확보, 빈조회 캡처는 확보. 시각적 배치 차이 존재.
- 주간 계정사용량94%, 기존3하위세션 재사용. 전체59작업묶음/373프로그램 100%일치는 여전히 미완료. 전체완료로 표시하지 않는다.
- 검색어: E040304 purchase-production-parity 104values mismatch0 PR1122 39376327510
- Excel 갱신 완료: 413499bytes/10시트, 원본JPEG13개 hash보존/ZIP/수식오류 검사 PASS. 견적26행·구매26행 개별일치표 포함, root 구매렌더 확인. 전체일치0·미검증 유지. 최종보고서 outputs/ecount-parity-20261020/ECOUNT_버튼별_비교보고서.xlsx.

### 2026-10-20 구매현황 및 다음 조회 묶음
- E040305 구매현황 원본14열/금일자동조회0건/인쇄메뉴PDF·미리보기·프린트문제해결/별도Print Preview탭 확인. Excel(화면)은 단일버튼이며 추정된화살표A07철회, Fn은A14로기록. 원본쓰기0.
- 전월2026-09-01~30 날짜가확인된460행을 날짜+숫자8개만투영, 같은일자번호중복을합치지않고순서보존. 전체수집여부unknown. buyStatus canonical513/alias583은동일작업영역. revision1 적재/readback/idempotent true.
- 처음 purchaseStatus 이름14자가SQL varchar10제약과불일치하여실패. 읽기probe로실패후보Version/Head/Audit각0확인, DDL없이buyStatus9자로교정하고 모든dataset길이회귀검사추가.
- 구매조회 scoped배치/열폭/정렬보정, 구매현황독립UI와14열미리보기 구현. 미관찰·미수집조건은비활성. 운영배포/값대조는후속기록전까지미검증.
- 다음큐 E040302발주서조회: 기본09/20~11/19와금일10/20~20둘다0건,10열,납기일자/발주금액합계/진행상태/생성한전표,인쇄펼침프린트문제해결만확인. E040723채권관리대장은거래처필수미선택조회차단/선택창열기닫기만확인,빈결과로기록하지않음.
- 검색어: E040305 buyStatus varchar10 460rows E040302 E040723 read-only

## 2026-10-20 신라 기존 ProdKey 연결 확인
- 사용자 안내로 2026 신라 결산 기존 WebRaumPnlItem→Product 연결 SELECT 재확인. 연결 223 행, 미연결 2 행. 덴파레/몬디알 표기차이 동일키 확인. 돈셀→노비아456 연결은 업무 확인 필요; 안시리움 단→송이 환산값0으로 미확정. 운영 분석 API는 아직 ProdKey를 조회하지 않아 자동 활용 미구현. 기존 매칭 확인 보고서 outputs 보존. 원장 수정 없음.
- 검색어: shilla-existing-mapping ProdKey 돈셀 노비아456 안시리움 단송이
## 2026-10-20 신라 기존 매칭 적용 구현
- 분석 SELECT에 활성 Product 연결 추가, 동일 ProdKey+동일 비교단위의 별칭 통합. 전산 키/품명/원문 행을 화면 표시. 안시리움181 단=송이=EA1:1 사용자확인 반영; 원본/원장 단위는 보존.
- 돈셀17/19차는389콜롬비아 vs2306중국 확인 대기, 아직 수정하지 않음. 신규13검사 및 ERP/dnSpy/manifest/writeguard 통과, build/배포/실제재조회 진행중.
- 검색어: shilla-saved-matches 안시리움6511 53968700 돈셀원산지

- 후속 돈셀 원산지 사용자 확인:콜롬비아389. 운영 UI 단일행 수정2건 및 SELECT 재확인 완료(17차8604/19차8617,20/28단,14500원,290000/406000원 불변). PR1123/67c7b3bf CI통과·병합, 운영배포 진행중.
- 검색어: 돈셀수정완료389 1123 67c7b3bf 신라17차19차

## 2026-10-20 매칭 반영 실자료 재대조 후속
- PR1123 운영67c7b3bf/배포39384245355 성공. 실브라우저225/226/523행 재조회, 총액405127966/403671966/378794030 동일. 수정 돈셀389 표시, 기존별칭42그룹 확인.
- 안시리움 사용자확인 송이1:1 적용: DB/엑셀6511·53968700, SRM6135·50760900, 차376·3207800. 원문 단가별 엑셀7700원121/8300원6390, SRM7700원266/8300원5869. SRM3/7전표5019768659/0001 145송이1116500이 차이, 엑셀40차521송이4324300은10/6까지 SRM에 없음. 이후 입고인지 아직 미확인.
- SRM 규격미기재 '-' 때문에 자동제안누락 발견, 빈문자열/'-'만 허용하고 실규격15cm차단 회귀추가. PR1125/a80a1d16 CI39385142067 및 로컬필수5종 성공. 배포39385466904는후속main에의해cancel; 후속39385563160(c962e927)에a80a1d16포함 확인, 배포진행중.
- 추가기간10/7~20 조회 시도는 native date fill만으로 React상태변경안돼원래범위로시작 후SRM403세션만료. 추가기간결과로 사용하지 않음. 사용자재로그인요청, 자동연결최종스모크/추가기간 미완료. CUA date 입력은fill후ArrowDown/Up 실제키 이벤트로상태반영검증필요.
- 돈셀 PK=1단 확인 질문 별도대기. DB품목연결수정은이미2건완료. outputs/신라-매칭반영-재대조결과.txt, 신라-안시리움-세자료비교.png, 신라-돈셀-연결수정.png 저장.
- 검색어: 안시리움376 3207800 3월7일145 40차521 spec-dash 1125 403세션만료
- 추가 품종 오연결 방지: 수국 엔틱/염색 토큰 보존, 일반 연그린 자동연결 차단. 회귀14개 및 ERP계약/dnSpy/manifest/writeguard/build 전부 통과. 운영 최종 자동제안 재검증 예정.
- 검색어: shilla-qualified-names 엔틱연그린 오연결방지

### 2026-10-20 ECOUNT 연속 구현·운영 값 대조
- PR1124 squash b38e884e, CI39384385778 및 배포39384652958 success. 구매현황 운영460행을 원본 안전표본 순서로 대조: 날짜+수치8개=4140값 mismatch0. 중복문서번호96개는 합치지 않음. 전체 원본 수집·전체버튼 동등성은 미검증.
- 구매현황 금일0건·인쇄메뉴3항목·별도미리보기탭생성 확인. Blob내용은 브라우저정책상 미검증. 대상빈화면캡처2회timeout으로미확보.
- PR1126 CI39385254198 pass, squash c962e927. 발주서10열/수금·지급4열·날짜버튼 매핑, 별도작업영역 receipt227/payment102 rev1 readback/idempotent true. PO원본0건이나 CLI EMPTY_IMPORT 보호로 빈snapshot 생성하지 않음. 운영값대조는 미검증, 배포39385563160 진행중.
- 다음 판매할인E040216/구매할인E040313 각각6열·검색버튼차이·인쇄3항목·별도원본미리보기관측. 날짜문법/비어있지않은자료미관측이므로 discount/buyDisc 읽기전용scope 및 모든import/activate 차단. 미수집상태로표시하며0건일치로간주하지않음. 다음전체gate 진행중.
- 원본쓰기0/공유ERP원장쓰기0. 59묶음 전체는 미완료이며 검증되지 않은 버튼은 완료로 표시하지 않는다.
- 검색어: E040305 4140values PR1124 PR1126 receipt227 payment102 discount buyDisc

### 2026-10-20 ECOUNT 판매조회 및 캡처 복구
- PR1126 배포39385563160/hydration success. 수금227행454값·지급102행204값 날짜/금액 모두일치. 각각금일0건·인쇄3메뉴·별도미리보기탭생성 확인, Blob내용미검증.
- 비교Excel 554482bytes/10시트/17이미지 갱신,ZIP/수식/원본hash검사PASS. root수금head렌더확인. 이후추가관측은다음export대기.
- PR1127 squashc203857a, CI39386118651/배포39386452733 success. 할인2화면 운영6열/F3/판매10버튼vs구매9버튼/미수집쓰기차단확인. 미수집상태를원본0건일치로간주하지않음.
- E040206 판매조회 원본10열/24버튼/금일0/인쇄펼침문제해결1개관측. safe26행날짜금액만 saleQuery revision1 readback/idempotenttrue. 실제표본날짜범위2026-10-13..13이며원본기본검색기간아님. PR1129 CI39387422701pass, squash87171980, 운영배포후값대조대기.
- 대상clip캡처timeout, 사용자Chrome복원후에도지속. fullPage:false 전체화면은성공, 수금/지급/구매현황/할인2화면 확보. 화면제목및role=status[] 확인후저장. 같은탭hash변경만으로이전화면잔류결함발견;초기잘못명명된사진은reload/제목검증후덮어씀. 각newtab의기존값대조에는영향없음.
- 후속묶음 수금지급750px/구매현황1400px시각보정,hashchange/popstate회귀수정, 미판매9열/미구매8열readonly화면연결 구현. 영업주기기준일의미미검증이므로실행차단. 전체gate/운영검증대기.
- 이번판매조회빌드생성캐시8파일78994754bytes 삭제시도는자동승인정책차단으로미실행. 캐시보존. 계정주간사용21%확인(계정공유값).
- 검색어: saleQuery E040206 26rows fullPagefalse hashchange E040212 E040307 PR1129 cache-policy-block
- 재로그인 새탭 조회에서 Invalid URL 관측. URL 없는 Chrome tab을 건너뛰고 정확한 https/www.shillasrm.com/afterLoginOK.do만 고르는 v1.0.2 보강, 오류/타호스트/정상혼합 회귀 통과. 설치폴더와 zip 갱신, 사용자 확장 새로고침 대기.
- 신라 UI에서10/7~20 직접 조회·엑셀 다운로드 성공. 10/7 전표5020752839 안시리움12행 합계521송이/4324300, 엑셀40차와 일치. 이전40차미입고 추정 해소. 이후기간을원래범위와혼합하지않음.
- 검색어: connector1.0.2 InvalidURL 40차10월7일521

### 2026-10-20 ECOUNT 보고서 레이아웃 및 주문서 관측 확장
- PR1129 배포39387777249 success. 판매조회26행 날짜/금액52값 일치. 원본표본기간과기본검색기간은구분.
- PR1130 squash532c0dbc/CI39388495005/배포39388782751 success. 운영수금/지급750px,구매현황1400px확인. 동일탭hash변경으로5화면정상전환, 미판매9열/미구매8열미수집확인. after캡처5장 저장.
- PR1131 견적현황8/7열 및 실제미수집과0건구분, 판매조회누락컨트롤보완5종gate pass. CI39390020712 pass, squash3ae09ba, 배포39390360805진행중.
- 비교Excel 841747bytes/10시트/26이미지, ZIP오류없음/수식오류0/원본hash일치. 전체동등성완료0 유지.
- 주문서조회10열,Option/help는검색패널열림때만표시확인. 6종footer펼침메뉴관측,내부변경발송실행0. 주문서현황7열/별도preview7열,집계는조건1이상필수로조회차단(0건아님). 차기구현진행.
- 원본쓰기0/공유ERP원장쓰기0. 59묶음전체완료아님. 캐시삭제정책차단미실행상태유지.
- 검색어: PR1130 PR1131 E040204 E040209 layout750 hashNavigation 26images

### 2026-10-20 주문조회·주문현황·발주현황 후속
- PR1131 squash3ae09ba1, CI39390020712 및 Cafe24배포39390360805 success. SSH 배포와 실브라우저 hydration 검사 통과로 배포 상태 정정.
- E040204 주문조회, E040209 주문현황, E040306 발주현황의 관측된 화면·일별 집계조건 조회창을 재현 중. 실제행/날짜/양식 의미는 미확인으로 readonly·검색/적재 차단 유지. 외부 API 필요 기능으로 분류하지 않으며 전체동등성은 미완료.
- 관측505건 후 전체접기 반영 예정이며 최종 메타데이터 건수는 검사결과 기준. 계정 주간 사용량53%는 공유계정 전체 사용량으로 이 작업 단독 비용 아님.
- 운영 브라우저 로그인 만료로 재로그인 대기. 기존 캐시 차단 유지. 원본/기존 ERP 원장 SQL 쓰기 없음.
- 검색어: orderQuery orderStat poStat daily-lookup 505관측 전체접기 PR1131 deploy39390360805 로그인만료
- 최종 parity 기록: 전체접기(E040209-A48) 포함 관측506ID, 전체동등성 완료0, 버튼검사 PASS. 운영 재로그인 회신이 없어 해당 신규 묶음 운영 스모크는 pending.

## 2026-10-20 신라 기간 기준 정정
- 사용자확인: ERP창고분배차수/엑셀차수또는월~금/신라실제입고월을별도유지. 월귀속은입고일YYYY-MM.
- 기존DB분석은WebRaumPnl저장손익이었음을사용자에게명확히정정. 실제ShipmentMaster/Detail/Date읽기전용315행 추가. 40-02 안시리움520 vs엑셀/신라521 발견.
- 후보규칙/부작용은 docs/work-sessions/2026-10-20_shilla-period-basis.md. 최초원본업로드는기재월첫날~마지막월말(현재월오늘까지)제안. 월~금전체미조회/날짜미기재/단위미확인/동일원본중복소비는확정하지않음.
- 회귀17개통과,전체gate·배포미검증.
- 검색어: shilla-period-basis 실제분배315 안시리움520521 입고월귀속

- 검색어: connector1.0.2 InvalidURL 40차10월7일521


## 2026-10-20 NENOVA.EXE 음수 주문 피벗
사용자가 native EXE의 모든 차수·국가 음수 표시와 합계 차감을 명시 요청. 기존 4033996D SHA256 버전은 unsigned/IL-only이고 ` WHERE vo.OutQuantity > 0 `의 IL 참조는 FormQuantityPivot.GetData 한 곳이다. 같은 길이 ` WHERE vo.OutQuantity <>0 `로 #US 내용 2바이트만 변경한다. 메타데이터/IL/입고·출고·재고/엑셀 경로 그대로 유지.
기준: 동일 연도 포함 OrderYearWeek BETWEEN/StockList 조인, 0/NULL 제외, SUM 부호 유지, 모든 국가 공통. 동작별 부작용: 조회/합계/엑셀 모두 OrderDetail·ShipmentDetail·ShipmentDate·ShipmentFarm·ProductStock·StockHistory·Estimate·WebProfitReport 보존. DB 쓰기 없음.
실제 수정 EXE를 .NET Framework x86에서 로드해 FormQuantityPivot의 grid 생성(Load/GetData 미호출), 2025/2026×01-01/44-01/44-02×3국가의 +10/-3를 바인딩. native SummaryType=Sum, -3/7/총126 확인. 실제 WYSIWYG XLSX도 -3/7/126 numeric cell 확인.
원본/수정 EXE에서 추출한 SQL 직접 SELECT 비교: 20264401 기존1227행 동일+음수31행/-103, 대상 콜롬비아 카네이션 여분26행/-76. 20264402 588행,20254401 3336행 동일. 개인정보 출력/저장 없음.
원본/수정 hash: 4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63 / FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 배포는 사용자 PC만, 다른 직원 실행파일 자동변경 아님. 실행중 프로세스 강제종료 금지, 닫힌 뒤 원본 백업과 atomic replace.
메뉴 기준선: 적용—기존 화면/키보드/스크롤/필터 보존. 해당 없음—웹 shell/입력/매칭/DB쓰기. 화면상 실제 로그인 조회는 아직 미검증. native control 시험과 실제SQL 읽기검증은 완료.

검색어: native-pivot-negative NENOVA.EXE 여분26 -76 두바이트 signed SUM

### 2026-10-20 판매조회 실측·회계거래조회 후속
- PR1131 사용자 재로그인 후 root 운영 확인: 견적서현황8/7열, PO미수집 표시, 판매조회26행×날짜·금액2값 대조 성공. 전체기능 동등성은 미검증.
- PR1134 CI39392236553 success, squash c52564d7, Cafe24배포39392543784 success(SSH 및 자동 hydration 포함). 신규 주문3화면 운영검증은 root 후속 확인 대상.
- 판매조회 원본 실측을 근거로 검색 배치·폭을 보완하고 동일 컨트롤의 재관측 관계를 메타데이터에 기록. 회계거래조회 journal 안전9행 날짜·금액 문법검증 통과, 준비파일 journal-import-safe.json 생성. 실제 SQL 적재는 아직 실행하지 않았으며 후속 필수검사 통과 후 root 담당.
- 검색어: PR1131 운영52값 PR1134 c52564d7 39392543784 sale-query-layout journal9 safeprojection
- PR1134 root 운영검증 완료(order-pages-release-runtime-evidence.json): 주문조회10열/6드롭다운, 주문현황7열750px·lookup22→일별5열631px, 발주현황9열941px·lookup20→일별5열631px. 8캡처 확보, 미수집 표시 유지/가짜0건 주장없음, 원본·공유원장 쓰기0.

### 2026-10-20 회계 표본 적재와 조회창 반환 검증
- journal 실제 별도작업영역 적재 완료: 필수5검사 통과 후 root 실행, journal-import-result.json의9행/revision1/readback true/idempotent true. 이전 미실행 문구는 당시 기록이며 현재 상태는 적재완료. 원본·기존ERP원장 쓰기 없음. 운영18값 대조는 배포 후 예정.
- lookup 새창의 대상 반환은 동일origin/정확한child/UUID nonce/현재메뉴 검증과 로컬daily 선택만 허용. 부모정리·재열기·메뉴전환·닫힌창/팝업차단 mock 회귀검증. 원본 새창 반환 동작의 완전동등성은 미검증이며 대상 mock 검증과 구분한다.
- 검색어: journal9 revision1 lookupWindow nonce source-window daily-return 원본반환미검증
- PR1135 root 운영검증: journal9행 날짜·금액18값 mismatch0, journal-runtime-comparison.json 및 E010701-target-safe-rows-full.jpg 확인 완료. 전기간·전체원본 동등성은 미검증.

### 2026-10-20 세금계산서 안전 조회 후속
- PR1137 CI39396362904 success, squash ccd25588. Cafe24배포39396737155는 앞선 작업 배포 후 대기/진행 상태이며 완료 확인 전 운영반영으로 주장하지 않는다.
- E040218 salesTax8열/731px, 날짜·공급가액·부가세·합계20행 안전부분표본 검증. 기존 승인된 target 작업영역 업로드/버전/복원 재사용, source-latest 및 미관측원본검색/발행 실행 차단. 실제 SQL적재는 필수검사 후 root 담당, 원본기간/전체성 unknown 유지.
- 관측559ID/전체동등성완료0. 원본추가조사 중 다른페이지전환 불일치결과는 근거에서 제외. 유효헤더확인 후 수집한 salesTax20행과 구분.
- 검색어: salesTax E040218 20행부분표본 unknown PR1137 39396737155 559관측

## 2026-10-20 중국 인보이스 원본 수량 보존
- CN AI 경로의 pcs=1/bunch_st=1/total_stems 누락 제거. Order 박스, Bunch 단, PCS 송이를 헤더 의미로 추출. DB 품목 매칭은 원본 수량을 덮어쓰지 않는다.
- dnSpy 실제 ExcelLoadingPackingList F/I/J 별도 박스/단/송이 확인. 2025/2026 fixture, 실제41-1 XLSX20/20, ERP contract·dnSpy·manifest·write guard·build 통과.
- 운영 SELECT만: 해당 송장102행 박스102/단5391/송이5391, 원본101상품행429/5390/68775와 다름. 자동 데이터 보정 없음. 실사용 PDF 재분석·운영 입고 쓰기 미검증, 배포 스모크 후속.
- 메뉴 기준: 기존 UI/스크롤/매칭 적용, 새 화면·DB writer 해당 없음.
- 검색어: chinaSourceQuantities Order Bunch PCS 41-01 원본수량보존

### 2026-10-20 조회창 운영 반환 검증·재고 준비
- PR1137 root 운영검증(lookup-release-runtime-evidence.json): PO새창 Enter→부모 일별5열·dialog/child닫힘 PASS. Order새창 Space→집계5열·양쪽닫힘 PASS(첫 Enter 미반영 후 Space로 확인). Order dialog960×684/table406 일치. PO table922 vs 원본936, 최대화높이853 vs855 차이는 후속보완중. 원본 반환 완전동등성은 미검증.
- 재고 stock 특례는 원본 품목코드열의 typed코드만 허용하고 다른 dataset의 제품코드 제외를 유지한다. 안전1949행/유일1949 확인, quantity정확문자열·단일기준일2026-10-20. 제품명·소계 미수집, 부분자료 unknown. stock-import-safe.json 준비만 했고 SQL실행없음.
- 검색어: PR1137 lookup-return Space Enter table406 922936 stock1949 typed-productCode

### 2026-10-20 salesTax 공급가액 누락 정정 준비
- 운영20행80값 대조에서 공급가액20개 불일치 발견. 원본 수집키 supply를 wrapper의 supplyAmt로 명시 매핑하지 않아 null로 적재된 것이 원인. 날짜/vat/total은 일치. 최초 parser 통과/멱등 검증만으로 원본값 동등성을 보장하지 못했음을 정정.
- 신규 salesTax import는 supplyAmt/vat/total 모두 필수 non-null 검증, 누락·빈값·공급가액 alias미매핑은 SQL진입전 거부. 과거v1은 읽기/불변보존하고 새버전 정정만 허용.
- sales-tax-import-safe-corrected.json에서 supply→supplyAmt 매핑 후 원본20행×4필드80값 독립대조 mismatch0, sales-tax-correction-validation.json 기록. 아직 SQL실행없음; 필수5검사 통과 후 root가v2적재·운영재대조 예정.
- 검색어: salesTax supply supplyAmt null20 80값 mismatch0 correction v1보존
- stock-tax-fix 필수5검사/build 통과 후 root 적재 완료(stock-tax-import-results.json): salesTax 정정20행 revision2/readback true/idempotent true, 과거v1보존. stock1949행 revision1/readback true/idempotent true, 기준일2026-10-20. 원본·공유ERP원장 쓰기0. 운영 정정80값 및 재고값 대조는 별도 후속검증.

## 2026-10-20 신라 판매요청 포함 대조
사용자 요청: 안시리움1송이 판매요청 근거 조회 및 정상 추가분 분류. 실제 ClassEstimate/FormEstimateView dnSpy와 SELECT로 Estimate10040(2026/40-01 신라호텔446/181,10/12,1송이/8300,판매요청) 확인. 40-02분배520+요청1=엑셀/SRM10/7 521. 판매요청일과입고일은별도표시. 같은연도/업체/품목/단위/대차수의 전체요청 및확정/가격버킷/중복소비검증, 원본차이보존. ERP/재고쓰기없음.20개테스트/실제loader대조/build통과,전체계약및배포진행중.
검색어: 신라 판매요청 Estimate10040 520+1 정상추가분 shilla-sales-request

## 2026-10-20 ECOUNT 재고·세금계산서 정정 후속 검증
- 별도 ecount_work 적재: salesTax 20행 revision2, stock 1949행 revision1/기준일2026-10-20, 각각 readback/idempotent true. 원본·공유원장쓰기 없음. 최초 salesTax v1 공급가액20누락과 실패증거는 보존.
- root 운영 재대조: salesTax v2 20행80값 불일치0(sales-tax-v2-runtime-comparison.json). stock 운영3898값 대조는 PR1140 배포 후 예정/현재미검증.
- PR1140 기존CI통과 후 동시 신라 PR1139를 양쪽메모와10파일 보존하여 병합8f81eb2c. 병합 후 필수5종 모두통과(stock-tax-merge-guard-results.json), 현재 새CI·배포 진행중.
- 후속 buyTax E040219는 실제행미수집/0관측 상태 유지. 새 실제파일의 안전날짜+필수 supplyAmt/vat/total만 별도영역 업로드 허용하며 정밀소수/교차연도/멱등/복원 fixture통과, source-latest 미지원. SQL 추가실행 없음.
- 검색어: salesTax revision2 80값일치 stock1949 buyTax E040219 stock-tax-merge PR1140

## 2026-10-20 ECOUNT 세금계산서 검색·재고 날짜 선택 후속
- PR1140 병합 e6a8fceb, 배포39401692655 진행중. 후속 salesTax/buyTax 관측검색폼과 stock 연월 선택 표시를 분리구현. 실제행없는 buyTax는 미수집, 안전파일업로드 후에만 조회. 금액3필드필수 및 공유원장보존.
- UI 표적20검사/최종10회귀와 정책·정확소수검사 통과. 원본 연월 선택 확정·동적 연도갱신규칙은 미검증이며 KST현재연도 기준4옵션은 대상구현규칙. 총649관측ID이며 전체기능동등성 미완료.
- 메뉴기준 적용: 기존 격리workbench/shell/스크롤 유지, 신규공유ERP writer·EXE데이터변경 해당없음.
- 검색어: buyTax TaxSearchPanel ObservedDateWidget 649 세금계산서검색

## 2026-10-20 ECOUNT 재고·세금계산서 검색 배포 상태
- PR1140 e6a8fceb: 재고1949/세금계산서필수금액·정정/lookup치수/판매콤마. CI39401323484 및 Cafe24 deploy39401692655 성공, hydration 통과. root 운영재고3898값 대조 진행 예정, 세금계산서v2 80값은 이미불일치0.
- PR1141 a6d8e6e6: 세금계산서 검색폼·buyTax 안전업로드·재고연월 선택. 로컬5종검사 모두PASS(tax-search-guard-results.json), CI39402286565 PASS, squash병합완료. 배포39402638893 진행중/운영스모크미검증. source/sharedledger 추가쓰기없음.
- 검색어: PR1140 deploy39401692655 PR1141 a6d8e6e6 tax-search buyTax

## 2026-10-20 PR1141 배포 완료와 현황 후속 정책
- PR1141 Cafe24 deploy39402638893 success, SSH 적용 및 hydration smoke 통과. 원본 동등성/업무데이터 운영대조는 root 후속확인으로 분리.
- 다음 E040223/menu706 taxStat(7자) 날짜+필수 공급가액/부가세/합계 안전정책·계약·fixture 추가. 실제행0관측뿐이므로 미수집 유지, SQL실행없음. 기존독립버전업로드/복원 재사용·source-latest차단. 표적정책/actions검사PASS, 전체gate는UI최종freeze후예정.
- 검색어: PR1141 deploy39402638893 taxStat E040223 필수3금액

## 2026-10-20 세금계산서 현황 두 화면과 운영 대조
- root 운영1140 stock1949행3898값·판매26행52값 대조PASS. 1141 매출검색7필드/발송3radio/금일0(수집20부분행내),매입7열폭/7필드/radio0/미수집검색비활성·업로드활성 확인. stock 연도2025Enter/09선택/일2→2025-09-02정규화·미수집·금일복원확인. 원본연월선택동등성미검증유지.
- 후속 taxStat E040223/menu706 및 buyTaxStat E040320/menu710 안전날짜+필수3금액 정책·6열현황 구현. 원본금일0관측만, 실제자료미수집/SQL추가없음. 신규두dataset빈import서버거부, source-latest차단·실제safe수동업로드/복원허용.
- 양현황29ID씩·표적UI15검사와정책/actions통과. 총713관측ID는완료수아님. 승인상태미수집은자료버전있을때안내, 확인필터원본전체동등성추정안함. 기존격리shell적용/신규ERP writer해당없음.
- 검색어: taxStat buyTaxStat E040223 E040320 713 stock3898 sale52 1141runtime

## 2026-10-20 창고별재고·재고변동표 안전 버전 준비
- whStock E040711/menu213: 품목+창고코드 복합키, 필수수량, 단일기준일2026-10-20. stockMove E040719/menu1713: 품목코드와4필수수량, 기간양끝완전일치만조회. 제품명·규격·숨은열제외, 소계/중복키/빈import거부, 원본 및 공유ERP쓰기없음.
- 안전wrapper각1949행. whStock5847필드/stockMove9745필드 값불일치0, root원본메모리독립대조도0(inventory-import-root-mapping-validation.json). 실제SQL아직미실행. 창고가로합은수집셀합만, 미수집셀null/전체창고완전성unknown.
- 두UI16/27 ID및정책/정밀소수/기간·연도·중복·복원fixturePASS, 총787관측ID. stockMove일별·월별별도자료미수집비활성유지; source3899bodyrows는거래건수로해석하지않음. 기존격리shell적용/신규공유ERP writer없음.
- PR1142 5dd746f1 CI성공·병합. 배포39404519702는활동이력test54가09:59:59→10:00:00UTC 경계에서hour조회5중1반환으로실패, SSH미실행. 동일failedjob재시도중, 검증우회없음/관련없는코드수정없음.
- 검색어: whStock stockMove 787 inventory-import-root-mapping-validation 1142시간경계

## 2026-10-20 재고 두 화면 적재 및 배포 진행
- PR1142 배포39404519702 재시도 성공, ERP검사/SSH/hydration 모두통과. 최초 시간경계실패기록은보존.
- 재고 수량표시콤마차이 root검토로발견후 stock/whStock/stockMove 정확문자열포맷보정. 미완료검사중단·빌드미실행 후 최종5gate모두PASS(inventory-pair-final-guard-results.json), build1회. PR1143 CI39405763407 PASS/squash812dbd7b, 배포39406094217 진행중.
- root 승인독립ecount_work적재: whStock/stockMove 각각1949행revision1/readbacktrue/idempotenttrue. inventory-pair-import-results.json. 원본·공유ERP원장쓰기0, 운영화면대조는배포후예정/미검증.
- 검색어: PR1143 812dbd7b whStock stockMove revision1 inventory-pair-import-results

## 2026-10-20 창고 선택창 원본 반환 및 후속 구현
- 원본 checkbox선택→Apply→부모 exactdata-value 코드1개일치·창닫힘확인. 선택창고금일조회1949행과기존원본표qty/warehouseqty/missing불일치0(warehouse-selected-filter-result.json/warehouse-lookup-return-exact.json). 대상운영반환동등성은아직미검증.
- 대상 안전코드목록선택창960×427.5/4열465, 선택→부모조건→조회시whStock필터만반영. 이름/구분미수집공백·미관측아이콘비활성. UI28표적검사PASS,총799관측ID이며전체완료수아님. source/sharedledger쓰기0.
- PR1142 운영 root확인: 두현황721/6열·검색펼침·폼/세무거래처차이·미수집업로드활성·인쇄4항목열기닫기및비활성PASS. 실제값은원본특정확인filter0과대상미수집상태로값동일확정아님. PR1143배포진행중.
- 검색어: WarehouseLookupOverlay warehouse-selected-filter-result 799 PR1142runtime

## 2026-10-20 수불부 안전 그룹 요약 및 창고 선택창 배포
- PR1143 Cafe24 deploy39406094217 success(SSH/hydration), 재고1949행씩운영값대조는root진행. PR1144 창고선택창5gate/CI39406998813 PASS, squash1ffd6a45, 배포진행예정.
- stkLedger E040702/menu215: visibleheader품목코드경계일치1949unique, 이름미수집. 품목별opening/in/out/quantity4필수수량, 전일재고/합계2행만관측. 원본수불부vs재고변동7796필드차이0, wrapper9745필드차이0. 실제SQL미적재/상세거래0관찰·전체건수미확정.
- 대상6열650/제품코드별2행·정확기간일치만조회. notice확인=기존결과유지·검색폼복귀,취소=조회실제관측. notice발동일반규칙과X/Escape는대상설계이며원본동등성미검증. 미수집행·거래이력합성안함. UI24표적검사/정책actions PASS.
- 기존격리shell기준적용/공유ERP및EXE writer해당없음. 검색어: stkLedger StockLedgerPageControls 1949group notice 1ffd6a45

## 2026-10-20 수불부 적재와 운영 재고 정확값 대조
- root PR1143 운영검증: stock3898 exact불일치0/이전435표시차해소, whStock세로5847 exact0·가로1949품목수량차이0, stockMove9745 exact0. 원본전체수집완전성unknown은유지.
- 수불부5gate모두PASS(stock-ledger-guard-results.json), build1회. PR1145 fixed7146b255/CI39407770613진행중. root별도ecount_work stkLedger1949품목revision1/readbacktrue/idempotenttrue, stock-ledger-import-result.json. source/기존원장쓰기0.
- 수불부9745원본wrapper대조0은숫자쉼표정규화기준; 원문표시870차이는정규화차이이며운영표시대조는배포후별도미검증. 상세거래를수집한것이아님.
- 검색어: PR1145 stkLedger revision1 9745 870 stock-ledger-import-result

## 2026-10-20 품목 선택창 후속 및 수불부 배포
- PR1144 deploy39407280847 success/SSH·hydration통과. PR1145 CI39407770613 PASS/squash20758ac1, 배포39408127293 진행중.
- 수불부품목선택창: 안전품목코드1개→부모조건반환→조회시1그룹, 원본unique코드1반환/1표2행4수량일치근거. 대상 단일선택은범위제약, 검색룰·다중선택미검증·선택해제전체복귀는대상설계. 상세거래미수집유지, 단일선택notice생략/전체notice보존.
- 인쇄PDF/미리보기/프린트문제해결3항목존재관측만표시,실행미검증비활성. UI표적33검사PASS/metadata817관측ID,전체완료수아님. 신규SQL실행/원본공유원장쓰기없음.
- 검색어: ProductLookupOverlay 817 PR1145 20758ac1 stock-ledger-product-return-final

## 2026-10-20 재고잔량 원본 월별값·합계 보존
- PR1145 deploy39408127293 success/SSH·hydration통과, 수불부운영대조root예정. PR1146 CI39408608173 PASS/squash3bfd7ac6, 배포진행예정.
- stkBalance E040727/menu2775: 단일asof10/20,제품1949+실제source합계1=1950행. 제품코드/7필수수량/row.monthLabels=[10,9,8,7] 보존, 현재날짜·연도·월별값파생금지. 합계는원본직접수집값이며마지막1행code:null/isSubtotal만허용, 합산계산하지않음.
- stock-balance-import-safe.json 15600필드+1950월라벨배열대조불일치0(숫자쉼표정규화). 실제SQL아직없음. 단일기준일완전일치/중복·소계형식·월라벨혼합·누락수량거부 fixturePASS. UI28표적검사/835관측ID, 전체동등성완료아님.
- 기존격리shell적용/신규공유ERP writer없음. 검색어: stkBalance 1950 sourceSubtotal monthLabels 835

## 2026-10-20 재고잔량 적재 및 수불부 운영 검증
- root PR1145 수불부운영1949그룹×5=9745 exact수량차이0/missing0/모두전일재고·합계2행/650폭 확인. notice확인검색유지·1949보존/취소조회접힘1949확인. 상세거래미검증유지.
- PR1144 창고lookup운영960×427.5/4열25,110,110,220·Apply코드반환/닫힘/포커스복귀true·금일1949수량차이0. 원본lookup2코드 vs 대상수집1코드 범위제약유지.
- 재고잔량5gate모두PASS(stock-balance-guard-results.json), build1회. PR1147 fixed90e90081 CI39409443244진행중. root별도ecount_work stkBalance1950(제품1949+실제합계1)revision1/readbacktrue/idempotenttrue,stock-balance-import-result.json. source/sharedledger쓰기0. 월별값/합계파생없음, 운영표시검증은배포후예정.
- 검색어: PR1147 stkBalance1950 sourceTotal revision1 9745runtime

## 2026-10-20 품목 선택창 운영 검증과 잔량 배포
- PR1146 deploy39408953302 success/SSH·hydration통과. root운영 popup960×427.5/5열·코드반환/포커스복귀true·단일품목금일notice없이1표2행4수량exact0. 원본popup50표시행 vs 대상1949목록/단일선택제약유지. 인쇄3disabled메뉴열기닫기확인.
- PR1147 CI39409443244 PASS/squash3f6fa785, 잔량배포39409794557진행중. 운영1950행표시검증은완료후예정. 후속외부연동설계는UIagent가새문서/JSON만작성,API연결실행·자격증명·DDL·원장쓰기없음.
- 검색어: PR1146 runtime 4qtyexact PR1147 3f6fa785 external-integration-design

## 2026-10-20 선택품목 BOM 조회와 외부연동 설계
- PR1147 deploy39409794557 success/SSH·hydration통과. 재고잔량운영1950행/월라벨/실제합계대조root예정.
- bomStock E040726/menu2537은선택품목1코드+asof10/20에만귀속. I.검색품목1행(quantity/convertedQuantity), II.환산수량(상위품목)은그조건에서관찰empty. upperResult=empty_observed는정확코드·기준일일치때만유효,타범위uncollected. 전체BOM없음추정금지/검색품목을하위로오칭하지않음.
- bom-stock-import-safe.json1행3필드정규화대조0/실제SQL아직없음. 단일scope/2필수수량/소계·빈import·무효coverage거부/멱등복원fixturePASS. UI30표적검사/851관측ID. 무코드F8외관활성·무조회/기존결과보존,print3미실행비활성.
- 외부연동13기능새설계문서/JSON: 공급자중립화면·원천키revision·취소보상·secretRef·Outbox응답불명·웹훅·감사복원흐름. 설계완료/실행미구현,가입·API연결·DDL·scheduler없음. 공급자최신요금확정아님. 기존격리shell적용/원본공유ERP쓰기없음.
- 검색어: bomStock E040726 selected upperResult 851 external-integration-design

## 2026-10-20 BOM 선택 범위 적재·잔량 운영 정확값
- root 재고잔량1147운영1950행/13650수량exact차이0/제품1949유일/실제합계label·colspan2·monthLabels·다른기준일미수집·인쇄4열기닫기PASS. 표폭delta0.0625px남아후속보정대상,전체픽셀동등성미완료.
- BOM+외부연동설계5gate모두PASS(bom-stock-guard-results.json), build1회. PR1148 fixed d7583496 CI39411151016진행중. root별도ecount_work bomStock선택1행revision1/readbacktrue/idempotenttrue적재완료. 선택품목/asof에한정된upperempty관찰이며전체품목BOM없음의미아님. source/sharedledger쓰기0,운영화면대조는배포후예정.
- 검색어: PR1148 bomStock revision1 13650exact 0.0625px

## 2026-10-20 관계별재고 선택 범위 보존
- PR1148 CI39411151016 PASS/squash623bc523, deploy39411392175 SSH단계진행중. root bomStock1행revision1/readbacktrue/idempotenttrue별도적재완료, 원본공유원장쓰기0.
- relStock E040728/menu2879: 선택코드/asof1제품+실제합계1행만안전보존, 2필수수량/마지막null코드소계형식검증·합계재계산금지. 무코드/다른코드/다른날짜는미수집, 원본품목필수일반화없음.
- relation-stock-import-safe.json2행8필드정규화대조0/실제SQL아직없음. UI32표적검사·정책actionsPASS,총868관측ID. 4열751/span2/print3열기닫기만. 원본전체동등성미완료.
- 공유계정사용량주간42%/58%남음(root조회),작업단독사용량아님/리셋구매없음. 기존격리shell적용/공유ERP writer없음.
- 검색어: relStock E040728 868 sourceTotal selectedscope

## 2026-10-20 BOM 초기 검색폼 결함 정정
- PR1148 배포39411392175 success이나 root 실제운영에서무코드초기F3무반응발견. toggleSearch에조회용bomProductDraft빈값차단이잘못들어가품목입력폼진입자체불가. 폼토글의차단1줄만제거하고runSearch빈코드무조회는보존.
- 실제toolbar F3 handler→toggleSearch AST 실행으로폼열림/포커스/빈코드조회미실행회귀추가,UI33표적PASS. relStock PR1152미병합상태에수정포함후전체검사재실행. 앞선배포성공을BOMruntimePASS로보지않음.
- root relStock별도SQL count2 revision1/readbacktrue/idempotenttrue,relation-stock-import-result.json. 원본공유원장쓰기없음. 실제UI결함이므로추가build재검증근거있으며검증우회없음.
- 검색어: BOM F3 toggleSearch bomProductDraft PR1152 regression


### 2026-10-20 관계별 재고 및 BOM 초기 F3 복구 / 후속 입출고 모드
- PR1152는 BOM 초기 F3가 빈 품목에서 검색폼까지 막던 실제 운영 결함을 포함해 수정했다. runSearch 무코드 조회 차단은 유지하고, 실제 Toolbar→toggleSearch 실행 회귀를 추가했다. 최종 HEAD434465a9 필수5종 통과 후 CI39412754182 성공, squash5af3f218. Cafe2439413116701 진행 중이며 BOM 운영 복구는 아직 미검증이다.
- root 승인 relStock 독립영역 적재는2행/revision1/readbacktrue/idempotenttrue로 보고되었고 receipt를 보존했다. ECOUNT/공유 ERP 원장 쓰기 없음.
- 후속 stkDaily/stkMonth는 각 원본 opening1949/group_summary1949/actualtotal1의3899행을 별도 dataset으로 보존한다. 거래3899건이라는 의미가 아니다. reportMode와 원본행 역할·순서·nullable 수량·정확기간을 강제하고 모드대체/부분기간 재계산을 금지한다. 원본 opening in/out은 실제 숫자이며 앞서 blank 설명은 root가 직접 DOM 확인 후 정정했다. prepared 안전대조는 각23394필드 소수정규화 기준 불일치0, 실제 SQL 적재/운영은 아직 미검증이다.
검색어: PR1152 BOM 최초 F3 relStock stkDaily stkMonth 전일재고 group_summary actualtotal 원본공란

- 후속 UI: 주문서현황751px/검색옵션, 견적서현황716px·집계875px/Excel 메뉴 관측차이를 보정했다. P019 UI는 표시 프로그램 stockMove를 유지하되 API·버전·sanitize scope를 집계/일별/월별 독립 dataset으로 전환하며, 모드 변경 시 요청 세대/버전/이력/업로드를 초기화한다. UI 표적37개 통과, 신규 거래유형·잔량 재계산 없음. root의 양 모드 독립 wrapper 대조도 각각3899행 전필드 불일치0이며 아직 SQL 미적재다.
검색어: 주문서현황 견적서현황 P019 mode scope stale request nullable balance 873


### 2026-10-20 P019 릴리스와 명시적 빈 결과 후속
- PR1152 배포39413116701 성공 후 root 운영 검증: BOM 최초 F3 복구, 선택2수량 exact0/두 표781/다른 코드·날짜 미수집. relStock 실제2행4수량 exact0/표751/합계span2/F3조건보존/인쇄3메뉴 확인. 전체 동등성 완료 판정은 아니다.
- P019 일별·월별/주문·견적 보완 HEAD0d65dd79 필수5종 통과, PR1153 CI39414094040 성공 후 squash88b43333, 배포39414517963 진행 중. root 실제 stkDaily/stkMonth 각각3899행 revision1/readbacktrue/idempotenttrue를 적재했고 receipt를 보존했다. 원본/공유 원장 쓰기 없음.
- 다음 ordEmpty는 실제 원본 빈 결과가 확인된 E040209 정확 프로필만 저장하는 0행 envelope다. 현재시각을 원본 조회시각으로 만들지 않고 근거기록시각과 서버시각 미수집을 분리했다. 기존 orderStat/hash/집계/unknown 정책을 보존하며 신규DDL 없음. mock import/rollback/서버 조건 거부/CLI readback 회귀 통과, 실제SQL/운영은 아직 미검증. shell/sidebar+BOM755 UI와 다음 한 묶음 검사 예정이다.
검색어: PR1153 stkDaily stkMonth ordEmpty observed_empty verification_recorded_at ECOUNT envelope shell BOM755

- shell/읽기메뉴·sidebar·BOM755 UI와 ordEmpty 연결 최종freeze. 현재 GET의 실제 criteria를 서버와 동일한 프로필로 검증하고, profile밖은 SQL호출 없이 미수집으로 전환한다. rows0만으로 빈결과를 단정하지 않고 coverage 검증된 버전만 표시한다. 기존 EmptyState37+Navigation3=40 UI검사 통과, 실제 픽셀 일치는 배포 후 미검증이다.
검색어: EcountNavigation 읽기메뉴 BOM755 observed_empty ordEmpty 40tests


### 2026-10-20 명시적 빈 결과 적재 및 후속 날짜 위젯
- empty-shell HEADdee02fcf 필수5종 모두 통과, PR1154 생성. root ordEmpty 실제CLI 적재 count0/revision1/readbacktrue/idempotenttrue: 실제 원본 빈 결과의 정확프로필 envelope만 저장했으며 가짜행/신규DDL/ECOUNT·공유원장쓰기 없음. 운영 검증은 배포 후 대기다.
- PR1153 Cafe24 배포39414517963 최종성공, P019 일별·월별 및 주문·견적 운영 전행검증은 root 진행 예정이다. 날짜위젯 후속은 별도 묶음으로 분리한다.
검색어: PR1154 ordEmpty count0 readbacktrue PR1153 P019 날짜 위젯


### 2026-10-20 관측 연월 위젯 보완
- PR1154 CI39415205842 통과 후 squashd05239d8, Cafe24 배포39415568799 진행 중이다. ordEmpty 실제 적재 receipt는0행/revision1/readbacktrue/idempotenttrue로 보존했다. shell/BOM755/빈결과 운영 검증은 아직 미검증이다.
- BOM 기준일 및 주문서현황 시작일 위젯만 원본 관측 프로필을 적용했다. 2026에서 관측한 연도 목록을 보존하며 선택년도2025에도 목록 유지, 직접입력 Tab확정, BOM 월메뉴376.5625/orderStart260 높이를 반영했다. 종료일/미래연도 갱신규칙은 추정하지 않았다. 기존 stock Enter/Escape 동작 보존, UI41검사 PASS. 메타909관측ID로 증가했으나 전체 기능동등성 완료 수가 아니다.
검색어: PR1154 연월 Tab BOM376.5625 주문서260 observed-profile909


### 2026-10-20 연월 릴리스 및 견적 빈 결과·주문 미리보기
- PR1154 Cafe24 배포39415568799 최종성공, root shell/BOM755/ordEmpty 운영검증 대기. PR1155 날짜 프로필 HEADf9cc6e43 필수5종/CI39416188437 통과 후 squashcf157640, 배포39416549543 진행 중.
- 다음 quoteEmpty는 원본 전표별 exact조건/기록시각을 별도 등록하고, 기존 ordEmpty/hash/quoteStat을 보존한다. 안전 wrapper0행 준비 및 unknown조건·교차연도·프로필혼입·mock import/readback/복원 검증 통과, 실제SQL/운영은 아직 미검증이다. 주문서현황 preview는 원본 관측된751/x15/y48 표만 렌더하며 제목/회사/기간을 넣지 않고 기존 다른미리보기는 유지한다. CSP·HTMLescape·자동인쇄금지 회귀 통과, 픽셀동등성은 운영검증 전이다.
- root 확인 공유계정 주간64%사용/36%남음(본 작업 단독비용 아님), ordinaryAllowedtrue. 리셋·구매 없이 기존3작업자 재사용, 변경묶음당 필수검사/빌드1회 유지.
검색어: PR1155 quoteEmpty orderStat-detail preview751 verification_recorded_at 공유사용량64

- 1154 운영 반증 보존: shell 그룹바/좌측 폭은 원본치수 일치했으나 BOM폼 y183.390625로 원본136.21875보다47.171875 낮았다. 원본0범위 밖19일 입력 후에도 빈결과 표시가 남는 현상은 원인확정 전이며 성공판정 보류. 후속은 BOM 도구를 heading 내부로 정리하고 native 날짜 input/blur를 draft에 동기화하는 방어적 보완을 포함한다. 실제Panel19입력→F8→runSearch19전달→coverage거부/서버요청없음 및 heading내 단일toolbar 회귀 포함 UI45검사 통과. 운영 원인해결·픽셀동등성은 재배포 후 root가 재검증한다. quoteEmpty/주문preview/911 ID와 같은 묶음으로 검사한다.
검색어: BOM y47.171875 ordEmpty19일 반증 nativeinput blur quoteEmpty911 미검증

### 2026-10-20 견적 빈 범위·미리보기 릴리스 및 후속 PO/일보 판매
- PR1155 Cafe24 39416549543 성공. root 운영 연월 위젯 확인: 주문 시작월65.046875×260/연도102.71875×164.375, BOM 월65.046875×376.5625/같은 연도크기, 2026 직접입력 Tab 복귀와 2025 선택 후 관측목록 유지 확인. 조회 실행 동등성과 미래연도 규칙까지 확대하지 않는다.
- PR1156 HEADa095fd24 필수5종 모두 통과, CI39417885604 성공 후 squashe45507a2 병합. quoteEmpty 실제 격리영역 적재는 root가 PASS 이후 수행:0행/revision1/readbacktrue/idempotenttrue, receipt quote-status-observed-empty-import-result.json. ECOUNT/공유원장 쓰기0. Cafe24 및 실제 미리보기/견적 빈 범위 운영검증은 대기.
- 1154 날짜19 Tab→F8에서도 빈 결과 잔류가 재현된 실패를 보존한다. 방어적 native input/blur 동기화 및 BOM heading 배치는1156에 포함됐으나 근본원인·운영 재검증 전 성공 판정하지 않는다. Excel911 파일 해시는 root 독립 대조 일치, 실패2건 미해결 표시 유지.
- 다음 poEmpty/daySale는 별도 정확조건 coverage envelope로 준비했다. PO '결제일 기준'은 적용양식이며 날짜업무 의미는 미검증. 일보는 판매종류 하나/10월20일/빈 선택조건만 허용한다. 정책·mock store의 import/readback/멱등/rollback 및 CLI 검사 통과, 실제SQL은 아직 미실행. quoteEmpty naked[] 디코드 방어 누락도 모든 명시빈범위 envelope 필수로 통일했다; 정상 import는 기존에도 증거필수였고 기존 해시는 변경하지 않는다.
검색어: PR1156 quoteEmpty0행 19일Tab반증 BOMheading poEmpty daySale envelope 977
- 후속 UI 최종 동결: PO detail→poEmpty, 일보 daySale exact criteria와 판매 체크→적용/재열기 초기화 연결. 일보 인쇄2항목은 원본 관측대로 Escape·재클릭 시 유지, F3에서 닫힘; 실제 출력 실행은 미검증이다. observed coverage dataset은 일반 파일 업로드 버튼을 노출하지 않는다. UI EmptyState/Navigation48검사·JSX6파일·diffcheck PASS. root wrapper 독립 대조 모두 criteriaMismatch[]; 실제SQL 및 UI 운영/픽셀 검증은 아직 미검증. 메타977은 관측ID 수이며 완료기능 수가 아니다.
검색어: poEmpty daySale 판매 종류팝업48tests observed-empty977 runtime미검증

### 2026-10-20 PO/일보 릴리스와 운영 회귀 해소
- PR1156 Cafe2439418264281 성공. root1156 운영에서 BOM폼 x250.15625/y136.21875/w755/h310.46875 원본 bbox 정확 일치 확인. 주문 시작·종료19일 입력 Tab→F8 미수집, F3 재열기 두날짜19 유지 확인해1154의 빈결과 잔류 반증이 해소됐다. 금일/preview/quote 범위는 추가검증 중이다.
- PR1157 HEAD19132b0c 필수5종 PASS 후 생성/attach, CI39419124262 진행. root가 PASS 후 poEmpty/daySale를 각각0행/revision1/readbacktrue/idempotenttrue로 실제 적재했다. 별도ecount_work만, 원본/공유원장쓰기0. 두 receipt 저장, 운영 UI는 배포 전 미검증.
검색어: PR1156 BOMbbox정확 19일미수집복구 PR1157 poEmpty daySale 실제0행증거
- PR1156 견적 운영 추가검증: exact10/20 현황716/7열/빈1행span7, 다른19일 입력 Tab→F8 미수집 및 F3 날짜유지 PASS. 주문 미리보기는 enabled 메뉴→별도 Print Preview 창 생성까지만 확인; 창 내부는 도구 URL protocol 보안 정책 차단으로 미검증이다. 우회 surface/URL변경 없이 제한을 보존한다.
- PR1157 CI39419124262 성공 후 squash70a038c6, Cafe2439419456563 진행 중. 실제 PO/daySale 화면은 배포 후 root 검증 대기.
검색어: quote1156 exactempty716 preview보안정책내부미검증 PR1157배포39419456563

### 2026-10-20 미매출 날짜범위와 집계 전환 보완
- PR1157 Cafe2439419456563 최종성공, root PO/일보 운영검증 진행 중. 후속 unpSale는 E040609 기준일자/date_range/2026-10-20의 명시적 빈 결과만 별도 프로필로 등록했다. 영업주기 과거자료와 섞지 않으며 고급필터 독립 동작은 미검증이다. root wrapper 독립대조 criteriaMismatch[]·기록시각·sourceTimeNull·빈9열 확인, 실제SQL은 아직 미실행이다.
- 견적 집계 전환 오류는 API 실패가 아니라 보존된 날짜를 readonly 집계 filterSortRows에 전달해 DATE_FILTER_UNAVAILABLE가 발생한 문제였다. quote/order/po 집계 미수집 분기를 분리하고 날짜조건은 보존했다. unpSale 날짜모드 전환 시 버전 무효화 및 exact 조건만 조회, UI50검사·JSX/diffcheck PASS. 메타1002관측ID. 운영 재검증은 배포 후 필요하다.
- dayAll 전체34종류는 다음 독립 배치다. safe2217행/30빈구역/4누계분류×3기간과 거래처관계기준 조건을 하나의 불변 snapshot으로 설계하되 현재 커밋에는 구현하지 않는다. 원본값은 untracked 로컬 자료에만 두고 fixture는 합성값만 사용한다.
검색어: unpSale date_range E040609 aggregate DATE_FILTER_UNAVAILABLE 50tests1002 dayAll다음배치

### 2026-10-20 일보 전체 안전자료 원자 버전
- PR1158 필수5종/CI39420936549 PASS 후 squashee7b430c, Cafe2439421260544 진행 중. unpSale 실제 적재는 root count0/revision1/readbacktrue/idempotenttrue, 원본/공유원장쓰기0이며 운영 검증은 배포 후 예정.
- dayAll 새 envelope는 exact34종류/relationship/10월20일과 sourceTable/sourceRow를 고정한다.34구역(명시빈30),53표,AR72/AP183/재고1950/누계12=2217행. 실제합계와null/정밀문자열 보존, 이름·업체코드·미회수월·숨은코드 제외. 원본끼리 재고1949×4 대조0과 root wrapper 전필드 valueMismatches[]를 구분 기록했다; target runtime는 아직 미검증이다.
- UI53표 연속배치/34제목, AR/AP/재고합계span1/2/3, 누계4×rowspan3, canonical34 종류 반환과 부분조건 미수집, state전환 전 dataset override 보완을 구현했다. UI52검사·새합성fixture 정책/store/CLI 표적검사 PASS. 실제값은 outputs만 보관/커밋금지, actualSQL 아직미실행. 메타1018 관측ID, 전체 기능완료수가 아니다.
- 공유계정 주간87%사용/13%남음은 본 작업 단독사용량이 아니며 ordinaryAllowedtrue. 추가worker·리셋·구매 없이 최종 고정묶음당 필수검사/빌드1회 유지한다.
검색어: dayAll2217 observed_report34 sections30empty actualtotal null sourceTable atomic1018 PR1158
- dayAll 최초 HEADb4c412c7에서 계약/dnSpy/manifest/writeguard4종 PASS이나 build134 실패(Node worker semi-space 메모리commit 실패). 성공으로 간주하지 않으며 failed log 보존. 해당workerPID20060/50036은 이미 종료, 작업트리 잔류Next프로세스 확인없어 광역종료하지 않았다. 설치된 Next가 지원하는 CIRCLE_NODE_TOTAL=3으로 worker2개만 사용하여 다음빌드를 재검증한다(저장소설정파일 변경 없음).
- 원본 발주계획 table6 다단헤더 실제결함을 보정했다:12flat 대신8열/2헤더행/colspan3 두개/emptyspan8. UI53회귀 PASS, 나머지52표 폭합계 추가이상 없음. 이 새결함 변경을 포함한 고정HEAD로 필수5종 재실행한다. PR1158 Cafe2439421260544 최종성공, unpSale/집계전환 운영은root검증예정.
검색어: dayAll build134 semi-space CIRCLE_NODE_TOTAL2workers 발주계획2단8열53tests

### 2026-10-20 일보 최종검증 및 실제 적재
- HEAD1304072c 최종5종 daily-all-final 모두 PASS, 기존 지원환경 CIRCLE_NODE_TOTAL=3(2workers)로 build성공. 최초build134는 별도 실패로그로 남기고 성공으로 덮지 않았다. PR1159 생성/attach, CI39422639398 진행.
- root가 최종5종 직접확인 후 dayAll2217/revision1/readbacktrue/idempotenttrue 실제적재 완료, inventory-daily-all-kinds-import-result.json 기록. 앞선53표 관측 snapshot만 적재했고 이후동일조건 재조회51표/검색제한 안내는 별도미완료 증거로 보존했다. 최신전체조회 완전성은 미검증/complete unknown, 원본/공유원장쓰기0.
- PR1158 견적 집계 전환 실제수정 PASS, unpSale 기준일자exactempty/다른날짜미수집/영업주기차단 bounded PASS. 제목·정렬·인쇄화살표 등 시각차이는 다음독립보정으로 진행, 전체픽셀동등성미완료. 기존Preview내부는 도구보안차단으로미검증 유지.
검색어: PR1159 dayAll2217 readbacktrue 53표51표제한구분 2workerbuildPASS quoteaggregate1158

### 2026-10-20 은행 매핑 화면 설계와 미매출 시각보정
- PR1159 CI39422639398 첫 실행은 기존 importChecklistEditing 브라우저 시작에서 Chrome WS endpoint30초 timeout으로 실패(224PASS/1fail). 관련코드 변경 없이 failed job1회 재시도하며 PASS전 병합하지 않는다. 최초실패로그 보존, ECOUNT assertion 실패로 혼동하지 않는다.
- 후속 은행 매핑 popup은 원본 제목/960×676/755폭7열/F3검색폼/빈4필드/관측3매핑종류 표시만 구현했다. 미수집이며 자동매핑·선택삭제·F8·Excel은 비활성, API/DDL/저장 실행없음. 외부연동 설계문서에 draft검토→버전활성화/감사·복원 정책만 구체화했다.
- unpSale 원본 시각근거로 중앙24px 제목/오른쪽기간/중앙빈문구/인쇄화살표 존재만표시(실행disabled)를 반영하고 현재empty에없는 오천건버튼을 제거했다. UI55검사·JSX/JSON/diffcheck PASS, 메타1019관측ID. 다음 별도고정HEAD의 필수5종과운영검증은 아직대기다.
검색어: PR1159 CIChrome기동timeout 은행매핑960x676755 unpSale24px 55tests1019 설계only
- PR1159 동일HEAD의 CI39422639398 attempt2가 코드변경 없이 SUCCESS로 종료되어 squash75081bfa 병합했다. 원격 Chrome기동 실패와 재시도 성공 기록을 함께 보존하며 배포는 후속 감시한다.

### 2026-10-20 승인된 마지막 배포 마무리
- PR1159 Cafe2439423532560 최종SUCCESS, dayAll 실제53표/2217행 운영비교는 root 진행 중이며 완료로 앞서 표기하지 않는다. 기존원본 검색제한·완전성unknown은 보존한다.
- 시각보정 HEAD87e6f382 mapping-unposted 필수5종 PASS(2workers), UI55회귀 PASS. PR1160 CI39424066494 SUCCESS 후 squashf2643be6 병합, Cafe24 배포 확인 대기. 은행자동매핑/삭제/저장/외부API 실행은 없음.
- root 지시에 따라 공유계정97%사용/3%남음(본작업단독아님) 상태에서 추가기능·원본조사·새배치 착수는 중지하고 이미 진행 중인 배포/운영확인/인계만 마무리한다. 리셋·구매·추가worker 없음. 전체ERP100%완료 아님, disabled/미관측/외부연동설계 항목은 남아 있다.
검색어: PR1159deploySUCCESS PR1160f2643be6 공유97중지추가기능 dayAll런타임대기
- 1159 root 운영 exact범위53표/2217행/8426숫자/991null 불일치0 확인. 다른19일은 UI load 사전검사목록에 dayAll 누락으로 오류표시되는 실제결함 발견. 서버 strict거부는정상이며 UI검사를 PROFILES hasOwn으로통일하는1줄+실제load19일 fetch0/versionnull/error없음 회귀만수정, UI56검사PASS. 새기능없고긴급후속검증/배포대기.

## 2026-10-21 native 관리자 설치기
- PR1132 payload 그대로 포함한 단일 WinForms 설치 EXE 구현. requireAdministrator, 기존 경로/직접 선택, 모든 로컬 세션 실행 중 차단, SHA256 allowlist, 원본 백업/atomic 교체/실패 복원. DB 쓰기 없음.
- 파일 교체/거부/재설치 회귀 및 UI 렌더 확인 통과. 직원 PC 및 실제 로그인 Pivot은 미검증. 전체 gate 진행 중.
- 검색어: native-pivot-installer 관리자설치 단일EXE requireAdministrator
## 2026-10-21 바로빌 API 세팅(테스트 서버 인증키) — lib/barobillApi.js
검색어: 바로빌, barobill, SOAP, testws.baroservice.com, BAROBILL_CERTKEY, 134-86-94367, 세금계산서 API, 계좌조회 API, 카드조회 API, 홈택스 수집
- 개발자센터 파트너 '네노바'(콘솔 8614) 테스트/운영 인증키 확인 → GitHub Secret(BAROBILL_ENV=test, BAROBILL_CERTKEY, BAROBILL_CERTKEY_PROD, BAROBILL_CORPNUM=1348694367)·owner PC env. deploy.yml 이 .env.local 동기화. 회원사 번호는 134-86-94367(견적서 416-81-38772 는 케이넷).
- 의존성 없는 SOAP 클라이언트(fetch+최소 XML 파서), GET 전용 관리자 API /api/finance/barobill?action=…, 스모크 scripts/barobill-smoke.mjs, 계약 docs/contracts/barobill-api.json, 문서 docs/BAROBILL_API.md.
- 테스트서버 실측: Ping OK·회원사 1·선불 10,000·사업자상태 영업중·계좌 0·카드 0·세금계산서 0. CheckCERTIsValid -31100(공동인증서 미등록).
- 함정: ArrayOfX 래퍼는 한 단계만 벗길 것(행 객체까지 풀면 값만 남음). 쓰기 API 는 BAROBILL_ALLOW_WRITE=1 없으면 호출 전 차단.
- 남은 사람 작업: 테스트 사이트 공동인증서 등록, 계좌 4·카드 2 등록, BAROBILL_USERID 확정, 운영 전환.

## 2026-10-21 ECOUNT 이관 재개 4차(후반) — P020~P039 원본 조사 97/125·셸 169화면
- 원본 조사: 사장님 크롬 ECOUNT 세션 읽기 전용. 결과는 페이지 메모리→압축 행(JSON)으로 900자씩 읽어 scratchpad/survey/inbox/s*.json 에 즉시 저장(127.0.0.1 수신기 POST 는 자동승인 분류기가 Browser JS Exfil 로 차단 → 사용 중단). 변환기 scratchpad/survey/expand2.cjs(재조사 행이 더 풍부하면 교체, 사이트맵만 렌더된 화면 제외, 남은 ECOUNT 안내창 확인 버튼 제외).
- 함정: (1) 4초 고정 대기는 입력/시리얼 화면 미렌더 → 제목 변경+컨트롤>3 대기 루프(최대 16초). (2) 계정별원장 프리셋 후 "검색창에 계정코드를 입력하고 검색 바랍니다" 안내가 무한 반복 — 자동 확인 클릭(setInterval)이 오히려 루프를 키움(6분 623회). 끄면 정상. (3) ERP 주소를 ec_req_sid 없이 다시 열면 로그아웃 → location.reload() 만 쓸 것. (4) 크롬 확장 재연결마다 탭 그룹 재생성.
- 릴리스: PR #1215 90화면 조사 적재(+1,223버튼) · #1216 P020~P039 대상 셸(워커, 판정 규칙 3개 추가: 저장(F8)+저장/전표(F7)=input, 26 / 09 / 날짜 정규화, other 의 Search(F3)→토글) · #1217 회계I 7화면 추가(+74, 셸 169화면·ID 2,271·활성 1,054/자리표시 1,217). 전부 CI pass 후 squash.
- 현황(2,047→3,344 관측 버튼): 버튼 목록 확보 202/373, 구현 817 / 미구현 1,076 / 조건부 13 / 미관측 1,313(새 셸은 크롤 전이라 아직 미관측) / API설계전용 125 / 검증 0. 남은 조사 28화면(회계I E010712~E010823), 재로그인 대기.
- 다음: 남은 28화면 조사 → 대상 DOM 재크롤(로컬 prod 빌드 포트 3100, scripts/ecount-dom-crawl.cjs, 이전 크롤 union 필수) → 미관측→미구현/구현 재분류.
- 검색어: ECOUNT 재개4차후반 PR1215 PR1216 PR1217 survey7 survey8 expand2 계정코드안내창루프 ec_req_sid로그아웃 BrowserJSExfil 97/125 셸169

## 2026-10-21 ECOUNT 이관 재개 4차 — 회수·셸 새창·InputDraft API·105화면 대상 DOM 병합
- 회수(0단계): ECOUNT 관련 로컬/origin 브랜치·agent-* worktree 산출물은 전부 master 머지 확인(#1164~#1175, #1178~#1182, #1195). 유실 1건: 앞 세션(local_d76e6a38)의 P020~P039 125화면 원본 조사 결과(99/125)는 디스크 미저장·탭 메모리(window.__survey5)만 → 재조사 대상.
- 릴리스4(이 세션): PR #1200 P008~P019 셸 검색패널 거래처/품목/창고 새창 연결(활성 437→440) · #1201 입력 화면 7종 InputDraft 저장 API(/api/ecount/input-drafts GET/POST/PATCH, 테이블 없으면 503 MIGRATION_PENDING, DDL 미실행)+InputDraftForm · #1202 셸에 폼 통합(sourceSaveButton prop 으로 matchId 중복 방지) · #1208 105화면 대상 DOM 크롤(로컬 prod 빌드 8ab5da0c, 포트 3100) 병합. 전부 CI verify pass 후 squash.
- 분류 변화(2,047 관측 버튼): 구현 220→817 / 미구현 718→1,076 / 조건부 26→13 / 미관측 991→49 / API설계전용 92 / 검증 완료 0. 함정: 새 크롤 파일을 단독 병합하면 이전 33화면 로컬 크롤의 정적 주장 66건이 철회됨 → 크롤러 union 규칙과 같은 방식으로 이전 로컬 크롤을 union 한 뒤 병합(철회 0, E040207 거래처 대화상자 7건은 조건부).
- 비교 엑셀 outputs/ecount-parity-20261021/ECOUNT_버튼별_비교보고서.xlsx 9시트 7,924,251B sha256 0f658763…(이미지 미삽입).
- 차단: 크롬 확장 재연결(deviceId 변경)마다 Claude in Chrome 탭 그룹이 재생성되어 로그인된 ECOUNT 탭·진행 중 조사를 잃음. 조사 중 확장 재연결·다른 세션 브라우저 전환 금지. 조사 스크립트(srv/run/expand)는 세션 scratchpad 에 보관, 결과는 화면 배치마다 즉시 evidence JSON 저장 원칙.
- 검색어: ECOUNT 재개4차 PR1200 PR1201 PR1202 PR1208 InputDraft API MIGRATION_PENDING 대상DOM크롤 r4 union 철회66 미관측49 구현817 탭그룹재생성 survey6

## 2026-10-21 ECOUNT 이관 재개 1차 — PR1161 운영회귀 닫기 · 33화면 대상 DOM 증거 · ACTION_IDS 누락 11화면 수정
- 재개 기준: docs/session-backups/2026-10-21_ecount-status-and-replan.md + resume-inventory.json(이 브랜치에 복사). 코덱스 앞선 3커밋(dayAll 미관측 날짜 미수집)은 master 9a8e55a7(#1161)에 동일 포함 확인(파일 diff 동일).
- PR1161 운영회귀: 서비스 토큰 API dayAll 2026-10-20 → 200/2,217행/34구역/revision1 PASS, 10-19·10-21 → 400 INVALID_COVERAGE_SCOPE(설계상 정상). 브라우저(사장님 크롬, 네노바웹 미로그인): 10-19·금일 검색 시 53표 전부 '미수집', alert 0, 서버 요청 0 PASS. 10-20 표 렌더는 401로 미검증. 증거 data/ecount-workbench/evidence/2026-10-21-pr1161-daily-regression.json.
- 대상 DOM 크롤러 scripts/ecount-dom-crawl.cjs(puppeteer-core+시스템 크롬, 미로그인 셸, 메뉴 해시→F3→활성 버튼 클릭→data-ecount-action-id 스냅샷, lookup 창 페이지 포함, window.open 스텁, 재실행 시 union). 운영(baf6d3df) 698개, 로컬(수정 트리) 977개/1,019. 병합 scripts/ecount-merge-dom-evidence.cjs → button-matches.json target.actualStableId/domState/verificationScope, 라벨 일치 888. 미재현 정적 주장은 자동 철회(이번 최종 0건; 중간 실행에서 7건 철회 후 로컬 재현으로 복구).
- 결함 수정: ObservedPageControls ACTION_IDS에 receipt/payment/poQuery/buyStatus/discount/buyDisc/quoteStat/orderQuery/saleQuery/unsold/unbought 11 데이터셋 맵이 없어 해당 11화면(약 280버튼)이 ID 없이 렌더되던 문제 → 소스 라벨·문맥 그대로 생성해 추가. 회귀검사 __tests__/ecountActionIdCoverage.test.cjs(27 데이터셋 전수 커버리지·중복/타프로그램 금지).
- 1단계 분류표 docs/ecount-migration/step1-closure-2026-10-21.md: 1,019버튼 = 구현(활성) 212 / 미구현(비활성 자리표시) 708 / 미관측(대상 컨트롤 없음) 42 / API설계전용 57. 기능·새창·조회값 비교는 전부 미검증(검증대기 1,019). 어떤 화면도 100% 아님.
- 차단: ECOUNT 원본 관측은 크롬 ECOUNT 세션이 로그인 페이지로 튕겨 불가(사장님 로그인 요청 전달). 로그인 후 33화면 기간 프리셋/새창 원본 관측 → 708 자리표시 중 datePreset 가능 항목부터 활성화 예정.
- ERP 원장·ECOUNT 쓰기 없음. test:erp-contract 통과(수정 트리), manifest·write guard 통과, build/CI는 PR에서 확인.
- 검색어: ECOUNT 재개 ACTION_IDS 누락 11데이터셋 ecount-dom-crawl 977/1019 step1-closure 미관측42 PR1161 2217 INVALID_COVERAGE_SCOPE ECOUNT로그인차단
- 2026-10-21 릴리스1: PR #1164 CI verify SUCCESS(3회, 최종 bcc10069) → squash d3c33993 → deploy run 39532373778 success(02:26Z). 운영 스모크: /api/ping OK, dayAll 2026-10-20 API 200/2,217행/34구역, 수정 11화면 운영 크롤 279 ID 렌더(배포 전 0). 비교 엑셀 outputs/ecount-parity-20261021/ECOUNT_버튼별_비교보고서.xlsx 9시트 3,686,914B sha256 616f5756…6b4107(이미지 미삽입). 검색어: PR1164 d3c33993 39532373778 운영스모크 279ID
- 2026-10-21 릴리스2(하위 작업자 3건): PR #1165 프리셋 라벨 매핑(77c9a4fc, deploy 39535003807 success) · PR #1166 보고서 모델 DOM 분류(733a244c, 39535327937 success) · PR #1167 Excel 내보내기 35버튼(170de90d, 39536243857 success). 모두 CI verify SUCCESS 확인 후 squash. 로컬 스모크: 수금현황 227행 Excel 클릭 → xlsx 38,711B/2시트/228행 캡처 PASS. 운영 로그인 다운로드·원본 서식 동일성 미검증. 증거 evidence/2026-10-21-release2-smoke.json. 검색어: PR1165 PR1166 PR1167 Excel내보내기 presetIdForLabel 릴리스2
- 2026-10-21 원본 조사 1차: 사장님 크롬 ECOUNT 세션(Claude 탭 그룹)에서 33화면 검색패널 컨트롤·간편검색 프리셋을 조회만으로 관측(evidence/2026-10-21-source-survey.json, 간편검색설정 39종 목록은 닫기로 종료·저장 안 함). 프리셋 공통: 금주 시작 일요일, 전월+금월, 말일=당월말, 이번기수=당해1/1~오늘, 직전분기/반기, 금년/전년/직전기수, 종료일=현재 종료일을 시작일로 복사(순서의존 확인), 단일기준일 화면은 금일/전일만, 영업주기 화면은 종료일만 변경. ingest(PR #1168 스크립트+라벨 단독 매칭 보완)로 button-matches 1,073버튼(신규 54: 입/출금·판매현황·구매현황·채무 프리셋, 기본(수정불가)/정렬기준 설정/양식 버튼 등). 검색어: source-survey 간편검색 프리셋 관측 1073버튼 신규54 종료일복사 주시작일요일

## 2026-10-21 패킹 팀 업로드 이력 / 직원 중단 진단
- 공용 품목 매칭은 기존 팀 레코드. 원본·분석 복구는 개인 IndexedDB뿐이던 공백을 웹 파일 이력으로 보완. 원본 해시 검증, 불변 revision, 작성 계정, 최신 공용 매칭 재적용, ERP 승인 정보 제외.
- 10/20 16:41KST 다음·입고준비 → 원문 박스/단수 확인창 →16:42 취소 확인. 클릭로그로 잘못된 숫자를 확정하지 않음. 과거 UPLOAD_FAILED2건은 상세 없음; 일부 문서 COMMITTED/APPROVED 확인. 운영 ERP SELECT만.
- 전체 ERP/packing-team/UI/manifest/write/evidence guard/build 통과. 격리 실제 Chrome A 보관→B 조회/키보드복구 성공, ERP write0. 새 dnSpy 실행은 CLR 오류로 실패, 기존 native 근거 사용; ERP writer 변경 없음.
- 최종 PR/배포/운영 확인은 세션 문서에 추가. 실물 인보이스 입고·도착원가 E2E는 이번 작업 미검증.
- 검색어: packing-shared-history upload-history 팀공용 원본복구 직원로그 다음입고준비 취소 IndexedDB

## 2026-10-21 ERP 관리기능 공백 3축 대조(이카운트 메뉴 430·중견 ERP 모듈·네노바웹 9단계) — 보고서만
- 산출물 docs/ERP_GAP_ANALYSIS_2026-10.md + 메뉴별 태그 CSV. 코드·수식·contracts·이카운트 쓰기 없음.
- 이카운트 말단 430메뉴: 웹에 이미 있음 96(22%) / 실사용인데 웹 없음 17(4%, 거의 회계I 전표·원장·카드·계좌) / 미사용 317(74%). 사장님 판단("대부분 안 쓴다") 수치로 확인.
- 9단계 공백 중 '필요' 상위10: 여신한도·채권aging 일수구간·입금대사·환차손익·송금결재선·단가변경이력·클레임사유코드·차수마감체크리스트·거래처별이익/목표·변경감사로그 통합. 불필요=고정자산·연결회계·급여인사·생산BOM·A/S·수표·전자계약.
- 미검증: 이카운트 공식 help 대조, "커버리지 40%" 원문 미발견, 상위10이 실제 수기 관리인지(사장님 확인 필요), Amaranth/K-System 상세 모듈.
- 맥락: 바이브코딩 직원→전산 연결 플랫폼 구상(데이터 계약·직원별 MCP 권한 토큰·검증게이트·실행consumer·절차 가이드 5층) 논의에서 파생.
- 검색어: ERP공백 3축대조 이카운트430메뉴 미사용74% 여신한도 채권aging 환차손익 송금결재선 ERP_GAP_ANALYSIS 플랫폼5층

## 2026-10-21 중국발주현황 두 시트 다운로드
- 선택 세부차수 다운로드에 기존 품목별업체수량 + 단수량 시트 추가. HF/품목/CL 순서 보존, 단 전용은 숫자형 저장. 박스/송이는 등록 포장비율 환산, 누락/불일치 시 환산확인 및 합계 전파.
- 중국발주 관련 20개 검사 및 XLSX 재읽기/교차연도/필터 검사 통과. manifest/write guard 통과. 전체 계약/빌드 최초 실행은 PC 메모리 부족으로 실패하여 재검증 중. 운영 배포/실브라우저 미검증.
- 원장/API/SQL 쓰기 없음. 이전 인보이스 매칭·양방향 수량 편집은 이번 변경 범위 밖.
- 검색어: 중국발주현황 단수량 두시트 품목별업체수량 박스 송이 환산확인
- 최종 요청 변경: 다운로드 버튼 두 개로 분리, 각 파일에 선택 형식 한 시트만 생성. 단박스/단만 파일명 구분. 관련 20개 검사 재통과. 로컬 Next 빌드는 메모리 부족으로 2회 실패, 운영 미배포. PR #1177.
## 2026-10-21 경영관리(mgmt) 모듈 기반 — ECOUNT 이관과 공존 설계·골격 PR
- 설계 docs/mgmt/MGMT_CONTROLS_DESIGN.md: 이관 소유 경로(lib/ecount*, pages/(api/)ecount, components/ecount, data/ecount-workbench, docs/ecount-migration, ecount_work 스키마) 접촉 금지, mgmt 네임스페이스(lib/mgmt·pages/mgmt·pages/api/mgmt·web_mgmt 스키마) 분리, 공유 핫스팟(Layout.js·package.json·erpContractManifest.test.js) 최소 삽입+리베이스 규칙, ecount_work는 lib/mgmt/sources.js 어댑터로 읽기만, 승인모델은 이관 Outbox와 같은 상태의미(draft→requested→approved|rejected→applied, 요청자 본인 승인 금지, 하드삭제 트리거 차단).
- 골격: web_mgmt 9테이블 DDL(docs/migrations/2026-10-21_web_mgmt_controls.sql, 멱등), lib/mgmt/{schema,schemaMeta,boundary,sources,approval,approvalPolicy}.js, /api/mgmt/approvals, /mgmt 홈(상위10 카드)·/mgmt/approvals, 계약 docs/contracts/management-controls.json, 메뉴 그룹 '경영관리'(nenovaSS3만).
- 자동검사: __tests__/mgmtBoundary.test.js --changed-from origin/master 가 mgmt 변경 PR이 이관 파일을 건드리면 실패. SQL 쓰기동사 가드(ecount_work·ERP 원장). test:erp-contract 끝에 test:mgmt 연결.
- 다음: A군(여신한도·aging·단가이력·클레임코드·마감체크·거래처이익/목표·감사뷰) 기능별 PR, B군(입금대사·환차손익·송금결재선)은 어댑터 소스 채워지는 대로. 각 PR 전 origin/master 리베이스.
- 검색어: mgmt 경영관리 web_mgmt 경계 boundary ECOUNT이관공존 ApprovalRequest 결재선 management-controls 계약 MGMT_CONTROLS_DESIGN

## 2026-10-21 주차별 보고서 출력 선택·기억
- 엑셀은 1~조회차수 전체/한 차수 한 시트, 인쇄 미리보기는 체크한 차수만이라는 기존 범위를 명시하고 개수 표시. 별도 출력 항목 선택과 화면 컬럼 가져오기 제공.
- 기존 화면 컬럼 v3를 보존하며 첫 복원 전 기본값 덮어쓰기 방지. 출력 항목은 별도 localStorage에 저장하고 빈 선택도 유지/출력 차단. 같은 브라우저 범위이며 계정·기기 간 동기화 아님.
- 18차 HTTP502 신고: 502/503/504/네트워크 GET 실패만 해당 차수 최대2회 재시도, 이전 완료분 유지, 실패 시 부분파일 금지. 운영 ping200/다른 배포 진행 확인만으로 최초502 원인을 단정하지 않음.
- ERP 계산·SQL·확정본·원장 변경 없음. 전체 verify:erp-change/build·dnSpy gate 및 production-build 실제 Chrome 합성 API 검증 통과(재접속/선택빈값/41차단독/41시트/18차재시도/교차연도/1920·640px, API 쓰기0). PR/배포는 진행 중(미검증). 빌드 생성 개발이력 JSON 2개는 이 작업 이전 커밋본으로 복원.
- 검색어: profit-output-preferences 출력항목저장 화면컬럼복원 41차미리보기 18차502 차수별재시도

## 2026-10-21 유오디아 native 분배 오류 재발 방지
- 정확 감사 source=order-import-final(10/09 11:35:37.683, 2026/43-01, ProdKey2226,1박스)와 생성시각 대조. 웹 업로드가 native FormOrderAdd의 빈 ShipmentMaster 준비를 누락했다. 최근 음수 피벗 패치 무관.
- FINAL_SNAPSHOT만 기존 헤더 준비 분기에 연결. 현재연도/세부차수/업체 잠금·재사용, 주문과 동일 transaction. 분배량·날짜·농장·확정·재고·견적 자동 생성 없음.
- 실행형 API 신규/재시도/교차연도/삭제/기존확정/헤더실패/후속실패 rollback PASS. 전체 gate·배포 진행 중, EXE 실제 재조회 미검증. 운영 최신 주문/출고/date10단, 확정·공급90909/VAT9091은 read-only 확인이며 이번 턴 변경하지 않음.
- 검색어: 유오디아 블랙잭 43-01 2226 GetShipmentMaster order-import-final ShipmentMaster누락 재발방지

## 2026-10-21 선택 차수 엑셀·원본 손익 재검증
- 엑셀에만 선택 배열이 누락되어 전 차수를 요청하던 경로 수정. 인쇄/엑셀 동일 체크 범위, 단일·전체·비연속·빈 선택 회귀 및 실제 파일 시트 수 검사 추가. 계산/원장 변경 없음.
- 실제 SQL18차 476 SELECT 약6~9초, 생성 XLSX128개 값 대조. 27~31차 원본80행 동일 입력 산식 일치, 독립 SQL328항목 및 생성 파일640개 값 일치. 재고수량·원가 근거 미해결과 원본 입력 차이는 별도 설명.
- 인증 운영18차 HTTP 다운로드/502원인은 도구 초기화 경로 오류로 미검증. 상세 docs/work-sessions/2026-10-21_profit-selected-output-audit.md, 실제 숫자는 ignored .verify만 보관.
- 검색어: 선택차수엑셀 전체선택 단일다운로드 18차502 27~31원본비교 기초기말재고 SQL328

## 2026-10-21 44-01 직원 업로드 처리 중 대기 점검
- 사용자 확인: 2026/44-01 업로드 화면이 처리 중에서 멈춤. 최근 3일 주문 API 감사 SUCCESS24, FAIL0; 당일 완료 주문 요청 없음. 특정 직원 요청 원인은 미확정.
- SELECT-only: ViewOrder760, ViewShipment0, ShipmentImportAudit0, 재고게이트 IDLE/PendingCalc=false. 전체 세션 조회 권한 없어 서버 전체 잠금은 미검증.
- 기존 최종 업로드10업체/169활성 주문행에 ShipmentMaster 누락 확인. PR1183 예방수정 Cafe24 성공 확인; 기존누락 소급보정은 수행하지 않음.
- UI 파일분석/저장120초, 업체보조조회/저장후조회30초 응답대기 상한. timeout은 서버취소 아님, 초안보존/자동재전송없음/늦은응답 성공표시없음. SQL/API 쓰기정책 변경없음.
- 회귀: 정상/409/끝나지 않는 요청/JSON본문대기/늦은저장응답/재시도0 실행검사 PASS. 전체필수검사·배포 진행 중. 상세 docs/work-sessions/2026-10-21_upload-response-wait.md.
- 검색어: 44-01 직원업로드 처리중 응답대기 timeout ShipmentMaster10 169 withOrderImportDeadline
- 추가검증: 최신 전체 요청이 남은 업로드15업체299품목 비교 차이7·추가3은 모두 이후 OrderHistory 수정/삭제/신규로 설명. 재업로드 원복금지. 로컬5종 exit0, PR1185 CI39552447489 success 후 squash22983567, Cafe2439552707668 진행.

- 완료: PR1185 squash22983567, Cafe2439552707668 SUCCESS, SSH·hydration 실브라우저 PASS. Chrome 운영 주문업로드 로딩·기존초안복원 확인, 실제 운영 bundle에서120초/30초 및 timeout분기 확인. 원장수정0. 기존10업체 헤더누락/직원개별요청 최초원인은 미해결·미검증으로 명시. 사용자 DB손상 없으면 계속 진행 지시 반영.

## 2026-10-21 EXE 연결 헤더 보정 완료 및 지식 저장
- 사용자 승인 범위: 기존 주문수량 보존, 누락10업체 헤더만 보정. dnSpy 실제 FormOrderAdd/ShipmentDistribution 재확인 후 SERIALIZABLE 롤백 리허설·적용·별도 연결 조회 완료.
- 2026/44-01 ShipmentMaster10건(7069~7078) 추가, KeyNumbering 동기화. 14개 보호 영역 행 수·SHA256 동일. 주문/출고상세/재고/견적/매출 변경 없음. EXE SQL조회10/10, EXE GUI 미검증.
- docs/knowledge/NATIVE_SHIPMENT_HEADER_CONTRACT.md를 AGENTS.md 필수 참조로 연결. 세션 인계 docs/session-backups/2026-10-21_upload-header-repair.md. 직원 최초 정지원인은 미확정.
- 검색어: EXE 연결헤더 ShipmentMaster dnSpy GetShipmentMaster 44-01 10업체 7069 7078 주문수량보존

## 2026-10-21 선택 차수 배포·기기별 로그인 유지
- 선택 차수 수정 PR1187 → master16e6ca5f → Cafe24 run39553387769 성공. 배포된 UI 실제 Chromium 합성 API 시트 다운로드 회귀 통과, ping DB연결 성공. 운영 실제18 HTTP는 별도 수동 read-only smoke로 검증 준비.
- 사용자 추가 선택: 이 기기 로그인 유지 opt-in만. 웹/모바일 기본 해제 체크박스, 미선택8시간. 일반 브라우저400일 미사용 제한/일단위 연장, 기존 PC웹앱은 cookie-change 업무창 stop/hide 방지를 위해 중간갱신 없는 고정400일. 서버 hashed runtime session, API/SSR 현재 계정 검증, 비밀번호변경·비활성·로그아웃 폐기, 외부Bearer8시간 보존.
- ERP/UserInfo 쓰기 없음. 로그인 유지 단위 회귀 통과; 전체gate/CI/배포 진행 중(미검증). docs/work-sessions/2026-10-21_remember-device.md 참고.
- 검색어: 로그인유지 이기기 8시간자동해제 rememberDevice 400일 서버폐기 18차운영다운로드

## 2026-10-21 알스트로 물량표 자동 박스·합계
- 입력 수량 옆 박스(자동) 수식열, 내부 테두리 제거. 업체 두 열 전체 복사삽입을 INDEX/COLUMN 합계로 지원. 빈칸·업체명 변경·새 열 삽입 후 업로드는 숫자 수량만 판독.
- 실제 Excel 수량변경/삭제/빈칸입력/두열삽입/합계 및 XLSX 재업로드 검사 통과. DB/저장정책 변경 없음. 전체검사·배포 진행 중(미검증).
- 검색어: 알스트로 박스자동 두열복사 수량삭제 합계 INDEX COLUMN 분배업로드
## 2026-10-21 패킹 매칭 후 원문 검증 복구
- 상단 문제값 목록과 직접 수정 연결, 총액 검산 차이 표시, NL Handling 명시 수정. 기존 매칭/원문/입고 승인과 writer 유지.
- 실제 중국 해상 41-1 PDF 7페이지101행 웹 업로드·PDF 렌더·날짜/빈 단가금액 수정·재생성 격리 검증. 실제 카탈로그 매칭5행/추가확인96행, 실입고 완료는 미검증. 운영 DB 쓰기·유료 AI 호출 없음.
- 인계: docs/work-sessions/2026-10-21_packing-validation-repair.md. 배포는 CI/Actions 최종 결과 참조.
- 검색어: 패킹 매칭후막힘 인식값수정 DATE_ORDER_AMBIGUOUS AMOUNT_COMPONENTS_UNAVAILABLE Sinensis white Handling 41-1

## 2026-10-21 알스트로 입고 점검·업체명 병합
- 2026/44-01 알스트로 입고 원본/뷰 모두0행, 43-01=1648. 차수 대체 없음. 업체 헤더 두열병합, 업로드 병합보조열 품목오인 방지.
- 실제 Excel 복사삽입/이름변경/수량삭제/두열통삭제 및 저장파일 파서 통과. 필수검사/배포 진행 중(미검증).
- 검색어: 알스트로 44-01 입고없음 업체명병합 두열삭제

## 2026-10-21 경영관리(mgmt) A군 7기능 머지 — PR #1179 #1180 #1181 #1182
- ①여신한도 /mgmt/credit-limit(CreditLimitHistory 추가전용, 80%경고/초과) ②채권aging /mgmt/ar-aging(ar.js 쿼리 복제, FIFO 상계, 초과입금 credit 분리, 구간합−credit=잔액) ⑥단가변경이력 /mgmt/price-history(CustomerProdCost·Product.Cost 스냅샷 비교, 첫 스냅샷=기준선, PriceSnapshot 테이블 추가) ⑦클레임사유코드 /mgmt/claim-codes(8코드 시드, WebSalesDefectDeduction.DeductionKey 연결, 농장×사유 집계) ⑧차수마감 /mgmt/week-close(UNQUOTED·NEGATIVE_STOCK·EMPTY_SDETAIL·UNPAID·UNREMITTED·VERIFY_WEEK, WeekCloseCheck) ⑨거래처별이익·목표 /mgmt/customer-profit(보고서 스냅샷 카테고리행을 확정출고 저장Amount 비중으로 배분, 0.01원 정수배분 합계보존, CustomerTarget) ⑩감사뷰 /mgmt/audit-view(SystemActionLog·ShipmentHistory·PriceChangeHistory·CreditLimitHistory·ApprovalAudit 통합).
- 하위 작업자 4명 병렬(code-worker, worktree) → 메인이 리베이스·충돌(계약 scope/test:mgmt/index.js ready 플래그 union)·PR·머지. 매니페스트 140개 통과.
- ⚠ #1180·#1182는 체크 보고 전 머지됨(리베이스 후 force push로 체크 리셋). master ERP Contract Guard로 사후 확인. 다음부터 push 후 checks 등록 확인하고 merge.
- 미검증: 전 기능 실DB 미실행(순수로직+계약검사만). 운영 실증 필요: aging 합계 vs /api/sales/ar, 거래처이익 합계 vs 보고서 총이익(diff 배지), UNREMITTED 업무정의(WebFarmRemit.Weeks 농장단위 추정), SystemActionLog ActionType 명칭, 확정차수 확정값 vs 스냅샷.
- 남은 B군: ③입금대사 ④환차손익 ⑤송금결재선 화면연결(승인모델·ReceiptMatch 테이블은 있음).
- 검색어: mgmt A군 여신한도 aging 단가이력 클레임코드 마감체크 거래처이익 감사뷰 PR1179 PR1180 PR1181 PR1182 PriceSnapshot 체크전머지

## 2026-10-21 주광 요일 업로드·분배 품종 제한
- 기존 주문 보존 별도 업로드, 시트/품종 명시, 빈칸/0 무시, 동일 no-op/다른 기존분배 차단. 일반 분배 업로드 수국 선택 범위를 서버까지 제한.
- 실제 파일·격리 SQL 신규/중복/강제실패 롤백 통과. 필수검사/빌드/1366px Chrome 통과. PR1206 CI/배포 진행 중(배포 미검증). 운영 DB 쓰기 없음. docs/work-sessions/2026-10-21_jugwang-weekday-upload.md 참고.
- 검색어: 주광 요일수량 수국 카네이션 업로드 시트 ShipmentDate 주문보존 감사122


## 2026-10-21 분배 업로드 새 파일 자동 범위
- 사용자 정정: 수국만 선택을 추가하는 것이 아니라 새 수국 파일 자체 기준. 수동 시트/품종 필터 제거, 실제 행/제목 품종 자동판별, 교차품종 오매칭 차단, 새파일 이전결과 폐기.
- 감사122 STARTED/0, ERP/audit 원자적 저장 및 이전 프로세스 교체 확인. 재업로드는 현재DB 재검증. 회귀·빌드·배포 진행 중(미검증). docs/work-sessions/2026-10-21_import-file-scope.md.
- 검색어: 새파일 기준 수국 카네이션 자동범위 중단 재업로드 이전응답


## 2026-10-21 에콰도르 과거 재고·원가 누락 대사
- 사용자 확인: 후속 전산오류 조정은 과거 부풀려진 재고 제거 목적. 이중 차감 방지를 위해 기존 이력 보존, 정확한 상쇄 감사행과 native CALC를 한 트랜잭션으로 처리하는 수동 도구·계약·회귀 추가.
- 기본 SELECT only, 원천 지문·명시 범위·실제 롤백 리허설 필수. Product.Stock/주문/출고/견적/매입/확정자료 보존 검사. 미래 매입단가로 과거 원가를 만들지 않음.
- 읽기 전용 계획 통과. 전체검사·배포·운영 적용·보고서 최종 재조회 진행 중(미검증). docs/work-sessions/2026-10-21_ecuador-stock-cost.md 참고.
- 검색어: 에콰도르 31차 30차이월 41차전산오류 원가누락 이중차감 historicalStockRepair

## 2026-10-21 알스트로 전체 제목 병합
- 주문·입고·재고·잔량·농장명·입고합계까지 제목 두열병합 확대. 본문 숫자/박스/합계 수식·업로드 정책 보존. 양방향 입력은 일반 수식으로 불가 안내.
- 필수검사·배포 진행 중(미검증). 검색어: 알스트로 요약농장 제목병합 양방향수식

## 2026-10-21 경영관리 운영 실측(크롬 Browser1, 계정 nenovaSS1 강현우) + 수정 PR #1197
- 실측(배포 8ab5da0c): /mgmt 홈 7카드 열기 OK · 여신한도 잔액 합계 22,055,603,875 · aging 합계 22,035,173,875(차이 20,430,000 = 기준일 이후 청구) · 90+ 구간 17.37억 = ReceivableLedger 입금 0건이라 전 청구 미수 집계(입금은 이카운트에만) · 거래처별이익 합계 52,037,501 = 보고서 총이익 배지 일치(이번 달) · 차수마감 42-1: 견적미등록14·잔량마이너스10·빈출고상세39·미입금59·송금미완료48 · 클레임코드 사전 비어있음(시드 미실행), 불량차감 행 농장 미연결 175건 · 단가이력 스냅샷 미실행 · 감사뷰 '읽지 못한 원천: ShipmentHistory' · 직원 계정으로 URL 직접 접근 가능.
- 수정(#1197, f268ecd4): ShipmentHistory ColumName→Descr, aging futureExcluded·totalPaid 보고+입금0 경고, 금액 반올림, lib/mgmt/access.js 관리자(authority<=1·대표) 외 403.
- 미실측: 여신한도 등록·사유코드 시드·단가 스냅샷 실행 등 쓰기 동작(사장님 계정 필요), 기준일 변경 시 aging.
- 교훈: /sales/ar 기본 기간은 당월이라 aging(전기간)과 바로 비교 불가. 운영 실측은 로그인 계정이 누구인지 먼저 확인(화면 하단 'OOO (ID)').
- 검색어: mgmt 운영실측 aging 22035173875 futureExcluded ReceivableLedger입금0 ShipmentHistory Descr 관리자가드 403 PR1197 week-close 42-1

## 2026-10-21 신라 입고·견적·손익 확인 탭
- /raum/shilla-analysis/check: 기존 연결 확장 그대로 작업 시작→월별 조회→최신 DB 비교. 원본 Excel 미첨부는 저장손익 기준으로 명시. 시네신스220 수정대기/호접485 확인은 연도·차수·기간·원본값 조건으로 분리, 원장 보정 없음.
- 신라 회귀26개 통과. 전체검사·배포·실브라우저 진행 중(미검증).
- 검색어: 신라 작업시작 자동대조 시네신스220 호접485 shilla-check
## 2026-10-21 중국발주 다운로드 버튼 잘림
- 운영 1366px에서 버튼 right=1386.90625 재현. 컨테이너/차수/파일 도구 줄바꿈 및 최대너비 제한. 데이터/환산/원장 변경 없음. 검증·배포 진행 중.
- 검색어: 중국발주 다운로드 버튼 안보임 1366 flex-wrap 단만 단박스

## 2026-10-21 국가별 발주서 품목 정렬
- 전 국가 Excel 출력과 미리보기를 품목명 A-Z(대소문자 무시)로 정렬. 에콰도르는 전산 기본 품목순 이후 사용자 확인한 합포장 인접 묶음 유지. 수량·단위·박스 산식·원장 보존.
- 실제 dnSpy FormQuantityPivot 및 PivotGridFieldBase 기본 Ascending 확인. 운영 조회 파일 재개봉: 네덜란드42-02 74품목/16049송이, 에콰도르42-01 8품목/1150송이 보존. 관련39테스트 통과(선택적 로컬원본3개 skip), dnSpy/manifest/write 가드 통과. 전체 ERP 검사·빌드 통과. PR #1209 CI 최초 통과, 최신 master 통합 CI 및 배포 진행 중(배포 미검증).
- 검색어: 국가별발주서 엑셀 A-Z 품목정렬 에콰도르 합포장 importPedidos CountryOrders

## 2026-10-21 패킹 날짜 확인 후 다음 버튼 무반응 안내
- 금일 서버 로그에는 해당 client 검증 실패 기록 없음. 최신 42-1 CHINA CI 업로드 snapshot에 날짜 확인 미완료. 현재 미저장 브라우저 상태와 구분.
- validateDrafts 실패 시 submitError를 비워놓던 분기 수정: 날짜/총액 사유 등 항목별 즉시 알림창 및 화면 요약. generation 실패 이유도 준비 단계로 전달. 검증 조건·매칭·원문·ERP writer는 보존.
- 단위/관련 회귀31건 및 빌드 통과. 실제41-1 PDF 로컬 브라우저에서 팝업/인라인/날짜 보존·사유 수정 확인. 전체 검사·배포 결과는 세션 문서 후속 기록. 운영 DB 쓰기 없음.
- 검색어: packing next blocked DATE_ORDER_AMBIGUOUS 확인사유 submitError 42-1 CHINA

## 2026-10-21 공통 CALC 차수정렬 승인 후 보정
- 사용자 명시 승인에 따라 정확한 운영 SP 정의의 커서 정렬만 수정하는 수동 도구 추가. 원본 백업·권한/옵션/매개변수 보존, ALTER와 기존 승인 재고 보정을 한 transaction으로 rehearsal/apply. 계산식·Product.Stock·보호 원장 보존.
- 순서/near-miss/교차연도/legacy/단계별 실패 회귀 통과. 전체 gate·CI·배포 및 운영 통합 rehearsal/apply는 진행 중(미검증). docs/work-sessions/2026-10-21_stock-calc-order.md 참고.
- 검색어: CALC CURSOR ORDER BY 공통SQL 정렬 에콰도르 31차 이월 원자보정
- 2026-10-21 추가 실측(사장님 계정 nenovaSS3, 크롬 "사무실 pc" 893da7f6, 운영 df079d26): aging 잔액 22,036,756,225 + 기준일 이후 20,430,000 = 여신한도 22,057,186,225 설명문 표시·입금0 경고 표시 OK · 감사뷰 ShipmentHistory 행 정상(42-02 라움 수국 단가 32.23→33.23 등) · 단가 스냅샷 1회 실행(17:07:13, 기준선) · 클레임 사유코드 8개 시드 완료 · 직원 계정(nenovaSS1)은 403 확인. 미실측: 여신한도 등록·사유코드 연결 저장·주차 마감 상태 저장(쓰기 3종, 업무 값 필요). 검색어: mgmt 실측2 nenovaSS3 스냅샷기준선 사유코드시드 403확인

## 2026-10-21 42-1 격리 입고와 차단 사유 이력
- 실제 PDF→수동 매칭→날짜 사유 누락 오류/SQL 로그→사유 보완→입고 등록/재조회 통과. 64행/186박스/2280단/31450송이/57230CNY. 동일 operation 중복 없음, 전년도·주문·분배 보존.
- REVIEW_BLOCKED/PREPARE_BLOCKED 상세를 기존 audit 로그에 저장. 서버 actor와 eventId 멱등 유지. 운영 입고·재고·매칭 쓰기 없음. 원가 계산은 별도 필수값 미입력으로 미검증.
- 전체검사 통과, WarehouseKey 표시 후속 보완 재검증 및 배포 진행 중. docs/work-sessions/2026-10-21_packing-42-e2e.md 참조.
- 검색어: 42-1 CHINA CI REVIEW_BLOCKED 날짜확인 작업로그 격리SQL
- 입고번호 표시 보완 후 실제42-1 전체 흐름 재실행도 통과. PR1214 CI/배포 진행 중.



## 2026-10-21 신라 확인 탭 확장 주소 호환 보완
- PR #1205 배포 후 기존 확장 background가 하위 경로를 거부하는 실제 문제 확인. 새 메뉴 주소는 유지하고 허용된 기존 주소의 workspace=check로 서버 리다이렉트. 확장 재설치 없이 새 화면 사용.
- DB 쓰기 없음. 기존 638행 실제 조회 성공, 새 경로 자동완료는 배포 후 검증 예정.
- 검색어: shilla-check bridge workspace query redirect 1205

## 2026-10-22 입고 참고일 차단 분리·박스 현황
- 실제 dnSpy ExcelLoadingPackingList 기준 InputDate/OrderWeek/BoxQuantity 확인. 인쇄 날짜 경고는 보존하되 수량 오류처럼 진행을 막지 않음. 실제 입고일·연도·수량·금액 검증 유지.
- 새 /incoming/boxes 조회 전용: 저장 BoxQuantity, 연도·세부차수·국가·품종 필터, NULL 별도 경고. DB 스키마·EXE·SP 변경 없음.
- 직접 Computer Use로 42-1 PDF→Ammi 수동매칭→입고91001→원가 승인/재조회→엑셀 다운로드 완료(격리SQL). 64행/186박스, 도착원가29048581.029768원. 기존 동일 송장 환율215/품목별 추정 비용 근거 재현. 운영 DB 쓰기 없음. 종료 후 주문·분배 보존 검사 통과.
- 전체 ERP 검사·빌드 통과, 최종 표시 보완 재빌드/PR/배포 진행 중. Excel 자체 머리글 시각검증과 운영 스모크는 미검증. 상세 docs/work-sessions/2026-10-22_receipt-boxes.md.
- 검색어: 42-1 입고 참고날짜 박스현황 186 도착원가 다운로드 격리SQL



## 2026-10-22 분배 업로드 수동 매칭·건너뛰기
- 최신 master aea62143 기반 codex/import-manual-skip 작업트리. Product1717/3085 실측 및 FormShipmentDistribution fresh dnSpy 확인.
- 수동 키 우선/무효키 자동fallback 금지, 명시 품목 건너뛰기/취소, 제외 시 남은 매칭품목 범위 HMAC/coverage/잠금/검증 일치. 제외·파일밖 품목 보존, 포함 품목 누락업체0 정책 유지.
- 신규6회귀·관련 업로드 검사·격리 브라우저 수동→제외→재검증→취소→적용 payload 통과. 필수 전체검사 최종/CI/운영 배포 미검증(후속 예정).
- 운영 쓰기/배포 없음. 사용자 업로드 보호 및 약2시간 유예 유지. docs/work-sessions/2026-10-22_import-manual-skip.md 참조.
- 검색어: 루스커스 40cm manualChoice IMPORT_SKIP_PRODUCT_VALUE replacementProductKeys PR1213 회귀 업로드보호

- 최종 검증: 전체 test:erp-contract 통과, test:nenova-dnspy-evidence/manifest/write guard 통과. 빌드 통과 후 마지막 UI 비동기 선택 처리까지 최종 재빌드 중. 운영 배포/실파일 적용은 유예 및 미검증.

- 완료 검증: 마지막 UI 비동기 수정 포함 최종 npm run build 성공. 최종 산출물에서 격리 브라우저 전체 흐름 및 전부 건너뛰기 안내/비활성 통과. 전체 ERP 계약·dnSpy·manifest·쓰기 가드 성공. PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1221 draft 생성, CI는 원격 진행 중. 자동화에 작업트리/PR 인계 완료. 약11:22 이후 업로드 종료 확인 전까지 병합/배포 금지. 운영 스모크·실파일 저장·EXE GUI는 미검증.

- 2026-10-22 입고 박스 후속: 최종 미리보기 표시 보완 빌드/관련64통과1skip/UI/manifest144/writeguard 통과. PR1224 draft 생성, CI 대기. PR1221 업로드 보호 유예 기록 때문에 사용자에게 현재 업로드 종료 여부 확인 중, 답변 전 이번 배포 보류. 운영 DB 쓰기 없음. 검색어: PR1224 입고 박스 배포대기
