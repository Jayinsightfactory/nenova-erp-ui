# 2026-09-29 영업수입불량 등록 흐름과 트랜잭션 오류

## 질문

영업지원 불량 등록 시 작업로그와 등록 내용이 별도 창/순서로 나뉘어 실제 처리 여부를 알기 어렵고, 중간에 `Transaction has not begun` 오류가 발생했다.

## 답변과 확인

- 화면 구조 확인 결과, 본창이 사전검증 팝업을 열고 그 팝업을 등록 검토 화면으로 이동시킨다. 본창은 검토창 완료 통지 전에 `supportRegistering`을 해제해 재실행이 가능했고, 검토 화면에는 별도 작업 로그와 결과가 있다.
- 견적서관리 추가 창은 검증 완료 후 사용자가 누르는 선택 기능이며 자동 저장/실행 경로가 아니다.
- `registerDeductions`는 `withTransaction` 내부에서 `Estimate`, 불량 원장 및 작업 이력을 다루며 주문·출고·재고는 보존한다. 현재 제시된 오류 문구만으로는 begin/쿼리/commit 중 어느 시점인지 또는 SQL 원인인지 단정할 서버 stack/log 증거가 없었다.
- 본창은 검토창의 최종 완료/실패 통지까지 처리 중 상태를 유지한다. 검토창이 먼저 닫히면 등록 POST를 재실행하지 않고 지원 목록을 재조회한다.
- 등록 API 응답과 검토창 로그에 안전한 작업 단계(begin, 대상/중복 검증, Estimate 등록·수정, 원장/이력, commit) 및 mssql 오류 코드가 전달된다. 드라이버 오류 코드는 500으로 분류한다.
- 운영 등록/DB 쓰기 재현은 하지 않았다. 이 변경 자체도 Shipment/Stock/Order 원장을 수정하지 않는다.

## 검증 / 남은 확인

- `salesDefectDeductions`, `salesDefectDeductionState`, ERP manifest 관련 테스트 통과.
- `npm run verify:erp-change` 성공: ERP contract, dnSpy evidence, 변경 manifest/write-scope, production build 통과.
- 실제 발생 원인을 확정하려면 다음 재현/로그에서 추가된 `operationStage`와 `errorCode`를 확인해야 한다. 이번 작업은 추적을 가능하게 했으며, 과거 오류의 DB stack을 소급 복원하거나 근본 원인을 확인했다고 주장하지 않는다.
- 배포 이후 실브라우저 등록은 실제 불량/견적 데이터 쓰기이므로 smoke에서 수행하지 않는다. 사용자의 실제 업무 실행 시 로그와 서버 결과로 확인한다.
