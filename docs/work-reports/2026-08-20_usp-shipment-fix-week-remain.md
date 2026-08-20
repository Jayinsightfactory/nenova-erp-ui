# 작업 완료 보고 — 출고확정 SP 잔량검사 leftover 공식

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-20_usp-shipment-fix-week-remain.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 17:30 |
| 사용자 요청 | 전산 SP까지 손봐서 nenova.exe 확정 버튼에서도 재발하지 않게 |
| 브랜치 | feat/usp-shipment-fix-week-remain |
| 커밋 | (PR 후 기입) |
| 배포 | 운영 MSSQL `usp_ShipmentFix` ALTER 완료. 웹 코드는 PR 병합 후 Cafe24 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 읽기 전용 DB probe, SP ALTER, 계약·테스트·문서, git/PR | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 (공식은 운영 SP dump + 33-01 probe로 확정) | — |
| **Cursor 직접** | 운영 `ALTER PROCEDURE dbo.usp_ShipmentFix` | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 2026 `33-01` 콜롬비아카네이션이 확정 직후처럼 대량 음수로 보인 원인은 입고 소실이 아니라, 확정취소 후 `ProductStock` 재계산이 빠진 채 EXE `usp_ShipmentFix`가 기말 스냅샷에서 미확정 출고를 한 번 더 뺀 이중차감.
2. **검증** — 옛 검사 음수 52 / leftover−미확정 음수 0 / 미확정 53 SKU. Zurigo만 주간잔량 −0.33 (`ROUND(...,0)=0`).
3. **구현** — `usp_ShipmentFix` 잔량 검사만 leftover 공식으로 ALTER. 메시지 문구 유지. cancel 안에 재계산을 넣지 않음(교착).
4. **마무리** — 계약 JSON, `lib/shipmentFixReconcile.js` 순수 함수, exe-golden/WEB_VS_ERP_CONFLICTS 갱신.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| 운영 `dbo.usp_ShipmentFix` | 잔량 검사: prev+입고−확정출고+StockType조정−미확정출고 |
| `docs/migrations/2026-08-20_usp_shipment_fix_week_remain_check.sql` | ALTER 스크립트 |
| `lib/shipmentFixReconcile.js` | `isShipmentFixRemainNegative` / `sqlRound0` |
| `docs/contracts/shipment-fix-remain-check.json` | 기능 계약 |

---

## 검증 결과

```
33-01 콜롬비아카네이션: oldNeg=52, newNeg=0, shipped=53
ALTER after: patched=1, hasOldCte=0, keepsMessage=1, defLen 6151→7757
node __tests__/shipmentFixReconcile.test.js 통과
node scripts/check-erp-contract-manifest.mjs 통과
node scripts/check-nenova-dnspy-evidence.mjs 통과
```

---

## 사용자 확인 포인트

- nenova.exe에서 **2026 / 33-01 / 콜롬비아카네이션 확정**을 다시 누르면 된다. 웹 재계산을 먼저 돌릴 필요 없다.
- Zurigo(ProdKey 504) 주간잔량 −0.33은 실제 부족이다. `ROUND(-0.33,0)=0` 이라 확정은 통과하고, 확정 후 스냅샷은 −0.33 근처로 남는다.
- Minicarnation Scarlete live `Product.Stock = −1` 은 이번 52건 버그와 별개다.
- 33-02 콜롬비아카네이션은 probe 시점 미확정 22 SKU, 옛/새 검사 모두 음수 0.
- 입고(물량표)는 지워지지 않았다. dnSpy로 exe를 고치지 않았다.

---

## 미완 / 다음

- 웹 저장소 PR 병합·Cafe24 배포는 문서/가드용이며, EXE 확정은 이미 새 SP를 탄다.
- 확정 후 `usp_StockCalculation`이 또 타임아웃되면 스냅샷은 다시 leftover가 될 수 있으나, 잔량 검사는 더 이상 그 스냅샷을 쓰지 않는다.
