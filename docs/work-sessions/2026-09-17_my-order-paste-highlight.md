# 내 업체 주문등록 주문만 등록 하이라이트

## 요청

붙여넣기 주문등록에서 주문 원장만 저장된 경우 기존 빨간 강조를 파란 강조로 바꿔, 분배 대기 상태를 즉시 구분한다.

## 변경

- `orderOnlyRegistered` 상태를 업체 주문 카드에 기록한다.
- 주문등록 성공 시 카드 테두리·헤더를 파란색으로 바꾸고 `주문만 등록됨 · 분배 대기`를 표시한다.
- 수량·단위·품목을 다시 수정하거나 분배까지 완료하면 상태를 해제한다.
- `pasteOrderHighlightState` 순수 정책 함수와 회귀 테스트를 추가했다.

## 보존 범위

주문·분배 API, SQL, 원장 계산은 변경하지 않았다. UI 상태와 표시만 변경했다.

## 검증

- `node __tests__/pasteOrderHighlight.test.js`
- `node __tests__/pasteSplitActionLayout.test.js`
- `node __tests__/pasteOperationAudit.test.js`
- `npm run test:erp-contract`

