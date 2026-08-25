# 작업 완료 보고 — 견적 OrderYear GROUP BY · 불량차감 적요 차단

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 |
| 사용자 요청 | OrderYear GROUP BY SQL 오류 수정, 불량차감 비고·적요가 견적서에 올라가지 않게 |
| 브랜치 | `fix/support-estimate-descr-groupby` |
| 배포 | Cafe24 (merge 후 Actions) |

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 원인 분석, 구현, 계약·테스트, 게이트, PR·배포 |

## 작업 흐름

1. **분석** — `includeUnfixed=1` 목록 STUFF가 `sm.OrderYear`를 쓰는데 GROUP BY에 없음. 등록 경로가 `Note` → `Estimate.Descr` 복사.
2. **구현** — GROUP BY에 `sm.OrderYear`. 등록/sync/미리보기 Descr=`''`. 화면 불량차감 적요 기본 숨김.
3. **검증** — `test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest`, `guard:erp-writes`, `build` 통과.
4. **마무리** — PR squash merge → Cafe24.

## 원장 부작용

| 대상 | 결과 |
|------|------|
| Order / Shipment / Stock | 보존 |
| Estimate | 신규·갱신 등록 시 Descr만 빈 문자열 |
| WebSalesDefectDeduction.Note | 웹 원장 유지 |

## 다음

- 이미 Descr에 Note가 들어간 기존 행: 읽기 probe 후 Descr=Note 일치분만 정리.
