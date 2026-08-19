# 작업 완료 보고 — 판매등록확정 이후 변경 비교

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 18:20 |
| 사용자 요청 | 판매등록 히스토리에서 차수 조회 후 판매등록확정 버튼을 만들고, 확정 시점 이후 변경만 보게 한다 |
| 브랜치 | feat/sales-registration-confirm |
| 커밋 | (PR 병합 시 기록) |
| 배포 | 검증 후 Cafe24 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 구현·계약·테스트·배포 | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 기존 자동 스냅샷(TUE_FINAL 등)과 별도로, 사용자가 누른 시점의 현재 DB를 `REG_CONFIRM`으로 고정한다.
2. **구현** — GET/POST에 `year` 전달, `confirmSales`가 웹 전용 스냅샷+기준만 INSERT.
3. **검증** — `node __tests__/salesRegistrationConfirm.test.js`, `npm run test:erp-contract`, `guard:erp-writes --changed-from origin/master`, `npm run build`.
4. **마무리** — PR → master 병합 → Cafe24 배포.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `pages/sales/registration-history.js` | 조회 옆 **판매등록확정** 버튼, 확정 후 자동 비교 |
| `pages/api/sales/registration-history.js` | `action: confirmSales`, 연도 스코프 |
| `lib/salesSnapshotPolicy.js` | 기준 우선순위·diff 순수 함수 (페이지가 db를 끌어오지 않음) |
| `lib/salesSnapshot.js` | 캡처 SQL에 OrderYear, REG_CONFIRM은 재확정 가능 |
| `docs/contracts/sales-registration-history.json` | 원장 preserve, 웹 테이블만 INSERT |
| `docs/exe-golden/WebSalesRegistrationHistory.md` | EXE Form 없음, 읽기 원장만 |

원장 부작용: 주문/출고/견적/출고일/매출확정 원장은 읽기만. 쓰기는 `WebSalesSnapshot` / `WebSalesSnapshotRow` / `WebSalesBaselineConfirm`.

---

## 검증 결과

```
salesRegistrationConfirm tests passed
ERP contract manifest guard passed (26 manifest(s) checked)
ERP write scope guard passed (1 changed API files checked)
Nenova dnSpy evidence guard passed
npm run test:erp-contract → exit 0
npm run build → Compiled successfully
```

---

## 사용자 확인 포인트

- `/sales/registration-history`에서 차수 조회 → **판매등록확정** → 이후 수량·금액이 바뀌면 기준 vs 현재에 표시된다.
- 다시 누르면 그 시점의 새 확정본이 기준이 된다.
- 주문·출고·견적 숫자는 이 버튼으로 바뀌지 않는다.

---

## 미완 / 다음

- 없음 (운영 원장 보정 SQL 없음)
