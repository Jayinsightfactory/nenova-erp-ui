# 라움·초이문 매입단가 표시·사입 연결 기준

## 요구 조건

- 공통 매입단가 화면은 품목별로 실제 자료가 있는 차수만 최신순으로 붙여 보여준다.
- 일반행과 `(사입)`행은 품목명과 단위가 같을 때 매입단가만 연결한다.
- 수량·판매가·매출액·사입 구분은 행별로 계속 분리한다.
- 사입행의 직접 입력값은 보존하고, 후보 단가가 하나일 때만 자동 연결한다.

## 판정 기준

| 축 | 기준 |
| --- | --- |
| 연도 | 명시한 `OrderYear` 안에서만 조회·수정 |
| 차수 | `MajorWeek`; 해당 품목 행이 있는 차수만 표시 |
| 거래처 | 라움·초이문을 함께 보되 판매가·수량·금액은 각각 표시 |
| 품목 | `ProdKey+단위`; `ProdKey`가 없으면 끝의 `(사입)`/사입을 제거한 정확한 품목명+단위 |
| 사입 | 일반행과 행 병합 금지; 매입단가만 유일 후보일 때 연결 |
| 충돌 | 같은 품목·단위에 서로 다른 단가가 있으면 자동 선택·평균 금지 |

## 변경 범위

| 행동 | 수정 | 보존 |
| --- | --- | --- |
| 공통 단가 저장 | 존재하는 라움·초이문 `WebRaumPnlItem.CostPrice/CostSource`, 해당 `WebRaumPnl.UpdatedBy/UpdatedAt` | 없는 행 신규 생성 안 함 |
| 사입 단가 연결 | 빈 또는 기존 자동연결 `CostPrice/CostSource` | `Qty`, `SalePrice`, `SaleAmount`, `IsConsigned`, `ProdKey` |
| 화면 압축 | 표시 배치만 변경 | 저장 API·동시수정 snapshot 규칙 |

`OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Estimate`, `ProductStock`, `StockHistory`, `WebProfitReport`, `WebRaumCostPrice`, `Product`는 이 작업으로 수정하지 않는다.

## 근거·검사

- EXE 근거: `docs/exe-golden/FormRaumPnl.md`
- ERP 계약: `docs/contracts/raum-pnl-settlement.json`
- 회귀 검사: `__tests__/raumPnlPurchaseCost.test.js`, `__tests__/raumPnlConsignedCost.test.js`
- 기준 화면: 1920×1080, 빈 차수 셀 미표시, 품목별 차수 카드 줄바꿈
