# 작업 완료 보고 — 영업지원 업체 견적서 열기 (2026-08-25)

## 요청
영업지원 전산등록 처리상태에서 청화원예처럼 해당 차수·해당 업체 불량차감 현황을 바로 보게 한다.

## 결과
- 처리상태에 `{거래처명} 견적서 열기` 버튼 추가
- `/estimate?popup=1&year=&week=&custKey=&highlightDeductions=1` 딥링크
- 기존 GetData/GetDetail만 재사용, Estimate/Order/Shipment/Stock 쓰기 없음
- 같은 33차 2025/2026은 화면 선택 연도로 구분

## 검증
- `node __tests__/pasteFixStatus.test.js`
- `node __tests__/salesDefectDeductions.test.js`
- `npm run test:erp-contract`
- `npm run test:nenova-dnspy-evidence`
- `npm run test:erp-manifest -- --changed-from origin/master`
- `npm run guard:erp-writes -- --changed-from origin/master`
- `npm run build`
