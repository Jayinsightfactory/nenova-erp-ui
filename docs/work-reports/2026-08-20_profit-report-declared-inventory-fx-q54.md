# 작업 완료 보고 — 매출이익 보고서 질문 4건 반영

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-20_profit-report-declared-inventory-fx-q54.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-20 |
| 사용자 요청 | 호주 환율·Q54·베트남 ±금액·수량 없는 재고금액 네 가지 답을 웹 계산에 반영 |
| 브랜치 | `cursor/profit-report-rule-alignment-0d71` |
| 커밋 | (이 보고 후 커밋) |
| 배포 | PR #275 — 웹 전용 계산만. ERP 원장 WRITE 없음 |

---

## AI 구성

| 담당 | 역할 |
|------|------|
| **Cursor** | 질문 4건 반영, 계산·저장·화면·계약·테스트, 커밋/push/PR |

---

## 사용자 확정 규칙

1. **호주 환율**: 매입이 있는 차수만 그 차수 매입(과세)환율로 변경. 재고판매만 있으면 재고가 매입된 시점 환율로 고정. 엑셀 29차가 매입(본표 R=1,056.39)이 있는데도 O37을 27차 1,068.23에 고정한 것과, 31차가 매입 없이 환율을 바꾼 것은 엑셀 오류이며 웹은 따르지 않는다.
2. **Q54 단당 통관비**: 기말상품재고액에 포함하는 게 맞다. 28·29차에 안 넣은 것은 실수. 웹 공식 `(Q×R + S×R + H) / 매입수량 × 기말수량`의 H에 이미 들어 있다.
3. **베트남 ±4,576,000원**: 실제 이익률을 보기 위한 엑셀 메모. 보고서 매출이익(J)에는 이동하지 않고 비고에만 기록한다.
4. **수량 없는 기말상품재고액**: 재고잔량 수량이 없어도 금액이 있으면 실제 재고. 웹에도 그 금액을 넣는다. 2026년 31차 본표 수기값: 네덜란드 F12=2,923,273.166, 태국 F14=1,149,859.79, 중국 F15=1,813,712.94, 에콰도르 F16=3,485,942 (SHA `56a5fdd4f12b65edc253d09820baedc172081e0cb2f83df38a443328a69c9556`).

---

## 코드 반영

- `lib/profitReportCalc.js` — 수량>0이면 매입 평균원가(H 포함) 또는 직전 단가. 수량 0이고 선언 금액이 있으면 그 금액. 베트남 J는 `C−I`만.
- `lib/profitReportWorkbookDeclaredInventory.js` — 31차 네덜란드/태국/중국/에콰도르 선언 F. 22~28 historical과 분리, 다른 연도·차수 전파 없음.
- `lib/profitReport.js` — `WebProfitReport` ColKey `F` 저장/조회 허용(SourceRef+EffectiveAt 필수). E는 거부.
- `pages/api/sales/profit-report.js` — 선언 F를 `resolveInventoryClosing`에 전달. 다음 차수 E로 이월.
- `pages/sales/profit-report.js` — 재고수량 0인 행만 F 입력칸.

## 검증

`node __tests__/profitReportInventoryFormulaContract.test.js` 외 매출이익 관련 테스트, `npm run test:nenova-dnspy-evidence`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run build`.
