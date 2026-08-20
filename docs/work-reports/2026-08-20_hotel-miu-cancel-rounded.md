# 작업 완료 보고 — REGISTERED 합산 삭제는 반올림 후 수량

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | 반올림해서 주문등록했으면 삭제 때도 반올림된 전체 수량이 빠져야 한다 |
| 브랜치 | feat/hotel-miu-cancel-rounded |
| 배포 | (PR 후 기록) |

---

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 원인 확인, `orderDeltaForRegisteredBatch`, 테스트, PR/배포. Claude CLI 없음 |

---

## 작업 흐름

1. **분석** — 36-01 라움은 6단/12송이를 1박스로 올려 등록했는데, 합산 삭제가 원문만 빼서 Mondial 4단·Moon Light 0.6박스·호접란 4송이가 남음.
2. **구현** — REGISTERED 합산 삭제/품목 제거는 snap `afterQty`를 음수로 보낸다. 같은 품목이 다른 REGISTERED 합산에 남아 있으면 원문 delta.
3. **검증** — `node __tests__/hotelMiuIntake.test.js`, `test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest --changed-from origin/master`, `guard:erp-writes --changed-from origin/master`, `npm run build`.
4. **마무리** — PR squash-merge 후 Cafe24. 36-01 잔여는 배포 뒤 별도 보정.

---

## 부작용 행렬

| 동작 | Order | Shipment | 합산 |
|---|---|---|---|
| 합산 삭제, 그 품목이 이 합산에만 있음 | snap afterQty(반올림 후) 감소 | preserve | soft-delete |
| 합산 삭제, 같은 품목이 다른 REGISTERED 합산에 있음 | 원문 delta | preserve | soft-delete |
| 36-01 잔여 보정(배포 후) | leftover OD 숨김 | preserve | 이미 삭제됨 |

견적·매출 원장 직접 변경 없음. `createOrder` hotel-miu-board는 출고를 쓰지 않음.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/hotelMiuIntake.js` | `orderDeltaForRegisteredBatch` |
| `pages/sales/shilla-miu-board.js` | persistBatchLines가 원문 대신 반올림 후 delta |
| `__tests__/hotelMiuIntake.test.js` | 36-01 1박스 취소 fixture |
| `docs/contracts/hotel-miu-intake.json` | REVISE_BATCH_DECREASE |
| `docs/exe-golden/FormOrderAdd.md` | 합산 삭제 = afterQty |

---

## 사용자 확인 포인트

- 새로고침 후 반올림 등록 → 합산 삭제하면 전산이 0이어야 함 (6단 나머지가 남으면 안 됨).
- 이미 지운 36-01 라움 잔여(4단 / 0.6박스 / 4송이)는 배포 뒤 0으로 맞춤.
