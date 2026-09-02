# 2026-09-02 견적서관리·붙여넣기 회귀 방지 기록

## 세션 메타데이터

- 날짜: 2026-09-02 (KST)
- 작업명: 오늘 발생한 견적서관리·붙여넣기 주문등록 문제 저장 및 재발 방지
- 작업공간: `nenova-erp-ui`
- 상태: 아래 PR 모두 master 병합·Cafe24 배포·실브라우저 hydration smoke 완료
- 운영 DB/ERP 원장 보정: 없음

## 사용자 의도

오늘 실제 사용 중 드러난 문제와 원인을 문서·계약·회귀 테스트로 남겨, 다음 견적서관리 또는 붙여넣기 주문등록 작업이 과거 조건을 다시 누락하지 않게 한다.

## 질문 → 처리 요약

### 1. 붙여넣기 일괄 처리 진행상태가 보이지 않고 멈춘 것처럼 보임

- 문제: 전체 취소→추가 작업이 실행 중이어도 단계별 로그와 timeout 안내가 충분하지 않았다.
- 처리: 실행 단계·경과·timeout 및 서버 진행상태를 표시하도록 보완했다.
- 관련 PR: #472 (`c067bd7`)
- 재발 방지: 일괄 작업은 클릭 즉시 진행 UI를 만들고, preflight/취소/추가/검증/rollback 단계가 모두 종료 상태를 남겨야 한다.

### 2. 견적서관리 담당자·업체 선택 UI가 요청한 버튼형이 아님

- 문제: 담당자와 업체가 드롭다운이라 반복 선택이 불편했다.
- 처리: 담당자·업체를 기본 펼침 버튼으로 표시하고 담당자 선택 시 업체 버튼을 즉시 필터링했다. 업체 버튼은 기존 상세 조회 경로를 재사용한다.
- 관련 PR: #473 (`9ddd5a0`)
- 재발 방지: 이 화면의 담당자·업체 선택은 `select`로 되돌리지 않는다. `1920×1080`, 100% 확대에서 줄바꿈 버튼형을 기본으로 검증한다.

### 3. 출고요일이 임의로 목요일 하나만 활성화됨

- 원인: 인쇄창 출고일 분포 조회 후 전체 7요일 상태를 첫 출고요일 하나로 자동 축소했다. 첫 요일이 목요일인 업체에서 목요일만 선택됐다.
- 처리: 자동 축소를 제거했다. 초기 진입·업체 선택·인쇄창 진입은 전체 7요일이며 사용자가 직접 요일을 눌렀을 때만 축소한다.
- 관련 PR: #474 (`783dcfd`)
- 재발 방지: 출고일 분포는 안내 데이터일 뿐 필터 상태를 변경하지 않는다. `activeWD` 기본값과 명시적 사용자 클릭을 구분한다.

### 4. 수량·단가 동시 수정 시 업체 지정단가 저장 버튼이 사라짐

- 원인: 업체 지정단가 버튼 렌더 조건이 `editedCount > 0 && editedQtyCount === 0`으로 제한되어 있었다.
- 처리: 동시 수정 시 `수정 저장 + 업체 지정단가` 버튼을 표시하고 `applyAllEdits('fixed')`로 명시 전달한다.
- 관련 PR: #475 (`1264d33`)
- 재발 방지:
  - 일반 `수정 저장`: 현재 견적서 수량·단가만 저장.
  - `수정 저장 + 업체 지정단가`: 기존 수량 저장 경로 + 선택 업체·수정 품목의 `CustomerProdCost`만 저장.
  - 불량·검역·판매요청 `Estimate` 행은 업체 지정단가에서 제외한다.
  - 다른 업체·품목·차수는 보존한다.

### 5. 견적서관리에서 검역차감이 불러와지지 않음

- 원인: 등록된 `Estimate` 검역차감 조회가 `PeriodDay`와 `CodeInfo`를 `INNER JOIN`해, 과거 검역 코드 또는 날짜 보조정보가 없으면 원장 행이 누락됐다.
- 처리:
  - `Estimate` 차감행의 `PeriodDay`/`CodeInfo`를 보조정보 `LEFT JOIN`으로 변경.
  - 코드표 미매칭 시 원본 `Estimate.EstimateType`을 표시.
  - 요일정보가 없는 차감도 표시.
  - 특정 요일 필터는 정상출고에만 적용하고 모든 `Estimate` 차감행은 유지.
- 관련 PR: #476 (`b09caa3`)
- 재발 방지: `Estimate`는 등록 차감의 원본이고 `CodeInfo`·`PeriodDay`는 표시용 보조정보다. 보조정보 누락으로 원장행을 제거하지 않는다.

## 관련 계약과 테스트

- `docs/contracts/estimate-print.json`
  - `ESTIMATE_LIST_FILTER_BY_MANAGER_CUSTOMER`
  - `ESTIMATE_WEEKDAY_DEFAULT_ALL`
  - `ESTIMATE_LEGACY_QUARANTINE_VISIBLE`
- `docs/contracts/estimate-cost-update.json`
  - `QUANTITY_PRICE_WITH_CUSTOMER_FIXED_COST`
- `__tests__/estimateManagerFilter.test.js`
- `__tests__/estimatePrintContract.test.js`
- `__tests__/estimateCostOnlyUi.test.js`
- `__tests__/estimateEditYearContract.test.js`
- `__tests__/exeEstimateViewSql.test.js`
- `__tests__/estimateInvariants.test.js`

## 다음 관련 작업의 필수 확인

견적서관리 또는 차감 조회를 수정하기 전에 다음을 먼저 확인한다.

1. 담당자·업체는 기본 펼침 버튼형인가.
2. `activeWD`는 기본 전체 7요일이며 조회·모달 effect가 임의 변경하지 않는가.
3. 단가만 수정, 수량만 수정, 수량+단가 수정, 수량+단가+업체 지정단가의 네 UI fixture가 모두 있는가.
4. `mode=fixed`는 명시적 버튼에서만 전달되고 선택 `CustKey + ProdKey` 외 범위를 보존하는가.
5. 검역·불량 등 `Estimate` 행이 `CodeInfo`/`PeriodDay` 누락 때문에 사라지지 않는가.
6. 특정 요일 선택 시 정상출고만 필터링되고 차감행은 유지되는가.
7. 목록·상세·인쇄가 같은 `OrderYearWeek + CustKey`를 사용하고 전년도 동일 차수를 섞지 않는가.
8. 아래 필수 검증을 모두 통과했는가.

```powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from origin/master
npm run guard:erp-writes -- --changed-from origin/master
npm run build
```

## 변경/보존 부작용 표

| 동작 | Estimate | ShipmentDetail/ShipmentDate | CustomerProdCost | Order/Stock |
|---|---|---|---|---|
| 담당자·업체 버튼 선택 | 읽기만 | 읽기만 | 보존 | 보존 |
| 요일 필터·인쇄창 조회 | 읽기만 | 읽기만 | 보존 | 보존 |
| 수량+단가 일반 저장 | 단가 대상 행만 기존 계약 | 기존 수량·금액 저장 계약 | 보존 | 기존 수량 계약 외 보존 |
| 수량+단가+업체 지정단가 | 차감행 업체단가 제외 | 기존 수량·금액 저장 계약 | 선택 업체·수정 품목만 | 기존 수량 계약 외 보존 |
| 검역차감 조회 | 읽기만, 누락 없이 표시 | 읽기만 | 보존 | 보존 |

## Clean-context handoff

`docs/work-sessions/2026-09-02_estimate-and-paste-regression-guards.md`를 먼저 읽고 견적서관리/붙여넣기 관련 작업을 계속하라. 특히 버튼형 담당자·업체 선택, 전체 7요일 기본값, 수량+단가 동시 작업의 업체 지정단가 버튼, 레거시 검역차감의 CodeInfo/PeriodDay 독립 표시 계약을 보존하라. 변경 전에 관련 계약 JSON과 회귀 테스트를 갱신하고 ERP 필수 가드·빌드·Cafe24 실브라우저 smoke까지 완료하라.
