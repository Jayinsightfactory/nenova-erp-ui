# 패킹 매칭 → 입고 업로드 연결 · 2026-10-14

## 사용자 합의와 완료 기준
- 후보 품목 선택 즉시 기존 팀 공용 CAS 매칭 저장. 성공 후 닫고 실패/409는 창과 원문 유지.
- 매칭이 모두 끝나면 입고 업로드 준비 버튼을 표시. 새 파일 작업 중 저장 문서 조회를 다음 단계로 보여주지 않는다.
- 완료된 매칭표를 유지하고 전체 품목을 확인 가능하게 한다. 팀 매칭은 다음 업로드에서 재사용한다.
- 현재 파일/추출/적용한 검토는 로그인 계정별 브라우저 작업 초안으로 복구한다. 서버 공용 매칭과 로컬 작업 보관을 구분한다.
- 매칭 완료는 수량·가격·원문 검증이나 실제 입고 완료가 아니다. 기존 원문 검토 → 생성 → 입고 초안/서버 검증/명시 승인 유지.

## 기준 ledger / 부작용
| 동작 | 기준과 소비자 | 웹 자료 | Product / Order / Shipment / Warehouse / Stock / Estimate / WebProfitReport |
|---|---|---|---|
| 후보 선택 | 기존 product-matches 국가/활성품목/CAS revision | 기존 공용 매칭만 저장 | 모두 보존 |
| 매칭 갱신 | packingMatchReview와 buildPackingMatchPreview, 최신 ERP목록 | 미리보기 재계산, 생성 바이트 무효화, 적용한 원문 검토 보존 | 모두 보존 |
| 작업 복구 | SSR userId + IndexedDB schema/file/source; 최신 ERP/공용매칭 재조회 | 계정별 로컬 초안만 읽기/쓰기 | 모두 보존 |
| 입고 업로드 준비 | 매칭 누락0 + 명시 사용자 클릭; 필수 원문/중량/통화 검토 유지 | 생성 및 어댑터만 실행 | 모두 보존 |
| 실제 입고 승인 | 기존 workbench/server preview/commit 및 연도+세부차수 | 기존 문서·감사 계약 유지 | 기존 invoice-receipt-connected 계약 그대로, SQL 변경 없음 |

복구로 서버 revision, preflight digest, commit 허가를 만들지 않는다. 유료 분석/ERP 저장 자동 호출 없음.
원문/수량/가격 변경은 기존 원문 검토 무효화 규칙을 유지한다. 0/null을 대체하지 않는다.
공용 매칭을 바꾸는 것만으로 이미 적용한 원문 검토를 다시 미확인으로 만들지 않는다.

## 근거 및 검증
메인에서 guard 스킬, AGENTS, 메뉴 기본값, orchestration, DB_STRUCTURE와 FormWarehouseUpload 읽음.
실제 저장 decompile ExcelLoadingPackingList.MakeTempTable/CheckData/InsertMaster: ProdName+SIZE 정확연결, 독립 수량과 가격, 검토와 저장 분리 재확인.
ERP writer/SP/API 변경 없음. 기존 2025/2026 동일 세부차수 fixture 유지.
1920×1080/100% 및 작은 화면, 후보 Enter/Space/방향키/Escape, 실패/409/연속클릭, 새로고침 복원, 매칭 후 CTA, 원문 미확인 차단, 실제 저장 자동 호출0을 검사한다.

모델: 메인 통합/배포, gpt-5.6-sol 설계·최종 검토, gpt-5.6-terra 후보 UI와 로컬초안 독립 구현. 하위작업 P0_LOCAL만 허용.
