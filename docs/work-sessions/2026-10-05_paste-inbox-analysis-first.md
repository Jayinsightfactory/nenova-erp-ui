# 붙여넣기 영업방 원문 분석 진입

## 사용자 요청

붙여넣기 주문등록의 영업방 원문·최신 전산 이력에서 원문 작업을 시작할 때 `현재 입력 내용을 선택한 영업방 대화로 바꿀까요? 아직 주문·분배는 처리하지 않습니다.` 확인창이 나오는 이유를 물었다. 이번에는 실제 분배 저장을 실행하기보다 선택한 대화를 먼저 처리하라는 요청으로 해석했다.

## 원인

`DistributionSalesInbox`의 행 단위 준비/AI 분석 동작과 `입력칸으로` 동작이 같은 `onLoadText` 입력 교체 콜백을 공유한다. 콜백이 기존 입력 내용을 확인하는 `window.confirm`을 무조건 띄워, 사용자가 해당 행에서 명시적으로 원문 분석 또는 등록·분배 준비를 시작한 경우에도 다시 확인하게 했다.

## 변경

- 행 단위 `autoAnalyze` 명시 동작은 기존 입력 교체 확인만 건너뛰고 선택된 대화로 입력을 바꾼 뒤 기존 준비 분석 결과를 parse 검토 화면에 연결한다.
- 일반 `입력칸으로` 동작에는 기존 교체 확인을 유지한다.
- 분석·매칭과 등록·분배 원장 저장은 분리한다. 이 경로에서는 `OrderMaster`, `OrderDetail`, `ShipmentMaster`, `ShipmentDetail`을 변경하지 않으며 실제 등록·분배는 별도 검토 후 동작으로 남긴다.
- `distribution-sales-inbox.json`에 행 단위 준비 분석과 원장 미저장 경계를 기록하고 UI 회귀 검사를 추가했다.

## 검증

- `node __tests__/pasteFourColumnLayout.test.js`
- `npm run test:ui-layout`
- `npm run test:erp-contract`
- `npm run test:erp-manifest -- --changed-from HEAD^`
- `npm run guard:erp-writes -- --changed-from HEAD^`
- `npm run test:nenova-dnspy-evidence`
- `npm run build`

설치된 종속성으로 최신 `origin/master` 기준의 별도 작업 트리에서 재검증했다. 정적 테스트와 production build를 통과했다. 운영 ERP 쓰기나 실제 주문·분배는 실행하지 않았다.
