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
