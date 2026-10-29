# 작업 기록

## 2026-10-22 ECOUNT 검증 2~3차(자동 갱신·원본 대조·수집 추가)
- PR #1241: 수집 직후 웹 작업본 자동 갱신(RED 건너뜀, 기준시각·검사상태 표시) + 채무 RED 오판(원 단위 반올림 2원 차, 허용폭 1원) 수정 → 허용폭 max(1,0.5×행수). 배포 후 채무 911 GREEN·작업본 자동 갱신 확인.
- PR #1242: 원본 화면 직접 읽기(부모 세션 브라우저) — 채권·채무·계좌 웹=최신 스냅샷=원본 합계 → 검증 0→8. 원본 0건 7화면, 회계거래조회 10/20 원본 12 vs 웹 업로드 9(시차).
- 판매조회(saleQuery)·회계거래조회(journal) 매일 수집 추가(기본 기간 F8→Excel), 자동 갱신 대상 포함.
- 검색어: ECOUNT 자동갱신 refreshFromLatest RED 반올림 허용폭 source-grid saleQuery journal 매일수집

## 2026-10-22 ECOUNT 검증 1차(우선순위 화면)
- 운영 DOM 크롤 15화면: 미관측 170→101, 구현 1,677·미구현 1,940. 조회값 코드 대조(scripts/ecount-verify-values.mjs): 웹 변환은 원천 스냅샷과 100% 일치.
- 판매현황 조회 2버튼 기능·새창·값 일치(검증 0→2, 캡처 없어 버튼상태 미검증 유지). 채권·채무·계좌 = 웹 작업본 10/20 고정 데이터 시차. 채권조회 등 8화면 자료 미연결. PR #1238.
- 검색어: ECOUNT 검증 value-parity 데이터시차 E040214 E040309 E010205 E040207 verify-values

## 2026-10-22 ECOUNT 원본 조사 마무리(관찰 사용 화면만)
- 사장님 결정: 남은 128화면 중 직원 관찰(9/18~10/14, 210건)에서 쓴 8화면만 조사(채권조회·채권거래내역·채권현황·채무현황·계획전표조회/현황·수입비용전표검색·전표별회계반영(비용) 조회만) + 선행 5화면. 나머지 120 미사용·미조사, 위험 10 열지 않음(scope-decisions.json). 구현 대상 제외.
- 결과: 버튼 목록 243/373, 관측 3,867, 구현 1,649, 검증 0. 새 124 버튼은 대상 DOM 크롤 전이라 미관측. PR #1234.
- 검색어: ECOUNT 미사용 120 위험제외 scope-decisions 채권조회 E060403 E060814 계획전표 survey-used-p040-p047

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

## 2026-10-22 ECOUNT P020~P039 원본 조사 125/125 완료 (PR #1222)
- 남은 회계I 28화면을 2026-10-22 조사(사업자번호 [사업자번호] 마스킹)·셸·대상 DOM 크롤까지 한 PR. 증거 evidence/2026-10-22-source-survey-p020-p039-rest.json, 셸 197화면·ID 2,670, 버튼 3,743(+399), 목록 확보 230/373, 구현 1,649 / 미구현 1,899 / 미관측 49 / API설계 133 / 검증 0.
- 조사일이 다른 증거 파일이 섞이므로 프리셋 날짜 대조는 page.sourceSurvey.observedOn 기준(822건 일치).
- 안내창 루프 대응: closeDialogs 안에서 계정코드 안내창만 1회 확인 클릭(반복 setInterval 금지) → 28화면 약 10분.
- 다음: 회계II P040~P051, 관리/그룹웨어 P052~P059, 사용자설정 P005~P007(원본 미조사 143).
- 검색어: ECOUNT P020~P039 완료 PR1222 125/125 2026-10-22 rest 사업자번호마스킹 observedOn 화면별조사일

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

## 2026-10-22 네덜란드·베트남 이월 및 후속 재계산
- native CALC 후 전차수 원장 산식 검증을 재고조정·확정출고 감소/삭제에 추가. 구형 API의 확정수량 수정 우회 차단.
- SQL 보정 미리보기: 승인 두 품목 126 snapshot 검사, 113 변경 예정. 기존 이력·현재고·확정보고서 보존, 에콰도르 재보정 금지.
- 관련 회귀97개 통과. 전체검사·배포·운영보정은 진행 중(미완료). 상세는 docs/work-sessions/2026-10-22_carry-cascade.md.
- 검색어: carry cascade Netherlands Vietnam 후속재고 출고삭제 41차
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

## 2026-10-22 기존 자동매칭 복구
- 어제부터 자동매칭 품목이 전부 미매칭이며 루스커스가 수국으로 잡힌다는 사용자 확인. 제목보다 행/DB품목 우선, 루스커스 일반/40/50/70cm 분리, 미지원 DB품종명 보존, 수량표시/판정 공통 helper 적용.
- 실제 XLSX→실제 preview 자동매칭/교차연도/제외 포함9회귀 PASS. manifest/쓰기가드 PASS. PC 가용 메모리 부족(일시100MB 이하)으로 전체검사/빌드 프로세스 중단, 운영 배포 전 원격 격리 CI로 전체 재검증 예정. 운영 DB 쓰기 없음.
- 검색어: 자동매칭 루스커스 수국 PR1213 productFamilySource sourceProductFamily import-family-fix
## 2026-10-22 이월 보정 완료와 네덜란드 원가 후속
- PR1225/master78f19ba3, CI39702671667/Cafe24배포39702956142 및 hydration/ping 성공. 이전 항목의1221/1224는 이미 master에 병합된 상태를 확인하고 진행했다.
- native-only 두 품목126snapshot 검산/113수정, rollback rehearsal 및 commit 별도 readback 성공. 이력/현재고/확정보고서 보존. 보정 재실행 금지.
- 실제18·26·31·41 다운로드39704410335 모두 성공. 1~41재고15,692검사 대상문제0. 초기차수 다른18품목21관측,34·35입력경고 및 다른품목 음수재고 남음.
- 수량 복원 후 드러난 네덜란드 오래된 매입의 판매단가 대체를 SELECT-only 취득원가 재현으로 보완. EUR/국가 cache 격리, 베트남 평균원가 공식 유지. 새 작업트리nw-netherlands-acquisition. 최종 CI/배포 진행 중.
- 상세 docs/work-sessions/2026-10-22_carry-cascade.md. 실물/EXE GUI 미검증. 전체정상 주장 금지.
- 검색어: PR1225 carry cascade 네덜란드 베트남 113 126 acquisition EUR 원가이월 재실행금지

## 2026-10-22 ECOUNT 데이터 → 우리 DB `ecount` 스키마 별도 적재(1단계) — 사장님 지시 "ecount db 별도, 검증 후 합치기"
- DB 생성 권한 없음(nenova1_nenova: dbcreator 0, CREATE SCHEMA 1, SQL2016 Web) → 같은 DB 안 `ecount` 스키마로 분리. ecount_work(화면 동등성 작업영역)·web_mgmt 와 별개.
- 구조: ecount.Dataset(13 prgId 사전)·LoadBatch(파일 sha·기간·행수·화면합계·InsertCnt/DedupCnt)·Raw_<PrgId>(이카운트 엑셀 헤더를 한글 그대로 열 이름, RowHash 중복생략, 합계행 IsSubtotal) + 대조 뷰 ecount.cmp_*(views.js 가 실제 열 보고 CREATE OR ALTER). lib/ecountLedger, scripts/ecount-ledger(load-xlsx·backfill-legacy·ensure-schema), /api/ecount-ledger/status(관리자). 계약 ecount-ledger.json.
- 실측: 오늘 데몬 판매현황 엑셀(2026-09-01~10-22, 10,621행, 화면합계 3,060,164,321) load-xlsx 적재 OK(batch 1, dedup 0). cmp_sales_daily: ECOUNT 3,060,164,321 vs 우리 출고(isFix) 3,025,917,101, 차이 34,247,220(1.1%). **일자 기준이 달라 일별 매칭은 어긋남**(ECOUNT 판매일자 vs 우리 ShipmentDtm 기본출고일) → 차수·거래처 단위 대조 뷰 필요(2단계).
- legacy dbo.WebEcountRow 80만행 backfill dry-run: 고유 15,779행(sales 13,885·ar 797·ap 831·cash 266), 영문 열(Payload 키) → 미적용. 엑셀 원본 수집으로 대체 예정.
- 데몬 판매현황 전송 413 원인 nginx 1m → #1226 /api/ecount/ingest 20m. 데몬 세션 기본기간은 전월+금월, 과거 전기간 월단위 수집기는 2단계(데몬 일시정지 후 같은 프로필 사용).
- 검색어: ecount스키마 ecount-ledger load-xlsx Raw_E040207 cmp_sales_daily 3060164321 34247220 일자기준불일치 backfill15779 413 nginx20m

- 2026-10-22 네덜란드 원가 후속 PR1228: 전체 ERP 계약·dnSpy·manifest·쓰기 가드/CI39705549884 통과. 로컬 최초 build는 메모리 부족 상태에서 종료, NODE_OPTIONS 1536MB 제한 재시도 성공. master의 ECOUNT 별도적재 변경은 그대로 보존해 통합 후 재빌드/CI 진행. 검색어: PR1228 네덜란드 취득원가 EUR 장기이월

- 업로드 유예 최신 정정: 사용자의 지금배포 지시로 PR1221은 이미 a051f8bd 배포39701400245 완료. 이전 11:22 대기/업로드 종료 재승인 조건은 이 작업에 적용하지 않음. 이번 자동매칭 회귀도 수정→필수검증→배포 요청의 연속이며 시험 운영분배는 하지 않음.
- 2026-10-22 자동매칭 PR1229 master aa4970be, CI39707238221/격리 build+ERP39707238229 통과, Cafe24배포39707639322 진행. 열린 업로드의 이전 family 키 보존 후속: 동일 시트/품목 유일할 때 수동·무효·skip 복원, 현재 키 우선/모호한 선택 차단. 12개 실행형 fixture PASS. 운영 DB 쓰기 없음. 배포/실브라우저 최종 미검증.
- 검색어: import-choice-stability PR1229 루스커스 수국 이전선택 건너뛰기 family suffix
- 2026-10-22 전체 자동매칭 후속(codex/import-catalog-recovery): 사용자 즉시 수정/배포 승인.3359품목6175이름 전체 비교, 유일 원문 우선/오연결fallback 차단/원문별 선택·이전키 복원. 현재6159명칭 정확키, 실제중복16명칭(8품목) 명시차단, 오연결0.2025/2026 fixture 및 선택/skip 테스트17개 PASS.전체검사/최종build/배포 진행,운영시험쓰기 없음.검색어: catalog-recovery 6175 6159 16 8 269 61

## 2026-10-22 인보이스 이슈 전용 검토
- 원본행 캡처/DB품목 직접선택/이슈만 이전·다음/경고 원문값 유지 기록. 수량·금액 필수검증 우회 없음, SQL writer 변경 없음.
- 42-1 실제 Computer Use 원본 업로드→2이슈 검토→격리입고→원가다운로드 완료.64행2280단/GW·CW1985/시험비용29,048,581.029768원. Order/Shipment보호snapshot 보존, 운영쓰기0.
- NL42-2 실제125행 무료변환·매칭통과. US/AU/TH/EC/CO원본확보, AI최대6회 승인대기. VN41-1 PDF미확보. 국가별전체·Excel실앱디자인·전체키보드 미검증.
- ERP계약/dnSpy/manifest146/writeguard/build통과, PR/배포진행. docs/work-sessions/2026-10-22_invoice-issue-review.md 참조.
- 검색어: invoice-issue-review KEEP_SOURCE sourceCrop 42-1 2280 1985 NL125

- 2026-10-22 후속: PR1235/master7a30f6ef CI39715921668 성공. NL실제UI 전체공용400매칭으로125행(정확1+수동124) 연결, 다음입고준비까지 통과. 중국용62개 fixture와 비교조건 차이를 확인했고 운영문제로 단정하지 않음. Tab/Shift+Tab/방향키/Enter/Escape·초점복귀 확인. 앞선배포39715500053 SSH기본10분초과로 최종빌드단계 중단, 배포timeout30m만 추가하는 후속PR. DB변경없음. 검색어: deploy-timeout 30m PR1235 NL125 400 62

## 2026-10-22 중복 품목 사용자 확인·수정
- 사용자: 중복4쌍은 사용자가 매칭 확인·수정하도록 승인. Product 삭제/병합/영구 기본값 없음.
- 원문 중복 후보를 preview metadata로 반환, 코드·국가·품종·단위·선택연도차수 파일업체 양수주문 표시. 매칭 후에도 별도 확인영역에서 native select로 수정/skip 가능; 기존 productOverrides와 서명무효화/재검증 재사용.
- 기존 DB writer/자동매칭 판단/환산/견적·매출 영향 계약 보존. 실제 dnSpy CLI 및 읽기전용 중복8키 probe 확인. 교차연도/수동재선택/skip 포함 핵심19검사 PASS. 전체 검사/빌드/배포 진행 중, 완료 여부는 후속 기록 확인.
- 검색어: duplicate-review 중복4쌍 사용자확인 코드854 861 952 3464 1846 2030 2195 2197

## 2026-10-22 잔여 재고 대사
-18품목21오차·38품목292음수 재확인.34·35 자료부족은 실재 부재가 아니라 동일수량 native 중간노드 무조건 제외 문제. 검산 연결과 과거오차 추적 보존, 음수 원인/건수 별도표시 보완.
-화이트BOM608만101스냅샷 계획 중4개350→0/3차 이후불변. 나머지17품목은 새 음수 가드 차단. 실사/오류제거 목적 미확인 이력 임의상쇄 금지. 배포·운영보정 아직 미검증; 세션 후속 기록 확인.
-검색어: stock-residual 18품목 34-02A 34-02B 17-01B 화이트BOM 음수
-사용자 후속확인:1월23일4차 장미 조정은 전산 오류 제거 목적.1335/1344만0기초·단일조정·중간순변동0·후속0복원 엄격 패턴 후보; 전체 후속수량 불변 조건.다른15품목 목적만으로 전액취소하지 않음.운영 적용 여부는 후속 기록 확인.

## 2026-10-22 ECOUNT 과거 월단위 수집기 2단계 — 화면별 위젯 확정, 실행은 사장님 지시로 중단
- 성과: 판매현황 2026-07(3,493행·957,134,762)·08(3,898행·1,057,950,340), 거래처등록 790행, 회계거래현황 8월 455행(55.6억), 거래처별채권 8월 83행(16.17억), 거래처별채무 8월 170행(58.07억) ecount 스키마 적재. 잘못 들어간 배치(다른 화면 내용·빈 1행) 6건 삭제.
- 확정: datepicker 2종 — (A) 판매현황 button[data-id=year|month]+#day 중첩 wrapper 2개, (B) 채권/현황류 .wrapper-datepicker.datepicker-range 안 button[data-role=date.selectbox]×4 + input[data-index=2|5]. 프로그램 제목 = div.wrapper-title span.page-name(좌측 메뉴 텍스트로 판정하면 오진). 메뉴 해시 추정(E01→MENUTREE_000001, E04→000004)+메뉴검색 자동완성 폴백.
- ⚠ 사고: 수집기가 데몬과 같은 ecount-profile 을 쓰며 반복 실행 → 데몬 세션 끊김·로그인 창 반복 노출 → 사장님 중단 지시(다른 세션 local_7350c622 가 pid 53268 종료). **수집기 재실행 금지.** 재개 시 조건: 데몬과 프로필 분리(별도 프로필+1회 로그인) 또는 데몬 사이클 안에 월단위 수집을 편입, 그리고 사장님 승인.
- 미검증: 수금현황·구매현황·지급현황·입출금·카드매입·세금계산서현황 월수집(제목 판정 수정 후 미실행), 품목등록 master(9행 의심→삭제).
- 검색어: ecount 수집기 중단 ecount-profile 공유사고 로그인창반복 datepicker 2종 page-name collect-history 재실행금지

## 2026-10-22 주차별 손익 단위·평가·환율 (DB 불변)
- 과거 EstQuantity의 박스/단/송이 단가 혼용을 보고서 전용 분모에서 수정. E/F 동일 선택기, 원본 기반 과거 환율, 누락 원가의 이익·합계 보류. 화면 자동 캐시 쓰기 제거.
- 2026년 1~41차 운영 SELECT 재계산, 독립 산술15,058 항목 불일치0 및 비교 가능한 E/F 불연속0. 원본 수치와 SQL 매출/재고/통관비 차이는 별개. 12~14차 장미 단가 누락·18차 환율 원본충돌 보류.
- 원본32~41 수치 대조 미검증. 최초 기록 시 최종 테스트/PR/배포 진행 중, docs/work-sessions/2026-10-22_profit-unit-valuation.md 후속 확인.
- 검색어: profit-unit-valuation EstQuantity 단위분모 1~41 환율충돌 기초기말 계산보류 DB불변

## 2026-10-22 26~31차 우선 손익 계산 근거
- 엑셀 공통식/예외를 우선26~31로 검증. 사용자 확인: 엑셀 품목 묶음은 편의상이며 전산은 SQL 품목별 단가/수량 사용, 울리부쉬 색상별 단가 별도 확인.
- 판매단가·근사환율·전국 평균/합계단가 대체 제거. 호주 실제 SQL 품목 매입+당시 정확환율 재구성. DB·확정 revision·재고 수량 수정 없음.
- 원본858+23 계산 일치, 1~41 독립 산술15,058 실패0 및 비교 가능한 E/F 불연속0. 전체 ERP검사/빌드 성공. 전후 관측 DB 지문 동일.
- PR1249, 최초 기록 시 CI/배포/운영 스모크 대기. 중국26/27 E/F·28 E도 같은 품목19-01 실제 매입/정확환율/도착원가로 해소해 26~31 원가/환율 누락0. 태국38~41 및 초기 일부 원가/18차 환율은 확인 필요.32~41 원본 대조 미검증.
- 검색어: profit-excel-rulebook 26~31 SQL품목별 호주CNF 판매단가배제 1~41 DB불변

## 2026-10-22 주광 장미 출고일·재고 판정
- 실제 usp_ShipmentFix는 차수 검산, 주광은 Product.Stock 선차단이라는 불일치 수정. native 증감·cascade·실제 부족 rollback 보존, 임의 재고조정 없음. EXE에서 수정된 운영 날짜/수량 보존.
- 격리 SQL lifecycle·새 날짜 인쇄/옛 날짜 빈 출력, 교차연도·실패 rollback 통과. ERP 계약·dnSpy·manifest·write guard 성공. 최초 기록 시 빌드/배포 최종 미검증; 세션 md 후속 확인.
- 검색어: weekday-stock-date native-week-ledger 플라야블랑카 주광 STOCK_SHORTAGE
## 2026-10-22 태국 매입 원가 이월
- DB 무변경. 태국34차 매입의 FIFO 창 종료 후 누락, 현재 환율 혼입 수정. 최근/과거 이월에 정확 매입차수 환율 공유. legacy 단자리 차수 정규화.
- 운송기준원가 통관 기본값과 손익 H는 별도이며 실제 청구 확인 완료가 아님을 웹 경고에 표시. 실제 청구서 원본 미검증.
- 최초 기록 시 전체검사/1~41 검산 진행, 최종 PR/배포는 docs/work-sessions/2026-10-22_profit-thai-carry.md 후속 확인.
- 검색어: profit-thai-carry 태국34차 38~41 과거매입 exactFX 통관기본값 DB불변

## 2026-10-22 태국 SQL 실제 비용
- DB 쓰기 없음. 34차 입고 운송료 존재, 통관실비·원가스냅샷·수기H 없음. 기본값/트럭추천을실비로사용하지않게 수정.
- SQL 실제H와입고운송료 완전성, 연도/차수/AWB/품목, 단위·합계 보존. 누락은0원/다른차수/샘플평균 대체하지않고 최종이익률보류.
- 최초 기록 시 전체 gate/1~41 재대사 진행중. 최종 PR/배포는 docs/work-sessions/2026-10-22_profit-thai-actual-cost.md 확인. 실제 통관청구액 자체는 미검증.
- 검색어: profit-thai-actual-cost 태국34차 통관실비 actual_cost_missing 320200 168200 DB불변
## 2026-10-22 ECOUNT 과거 전기간(2024-01~2026-10) 수집 완료 — ecount 스키마 적재 결과
- 전용 프로필(scripts/ecount-ledger/_profile, 데몬 프로필 복사로 자동 로그인) 1·2차 실행. 적재: 판매현황 142,917행(35배치) · 구매현황 12,991 · 수금현황 6,667 · 지급현황 2,134 · 거래처별채권 2,492 · 거래처별채무 2,730(~2026-08, 2026-09/10 미수집) · 회계거래현황 10,000(월 상한 의심) · 매출세금계산서현황 1,960 · 매입세금계산서현황 3,009 · 카드매입 3,518(2025-01~) · 입출금 47(과거월 조회가 ECOUNT 입력오류로 거부, 미수집) · 거래처 790 · 품목 3,571.
- cmp_sales_week(차수·거래처): 2026 34~42차 ECOUNT가 우리보다 1~5% 작음(예 40차 5.01억 vs 5.14억). 43차 ECOUNT 0(미입력). 거래처 매칭 ecount_only 4,817·ours_only 833 → 거래처명 매핑 정비가 다음 과제.
- 잔여 실패: 입출금 과거월(22), 채무 2026-09/10(click timeout), 산발 month 설정(12), 구매 엑셀 미시작(2). 회계거래현황 월 10,000행 상한 여부 확인 필요.
- 검색어: ecount 전기간수집완료 142917 cmp_sales_week 거래처매핑 ecount_only4817 입출금과거월거부 채무0910미수집 회계거래10000상한

## 2026-10-23 주차별매출 승인 비용 추정
- 사용자 승인 백상460원/kg·합산중량 차량비·태국 누락 관세5%·선율 패턴을 보고서 전용 적용. 실제0/수기/확정본·ERP DB 보존.
- 미매칭 비용은 별도 배분 풀에 남기며 가짜 품목 생성 없음. 추정 출처를 재고 FIFO/과거 이월까지 표시.
- 전체검사/build·1~41 독립15,058 산술 실패0, 입력/수량변경0·원장 지문 동일. 배포/운영 스모크는 최초 기록 시 미검증. 태국39 GW/40 국제운임 누락은 유지. 계획 docs/plans/profit-approved-cost-2026-10-23.md 참조.
- 검색어: profit-approved-cost 460원 3톤286000 태국5% 승인추정 DB불변

## 2026-10-23 태국 기존 입고 원가 연결
- TH 기존 입고 원가 전용 연결, 인보이스 송이 FOB/ERP 단 원가 구분. 명시 패킹 그룹 박스 배분과 합계 검증. 기존 입고 수정 없음.
- 전체 ERP 계약·dnSpy·manifest·쓰기 가드·build, 격리 MSSQL 저장/재조회/엑셀/ERP 불변 통과. 운영 배포·원가 저장·다운로드는 배포 전 현재 미검증.
- 검색어: thai-existing-cost SuperFresh 6902981 38-01 PACKING_GROUP 기존입고7345
- 후속: PR1257 배포 성공, 운영 기존입고7345 원가 연결 성공. 자동 공식 그룹 입력 초기화 누락 발견→initialForm 보완·입력/복원 테스트 통과. 원가 승인/엑셀은 후속 배포 후 검증 예정.
## 2026-10-23 중국 포함 통관기간 과세환율
- InputDate는 EXE입력일자. 등록국가 승인고시주간을 보고서 전용 적용하고 중국은32차이후 다음ISO주간. 실제통관일 인증과 구분해 추정표식 유지. 원본26~31 양수환율59셀 일치, 중국29차예외 보존.
- 실제저장환율/수기/확정revision 보호. DB쓰기없음.1~41 전후SELECT대조15,058산술 실패0·입력/수량변경0·관측원장지문동일·E/F불연속0.1~27결과불변.
- 최초기록시 최종전체검사/배포 미검증. docs/plans/profit-customs-rate-timing-2026-10-23.md 후속결과확인. 태국39/40 기존근거부족보류 유지.
- 검색어: profit-customs-rate-timing 중국환율 59셀 InputDate입력일자 다음고시주간 DB불변

## 2026-10-23 주광 박스 낱개 입력
- 클릭/F2 박스+단/송이, 방향키 기존 박스 입력. dnSpy N2 표시와 float 저장 구분, 마스터 환산 및 낱개 합계 보존. 운영 ERP 쓰기 없음.
- 격리SQL 복수날짜 낱개 합산/인쇄와 Chrome 컴포넌트 입력/방향키/ESC 확인. 전체 gate/배포 최초기록시 진행중, 세션문서 확인.
- 검색어: weekday-box-parts 카네이션 수국 박스 낱개 N2

### 2026-10-23 주광 박스 소수 첫째 자리 표시
- 사용자 확인: 실제 박스 소수값 한 자리 (1박스+3단/15단포장=1.2). 박스·낱개 입력창 표시만 변경, 저장 정밀도 보존. PR1256 본 기능 병합 후 추가 요청.
- 검증/배포 진행 중. 검색어: weekday-box-one-decimal 소수첫째자리 박스낱개 1.2

## 2026-10-23 호주·미국 인보이스 분리 배포
- 사용자 요청으로 AU/US만 최신 master에 분리. TH는 다른 세션, CO/EC 미배포 작업 제외. 운영 DB 무변경.
- Woolly bush 파일별 분류·PDF 대조·합계 검증·공용매칭 금지. US 국가별 ProdKey 선택 및 EXE 동일명 다운로드 안전차단.
- 격리 SQL AU56박스/15500송이, US70박스/43750송이 입고→원가→다운로드 통과. TEST_ONLY 두 시트 표시 회귀 통과.
- 전체 ERP/dnSpy/manifest/write guard 통과. 최종 모달 portal/너비 수정 후 빌드·브라우저 및 PR/배포 대기. 후속 결과 docs/work-sessions/2026-10-23_au-us-release.md.
- 검색어: au-us-release Woolly bush TEST_ONLY ProdKey 파일별분류 운영DB불변

## 2026-10-23 네덜란드 인라인 작업 진행 중
- 별도 nw-dutch-inline-workflow, codex/dutch-inline-workflow. 업체 열 축소/전체 zoom 제거/반복 단가 문구 제거 초안.
- 실제 dnSpy ClassProduct Descr 공유 확인. 색상 별도 웹 저장 또는 공유 비고 수정 선택 대기. 추가 팝업/등록분배/인쇄/재업로드 미구현.
- 전체 ERP 검사/빌드/브라우저 미검증, PR/배포 없음. 운영 원장 무변경.
- 검색어: dutch-inline-workflow 칼라 Descr 업체36px 원본팝업 미배포

## 2026-10-23 네덜란드 레이아웃·칼라 배포 검사
- 사용자 Product.Descr 저장 확정. CAS·기존 설명 보존·전체 품목 readback·감사 원자 저장 구현. 원장 운영 시험 쓰기 없음.
- ERP 전체/컬러/UI/dnSpy/manifest/write guard/build 통과. 실제 컴포넌트 브라우저 열36px/전체 늘어남 없음 확인.
- 이번 배포 범위는 레이아웃·칼라. 업체추가 팝업/인쇄/재업로드는 미완으로 명시. PR/운영 스모크는 다음 기록 참조.
- 검색어: product-color Descr 칼라 CAS compact-layout
## 2026-10-23 주광 인쇄 적요·박스 선택
- 수량 적용→재조회→윌슨/Excel/인쇄 격리 SQL 검증: 카네이션1단/18단, 수국1송이/33송이 통과. 합계/잔량 정밀도9자리.
- 출력마다 박스 표시 선택, 비고 대차수만, 품목 적요 web runtime 저장(CAS) 및 실패 인쇄차단. 운영 ERP 원장 보존.
- Chrome 격리 컴포넌트 입력/저장/재열기/실패/Tab 확인. 운영 배포 후 스모크는 후속 기록. 실제 종이 출력 미검증.
- 메뉴 기준 적용: shell/키보드/오류보존; 신규메뉴 해당없음; 명시적 인쇄모달 스크롤 예외.
검색어: weekday-print-edit 박스 송이 단 적요 저장 인쇄 XLSX

## 2026-10-23 인보이스 도착원가 본표 자동 연결
- 현재 승인 ACTUAL을 기존 본표 검색/품종/페이징/누락판정에 연결. 기존 엑셀 같은 업무키는 상세 비교로 보존, ERP/원가 쓰기 없음.
- 태국2026/38-01 입고7345 자동19행/비교19행 실제 읽기 검증. 교차연도·stale·단위·과거문서 후보 회귀 통과.
- ERP 계약/dnSpy/manifest/write guard 통과. 빌드/배포/운영 브라우저는 후속 기록 전 미검증. 세션: docs/work-sessions/2026-10-23_invoice-arrival-unified.md.
- 메뉴 기본값: 기존 shell/키보드 상세 펼치기/출처·오류 안내 적용. 인보이스는 기존 단순 환율식 차단, 수입부 재승인 안내.
검색어: invoice-arrival-unified 자동 원가 본표 엑셀 비교 7345 38-01

## 2026-10-23 주광 최초 진입 명시 조회
- 메뉴 진입은 연도/차수/조회 폼만, 조회/Enter 후 Workspace 동적 로드. 명시 선택은 defaultNext 요청으로 덮어쓰지 않음.
- 최초 렌더 mount/fetch 0회 및 교차연도/무효입력 테스트, Chrome 입력만으로 조회하지 않음/Enter로2026-43 전달 확인. ERP 원장 변경 없음.
- 기준선 shell/키보드/스크롤 적용; 신규메뉴/ERP쓰기 변경 해당없음; 예외없음. 배포 후 검증은 PR 참조.
검색어: weekday-explicit-query 조회버튼 최초진입 동적로딩

## 2026-10-23 주광 인쇄 양식 보완
- 차수 표시 문서별 web CAS 저장, 고객Tel SELECT, native 반복 페이지여백/행분할방지/머리글 반복. 원장 불변.
- Chrome 85행 미리보기 차수편집/Tab/재열기 확인. 실제 종이·인쇄페이지 분할 미검증, 직인원본 확인 대기. 게이트/배포 PR참조.
- 이전 PR1263 조회버튼 배포 및 운영 Chrome 검증 완료.
검색어: weekday-print-native 차수표시 TEL FAX 페이지나눔 직인

## 2026-10-23 국가별 평균 도착원가 근거 표시
- 엑셀26~31 국가별 검토: 콜롬비아5품종·베트남 평균식, 호주 품목별 외화원가, 기타 직접입력/미확인 구분. 모든 국가 평균으로 임의 확대하지 않음.
- 기존 실제 E/F 평가에 평균단가·총원가·매입수량·환산수량·평가기준차수 표시. 단위혼합/무매입/승인추정/확정본 근거미보관을 구별. DB/수치계산 변경 없음.
- SQL26~31/41차116행 전후 수치/입력/재고 차이0,232근거 중 평균66건 산술확인,관측원장 지문동일. Chrome desktop/mobile 렌더·키보드 통과.
- 전체게이트/배포/운영브라우저는 후속 기록 전 미검증. 상세: docs/work-sessions/2026-10-23_profit-average-landed.md.
검색어: 평균 도착원가 국가별 재고평가 콜롬비아 베트남 FIFO 단위혼합

## 2026-10-23 주광 직인
- 사용자 PNG를 공개 저장소 제외/배포 secret 보관, 인증된 출력 응답에 포함. 회사정보 우측 21mm 직인. 원장 변경 없음.
- Chrome 85행 미리보기 직인 및 표 선 겹침 확인. 실제 종이 출력 미검증. 필수 검사/배포 PR 참조.
- 기준선 적용: shell/키보드/스크롤 유지. 신규 메뉴/원장 쓰기 해당없음, 예외없음.
검색어: weekday-stamp 네노바직인 인증출력 회사정보

## 2026-10-23 네덜란드 명시 조회·칼라 dialog
- 초기/연도 effect는 차수 목록과 기본값만 준비, 물량은 버튼으로만 조회. 기존 업로드/저장본/분배 경로 보존.
- 칼라 prompt/confirm을 페이지 dialog로 교체. 전체 비고 전후 표시, 취소/Escape 무쓰기, 저장 중복 방지, 실패 입력 유지, 초점 복귀.
- 실제 dnSpy ClassProduct/FormQuantityPivot 확인, SELECT-only 품목 schema/trigger probe 재실행. SQL/API writer 변경 없음.
- 관련 실행 검사/빌드 통과. 전체 gate·PR·배포 결과는 세션 기록 후속 참조. 운영 저장 시험 없음.
- 검색어: dutch-explicit-load prompt not supported 칼라 dialog 명시조회

## 2026-10-23 네덜란드 원본 표 업체 추가
- 업체 popup 선택 → 현재 시트 지역별 수량 열 표시. 원본 workbook 불변 projection, 추가 entries/지역 저장 복원, 기존 명시 검토·분배 계약 유지.
- 표 전폭과 반복 품목명 두 줄 제한. 전체 검사/배포/실화면 확인은 docs/work-sessions/2026-10-23_dutch-inline-add.md 참조. 운영 시험 분배 없음.
- 검색어: dutch-inline-add 업체추가 지역배치 반복품목명 전폭
## 2026-10-23 차수 버튼·견적 행 간격
- 첫 조회 차수 ▲▼56x44px, 웹 견적 한 줄4.8mm/여러 줄 자동확장, 빈 적요 입력도1줄. 수량·금액·원장·EXE 무변경.
- Chrome 경계/키보드/자동행높이·적요저장 확인. 실제 종이 출력 미검증. 게이트/배포 PR참조.
- 기준선 shell/키보드/스크롤 적용; 원장쓰기 해당없음. native 행높이 변경은 사용자 요청 예외.
검색어: weekday-week-buttons compact-item-row 차수버튼 행여백
## 2026-10-23 콜롬비아 수국 42-1 원가 확장
- 별도 CO_GROUP_42_1_V1 / CO_42_1_ORIGINAL_V1. 기존 승인 원가와 태국 정책 보존.
- 격리 SQL에서 실제 송장 2914의 6품목 48박스/1440송이 입고→TEST_ONLY 원가→XLSX 통과. 운영 DB 수정 없음.
- 1350/1400 독립 산식·원본 서식 검사 통과. 브라우저/배포 결과는 세션 기록에서 후속 확인. 전체 PDF 7송장 전수 미검증.
- 기록: docs/work-sessions/2026-10-23_colombia-hydrangea-42-1.md
- 검색어: CO_GROUP_42_1_V1 HYDRANGEA 콜롬비아 수국 42-1

## 2026-10-23 SQL 수량 기준 4국가 평균 도착원가
- 소액 수기 차이 허용/평균 틀 승인에 따라 NL·TH·CN·EC 매입·재고 단위를 정규화. 같은 StockKey, 동일 상품 범위, 비용누락·환산충돌 fallback, 수동0·음수 보존.
- NL China Pink/China white/Domenichina4품목 국가 오인 수정, CO/아나나스 CHINA placeholder 보존. DB 쓰기 없음.
- SQL1~41 paired43,406 SELECT,16,257 산술/연속성/범위 검사 실패0, 관측원천 지문 동일. NL1959·EC3227 충돌은 기존 품목원가 유지.
- 회귀16개+실제API통합/분류 parity 통과. 전체 gate/build·PR/배포/브라우저 최종상태는 docs/work-sessions/2026-10-23_profit-country-average.md 참조. EXE GUI·종이인쇄 미검증.
- 검색어: profit-country-average 평균도착원가 China Pink Domenichina 태국루스블룸 샘플150 튤립1959

## 2026-10-23 최신 승인 도착원가·호텔 환율 비교
- 호텔 원가 참고 표시를 인보이스 APPROVED ACTUAL 및 기존 엑셀 이력에 연결. 선택 연도 최신 세부차수 기본, 이전/다음 조회.
- 사용자 확정: 환율은 도착원가 표시만 비교. 매입액·이익·확정 원가·운영 DB 보존.
- 실제 읽기514이력/43인보이스, 격리 CUA 환율/차수/오류 검사 통과. 계약 게이트 통과; 배포/운영 화면 결과는 세션 문서 후속 참조.
- 검색어: landed-fx-history ArrivalFxControls loadHotelArrivalHistory 도착원가 환율 비교

## 2026-10-23 자동 중국 물량표 편집·등록분배
- 명시 조회, DB 품목/업체 추가·교체, 지역/요일/업체, 수량 직접입력, 인보이스 품목 분할, 초과/부족 목록.
- 등록분배는 명시 셀 SET. 기존 주문 전체 행 보존 검사, 없는 양수 주문만 신규. 단회계획/동시수정/확정/날짜/농장 가드·원자 rollback 유지.
- 격리 중국/네덜란드 SQL·전체 ERP·dnSpy·manifest·write guard·빌드 통과. Chrome 합성 입력 검증. 운영 시험 분배 없음. PR/배포/운영 화면은 세션 기록 후속 참조.
- 검색어: china-volume-edit 중국물량표 품목수량분할 기존주문보존 등록분배 지역 업체추가
# 2026-10-23 중국 물량표 배포 후 확정 사유 보완
- PR #1273/b62f8b5c Cafe24 배포 성공. 운영 조회·품목/업체 DB 검색·지역 창·주문200→200 미리보기 확인, 실제 저장 없이 취소.
- 확정 출고 사유가 요약 DB키 부재로 누락되어 keyed rows에서 추출하도록 보완. 원장 쓰기 로직 변경 없음. 실제 SQL 및 단위 회귀에 확정 사유 검증 추가.
- 검색어: china-volume-fixed-message 중국물량표 확정출고 사유누락 주문보존

## 2026-10-23 최신 도착원가 참고 통합
- 카탈로그·물량/전산피벗 공용 최신 조회, 입고/운송원가/재고평가 상세 최신 참고 별도 표시. 과거 계산·확정 원장 writer 변경 없음.
- dnSpy/SELECT-only/153품목·122최신인보이스/격리CUA/전체게이트·빌드 통과. PR·배포·운영 UI는 세션기록 후속 참조(현재 미검증).
- 검색어: arrival-display-unify loadLatestArrivalReferences 최신 승인 도착원가 참고

## 2026-10-23 네덜란드 Excel 추가 업체 왕복
- 화면 전용 추가 업체가 다운로드에서 누락되던 경로 수정. 지역별 실제 열·최종 수량·합계·단가 좌표와 ERP적용초안 V1 매칭/단위/차수 연결.
- 2회 XLSX 왕복 및 실제 격리 SQL preview/apply 동일 최종값 확인. 기존 주문·교차연도·Estimate/Stock/Warehouse 보존, 확정/동시수정/rollback 유지.
- dnSpy 실제 재실행, SELECT-only 운영 기준선 확인. 운영 시험 분배 없음.
- 전체 ERP 계약/pivot/dnSpy/manifest/write guard/layout/build 통과. 배포·운영 브라우저 검증은 세션 문서 후속 참조.
- 검색어: dutch-xlsx-roundtrip ERP적용초안 추가업체 재업로드 동일분배
## 2026-10-23 중국 물량표 dnSpy·등록분배 MD 재감사
- 사용자 확인: 기존 주문100은 보존하고 분배80, 새 업체/품목은 주문·분배 동시 등록.
- actual dnSpy FormOrderAdd/FormShipmentDistribution 및 운영 SELECT 재확인. 오래된 FormOrderAdd.md 양수 주문 덮어쓰기 설명 정정.
- 격리 SQL에서 신규 주문 Est8(기대80) 반례 재현 후 중국 전용 native 환산·readback 보완. 삭제 출고헤더의 중복생성도 공통 snapshot 단계에서 차단.
- exact100/80, 신규업체8단/80송이, 기존 주문 전열 보존, 반복/감소/0, 교차연도, 환산변조 rollback, 삭제헤더/경합 테스트 통과. 운영 쓰기 없음. 배포 후 결과는 세션 기록 참조.
- 검색어: china-order-guard-review 주문100 분배80 EstQuantity chinaOrderUnits 삭제출고헤더 dnSpy

## 2026-10-23 네덜란드 물량표 업체·지역·입고 품목
- CL 별도 행, 지역별 전체 업체 열 이동, 업체/품목 추가 팝업 분리, 주문 없는 입고표 표시.
- 실제 dnSpy·SELECT-only와 격리 SQL, 왕복/교차연도 fixture 확인. 원장 저장 경로 불변.
- PR·배포·운영 스모크는 docs/work-sessions/2026-10-23_dutch-arrival-layout.md 후속 기록 참조. 현재 미검증.
- 검색어: dutch-arrival-layout CL분리 지역이동 입고전용 품목추가

## 2026-10-23 중국 물량표 지역·요일·엑셀
- 지역/요일 native 선택, 미저장 변경 초기화, 확정/매칭 상태 무관 다운로드 및 동일 데이터 미리보기. 업체명/CL 별도 헤더 셀. ERP writer 변경 없음.
- 교차연도 엑셀/작업본 테스트. 전체 검증·배포·운영 UI 결과는 세션 문서 후속 참조.
- 검색어: china-board-options 지역선택 요일변경 변경초기화 엑셀미리보기 CL셀분리

## 2026-10-23 주광 수량 소수 한 자리
- 일반/윌슨 입력 및 숫자 상세를 소수 한 자리로 표시. 초안/환산/API 원본 정밀도 보존, 일반 박스+낱개 창에 반올림값 전달 방지.
- 실행형 컴포넌트/Chrome 격리 검증: 1.066666667→1.1, 대화상자1박스+1단, Tab/ESC 무저장, 명시 초안 값1.066666667 유지.
- 빌드/dnSpy근거/manifest/write guard/layout 통과. 전체 ERP 및 배포는 세션 문서 후속 참조, 운영 시험 저장 없음.
- 검색어: weekday-quantity-display 소수첫째자리 일반윌슨 원본정밀도 blur무저장


## 2026-10-23 중국 품목·업체 즉시 검색
- 닫힌 select 필터 대신 입력 아래 후보 목록. 이름/코드/복수어 검색 및 키보드·IME 보호. ERP writer 변경 없음.
- 검색어: china-search-suggestions ChinaSearchSelect 자동완성 연관품목 업체추가
## 2026-10-23 승인 원가 격리 통합 검증·정수 표시
- 실제 CO43-2 송장2914 캐시6품목으로 격리 SQL 입고/원가승인/재승인/엑셀 통과. 운영 DB 미접속.
- hotel/catalog/pivot/incoming 실제 조회 함수의 최신43-2·단위 환산 일치. 과거원가 및 주문·출고·재고·입고 원장 snapshot 보존.
- 실제 Next 페이지 라움/초이문/카탈로그/기존웹피벗/입고에서 조회 확인. 비원가 UI 데이터는 fixture, 전산피벗 전체 UI와 원본업로드부터 무가공 단일E2E는 미검증.
- 사용자 후속 요청에 원가 표시만 원 단위 반올림; DB/API/엑셀 계산 정밀도 유지. 후속 코드 미배포.
- 검색어: arrival-approval-e2e 송장2914 소수점 정수표시 원단위반올림 최신승인원가

## 2026-10-23 SQL 비용 연결·활성 입고 환산 복구
- DB SELECT만.40차태국 EXCEL운임640.75 USD,4차수국 같은세부차수 InvoiceNo→실제AWB운임7938.7 USD 복구.758비용행 합계/행수 보존.
- NL29/31 zero-anchor후 실제입고환산,EC33~35 미소진150+250송이 합산. NL09 모순/18부분FX/35NL운임없음/39TH무명중량은 임의보완 금지.
- 최종1~41 paired44,386 SELECT/9094검사 실패0·E/F불연속0·원장/비용/수기/확정/스냅샷SHA동일. 변경55셀은 복구항목과다음기초에만 존재. 첫지문변동실행은 최종근거에서제외.
- 관련회귀·전체gate/build 통과 후 최신master통합 재검증/배포 진행. 최종PR/운영브라우저는 세션문서 후속기록 참조. EXE GUI·실제인쇄 미검증.
- 검색어: profit-source-recovery EXCEL640.75 수국7938.7 zero-anchor EC400송이 partialFX DB불변

## 2026-10-23 입고 박스·중량 현황
- 기존 독립 메뉴를 차수/월/연도 및 국가/품종 조회로 확장. 박스는 저장값, GW/CW는 입고키별 한 번만; 혼합 중량 별도.
- 실제 CO/AU/US 캐시 인보이스 격리 입고→현황48/56/70박스, 27조합/교차연도/NULL/삭제/혼합 readback 통과. 운영 DB 무접속·원장/SP 변경 없음.
- 실제 페이지 CUA 필터 검증, 전체gate/build 통과. 1920화면 미검증; 최종 PR/배포는 세션 기록 후속 참조.
- 검색어: receipt-box-weight-summary 입고박스 중량 월별 연도별 혼합입고 WarehouseKey

## 2026-10-26 신라·라움 환율 적용
- 통화 매핑 누락·VAT별도/송의 셀 제목·초기 배열형 원본 누락을 웹 참고 조회에서 복구. 원본/ERP/매입단가 쓰기 없음.
- 실제 dnSpy/SELECT-only4873참조, 비교 가능309개 복구. 원본환율/단위 부족36개 명시 보류.
- 교차연도/원본복원/잘못된환율/중복제목/배열단위 회귀 및 CUA 입력·Enter 확인. 최종gate/PR/배포 결과는 세션 문서 후속 기록 참조, 현재 미검증.
- 검색어: hotel-arrival-exchange 신라 라움 환율 도착원가 RawJson 배열 VAT별도 COUNTRY_CURRENCY_MAP

## 2026-10-26 물량표 가이드·즉시 합계
- 네덜란드 단계 안내/끄기 저장, 양국 수정 고객합계 기준 주문·잔량 화면/XLSX 동기화. ERP writer 변경 없음.
- 전체 ERP gates/build/pivot/격리 SQL 및 CUA 양국 5→8, 입고20/잔량12 확인. 운영 시험 쓰기 미실행; 배포 결과 세션 기록 참조.
- 검색어: volume-guide-totals 네덜란드 중국 가이드 주문 입고 잔량 수식캐시

## 2026-10-26 인보이스 입고 scope 문자열 오류
- 빈 연도·차수를 null로 보내던 payload 수정, 명시 orderWeekDate 차수 보존, 저장 전 한국어 안내. 매칭값·ERP writer·재고/원가 불변.
- focused 51건 통과. 전체 gate/build/배포는 세션 문서 후속 결과 확인. 실제 실패 파일 개별 원인은 미확정이며 운영 입고 시험 미실행.
- 검색어: invoice-scope-type orderYear orderWeek must be strings receiptScopeIssue 입고 연도

## 2026-10-26 인보이스 연도 자동 입력·검증 실패
- 최신 지시로 인보이스 날짜 연도 자동 제안 허용. 명시 선택 우선, 충돌 확인, 현재연도 fallback 없음. 이전 수동 정책 대체.
- 2026/44-01 CO 문서966a9e13의 generic503 원인은 기존 음수 주문을 대조 함수가 거부한 것. 순합산 보존 수정 후 SELECT-only 실제 preview151행 정상, 입고일/농장 누락만 안내. 운영 DB 변경 없음.
- focused73 통과, CUA 격리 UI 확인. 전체검사/배포 후속은 세션 MD 참조. 실제 운영 입고 쓰기는 미검증/미실행.
- 검색어: invoice-auto-year-preview invoiceDateYear signed orders 44-01 INPUT_DATE_REQUIRED FARM_REQUIRED

## 2026-10-26 인보이스 초안 재개·다음 단계
- 고정 문서ID source 재준비가 revision을 지우고 재업로드가 GET 없이 POST하여 중복409 발생. 기존 저장 문서 자동GET/검증 재개, source 변경 3-way 병합, null revision 보존,409 한국어 복구 안내.
- 집중56/ERP gates/build/격리 SQL 통과. CUA 실제 Workbench rev3 next→refresh→수정PATCH rev4→next→입고 확인 모달 검증. 운영 DB 수정 없음. 운영 인증 후 버튼 조작 미검증.
- 상세·배포 결과: docs/work-sessions/2026-10-26_invoice-draft-next.md.
- 검색어: invoice-draft-next source-resume POST can only create revision PATCH

## 2026-10-26 피벗 필터 동기화·초기화
- 기존 화면 헤더/필터 영역 선택 동기화, 국가/품종 하위 조건 해제, 마지막 체크 0행 수정. 양쪽 상단 전체 초기화 및 전산 피벗 관련 품목 선택 초기화.
- 실제 dnSpy FormQuantityPivot 및 SELECT-only43-02 대조. API/SQL/ERP 원장 변경 없음.
- 전체검사·브라우저·배포 결과: docs/work-sessions/2026-10-26_pivot-filter-sync.md (진행 중 단계는 미검증).
- 검색어: pivot-filter-sync 국가 품종 필터 고정 초기화 fieldFilters __EMPTY__ linkedFilters
## 2026-10-26 인보이스 자동 입력·연속 실행
- 최초 자동 분석, 정상 매칭 후 자동 준비, 원문 날짜·유일농장·AWB AIR 제안, 선택 문서 입고/원가 연속 실행. 동일 송장 농장 약칭 중복 차단.
- 44-1 송장25529 7행107박스3210송이 격리 SQL/CUA 입고→시험원가 저장→엑셀 다운로드 확인. 운영 DB 수정 없음.
- 전체12페이지 AI 검증 아님. 나머지 페이지/실제 비용 미검증. 전체gate/배포는 docs/work-sessions/2026-10-26_invoice-auto-flow.md 후속 확인.
- 검색어: invoice-auto-flow 44-01 25529 Balverde 23OCT2026 AIR onebutton TEST_ONLY

## 2026-10-26 중국 단계 안내·양쪽 작업 초기화
- 중국 상태별 말풍선/버튼 강조/끄기 저장. 중국·네덜란드 미저장 변경만 마지막 작업 저장본으로 복구. 저장 이력/ERP/품목 비고 보존.
- ERP gates/build/실제 함수 실행 통과. 격리 화면 저장·수량·가이드 유지 확인. 네이티브 확인창 이후 시각적 복구는 브라우저 제어 오류로 미검증.
- PR·배포 후속 결과: docs/work-sessions/2026-10-26_china-guide-reset.md.
- 검색어: china-guide-reset 작업 초기화 마지막 저장본 BoardKey guideSavedStamp

## 2026-10-26 GW 자동입력·CW 직접 입력
- evidence-only 중량을 미리보기/결과/입고에 동일 적용. 같은 원본의 빈 미등록 초안만 복원. 수기/0/기등록 보존, GW/NET→CW 추정 금지.
- 격리 Chrome44-1 대표7행107박스3210송이 GW759.7/CW시험800 입고→원가 승인·재조회→다운로드 확인. 운영 입고/원가 변경 없음.
- 전체12페이지 AI 미검증. 최종 캡처는 브라우저 도구 오류. 배포 결과는 docs/work-sessions/2026-10-26_invoice-weight.md 참조.
- 검색어: GW CW review_evidence packingWeight weightManual 44-01 25529 TEST_ONLY

## 2026-10-26 물량표 메뉴 단일차수·입고 기본
- 사용자 확정: 실제 입고 최신차수 우선. 미래 주문50-01 대신 현재 양수입고44-01 기본, 한차수 선택 및 앞뒤5개 버튼. 범위모드는 명시 체크로 유지.
- 연도별 조회·다운로드 범위 일치, 조건변경시 품종목록 폐기. ERP 쓰기 없음. dnSpy/SELECT 근거·기준표: docs/plans/volume-menu-week-2026-10-26.md.
- 빌드/전체 ERP 계약/국소·피벗/manifest/write/dnSpy/UI layout 통과. 격리 실브라우저 단일·범위·방향키·직접입력·교차연도·빈기록 확인. 배포 결과는 세션 md 후속 기록.
- 검색어: volume-menu-week 50-01 44-01 최신입고 단일차수 앞뒤5개 volumeMenuQuickWeeks

## 2026-10-26 주광 차수/자동 갱신
- DOM step 대신 React 값 기반 차수 증감. 기준 미리보기 INVALID_ERP_DATES는 확정 불가로 남기되 분배 갱신은 허용. 과거 선출고 GET2000..2200,POST2026+불변.
- dnSpy ClassShipmentDate/운영 SELECT 근거: docs/plans/weekday-refresh-2026-10-26.md. DB 변경 없음. 배포 검증 진행 중.
- 검색어: 주광 44 43 1 자동갱신 EstQuantity NULL INVALID_ERP_DATES 2025 52
- 검증추가: 전체 ERP계약/dnSpy/manifest/writeguard/UIlayout/build통과,대상29건. 격리 Chrome44→43 및 키보드/조회값43 유지 확인. PR/배포 진행.

## 2026-10-26 도착원가 원본 기본값 복원
- CO42-1 원본 고정 문구/기본 통관비/계수/수식을 별도 원본 양식 계산 탭에 복원. 승인 스냅샷 보존, 기본값 미승인·차액 명시. 현재 데이터만 대입.
- 44-1 수국 12송장/39행/619박스/18,710송이 격리 replay 다운로드, 25529 파일 재계산/수량·환율 변경/시각검증 통과. 운영 DB 접근·수정 없음.
- 콜카장36페이지 신규 AI/다른 국가 원본 기본값 복원 미검증. 상세/배포: docs/work-sessions/2026-10-26_cost-template-content.md.
- 검색어: cost-template-content 기본셀 기본값 사라짐 CO_GROUP_42_1 원본 양식 계산 25529

## 2026-10-26 주광 첫진입 차수 빈값
- Native웹앱첫화면빈값(예시43)→▼1재현.기존직접입력후검증에서누락.기본전산차수44를달력GET1회로실제입력,빈값버튼차단,수동값우선.분배표는조회버튼후만로드.
- 검색어: weekday entry defaultNext placeholder 빈칸44 43 Nenova Desktop
- 검증추가:entry/default9건,전체ERP계약,dnSpy근거,manifest,쓰기guard,UIlayout,production build통과.배포후Native웹앱첫진입재검증예정.

## 2026-10-26 주광 첫 차수 배포 복구
- PR1302 병합 후 Cafe24 40289366107의 두 시도에서 webpack이 Killed로 끝나 이전 버전이 유지됨. 커널 OOM 로그는 접근하지 못했으므로 메모리 부족 확정은 아님.
- 빌드 명령에만 NODE_OPTIONS 1536MiB 힙 제한을 적용. 기존 서비스/ERP DB/원자적 교체/실패 시 보존은 유지. 서버 자원 현황 free -m 기록 추가.
- 제한 빌드와 배포 검증 진행 중. 검색어: 1302 40289366107 Killed build heap 1536 첫 차수
검증: 1536MiB 제한 production build, 배포 검사15건, 전체ERP계약, dnSpy, manifest, write guard 통과.

## 2026-10-26 GitHub 빌드 / Cafe24 산출물 배포
- 사용자 승인으로 컴파일을 GitHub Linux Node20로 이동. DB_SERVER 비움, 빌드 후 무DB 로그인 기동 확인. Cafe24에는 .next-build와 생성 이력 두 파일만 전달.
- tar SHA256, 커밋/lock/BUILD_ID 검증과 최신 master 일치 확인 뒤 기존 DB gate/pm2 교체. 직원 학습값·업로드·.env 미포함. 원장/SQL/EXE 변경 없음.
- 로컬 webpack/로그인 기동/산출물 양성·불일치6개 fixture 통과. 전체 계약 및 Linux PR build/운영 배포 결과는 세션 MD 후속 기록.
- 검색어: ci-build-deploy ci-build-manifest GitHub 빌드 OOM Cafe24 체크섬

## 2026-10-27 수입부 입고·도착원가 작업 분리
- 파일·매칭/입고/원가 화면 분리, 입력 유지, 상세 단계·이력 접기. 입고 버튼은 원가 자동 승인하지 않음.
- 원가 전용 workflow는 기존 입고 대조·웹 연결·재조회만 사용하고 실패 시 신규 입고로 전환하지 않음. 전산-only NL/CN/TH 범위 유지, 이미 웹 등록 문서는 모든 지원 국가 재조회.
- 운영 DB/SQL/EXE 변경 없음. 55회귀 통과, 원가69통과9선택skip, 전체계약·manifest·write guard·dnSpy·webpack 통과. Chrome 격리 fixture에서 기존입고 연결1회/입고commit0/원가승인0 및 환율 입력 유지 확인.
- 최종 UI build·PR·배포 진행 중. 운영 직접 SQL/실제 원가 다운로드는 이번 세션 미검증. 세션: docs/work-sessions/2026-10-27_import-workspace.md.
- 검색어: import-workspace cost-only 입고원가분리 기존입고 건너뛰기

## 2026-10-27 추가: 연도·세부차수 기본값 / 입고내역 원가 진입
- 현재 연도(2026) 및 공용 getCurrentWeek 기본값. 연도 직접 수정·좌우 이동, 공용 stepWeek 세부차수 이동. 조회 버튼과 입고내역 원가 버튼 분리.
- 신규 GET warehouse-list는 OrderYear+OrderWeek 필수 SELECT-only. 기존 승인 원가 다운로드 경로 재사용. 생성은 연결된 문서 연도/차수/입고번호 검증 후 열기. 연결 없는 과거 전산 입고는 원본 연결 안내, 임의 입고/원가 생성 금지.
- 기본 작업 분리 PR1306 병합851077eb, 배포40426114758 진행 중. 추가 작업 회귀26통과, 전체계약·build 진행 중. 운영 DB 수정 없음.
- 검색어: invoiceWarehouseBrowse warehouse-list 저장연도 기본차수 입고내역 원가다운로드

## 2026-10-27 기존 전산 입고로 원가 계산·다운로드
- 인보이스 재연결 없이 WarehouseMaster/Detail/Product SELECT-only → 검증된 국가 공식 계산 → 미승인 XLSX 다운로드 경로 추가. 원장/재고/웹 승인 원가 쓰기 없음.
- 연도·차수·입고번호 및 조회 지문을 재검증, 다운로드 생성 후 재조회. 기존 승인 원가 export의 승인/commit 검증은 보존.
- 통화·운송 미저장 값은 확인 입력, GW/CW 단일 명확 중량행 보완(충돌은 미기재), 관세/기타비 일괄입력. 연도·차수 및 조회 버튼 압축 배치, 잘못된 ‘미입력’ 빈 화면 제거.
- dnSpy 실제 실행 및 2026/43-01 입고7771 SELECT 대조:64품목+3비상품행. TEST_ONLY 원가 XLSX 생성, 전후 지문 동일. 10공식 계산/출력 회귀 통과. Chrome 격리 UI에서 비용 누락 안내→입력→다운로드1회, 쓰기 요청0 확인.
- 최종 webpack 빌드/전체계약/manifest/쓰기guard/dnSpy 통과. Chrome 최종 UI 다운로드 금액144,000 및 품목2,600/4,600원 XLSX 일치, 저장요청0. PR1309 CI·배포 진행 중, 운영 화면 최종 검증 미검증. 상세 docs/work-sessions/2026-10-27_native-cost.md.
- 검색어: nativeReceiptCost nativeCostHttp 기존입고 인보이스없이 원가계산 미승인계산본

## 2026-10-27 입고관리 조회 기본기간·태국 EXCEL 중량
- 조회 기본값만7일→KST 달력3개월~오늘. URL/수동값 및 uploadMeta 기존 입력일 기본값 보존. DB·입고·원가 계산 변경 없음.
- SELECT:39-01 EXCEL7474 상세42868/42869 SteamQuantity209/270.5는 남아 있지만 ProdKey=NULL.40-01 EXCEL7581은Gross weight225/Chargeable weight345.5 정상 연결.39차운임270.5×1.65=446.325, 원문라벨 확정은 아님.
- 실제dnSpy/웹 기본 INNER JOIN Product가39차NULL두행을 제외한다. 운영 Chrome65635f23에서39차 EXCEL1/1112건·GW/CW–·운송료2행 확인. UploadDtm07/27~10/27 SQL1112건, 두전표 포함.
- 전체 verify:erp-change/webpack·dnSpy·manifest·쓰기guard·UI layout57 통과. PR·배포 및 변경 후 운영스모크 진행 중/미검증. 결과는 docs/work-sessions/2026-10-27_incoming-date-default.md에 후속 기록.
- 검색어: incoming-date-default KST 달력3개월 UploadDtm 7474 7581 EXCEL 209 270.5 ProdKey NULL 1112

## 2026-10-27 호주 Woolly 분류 수입부 권한
- canManageInvoiceReceipt가 DeptName 공란의 Authority4(수입부)를 거절. 기존 역할4/7 허용, 비활성/타부서 거절 유지. 계정/운영 원장 수정 없음.
- 44-01 호주41002 제품11행 replay: 일반9행 공용매칭 재사용, Woolly2행 문서별 분류·65박스/AUD20443.75 보존. 유사명 전체 자동확정이나 색상 자동추정은 하지 않음.
- 관련22테스트 통과, 전체검증/PR/배포 결과 세션 MD 후속 기록. 운영 직원 실제 저장 미검증.
- 검색어: au44-import-access Woolly bush Authority4 Authority7 DeptName 수입부 관리자오류 41002

## 2026-10-27 호주 품목검색·분류적용·CNF 안내
- 영문 ProdName 대신 한글 DisplayName만 datalist에 노출되어 Woolly검색 실패. 한/영/코드 후보검색·명시선택, 분류적용시 임시검색어 제거·성공안내·고정오류표시.
- AU CNF 새입력 추가운임0 준비, 기존 양수보존/중복가산차단. CW미기재 진행 가능 안내(중량값 자체 보존).
-101관련테스트,44-01 11행65박스 fixture 원가/XLSX 생성,CW null통과. Chrome 격리화면 Green/Red 선택→이슈0 확인. 운영 실제 저장 미검증, Product SELECT외 쓰기없음.
- 검색어: au44-flow Wolly Woolly DisplayName productSearch CNF CW 2997 2998
## 2026-10-27 태국39차 사진 승인 중량 (DB 불변)
- 사용자 확인2026/39-01 AWB21710637233 EXCEL7474에 GW164kg/CW225.5kg 사진 근거를 보고서 읽기 계산에만 연결. SQL 운임772.315USD 및 원장·수기·확정 revision 쓰기 없음.
- 다른 연도/차수/AWB/전표/농장/원문 지문은 거절. 신규 실제 중량·수기0 우선, 부분 실제값과 사진이 역전쌍을 만들면 사진 필드만 보류. 기존 NULL0 보조행 분류·상품분모는 그대로.
- 수정 전후38~41차 baseline4034/after4037SELECT, 독립1070검사 실패0, 원장·수기·확정본 관측지문 동일.39H미확정→412050(승인 추정),39F/40E105268.700315→95032.543002. 다른 국가/차수auto값 불변.
- 최종after4038SELECT/1070검사실패0 재확인. 전체verify:erp-change/webpack·dnSpy·manifest163·쓰기guard·guardian표적회귀 통과. PR/CI·배포는 진행 중/미검증. 상세 docs/work-sessions/2026-10-27_thai39-weight-evidence.md.
- 검색어: thai39-weight-evidence EXCEL7474 AWB21710637233 GW164 CW225.5 772.315 412050 photo 39F40E

## 2026-10-27 호주 기존 입고 원가 다운로드 진입·출하단가
- AU 기존연결 미지원으로 원가패널 숨김. 동일연도/차수/송장 native 조회·계산본 다운로드 진입 추가. 운영 DB 쓰기 없음.
- 사용자가 RedTip5100 확인. 출하단가=TPrice총액, EXE도 UPrice/TPrice 별도. AU native 계산용단가=저장총액/실제단수(5100/120=42.5), 저장8.5 및 원장 불변. 실제수량비율 사용.
-72회귀,실제7863SELECT·TEST_ONLY XLSX·원장지문동일 확인. 배포진행 전, 최종결과 세션MD 기록.
- 검색어: au-cost-download TPrice5100 RedTip42.5 nativePriceBasis 기존입고 다운로드

## 2026-10-27 인보이스 기준 독립 원가 계산·다운로드
- 기존입고 미지원 국가를 강제연결하지 않고 업로드 원문으로 미승인 계산본 생성. Product SELECT-only, 입고/재고/초안/승인원가 쓰기 없음. 기존입고 TPrice5100 기준 경로 보존.
- 원가탭 업로드인보이스/기존자료 선택, 인보이스업로드→매칭→도착원가 준비. 미매칭/원문 불일치 행별 차단, 날짜/운송 직접 수정, 지문 재검증. 입력은 작업탭 전환에도 유지.
- 국가별 공식·양식회귀 및 격리Chrome 계산→XLSX 다운로드 확인. 운영실제7863 readonly지문 동일. 운영 업로드/승인실행은 미검증(금지). PR/배포 진행 전, 최종결과 세션MD.
- 검색어: invoice-cost-independent INVOICE_PREVIEW PREVIEW_ONLY 원가단독 인보이스 미승인 다운로드

## 2026-10-27 거래처관리대장1(채권) 구성 착수
- 사용자 범위 E040723 전표별/담당거래처/최근1개월/KST평일09~18 정시. 운영 메뉴 자료미수집 확인. ar 요약과 별개.
- 원본 전표37행 판매/수금/이월/잔액 대조일치. OrderCode는 이카운트코드와 다름을 확인해 유일한 사업자 식별값으로만 연결. 담당125/수집후보120/연결확인5. 전용API/UI/정시수집 연결, 일반snapshot API에서 ledger723 차단. 개인정보 대신 날짜·금액·내부키만 웹snapshot에 저장.
- 정책/권한/API/검증16테스트 통과. 전체ERP/build 통과(기존공유 node_modules 누락은 독립 npm ci로 해소). PR/배포/실제예약수집은 아직 미검증. ECOUNT와 공유ERP원장 쓰기없음.
- 세션: docs/work-sessions/2026-10-27_ecount-ar-hourly.md
- 검색어: E040723 거래처관리대장1 전표별 담당거래처 최근1개월 평일09-18
## 2026-10-27 주차별·월별 보고서 수요일 계산본 저장
- 요청: 수요일에 이번주 직전1차수를 저장하고 과거조회 재계산 제거. 실제 PeriodDay로10/28current44→43저장, KST06시·지연슬롯고정·DB잠금/멱등/원천변경검사. 기존 WebProfitReportSnapshot INSERT만, ERP·수기·확정원장보존.
- v1 row.calc/totals 저장값을 웹·엑셀·월별이공유,legacy/miss409,확정CALC우선. 과거패널자동원천조회제거·명시수정후캐시갱신/실패분리·UI경합보호.
- 사용자 선택 "저장된 차수 우선, 최신 차수는 별도 조회": 월별기본현재미만hasData만,진행/미래는체크명시. 캐시미준비합계를0으로숨기지않음. 일반GET쓰기0.
- 실제SELECT-only검증:41차26.4초/1174SELECT→저장형식17행/합계exact일치. 기본월별472ms/6SELECT/live0(아직missing42). 원장guard로쓰기0;동시운영3테이블변화는전체불변이라고과장하지않음.
- 전체verify:erp-change/webpack·신규3회귀·manifest166·dnSpy·쓰기guard통과. PR/CI/배포/최초2026 1~42준비/운영스모크는이기록시점미검증. 결과는 docs/plans/profit-weekly-cache-2026-10-27.md에 이어 기록한다.
- 검색어: profit-weekly-cache 수요일06시 PeriodDay43 44 cachePolicyVersion 저장된계산본 월별최신차수포함 BACKFILL

## 2026-10-27 계산본 최초 준비 가드 보완
- PR1316 master a6a7619, CI40458268697 및 Cafe24배포40458808503 성공. 배포 ping/hydration 통과.
- 최초 준비는 조건부 테이블 존재 확인 SELECT를 가드가 차단하여 1차에서 중단(INSERT시도0). 좁은 IF OBJECT_ID SELECT 허용 및 실제 함수회귀 추가, DML/DDL/SP 차단과 실패 latch 유지. 운영원장수정 없음; 최초저장 완료 여부는 후속 검증 기록 참조.
- 검색어: profit-cache-backfill-guard sourceWorkbookFx IF_OBJECT_ID CACHE_ONLY_SQL_BLOCKED PR1316

## 2026-10-27 원가표 Woolly 품목 변경
- 원가표가 ProdKey만 보여주고 분류버튼은 입고탭에만 있었음. 원가탭/행 버튼에서 기존 합계검증 분류모달 연결, 영문/한글 매칭명 표시. 운영원장·공용매칭·원가식 쓰기없음.
- 품목 변경→새 prepare지문/미리보기 필요, 환율·통관비 보존, 변경된 행 관세/배분입력 재확인. 다른 문서/연도 입력승계 금지.
- dnSpy 재실행 및 Product2997/2998 활성AU SELECT확인. Chrome 격리 전체Workbench에서 Red→Green 선택/적용→관세0 시험값→원가2560000→TEST_ONLY XLSX 다운로드 확인. 실제원가 승인 아님. 75표적검사66통과9선택원본생략. 전체검증/배포 진행중.
- 검색어: woolly-cost-edit onEditAllocation invoiceCostEditing GreenTip RedTip 원가표 품목변경

## 2026-10-27 호텔+미우 주문전용
- 기본 호텔 주문등록 탭: 요청/발주 TXT·Excel·이미지·텍스트 매칭, Product.OutUnit 합산, 발주→라움/완성박스잔량→호텔여분/잔여→선택업체. 기존 합산·이력 보조탭 유지.
- 기존 my-customer ADD/expectedCurrentQty writer 사용, 원장 직접SQL 추가0. 로그인별 브라우저 초안·등록전 pending저장·실패재등록차단·서버 previous/final 결과·이력보관. 공용/호텔 저장 매칭1035행146품목, 충돌 수동선택.
- 실제 dnSpy·SELECT-only downstream 확인, 신규6회귀 및 전체ERP/dnSpy/manifest/writeguard/화면틀 통과. 격리Chrome 정상/응답유실 시험 통과. 빌드·PR·배포는 이기록시점 진행중이며 실제업무주문/외부OCR사진 전송은 미검증.
- 검색어: hotel-order-only 요청수량 발주수량 호텔여분 분류필요 expectedCurrentQty 호텔주문전용
## 2026-10-27 호주 관세율 기본값·실제44-01 검증
- 기존 호주39-1 원가파일 SHA7cb66c 품목별율: CopperGlow6.9%,9품목0%. RedTip은 사용자 별도0%승인. 활성ProdKey+정확이름/2026이후39차/AU AIR만 자동입력, 근거표시·수기보존·품목변경시기본율재준비.
- 실제44-01 PDF SHA994541과 저장분석본11행 일치SELECT. Chrome 격리Workbench에서 Red/Green검색선택·합계적용·관세변경·환율보존·미리보기·다운로드 완료. 파일11행2385단20443.75AUD, 전체수식차이1전미만/렌더확인. TEST_ONLY1090원/AUD·통관10000원, 원가22370401.7. 운영쓰기0.
- 표적76검사67통과9선택원본생략. 전체회귀/webpack/CI/배포 진행중. 자세한근거 docs/work-sessions/2026-10-27_au-tariff-defaults.md.
- 검색어: au-tariff-defaults CopperGlow6.9 GreenTip0 RedTip0 39-1I18 44-01TEST_ONLY

## 2026-10-27 계산본 1~42차 준비·운영 다운로드 검증
- BACKFILL 1~41 새 버전41개, 42차는 운영 예약저장본을 그대로 사용. SQL22429조회/INSERT시도41/차단0. ERP·수기·확정원장 쓰기 금지 유지.
- 저장본 조회 18/26/31/41/42 모두 stored, 각100~331ms/4~5SELECT. 월별42차 missing0,753ms/5SELECT/live0. 월별156개 금액·이익률 대조통과(부동소수점 최대차2.78e-17, 음수0은 JSON상0).
- 예약42차는WEEKLY/weekly-scheduler:2026-10-21/version1. 보호20테이블중17관측동일,OrderMaster/OrderDetail/ShipmentMaster는동시업무로변화. 수기/확정/환율/통관비웹테이블은동일. 본작업 원장쓰기0.
- 운영 다운로드 run40460713452 성공:18차985ms/36315bytes,41차943ms/36444bytes,각HTTP200/1시트/화면금액차이0/업무쓰기0. 원가미확정 null은0으로대체하지않는다.
- PR1319 후속보완은 동시 master WORK_MEMORY 추가내용을 모두 보존하여 병합 후 CI 재실행. 최종배포는 후속 기록 참조.
- 검색어: profit-weekly-cache 1-42 materialized monthly753 18xlsx 41xlsx 40460713452

## 2026-10-27 거래처관리대장 운영 검증 보완
- PR1317/28c8e8e3 Cafe24 배포 성공, 운영 worklist120·관리자 무배정 빈목록·웹snapshot 첫8전표 적재 확인. PC 런처 백업(.bak-1027) 후 독립 .orbit/ecount-runtime으로 교체, 원래 로그인 프로필 유지 및 자동 로그인 성공.
- 실제 빌드의 40행 가상자료 브라우저 검증에서 공통 .table-scroll max-height 충돌 발견: 고유 클래스명으로 수정. 원본 검색 실패 팝업이 다음 고객에 영향을 주지 않도록 매 고객 새 문서 및 실패 복구를 추가하고 실패단계만 기록(원문/개인정보 로그 없음).
- 정책/API/산술/실패격리18테스트와 webpack build 통과. 보완 PR/배포 및 전체 첫 배치는 진행 중. 첫 운영 배치 전체 성공으로 판정하지 않음.
- 검색어: E040723 ledger723 팝업격리 ledger-table-scroll 수집복구

## 2026-10-27 채권 무전표 이월잔액 및 연결 확인 상태 보완
- PR1320 병합(64d4d6db), Cafe24 배포 진행. 실제 수집에서 이월잔액 한 행만 있고 합계가 없는 원본 형식 확인, 기존 대기 조건을 보완. 날짜 단축키 첫 조회도 표가 완성된 뒤 다음 조건 설정.
- 번호 불일치/검색 불명확을 이름으로 추정 연결하지 않음. 안전한 원인코드·시각만 RED snapshot에 추가하고 마지막 검증 자료를 유지하도록 API/화면 구성. 원장·거래처 정보 수정 없음.
- 해당 변경은 테스트/CI/배포 및 다음 실제 배치 검증 진행 중이며 전체 고객 성공으로 판정하지 않음.
- 검색어: E040723 이월잔액 단독행 balanceOnly LINK_CHECK_REQUIRED RED GREEN 갱신실패

## 2026-10-27 채권 최종 배포 및 날짜 입력 확정 보완
- PR1317·1320·1323 병합. 최종 웹 04b3c958 Cafe24 배포40464469344 성공, 운영 DOM 버전 확인. 22개 채권 테스트·전체 ERP 계약·webpack build·필수 guard 통과. 가상자료 실제 빌드 화면에서 이월잔액/연결 실패/이전 정상자료 유지 확인, 운영 담당 외 접근 및 수집 API 쿠키 접근 차단 확인.
- 수집기 독립 .orbit/ecount-runtime 경로에 04b3c958 적용, 기존 로그인 프로필/예약작업 유지. 초기 전체 배치 검증 중 날짜 편집 확정과 검색 클릭을 분리해 보완. 원본 1개월 결과·식별 일치 재검증, 원장 수정 없음.
- 기존 임시 작업트리 경로가 외부에서 정리된 상태여서 origin/master의 새 작업트리 C:/Users/USER/nw-ecount-ledger-final로 이어서 검증(잠금 설정). 커밋·운영 수집기는 독립 경로라 보존됨. 전체 배치 최종 건수는 아직 미검증.
- 검색어: E040723 날짜 blur Tab 입력확정 04b3c958 거래처채권 최종검증

## 2026-10-27 채권관리 운영 배포와 원본 조회 완료 검증
- PR #1317/#1320/#1323 운영 반영(04b3c958). 본인 담당 거래처, 최근1개월 전표별, 이월잔액 단독·안전한 실패 상태·마지막 검증본 유지. 원장 변경 없음.
- 계약22테스트 및 기존 전체 ERP/webpack CI 통과. 실제 운영 권한403/우회404/토큰전용401, 빈 담당목록 및 테스트 자료 데스크톱40행/모바일390px 검증.
- 원본 날짜 fill/Tab 확정, 전월+금월 요청 완료와 실제 기간 확인, 페이지 검색 버튼 클릭으로 조회. 모호한 거래처 팝업은 즉시 차단. PR #1324 전체 회차 최종 검증 진행 중.
- 런타임 .orbit/ecount-runtime 및 기존 로그온 런처 사용. 임시 작업트리 외부 정리에 영향받지 않음. 실행 이력 최종 수치는 세션 문서 후속 기록 참고.
검색어: E040723 ledger723 최근1개월 전표별 이월잔액 networkidle 담당자 자동갱신
## 2026-10-27 호주 도착원가 원본 내용 복원
- 스타일만 보존하고 내용이 비던 AU 엑셀에 38-1 해시검증 고정값/통관/판매/이익 수식을 기본활성 원본시트로 복원. 승인 계산본은 변경하지 않음.
- GW*460+33000+품목수*10000+90000 기본값은 수정 가능한 과거 추정근거. GW 누락은 입력필요, 명시0/직접 통관총액 보존. 현재 판매가 O열과 과거 참고판매가 구분.
- 로컬 Chrome44-01 11행 Woolly 검색/적용, 통관비 계산, 다운로드 완료. 65박스/2385단/AUD20443.75, 시험FX1090/GW265.5 원가22715531.7. 독립 재계산/판매가 입력 후 총손익 검증. 운영 DB 쓰기0.
- 대상79테스트 중70통과/9선택적 원본fixture skip, 전체 계약·최종빌드·배포 후속 기록 예정. 세션: docs/work-sessions/2026-10-27_au-template-restoration.md.
- 검색어: AU template restoration 원본고정값 매주확인 판매 총이익률 44-01

## 2026-10-27 호텔 주문 초안·결과 서버 보관
- 사용자 요청: 다른 PC에서도 연도·차수별 초안/결과를 불러와 이어서 작업.
- data/runtime/hotel-orders의 사용자별/연도/차수/작업UUID 서버 저장. immutable revision + fsync + atomic exclusive link로 동시 덮어쓰기409. MSSQL 스키마/ERP writer 변경 없음.
- 입력 텍스트/매칭/업체배정/결과 자동저장, 명시 저장/목록/복구, 기존 localStorage 초안 deterministic ID 가져오기. pending 서버저장 완료 후 기존 주문 POST, frozen/완료결과 보존.
- 신규 실행형5검사 및 전체 ERP 계약/dnSpy/manifest167/변경API1 writeguard/UI layout 통과. Chrome 두 창90→120 공유·오래된150 차단·격리 등록5→125 결과 새로고침 복구·응답유실 조회복구 Enter 확인. 실주문 쓰기0.
- 최종빌드/PR/운영배포는 후속기록 참조. 검색어: hotel-server-drafts 서버초안 차수별 CAS immutable revision 응답유실

## 2026-10-27 업체비중·이월 포함 판매마진 / 38→39차 감사
- 기존 주차별 보고서의 수익률·확정본·계산 저장본은 유지하고 독립 새창을 추가. 국가/품종/단위→업체 비중→품목 근거, 청구/실물 수량·VAT·미확정 원가를 구분한다.
- 품목별 실제 0재고 앵커 이후 수량 연속성과 전체 매입행 원가를 대사한 주기 가중평균만 사용. 판매단가·최근 다른품목 평균·부분원가 대체 없음. 새 SQL은 SELECT-only. 기존 원가3모듈은 추가 coverage metadata와 named export만 변경.
- 실38→39 API 5.9초/875SELECT/쓰기0,49그룹,기존 N/L/O대조 차이0. 39차176품목 원가확인/119미확정, 매출기준23.8%(승인추정포함);38차23.2%. 모두 확정된 판매마진이라고 보고하지 않는다.
- 기존총수익률−0.889945%→34.813893%. 38음수/39양수 재고조정과매입·판매규모 변화가 중요. 원시수량차이8품목은39차native ROUND2로맞으나 다른 원가부족은 남음. 과거모든기간ROUND2재현은미검증.
- 본표독립검산1292건,신규42회귀통과. ERP전체/webpack1차통과,최신master통합 후 최종검증·CI·배포·운영브라우저는 진행중(완료미판정). 문서: docs/work-sessions/2026-10-27_profit-customer-margin-38-39.md.
- 검색어: profit-customer-margin 업체비중 평균도착원가 38-39 23.8% 재고조정 Shapley ROUND2

## 2026-10-27 도착원가 다운로드 사유·버튼 통일
- 기존 다운로드 gate를 바꾸지 않고 서버 오류/누락값/확인/미리보기 필요를 버튼 안과 인접 상태에 표시. 입력변경 시 기존 오류 지움.
- 원가 품목변경·입력수정·보기필터·업로드 진입 버튼을 파란색/흰색 테두리·포커스·줄바꿈 디자인으로 정리.
- 격리 Chrome44-01 GW 누락→시험265.5→미리보기→실제 다운로드→GW삭제 재차단 확인. 운영DB 쓰기0. 로컬빌드 통과, CI/배포 후속 기록.
- 검색어: cost-download-feedback 다운로드 비활성 버튼 GW 44-01

## 2026-10-27 호텔 주문전용 버튼 디자인 통일
- 요청: 버튼 모양을 통일하고 색감으로 구분. 호텔 페이지 전용 CSS Module에서 공통ERP radius/font를 사용하고 높이32px·13px·padding6/12로 통일. 탭/파일선택/기존탭 버튼도 동일 형태.
- 저장청록·조회보라·매칭파랑·주문초록·삭제연빨강·재시도황토, 비활성 회색과 focus ring. 이벤트/disabled/서버저장/ERP SQL 변경0.
- Chrome 격리실화면 요청30/분류표·버튼높이32px·색상·Tab초점 확인. build/dnSpy/manifest167/writeguard0/UI57 통과, 전체회귀/PR/배포 진행중.
- 검색어: hotel-buttons 버튼통일 data-tone 32px 청록 보라 초록

## 2026-10-27 업체 판매마진 원가 미확정·운영 대사 경고 보완
- 사용자 요청: DB를 변경하지 않고 미확정119품목과 저장본·SQL 경고를 진단/보완/검증/배포. 별도 nw-profit-margin-evidence, base cb485cbc.
- 정확한 WdetailKey 대신 동일 ProdKey 첫 입고로 연결하던 부분을 새 분석 strict 옵션에서 보완. 기존 주차별 보고서 기본 호출/원가/수익률은 보존한다.
- 실제 0재고 앵커 이후 입고 조회한도와 native ROUND2를 검증. 원가원천 raw 입고/출고/조정과 native 원시합계가 다르면 잔량이 맞아도 원가 승격 금지.
- 경량 대사 GET와 SQL/저장본 차액·분류 적용·시점·합계 제외범위 표시. 운영 원인은 운영 응답 확인 전 미검증, 로컬 일치를 운영 전체 일치로 보고하지 않음.
- 39차119→98/38차86→45, 기존본표/판매값19,629비교·기존도착원가371품목 불변. SELECT1238/쓰기0/8.255초,52회귀·전체verify/build·manifest168/writeguard1·production로컬UI 통과. CI·배포·운영 브라우저 아직 미검증. 기록: docs/work-sessions/2026-10-27_profit-margin-evidence.md.
- 검색어: profit-margin-evidence 원가미확정119 WdetailKey strictReceiptLines nativeROUND2 원천범위 reconciliation 저장본SQL

## 2026-10-27 ECOUNT 담당 거래처 채권 최신화 요청 및 메뉴 노출
- Finance 상단 `ECOUNT 채권` 바로 옆에 `거래처관리대장1(채권)` 링크를 추가해 전표별 최근 1개월 화면 진입점을 노출.
- 기존 정시수집을 KST 평일 08:00·11:00·14:00으로 변경(09시·정오·15시 전). 놓친 회차는 따라잡지 않음.
- 선택한 담당·식별값 연결 거래처만 평일 08:00~18:00 수동 최신화 요청 가능. 요청은 WebEcountSnapshot ledger723 대기 이벤트에 append-only 저장하고 원본 PC 수집기가 예약 배치 종료 뒤 순차 처리; 요청 중복 억제, 실행상태 15초 폴링, 10분 cooldown, 2시간 이상 정지한 건 재시도 가능.
- ECOUNT 조회 전용 유지. source code/요청자 정보는 대기 이벤트에 저장하지 않고, ECOUNT 및 공유 ERP 원장/테이블은 수정하지 않음.
- 정책/API/큐 회귀 25건 통과. `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from HEAD^`, `npm run guard:erp-writes -- --changed-from HEAD^`, `npm run build` 통과. 원본 PC 예약 작업과 배포 후 실브라우저는 PR/배포 후 확인 예정.
- 검색어: ecount-ledger refresh-request 거래처관리대장1 E040723 08:00 11:00 14:00
## 2026-10-27 호주 44-01 CI·AWB 결합/도착원가
- 44-01 CI와 AWB 동시 업로드 흐름 구현. AWB 번호·65박스·GW/CW 805kg은 원문 근거/지문/사용자 확인 없이는 입고 검증 통과 불가. CI가 C+F라 AU AWB 운임을 원가에 중복 가산하지 않음.
- AUD/KRW는 업로드일의 Yahoo Finance 시장 일봉, 비거래일에는 직전 quote를 사용하고 고시일·출처를 보존. 인보이스 작성일은 KST 2026-10-26, 업로드 기준일은 2026-10-27.
- AU AWB 자동화 5/5, import-team 120 pass·18 선택 원본 생략, exporter 35 pass·9 선택 원본 생략, ERP 계약 전체 통과. `npm run build`, write-guard, dnSpy golden, ERP manifest, 격리 SQL writer 테스트도 통과. 운영 DB 쓰기 0.
- 실제 PDF는 로컬 격리 브라우저에서 업로드 UI까지 확인했으나 OCR/AI 호출과 실제 입고 writer는 mock. 이어지는 전체 UI에서 원가 다운로드를 클릭해 끝내는 E2E는 미검증이므로 실입고·배포 완료로 주장하지 않는다. PR·CI·Cafe24 배포 상태는 별도 작업 세션 기록을 따른다.
- 검색어: AU AWB 44-01 805kg 65박스 AUDKRW C+F 업로드환율 도착원가 다운로드

## 2026-10-28 SS3 관리자 전체 거래처 채권 조회
- 채권대장 GET에서 관리자 계정 `nenovaSS3`는 전체 활성 거래처 목록과 유일한 ECOUNT 식별값이 연결된 검증 대장을 읽도록 범위를 추가. 담당자 계정은 기존 배정 범위를 유지.
- 무담당/중복담당 거래처도 관리자 목록에 표시하되, 식별값 누락·중복 거래처는 비활성 선택. 관리자는 타 담당 거래처 최신화 버튼을 사용할 수 없도록 구분.
- 계약에 관리자 조회 범위와 제한을 반영. targeted ECOUNT 28/28, ERP contract, dnSpy evidence, ERP manifest 168, write guard, build 통과. PR/CI/배포 후 브라우저는 미검증.
- 검색어: ecount-customer-ledger nenovaSS3 전체 거래처 관리자 refreshable

## 2026-10-28 호텔 차수·카톡 입력
- 기본차수 ±5 및 세부01~04 버튼, 초기 기본차수 선택. 빈 작업 자동저장 잠금 방지.
- 자동저장 중/실패에도 텍스트 입력 유지. Chrome 8초 지연 중 요청·발주 추가 paste→revision2 전체원문 보존,503후 편집 유지 확인. ERP writer/API 변경0.
- 검증/배포 진행중. docs/work-sessions/2026-10-28_hotel-input.md 참조.
- 검색어: hotel-input 카톡 붙여넣기 autosave disabled ±5

## 2026-10-28 도착원가 작업대 client exception
- 운영 Console 증거: `ReferenceError: documentCountry is not defined` at `InvoiceReceiptWorkbench` AU AWB render condition. `documentCountry`는 비용검토 파일 내부 비공개 함수였고 작업대에서 미정의 식별자로 호출되어 선택 문서 렌더링을 중단.
- 작업대에 local `isAustraliaReceiptDocument` predicate 추가(AU/AUSTRALIA/호주) 및 regression test. `invoiceReceiptWorkbench`, `invoiceReceiptSourceResume`, `auAwbFlow` 28/28 통과; 전체 `verify:erp-change`가 계약/manifest/writeguard/build까지 진행되어 빌드 성공.
- 동일 콘솔의 receipt GET 404는 `readExistingReceiptSource`가 `INVOICE_DOCUMENT_NOT_FOUND`에 대해 신규 초안으로 이어가도록 설계된 사전 조회 miss이며 테스트로 확인. 입고·원가 저장 API/DB 쓰기 0.
- 적용 기준: 기존 작업대 UI의 국가 렌더 조건만 수정, 메뉴 기준선·페이지 스크롤/키보드 동작은 해당 없음. PR/배포 상태는 후속 기록.
- 검색어: documentCountry is not defined ReferenceError AU AWB workbench expected receipt GET 404

## 2026-10-28 ECOUNT 채권 요약 및 평균 매출
- `/ecount/receivables` 표를 거래처명·매출합계·수금합계·기타할인등차액·잔액·미회수월 + 월평균·차수평균으로 확장하고 메뉴명을 `ECOUNT 채권 요약`으로 명확화.
- 일반 담당자는 유일하게 이름·담당자가 확인된 거래처만 조회, `nenovaSS3`는 ECOUNT 행 전체 조회. ECOUNT 행을 ERP 거래처에 유일 연결할 수 없는 경우 평균은 추정하지 않음.
- 평균 매출은 KST 최근 12개월 `ShipmentDetail.isFix=1` 확정 출고의 `Amount+Vat` 기준. 월평균 분모 12, 차수평균은 매출 발생 `OrderYear+MajorWeek` 단위(세부차수 합산).
- ECOUNT 스냅샷·공유 ERP 원장 읽기 전용. policy/API mocked UI tests, ERP contract, dnSpy evidence, manifest 169, write guard, Next build 통과.
- 검색어: ecount-receivables etcDiff manager-scope rolling-12-month major-week average

## 2026-10-28 ECOUNT 채권 업체 검색 및 담당자 필터
- `/ecount/receivables`에 업체명/담당자 검색창, 담당자 선택 버튼(전체/개별), 검색 결과 수를 추가하고 업체명 옆에 담당자 표시 이름을 붙였다.
- 읽기 전용 Customer/UserInfo 조회에서 이름을 전달하며, 일반 사용자의 담당자 권한 필터와 nenovaSS3 관리자 전체 범위는 유지했다. 미매핑·모호한 행은 `담당자 미확인`으로 표시한다.
- policy/API 회귀 테스트와 ECOUNT 계약 설명 갱신. 정책/API 테스트, `test:erp-contract`, dnSpy evidence, manifest 169개, write guard, Next build 통과. 빌드가 재생성한 개발 이력 JSON은 작업 범위 밖이라 복원.
- ECOUNT 및 ERP 원장 쓰기 없음. 운영 화면 스모크는 미검증.
- 검색어: ecount receivables company search manager filter 담당자 버튼 업체명 검색
## 2026-10-28 호텔 원본 대조·번호별 수량 저장
- 원본 이미지/텍스트 옆 품목·수량 편집표, pending 서버 검토 → 명시 요청수량1·2/발주수량1·2 저장, 합산 반영. 기존 행은1로 보존.
- 이미지 원본은 인증 사용자별 immutable runtime 파일(15MB), pending/batches는 기존 차수별 CAS 초안. ERP/SQL 쓰기 변경 없음, frozen 보호 확장.
- Chrome 합성 이미지303→305 수정/503실패 보존/요청수량2=103/합산408/재불러오기 원본 복원 확인, 주문 호출0. build·단위/API 검증 통과; CI/배포 후 결과 추가. 실제 업무 OCR·주문등록은 미검증.
- 검색어: 호텔 원본 이미지 나란히 매칭 요청수량1 pending batches hotel-order-images

## 2026-10-28 호주 Woolly 분류 버튼·AWB 차단 안내
- 실제 운영 웹 화면(44-01 AU)에서 Woolly 행의 빨간 분류 버튼을 눌러 재현: 행 포커스만 바뀌고 분류 작업대로 진입하지 않음. 원인은 `PackingResults`가 ALLOCATION 상태도 일반 DB 매칭 콜백으로 보내고, 부모의 `prepareReceipt`가 AWB 확인을 먼저 요구해 분류 모달이 있는 입고 작업대를 마운트하지 않은 것.
- ALLOCATION 전용 콜백으로 분리해 해당 행 버튼/상단 분류 CTA가 입고량 분류 작업대를 먼저 열도록 수정. 이 분류 단계는 AWB 확인 전에도 열리지만 입고·도착원가 이동은 계속 AWB 검증·완료 확인을 요구함.
- AWB 차단 시 원인 문구를 CTA 옆에 표시하고 버튼 문구를 `AWB 대조 항목 확인`으로 변경, 클릭하면 AWB 검토 구역으로 스크롤·포커스. 안전 차단 조건은 완화하지 않음.
- 회귀 테스트 추가: Woolly 상태 버튼/원문 품목 버튼이 분류 콜백으로 가고 일반 DB 매칭 콜백으로 빠지지 않는지 확인. `test:import-team`, `test:erp-contract`, `test:erp-manifest -- --changed-from origin/master`, `guard:erp-writes -- --changed-from origin/master`, `test:ui-layout`, `build` 통과. 빌드 후 생성된 이력 스냅샷은 정리.
- 입고/원가 승인이나 ERP 원장 저장은 하지 않음. 운영 브라우저에서 수정 전 결함은 재현했으나 수정 후 브라우저 E2E·CI·배포는 미검증.
- 검색어: Woolly bush 파일별 품목 입고량 분류 onAllocate AWB 검증 focusReceipt disabled button 실제 웹 재현

## 2026-10-28 Woolly 분류 버튼 배포 확인
- PR #1344 CI 통과 후 squash merge `300f0294`; Cafe24 배포 run `40652729466` 성공. GitHub 빌드·SSH 배포·Hydration 실브라우저 스모크 모두 통과.
- 사용자의 Chrome CDP 탭 연결은 `Emulation.setFocusEmulationEnabled` 10초 타임아웃으로 재시도 후에도 연결 실패. 따라서 배포 후 운영 UI에서 Woolly 버튼을 직접 클릭한 E2E는 미검증. 수정 전 실제 운영 클릭 무반응은 재현했고, 변경 후 콜백 회귀테스트/로컬 빌드 통과.
- ERP 입고·재고·원가 저장 없음. AWB 근거 대조 가드는 보존.
- 검색어: PR1344 300f0294 Cafe24 40652729466 Woolly onAllocate Chrome CDP E2E 미검증

## 2026-10-28 자동수집 일괄등록
- 자동수집 영업지원 등록 허용. 혼합 등록과 주광·태림 43차 양성/출고 없음/0원 단가/중복 fixture 통과. PR #1339 검증 진행.
- 검색어: 자동수집 주광 태림 43차 AUTO_SOURCE_REVIEW_REQUIRED

## 2026-10-28 자동수집 일괄등록 전수 검증
- 43차 전체400행 중 자동146행/31업체 대조: 137행 preflight/preview 정상, 기존등록1/동일견적5/단가없음3 정상제외, 원천차단/화면서버불일치0. 44차 추가 확인 중.
- 계획 함수에 남은 과거 자동원천 차단 제거. 96개 업체/연도/확인/현재·과거원천 조합을 CI 독립 실행. 실제 ERP 원장 쓰기 없음.
- 검색어: 자동수집 전수 31업체 146행 137행 provenance parity 43차 44차
- 44차 자동151행/32업체도 전수 완료: 정상90행 preflight/preview 오류0, 기존등록1/출고없음58/단가없음2 정상차단. 양 차수 원천차단/표시검증불일치0. 기존등록469 실제9509/38-01 연결 확인. PR1340 CI 진행.

## 2026-10-28 원문 없는 과거 불량차감 재노출 정리
- 사용자 희경15단 오류 확정 및 레바논2단/주광화이트 포함 전체 해결 요청. 대상722/740/859/868/877. 과거40차9955/9913 실제 견적과 혼동하지 않는다.
- 전체 SELECT: 자동원천+과거ESTIMATE_UNLINK78행/24업체, 연결견적없음65행/17업체(중복집합있음). 전부 오등록으로 삭제하지 않고 공통 SQL/순수 판정으로 SOURCE_REVIEW 격리. 목록/preflight/preview/planning/final잠금/완료/선택에 적용.
- 기존 정상 자동/수동96조합 및 실사례5행의 변조preflight/preview/register 쓰기0 회귀 통과. 사용자확인5행은 배포 후 기존 버전검증 manage-archive로 실제견적/적용이력 보존하며 정리할 예정. 원문 범위는09/14까지이므로10월 미게시 여부를 역추정하지 않음.
- 검색어: 희경15 레바논2 주광화이트 rejectedAutoSource missingLinkedEstimate ESTIMATE_UNLINK 722 740 859 868 877

## 2026-10-28 92건 원문 대조·정상 후보 복원 진행
- 사용자 제공10/28 불량 공유방 원문5392항목(05/13~10/28)을 메모리에서 대조. 원문·발신자는 저장소에 복사하지 않고 SHA/ordinal/업무키만 감사계획에 기록.
- 운영43차 검토92건=과거해제자동73+유효연결부재19. 고정계획62 archive/4 release/26 hold. 실제보존견적·수량·단위/다른규격까지 재검증. 26건은 실제차감과 원문수량차이·원문부재·다른신고 구분 등 미확정 판단으로, 사용자가 기준 선택 중.
- 관리자 원문 근거/현재버전/실제견적부재/부분적용부재를 확인하는 review-source preview/apply 추가. 웹원장/감사만 변경하고 ERP/Estimate/Application 보존. 복원603/1010/1013/1015는 정상일괄등록의 EXE/단가/중복 검사를 다시 통과해야 함.
- 실제 MSSQL SELECT-only CTE9반례(정상/교차연도/업체/품목/수량/단위/원천/비고/이후unlink) 통과. 단순 등록버전 증가는 원문 재승인을 무효화하지 않음. 실제dnSpy ClassEstimate 저장대상 재확인.
- 검색어: 92건 원문 5392 source review release 603 1010 1013 1015 SHA ordinal 다른규격62 26hold

## 2026-10-28 42차 이후 우선 정정 (진행)
- 사용자 정정: 과거 수량차이 소급보다42차 이후가 중요함. 앞선92건62/4/26계획은 실행하지 않음. PR1342 CI→81536c32 배포성공 뒤 정상1010/1013/1015만 복원, 운영preflight3건 오류없음.
- 제공 원문 기준으로 1019브르트15는5단,대한1066/1067의15/15는원문25/6과 달라 잘못된추가후보. 같은표식/항목원문없음1048~1060의 업체·품목·수량 오매칭 추가확인.
- 현재43차 오등록Estimate12개(10803,10806,10807,10809,10810,10811,10812,10813,10814,10817,10818,10819)는 고정계획 후 기존감사선택삭제API/비강제ERP편집lease로정정예정. 정상10808/10815/10816은보존+원문검토확인.
- 잘못된현재후보17archive,원문정상5초안(4정상+유칼립투스6단환산미확정표시) 준비. 나머지과거행은 격리유지하며현재재등록하지않음.926안시리움사진원문과유칼립투스환산2사항은사용자질문중.
- 재발방지: 항목근거없는자동원천/여러업체공유표식은검토대기,정상확인된실제견적은보존검토확인.원문업체줄·동일품목줄의수량단위검증회귀추가.선택외ERP전후지문보존확인예정.
- 검색어:42차이후 10806브르트5vs15 대한25/6 17archive12withdraw 926 유칼립투스환산 SOURCE_EVIDENCE_INCOMPLETE SOURCE_UNIT_REVIEW
- 사용자 최종 답변:926안시리움과1052유칼립투스는직접입력같으니냅둬.두원장/실제10811견적보존,원문추정/환산/복원중지.최종범위16archive/11견적삭제/정상3견적확인/4초안.두수기행전후스냅샷확인.

## 2026-10-28 Woolly 분류 버튼 실제 UI 차단 재현 및 수정
- 로컬 `격리 테스트` 웹앱 화면에 실제 44-01 호주 CI/AWB PDF를 선택, mock 분석 응답으로 11행 결과를 렌더링. 실제 AI/OCR가 아닌 UI 흐름 검증이며 운영 DB 미접속.
- 9개 유사매칭 미확인 상태에서 10/11행 Woolly 분류 버튼을 누르자 앱이 `전산 품목을 확인할 행이 9건 남았습니다` 안내로 분류 화면 진입을 막는 것을 직접 재현. 원인은 분류 검토용 준비 요청이 일반 입고 진행과 같은 전체매칭 완료 검증을 공유한 것.
- 수정: Woolly 행별 분류 검토 진입만 잔여 일반 매칭 검증을 우회. 팀 매칭 로딩/저장/분석/최신 revision 보호는 유지하고, 일반 입고 진행은 계속 모든 매칭 완료를 요구. pure gate 회귀 3건 및 packing-team 관련 138건(120 pass/18 optional skip), `npm run build` 통과.
- 수정 후 최신 빌드의 실제 격리 웹앱에서 동일 인보이스/AWB를 다시 선택. 9개 유사매칭이 남은 상태에서도 버튼이 분류 대화상자를 열었고, 검색에서 Wolly Bush Green Tip(#2997), Red Tip(#2998)을 각각 골라 `합계 검증·문서에 적용` 후 10·11행에 반영된 것을 UI로 확인. 분석 결과/AWB 필드는 로컬 fixture 응답이며 실 AI/OCR은 호출하지 않음.
- 입고 등록·원가 승인·다운로드는 실행하지 않았고, API fixture는 DB에 연결하지 않음. 격리 UI에서 분류표시·검색·선택·문서 적용까지 검증 완료. 화면 검증 시 가로로 넓은 모달의 일부 DOM 클릭은 위치가 어긋나 실제 화면 좌표 조작으로 후보 버튼을 선택함.
- 검색어: 44-01 AU actual UI Woolly classification 9 fuzzy unresolved packingPreparationBlockReason test build
## 2026-10-28 최종 수기입력 보존 정정
사용자 “수기입력 묶음은 모두 보존” 확인. 앞선16archive/11견적삭제/4초안 계획은 실행 전 철회했고 해당 JSON은 executable:false로 봉쇄했다. 브라우저 혼합저장에서 첫 자동행의 sourceFileName이 수기행까지 공통 적용된 실제 저장버그를 확인했다. 1019 및1048~1060 총14수기와1139~1142 다음저장4수기는 수량·견적·원장버전 전부 보존하고 감사 이력만으로 출처를 정정한다.926도 보존한다.1066/1067 자동2건은 원문5233(25/6)과15/15 불일치로 삭제 없이 검토표시.별도 과거해제자동864→43차10803만 기존 선택삭제/편집잠금으로 정리한다.최종 고정계획 defect-manual-provenance-final-2026-10-28.json 및 reconcile-defect-manual-origin.mjs가 이전 계획보다 우선한다.
검색어: 수기입력 모두보존 sourceFileName 혼합저장 MANUAL_SOURCE_CONFIRM SOURCE_FACT_REVIEW 10803

검증: 전체 test:erp-contract, dnSpy evidence, 변경분 manifest/write guard 통과. 운영DB CTE SELECT-only로 수기확인 양성1/다른원천·다른근거종류·false3음성 통과. 원인코드는26bf5a555(2026-07-22)부터 있던 공통파일 우선순위이며2026-10-26/28 혼합저장 감사로 실제오염 확인. build/CI/배포는 진행중.

로컬 production build 통과. PR1346 CI 진행. 이전현재정정계획 문서 상단에 철회 고지, 감사조회도 수기확인 이력을 존중하도록 정합성 보완.

## 2026-10-28 PR1348 CI 보완
- PR1348 첫 CI에서 `importPackingHardening.test.js` harness가 새 `packingReceiptPreparation` 모듈을 mock registry에 등록하지 않아 한 테스트가 실패함. 앱 로직 실패가 아닌 테스트 harness import 누락으로 확인, helper를 harness에 등록해 수정.
- 검색어: PR1348 CI packingPreparationBlockReason importPackingHardening harness dependency

## 2026-10-28 호텔 차별수량/원본 행정렬
- 저장자료1~4차 및 총수량 우측표, 셀수정/원본 hover비교. 반복출처 제거, 원본 경계선 행정렬과 수동조정. ERP SQL/API 불변.
- 단위11개/Chrome 행좌표·수정·원본보존 검증. 필수검사·배포 진행, 실제주문 미검증.
- 검색어: HotelQuantityMatrix HotelMatchReview 1차 총수량 원본 줄정렬
## 2026-10-28 다음차수 차단 유지
비고재저장으로 SOURCE_FACT_REVIEW 차단이 풀리는 경로 보완. 감사이력의 차단도 조회하며 뒤의 원문재검토만 해제.43/44/45/53차 목록·preflight·preview·최종등록의 잘못된클라이언트플래그 반례와 쓰기0 검증.수기확인·원장·견적은 보존. 검색어: 다음차수 factHistory laterFact SOURCE_FACT_REVIEW

## 2026-10-29 도착원가 독립 작업대
- 도착원가 메뉴 기본 진입을 기존 입고 조회로 분리. 새 인보이스 원가도 같은 메뉴 내부 처리, 입고 업로드와 초안 저장소를 분리하여 재업로드/재매칭 왕복 제거.
- 실제 Nenova Desktop에서 기존 44-01 호주 입고 #7863 조회 확인. 관세율 기본값 누락 발견 후 승인된 호주 품목별 기본값을 읽기 전용 계산에 연결.
- 격리 웹화면에서 실제 입고 SELECT 복사자료 11행으로 조회→AUD/항공/GW·CW805→시험환율950→미리보기→엑셀 다운로드 완료. Green/Red 매칭 유지, Red 저장총액5100 유지. 다운로드 3시트 및 계산 수식 확인; 합계23967723.5원(시험값, 승인원가 아님).
- production build/packing-team/native-cost 테스트 통과. 운영 DB 쓰기 없음. PR CI/배포 및 배포 후 설치 웹앱 다운로드는 이 기록 시점 미검증, 완료 후 추가 기록.
- 검색어: IndependentCostWorkspace cost draft native-cost AU 44-01 7863 tariffDefaults 재업로드 재매칭 분리
## 2026-10-29 거래처관리대장 검색/담당자 및 미반영 입금 비교
- 실제 /ecount/customer-ledger에 업체/담당자 검색, 담당자 토글, 업체명 옆 담당자 표시. 서버의 담당자 범위/SS3 전체조회 유지.
- E010205 입금의 회계반영 이력 정확 패턴과 코드로 연결, 미반영 전후/대장 수금합계 대조. 중복식별/이미반영/수금합계불일치/코드충돌/자체이체/수집실패 보류. 같은 대장 snapshot에만 계산근거 저장하며 누적차감하지 않음. 원문 계좌/입금자는 저장하지 않음.
- dnSpy ClassCustomer와 SELECT-only probe(활성675/유일담당125), 실제 UI13열/전월/빈입금/회계반영 숫자footer 확인. 관련38테스트, 전체ERP계약, dnSpy/manifest/write guard 통과. 빌드/CI/운영배포 및 원본PC 적용은 이 기록 시점 진행중(미검증). 실제 미반영 입금 양성 사례는 원본에 없어 fixture로 검증.
- 검색어: customer-ledger managerName pending-receipts BANK_CHANGED ACCOUNTING_RECONCILIATION 중복차감 미반영입금
## 2026-10-29 호텔 원본 연결선·여백
- 다중표 OCR sourceBox 추가,hover/focus 연결선·원본강조,기존자료 명시원본클릭 위치수정.행30/컨트롤26px.수량/ERP쓰기 불변.
- 단위/API14개·Chrome 우측표연결 및좌표수정후 수량보존 확인.실업무OCR·주문등록 미검증.배포후추가.
- 검색어: 호텔 sourceBox 연결선 다중표 여백


### 2026-10-29 좌우 표 분리 비교
- 원본 행 좌표의 가로 영역으로 2~4개 표를 구분하고 각 표 이미지와 해당 매칭 행을 나란히 표시. 이미지 바깥 공백을 잘라내고 패널 간격 8px, 이미지-매칭 간격 4px, 행 높이 30px/입력 높이 26px 적용.
- 좌표가 없는 기존 자료는 전체 원본 비교와 위치 지정 기능 유지. 좌표 변환은 표시 전용이며 수량/업체/ERP 원장 변경 없음.
- 검색어: 호텔 좌우 표 이미지 분리 매칭 여백 hotelSourcePanels

- 검증 완료: 실제 parse API/좌우 분리 포함 15개 테스트, 전체 ERP 계약, dnSpy, manifest, write guard, build 통과. PR #1353 CI 40795078246 성공, squash d002020acbc1e62d2d1c2f5be74cec1953cf1fde. Cafe24 40795499275 배포 대기(운영 스모크 미검증).

- Cafe24 배포 40795499275 attempt 2 성공: 최초 Chrome 시작 timeout 후 재검사·빌드·서버 전송·hydration smoke 전부 통과. 운영 수동 두 표 이미지 검증 진행.

- 2026-10-29 운영 OCR 검증 보완: 위치 좌표가 원본 행보다 짧거나 위로 치우치면 세로 crop이 품목을 숨기는 문제 확인. 표별 가로 분리는 유지하고 원본 세로 범위는 전체 보존. 검색어: 호텔 원본 세로 잘림 crop safety
- 추가: SS3은 담당자 배정/식별 검증된 업체 최신화 요청 가능, 일반직원 범위 불변. 확인보류 입금이 있으면 부분 계산잔액도 숫자로 제시하지 않는다. 소스 상하단 복수 페이지컨트롤은 첫 표시 컨트롤로 한정했다.

## 2026-10-29 입금 수집 후속 보완
- PR1355/727d2ba2 배포40796947094 성공. 운영검색 미정→미정화훼유통·정재훈, 담당자 버튼 교차필터,SS3 최신화요청 확인. 수집PC3파일백업교체/재시작/로그인복구 확인. 실제최신화채권성공,은행비교실패로보류되어 후속수정.
- ECOUNT 폭에 따른 기간단축버튼 숨김 확인,연월일 위젯 직접입력 공통helper로 교체. 빈입금처는 공통매칭패턴으로 학습하지않음. 운영후속수집은 아직 미검증.
- 검색어: bank history unavailable setReportPeriod dropdown-menu-selectbox responsive shortcuts
### 2026-10-29 주차별 수익률 원천 검증 표시
- DB 변경 없이 본표 저장 참고값/검증보류 라벨과 명시적 SQL 원천 검증 추가. 산술 일치만으로 환율·통관비·재고 평가를 인증하지 않음.
- 38차 카네이션 입고 단수/현재환산195단 충돌,39차 순양수 재고조정2059.05단 및 중국중량·미국운임 누락 확인. 실제 첨부 원본은 다른PC 경로로 미확인.
- 신규 회귀·전체 ERP 계약·webpack 빌드·격리 Chrome 컴포넌트 검증 통과. 최신master 병합후 최종검증/CI/배포 진행. 운영 로그인 브라우저는 도구 초기화 오류로 미검증.
- 검색어: profit-validation-gate 수익률 검증보류 38차195단 39차2059.05단 SQL입고원장

## 2026-10-29 네덜란드52차 연도
- DB확인:37-2 NL 파일의 연도근거없는52-2 54행이2026 현재본. 공통파서에서 파일차수보다 뒤인 미확인연도 시트 차단,2025/2026 회귀통과. dnSpy/manifest/write guard 통과.
- 원본연도 미확인이라2025 재배정 금지. 코드배포후 정확54행 IsCurrent-only 감사격리 스크립트 준비. 전체테스트/빌드/CI/배포/운영격리 미검증(진행중).
- 검색어: 도착원가 네덜란드 52-2 Import23 37-2 연도미확인 rolloverUnproven

- 2026-10-29 범위 보완: 동일 Import23의47-1(73),48-1(66),49-1(66),50-1(15),50-2(51),51-1(7),51-2(50),52-2(54), 총382행 모두 연도근거/수동수정이력0. 같은원인의 미확인 연말범위 전체를 격리 대상으로 확정(위54행 한정계획 대체).1~37차 및 다른Import/연도/국가는 보존. 아직 실행 전.

## 2026-10-29 카네이션 엑셀 분배 적용 멈춤
- 44-01 카네이션381행 Audit135/136 시작상태와09:59/10:14 배포reload 중첩 확인. 현재DB 실행요청0. 특정 업로드 rollback 여부는 미확정, 운영원장/이력보정 없음.
- applyImportRows 전체 공유flock, 배포gate+exclusive drain(20분 timeout시 배포중단), 진행정보소실/네트워크대기 제한. EXE CLI 확인, 원장SQL/환산/기존주문보존 불변.
- 업로드회귀/dnSpy/manifest/write guard 통과. 전체검사/빌드는 기존공유node_modules 누락으로 독립의존성 설치후 재검증중. Linux 실제flock·CI·배포·실브라우저는 아직 미검증.
- 검색어: 카네이션 381행 Audit135 Audit136 IMPORT_DEPLOY_BUSY IMPORT_PROGRESS_LOST flock deploy drain

## 2026-10-29 송이 기준 웹 원가 전수 검증 — 진행 중
- DB 쓰기·기존 보고서 계산/확정본 갱신 없이 실제 원행 송이와 WdetailKey별 도착원가 금액으로 새 비교 엔진을 검증했다. 표시 단·박스와 계산 송이를 분리하며 현재 Product 계수로 과거 단위를 역산하지 않는다.
- SELECT-only 확정 출고43,253행/104세부차수/14.174초(105조회), 입고22,786행 및 실제 재고·조정 원천. 1~43차+진행44차 실행 후 독립 WAC/기말액 산술위반0. 무활동0재고는 양수원가 성공과 별도 집계.
- 38/39 실제 통합조회에서 품목 도착원가합계와 본표G+H 배분 범위 차이를 발견해 K를 보류. 산술검사 통과를 전체 수익률 정상으로 설명하지 않는다. 원가 원천 보완·최종 재검증/CI/배포는 미완료.
- 1차는 전년도 기초원가 근거 미지원,8차는7차 이월/현재마스터 환율뿐이라 보류. 자세한 수치와 엑셀26~31 비교는 `docs/work-sessions/2026-10-29_profit-stem-independent-audit.md`.
- 검색어: 송이기준 원가 stemCostLines 43253 Master키300 38·39 G+H 비용대사 8차환율


## 2026-10-29 호텔 원본·매칭 같은 가로줄
- 원본 표 경계선을 패널별로 검출해 첫 행 위치/최소30px 행 높이를 이미지와 매칭표에 공통 적용. 표별 수동 줄 조정은 기존 서버 초안 alignment.panels에 보관. 제목/노란 배경/연한 빈 격자/행 개수 불일치 방어. ERP/API 쓰기 변경 없음.
- 22행/14행 서로 다른 제목 높이 합성 이미지 실제 컴포넌트에서 1920px/800px 정렬·수량 격리·Tab/Shift+Tab 확인. 16개 단위/API 회귀 통과. 전체 검사/빌드/CI/배포는 진행 중(미검증).
- 검색어: 호텔 같은 줄 행 정렬 hotelImageRowBounds alignment.panels
## 2026-10-29 관리대장 담당자·업체 버튼 선택
- 담당자 전체/개별 및 업체를 aria-pressed 버튼으로 변경. 담당자 변경시 업체선택/상세 초기화, 업체 재클릭 해제, 연결불가 disabled. 검색과 기존 권한 유지.
- 방향키/Home/End 초점 이동, Enter/Space 선택. UI만 변경하며 API/SQL/ECOUNT/공유 원장 보존. 기존 교차연도 fixture 유지.
- 검증/배포 진행 중. 추가 요청의 부호는 입금-판매(초과+,미수-), 차수귀속 기준은 사용자 확인 대기.
- 검색어: customer-ledger 담당자 업체 버튼 aria-pressed signed balance

- 추가 결정: 입금일 기준 차수 비교, 입금−판매(초과+,미수−). PeriodDay read-only 및 dnSpy CommonLogic 근거 확인. 달력31일/유일31/202639~44. 검증 반영입금+미반영deduct−ECOUNT판매, 이월 제외/부분차수 표시. 관련33테스트 통과, 통합검증/배포 진행중.

## 2026-10-29 카네이션 완료 후12분 결과확인 경고
- SELECT-only Audit137:2026/44-01,10:53:24 시작→11:05:53 SUCCESS(12분29초),381중324반영/57동일,사후381MATCHED/불일치0,스냅샷648. 재적용 불필요.
- UI 총12분 제한을 진행정보updatedAt 미갱신12분 기준으로 변경. 실제진행만 대기연장,같은/역행/잘못된timestamp와정보소실은 연장하지않음. POST재전송/원장SQL변경없음.
- 13분지속후성공·정체·역행·잘못된timestamp 회귀7개통과. 전체검사/빌드/CI/배포는 진행중(미검증). 검색어: Audit137 381 324 57 12분29초 idle timeout updatedAt

## 2026-10-29 송이 기준 원가 최종 독립 읽기 검증
- 사용자 확정: 기존 실제중량/AWB 비용 배분 유지, 송이당 환산만 변경. 본표 총액에 맞춘 송이비례 재배분·금액 보정 금지. DB 쓰기0.
- 최신90세부차수 비용 원행 재수집2431SELECT/41.353초/오류0. 캡처한 물량으로1~43+진행44차 재실행, 독립 WAC·기말평가·수량대사 산술 위반0.
- 양수원가4266 차수·품목 조합 모두 추정 포함. 무활동0원123750, 원가보류10612. 본표 비용과 AWB 비용 풀 차이/역사원가 누락이 해결된 것은 아님.
- 최종38차36.857초·39차31.928초, 전체수익률 보류. 기존 대사차이는 금액을 억지로 맞추지 않고 표시. 상세 `docs/work-sessions/2026-10-29_profit-stem-independent-audit.md`; 원천 `.verify/`는 커밋 제외. CI·배포 결과는 부모 작업에서 확인 중(미검증).
- 검색어: stem v3 2431 4266 DEFAULT_CUSTOMS gw_auto AWB 송이 평균원가 no_activity


## 2026-10-29 카톡방 재고관리
- 페이지 전용 재고장/원문 분석/직접입력/시작재고 정정/카톡 복사 구현. UserFavorite 별도 저장본, ERP 원장 변경 없음.
- 예시·0·취소초과·단위·교차연도 테스트와 메뉴/write guard 통과. 전체검사/빌드/브라우저/배포 진행 중(미검증).
- 검색어: 카톡방 재고관리 kakao-stock-ledger 시작재고 업체수량 변경내역

- 검증 완료: 전체 test:erp-contract, dnSpy, manifest, ERP write guard, UI layout, webpack build 통과. Chrome 1920/390에서 예시 계산·복사·저장재열기·Enter/Escape·정정·시작재고 수정 통과, ERP 쓰기 요청 0. PR/배포는 후속 진행.

## 2026-10-29 이전 초안 위치 복구
- 동일 계정/연도/차수/원본이미지 후보 중 원본품목명+원본수량 유일일치 위치만 복구. 기존 edited qty/unit/prodKey/배분/로그 보존. 실패/중복/충돌/잠금은 적용 안 함. 별도 원본 위치 다시 읽기 제공. 위치만 기존 서버CAS로 보관. 26개 회귀 통과, 전체검사/배포/실자료확인 진행 중.
- 검색어: 호텔 이전초안 위치복구 recoverHotelSourceRows 동일이미지
