# 국가별 인보이스 독립 단계 자동 진행

## 요구와 완료 기준

기존 8개 국가(NL/CN/CO/EC/TH/AU/US/VN) 변환기를 유지한다. 변환 결과를 한 번에 성공으로 처리하지 않고 문서별 독립 단계로 검증한다. 변환 지원과 원가식 지원을 혼동하지 않는다. 자동 진행은 화면에서 사용자가 시작한 현재 문서의 검증 가능한 단계만 순차 실행하며 브라우저 종료 후 무인 서버 작업을 의미하지 않는다.

단계: 국가별 변환 → 초안 저장 → 서버 품목·수량 검증 → 입고 확인 대기 → ERP 입고 등록 → 등록 결과 재조회 → 원가 계산·검증 → 원가 승인 대기 → 원가 저장 → 원가 재조회.

## 기준 ledger

| 기준 | 원천 | 적용 |
|---|---|---|
| 국가 변환 | 기존 importPacking의 8개 generator | 변환 로직 복제/수식 변경 금지, 원본/변환 결과 보존 |
| 문서 범위 | documentId + sourceHash + revision + OrderYear/OrderWeek | 문서별 상태, 다른 문서 결과 혼입 금지 |
| 초안 | 기존 documents API | save 성공 응답의 revision으로 다음 preview, 실패 시 중단 |
| 사전검증 | 기존 preview.canCommit + sourceWarnings | false/누락/오류는 자동 다음 단계 금지 |
| 입고 | 기존 commit/operation API | 명시 사유·확인 유지, unknown은 같은 operation만 복구 |
| 재조회 | 서버 document.operations의 현재 revision COMMITTED + WarehouseKey | 확인 안 되면 원가로 넘어가지 않고 조회만 재시도 |
| 원가 | 기존 검증된 invoiceReceiptCost 공식 | 적용 국가·운송 및 모든 필수 입력 확인. 미지원은 검토 필요 |
| 완료 | 별도 원가 저장 후 기존 invoice-costs GET | 실제 승인 currentActual 확인 전 전체 완료 표시 금지 |

## 부작용/오류 경계

| 작업 | WebInvoice 문서·이력 | Warehouse/Stock | Order/Shipment/Estimate/매출 |
|---|---|---|---|
| 변환/단계 표시/원가 미리보기 | 보존 | 보존 | 보존 |
| 초안 저장 | 기존 API revision 저장 | 보존 | 보존 |
| 서버 검증/재조회 | 읽기만 | 읽기만 | 보존 |
| 명시 입고 확인 | 기존 operation 이력 | 기존 원자 writer만 호출 | 보존 |
| 명시 원가 승인 | 기존 cost revision/이력 | 읽기만 | 보존 |

원가 실패는 입고 실패가 아니다. 성공 입고를 재등록하거나 자동 취소하지 않는다. 초안 저장/사전검증/ERP 등록/재조회 실패를 각각 구분하고 중단한다. 원가 자동 계산은 승인 저장과 구분한다. EXE/SP/DB 스키마는 변경하지 않는다. 브라우저 재접속 시 서버 문서/operation을 다시 읽고 검증하며 실행 중 상태를 성공으로 복원하지 않는다.

## 검증

국가별 변환 연결, 저장 실패 후 preview 미실행, canCommit=false 차단, 다른 문서/연도/revision 응답 차단, 중복 시작 방지, 등록 완료 문서 자동 재등록 금지, unknown operation 차단, 입고 재조회 실패 후 조회만 재시도, 원가 실패 후 입고 보존, 미지원 원가식 표시. 기존 실제 SQL writer 회귀 및 전체 ERP gates 유지. 화면 기준1920×1080/100%, 작은 화면1280×800.

근거: 현재 decompile ExcelLoadingPackingList.MakeTempTable/InsertMaster 재확인; 2026-10-08 실제 native SQL/운영 조회·격리 SQL 근거 및 invoice-receipt-connected 계약 재사용. 새 ERP 쓰기 경로 없음.
