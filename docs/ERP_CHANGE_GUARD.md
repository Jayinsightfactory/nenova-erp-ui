# Nenova ERP 기능 변경 가드

작성일: 2026-07-20

## 목적

문서에만 있던 dnSpy/DB 규칙을 코드 계약, 자동검사, 배포 차단 조건으로 연결한다. 대상은 `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `WarehouseMaster`, `StockMaster`, `ShipmentDate`, `ProductStock`, `StockHistory`를 읽거나 쓰는 모든 기능이다.

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

1. `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`를 기준으로 사용자 동작을 행으로, 변경 테이블을 열로 둔 부작용 표를 먼저 작성한다.
2. `docs/contracts/<feature>.json`을 추가·갱신하고 `OrderYear + OrderWeek + CustKey + ProdKey` 업무 키를 선언한다.
3. 쓰기 전 조회 업무 키에 `OrderYear`가 포함됐는지 확인한다. 화면의 선택 연도도 모든 API payload까지 전달한다.
4. 정책 분기는 DB 코드 안에 흩뿌리지 말고 순수 함수로 분리한다.
5. 최소 네 가지 경계 fixture를 만든다: 현재연도 주문 있음/없음 × ADD/CANCEL.
6. 전년도 동일 차수 Master가 존재하는 교차연도 fixture를 반드시 추가한다.
7. `npm run test:erp-contract`, 변경 SQL 스코프 검사, `npm run build`를 통과시킨다.
8. 배포 후 `ViewOrder`, `ViewShipment`, EXE parity API를 같은 네 키로 대조한다.

## 자동 방어 계층

- `AGENTS.md`: Codex가 저장소 진입 시 읽는 강제 작업 규칙.
- `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`: 기능별 부작용·연도전달·배포 전후 체크리스트.
- `docs/contracts/*.json`: 기능 계약과 필수 교차연도 fixture의 기계검사 대상.
- `.claude/skills/nenova-erp-change-guard/SKILL.md`: Claude/에이전트 작업용 동일 절차.
- `$guard-nenova-erp-changes`: 사용자 환경의 Nenova 전용 Codex 스킬.
- `.claude/agents/erp-contract-guardian.md`: 기존 Claude 에이전트 팀용 검증자.
- `scripts/check-erp-write-contracts.mjs`: 변경된 API의 연도 없는 위험 SQL을 탐지.
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
