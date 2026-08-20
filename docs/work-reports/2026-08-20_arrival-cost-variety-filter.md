# 작업 완료 보고 — 도착원가 검색 품종 버튼

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-20_arrival-cost-variety-filter.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 16:00 |
| 사용자 요청 | 화이트처럼 여러 품종이 나오면 품종 버튼으로 카네이션만 좁히기 |
| 브랜치 | feat/arrival-cost-search-variety |
| 커밋 | (이 변경과 함께 기록) |
| 배포 | PR 병합 후 Cafe24 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor 직접** | 품종 버튼 UX, 목록 SQL 품종 필터, 테스트·계약·build | — |

**분담 기준**

- Cursor만: 도착원가 검색 UI와 SELECT 필터만 바꾸면 되어 직접 구현

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 품목 검색 시 품종 WHERE가 꺼져 있었고, 품종 탭은 차수 전체 목록이었다.
2. **구현** — 검색된 행의 품종을 버튼으로 보여주고, 버튼을 눌러도 검색어는 유지한다.
3. **검증** — 도착원가 테스트, ERP 계약, dnSpy 근거, write guard, webpack build

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/arrivalCostProductSearch.js` | 검색어에 걸린 매칭 품종 목록 |
| `lib/arrivalCost.js` | 품목 검색 중에도 품종 필터. `matchedVarieties` 반환 |
| `pages/arrival-cost.js` | 검색 결과 품종 버튼. 화이트+카네이션은 검색어 유지 |
| `__tests__/arrivalCostProductSearch.test.js` | 화이트 → 수국·카네이션 |
| `docs/exe-golden/FormArrivalCost.md` | 품종 버튼 계약 |

부작용: 검색·품종 탭은 SELECT만. 저장은 기존 `WebArrivalCostLine`/`History`. Order/Shipment/Estimate/Stock 보존.

---

## 검증 결과

```
node __tests__/arrivalCostProductSearch.test.js  pass
node __tests__/arrivalCostPage.test.js           pass
node __tests__/arrivalCostPerformance.test.js    pass
npm run test:erp-contract                        pass
npm run test:nenova-dnspy-evidence               pass
npm run guard:erp-writes -- --changed-from HEAD  pass
npm run build                                    pass (webpack)
```

---

## 사용자 확인 포인트

- 도착원가에서 `화이트` 검색 → 아래 품종 버튼이 수국·카네이션처럼 나뉘는지
- `카네이션`을 누르면 검색어는 `화이트` 그대로이고 카네이션만 보이는지
- `전체보기`는 다시 화이트 전체인지

---

## 미완 / 다음

- 배포 후 운영 화면에서 화이트 검색 스모크
