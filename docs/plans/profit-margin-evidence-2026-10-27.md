# 원가 미확정·운영 저장본 대사 근거 보완

## 요청과 경계

- 사용자: DB를 변경하지 않고 119품목 원가 미확정과 운영 저장본·SQL 경고를 진단하고, 웹이 놓친 근거만 보완하여 검증·배포한다.
- 기준: `cb485cbc9b5cefb830d6336a684026b102729158` (`codex/profit-margin-evidence`). 이전 업체비중·판매마진 기능의 별도 관리분석이며 기존 주차별 수익률 계산을 교체하지 않는다.
- 실제 근거가 없는 양수 재고조정은 판매단가·현재 환율·다른 품목 평균으로 채우지 않는다. 반대 부호의 같은 수량만으로 조정 취소/반품 취득원가를 인정하지 않는다.
- `VERIFIED` 표시만 신뢰하지 않는다. 근거가 판매단가이거나 운송·통관비가 빠진 구매단가이면 평균 **도착원가**의 기초 평가액으로 승격하지 않는다.

## 구현 전 근거

- 설치 EXE SHA256: `FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79`.
- 이번 작업에서 dnSpy CLI `FormSalesView`, `FormStockView`를 다시 추출했다(각 exit 0). 전자는 `ViewShipment.Amount` 집계, 후자는 실제 차수/이전 차수 재고와 입고·출고·조정을 분리하고 조정 수량 ROUND 2를 사용한다. 로컬 근거: `.verify/dnspy-FormSalesView.txt`, `.verify/dnspy-FormStockView.txt`.
- 기존 native 근거: `docs/exe-golden/FormProfitReport.md`, `docs/exe-golden/ProfitInventoryCycleEvidence.md`, `docs/plans/profit-customer-margin-2026-10-27.md`. 원본 SP는 SELECT로 정의만 확인하며 실행/수정하지 않는다.
- 담당 SELECT-only probe: 2026년 39차/38차, 875 SELECT, writes 0, 6.827초. 39차 판매품목 295 중 확인176/미확정119 재현. 사유는 중복되며 양수조정 원가 미확인, 입고행 완전성, 조회한도, 단위/환율/재고수량 검산을 구분한다.
- `pivotFreightArrival`이 동일 ProdKey 복수 입고의 계산행을 첫 품목행에 재연결하는 부분 확인. 신규 분석에서만 WdetailKey의 정확한 1:1 관계를 사용하고 기존 보고서의 기본 호출/숫자는 보존한다.
- 대사 결과는 기존 API에 존재하지만 화면은 일반 경고만 표시했다. 운영 경고의 실제 원인은 운영 응답의 카테고리별 N/L/O 차액과 저장 시점을 확인하기 전까지 미확정이다. 로컬 대사 일치만으로 운영 경고를 오탐이라고 처리하지 않는다.

## 사용자 동작·부작용 표

| 동작 | 조회/계산 | 만들기·증가·감소 | 보존 |
|---|---|---|---|
| 업체비중·판매마진 조회 | 연도/차수/업체/품목별 확정 매출과 정확 입고행, 실제 0재고 앵커 이후 근거 | 없음 | Order/Shipment/Stock 원장 전체 |
| 미확정 사유 확인 | 누락 입고행·수량·환율·원가/출처와 검산 사유 | 없음 | 원천 가격·단위·조정 사유 |
| 저장본 대사 확인 | 현재/비교 차수 N/L/O, 차액·총계·분류 근거·저장 시점 | 없음 | 기존 확정본·자동 저장본·수익률 |

### 견적·매출 downstream

| 대상 | 정책 |
|---|---|
| Estimate | SELECT만; 금액/유형/행수 보존 |
| ShipmentDetail.Amount/Vat/isFix | SELECT만; OutQuantity와 EstQuantity를 혼동하지 않음 |
| ShipmentMaster/ShipmentDate/OrderDetail/ShipmentFarm | 공유 ERP 쓰기 없음; 기존 연도·차수·CustKey 연결 보존 |
| ProductStock/StockMaster/StockHistory | 조회만; 재계산 SP·실사보정·조정상쇄 없음 |
| WarehouseMaster/Detail, FreightCost/Detail 및 환율 근거 | 조회만; WdetailKey 일치와 누락 여부를 검증 |
| WebProfitReport 및 저장/확정 snapshot | 읽기만; 저장·refresh·재확정 없음 |
| 정상 인증·보안 감사 | 기존 인증 및 정상 GET 감사 유지; 우회 토큰/로그 비활성화 없음 |

## 승인 기준 / 배포 차단

1. 같은 품목 여러 입고행을 서로 다른 WdetailKey로 구분한다. 엄격 모드의 키 누락/중복/미매칭은 첫 ProdKey 행으로 대체하지 않는다.
2. 정확한 과거 0재고 앵커 이후 필요한 입고만 읽고 12세부차수 임의 제한 때문에 근거를 놓치지 않는다. API 횟수/시간을 측정하여 과도한 전수 조회 회귀를 확인한다.
3. Native 세부차수 수량 반올림과 실제 단위 충돌을 구분한다. 반올림으로 금액/취득원가 누락을 숨기지 않는다.
4. 기존 보고서 calc/확정본을 전후 대조한다. 원래 수익률이 변경되거나 DB 쓰기 시도가 나오면 배포 차단.
5. 대사 경고는 현재/비교 차수·국가/품종·N/L/O·SQL/저장값·차액·출처/시간으로 설명한다. 누락값을 0으로 바꾸지 않는다. 분류 변경은 실제 효과가 증명된 경우만 원인으로 표시.
6. 경량 `view=reconciliation`은 동일 인증/연도/업무달력 경계를 유지하고 원가 전수 재계산을 하지 않는다.
7. 계약·교차연도·정책 회귀와 `verify:erp-change`, 빌드를 모두 통과한 뒤 PR/CI/squash/Cafe24 배포. 배포 후 ping 및 로그인된 실제 화면에서 근거/대사/원래 수익률을 확인한다.
8. 실제 남은 미확정은 명시적으로 남긴다. 원가 확인률 상승을 모든 재고·수익률의 실사 인증으로 설명하지 않는다.

검증 결과·PR·배포·남은 원인은 작업 세션 문서에 기록한다.
