# 라움·초이문 차수별 매입단가 관리

## 사용자 동작과 부작용

| 동작 | WebRaumPnl | WebRaumPnlItem | WebRaumCostPrice | 주문·출고·재고·견적·주차손익 |
|---|---|---|---|---|
| 연도·거래처 조회 | SELECT | SELECT | 보존 | 보존 |
| 검색·미입력 필터 | 보존 | 보존 | 보존 | 보존 |
| 단가 입력 미리보기 | 보존 | 보존 | 보존 | 보존 |
| 변경 단가 저장 | UpdatedBy/UpdatedAt | 선택 차수 CostPrice/CostSource | 보존 | 보존 |

## 기준 장부

- 화면 범위: 명시적 `OrderYear + PartnerCode`.
- 차수 셀: 활성 `WebRaumPnl.PnlKey + MajorWeek`.
- 품목 묶음: 양수 `ProdKey + 정규화 Unit + IsCustom`; 미매칭은 공백 정규화한 정확한 `ItemName + Unit + IsCustom`.
- 저장 전 확인: 잠근 현재행의 `ItemKey + CostPrice`가 화면 snapshot과 같아야 한다.
- 값: 0은 유효한 단가, 빈칸은 NULL, 음수와 숫자가 아닌 값은 거부한다.
- 여러 매출단가 행: 같은 차수·품목·단위에 속한 행을 한 셀에 보여주며 기존값이 다르면 모두 표시한다. 사용자가 새 단가를 입력한 경우에만 하나로 통일한다.

## 교차연도·근접 실패 항목

- 2025/2026 같은 대차수는 다른 셀이다.
- 라움/초이문 같은 대차수는 다른 셀이다.
- 삭제 결산, 다른 ProdKey의 같은 이름, 같은 ProdKey의 다른 단위, 수동행/일반행은 합치지 않는다.
- 다른 화면에서 행 또는 단가가 바뀌면 409로 전체 저장을 취소한다.

## 손익 반영

라움·초이문 손익 목록과 상세는 저장된 `CostPrice`로 매입액과 이익을 조회 시 계산한다. 따라서 전용 화면에서 저장하고 재조회하면 해당 차수 손익만 새 단가로 계산된다. 다음 차수 자동 입력용 `WebRaumCostPrice`는 과거 차수 수정으로 바뀌지 않는다.

## 칸 표시 정보 (2026-09-01 추가)

각 품목×차수 칸은 수정 가능한 매입단가 입력창과 함께 읽기 전용 참고값을 조밀하게 함께 보여준다.

- 판매가: 저장된 `WebRaumPnlItem.SalePrice` distinct 값(여러 값이면 모두 표시, 평균 금지).
- 매입액: `CostPrice × Qty` 합계. 입력창에 아직 저장하지 않은 draft 매입단가가 있으면 draft × 수량으로 즉시 다시 계산해 보여준다.
- 견적액: 저장된 `WebRaumPnlItem.SaleAmount` 합계.
- 수량: 기존과 동일한 `Qty` 합계.

단가나 금액 원천이 전부 비어 있으면 0원으로 오해하지 않도록 `—`로 표시하고, 같은 품목으로 묶인 행 중 일부만 원천이 있으면 `(일부)`로 표시한다. 사용자가 잘못된 단가 문자를 입력하면 기존 금액으로 되돌려 보이지 않고 `입력 확인`으로 표시한다.

이 4개 값은 GET 조회(`loadRaumPnlCostComparisonRows`)에서만 추가로 읽으며, 저장 API(`saveRaumPnlPurchaseCosts`)의 POST payload·UPDATE 대상·`RAUM_PNL_PURCHASE_COST_WRITE_SQL`에는 포함하지 않는다. 수정 가능한 값은 기존과 동일하게 `CostPrice`뿐이다.
