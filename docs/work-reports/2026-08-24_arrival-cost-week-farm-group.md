# 작업 완료 보고 — 도착원가 차수정렬·농장별 원가·품종조회

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-24 |
| 사용자 요청 | 차수 오름/내림, 같은 차수·품목은 농장별 원가, 품명 없이 품종 조회 |
| 브랜치 | feat/arrival-cost-week-farm-group |
| 배포 | PR merge 후 Cafe24 |

## AI 구성

| 담당 | 역할 |
|------|------|
| Cursor 직접 | 이해 확인 후 구현·계약 테스트·배포 |

## 변경 요약

| 파일 | 내용 |
|------|------|
| lib/arrivalCostView.js | 차수>국가>품종>품목 그룹, 농장별 원가 문장 |
| lib/arrivalCost.js | 품종만 조회, 차수 숫자 오름/내림 정렬 |
| pages/arrival-cost.js | 품종 탭(연도만), 차수 정렬 버튼, 그룹 헤더 |
| docs/contracts/arrival-cost.json | 검색 계약 |

주문·출고·견적·재고 원장은 SELECT/표시만. 쓰기 없음.

## 검증

```
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run guard:erp-writes -- --changed-from origin/master
npm run build
```
