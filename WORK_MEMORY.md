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
