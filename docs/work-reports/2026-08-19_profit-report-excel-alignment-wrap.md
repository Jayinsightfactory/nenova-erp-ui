# 작업 완료 보고 — 매출원가 양식 28~31차 엑셀 공식 정렬

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/2026-08-19_profit-report-excel-alignment-wrap.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 |
| 사용자 요청 | 28~31차 재고수정 엑셀과 웹 차이를 고치고 작업마무리 |
| 브랜치 | `cursor/profit-report-rule-alignment-0d71` |
| 커밋 | `8f0fed8` — `fix: match Excel closing-stock formula and Colombia H weight split` |
| 배포 | PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/275 — 이 턴에서 푸시. master 병합·Cafe24 배포는 PR 머지 후 |

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 엑셀 대조, 공식 정렬 구현, 테스트·문서·commit/push/PR | — |
| **Claude Code** | 위임 없음 | — |
| **Codex** | 위임 없음 | — |
| **Cursor 직접** | git push, PR #275 본문 갱신 | — |

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 28~31차 재고수정 xlsx vs Nenovaweb 차이 8가지를 문서화
2. **구현** — 기말상품재고액을 엑셀 공식으로 되돌림. 콜롬비아 그외통관비는 항상 무게비율, 항공료만 CBM. 수국 박스 기본값 5.6kg / 7
3. **검증** — 계약·패리티 테스트와 ERP write 가드, webpack 빌드
4. **마무리** — 원인 5·8 설명 보강, 커밋/push, PR 본문 갱신

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/profitReportCalc.js` | FIFO 층별 기말평가 제거. 매입 있으면 (매입액+그외통관비)÷매입수량×기말수량, 없으면 직전 단가 이월 |
| `lib/customsForwardingCalc.js` | 그외통관비 항상 무게비율. 항공료만 과금중량≠총중량이면 CBM |
| `lib/customsForwarding.js` | 수국 박스당무게 5.6, 박스당CBM 7 |
| `pages/api/sales/profit-report.js` | 기말평가 호출을 주간평균/이월단가로 |
| `pages/sales/profit-report.js` | 기말상품재고액 안내·상태값 |
| `components/CustomsClearancePanel.js` | 그외통관비=무게, 항공료만 CBM 안내 |
| `components/ForwardingClearancePanel.js` | 동일 |
| `docs/contracts/weekly-profit-report.json` | 기말상품재고액 공식·콜롬비아 CBM 조건 |
| `docs/work-reports/2026-08-19_profit-report-28-31-excel-vs-web-diff.md` | 원인 A~H 조치 상태와 8절 상세 |

## 검증 결과

```
profit-report 관련 단위테스트: 실패 0
npm run test:profit-report-22-28: 통과
npm run test:nenova-dnspy-evidence: Nenova dnSpy evidence guard passed
npm run guard:erp-writes -- --changed-from origin/master: ERP write scope guard passed (7 changed API files)
npm run test:erp-manifest -- --changed-from origin/master: ERP contract manifest guard passed
npm run build (webpack): Compiled successfully
```

## 사용자 확인 포인트

- 그외통관비 화면에서 28-1 / 29-1 / 29-2 / 30-1 트럭 **실제 대수**를 저장하면 엑셀과 같아진다. 추천값은 저장된 대수를 덮지 않는다.
- 호주 27차 환율 1,068.23·단당 통관비 299.709원 고정값을 웹에도 넣을지.
- 베트남 4,576,000원: 출고 차수 정정 vs 표시만 이익 이동.

## 미완 / 다음

- 호주 27차 고정값 확인 대기
- 베트남 4,576,000원 처리 방향 대기
- PR 머지 후 Cafe24 배포·스모크
