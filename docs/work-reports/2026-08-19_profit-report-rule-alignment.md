# 작업 완료 보고 — 주차별 매출이익 운영 규칙 정렬

> 이후 엑셀 대조로 기말상품재고액은 층별 FIFO가 아니라 그 차수 매입 평균원가(매입 없으면 직전 단가 이월)로 되돌렸다. 그외통관비 배분은 항상 무게비율, 항공료만 CBM. 상세는 `docs/work-reports/2026-08-19_profit-report-excel-alignment-wrap.md`.

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-19_profit-report-rule-alignment.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 |
| 사용자 요청 | 차량 3.3t→5T, 같은 APOLLO 수국 통관 감안, 기존재고는 기존 환율·신규입고는 새 환율, 호주는 입고시점 선율 |
| 브랜치 | `cursor/profit-report-rule-alignment-0d71` |
| 커밋 | (푸시 후 기록) |
| 배포 | 미배포 — PR 검증 후 master 병합 시 Cafe24 배포 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 요청 분석, 기존 구현 이어서 규칙 반영, 테스트·계약·커밋 | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 | — |
| **Cursor 직접** | git / 테스트 / PR | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 기존 웹은 3.3t를 2.5t+1t(286,000)로 추천하고, H는 항상 무게비율, 수국은 APOLLO와 분리, 기말은 당주 평균원가로 재평가했다.
2. **구현** — 차량 등급표, CW>GW CBM, 같은 APOLLO 수국 풀, 층별 E/F(호주 Q×R)를 운영 계산에 넣었다.
3. **검증** — 순수 계산 테스트와 ERP 계약 가드.
4. **마무리** — 커밋/PR. 22~28차 엑셀 실제 트럭·historical F는 저장값/스냅샷으로 보존한다.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/colombiaTruck.js` | 2.5t 초과~5t → 5t 1대. 3,342kg = 275,000원 |
| `lib/customsForwardingCalc.js` | H/S 모두 CW>GW이면 CBM. 수국 박스수가 있으면 풀 포함 |
| `lib/customsForwarding.js` | 같은 APOLLO GW/항공료를 4품목 풀로, 수국 박스수는 해당 AWB만 |
| `lib/profitReportCalc.js` | `computeLayeredInventoryValue` FIFO |
| `pages/api/sales/profit-report.js` | 콜롬비아·베트남·호주 기말 F를 층별 평가. 호주 신규 = Q×R |
| `docs/contracts/weekly-profit-report.json` | 차량/CBM/APOLLO/층별환율 계약 |

---

## 사용자 확인 포인트

- 그외통관비 추천 차량: 3.3t는 5T 275,000원. 과거에 실제로 쓴 차량은 그대로.
- 수국+카장알루가 같은 APOLLO에 있으면 통관·트럭·항공료가 함께 나뉜다. 수국만 온 AWB는 나라 단위.
- 기초재고 금액은 전차수 값(당시 환율). 이번 주 입고만 이번 주 환율. 호주는 입고 때 넣은 단가×수량×선율과세환율을 재고로 팔 때도 유지.

---

## 미완 / 다음

- 22~28차 엑셀 기말 F·일부 트럭 실제값과 신규 추천식은 의도적으로 다를 수 있다. 운영 저장 실제값을 덮지 않는다.
- ERP 원장(주문/출고/입고 테이블) WRITE 없음. 웹 계산·Web 전용 스냅샷만.
- 후속: APOLLO 자동 수국 풀을 화면 선택(콜카장알루/콜카장알루수국)으로 바꿈 — `docs/work-reports/2026-08-19_colombia-alloc-pool-selector.md`.
