# 붙여넣기 품목 매칭 입고물량 표시

## 기준 원천 → 사용 위치

| 기준 | 원천 | 사용 위치 |
|---|---|---|
| 연도·차수 | 화면의 등록 차수 | GET year/week, SQL `wm.OrderYear + wm.OrderWeek` |
| 품목 | 사용자가 확정한 매칭 ProdKey | 최대 300개 파라미터 조회 |
| 입고수량 | dnSpy FormWarehouseView / WarehouseDetail.OutQuantity | 품목별 SUM 표시 |
| 단위 | Product.OutUnit | `입고 N 박스/단/송이` |
| 삭제 | WarehouseMaster.isDeleted=0 | 삭제된 입고 제외 |

미지정 차수/품목은 조회하지 않는다. 0은 `입고 0`으로 표시한다. 같은 차수명의 전년도 행은 선택 연도가 다르므로 제외한다. 차수 또는 품목 매칭 변경 시 이전 요청을 AbortController로 취소한다.

## 부작용 표

| 동작 | Warehouse | Order | Shipment | Stock | Estimate/Profit |
|---|---|---|---|---|---|
| 매칭 품목 입고 조회·표시 | SELECT만 | 보존 | 보존 | 보존 | 보존 |

별도 운영 DB probe 자격은 이 로컬 worktree에 없어 실행하지 않았다. 기존 DB 구조 문서, 전산 dnSpy CLI 실실행, 동일 Warehouse SQL을 사용하는 재고 조회 계약과 실행형 교차연도 helper/test로 검증한다.

## 검증

- positive: 2026/29-02/ProdKey10 입고 2단 → `입고 2 단`
- zero: 동일 범위 입고 없음 → `입고 0 단`
- near-miss: 2025 동일29-02는 `wm.OrderYear=@orderYear`로 제외
- 미지정·잘못된 품목키·300건 제한·대량 UI 250건 분할·차수변경 요청취소 검증
- `test:pivot-adjust`, `test:erp-contract`, dnSpy evidence, ERP manifest, write guard, Next build 통과
