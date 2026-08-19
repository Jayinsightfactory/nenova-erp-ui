# 2026-08-19 견적 부가세 수식을 EXE 규약으로 통일 (새 쓰기 한정)

## 요청

단가 수정이 재고에 문제를 일으키지 않는다는 가설을 dnSpy로 검증하고, 품목·수량·단가
입력 시 DB에 저장되는 파생값과 버튼별 경고를 확인할 것. 확인 결과 드러난 부가세 수식
차이는 **새 쓰기만** 정리(원장 소급 재계산 없음).

## dnSpy 검증 결과 (근거: `docs/exe-golden/CostQuantityStockImpact.md`)

가설은 원장 수준에서 맞다.

- `usp_StockCalculation`을 호출하는 지점은 EXE 전체에서 확정/확정취소·주문저장·입고·재고조정
  뿐이고 **`btnSave` 경로에는 없다.** `FormEstimateView`는 단 한 번도 호출하지 않는다.
- `FormShipmentDistribution.btnSave_Click`이 수량 변경 여부로 직접 분기한다. 수량이 그대로면
  `ClassShipmentDate.UpdateCost()`로 `Cost/Amount/Vat`만 UPDATE하고 `ShipmentDate` 행을
  재생성하지 않는다. 단가는 재고 수치에 관여하지 않는다.
- 단, EXE에는 확정차수 단가수정 정식 경로가 없다(`FormEstimateView`의 단가 컬럼
  `AllowEdit=false`, `FormShipmentDistribution`은 확정 시 `btnSave` 잠금). 그래서 EXE에서
  확정차수 단가를 고치면 확정취소→재확정이고, 이때는 **각각 무조건** 재고 재계산이 붙는다.
  웹의 지연은 여기서 온다 — 단가가 재고에 관여해서가 아니라 사이클 자체가 굵어서다.

저장 파생값·버튼별 경고 표는 위 문서 §2, §3에 고정했다.

## 이번 변경

부가세를 EXE 규약(`Vat = 총액 − Amount`)으로 통일. `Amount` 산출식은 건드리지 않았다.

| 파일 | 변경 |
|---|---|
| `pages/api/estimate/index.js` | 불량/검역 INSERT를 `amountVatFromCostEst`로 |
| `pages/api/estimate/update-cost.js` | 동일 |
| `pages/api/estimate/update-quantity.js` | 동일 |
| `pages/api/estimate/update-entry.js` | 동일 |
| `pages/estimate.js` | 불량차감 모달 미리보기를 저장값과 일치시킴 |
| `.gitignore` | `.agent_tmp/` 추가 — 운영 DB SP 본문 덤프 커밋 방지 |

### 영향 범위가 좁은 이유

`1 ≤ 총액 ≤ 200,000` 전수 확인 결과 **정수 총액에서는 두 수식이 한 건도 갈리지 않는다.**
`Math.round(t/1.1) + Math.round(t/11) = t`가 정수 `t`에서 항등이기 때문이다. 드리프트는
소수 `EstQuantity`(분수 박스, `155송이 ÷ 30 = 5.17`)에서만 발생한다. 그래서 확정 54,895행
중 3행만 어긋났고, 정수 수량 행의 저장값은 이번 변경 전후가 완전히 동일하다.

확정 매출 소급 재계산은 하지 않았다. 3행·약 3원을 위해 원장을 건드리는 것은 비례하지 않는다.

## 검증

- `npm run test:estimate` (신규 `estimateAmountVatParity` 포함)
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from HEAD^`
- `npm run guard:erp-writes -- --changed-from HEAD^`
- `npm run build`

## 남은 작업

- 확정차수 총수량 불변 편집을 사이클 밖으로 빼는 설계(§4-1). `update-cost.js`의
  `FIXED_WEEK` 가드가 막는 '되돌림'을 실측 재현해야 착수 가능 — 운영 아닌 차수 1건으로
  직접 저장 후 확정취소·재확정을 돌려 값 보존을 확인하는 실험이 선행 조건.
