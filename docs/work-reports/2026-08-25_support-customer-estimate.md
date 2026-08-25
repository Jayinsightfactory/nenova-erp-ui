# 작업 완료 보고 — 영업지원 업체 견적서 열기·이월/보완필요 (2026-08-25)

## 요청
1. 해당 차수·업체 불량차감 견적서를 바로 연다.
2. 처리상태에 출고 없음 대신 몇 차부터 이월인지, 등록 가능/불가만 보여 준다. 보완필요는 표시만.

## 결과
- `{거래처명} 견적서 열기` 딥링크
- 처리상태: 등록 가능 / 등록 불가, `N년 M차부터 이월`
- 보완필요는 수입부 열 표시. 선택·등록을 막지 않음
- 출고 조회는 OrderYear + 부모차수 정수 / OrderYearWeek. 단가 조회 실패가 출고 없음을 덮지 않음
- Order/Shipment/Stock 보존. Estimate는 기존 명시 등록 경로만

## 검증
- `node __tests__/salesDefectDeductions.test.js`
- `node __tests__/salesDefectDeductionState.test.js`
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from origin/master`
- `npm run guard:erp-writes -- --changed-from origin/master`
- `npm run build`
