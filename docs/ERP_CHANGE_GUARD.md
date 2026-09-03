# Nenova ERP 기능 변경 가드

작성일: 2026-07-20

## 목적

문서에만 있던 dnSpy/DB 규칙을 코드 계약, 자동검사, 배포 차단 조건으로 연결한다. 대상은 `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentFarm`, `WarehouseMaster`, `StockMaster`, `ShipmentDate`, `ProductStock`, `StockHistory`를 읽거나 쓰는 모든 기능이다.

## 2026-07-20 차수피벗 회귀 원인

1. `pages/shipment/week-pivot.js`가 분배수량 편집에 주문과 분배를 함께 증감하는 `/api/shipment/adjust`를 재사용했다.
2. API의 `OrderMaster`/`ShipmentMaster` 재사용 쿼리가 `CustKey + OrderWeek`만 사용했다. `29-02`는 매년 반복되므로 2026 작업이 2025 `OrderMaster`에 연결됐다.
3. 빈행 ADD는 대상 업체의 2025 주문을 만들면서 2026 출고를 만들었다. `nenova.exe`는 `ViewOrder`와 `ViewShipment`를 `OrderYear + OrderWeek + CustKey + ProdKey`로 조인하므로 화면에서 대상 업체가 누락됐다.
4. CANCEL도 결합 API를 사용해 원래 업체의 주문등록수량까지 감소시켰다.

### 왜 지난주에는 정상처럼 보였나

빈행 일괄적용이 들어간 2026-07-10 커밋 `aa2b15e`는 기존 결합 API를 그대로 호출했다. 기존 주문이 이미 있고 같은 고객의 전년도 동일 차수 Master와 충돌하지 않는 데이터에서는 주문과 분배가 함께 움직여 오류가 드러나지 않았다. 이번 29-02 작업은 “현재연도 주문 없음 + 전년도 동일 차수 주문 있음” 조합이라 잠복한 연도 누락과 잘못된 부작용이 동시에 노출됐다.

## 차수피벗 상태 계약

| 요청 | 현재연도 활성 주문 | 주문 결과 | 분배 결과 |
|---|---:|---|---|
| ADD `+N` | 없음 | `N` 실제 주문 등록 | `+N` |
| ADD `+N` | 있음 | 기존 수량 유지 | `+N` |
| CANCEL `-N` | 있음 | 기존 수량 유지 | `-N` |
| CANCEL `-N` | 없음 | 주문 생성/수정 금지 | `-N` |

구현 기준은 `lib/pivotAdjustmentPolicy.js`이고 계약 검증은 `__tests__/shipmentPivotAdjustContract.test.js`다.

## dnSpy에서 확인된 EXE 기준

- `ViewOrder`: `OrderMaster`/`OrderDetail` 활성행과 `UserInfo`, `Customer`, `Product`, `Country`를 조인한다.
- `ViewShipment`: `ShipmentMaster`/`ShipmentDetail`을 기준으로 한다.
- 품목별 업체 분배 화면은 `ViewOrder`에서 시작해 `ViewShipment`를 아래 키로 LEFT JOIN한다.

```text
OrderYear + OrderWeek + CustKey + ProdKey
```

- 출고피벗은 `ViewShipment`와 `ViewOrder`를 같은 네 키로 INNER JOIN한다.
- 따라서 연도가 다른 주문과 출고는 DB에 각각 존재해도 EXE에서는 한 건으로 결합되지 않는다.
- 근거 SQL은 `lib/exeShipmentDistributionSql.js`, 원문 정리는 `docs/WEB_VS_ERP_CONFLICTS.md`에 보존한다.

## 기능 추가 절차

1. `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`에 따라 실제 `nenova.exe`를 dnSpy CLI로 decompile하고 대상 Form/Class/메서드/SQL 저장 순서를 `docs/exe-golden/*.md`에 기록한다.
2. 같은 `OrderYear + OrderWeek + CustKey + ProdKey`에 대해 읽기 전용 DB probe를 실행해 EXE 데이터와 웹 대상 행을 대조한다.
3. `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`를 기준으로 사용자 동작을 행으로, 변경 테이블을 열로 둔 부작용 표를 작성한다.
4. `docs/contracts/<feature>.json`을 추가·갱신하고 `OrderYear + OrderWeek + CustKey + ProdKey` 업무 키를 선언한다.
5. 쓰기 전 조회 업무 키에 `OrderYear`가 포함됐는지 확인한다. 화면의 선택 연도도 모든 API payload까지 전달한다.
6. 정책 분기는 DB 코드 안에 흩뿌리지 말고 순수 함수로 분리한다.
7. 최소 네 가지 경계 fixture를 만든다: 현재연도 주문 있음/없음 × ADD/CANCEL.
8. 전년도 동일 차수 Master가 존재하는 교차연도 fixture를 반드시 추가한다.
9. `npm run test:nenova-dnspy-evidence`, `npm run test:erp-contract`, 변경 SQL 스코프 검사, `npm run build`를 통과시킨다.
10. 배포 후 `ViewOrder`, `ViewShipment`, `ShipmentFarm`, EXE parity API를 같은 네 키로 대조한다.

## 자동 방어 계층

- `AGENTS.md`: Codex가 저장소 진입 시 읽는 강제 작업 규칙.
- `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`: 기능별 부작용·연도전달·배포 전후 체크리스트.
- `docs/contracts/*.json`: 기능 계약과 필수 교차연도 fixture의 기계검사 대상.
- `.claude/skills/nenova-erp-change-guard/SKILL.md`: Claude/에이전트 작업용 동일 절차.
- `$guard-nenova-erp-changes`: 사용자 환경의 Nenova 전용 Codex 스킬.
- `.claude/agents/erp-contract-guardian.md`: 기존 Claude 에이전트 팀용 검증자.
- `scripts/check-erp-write-contracts.mjs`: 변경된 API의 연도 없는 위험 SQL을 탐지.
- `scripts/check-nenova-dnspy-evidence.mjs`: dnSpy CLI 명령·Form 메서드·테이블 근거 기록이 없으면 차단.
- `docs/NENOVA_DNSPY_CLI_WORKFLOW.md` / `docs/exe-golden/*.md`: 실제 EXE decompile 및 읽기 전용 probe 기록.
- `.github/workflows/erp-contract.yml`: PR과 master push에서 계약검사 실행.
- `.github/workflows/deploy.yml`: 계약검사가 실패하면 서버 배포 전에 중단.

## 검증이 없었던 구조적 원인

- 기존 MD와 에이전트는 참고 지침이었고 테스트 실행이나 배포 성공 조건이 아니었다.
- 루트 `AGENTS.md`가 없어 Codex 작업에 프로젝트 규칙이 자동 주입되지 않았다.
- 배포는 Next 빌드, API 스모크, hydration만 검사했다. 이 검사는 SQL이 2025 행을 수정하는 의미 오류를 발견할 수 없다.
- 테스트가 수량 환산과 화면 동작 중심이었고, 주문/분배 부작용 행렬과 교차연도 fixture가 없었다.
- `/api/shipment/adjust`라는 포괄적인 이름과 결합 동작이 호출자에게 숨겨져 있었다.
- `week-pivot`이 선택한 연도를 읽기·쓰기 payload에 일관되게 전달하지 않았고, 시작재고 텍스트 저장도 연도 없이 `StockMaster`를 재사용했다.

앞으로는 문서를 추가하는 것만으로 완료로 보지 않는다. 문서 규칙마다 실행 가능한 테스트 또는 CI 검사 하나 이상을 연결한다.

## 2026-09-03 엑셀 출고분배 504를 로그인 만료로 오인

382건 같은 대량 최종값 적용은 단일 원자 트랜잭션과 저장 후 검증이 끝날 때까지 응답이
길어질 수 있다. 이때 웹 게이트웨이가 먼저 504 HTML을 반환해도 Node 작업은 계속될 수
있는데, 화면이 JSON 파싱 실패를 모두 로그인 만료로 표시하여 재로그인·중복 실행을
유도했다. 이제 적용 API는 기존 `jobId` 진행 저장소에 최종 성공 결과 또는 구조화된 실패를
보존하고, 화면은 네트워크 단절·502·503·504 시 새 POST를 보내지 않은 채 같은 `jobId`를
조회하여 실제 트랜잭션 결과를 확정한다. 401/403만 로그인 문제로 안내한다. 회귀 계약은
`__tests__/shipmentImportGatewayRecovery.test.js`로 고정한다.

## 2026-09-02 붙여넣기 전체 일괄 저장 전 검증 누락

### 2026-09-02 서버 중단 뒤 같은 브라우저 stale 작업권 고착

붙여넣기 일괄 처리 도중 서버가 중단되면 release 요청도 실패하여 같은 브라우저의
`WebErpEditLease`가 TTL 동안 남을 수 있다. 이후 사용자가 명시적으로 기존 매칭 재분석을
실행해 최신 주문·분배를 읽어도, 화면 상태만 초기화하고 서버 lease의 과거
`BaselineDigest`는 갱신하지 않아 `ERP_EDIT_STALE`가 반복됐다. 이제 명시적 재분석은
최신 행을 읽은 뒤 **동일 사용자·동일 browser client가 소유한 활성 lease는 refresh하고,
동일 사용자·다른 browser client가 소유한 활성 lease는 명시적 takeover 후 새 lock-bound
기준을 refresh**한다. 다른 사용자 lease는 갱신하거나 인수하지 않으며 ERP 원장은 보존한다.
takeover는 일반 polling/acquire가 아니라 사용자가 현재 화면에서 명시적으로 재분석을
실행한 경우에만 수행되고, 이전 client token을 무효화한다.
활성 lease가 이미 만료된 경우에도 화면의 이전 `stale=true`를 새 GET 결과와 다시
합치지 않고, `Claude로 분석`에서 읽은 현재 지문을 다음 저장 기준으로 사용한다.

35-01 붙여넣기 변경은 취소 전체 후 추가 전체를 한 트랜잭션으로 실행하고 있었지만,
확정 상태·현재 분배·환산·재고 부족·전산 View 노출을 실제 쓰기 트랜잭션을 시작한 뒤에야
검사했다. 따라서 사용자는 실행 전에는 실패 행을 알 수 없었고, 의미가 다른 품목으로
매칭된 경우에도 유효한 `ProdKey`라는 이유로 저장 단계까지 진입했다. 실패 시 원장은
전체 rollback되었지만 작업이 누락된 것처럼 보였다.

### 기준 원천 → 사용 위치

| 기준 | 원천 | 표시/사전검증/저장 위치 |
|---|---|---|
| 업무키 | dnSpy ViewOrder/ViewShipment 조인 | `OrderYear + OrderWeek + CustKey + ProdKey` |
| 실행순서 | 붙여넣기 계약 | 안정 정렬된 CANCEL 전체 → ADD 전체 |
| 환산·재고·확정·출고일 | `executeShipmentAdjustmentInTransaction` | 사전검증과 실제 저장이 동일 코어 사용 |
| 강제처리 | 붙여넣기 계약 | 항상 `force=false` |
| 사전검증 기본값 | API 계약 | boolean `true`만 rollback-only, 누락/false/0/문자열은 실제 저장 |

### 부작용 표

| 동작 | Order | Shipment | ShipmentDate/Farm/History/Adjustment | Estimate/WebProfitReport |
|---|---|---|---|---|
| `preflightOnly=true` | 동일 저장 코어 실행 후 rollback, 최종 보존 | 동일 | 동일 | 보존 |
| 실제 CANCEL | 보존 | 감소 | 기존 AUTO_CANCEL 계약 | 보존 |
| 실제 ADD | 활성 주문 있으면 보존, 없으면 양수 생성 | 증가 | 기존 adjust 계약 | 직접 쓰기 금지 |

사전검증은 성공 경로까지 트랜잭션을 rollback하며 `committedCount=0`을 반환한다. 이후 실제
요청은 별도 트랜잭션에서 모든 조건을 다시 검사하므로 사전검증과 저장 사이의 동시 수정도
우회하지 못한다. 한 행 실패 시 전체 rollback하는 기존 정책은 유지한다.

## 2026-08-18 불량차감 등록 대상 과잉 필터 회귀

영업지원 전산등록에서 견적서관리 상세에 노출되는 확정 출고가 있는데도 “출고가 없어
견적서 등록 대상을 찾을 수 없습니다”가 발생했다. 웹 판정이 dnSpy
`FormEstimateView.GetDetail`에는 없는 `ShipmentDate.EstQuantity>0` 조건을 추가했고,
문서와 문자열 테스트가 그 잘못된 조건을 함께 고정한 것이 원인이다.

등록 대상은 `lib/defectEstimateTargetScope.js`의 공통 판정을 사용한다. 같은 연도·부모차수·
업체의 활성 `ShipmentMaster + ShipmentDetail + ShipmentDate + PeriodDay` 조인에서
활성 `ShipmentKey` 존재를 요구하고 Master/Detail 확정 여부는 제한하지 않으며, 출고일 표시값인
`ShipmentDate.EstQuantity`가 0/NULL이라는 이유로 대상 ShipmentKey를 제외하지 않는다.
영업지원 목록과 사전검증·등록 직전 재검증은 이 공통 판정을 사용한다. Estimate는
사용자가 선택한 불량 `ProdKey`를 그대로 저장하고 단가·단위도 그 품목에서만 선택한다.

회귀 fixture는 상희꽃상사 2026 `33-01`의 Master/Detail 확정·`ViewShipment.DetailFix=0`인
정상행과 Master 또는 Detail 미확정 near-miss, 2025 같은 33차 교차연도 near-miss를 실행형으로
검증한다. 문자열 테스트가 dnSpy 원문보다 우선할 수 없다.

## 2026-07-20 농장 후보 GET/POST 범위 불일치 회귀

29-02 차수피벗에서 `CARNATION rodas`의 농장배정이 화면에는 보이는데 저장 후
`nenova.exe`에 반영되지 않는 사례가 발생했다. 원인은 다음 두 조회가 서로 달랐기
때문이다.

- `FormShipmentDistribution`의 후보 조회: `ViewWarehouse` 전체 이력에서 `ProdKey`만 제한
- 웹 `adjust`의 최종 트랜잭션 검증: 과거에는 `OrderYear + OrderWeek + ProdKey`를 함께 제한

그 결과 27-02 입고에서 유효한 `TURFLOR` 농장을 29-02 출고에 배정할 수 있었지만,
최종 저장 단계에서 FarmKey 검증이 실패해 트랜잭션이 롤백됐다. 이 문제는 농장명
오탈자나 `ViewOrder`의 업체 조인 문제가 아니라 **후보를 읽는 단계와 저장 검증 단계의
범위가 다르기 때문에** 발생했다.

현재는 `lib/shipmentFarmCandidates.js`의 `FARM_CANDIDATE_SCOPE_SQL`을 모달 GET,
`farm-distribution` POST, `adjust` 트랜잭션이 함께 사용한다.

```text
ViewWarehouse vw + Farm f
WHERE vw.ProdKey=@pk AND Farm.isDeleted=0
```

연도·차수 제한은 출고 업무키를 찾는 `ShipmentMaster/ShipmentDetail` 조회에는
필수지만, EXE의 농장 후보 집합에는 적용하지 않는다. 이 두 범위를 각 API에 다시
쓰면 계약 위반으로 본다.

## 견적서·매출 downstream 영향 계약

주문·분배 기능은 견적서와 매출 화면이 읽는 출고 원장을 간접적으로 사용한다.
따라서 “테이블을 직접 쓰지 않았다”만으로 영향 없음이라고 판정하지 않고, 아래처럼
의도된 downstream 변화와 금지된 원장 변조를 구분한다.

| 동작 | Order/Shipment | ShipmentFarm | Estimate 원장 | 견적 노출 | 매출/손익 |
|---|---|---|---|---|---|
| farm-only 저장 | 수량·금액·출고일 보존, `Descr`만 갱신 가능 | 전체 재작성 | 보존 | 기존 조건이 같으면 동일 | `Amount/Vat/isFix`가 같으면 동일 |
| ADD + 현재연도 주문 없음 | 양수 주문 생성 + 출고 증가 | 배정값 저장 | 직접 INSERT 금지 | 확정·날짜·ViewOrder 조건 충족 시 노출 | 확정 전에는 집계 금지, 확정 후 정상 출고로 집계 |
| ADD + 현재연도 주문 있음 | 주문 보존 + 출고 증가 | 배정값 저장 | 직접 INSERT 금지 | 기존 주문과 출고가 같은 네 키로 조인되어야 함 | 확정 전에는 집계 금지 |
| CANCEL | 주문 보존 + 출고 감소 | 0이면 삭제 | 보존 | 감소된 출고만 반영 | 확정 상태·SP 정책을 따름 |

견적 노출은 EXE `GetDetail`과 동일하게 `ViewShipment + ViewOrder + ShipmentDate +
PeriodDay + DetailFix=1`을 통과하고, 확정 출고만 대상으로 한다. 진단 API도
이 `DetailFix=1` 조건을 반드시 재현한다. 매출·주차별 손익은 저장된
`ShipmentDetail.Amount/Vat`와 `isFix=1`을 기준으로 하며, 농장배정 API는
`Estimate`, `WebProfitReport`, 매출 원장에 직접 쓰지 않는다.

변경 후에는 반드시 다음을 읽기 전용으로 기록한다.

1. 같은 네 키의 `ViewOrder`, `ViewShipment`, `ShipmentDate`, `ShipmentFarm`
2. `/api/shipment/estimate-visibility`의 `visibleInEstimate`, `InGetDetail`
3. 판매현황의 해당 차수 확정 집계와 대상 품목 행
4. `ShipmentDetail.OutQuantity/Amount/Vat/isFix`의 변경 전후 값

이 계약은 `__tests__/shipmentDownstreamImpactContract.test.js`가 소스 수준에서
검사하고, `shipmentFarmContract.test.js`가 GET/POST/트랜잭션의 후보 범위 공유를
검사한다. 운영 데이터 보정은 이 검증과 코드 배포가 끝난 뒤 별도 단계로 수행한다.

## 2026-08-26 견적서 기존 출고 수량의 방향별 저장 계약

사용자가 요청한 구조 변경으로, 아래 과거 2026-07-21/08-10 기록 중 기존 출고 수량을
항상 확정취소→저장→재확정한다는 설명은 이 계약으로 대체한다. 신규 품목 추가 및
사용자가 명시한 확정 작업은 별도 기존 계약을 따른다.

- 기존 출고일 수량 변경은 서버가 잠근 실제 수량과 비교해 증가·감소를 결정한다.
- 재고 부족 검사는 증가한 상세에만 수행한다. 감소와 동일 총량 날짜 이동은 부족 검사를
  하지 않지만, 입력값·단위·출고일 합계·연도/업체·동시 수정 검사는 항상 유지한다.
- 기존 확정 상태를 보존한다. 확정 물량 변경의 현재고 효과는 native
  Cancel(old)+Fix(new)의 순효과와 같은 old-new이며 출고 이력으로 기록한다.
- 출고 변경, 현재고 및 변경 품목의 native 재계산, 편집 기준값 갱신은 한 트랜잭션이다.
  하나라도 실패하면 모두 원상복구한다. 다른 품종군을 해제하거나 재확정하지 않는다.
- 주문, 별도 차감 Estimate 원장, 손익 저장 원장은 변경하지 않는다. 0 출고 상세 정리는
  기존 정책을 유지하며 주문은 남긴다.
- 단가만 저장하면 물량과 재고는 그대로 둔다. 증가/감소를 화면 추정값이나 클라이언트의
  검사 생략 플래그로 판정하지 않는다.
- 잠금 소유자 보호가 준비되지 않았거나 다른 작업이 재고를 계산 중이면 잠금을 빼앗지
  않는다. 실패한 작업의 잠금 해제가 다른 작업의 잠금을 해제해서도 안 된다.
- 실제 운영 고객 원장을 시험 목적으로 증감하거나 과거 부분 확정해제를 복구하지 않는다.

근거와 필수 검증은 `docs/work-reports/2026-08-26_estimate-directional-quantity-design.md`,
`docs/contracts/estimate-date-quantity.json`에 기록한다. 문구 검사만으로 완료 판정하지 않고
분리된 SQL 시험 전산에서 증감·실패 롤백·동시 실행과 downstream 결과를 검증한다.

## 2026-07-21 견적서 출고일별 수량 회귀 방지

견적서관리의 정상출고 수량은 화면상 `ShipmentDate.EstQuantity`로 표시되지만,
사용자가 출고일 수량을 증감하는 저장은 `FormShipmentDistribution` 날짜 탭과 동일하게
해당 행의 `ShipmentDate.ShipmentQuantity`와 `ShipmentDetail` 총량을 함께 갱신해야 한다.
dnSpy의 `FormEstimateView` 단순 견적수량 저장은 `SdateKey`의
`EstQuantity/Amount/Vat/Descr`만 UPDATE하지만, 웹의 출고일 증감 기능은 명시적으로
`ShipmentDetail`·`ShipmentDate` 분배 저장을 결합한다.

- 화면 키: 정상출고 `SdateKey`, 차감 `EstimateKey`; `SdetailKey`는 정상출고 견적수량 저장에 사용 금지
- API: `/api/estimate/update-date-quantity`에서 여러 출고일을 한 번에 저장하고
  `ShipmentDetail.OutQuantity` 총량과 `ShipmentDate.ShipmentQuantity` 합계를 검증
- 금액: EXE와 동일하게 `Amount = Round(Cost * Round(EstQuantity,0) / 1.1,0)`,
  `Vat = Cost * Round(EstQuantity,0) - Amount`
- 고정 출고는 API가 `FIXED_WEEK`로 거부하고, 화면이 EXE 작업 순서대로
  확정해제 → 분배 저장 → 재확정 사이클을 실행한다.

이 계약은 `docs/contracts/estimate-date-quantity.json`과
`__tests__/estimateDateQuantityContract.test.js`가 검사한다. 견적서 수량 기능을 다시
수정할 때는 `npm run test:erp-contract`에 연결된 회귀 테스트와 dnSpy 증거 문서를 함께
갱신해야 한다.

## 2026-07-21 견적서 단가 수정 확정 사이클 회귀

29-02 견적서에서 단가 3건을 저장한 뒤 확정 차수 오류가 다시 표시된 원인은 단가+수량
통합 저장 경로가 화면의 `OrderWeek/CountryFlower` 값만으로 사이클을 만들고, 그 범위가
실제 `ShipmentDetail.isFix=1` 행과 다를 때 재시도하지 않았기 때문이다. 일부 단가가 먼저
저장된 것이 아니라 `update-cost`의 단일 트랜잭션이 확정행에서 차단된 상태였다.

현재 계약은 다음을 고정한다.

- 통합 저장도 `확정취소 → 저장 → 재확정` 사이클을 반드시 사용한다.
- 화면 행에 차수·카테고리가 누락되어도 선택 견적의 세부차수와 서버가 반환한
  `fixedWeeks`를 합쳐 자동 재시도한다.
- 자동 사이클은 화면 카테고리 라벨을 저장 범위로 신뢰하지 않고 전체 고정 범위를
  해제·재확정한다. 단가 수정은 `OrderDetail`, `OutQuantity`, `ShipmentFarm`을 변경하지 않는다.
- 확정 후보와 재고 재계산 품목 조회는 `ShipmentMaster.OrderYear + OrderWeek`로 격리해
  전년도 같은 차수와 섞이지 않게 한다.

이 계약은 `docs/contracts/estimate-cost-update.json`과
`__tests__/estimateFixCycle.test.js`가 자동검사한다.

## 2026-08-07 견적서관리 검역차감 진입점 회귀

`e0f3b81`에서 기존 불량/검역 범용 모달을 불량차감/판매요청 모드로 바꾸면서
화면의 검역 진입점이 제거되고, `/api/estimate`도 판매요청이 아닌 모든 직접 입력을
불량차감으로 강제했다. 추가 품목등록은 이 삭제를 일으키지 않았지만, 같은 작업영역에
버튼이 추가된 뒤 회귀가 사용자에게 드러났다.

복원 계약은 기존 불량/검역등록의 EstimateType 선택을 원형대로 복원하고, 별도 신규
불량차감·판매요청·추가 품목등록 상태와 분리한다. 불량/검역은
모두 `FormEstimateAdd`/`ClassEstimate`와 같은 음수 `Estimate` INSERT만 수행하고
`OrderDetail`, `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, 재고와
`WebProfitReport`를 보존한다. 두 차감 모두 확정 판매행과 이전 분배단가를 검증하지만
`Estimate`에는 `isFix`가 없으므로 출고 확정해제/재확정은 실행하지 않는다. 요청의
연도·부모차수·거래처가 선택 `ShipmentKey`와 다르면 교차연도 저장을 중단한다.

## 2026-08-10 견적서관리 확정현황 선택연도 회귀

견적서관리 화면은 `yearStr`로 선택 연도를 이미 보유했지만, 확정현황 GET/구간
확정취소 POST에 `fromWeek=29-01&toWeek=29-04`처럼 짧은 차수만 전달했다. 기존
`/api/shipment/fix-status`는 이를 서버 현재 연도로 보정했기 때문에 2025년 화면에서
2026년 동일 차수의 확정상태를 읽을 수 있었고, 뒤이어 엄격한 저장 API가 연도 누락을
거절하면서 사용자에게 연도를 다시 확인하라는 안내가 노출됐다.

이제 화면의 선택 연도를 모든 확정현황 GET/POST와 품목군 `fixCheck`에 명시하고, 서버는
짧은 차수의 연도를 현재 날짜로 추정하지 않는다. 화면 연도와 차수 연도가 다르거나
연도가 누락된 경우에만 자동 조회 요청이 올바르게 전달되지 않았다는 구체적 오류를
반환한다. 확정취소 뒤 재고 재계산 품목도 `ShipmentMaster.OrderYear + OrderWeek`로
조회한다.

| 견적서관리 동작 | Estimate | OrderDetail | ShipmentDetail/Date/Farm | 확정/재고 |
|---|---|---|---|---|
| 확정현황 자동 조회 | 보존 | 보존 | 보존 | 읽기 전용 |
| 기존 불량/검역등록 | 음수 INSERT | 보존 | 보존 | 사이클 없음 |
| 불량차감등록 | 음수 INSERT | 보존 | 보존 | 사이클 없음 |
| 판매요청 | 양수 INSERT | 보존 | 보존 | 사이클 없음 |
| 추가 품목등록 | 보존 | 현재연도 주문 없을 때만 양수 생성 | 분배 증가·날짜 동기화·농장 보존(필수 아님) · 단가 리스트는 금액만 적용 · 수량/단가와 한 번 저장 | 확정이면 해제→저장→재확정, 기존 수량 미변경 시 재고계산 생략 |
| 출고일 수량 0 | 보존 | 보존 | 해당 Detail+Date+Farm purge, 견적 미노출(`EstQuantity>0`) | 확정이면 해제→저장→재확정 |
| 구간 확정취소/재확정 | 보존 | 보존 | 수량·단가·날짜·농장 보존 | 선택연도 범위만 EXE SP + 재고계산 |

`docs/contracts/estimate-fix-status-year.json`과
`__tests__/estimateFixStatusYearContract.test.js`가 2025/2026 동일 `29-02` fixture와
네 버튼 공존, 선택연도 전달, 재고 품목 조회 조건을 자동검사한다.

## 음수재고 확정 보정

확정 SP가 음수재고로 실패하면 화면에 품목별 부족수량을 표시한다. 사용자가 `재고 부족분 보정 후 확정`을 명시적으로 선택한 경우에만 해당 수량을 `StockHistory`의 `재고조정`으로 기록하고 `usp_StockCalculation`을 실행한 뒤 다시 확정한다. 부족수량은 올림하지 않고 0.001 단위로 정규화한다. 재고 이력 등록과 재계산은 한 트랜잭션으로 처리하며 재계산 실패 시 롤백한다. 일반 확정 요청에는 이 보정이 자동 적용되지 않는다.

## 2026-09-03 EXE 저장 잔량·웹 예상 잔량 및 공용 SP 경계

`FormStockView`의 현재 잔량은 선택 `StockMaster`의 `ProductStock.Stock` 저장 스냅샷이다.
웹 사전검사의 확정 후 예상 잔량과 같은 값으로 취급하거나 같은 `잔량` 라벨로 숨기지 않는다.
화면·오류에는 `EXE 저장 잔량`과 `확정 후 예상 잔량`, 계산 기준 차수 및
전재고·입고·재고조정·확정출고·미확정출고를 구분해 표시한다.

입고 18·출고 18인데 raw 부동소수점 결과만 음수인 값은 0으로 표시하고,
확정 차단은 운영 `usp_ShipmentFix`와 동일한 `ROUND(remain,0)<0`으로 판정한다.
웹만 `-0.001` 같은 별도 기준으로 EXE보다 엄격하게 막지 않는다. 입고 18·출고 20처럼
EXE 기준에서도 실제 부족인 값은 품목명·ProdKey와 부족 2를 표시한다. 표시, 사전검사,
저장 직전 검사와 저장 후 검증이 서로 다른 반올림 또는 출고 범위를 사용하면 배포하지 않는다.

`usp_ShipmentFix`, `usp_ShipmentFixCancel`, `usp_StockCalculation`은 웹과 `nenova.exe`의
공용 실행 경로다. 해당 프로시저의 ALTER는 **웹 수정이 아니라 EXE 동작 변경**으로 분류한다.
원본/현재 정의, dnSpy 호출 순서, 선택 연도·차수 운영 read-only probe와 양쪽 replay fixture 없이
변경하거나 원복하지 않는다. 웹 요청 잠금·멱등성·상세 오류는 가능한 웹 전용 wrapper/API에서
처리하고, 최종 ERP 부작용은 EXE 권위 경로와 대조한다. 상세 세션 근거는
[`work-sessions/2026-09-03_exe-web-stock-fix-parity.md`](work-sessions/2026-09-03_exe-web-stock-fix-parity.md)를 따른다.

## 2026-07-21 전산 오류 진단 연도·발생작업 추적 계약

`/api/shipment/exe-errors`의 오류 건수는 `OrderWeek`만으로 계산하면 2025년과
2026년의 같은 차수가 섞여 중복 마스터·중복 상세·업체키 불일치 건수가 부풀려진다.
따라서 모든 선택연도 진단은 아래 업무키를 사용한다.

```text
ShipmentMaster.OrderYear + ShipmentMaster.OrderWeek
주문 존재 검사: OrderMaster.OrderYear + OrderMaster.OrderWeek + CustKey + ProdKey
```

다른 연도의 동일 차수 마스터는 선택연도 오류 합계에 넣지 않고
`crossYearMaster`(교차연도 후보)로 별도 표시한다. 이 후보는 정상적인 과거 데이터와
잘못 붙은 데이터가 DB 현재값만으로는 구분되지 않으므로 `ShipmentHistory`와
`SystemActionLog`의 시간·사용자·작업 설명을 확인한 뒤에만 보정한다.

각 진단 항목에는 실제 원인으로 추적해야 할 작업 유형을 함께 표시한다.

- 빈행 추가·반복 적용: `dupDetail`, `dupMaster`, `zeroOut`
- 출고분배·물량표 업로드(분배만 반영): `ghost`, `dateMismatch`, `custKeyBad`
- 구버전 연도 없는 저장/업로드: `yearMismatch`, `crossYearMaster`
- 견적서 출고일별 수량 수정: `dateMismatch`
- 주문등록·붙여넣기 주문등록: `managerBad`, `ghost`

일반 출고분배 API와 SP 출고분배 API의 조회·확정검사·사후검증도 반드시 같은
`OrderYear + OrderWeek`를 사용한다. 이 규칙을 추가하거나 변경할 때는
`__tests__/shipmentExeErrorsContract.test.js`와 `npm run test:erp-contract`를 통과해야
하며, `npm run guard:erp-writes`에서 연도 없는 `OrderWeek` 재사용 쿼리가 남지 않아야 한다.

## 2026-07-30 엑셀 물량표 적용 감사·수량 원천 계약

엑셀 물량표의 업체별 출고/분배 셀 합계만 주문·분배 저장의 수량 원천이다.
헤더의 `주문`, `입고`, `재고`, `잔량` 요약값은 검증·감사 참고값으로만 읽으며,
재고값을 분배수량으로 대체하거나 계산에 섞지 않는다.

- 양수 `uploadQty`: 주문과 분배를 같은 최종값으로 동기화한다.
- `uploadQty <= 0`, 빈 셀, 파일 범위 안의 행누락: `OrderDetail`은 보존하고 기존
  분배만 0으로 만든다. 기존 분배가 없으면 `ShipmentMaster/ShipmentDetail`을 새로
  만들지 않는다.
- 파일 전체를 `분배만` 처리하는 별도 모드는 허용하지 않는다. 0·빈칸·행누락의
  주문 보존은 최종 분배표의 행별 의미이며 양수 셀의 주문 동기화를 우회하는 모드가 아니다.
- 적용 후에는 같은 `OrderYear + OrderWeek + CustKey + ProdKey`로 DB를 재조회해
  의도 수량과 실제 분배·출고일 합계를 비교한다.
- 모든 업로드는 `ShipmentImportAudit`/`ShipmentImportAuditRow`에 원본수량,
  요약 재고값, 환산수량, 주문 전후, 분배 전후, 저장행동, 사후검증 상태를 남긴다.
  감사 기록 장애는 업무 저장을 막지 않지만, `SystemActionLog`에는 감사키와 실제
  적용건수(`appliedCount`)를 함께 기록한다.

이 계약은 `lib/shipmentImportQty.js`의 `resolveImportWriteIntent`와
`__tests__/shipmentImportApply.test.js`, `__tests__/shipmentImportAudit.test.js`가
회귀를 검사한다. 운영에서 “주문만 했는데 분배가 생김”, “엑셀 재고값이 분배에
영향을 줌”, “0수량이 신규 분배를 만듦”을 확인할 때는 감사키로 해당 행을 먼저
조회하고, 이후 `ShipmentHistory`와 `SystemActionLog`의 시간·사용자·작업을 대조한다.

## 2026-08-05 붙여넣기 취소·분배조정 자동 분기

취소 명령은 현재 화면의 주문수량이 아니라 같은 연도·차수·업체·품목의 실제
`ShipmentDetail.OutQuantity`를 같은 트랜잭션에서 확인해 다음처럼 처리한다.

- 활성 분배가 있으면 `AUTO_CANCEL`로 `ShipmentDetail`·`ShipmentDate`·농장분배만 취소하고 `OrderDetail`은 보존한다.
- 활성 분배가 없으면 주문을 대신 취소하지 않고 오류로 중단한다. 전체 일괄이면 앞선 변경도 모두 롤백한다.
- 취소량이 현재 분배 또는 주문수량을 초과하면 전체 트랜잭션을 롤백하고, 초과량을 자동으로 음수로 남기지 않는다.
- `DB 저장 내역`의 분배조정과 붙여넣기 취소는 동일한 `AUTO_CANCEL` 서버 정책을 사용한다. 차수피벗의 기존 `PIVOT_DISTRIBUTION` 정책은 그대로 유지한다.

이 계약은 `lib/pivotAdjustmentPolicy.js`, `pages/api/shipment/adjust.js`,
`pages/orders/paste.js`와 `__tests__/shipmentPivotAdjustContract.test.js`가 검사한다.

## 2026-08-06 공통 품목검색 랭킹

품목 검색은 화면별로 `ProdName` 문자열을 따로 정렬하지 않고
`lib/productSearchRanking.js`의 공통 점수 계산기를 사용한다. 검색어가 있으면
정확·직접 별칭·한글/영문 자연어 일치도를 먼저 적용하고, 같은 후보군 안에서
`OrderDetail` 전체 사용량, 최근 2년 사용량, 저장된 주문 매칭 빈도를 보조 점수로
사용한다. 업체·국가·품종을 명시한 업무 화면은 이 공통 순서에 업무 필터/보정만
추가하며, 검색 결과를 자동으로 `ProdKey`에 저장하지 않는다.

| 동작 | Product | OrderDetail | Shipment/Estimate/Stock |
|---|---|---|---|
| 품목 검색·그룹 목록·견적 드롭다운·주문등록 후보 표시 | 읽기 | 읽기 | 보존 |
| 사용자가 검색 후보를 선택 | 선택한 `ProdKey`만 다음 입력/등록 단계로 전달 | 보존 | 선택 전에는 보존 |

`/api/products/search`의 검색어·그룹·전체조회와 주문등록/영업수입불량차감의
후보 생성은 같은 랭킹 규칙을 사용한다. `문라이트`처럼 직접 별칭 후보가 있으면
`Candlelight`처럼 일부 문자열만 겹치는 퍼지 후보를 뒤섞지 않으며, 직접 후보가
없을 때만 오타 후보를 허용한다. 이 계약은 `PRODUCT_LOOKUP_USAGE_RANK`와
`__tests__/salesDefectDeductions.test.js`가 회귀를 검사한다.

## 2026-08-20 도착원가 품목검색 = 매칭데이터

도착원가 화면 검색은 차수·국가 문자열이 아니라 붙여넣기 매칭데이터
(`order-mappings`)가 가리키는 `ProdKey`로 행을 찾는다. `OrderWeek`와
`CountryName`은 결과 표 표시 값이다. 국가명 또는 차수명만 입력한 검색어는
품목 필터로 쓰지 않는다. `화이트`처럼 여러 품종이 매칭되면 전산
`Product.CountryFlower`(국가+품종) 버튼으로 좁힌다. 품목명 검색 없이 품종 버튼만으로
조회할 수 있다. 목록은 차수 오름/내림 → 국가 → 품종 → 품목명 → 농장 순이고,
같은 차수·품목은 농장별 원가를 한 줄에 비교한다. 품목명에서 임의 품종을
쪼개지 않는다. 교차연도 충돌을 막기 위해
목록 GET은 `OrderYear`를 유지한다.

콜롬비아 수국 `Color Grade` 원가자료는 엑셀에 도착원가 수식이 없을 때
`서류+Rate×CW`, `GW×410`, `품목수×10000` 등 같은 파일 29-1 양식의 표시 원가만
채워 `WebArrivalCost`에 저장한다. 엑셀 수식의 계산값이 비어 있으면 그 수식을
계산해 `도착원가(송이)`와 같게 맞춘다. 입고·출고·견적 원장은 보존한다.

| 동작 | Product | OrderDetail | WebArrivalCost | Shipment/Estimate/Stock |
|---|---|---|---|---|
| 품목 검색·품종 탭·페이지 조회 | 읽기 | 품목검색 시 미조회 / 차수·품종 탐색 시 사용량 읽기 | 읽기(RawJson 제외) | 보존 |
| 엑셀 업로드(새 revision) | 읽기 | 보존 | 같은 연도·차수·국가 SUPERSEDE 후 40행 단위 INSERT | 보존 |
| 전산 품목/농장 선택 후 저장 | 보존 | 보존 | 해당 행만 UPDATE | 보존 |

회귀는 `__tests__/arrivalCostProductSearch.test.js`와 기존 도착원가 계약 테스트가 담당한다.

## 2026-08-10 붙여넣기 ADD 이월재고 누락 검증

붙여넣기 주문등록의 품목별 ADD 사전검증이 현차수 입고와 수동 재고조정만 가용수량으로
계산해, 정상적인 직전 `ProductStock.Stock` 이월분을 누락했다. 전산 재고관리 화면과
`usp_StockCalculation`, `FormShipmentDistribution.GetProductList()`는 이월재고를 포함하므로
원장 이상이 아닌 웹 검증 공식 불일치였다.

| 동작 | OrderDetail | ShipmentDetail/Date/Farm | ProductStock/StockHistory | Estimate/매출 |
|---|---|---|---|---|
| ADD 사전검증 | 기존 정책 보존 | 기존 정책 보존 | 읽기만 수행, 쓰기 금지 | 보존 |
| CANCEL/AUTO_CANCEL | 기존 정책 보존 | 기존 정책 보존 | 변경 없음 | 보존 |
| 실패 품목만 재시도 | 성공 품목 재가산 금지 | 실패 품목만 기존 ADD 재호출 | 자동 보정 금지 | 기존 정책 보존 |

가용수량은 `prevStock + currentIn + adjustQty`, 잔량은 `available - totalOut`으로
고정하고 모든 중간값을 0.001 단위로 정규화한다. `prevStock`은 같은 품목의 현재
`OrderYear+OrderWeek` 결합키보다 작은 최신 `ProductStock.Stock`이며 `Product.Stock`을
대체 원천으로 사용하지 않는다. 회귀는 `__tests__/shipmentAvailability.test.js`와
`__tests__/shipmentPivotAdjustContract.test.js`가 담당한다.

## 2026-08-10 붙여넣기 명시 단위 보존 회귀

`알스트로 라벤더 1박스 추가/취소`처럼 사용자가 단위를 직접 썼는데도 품목 매칭 뒤
`Product.OutUnit='단'`이 화면 단위를 덮어써 `1단`으로 미리보기·API 전송되던 회귀가
발생했다. 품목 매칭 결과와 단위 선택을 분리하고, 명시 단위가 있으면 매칭·사용량 순위와
무관하게 해당 단위를 보존한다. 단위 생략일 때만 `Product.OutUnit` 또는 저장된 직전
품목 단위를 사용한다.

| 동작 | OrderDetail | ShipmentDetail/Date/Farm | ProductStock/StockHistory | Estimate/매출 |
|---|---|---|---|---|
| 명시 박스 ADD | 기존 ADD 정책, 박스 환산량 사용 | 기존 ADD 정책, OutUnit 환산량 증가 | 보존 | 보존 |
| 명시 박스 AUTO_CANCEL + 활성 분배 | 주문 보존 | 박스 환산량 감소 | 보존 | 보존 |
| 명시 박스 AUTO_CANCEL + 분배 없음 | 보존 | 오류·전체 롤백 | 보존 | 보존 |
| 단위 생략 | 기존 기본단위 정책 | 기존 정책 | 보존 | 보존 |

`OutUnit='단', BunchOf1Box=10`인 품목의 `1박스`는 BoxQuantity 1,
BunchQuantity/OutQuantity 10으로 환산한다. 필요한 `BunchOf1Box` 또는 `SteamOf1Box`가
0/NULL이면 임의 1 fallback을 금지하고 품목 마스터 확인 오류로 차단한다. 2025/2026
동일 `32-02`는 선택 연도 업무키만 사용한다. 회귀는 `pasteOrderUnit.test.js`,
`adjustUnit.test.js`, `shipmentPivotAdjustContract.test.js`가 검사한다.

## 2026-08-17 붙여넣기 전체 추가·취소 원자적 일괄

화면 전체 업체의 추가·취소를 단건 HTTP 요청으로 계속 처리하면 후반 품목 실패 전에
성공한 취소/추가가 이미 commit되어, 사용자가 원인을 보완한 뒤 전체를 다시 실행할 때
앞선 성공분이 중복 적용될 수 있다. 전체 일괄은 다음 부작용 표와 트랜잭션 경계를 따른다.

| 동작 | OrderDetail | ShipmentDetail/Date/Farm | ShipmentAdjustment/History | Estimate·매출·재고원장 |
|---|---|---|---|---|
| CANCEL + 활성 분배 | 보존 | 기존 `AUTO_CANCEL`로 감소, 0이면 정리 | 같은 트랜잭션에 기록 | 직접 변경 금지 |
| CANCEL + 활성 분배 없음 | 보존 | 오류·전체 롤백 | 롤백 | 직접 변경 금지 |
| ADD + 현재연도 활성 주문 없음 | 양수 생성 | 기존 ADD 정책으로 증가·날짜 동기화 | 같은 트랜잭션에 기록 | 직접 변경 금지 |
| ADD + 현재연도 활성 주문 있음 | 기존 정책대로 증가 | 기존 ADD 정책으로 증가·날짜 동기화 | 같은 트랜잭션에 기록 | 직접 변경 금지 |
| 어느 한 건 실패 | 위 모든 앞선 변경 롤백 | 위 모든 앞선 변경 롤백 | 이력까지 롤백 | 계속 보존 |

서버는 명시된 `OrderYear + OrderWeek + CustKey + ProdKey`를 각 행의 업무키로 사용하고,
선택 연도·차수가 다른 행을 한 batch에 섞지 않는다. 실행 순서는 입력 내 CANCEL 전체를
안정적으로 먼저 처리한 뒤 ADD 전체이며, `force=false`를 서버에서 강제한다.
`pages/api/shipment/adjust.js`의 트랜잭션 범위 코어를 단건/일괄 API가 함께 사용하고,
`pages/api/shipment/adjust-batch.js`만 전체 `withTransaction`을 소유한다.
회귀는 `__tests__/shipmentAdjustBatch.test.js`의 실행형 fake transaction fixture가
앞선 CANCEL 성공 후 ADD 실패 시 committed 결과가 0건인지 검사한다.

## 2026-08-17 주차별 매출이익 포워딩 원천 자동대조

29차 이후에는 항공료 전표가 `WarehouseMaster`/`WarehouseDetail`에 들어온다는 운영 기준을
사용한다. 예전 자동감지는 품명이 `%운송료%` 또는 정확히 `SERVICE FEE`인 행만 읽고,
국가를 추정하지 못한 행을 경고 없이 버렸다. 이 때문에 실제 전표가 있어도 특정 차수·국가의
포워딩값이 0으로 보일 수 있었다.

| 동작 | Order/Shipment/Estimate | ProductStock/StockHistory | Warehouse 원장 | WebProfitReport |
|---|---|---|---|---|
| 포워딩 원천 자동대조 | 보존 | 보존 | `OrderYear+MajorWeek` SELECT only | 보존 |
| 미분류·0원·구매범위 누락 검출 | 보존 | 보존 | 읽기만 수행, 자동 보정 금지 | 보존 |
| 보고서 검증 차단 | 보존 | 보존 | 보존 | 자동 저장·전차수 대체 금지 |

금액행 판정은 한글 운송료·운송비·항공료·항공비와 영문 FREIGHT/AIR FREIGHT/SHIPPING,
`SERVICE FEE`, `현지상차운임`을 포함한다. `Gross weight`와 `Chargeable weight`는 금액이
아닌 무게행이므로 제외한다. 국가·화종 분류는 품목명 명시 규칙, 같은 BILL, 같은 AWB,
농장·인보이스 단서 순이며 어느 단계에서도 근거가 없으면 USD로 추정하지 않고 미분류로 남긴다.
일반 국가·화종 명시 운송료는 대차수 합계로, 콜롬비아 4품목 공유 운송료는 세부차수별
무게배분 원천으로 대조한다. 원천행 수와 통화별 금액은 분류 결과와 항상 대조한다.
29차 이후 미분류·0원·구매범위별 누락·
합계 불일치는 검증 오류로 표시하고 수기 S 또는 0으로 숨기지 않는다.

회귀는 `__tests__/customsForwardingAuto.test.js`가 2025/2026 연도 범위, 28차 역사 호환,
29차 이후 엄격 검증, 명시 규칙, BILL/AWB 연결, 빈 상세행 제외, 통화별 합계 일치를 검사한다.

## 2026-08-26 견적서 품종 범위/재조회 회귀

견적서 수량 편집의 countryFlowers=[]는 전체 확정취소다. 로그에 표시하는 품종만
바꾸어서는 고쳐지지 않는다. EXE/현재 SP의 실제 범위는 선택 CountryFlower이며,
전체 품종 강제는 견적 자동 편집에 적용하면 안 된다. estimate-category-selection
계약의 ProdKey→DB CountryFlower 검증을 사용한다. 중간 일부 성공 뒤 실패하면
성공한 품종만 복구하고 저장 본문은 실행하지 않는다. 응답 불명은 추정 재시도하지 않는다.

목록 API의 items는 첫 거래처 자료다. 선택 업체를 유지할 때 그 items를 재사용하면
선택 업체와 상세 업체가 달라진다. 목록/상세/불일치/오류/로딩 종료 모두 최신 범위와
요청 순서를 검사한다. 단가만 저장은 확정 플래그와 재고를 보존한다.

거래처 검색어는 적용된 거래처와 별도의 초안이다. 일반 입력·붙여넣기·한글 조합·
한영 전환 중 `selectedCust`를 해제하거나 전체 업체 자동조회를 실행하지 않는다.
업체 후보를 명시 선택하거나 필터 해제 버튼을 누를 때만 적용 범위가 바뀐다.
일반 조회·수량·단가·통합·차감 등록/삭제·품목정보 저장 후에는 공통 재조회 경로를
사용한다. 새 목록 요청은 이전 상세/불일치 요청까지 무효화하고 목록→선택 업체
상세 순서로 한 번만 읽는다. 저장이 끝난 시점의 현재 업체가 저장 시작 시점과 다르면
이전 업체를 다시 선택하지 않는다. 같은 업체/차수라도 이전 요청이 새 상세/오류/로딩
상태를 덮지 않는지 `estimateRefreshFlow.test.js`와 `estimateSelectionState.test.js`로 검사한다.
