# 작업 완료 보고 — 호텔+미우 주문등록 후 EXE 수량 미반영

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 14:53+ |
| 사용자 요청 | 34-1차 라움 주문등록(더하기) 후 웹 내역은 나오는데 nenova.exe 주문수량이 그대로다 |
| 브랜치 | feat/hotel-miu-write-lock |
| 커밋 | (배포 시 기록) |
| 배포 | (배포 시 기록) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 원인 분석(읽기 전용 DB probe), 구현, 테스트, 커밋/PR/배포 | — |

**분담 기준**

- Cursor만: 원인 확정 후 4파일 수정 + 계약/테스트. Claude 위임 없이 직접 구현.

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — CustKey 680 / 2026 / 34-01 OrderMasterKey 6144. 14:49 `createOrder` ADD 27품목 → 14:50 `markRegistered`+스냅샷 → 14:50부터 합산 삭제 음수 POST가 재고계산(~50초)과 겹침. 웹 팝업은 스냅샷이라 1440송이 등이 남고, EXE ViewOrder는 숨긴/0 행이라 변동 없음처럼 보임.
2. **구현** — 합산 삭제/주문등록 연타 잠금, 숨긴 OrderMaster/OrderDetail 재사용, 차수 팝업에 전산 현재 + 다시 더하기.
3. **검증** — `node __tests__/hotelMiuIntake.test.js`, `npm run test:ui-layout`, `npm run test:nenova-dnspy-evidence`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run build`.
4. **마무리** — PR squash-merge 후 Cafe24 배포. 운영 원장 SQL 보정은 하지 않음.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `pages/sales/shilla-miu-board.js` | `writeLock` + `disabled={!!busy}`로 합산 삭제 연타 차단. 차수 팝업에 전산 현재·다시 더하기 |
| `pages/api/orders/index.js` | 숨긴 Master/Detail 재사용, 살릴 때는 환산값을 덮어 씀 |
| `lib/hotelMiuIntake.js` | `reapplyItemsFromSnaps` — 스냅샷 afterQty를 가산 payload로 |
| `docs/contracts/hotel-miu-intake.json` | BLOCK_OVERLAPPING_WRITE, REAPPLY_REGISTER_SNAP |
| `__tests__/hotelMiuIntake.test.js` | 잠금·재사용·1440송이 재가산 fixture |

---

## 부작용 행렬

| 동작 | Order | Shipment | 합산 |
|---|---|---|---|
| 주문등록 | add (기존) | preserve | mark REGISTERED + snap |
| 합산 삭제 while busy | **blocked** | preserve | blocked |
| 다시 더하기 | snap afterQty add, 숨긴 OD 살림 | preserve | preserve |
| GET 전산 현재 | preserve | preserve | preserve |

견적·매출: `Estimate`/`WebProfitReport`/`ShipmentDetail.Amount` 직접 쓰기 없음. `source=hotel-miu-board`는 `ensureShipmentMaster` 꺼짐.

---

## 사용자 확인 포인트

- 배포 후 `/sales/shilla-miu-board` → 라움 → **34-01** 클릭 → 전산 현재가 `-` 또는 잔여만 보이면 **등록내역을 전산에 다시 더하기** 한 번.
- nenova.exe 주문등록에서 같은 연도·34-01·주식회사 트라움에스앤씨(라움) 수량 확인.
- Hydrangea White 잔여 0.33박스가 남아 있으면 다시 더하기 후 약 48.33박스가 될 수 있음. 필요하면 전산에서 0.33만 조정.
- 운영 DB raw SQL 보정은 하지 않음.

---

## 미완 / 다음

- 재고계산 ~50초는 별도 설계. 이번 작업은 겹친 쓰기만 차단.
- 다시 더하기를 두 번 누르면 수량이 두 배가 되므로 확인창 후에만 실행.
