# 2026-08-19 견적서 인쇄 — 불량차감 적요 기본 미표시

## 요청
1. 불량차감 적요가 화면에선 안 보이는데 인쇄에 나옴 → 인쇄에서 제거
2. 인쇄 표시여부 체크는 미표시가 기본값

## 결과
- PR #266 `6941f1f` master 병합
- 인쇄 `descLabel`이 불량차감 `Estimate.Descr`을 기본 숨김
- 「불량차감 적요 표시」 체크 시에만 출력
- 화면 그리드 비고는 그대로 표시
- 검역/단가차감 적요, 주문/출고/견적 원장 변경 없음

## 검증
- `npm run test:estimate`
- `node __tests__/estimatePrintFormats.test.js`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from HEAD`
- `npm run guard:erp-writes -- --changed-from HEAD`
- `npm run build`
