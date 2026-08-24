# 작업 완료 보고 — 주차별 손익 33차 원천 경고 재분류

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-19 09:20 |
| 사용자 요청 | 33차 경고 12건을 직접입력 12개로 보지 말고, 실제 누락 품목·반차수만 남기고 자동 연결 가능한 근거는 연결 |
| 브랜치 | `codex/profit-report-source-completion-20260818` |
| 커밋 | 없음 (미커밋) |
| 배포 | 미배포 |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 이전 세션 이어서 구현·검토 반영·테스트·빌드 | — |
| **Cursor 직접** | 재고단가 자동연결 + 검증 문구 구체화 + 계약/테스트 | 이 worktree에서 직접 수정 |

Claude CLI는 이전 세션에서 월 사용 한도로 실행되지 않아 같은 고정 설계로 Cursor가 구현했다.

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — 표시된 12건은 국가별 E/F 묶음 경고 + 태국 H + 콜롬비아 H/S + 32차 항공료 원천이다. E/F는 28차 catalog를 29차 이후에서 막아 둔 것이 핵심 원인이었다.
2. **구현** — 우선순위: 사용자 확정 단가 → 확정 업로드 도착원가 → 2026 28차 이후 안정 workbook catalog → 같은 연도·같은 세부차수 전산 도착원가 → 이월근거.
3. **검토 반영** — 호주는 28차 환율을 재사용하지 않고 대상 차수 공식 과세환율만 곱한다. 판매/분배단가·Product.Cost는 재고원가에 쓰지 않는다. 교차연도 차단 유지.
4. **검증** — `test:profit-report-22-28`, 관련 계약/감사 테스트, `test:erp-manifest --changed-from HEAD`, `guard:erp-writes --changed-from HEAD`, `test:nenova-dnspy-evidence`, `npm run build` 통과.

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `lib/profitReportInventoryWorkbookCatalog.js` | 2026년 28차 이후 exact ProdKey template. 호주는 대상 차수 AUD 과세환율 필수 |
| `lib/profitReport.js` | 전산 도착원가 자동연결, 누락 품목명 수집. ERP 원장 쓰기 없음 |
| `lib/profitReportCalc.js` | `VERIFIED_FREIGHT_ARRIVAL_CALC`를 E/F 허용 상태로 추가 |
| `lib/profitReportAudit.js` | E/F는 품목명, 콜롬비아 H/S는 누락 반차수, 32차 항공료는 실제 구매범위 표시 |
| `lib/customsForwarding.js` | 콜롬비아 반차수에 `forwardingDetected` 표시 |
| `pages/api/sales/profit-report.js` | 기초/기말 환율 문맥 분리 전달, 누락 품목·콜롬비아 주차를 audit에 전달 |
| `pages/sales/profit-report.js` | 전산 도착원가 원천 문구 |
| `docs/contracts/weekly-profit-report.json` | catalog/입력 계약과 교차연도 fixture를 새 우선순위에 맞춤 |
| `docs/exe-golden/FormProfitReport.md` | 28차 이후 template·호주 환율·전산 도착원가 근거 기록 |
| `__tests__/profitReportInventorySourceCompletion.test.js` | 신규 원천 자동완성 계약 |

---

## 검증 결과

```
npm run test:profit-report-22-28          PASS
node __tests__/profitReportGetReadOnlyDdl.test.js PASS
node __tests__/profitReportStockCostExclusionContract.test.js PASS
npm run test:erp-manifest -- --changed-from HEAD  PASS
npm run guard:erp-writes -- --changed-from HEAD   PASS (변경 API 1, ERP Master 쓰기 없음)
npm run test:nenova-dnspy-evidence        PASS
npm run build                             PASS (next build --webpack)
```

---

## 사용자 확인 포인트

- 2026년 33차를 다시 조회하면 네덜란드/호주/태국/미국 E/F 묶음 경고는 자동 연결된 품목만큼 줄어야 한다.
- 정말 근거가 없는 품목만 `품목명(품목번호)`로 남는다.
- 태국은 22~28차 원본도 `-01`만 입고하고 GW2=0이 정상이다. `-02` 부재를 H 누락으로 보지 않는다. 입고가 있는데 GW1도 0이면 `33-01 Gross weight`만 확인하라고 안내한다.
- 시네신스처럼 재고잔량에 품목번호가 없는 행은 이름 추정하지 않는다. 28차 품목리스트에서 확인된 키만 같은 셀에 묶는다. 화이트는 2158·2754만, 안개꽃은 2220·2460·2461·2464·2748·2919만. 옐로우 2159·연핑크 등은 입력 필요로 남긴다. 경고문은 DB 품명 또는 `품목번호 N`만 쓴다.
- 콜롬비아 H/S는 `누락 반차수: 33-02`처럼 한 곳만 가리켜야 한다.
- 32차 항공료 구매범위 누락 1건은 기초재고 원천 확인으로 남는다.

---

## 미완 / 다음

- 커밋·PR·master 병합·Cafe24 배포는 아직 하지 않았다.
- 운영 33차 실브라우저 재조회로 경고 건수 확인이 남았다.
- 태국 H·콜롬비아 33-02 GW/CW·32차 포워딩 1건은 원천 자체가 없어 화면에서 확인·입력이 필요하다.
