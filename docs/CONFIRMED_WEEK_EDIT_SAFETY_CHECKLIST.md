---
name: 확정차수·재고평가·통관비 편집 안전 체크리스트 (30초 필독)
description: 매출이익 보고서/견적서 단가·수량 편집/통관비-포워딩 입력처럼 "확정된 값을 덮어쓰는" 작업 전 체크리스트
date: 2026-07-13
type: safety-checklist
related:
  - ROLLBACK_SAFETY_CHECKLIST.md
  - REGRESSION_PREVENTION_GUIDE.md
  - STOCK_INTEGRITY_DESIGN.md
---

# 확정차수·재고평가·통관비 편집 안전 체크리스트

> 매출이익 보고서 셀 편집, 견적서 단가/수량 수정, 그외통관비·포워딩 입력처럼
> **이미 확정됐거나 자동계산된 값을 사람이 덮어쓰는** 작업 전에 이 표부터 본다.
> 계기: 2026-07-13 세션 — 확정차수 단가수정 사이클이 하드코딩 빈배열로 죽어있던 걸
> 몇 주간 아무도 못 알아챈 사고 (`be76cda`). 상세: `.claude/PROGRESS.md` 2026-07-13 세션.

## 절대 규칙

| # | 규칙 | 안 지키면 |
|---|------|-----------|
| C-1 | `ShipmentDetail`/`Estimate` 단가·수량을 고칠 땐 먼저 대상 차수 **`isFix`** 확인. 확정(1)이면 **직접 UPDATE 금지** — 반드시 `getFixCycleWeeksForEditedItems`(`lib/estimateFixCycle.js`) + `runEditWithFixCycle`(`pages/estimate.js`)의 확정해제→적용→재확정 사이클을 태울 것 | "저장 성공"으로 보이지만 다음 재확정 시점에 값이 원래대로 롤백됨(눈에 안 띄는 지연 버그) |
| C-2 | 안전장치(`cycleWeeks = []` 같은 하드코딩 빈 배열, `if (false && ...)` 같은 꺼진 가드)를 **이유도 모르고 되살리지 말 것**. 되살리려면 그걸 안전하게 만들어준 짝 코드(사이클 헬퍼, 서버측 차단)까지 같이 확인·연결 | 절반만 고치면 반대쪽 안전망 없이 직접쓰기가 다시 열림 |
| C-3 | 확정된(`isFix`) 레코드 대상 API를 새로 짜거나 고칠 땐 **서버측 차단도** 같이 확인 — 클라이언트가 사이클을 안 타고 직접 호출해도 막아야 진짜 안전 | 클라이언트만 고치면 다른 진입점(구버전 탭, 외부 호출)에서 여전히 뚫림 |
| C-4 | 참조 엑셀/원가자료가 **여러 개**면(농장별 상세 vs 요약본 등) 반드시 전부 대조. 하나만 보고 공식·단가를 코드에 반영하지 말 것 | 2026-07-13: 콜롬비아 그외통관비가 두 소스에서 백상창고료 410/460원, 국내운송비 정액/트럭공식으로 서로 다르게 나와 결론 못 냄(사용자 확인 대기 중) |
| C-5 | `StockMaster.isFix` 같은 "확정=1 / 사용자앵커=2" 식 다값 마커 컬럼은 실제 DB 타입이 `bit`인지 먼저 확인. `bit`면 2는 조용히 1로 잘림 → 값이 절대 구분 안 됨 | 2026-07-10: 이 버그 때문에 "시작재고 앵커" 기능이 한 번도 동작한 적 없었음(`a90c36c`) |
| C-6 | 입력이 잦은 화면(숫자 셀 여러 개)에서 컴포넌트를 **부모 렌더 함수 안에 정의하지 말 것** — 모듈 스코프로 호이스트하고 필요한 state는 props로 전달 | 매 렌더(=매 키입력)마다 새 함수 identity → React가 다른 컴포넌트로 취급해 `<input>` 언마운트 → 포커스 튕김(`bc7828f`) |
| C-7 | Windows Git Bash에서 한글이 포함된 POST 바디를 보낼 땐 인라인 `curl` 금지 — `fetch()` + `JSON.stringify()` 쓰는 Node 스크립트로 | curl이 한글/UTF-8을 깨뜨려 잘못된 값이 저장되거나 매칭 실패로 오진(다른 저장소 사례 다수) |
| C-8 | "빌드 성공" ≠ "검증 완료". 배포 후 **실제 프로덕션 DB 데이터**로 API를 직접 호출해 결과값을 확인할 것 | 이번 세션 다수 사례 — 빌드는 깨끗했지만 라이브 데이터로 확인해서야 로직 오류 발견 |

## 도메인 지식 — 자동값을 그대로 믿으면 안 되는 경우

- **그외통관비(H)·콜롬비아 4품목 GW/CW/트럭수**는 매주 사람이 [📦 그외통관비 입력]/[🚢 포워딩 입력]
  화면에 직접 입력해야 채워진다. 자동으로 채워지는 게 아니라 "안 채우면 0/공백"이다.
- **매출이익 보고서 E(기초)/F(기말) 재고평가**는 `ProductStock` 스냅샷 드리프트가 구조적 문제
  (24~27차, 다수 카테고리 확인됨). 화면의 "확인 필요" 배너(붉은 테두리 입력칸)가 뜬 카테고리는
  (a) 실사값 수기 입력 또는 (b) 차수피벗 "시작재고" 저장으로 앵커되기 전까지 신뢰하지 말 것.

## 관련 파일

`lib/estimateFixCycle.js` · `pages/estimate.js`(`runEditWithFixCycle`, `applyCostEdits`, `applyQtyEdits`) ·
`pages/api/estimate/update-cost.js` · `lib/profitReport.js`(`stockSnapshotByCategory`) ·
`lib/customsForwarding.js`(`computeColombiaCustomsTotal`) · `pages/sales/profit-report.js`(`needsCheck`/`EditCell`) ·
`docs/migrations/2026-07-10_stockmaster_isfix_tinyint.sql`
