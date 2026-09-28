# 농장 불량 피드백 농장명 누락

## 질문 → 답변

- 질문: 농장 불량 피드백에서 `농장 미지정`은 왜 표시되는가?
- 답변: 2026년 38차 `날마다, 꽃(매일)` Hydrangea Blue 15 스팀 건은 화면에서 수입부 확인이 완료된 것으로 보였지만 농장이 `미지정`으로 노출됐다. 39차의 미확인 6건과는 구별해야 한다.
- 확인: 농장 불량 소스 조회는 `WebSalesDefectDeduction.FarmName` 스냅샷만 표시했고, FarmKey가 존재해도 스냅샷명이 공백이면 `농장 미지정`으로 처리했다.
- 수정: 읽기 SQL에서 활성 `Farm`을 `FarmKey`로 조인하고, 저장 스냅샷명을 우선하되 비었을 때만 현재 `Farm.FarmName`을 대체 표시한다. Farm이 없거나 삭제 상태면 미지정으로 유지한다.
- 부작용 경계: `WebSalesDefectDeduction`과 `Farm`은 조회만 한다. 재고·주문·출고·불량 원본·피드백 이력은 쓰거나 보정하지 않는다.

## Side-effect matrix

| 사용자 동작 | WebSalesDefectDeduction | Farm | WebFarmQualityCase/Event/Evidence | Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport |
|---|---|---|---|---|
| 농장 불량 피드백 조회 | read | read | preserve | preserve |
| 피드백 이력/증거 작업 | preserve | preserve | existing explicit workflow only | preserve |

## 검증

- 회귀: 스냅샷명이 있으면 우선, 공백이면 FarmKey의 활성 농장명으로 fallback, Farm 부재/삭제 시 미지정 유지.
- 통과: `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run build`.
- 운영 반영은 코드 배포만 수행한다. 운영 DB 쓰기/보정은 하지 않는다.
