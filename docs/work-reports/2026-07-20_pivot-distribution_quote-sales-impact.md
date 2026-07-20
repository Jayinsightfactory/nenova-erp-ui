# 2026-07-20 차수피벗 농장분배 변경의 견적·매출 영향 검증

## 범위

이번 검증 대상은 29-02에서 `주광농원 / CARNATION rodas`가 화면에는 보이지만
농장배정 저장 단계에서 누락되던 회귀다.

- `pages/api/shipment/farm-distribution.js`
- `pages/api/shipment/adjust.js`
- `lib/shipmentFarmCandidates.js`
- 진단 API의 연도 전달 및 견적 노출 진단

## 코드 영향 판정

| 경로 | 이번 변경의 쓰기 대상 | 견적/매출 원장 직접 변경 |
|---|---|---|
| farm-distribution GET | 없음 | 없음 |
| farm-distribution POST | `ShipmentFarm`, `ShipmentDetail.Descr` | `Estimate`, `WebProfitReport`, 영업 매출 원장 없음 |
| adjust 후보 검증 | 후보 조회 범위만 변경 | 주문·출고 수량/금액 계산식 변경 없음 |
| estimate-visibility / item-trace | 읽기 전용 진단 | 없음 |

차수피벗의 실제 ADD/CANCEL은 별도 계약대로 동작한다. 현재연도 활성 주문이
없을 때의 ADD만 양수 주문을 만들고, 활성 주문이 있는 ADD와 모든 CANCEL은
주문등록수량을 보존한다. 이 변경의 후보 범위 수정은 이 정책을 변경하지 않는다.

## 운영 read-only 결과

검증 대상: 2026년 29-02, `CARNATION rodas`

### 주문·분배 진단

| 업체 | 주문 | 분배 | ShipmentDate | ShipmentFarm | 출고일 | 상태 |
|---|---:|---:|---:|---:|---|---|
| 주광농원 | 1 | 1 | 1 | 1 | 2026-07-19 | 정상 |
| 주식회사 트라움에스앤씨 (라움) | 1 | 1 | 1 | 없음 | 2026-07-15 | 농장미배정 |

주광농원 행의 실제 분배 레코드는 `ShipmentKey=5542`, `SdetailKey=81633`,
수량 1이며 전산 표시 상태가 `표시`다. 라움 행은 이번 대상이 아니므로
변경하지 않았다.

### 견적 노출 진단

전산 견적 SQL의 최종 조건은 `ViewShipment + ViewOrder + ShipmentDate +
PeriodDay + DetailFix=1`이다. 운영 견적 화면에서 29차의 주광농원을 선택해
확인했을 때 `CARNATION rodas`는 실제 견적 상세 행에 나타나지 않았다. 판매현황과
동일하게 아직 확정 출고가 아닌 상태이므로, 농장배정 보정만으로 견적 금액이
생성된 증거는 없다.

기존 `/api/shipment/estimate-visibility` 진단은 구조 조인 결과에서 `DetailFix=1`
을 빠뜨려 이 행을 “정상(견적 노출)”로 오판할 수 있었다. 이번 작업에서 진단의
`InGetDetail`/`InGetDetailByCustProd`에도 `DetailFix=1`을 추가해 EXE SQL과
일치시켰다. 배포 후 같은 키로 진단을 재실행해야 최종 진단 상태까지 갱신된다.

### 매출 영향

판매현황에서 차수 `29-02`만 조회한 결과는 48건, 11개 업체, 정상출고
공급가 `31,223,728원`, VAT 포함 `34,323,100원`이었다. `CARNATION rodas`
대상 행은 확정 매출 목록에 나타나지 않았다.

이는 해당 분배가 아직 확정 매출 조건(`ShipmentDetail.isFix=1`)에 들어가지
않았기 때문이다. 농장배정 저장만으로 `Amount`, `Vat`, `isFix`를 변경하지
않으므로 확정 매출을 임의로 생성하지 않는다. 이후 정상적인 출고확정이
이뤄질 때에만 해당 출고 금액이 매출·손익에 반영되는 것이 의도된 동작이다.

## 재발 방지 조치

- `lib/shipmentFarmCandidates.js`에 EXE와 동일한 제품 전체 후보 scope를 단일 정의
- 모달 GET, farm-distribution POST, adjust 트랜잭션 검증에서 동일 상수 사용
- 견적 노출 진단에 EXE와 같은 `DetailFix=1` 조건 적용
- `shipmentFarmContract.test.js`: 후보 scope parity 검사
- `shipmentDownstreamImpactContract.test.js`: farm-only 원장 보존 및 견적·매출 집계 조건 검사
- `ERP_CHANGE_GUARD.md`, `ERP_FEATURE_CHANGE_CHECKLIST.md`, `AGENTS.md`, Claude
  skill/agent, Codex `guard-nenova-erp-changes`에 downstream read-only 검증 절차 반영

운영 데이터 보정은 코드 배포 후 별도 단계로 유지하며, 매출·견적 원장을 직접
보정하는 작업은 이번 변경 범위에 포함하지 않는다.
