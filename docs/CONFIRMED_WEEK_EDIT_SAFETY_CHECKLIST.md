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
| C-1 | 물리적 출고수량·신규 분배는 대상 `isFix` 확인 후 기존 확정해제→적용→재확정 사이클을 유지한다. **단가만 수정**하는 `/api/estimate/update-cost`는 2026-08-26 검증된 금액 전용 경로로 분리한다: 연도·거래처·키·원단가·편집보호 대조, Cost/Amount/Vat만 저장, 기존 EstQuantity·날짜·확정상태 보존, 저장 후 재조회 검사. Estimate-only 등록/차감 계약은 별도로 유지한다. | 단가만 바꾸는데 Fix/Cancel SP를 호출하면 재고·StockHistory까지 변경되며 뒤 차수 확정에 막힌다. 과거의 '재확정 시 가격 되돌림' 설명은 현재 실제 SP에서 확인되지 않음. |
| C-2 | 안전장치(`cycleWeeks = []` 같은 하드코딩 빈 배열, `if (false && ...)` 같은 꺼진 가드)를 **이유도 모르고 되살리지 말 것**. 되살리려면 그걸 안전하게 만들어준 짝 코드(사이클 헬퍼, 서버측 차단)까지 같이 확인·연결 | 절반만 고치면 반대쪽 안전망 없이 직접쓰기가 다시 열림 |
| C-3 | 확정된 레코드의 물리적 수량 변경은 서버측 확정 가드를 유지한다. C-1 금액 전용 예외는 잠금·업무범위·동시수정·보존값 검사로 서버가 직접 강제한다. 일반 fix/unfix 가드를 완화하거나 force로 우회하지 않는다. | 단가 예외를 수량 변경까지 확대하면 재고 정합성이 깨짐 |
| C-4 | 참조 엑셀/원가자료가 **여러 개**면(농장별 상세 vs 요약본 등) 반드시 전부 대조. 하나만 보고 공식·단가를 코드에 반영하지 말 것 | 2026-07-13: 콜롬비아 그외통관비가 두 소스에서 백상창고료 410/460원, 국내운송비 정액/트럭공식으로 서로 다르게 나와 결론 못 냄(사용자 확인 대기 중) |
| C-5 | `StockMaster.isFix` 같은 "확정=1 / 사용자앵커=2" 식 다값 마커 컬럼은 실제 DB 타입이 `bit`인지 먼저 확인. `bit`면 2는 조용히 1로 잘림 → 값이 절대 구분 안 됨 | 2026-07-10: 이 버그 때문에 "시작재고 앵커" 기능이 한 번도 동작한 적 없었음(`a90c36c`) |
| C-6 | 입력이 잦은 화면(숫자 셀 여러 개)에서 컴포넌트를 **부모 렌더 함수 안에 정의하지 말 것** — 모듈 스코프로 호이스트하고 필요한 state는 props로 전달 | 매 렌더(=매 키입력)마다 새 함수 identity → React가 다른 컴포넌트로 취급해 `<input>` 언마운트 → 포커스 튕김(`bc7828f`) |
| C-7 | Windows Git Bash에서 한글이 포함된 POST 바디를 보낼 땐 인라인 `curl` 금지 — `fetch()` + `JSON.stringify()` 쓰는 Node 스크립트로 | curl이 한글/UTF-8을 깨뜨려 잘못된 값이 저장되거나 매칭 실패로 오진(다른 저장소 사례 다수) |
| C-8 | "빌드 성공" ≠ "검증 완료". 배포 후 **실제 프로덕션 DB 데이터**로 API를 직접 호출해 결과값을 확인할 것 | 이번 세션 다수 사례 — 빌드는 깨끗했지만 라이브 데이터로 확인해서야 로직 오류 발견 |
| C-9 | 차수 데이터(단가/수량/분배/재고)를 고치는 작업은 **`npm run verify:week -- <대차수>` 로 전후 검증**할 것: ① 작업 전 `--snapshot` ② 작업 ③ `--diff` → 바뀐 거래처·품목이 "의도한 것뿐"인지 확인 ④ 인자만으로 실행 → 불변식(V1~V9) 위반 0건 확인. 확정 재사이클을 태웠다면 ③④ 한 번 더 | "단가 바꿨는데 총액 그대로"(V1: Detail↔ShipmentDate Cost 불일치), "총수량이 저절로 바뀜"(diff), "견적서 누락"(V4/V5/V6) 유형을 작업 직후 잡지 못하고 사용자가 며칠 뒤 발견 |
| C-10 | `runEditWithFixCycle` 호출은 화면의 **`orderYear`를 명시적으로 전달**하고 자동 사이클은 `force=false`를 사용할 것. 저장 API는 `ShipmentKey`의 실제 `ShipmentMaster.OrderYear/CustKey`를 대조할 것 | 짧은 `NN-NN` 차수에서 연도 누락으로 저장 중단, 또는 같은 차수의 전년도 원장 혼입·뒤 차수 확정 경고 우회 |

## 도메인 지식 — 자동값을 그대로 믿으면 안 되는 경우

### 2026-08-26 단가 전용 근거

dnSpy `FormShipmentDistribution.btnSave_Click` → `ClassShipmentDate.UpdateCost`는
기존 `EstQuantity`를 유지하고 금액만 갱신한다. 실제 운영 SELECT에서 Master/Date/CustomerProdCost
트리거 없음, Detail 트리거는 `UPDATE(OutQuantity)`만 감시함을 확인했다.
실제 Fix/Cancel SP는 재고와 이력을 변경하므로 `skipStockCalc`만으로 재고 무변경이 되지 않는다.
플래그만 잠시 취소하는 기능을 EXE 기능으로 추정하지 않는다. 가격 전용은 플래그 자체를 보존한다.
상세 근거: `docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md`.

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
