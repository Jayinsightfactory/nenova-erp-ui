# 견적 차감 중복 쓰기 방지 설계 (2026-10-13)

## 1. 결론과 실행 경계

- 이번 재감사에서 **확정 중복과 삭제 승인 대상은 0건**이다. 운영 삭제 runner를 만들거나 실행하지 않는다.
- 진화원 `CustKey=687`은 사용자 지시대로 감사·삭제 대상에서 제외하고 절대 변경하지 않는다.
- 이전에 중복으로 보았던 Estimate `10051`과 `10298`은 보존한다. 두 행은 수량·단가가 같지만 각각 `불량차감/단`(`FEE03-KR0010`)과 `단가차감/단`(`FEE03-KR0040`)으로 canonical family가 다르다.
- 나머지 다중 행 6개 그룹도 원장·Application·등록 이력이 중복을 입증하지 않으므로 보존한다. 근거는 `outputs/revised-duplicate-review.md`와 `outputs/revised-duplicate-review.json`이다.
- 구현 범위는 새 중복 발생을 막는 세 쓰기 경로뿐이다.
  1. 견적서 관리 직접 생성 `pages/api/estimate/index.js`
  2. 기존 Estimate 직접 수정 `pages/api/estimate/update-entry.js`
  3. 영업지원 불량 일괄등록 `lib/salesDefectDeductions.js`
- 사용자 화면에 새 확인 프로토콜, 별도 등록 override, operationId receipt, DB unique index 또는 신규 테이블을 추가하지 않는다. 명백한 중복은 HTTP 409와 기존 EstimateKey로 안내하고 쓰기는 0건이어야 한다.

## 2. 확인 근거

### 운영 읽기 증거

- `outputs/duplicate-evidence-expanded-2026-10-13.json`
  - `CodeInfo.Category='EstimateType'` 24개 행의 `DetailCode`, `Descr`, `Descr2` 확인
  - `10051`: family `불량차감`, 적요 `40차 누락`
  - `10298`: family `단가차감`, 적요 없음
  - 두 대상 관련 정확한 `SystemActionLog` 없음, Estimate 참조 FK 없음
- `outputs/revised-duplicate-review.json`
  - 진화원 제외 2026/41 음수 Estimate 198건
  - 다중 그룹 7개, 확정 중복 0개, 삭제 후보 0개
  - 하나의 Estimate에 여러 원장/Application이 연결된 경우 0개
- 원본 전수 감사는 별도 작업공간의 `outputs/defect-duplicate-fresh-2026-10-13/audit.json`이며 이 저장소에는 원본 운영 자료를 복사하거나 커밋하지 않는다.

### EXE 및 코드 근거

- 실제 `nenova.exe` `ClassEstimate.Insert/Update/Delete` CLI 재확인 결과 각 동작은 `Estimate`만 쓴다. 주문·출고·재고·매출확정 원장을 함께 수정하지 않는다.
- `pages/api/estimate/index.js`는 현재 트랜잭션 안에서 `ShipmentMaster`와 ERP 편집 lease를 확인한 뒤 바로 `Estimate`를 INSERT하며, INSERT 직전 중복 판정이 없다.
- `pages/api/estimate/update-entry.js`는 대상 행과 ERP 편집 lease를 잠그지만, 자기 자신을 제외한 충돌 행을 검사하지 않고 UPDATE한다.
- `lib/salesDefectDeductions.js`의 기존 `assertNoExactUnlinkedEstimate`는 최종 등록 시 `UPDLOCK,HOLDLOCK`으로 다시 검사한다. 다만 세 쓰기 경로가 공유하는 논리 잠금이 없어 직접 등록과의 동시 실행을 완전히 직렬화하지 못한다.
- `withActionLog` 감사는 응답 뒤 best-effort 기록이므로 중복 쓰기 판정이나 멱등 receipt의 권위로 사용하지 않는다.

## 3. 불변조건

1. 연도 없는 `OrderWeek`만으로 조회·잠금·판정하지 않는다.
2. 다른 Estimate type family를 중복으로 합치거나 차단하지 않는다.
3. 기존 영업지원의 보수적인 `같은 부모차수+업체+품목+절대수량+단위` 미연결 Estimate 차단 정책은 이번 변경에서 완화하지 않는다. 자동 원천 sticky 차단, 이월 `requestKey`, 기존 연결행 UPDATE, 수동 이월/부분등록도 그대로 둔다.
4. 직접 생성·수정은 아래의 모든 필드가 같은 **명백한 동일행**만 차단한다. 일부 필드만 같은 행은 보존한다.
5. 직접 생성의 `cost>0`, 직접 수정의 `cost>=0`, 부호, 수량, Amount/Vat, 날짜, EXE 대상 출고, ERP 편집 lease 검증을 변경하지 않는다.
6. 차단된 요청은 `Estimate`, `WebSalesDefectDeduction`, History, Application, ERP edit revision을 전혀 쓰지 않는다.
7. Order/Shipment/ShipmentDate/Stock/StockHistory/WebProfitReport는 모든 성공·차단 경로에서 보존한다.

## 4. 공통 잠금 설계

새 공통 모듈(권장명 `lib/estimateDuplicateWriteGuard.js`)이 트랜잭션 내부에서만 다음 잠금을 잡는다.

```text
lock scope = version + OrderYear + parent OrderWeek + CustKey + ProdKey
```

- lock resource는 위 값을 canonical JSON으로 만든 뒤 SHA-256으로 축약해 SQL Server `sp_getapplock`의 255자 제한 안에 둔다.
- `@LockMode='Exclusive'`, `@LockOwner='Transaction'`, 유한한 `@LockTimeout`을 사용한다. 반환값이 음수이면 `ESTIMATE_DUPLICATE_LOCKED`(409)로 중단한다.
- family, 단위, 수량, 단가, ShipmentKey는 lock resource에 넣지 않는다. 직접 생성·수정과 영업지원 경로가 서로 다른 판정 정책을 쓰더라도 같은 연도·부모차수·업체·품목 쓰기를 반드시 직렬화하기 위해서다.
- 세 경로 모두 Estimate 또는 ShipmentMaster에 쓰기 잠금을 잡기 **전에** app lock을 먼저 얻는다. 특히 `update-entry`는 현재 Estimate JOIN을 먼저 `UPDLOCK`하지 말고, 요청의 명시적 ERP scope와 새 `ProdKey`로 app lock을 잡은 뒤 대상 Estimate를 잠가 재검증한다. 이 순서를 경로마다 달리하면 `ShipmentMaster -> app lock`과 `app lock -> ShipmentMaster`가 교차해 deadlock이 날 수 있다.
- app lock 뒤의 후보 조회는 `WITH (UPDLOCK,HOLDLOCK)`을 유지한다. app lock이 신규 gap 동시성을 보장하고, 행 잠금은 조회한 후보의 트랜잭션 중 변경을 막는다.
- `withTransaction`의 commit 단계 실패는 결과 불명으로 재실행하지 않는 기존 계약을 유지한다.

## 5. type family 해석

직접 생성·수정의 exact fingerprint를 만들기 전에 같은 트랜잭션에서 이미 선택된
`EstimateType` 코드의 `CodeInfo`를 조회한다.

- `CodeInfo.Category='EstimateType' AND DetailCode=@typeCode`의 정확한 코드 일치만 사용한다.
- 결과가 0행 또는 2행 이상이거나 family를 유일하게 정할 수 없으면
  `ESTIMATE_TYPE_IDENTITY_UNKNOWN`(409)으로 fail closed 한다.
- canonical family는 `CodeInfo.Descr2`의 trim 값을 우선하고, 기존 코드의
  `Descr2`가 비어 있으면 해당 exact-code 행의 `Descr`를 사용한다. 둘 다 비어 있거나
  exact-code 행들에서 family가 하나로 정해지지 않으면 차단한다. `불량차감`,
  `검역차감`, `단가차감`, `취소차감`, `부족차감`, `중복차감`, `출하오류차감`,
  `판매요청`은 서로 다른 family다.
- 기존 직접 생성의 `TOP 1` type-code 선택과 Product `EstUnit` 기반 저장 단위 규칙은
  변경하지 않는다. CodeInfo 표기 단위와 입력/저장 unit의 일치를 새 저장 조건으로
  강제하지 않는다. 저장 unit은 exact fingerprint의 독립 항목으로만 비교한다.

이 변경은 `10051`과 `10298`처럼 금액이 같은 서로 다른 업무를 중복으로 차단하지 않기 위한 필수 조건이다.

## 6. 직접 생성·수정 exact fingerprint

직접 경로에서만 다음 필드가 전부 같은 다른 Estimate를 충돌로 본다.

```text
OrderYear
실제 target full OrderWeek
CustKey
ShipmentKey
ProdKey
수량 부호
canonical type family
normalized Unit
abs(Quantity)
Cost
EstimateDtm의 SQL date
트리거 적용 후 canonical Descr
```

- 수량과 단가는 기존 저장 정밀도에 맞춰 허용 오차 `0.0001` 이내를 동일로 본다.
- Amount/Vat는 수량·단가에서 공통 `amountVatFromCostEst`로 파생되므로 fingerprint 중복 항목으로 다시 넣지 않되, 저장 전 계산값과 저장 후 값은 기존 테스트로 검증한다.
- 날짜는 timestamp가 아니라 SQL `date`로 비교한다. 화면과 EXE의 입력 의미가 일자이기 때문이다.
- 적요는 JS에서 새 규칙을 흉내 내지 않는다. 운영 trigger가 사용하는 `dbo.fn_SanitizeEstimateDescr`를 prospective value에도 적용한 값을 기존 저장 `Descr`와 비교한다. 함수/CodeInfo를 읽지 못하면 fail closed 한다.
- 생성은 제외키가 없고, 수정은 현재 `EstimateKey`를 반드시 제외한다.
- 충돌 시 `ESTIMATE_EXACT_DUPLICATE` 409와 `conflictEstimateKey` 하나를 반환한다. 메시지는 `동일한 유형·출고·품목·단위·수량·단가·일자·적요의 기존 견적 #N이 있습니다. 기존 행을 확인하세요.`로 고정한다.
- 충돌 후보가 여러 개면 저장하지 않고 모든 키를 정렬해 내부 진단에 남기되, API의 대표키는 가장 작은 키로 결정적으로 반환한다.
- 기존 `pages/estimate.js`는 생성 오류를 상단 오류, 수정 오류를 편집창 오류로 표시하므로 이번 최소 범위에는 UI 변경이 필요 없다. API 메시지에 기존키가 반드시 포함되어야 한다.

### 생성 순서

1. 요청의 명시적 `OrderYear + parentWeek + CustKey + ProdKey` 검증
2. transaction 시작
3. 공통 app lock
4. 실제 ShipmentMaster를 `UPDLOCK,HOLDLOCK`으로 읽고 연도·full week·업체 재검증
5. ERP edit guard 확인
6. 기존 규칙으로 확정된 type code의 CodeInfo family를 읽고 저장 unit과 별도로 fingerprint 확정
7. exact duplicate 후보 잠금 조회
8. 충돌이면 409 rollback, 아니면 기존 ClassEstimate 호환 INSERT 1건
9. INSERT 결과키 1건과 저장값 확인 후 edit guard revision 진행 및 commit

### 수정 순서

1. 요청의 명시적 ERP scope와 prospective `ProdKey` 검증
2. transaction 시작
3. 공통 app lock
4. 대상 Estimate+ShipmentMaster를 `UPDLOCK,HOLDLOCK`으로 읽고 scope/self/expected snapshot 재검증
5. ERP edit guard 확인
6. 기존 EstimateType 코드의 CodeInfo family와 prospective unit을 별도 fingerprint 항목으로 확정
7. 자기 `EstimateKey`를 제외한 exact duplicate 후보 잠금 조회
8. 충돌이면 409 rollback, 아니면 기존 필드 UPDATE 1건
9. 저장 후 PK snapshot과 edit guard revision을 확인한 뒤 commit

## 7. 영업지원 경로

- `assertNoExactUnlinkedEstimate(..., lock:true)`가 기존 Estimate 후보를 조회하기 직전에 같은 공통 app lock을 얻는다.
- 기존 predicate는 변경하지 않는다.
  - explicit year + parent week + customer + product
  - 자기 EstimateKey 제외
  - 절대수량 동일
  - normalized unit 동일
  - auto-source 연결 충돌 우선
- 이 경로에 type family, cost, date, Descr 조건을 추가하지 않는다. 기존 자동자료 보호와 수동 이월 재등록 차단을 완화할 근거가 이번 범위에는 없다.
- 사전검증의 `lock:false` 호출은 안내용 SELECT를 유지하고, 최종 쓰기 트랜잭션의 `lock:true` 호출만 app lock을 요구한다.
- linked Estimate UPDATE 또는 INSERT 전에 최종 검사를 끝내며, 자동 원천 sticky 판정과 proposed override source 판정은 그보다 먼저 유지한다.

## 8. 영향 파일

| 파일 | 변경 |
|---|---|
| `lib/estimateDuplicateWriteGuard.js` | app lock, exact-code family, direct exact duplicate 조회/오류의 공통 구현 |
| `pages/api/estimate/index.js` | 직접 생성 트랜잭션의 lock 순서와 INSERT 직전 exact guard; 기존 type resolver 보존 |
| `pages/api/estimate/update-entry.js` | app lock 우선 순서, self 제외 exact guard, UPDATE affected-row 검증 |
| `lib/salesDefectDeductions.js` | 최종 `lock:true` 기존 보수 predicate 앞에 공통 app lock만 추가 |
| `docs/contracts/estimate-duplicate-write-guard.json` | 세 경로의 잠금·판정·부작용 계약 신규 기록 |
| `docs/contracts/sales-defect-deduction.json` | 기존 predicate 불변과 공통 쓰기 잠금 추가 기록 |
| `__tests__/estimateDuplicateWriteGuard.test.js` | pure predicate/type/fingerprint/동시성 fixture |
| `__tests__/salesDefectDeductions.test.js` | support predicate 불변 및 최종 공통 lock 호출 계약 |

`pages/estimate.js`는 기존 오류 표시를 그대로 사용하므로 직접 수정하지 않는다.

## 9. 필수 테스트와 수용 기준

### 단위·fixture

1. 같은 scope/shipment/product/family/unit/sign/qty/cost/date/descr 두 create 중 첫 요청만 INSERT되고 두 번째는 `ESTIMATE_EXACT_DUPLICATE`, 기존키 반환, 쓰기 0건.
2. 동시 create 두 개가 같은 app lock resource를 사용하며 결과가 INSERT 1건 + 409 1건.
3. create와 support 등록이 같은 연도·부모차수·업체·품목이면 같은 app lock resource를 사용.
4. update가 자기 행은 충돌로 보지 않지만 다른 exact 행으로 바꾸면 409, 기존 두 행과 edit revision 불변.
5. `10051`/`10298` fixture는 서로 다른 family라 direct exact 충돌이 아님.
6. 같은 family라도 full week, ShipmentKey, unit, quantity, cost, date 또는 sanitized descr 중 하나가 다르면 direct exact 충돌이 아님.
7. 전년도 같은 parent week는 다른 lock scope이며 후보가 아님.
8. exact type code의 CodeInfo 0행/복수행·family 불명 또는 sanitize 함수 실패는 INSERT/UPDATE 전에 fail closed. CodeInfo 표기 단위와 Product 저장 단위의 일치 자체는 새 조건이 아님.
9. support fixture는 기존과 동일하게 다른 family/cost/date/descr라도 parent+cust+prod+qty+unit이 같으면 보수적으로 차단하며, auto-source 충돌 코드도 보존.
10. deadlock 재시도는 transaction work 단계에서만 허용되고 commit outcome unknown은 재시도하지 않음.

### 부작용 회귀

- 성공 create: Estimate INSERT 정확히 1건 외 ERP 원장 변화 없음.
- 성공 update: 선택 Estimate UPDATE 정확히 1건 외 ERP 원장 변화 없음.
- 성공 support: 기존 계약의 Estimate/ledger/history/application 변화만 허용.
- 409 차단: Estimate, Web ledger/history/application, Order, Shipment, ShipmentDate, Stock, StockHistory, WebProfitReport, edit revision 모두 불변.
- 수동 이월, 부분등록, 기존 연결 UPDATE, `ImportConfirmed`, 자동원천 sticky 차단을 기존 fixture로 재검증.

### 저장소 게이트

```powershell
node --test __tests__/estimateDuplicateWriteGuard.test.js
node --test __tests__/salesDefectDeductions.test.js
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from HEAD^
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
```

중복 409와 서로 다른 family 허용은 로컬 fixture/API 테스트로 검증한다. 운영에서는
1920x1080, 100% 브라우저의 기존 조회와 오류 영역이 정상인지 읽기 전용으로만 smoke하고,
검증용 Estimate INSERT/UPDATE/DELETE는 수행하지 않는다.

## 10. 배포와 삭제 순서

1. guard 구현과 계약/테스트 완료
2. PR·master 병합·Cafe24 배포
3. 실브라우저 기존 조회·오류 영역 read-only smoke(운영 쓰기 없음)
4. 배포 후 같은 SELECT-only 감사 재실행
5. 확정 중복이 새로 입증되지 않으면 운영 삭제 0건으로 종료

향후 삭제가 필요하면 동일 금액만으로 승인하지 않는다. 같은 logical source/request를 입증하는 원장 링크, Application, REGISTER_ESTIMATE 이력 또는 정확한 요청 로그가 있어야 하며, frozen SHA·대상 deny set(`CustKey=687`, 이번 보존키 포함)·전후 보호 해시를 갖춘 별도 승인 작업으로 수행한다.
