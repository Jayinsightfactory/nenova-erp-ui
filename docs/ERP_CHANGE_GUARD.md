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
