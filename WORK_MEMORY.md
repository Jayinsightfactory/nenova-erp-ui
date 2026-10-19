# 작업 기록

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
