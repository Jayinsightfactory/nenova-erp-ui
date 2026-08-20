# 작업 완료 보고 — 호텔+미우 업체·차수 선택형

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 10:05 |
| 사용자 요청 | 업체는 검색이 아니라 라움·신라·쵸이문·미우 기본 선택. 추가 가능. 차수는 기본+1+2+3 총 4개 |
| 브랜치 | feat/hotel-miu-select-chips |
| 커밋 | (PR 병합 시 기록) |
| 배포 | 검증 후 Cafe24 |

## AI 구성

| 담당 | 역할 |
|------|------|
| Cursor | 구현·검증·배포 |

## 작업 흐름

1. 기본 4개 업체를 Customer 이름으로 찾아 큰 버튼으로 표시. 검색은 +추가 때만.
2. 차수는 오늘 기본차수부터 세부차수 4칸(예: 34-01 ~ 34-04).
3. 선택한 연도·차수·CustKey만 이후 합산/주문등록에 사용. 출고 원장은 그대로.

## 검증

```
node __tests__/hotelMiuIntake.test.js
npm run test:ui-layout
npm run test:nenova-dnspy-evidence
npm run guard:erp-writes -- --changed-from origin/master
npm run build
```
