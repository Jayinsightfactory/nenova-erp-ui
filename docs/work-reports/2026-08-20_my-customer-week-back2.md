# 작업 완료 보고 — 내 업체 주문등록 차수 -2 표시

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 15:28 |
| 사용자 요청 | 내 업체 주문등록 등록차수를 현재차수 +2뿐 아니라 -2까지 표시 |
| 브랜치 | feat/my-customer-week-back2 |
| 커밋 | 배포 시 기록 |
| 배포 | Cafe24 GitHub Actions (master push) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 차수 범위 수정, 테스트, 커밋/PR/배포 | — |
| **Cursor 직접** | git push, gh pr merge, ping | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — `/orders/my-customers`의 `buildForwardOrderWeeks`가 현재차수 +2부터만 표시
2. **구현** — 현재차수 -2부터 표시, 기본 선택은 +2 유지, 연도 래핑 추가
3. **검증** — `node __tests__/myCustomerOrderEntry.test.js`, `test:erp-manifest`, `guard:erp-writes`
4. **마무리** — 관련 4파일만 분리 커밋 후 master 병합·Cafe24 배포

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/myCustomerOrderEntry.js` | 등록차수 선택지: 현재-2 ~ 기존 앞차수, 기본 +2, 연도 래핑 |
| `pages/orders/my-customers.js` | 기본 선택을 `default` 플래그로 유지 |
| `docs/contracts/my-customer-order-entry.json` | `weekSelector` 계약 |
| `__tests__/myCustomerOrderEntry.test.js` | -2 시작·기본 +2·연초 래핑 fixture |

---

## 검증 결과

```
my customer order entry tests passed
ERP contract manifest guard passed
ERP write scope guard passed
```

---

## 사용자 확인 포인트

- 내 업체 주문등록에서 등록차수가 현재차수 -2부터 보이는지
- 기본 선택이 여전히 현재 +2차인지
- 저장 시 선택한 연도·차수로 주문수량이 가산되는지

---

## 미완 / 다음

- 없음
