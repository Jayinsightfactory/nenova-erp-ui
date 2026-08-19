# 작업 완료 보고 — 견적서 수량 0 저장 실패 수정

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 09:50 |
| 사용자 요청 | 견적서관리에서 수량을 0으로 저장하면 오류. 0이면 목록에서 안 보이는 게 맞는지 확인 |
| 브랜치 | `fix/estimate-qty-zero-purge` |

## 원인

견적서 수량 수정은 `update-date-quantity`로 간다. 한 품목의 전체 출고가 0이 되면
`전체 출고수량을 0으로 만들 때는 차수피벗/출고분배의 취소 기능을 사용하세요`로 거절했다.
모달은 저장 시도 로그 뒤에 재확정까지 진행한 다음 일반 문구(`일부 수량 저장 실패`)만 보여
실제 거절 사유가 가려졌다.

## 정상 동작

EXE `FormEstimateView.GetDetail`은 `EstQuantity > 0`만 보여준다. 웹도
`filterActiveEstimateShipmentRows`로 수량 0 정상출고를 숨긴다. 수량 0 저장은
`update-quantity`와 같이 Detail+Date+Farm을 purge하고 주문(`OrderDetail`)은 남긴다.

## 검증

- `npm run test:estimate`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from HEAD`
- `npm run guard:erp-writes -- --changed-from HEAD`
- `npm run build`
