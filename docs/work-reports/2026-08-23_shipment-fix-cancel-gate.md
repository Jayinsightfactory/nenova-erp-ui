# 작업 완료 보고 — 출고확정/취소 재고게이트

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-23_shipment-fix-cancel-gate.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-23 23:55 |
| 사용자 요청 | 33-02 카네이션처럼 취소 직후 다음 취소를 막는 가드를 넣어줘 |
| 브랜치 | fix/shipment-fix-cancel-gate |
| 커밋 | (push 후 기입) |
| 배포 | SP는 운영 MSSQL에 2026-08-23 적용. 웹은 배포 게이트 후 Cafe24 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 원인 분석, SP 게이트 설계·적용, 웹 CheckFixCancel 패리티, 테스트·배포 | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 (SQL 게이트는 Cursor가 직접 적용) | — |
| **Cursor 직접** | `node scripts/apply-nenova-stock-week-gate.js --apply`, git/gh/ping | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 2026-08-20 `nenovaSS2`가 33-02→33-01 카네이션을 같은 분에 취소. 취소 SP 커밋과 재계산이 다른 연결이라, 낡은 leftover 스냅샷으로 잔량검사가 이중차감됐다. 고정 sleep은 EXE 1초 간격 취소를 막지 못한다.
2. **구현** — `NenovaStockWeekGate` 한 행으로 FIX/CANCEL/CALC 직렬화. 취소 성공 후 `WAIT_CALC`, 재계산이 끝나면 해제. 웹 CheckFixCancel은 다음 `StockMaster.OrderYearWeek` + `ViewShipment.DetailFix=1`. `force` 우회 제거. 재계산 실패는 409.
3. **운영 SP** — `usp_ShipmentFix` / `usp_ShipmentFixCancel` / `usp_StockCalculation`에 Enter/Leave 주입. 백업은 `docs/migrations/backup_usp_*_2026-08-23_before_stock_week_gate.sql`.
4. **검증** — 대상 계약 테스트, dnSpy evidence, write-scope, build. 33-02 카네이션은 이미 확정·잔량 정합이라 자동 재확정하지 않음.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `docs/migrations/2026-08-23_nenova_stock_week_gate.sql` | 게이트 테이블 + Enter/Leave/Clear |
| `scripts/apply-nenova-stock-week-gate.js` | 운영 SP ALTER (CREATE 주석 헤더 → ALTER 치환) |
| `lib/shipmentFixCancelGuard.js` | CheckFixCancel·재계산 실패 판정, 1s/2s/4s 재시도 |
| `pages/api/shipment/fix.js` | 다음차수 DetailFix 가드, calc 실패 409, skipStockCalc 시 Clear |
| `pages/api/shipment/fix-status.js` | 범위 취소에도 같은 가드, force 제거 |
| `pages/estimate.js`, `pages/shipment/fix-status.js` | 다음차수 확정 시 force 재시도 없음 |
| `docs/contracts/shipment-fix-cancel-gate.json` | 기능 계약 |

---

## 부작용 행렬

| 대상 | 게이트만 | 확정/취소 SP (기존과 동일) |
|------|----------|----------------------------|
| OrderDetail | 보존 | 보존 |
| Estimate | 보존 | 직접 생성 없음. DetailFix 변경으로 견적 노출은 기존과 같음 |
| ShipmentDetail.OutQuantity/Amount/Vat | 보존 | 수량 변경 없음. isFix/DetailFix만 기존처럼 변경 |
| Product.Stock / ProductStock | 보존 | 재계산 SP가 기존과 같이 갱신 |
| NenovaStockWeekGate | 신규 비원장 1행 | EXE·웹 공통 직렬화 |

교차연도: 다음 차수는 `StockMaster.OrderYearWeek` 비교. 연말 53-02 → 01-01을 같은 연도 `OrderWeek`로 오판하지 않음.

---

## 검증 결과

```
운영 SP: usp_ShipmentFix / FixCancel / StockCalculation gated=1, 게이트 Mode=NULL
node __tests__/shipmentFixCancelGuard.test.js — pass
node __tests__/estimateFixCycle.test.js — 34 passed
npm run test:nenova-dnspy-evidence — pass
node scripts/check-erp-write-contracts.mjs --changed-from HEAD — pass
```

---

## 사용자 확인 포인트

- 전산에서 연속 확정취소 시, 재계산이 끝날 때까지(최대 약 90초) 다음 취소가 「재고 재계산/확정 작업이 진행 중입니다」로 대기하거나 거절된다.
- 웹에서 다음 차수가 확정돼 있으면 강제 취소 버튼이 없다. 다음 차수를 먼저 취소해야 한다.
- 33-02 카네이션은 현재 확정·잔량이 맞아서 이번 작업에서 다시 확정하지 않았다.

---

## 미완 / 다음

- 웹 코드 Cafe24 배포(커밋/PR/Actions)
- 운영 SP는 이미 적용됨. 롤백은 `docs/migrations/backup_usp_*_2026-08-23_before_stock_week_gate.sql`
