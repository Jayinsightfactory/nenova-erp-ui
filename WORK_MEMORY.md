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
