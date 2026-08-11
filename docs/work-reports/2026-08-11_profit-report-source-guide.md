# 주차별 매출이익 보고서 — 항목별 데이터 기준 보기

작업일: 2026-08-11
대상: `/sales/profit-report`
PR: [#139](https://github.com/Jayinsightfactory/nenova-erp-ui/pull/139) (master 반영 `81e24f5`)

## 목적

보고서의 각 금액·비율이 **어느 메뉴·어느 전산 자료에서 오고 어떻게 계산되는지**를 화면에서 바로 확인할 수 있게 한다.
일반 회계 설명이 아니라 현재 코드/SQL 실측 기준으로 작성하고, 자동값과 사용자 입력값을 명확히 구분한다.

## 구현

| 파일 | 역할 |
|---|---|
| `lib/profitReportSourceGuide.js` | 설명 문구 **단일 정의 상수**. 표 20열 + 부가 5행 + 입력화면 5종 + 경계 4종, 입력성격 배지 5종 |
| `components/ProfitReportSourceGuide.js` | 접기/펼치기 UI. `button` + `aria-expanded`/`aria-controls`, 접힘 시 `hidden`, 가로 스크롤 컨테이너 |
| `pages/sales/profit-report.js` | 안내문 아래 한 줄 배치(+2줄) |
| `__tests__/profitReportSourceGuide.test.js` | 회귀테스트(아래) |

- 기본 접힘이며 접힘 상태를 저장하지 않는다 → 새로고침하면 항상 접힌 상태.
- 테이블/컬럼명은 항목명 아래 작은 회색 글씨 + `title` 툴팁으로만 둔다(본문은 비전문가용 한국어).
- 계산·저장·엑셀 다운로드 로직은 **한 줄도 바꾸지 않았다**.

## 다룬 항목 (실측 근거)

### 표 20열

| 열 | 성격 | 핵심 |
|---|---|---|
| 품명 | 자동 | `Product.CounName`/`FlowerName`, 운송료 전용 품목은 `ProdName` 우선. 미매칭 → 기타(미분류) |
| 매출액 C | 계산 | `N + L + O` |
| 매출비율 D | 계산 | `row.C / totals.C` — **분모에 공제·기타(미분류) 포함**, 0이면 빈칸 |
| 기초재고 E | 자동+직접 | 이번차수 저장값 > 전차수 저장 F > 전차수 스냅샷 자동계산 |
| 기말재고 F | 자동+직접 | `(Q×R + S×R + H) ÷ 매입총수량 × 기말수량` → 최근매입단가×수량×환율 → 재고단가표(수량×단가÷1.1) |
| 매입액 G | 계산 | `P + T` (통관비 미포함) |
| 그외통관비 H | 입력화면 | 백상창고료(GW×원/kg) + 관세 + 선율÷1.1 + 월드운송료÷1.1 + 한국방역÷1.1, 베트남 선율만 예외 |
| 매출원가 I | 계산 | `E + G + H − F` (이스라엘·뉴질랜드·일본은 `E + G + H`) |
| 매출이익 J | 계산 | `C − I` (위 3개국은 `C − I + F`) |
| 이익률 K | 계산 | `J / C` (위 3개국·합계행은 `J / (C+F)`) |
| 불량금액 L | 자동 | `Estimate` + `CodeInfo.Descr2 = N'불량차감'` |
| 불량율 M | 계산 | `−L / C` |
| 순수매출 N | 자동 | 확정출고(`sm.isFix=1`, `isDeleted=0`, `OutQuantity<>0`)의 `ShipmentDetail.Amount` |
| 그외매출 O | 자동 | 불량차감 이외 `Estimate` 전부 |
| 상품금액 P | 계산 | `Q × R` |
| 구매금액 Q | 자동 | `WarehouseDetail.TPrice`, 운송료/SERVICE FEE·중량행 제외 |
| 환율 R | 자동+직접 | BILL 스냅샷(`FreightCost.ExchangeRate` 구매액 가중평균) → **29차부터** 전차수 확정 과세환율 → `CurrencyMaster` |
| 포워딩 S | 자동+직접 | 입고 '운송료'/'SERVICE FEE' 자동감지, 콜롬비아 4품목은 무게/CBM 비율 배분 |
| 포워딩 원화 T | 계산 | `S × R` |
| 상품구매비율 U | 계산 | `row.P / totals.P` — **분모에서 공제 제외**(D와 다름) |

### 부가 항목

기타(미분류) 줄 · 공제 줄(직접입력 전용) · 합계행 범위(C/E/F/J만 공제 포함) · 재고 스냅샷 표기 · 비고(자동+수기),
입고 GW/CW 중량 · 관세·선율 1/2/3 분할 · 월드운송료 트럭 등급 · 콜롬비아 배분 · 재고단가표,
차수 경계(27차 기초=26차 마지막 세부차수 / 기말=해당 차수 마지막 세부차수 / 01차만 전년 52차) ·
29차 이후 환율 상속 · 호주 28차·베트남 29차 입력 시작 · 월별 PeriodDay 종료일 귀속.

## 확정 계약 대조 결과

- **재고 차수 경계**: 코드와 일치. 단 `StockMaster.isFix`는 스냅샷 선택 조건이 **아니라** 진단값이므로,
  설명을 "확정 재고"가 아니라 "재고 자료가 실제로 있는 마지막 세부차수"로 정확히 서술했다.
- **29차 규칙**: 코드에 존재하는 `>= 29` 분기는 **환율(R) 상속** 하나다.
  "29차 이후 운송료 입고 반영"에 해당하는 별도 분기는 코드에 없다. 포워딩(S)의 입고 자동감지는
  차수 조건 없이 전 차수에 동일 적용된다.

## 발견한 불일치 (코드 변경 없음)

`docs/exe-golden/FormProfitReport.md`가 매출 집계 필터를 `ShipmentDetail.isFix=1`로 기술했으나,
실제 `lib/profitReport.js`는 `ISNULL(sm.isFix,0)=1`(**ShipmentMaster**)이다.
루트 `CLAUDE.md`·`docs/DB_STRUCTURE.md`도 `sm.isFix=1` 기준이므로 문서 표기를 코드에 맞춰 정정했다.

**미결(의도적 미수정)**: 부분확정(마스터 `isFix=1` + 일부 `sd.isFix=0`) 상태에서는 이 보고서가
미확정 라인까지 매출로 집계할 수 있다. `lib/pivotStats.js`는 같은 매출 집계를 `sd.isFix=1`로 한다.
필터를 바꾸면 확정 차수의 매출액·매출이익 숫자가 즉시 달라지므로 설명 UI 작업 범위에서 변경하지 않았다.
판단 근거 자료: `docs/SHIPMENT_FIX_PARTIAL_AUDIT_2026-05-26.md`.

## 부작용

조회·설명 전용. 패널은 정적 상수만 렌더링하며 DB 조회조차 하지 않는다.
`docs/contracts/weekly-profit-report.json`에 `REPORT_SOURCE_GUIDE_VIEW`(orderDetail/shipmentDetail 모두 `preserve`) 추가,
`FormProfitReport.md` 부작용 표에 행 추가.

## 검증

- `node __tests__/profitReportSourceGuide.test.js` — 전체 통과
  1. 페이지 `COLUMN_DEFS` · 엑셀 `COL_LABEL` · 설명 사전 **3중 키/라벨/순서 일치**
  2. 설명 문구 ↔ 실제 계산 코드 대조(C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, noEnding 3개국,
     D 분모 공제 포함 / U 분모 공제 제외, 통관비 ÷1.1과 베트남 선율 예외, 27차→26차·01차→전년 52차,
     29차 상속, `sm.isFix=1`)
  3. UI 계약(기본 접힘, `aria-expanded`/`aria-controls`, `hidden`, `overflowX`, `wordBreak`, fetch 없음,
     저장 대상 컬럼 `['E','F','H','R','S']` 불변, `needsRateInput` 보존)
- `npm run verify:erp-change` — EXIT=0 (`test:board`, `test:erp-contract`, 계약 manifest, ERP write guard, `next build --webpack`)
- `npm run test:erp-contract`에 신규 테스트 등록

## 운영 확인 (읽기 전용)

배포 후 https://nenovaweb.com/sales/profit-report 실브라우저 확인:

| 확인 항목 | 결과 |
|---|---|
| 패널 렌더 · 기본 접힘 | `aria-expanded=false`, `panel.hidden=true` |
| 펼치기 | 4개 섹션 · tbody 38행 정상 렌더 |
| 키보드 | 버튼 포커스 + Enter 로 접힘/펼침 |
| 새로고침 후 | 다시 접힘, guide 관련 localStorage 키 0개 |
| 좁은 화면(360px 시뮬레이션) | 표가 자체 컨테이너에서 가로 스크롤(324 → 720), **페이지 본문은 가로 스크롤 없음** |
| hydration | `__reactFiber` 부착 확인 |
| 스모크 3종 | `hydration-smoke` / `week-pivot-hydration-smoke` / `layout-shell-smoke` 전부 OK |

### 배포 중 관측된 일시 500 (원인 규명 완료 · 코드 무관)

PR #139 병합 직후 Actions의 `Hydration smoke` 단계가 `500: Internal Server Error`로 실패했다.
같은 시각 다른 작업의 PR #140이 45초 뒤 병합되어 **두 배포가 동시에 pm2를 재기동**했고,
스모크가 재기동 구간에 실행된 것이 원인이다. 재실행은 concurrency 로 취소됐으나,
#140 배포가 내 커밋을 포함한 상태로 **hydration 게이트를 통과**했고, 이후 #141 배포도 성공했다.
현재 운영은 정상(`/api/ping` 200, 보고서 200, fiber 부착).
동일 유형 재발 시 판정법: `.next` 문제인지 재기동 타이밍인지 확인하려면 배포 완료 후
`node scripts/hydration-smoke.js <url>`을 직접 1회 재실행한다.

### 제약

확인에 사용한 브라우저 세션의 JWT가 만료 상태여서 화면에 `로그인이 필요합니다`가 표시됐다.
설명 패널은 데이터와 무관하게 렌더되므로 UI·접근성·반응형은 모두 검증했으나,
**실제 숫자와 설명의 대조는 브라우저가 아니라 코드·SQL·테스트로 수행했다.**
