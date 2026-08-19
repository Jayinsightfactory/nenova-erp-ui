# 작업 완료 보고 — 전차수 기말 F = 이번 차수 기초 E

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 |
| 사용자 요청 | 모든 국가품종은 그전차수 기말 재고금액이 이번차수 기초재고와 같아야 한다 |
| 브랜치 | `cursor/profit-report-rule-alignment-0d71` |
| 커밋 | `fix: carry previous week ending inventory into this week opening` |
| 배포 | 미배포 — PR 검증 후 master 병합 시 Cafe24 배포 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 요청 확인, E=F 이월 구현, 테스트·계약·커밋 | — |
| **Claude Code** | 미사용 | — |
| **Codex** | 미사용 | — |
| **Cursor 직접** | git / 테스트 / PR | — |

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 층별 FIFO 이후 콜롬비아·베트남·호주의 이번 E가 전차수 평균원가(옛 F)를 써서, 화면에 보이는 전차수 F와 달라졌다. 네덜란드 등은 품목 증거라 이미 맞았다.
2. **구현** — 이번 E = 전차수 F. 전차수 확정 스냅샷 F 우선, 없으면 전전차수 확정 F에서 한 단계 쌓거나 전전차수 비층별 기말+전차수 입고로 재현. 이번 F는 그 E를 기초로 FIFO. 카테고리 평균식은 콜롬비아 5품종·베트남에만 유지.
3. **검증** — 재고 공식·연도범위·호주 단위·소스가이드·규칙정렬 테스트와 ERP write 가드, 빌드.
4. **마무리** — 커밋/PR 갱신. ERP 원장 WRITE 없음.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/profitReportCalc.js` | `reconstructPreviousClosing`, 확정 F 이월 상태 |
| `pages/api/sales/profit-report.js` | 모든 줄 E = 전차수 F 재현/확정값 |
| `lib/profitReportSourceGuide.js` | 기초재고 = 전차수 F (전 국가·품종) |
| `docs/contracts/weekly-profit-report.json` | `inventoryCarryIdentity` |

---

## 사용자 확인 포인트

- 맞습니다. 모든 국가·품종 줄에서 **이번 차수 기초재고 E = 전차수 기말재고 F**입니다. 01차는 전년도 52차 F를 가져옵니다.
- 이스라엘·뉴질랜드·일본도 E는 전차수 F와 같습니다. 다른 점은 매출원가에서 F를 빼지 않는 것뿐입니다.
- 전차수를 확정해 두면 다음 차수 E가 그 F와 정확히 같습니다.

---

## 미완 / 다음

- 미확정 차수를 여러 주 연속으로 열어 보면, 전전차수 비층별 기말에서 한 단계만 쌓은 값이라 아주 긴 FIFO 사슬과는 1주 차이가 날 수 있다. 매주 확정하면 일치한다.
- ERP 원장 WRITE 없음.
