# 과거 자동 불량 자료의 일반 등록 차단

## 사용자 요청과 권한
같은 경로로 잘못 등록된 후보 전수 조회, 재발 방지 수정과 배포. 기존 운영 차감의 삭제·보정은 목록을 먼저 보여준 뒤 별도 승인까지 금지한다.

## 사전 근거
- 기준 master b7121cfe. 메인이 실제 설치 EXE를 dnSpy Console `--no-color -t ClassEstimate`로 재확인했다(2026-10-13).
- ClassEstimate.Insert/Update/Delete는 Estimate만 변경한다. 웹 자동 수집 원장은 EXE에 없는 웹 전용 경로다.
- 운영 SELECT: 초원 자동 원장726(원차수40, 로즈우드30),729(원차수40, 블루15)가 10월13일 영업지원 REGISTER_ESTIMATE에서 41차 Estimate10128/10131로 생성됐다. 수입확인은 false였다.
- 자연플라워 자동 원장651/665(40차 저장, 카톡 원문37-1/38-1, 문라이트15/30)가 같은날 41차 Estimate10106/10117로 등록됐다.
- SourceFileName은 kakao-defect: 접두어, Note에 원문차수/자동처리 표식이 있다. CREATE 감사 계정과 CreatedBy의 담당자 귀속은 서로 다르므로 수동 입력자를 추정하지 않는다.
- includeCarryover가 과거 미등록 원장을 포함하고 ImportConfirmed는 기존 계약상 등록 차단 조건이 아니다. 정상 수동 이월의 이 정책은 보존한다.

## 제안 기준 (설계 검토 후 확정)
과거 자동자료를 일반 일괄 등록에서 격리한다. 원천 표식은 DB 잠금 행/생성 이력을 신뢰하며 클라이언트가 보낸 note/source로 해제할 수 없어야 한다. 현재 차수로 이동된 자동자료도 옛 자료일 수 있으므로 날짜 비교만으로 허용하지 않는다. 화면/미리보기/사전검증/최종 저장에서 동일한 판정을 사용한다. 원문과 완료 이력은 숨기거나 삭제하지 않고 등록 제외 이유를 보여준다.

## 부작용 표
|동작|웹 원장/이력|Estimate|Order/Shipment/Date/Farm/Stock/WebProfitReport|
|---|---|---|---|
|전수 감사 및 후보 조회|SELECT only|SELECT only|보존|
|자동 원천 등록 차단|보존(기존 작업 로그 제외)|보존|보존|
|정상 수동 등록|기존 계약 유지|기존 INSERT/UPDATE 계약 유지|보존|
|과거 자료 보정|이번 작업 금지|이번 작업 금지|보존|

## 필수 검증
정상 수동/정상 수동 이월 positive, 자동 원천 동일차수·과거차수·전년도·소스 위조·note 수정·수입확인 true·이미 연결된 Estimate near-miss. UI 표시와 서버 재검증 일치, 차단 경로 ERP 쓰기0, 기존 정상 부분등록/멱등성 보존. 필수 ERP gates와 build, 1920x1080/100% 브라우저 확인 후 배포.

## 하위 작업 사전 준비
깨끗한 독립 worktree와 기존 검증용 node_modules junction 준비. 하위 작업은 P0_LOCAL만 사용한다. 비밀값 접근·운영 쓰기·push·PR·배포 금지. 실제 운영 전수 SELECT는 메인이 담당한다.

## 운영 전수 결과와 판정 기준
- 2026-10-13 읽기 전용 전수 조회 결과는 전체 원장 881건/이력 2,721건 중 현재행 또는 과거 이력에서 자동 원천이 확인된 원장 135건, 그중 현재 `Estimate`가 남은 행 91건/29업체다. 운영 원문이 든 `outputs/defect-audit-2026-10-13/`은 로컬 증거이며 커밋·외부 공개하지 않는다.
- 91건 중 41차 적용은 78건, 38~40차 적용은 13건이다. 등록 당시 `ImportConfirmed=false` 65건, `true` 26건이므로 수입확인은 자동 원천을 해제하거나 정상 등록으로 승격하는 근거가 아니다.
- 자동 원천의 canonical marker는 대소문자를 무시한 정확 접두어 `kakao-defect:`다. 판정은 서버가 다시 읽은 현재 `WebSalesDefectDeduction.SourceFileName`/`Note` 또는 같은 `DeductionKey`의 `WebSalesDefectDeductionHistory.BeforeJson`/`AfterJson` 안 `sourceFileName`/`note` 중 하나가 이 접두어로 시작하는지로 한다.
- 재실행한 감사 스크립트의 명시 집계는 현재행의 `SourceFileName OR Note`에서 판정된 134건과 과거 이력에서만 복원된 1건, 합계 135건이다. 따라서 현재행만 보는 구현도 실제 자동 원천 1건을 놓친다. `자동처리` 일반 문자열, CreatedBy/CreatedByName, CREATE 변경 계정, 등록 계정, 담당자, 날짜, 원차수와 대상차수 비교는 원천 판정에 쓰지 않는다.
- 이 판정은 sticky다. 현재행의 Note/SourceFileName이 비어 있거나 일반값으로 바뀌고, 차수가 정정되고, 수입부 확인이 켜지고, 현재 차수로 이월돼도 과거 이력에서 marker가 한 번 확인되면 일반 일괄등록 대상으로 돌아오지 않는다. 반대로 marker가 전혀 없는 정상 수동 입력과 기존 `IsCarryoverLedger=1` 수동 이월은 기존 계약을 유지한다.

## 확정 최소 설계

### 1. 공통 원천 정책
- `lib/salesDefectDeductionCore.js`에 순수 판정과 안정된 결과 코드/문구를 둔다. 예: `AUTO_SOURCE_REVIEW_REQUIRED`, `자동수집 자료 · 별도 검토 필요 · 일괄등록 제외`. 클라이언트 payload의 `sourceFileName`/`note`는 등록 허용 판정에 사용하지 않는다.
- `lib/salesDefectDeductions.js`에는 현재행과 이력을 함께 검사하는 공통 SQL predicate/projection 한 개를 둔다. 목록, 지원 상태 계산, preflight, registration preview, 최종 등록이 같은 predicate를 호출해야 한다. 별도 SQL을 복제해야 한다면 predicate 구성요소 동일성을 실행형 테스트로 비교한다.
- 구현 권장형은 alias 허용목록을 가진 `buildAutoDefectSourcePredicate('d')`다. 현재행은 `LOWER(LTRIM(ISNULL(d.SourceFileName,N''))) LIKE N'kakao-defect:%'` 또는 같은 Note 조건, 이력은 `EXISTS (SELECT 1 FROM WebSalesDefectDeductionHistory h WHERE h.DeductionKey=d.DeductionKey AND ...)`로 묶는다. 이력 JSON은 아래처럼 invalid JSON을 빈 객체로 바꾼 뒤 camelCase/DB-case 양쪽을 읽는다. 단순 `History.ActionType='CREATE'` 한 건만 보지 말고 모든 Before/After snapshot을 검사한다.

```sql
JSON_VALUE(CASE WHEN ISJSON(h.BeforeJson)=1 THEN h.BeforeJson ELSE N'{}' END, '$.note')
JSON_VALUE(CASE WHEN ISJSON(h.BeforeJson)=1 THEN h.BeforeJson ELSE N'{}' END, '$.Note')
JSON_VALUE(CASE WHEN ISJSON(h.AfterJson)=1 THEN h.AfterJson ELSE N'{}' END, '$.sourceFileName')
JSON_VALUE(CASE WHEN ISJSON(h.AfterJson)=1 THEN h.AfterJson ELSE N'{}' END, '$.SourceFileName')
```

  각 값은 `LOWER(LTRIM(ISNULL(value,N''))) LIKE N'kakao-defect:%'`로 비교하고 Before/After의 note/sourceFileName 네 조합을 모두 포함한다. `LIKE '%kakao-defect:%'`처럼 중간 문자열까지 잡아 정상 메모를 오분류하지 않는다.
- `snapshot()`은 `sourceFileName`, `autoSourceExcluded`, `autoSourceEvidence`를 반환한다. 이후 CREATE/UPDATE 이력에도 source marker와 판정 근거가 남게 한다. 응답에는 카톡 원문 전체나 내부 식별자를 새로 노출하지 않고 `KAKAO_SOURCE`/`HISTORY_SOURCE` 같은 최소 사유만 노출한다.
- 기존 행 일반 저장에서 `SourceFileName`은 불변으로 보존한다. 현재 `saveDraftRows`의 `UPDATE ... SourceFileName=@file`은 제거하고 INSERT에서만 원천을 기록한다. Note는 업무상 수정 가능하지만, 과거 history marker 때문에 자동 판정은 해제되지 않는다.

### 2. 네 단계 동일 판정과 쓰기 직전 잠금 재검증
- 목록: 자동 원천행은 `registrationEligible=false`, `registrationEligibilityCode=AUTO_SOURCE_REVIEW_REQUIRED`로 반환한다. 출고·단가·수입확인 판정보다 자동 원천 제외를 먼저 적용한다.
- preflight와 registration preview: 요청행의 note/source를 무시하고 DeductionKey로 DB 원장과 history를 다시 조회한다. 자동 원천은 행별 오류로 제외하며 다른 정상행의 검토를 막지 않는다.
- `registerDeductions`: 첫 planning read와 Estimate INSERT/UPDATE 직전 `UPDLOCK,HOLDLOCK` 재조회에서 모두 같은 guard를 실행한다. 두 번째 guard를 통과하기 전에는 REVIEW_UPDATE, Estimate, Application, 원장 상태, History 어느 것도 쓰지 않는다. 자동 원천과 정상행이 섞인 묶음은 자동행만 `skipped` 처리하고 정상행은 기존 독립 처리/멱등 계약대로 계속한다.
- source/history SQL 조회 자체가 실패하면 등록을 허용하지 않는다. 개별 이력 JSON이 잘못된 경우에는 해당 snapshot만 무시하고 다른 현재행·이력 근거를 계속 검사한다. `ImportConfirmed`, `ImportReviewRequired`, 같은 차수 여부, 수동단가 존재는 자동 원천 제외보다 우선할 수 없다.

### 3. 기등록 UPDATE 우회 차단
- `registerDeductions`는 자동 원천에 이미 `EstimateKey`가 있어도 기존 UPDATE 분기로 들어가지 못하게 한다. `EstimateKey` 유무는 원천 guard를 우회하는 조건이 아니다.
- 일반 영업 저장의 `saveDraftRows -> syncLinkedEstimate` 경로도 기등록 자동 원천의 연결 Estimate를 갱신할 수 있다. 기존 snapshot/history로 자동 원천을 판정해 웹 원장 UPDATE 전에 거부하고 트랜잭션 전체를 롤백한다. 정상 수동 기등록행의 기존 sync 계약은 보존한다.
- 이번 변경은 기존 91개 Estimate의 UPDATE/DELETE/연결해제/원장 완료처리를 수행하지 않는다. `pages/api/estimate/update-entry.js`, `pages/api/estimate/delete-deductions.js`, 기존 generic DELETE는 자동 보정 경로로 호출하지 않는다. 운영 보정은 후보 목록 승인 뒤 별도 작업으로만 설계한다.

### 4. 목록과 기존 Estimate 충돌 표시
- 자동 원천행을 지원/이월 목록에서 조용히 숨기지 않는다. 원차수의 열린 자동행은 기존 carryover 범위에 계속 보이고, 선택 차수에 이미 적용된 자동행도 `AppliedOrderYear/AppliedOrderWeek`가 선택 차수와 같으면 별도 검토행으로 보이게 한다. 이후 차수마다 완료행 전부를 반복 노출하지는 않는다.
- 체크박스, 업체별 선택, 전체선택, 검토창 URL 생성에서 모두 자동행을 제외한다. 처리상태는 `등록 불가`만 쓰지 말고 `자동수집 자료 · 별도 검토`를 직접 표시하며, 원차수/적용차수/연결 Estimate 읽기 버튼과 감사 이력은 유지한다.
- 현재 `loadExistingEstimateDeductions`는 동일 업체·품목·절대수량·단위 Estimate를 찾으면 정상 수동 원장까지 `COMPLETED_EXISTING`으로 표시할 수 있다. 기존 Estimate가 자동 원천 원장에 연결됐는지 함께 반환한다. 자동 연결 Estimate와 충돌하는 정상행은 처리완료로 승격하지 않고 `AUTO_SOURCE_ESTIMATE_CONFLICT`로 표시·등록 차단한다. 보정 전 중복 Estimate를 새로 만들지도, 자동행을 정상행에 연결하지도 않는다.
- 자동 원천행에서는 수동단가 입력과 `수동처리완료` 선택도 비활성화하고 서버에서 재검증한다. 이 두 동작으로 별도 검토행을 일반 완료/등록 흐름에 숨길 수 없어야 한다.

## 수용 기준과 회귀 fixture

### Positive — 반드시 기존 동작 유지
1. marker가 없는 현재차수 수동 입력은 `ImportConfirmed=false/true` 모두 출고·단가·중복·잔여 계약을 통과하면 등록된다.
2. marker가 없는 과거차수 및 전년도 `IsCarryoverLedger=1` 수동 이월은 대상 차수 판매행이 생겼을 때 부분등록, requestKey 멱등성, 잔여수량 갱신이 그대로 동작한다.
3. 정상 기등록 수동행 수정은 기존 `syncLinkedEstimate` 계약을 유지한다.

### Near-miss — 모두 차단하며 ERP 쓰기 0
1. 현재행 SourceFileName이 `kakao-defect:`인 동일차수/과거차수/전년도 행.
2. 현재 source/note는 일반값이지만 CREATE 또는 후속 history Before/After JSON의 note/sourceFileName에 marker가 남은 행.
3. 요청 payload가 source/note를 빈 값이나 일반 파일명으로 위조한 행, 저장 후 원차수/대상차수가 같아진 행.
4. `ImportConfirmed=true`, `ImportConfirmed=false`, `ImportReviewRequired=true`, 수동단가 존재 각각의 자동 원천행.
5. 이미 EstimateKey가 연결된 자동 원천을 register 재호출하거나 영업 저장으로 품목/수량/단가를 바꾸려는 행. `Estimate`, `WebSalesCarryoverApplication`, `WebSalesDefectDeduction`, History 쓰기가 모두 0이어야 한다.
6. 자동 연결 Estimate와 동일한 정상 수동행. `COMPLETED_EXISTING`이 아니라 `AUTO_SOURCE_ESTIMATE_CONFLICT`이며 중복 INSERT도 0이다.
7. 자동/정상 혼합 batch. 자동행은 skipped, 정상행만 commit되고 응답 건수·재조회 검증은 정상행 기준이다.

### 실행 검증
- `__tests__/salesDefectDeductions.test.js` 또는 전용 정책 테스트에서 순수 marker 판정, history-only 판정, SourceFileName 불변 UPDATE, 목록/preflight/preview/register 동일 결과, linked UPDATE 0, 정상 수동/수동 이월 positive를 실행한다. source 문자열 존재만 검사하는 테스트로 대신하지 않는다.
- `__tests__/salesDefectDeductionState.test.js`에서 선택/전체선택/수동처리완료/수동단가 및 자동 Estimate 충돌 상태를 검증한다. 검토창 직접 URL에 자동 key를 넣어도 GET preview와 POST register가 모두 차단돼야 한다.
- 계약 `docs/contracts/sales-defect-deduction.json`에 자동 원천 격리 action, 결과 코드, current+history provenance, 정상 수동 이월 보존, 기등록 UPDATE 금지, 부작용 표와 위 fixture를 추가한다.
- 필수 게이트: `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from HEAD^`, `npm run guard:erp-writes -- --changed-from HEAD^`, `npm run build`.
- 1920x1080 CSS pixel/100%에서 자동행 사유 노출, 선택 불가, 가로 잘림·sticky 가림·검토창 직접 진입 차단, 정상행 선택/등록을 실브라우저로 확인한다. 기준 viewport가 아닌 화면에서도 이유 문구와 핵심 버튼 접근이 잘리지 않아야 한다.

## 영향 파일과 비영향 범위
- 수정: `lib/salesDefectDeductionCore.js`, `lib/salesDefectDeductions.js`, 공통 원천 판정·eligibility·supportStatus 모듈, `docs/contracts/sales-defect-deduction.json`, 관련 테스트. 기존 두 페이지는 공통 응답과 상태 함수를 이미 사용하므로 직접 수정 없이 표시·선택 차단을 검증한다.
- API route는 기존 action을 유지하며 새 외부 쓰기 endpoint를 만들지 않는다. 필요하면 오류 code 전달만 보강한다.
- 보존: 정상 수동/수동 이월의 `ImportConfirmed` 무관 등록, 부분등록/멱등성, 기존 Estimate 단가·금액 공식, Order/Shipment/ShipmentDate/Farm/Stock/WebProfitReport 전체, 기존 자동 원문·History·Estimate.
- 금지: runtime DDL, 운영 원장 보정, 기존 자동 Estimate 삭제/수정, 담당자/등록자 기반 자동 판정, 날짜만으로 허용, 클라이언트가 보낸 source/note로 제외 해제.
