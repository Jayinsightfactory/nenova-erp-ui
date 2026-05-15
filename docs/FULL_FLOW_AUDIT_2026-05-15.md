# NenovaWeb Full Flow Audit - 2026-05-15

## Scope

전체 시작 범위는 다음 실사용 흐름 기준으로 잡았다.

1. 주문등록, 붙여넣기 주문등록
2. 출고분배, 출고확정, 구간 확정취소
3. 차수피벗, 통계 피벗, 엑셀 다운로드
4. 재고관리, 입고등록, 히스토리
5. Ecount ERP/경영지원 화면의 원본 데이터 매칭 검증

## 이번 라운드에서 바로 수정한 항목

| 영역 | 문제 | 조치 |
|---|---|---|
| 공통 차수 | 일부 API가 `2026-17-01` 입력을 DB 저장 형식 `17-01`로 바꾸지 않아 조회가 비거나 버튼이 동작하지 않는 것처럼 보일 수 있음 | `normalizeOrderWeek`, `normalizeOrderYear` 공통 유틸 추가 |
| 출고분배 API | 조회/저장 시 연도 포함 차수 입력이 그대로 들어갈 수 있음 | `/api/shipment/distribute` GET/POST 정규화 |
| 재고 API | 재고조회/재고조정 시 연도 포함 차수가 그대로 들어갈 수 있음 | `/api/stock` GET/POST 정규화 |
| 통계 피벗 | 범위 조회가 연도 포함 차수에서 비어질 수 있음 | `/api/stats/pivot-data` 차수 범위 정규화 |
| 통계 피벗 수량 | 주문 수량을 `Box+Bunch+Steam` 합산으로 계산해 단위가 섞일 수 있음 | `OrderDetail.OutQuantity` 기준으로 변경 |
| 출고조회/엑셀 | 연도 포함 차수 입력 시 조회/다운로드 누락 가능 | `/api/shipment`, `/api/shipment/excel-download` 정규화 |
| 주문 이력 | 연도 포함 차수로 이력 조회 시 누락 가능 | `/api/orders/history` 정규화 |
| 입고 피벗 | 연도 포함 차수로 입고 피벗 조회 시 누락 가능 | `/api/warehouse/pivot` 정규화 |

## 최신 코드 기준으로 재분류한 상태

| 항목 | 이전 문서 상태 | 최신 코드 확인 |
|---|---|---|
| 재고조정 | `_new_StockHistory` 사용으로 불일치 | 현재 `/api/stock`은 `StockHistory + usp_StockCalculation` 사용 |
| 입고등록 | 재고 cascade 누락 | 현재 `/api/warehouse`는 입고/삭제 시 `StockHistory + usp_StockCalculation` 사용 |
| 일반 주문등록 | Est/NoneOut 누락 가능 | 현재 `/api/orders`, `/api/public/orders`, 모바일 승인 API는 `EstQuantity`, `EstUnit`, `NoneOutQuantity` 보강됨 |
| 차수피벗 | 부분 일치 | `stock-status` API는 차수 정규화, 시작재고/확정재고/이력 기능이 있으나 EXE 공식 100% 비교는 계속 필요 |
| 출고분배 | 부분 일치 | `ShipmentDate`, `ShipmentHistory`는 보강. 단, EXE의 `usp_DistributeOne/Total/Clear`, `ShipmentFarm` 공식과 100% 비교 필요 |

## 계속 남겨야 할 검증

1. Nenova.exe의 `FormShipmentDistribution` 버튼별 동작과 웹 출고분배 버튼을 1:1 비교
2. 차수피벗 엑셀의 컬럼 순서, 수식, 잔량복사 값이 EXE와 같은지 샘플 차수로 비교
3. Ecount ERP 판매/채권/세금계산서/구매 화면의 원본 컬럼과 웹 계산값 비교
4. 모든 조회 API의 `ViewOrder`, `ViewShipment`, `ViewWarehouse` 기준 일치 여부 확인
5. 실제 운영 DB에서 “주문등록 직후 출고분배와 히스토리”가 한 트랜잭션 흐름처럼 남는지 샘플 주문으로 확인

