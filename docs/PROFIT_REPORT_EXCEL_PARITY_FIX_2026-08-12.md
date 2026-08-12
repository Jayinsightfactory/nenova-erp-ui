# 주차별 매출이익보고서 — 22~27차 그외통관비 Excel Parity 수정 (2026-08-12)

## 배경

사용자가 원본 6개 엑셀 파일("매출원가 양식 - NN차_재고수정.xlsx", 22~27차, Downloads 폴더)을
read-only로 재분석해 웹 매출이익보고서와의 불일치를 지적했다. 웹의 기존 공식이 이미 있다는 이유로
보존하지 않고, 엑셀 원본 값·공식을 정답으로 재검증했다.

## 근본 원인 (4건)

1. **국가별 월드운송료 반차수 이중계상** — `effectiveCountryWorldFreight()`가 1차 GW·2차 GW를
   각각 별도 트럭으로 계산했다. 26차 콜롬비아 수국(GW1 2779 + GW2 1444 = 4223kg)은 원본이 결합
   4223kg → 5t 트럭 1대(275,000원)로 계산하는데, 웹은 5t(275,000) + 2.5t(187,000) = 462,000원으로
   약 +187,000원(요청사항 기준 "26차 +350,000원" — 국가별 3건 콜롬비아 수국/네덜란드/중국 합산
   기준) 과다계상했다.
2. **콜롬비아 무게배분 영문 품종 누락** — `CASE_COLOMBIA_ALLOC`(SQL)이 `Product.FlowerName`의
   한글 리터럴(장미/카네이션/알스트로/루스커스)만 매칭해, 영문(ROSE/CARNATION/ALSTROEMERIA/RUSCUS)
   FlowerName 품목이 그외통관비/포워딩 무게배분 대상에서 누락됐다.
3. **22~27차 저장값 부재 + 전역 요율 오염** — 이 기능 도입 이전 시점인 22~25차는
   `WebCustomsWeekly`/`WebColombiaWeekly`에 저장값이 거의 없어 자동계산이 0 또는 크게 어긋났다.
   원본 워크북은 22~27차 전체 시트를 read-only로 완전히 분석했고 국가별 개별 항목·콜롬비아
   HandlingFee/CustomsFee 등 구성요소 값도 원본 시트에서 읽을 수 있었다 — 다만 그 항목들이
   운영 DB(`WebCustomsWeekly`/`WebColombiaWeekly`)의 입력 필드로 저장된 적이 없어(이 기능 도입
   이전이라 입력 화면 자체가 없었음), 존재한 적 없는 운영 DB 저장값을 역산해 발명하지 않기로
   했다. 이에 따라 프로덕션 감사 폴백은 원본에 실제로 있는 **검증된 최종 H 총액**·콜롬비아
   **TOTAL(무게배분 전)+GW+박스수량**만 저장하도록 의도적으로 설계했다(아래 "미변경" 참고).
   또한 백상 창고료 요율(`BakSangRate`)이 전역 설정 하나뿐이라 나중에 요율이 바뀌면 과거 확정
   차수까지 조용히 재계산되는 결함이 있었다(22차=370원/kg, 23~27차=460원/kg이 원본 기준).
4. **UI: 전차수 참고값이 유효값처럼 보임** — `CustomsClearancePanel.js`가 저장값이 없으면 전차수
   값(carry)을 입력칸에 자동으로 채웠지만, 서버의 실제 합계 계산은 그 carry를 반영하지 않았다.
   저장 버튼도 필드 단위로 carry를 저장 대상에 포함해, 빈 "저장" 클릭이 참고값을 조용히 저장행으로
   굳힐 위험이 있었다.

## 수정 내용

| 결함 | 파일 | 요지 |
|---|---|---|
| 1 | `lib/customsForwarding.js` `effectiveCountryWorldFreight()` | GW1+GW2 합산 중량으로 트럭 1대만 선정, 1차 칸 전액/2차 0. 명시적 수기 override는 그대로 보존. 콜롬비아 4품목 반차수별 트럭 계산은 변경 없음(원본 그대로 유지가 정답). |
| 2 | `lib/colombiaFlowerClassification.js`(신규), `lib/customsForwarding.js` | FlowerName+ProdName 양쪽에서 한글+영문 토큰 매칭하는 SQL·JS 공용 단일 진실 소스 신설. 운송료/SERVICE FEE/현지상차운임/GW·CW placeholder 행 명시적 제외. |
| 3 | `lib/profitReportAuditedBaseline.js`(신규), `lib/customsForwarding.js` | 22~27차 국가별 H 총액·콜롬비아 반차수 GW/박스수량/TOTAL·대차수별 BakSangRate를 원본에서 그대로 옮긴 프로덕션 단일 진실 소스. `resolveCountryCustomsTotal()`/`resolveColombiaCustomsAllocation()`을 신설해 "explicit saved row > audited baseline(2026 22~27차만) > current auto > global defaults" 우선순위를 한 곳에서 관리하고, `computeCustomsAndForwarding()`(실계산)과 `customs-clearance` API GET(입력화면 미리보기)이 같은 함수를 공유. `WebCustomsWeekly`/`WebColombiaWeekly.BakSangRateApplied`(신규 컬럼) 스냅샷으로 전역 요율 변경이 과거 저장행을 오염시키지 않게 함. |
| 4 | `components/CustomsClearancePanel.js` | carry를 `countryValue`/`colValue`(=합계에 실제 반영되는 값)에서 제거하고 `CarryHint`로 분리 표시 — 클릭(명시적 적용) 전까지 합계 미반영. `countryOut`/`colombiaOut`도 carry만 있는 필드는 저장 대상에서 제외. 저장 버튼은 변경사항 없으면 API를 호출하지 않음. 감사기준값/자동/전차수 참고값을 배지·색상으로 구분 표시, 안내 문구를 결합 GW/콜롬비아 반차수 차이로 갱신. |

## 검증한 정확값 (요청사항 원문과 1:1 대조)

- H 그랜드토탈(국가 소계 + 콜롬비아 4품목 합계) 22~27차 전부 정확히 일치:
  22차 12,618,238.7 / 23차 10,399,196 / 24차 12,041,616 / 25차 9,862,990 / 26차 11,536,110 /
  27차 10,813,030.
- 콜롬비아 반차수 GW/박스수량/TOTAL 12건(22-01~27-02) 원문과 정확히 일치.
- 결합 GW 월드운송료 예시(26차 콜롬비아 수국 2779+1444→5t, 네덜란드 192+520→1t, 중국 646+201→1t)
  재현.
- BakSangRate: 2026-22=370, 2026-23~27=460, 2025년 동일 차수·2026-28 이후는 미적용(교차연도/범위
  오염 없음).

모두 `__tests__/profitReportAuditedBaseline.test.js`가 자동 검증한다(fixture와 대조 + 그랜드토탈
재구성 + 우선순위 3종).

## 변경 파일

**신규**
- `lib/profitReportAuditedBaseline.js`
- `lib/colombiaFlowerClassification.js`
- `__tests__/profitReportAuditedBaseline.test.js`
- `__tests__/colombiaFlowerClassification.test.js`
- `docs/PROFIT_REPORT_EXCEL_PARITY_FIX_2026-08-12.md`(이 문서)

**수정**
- `lib/customsForwarding.js` — CASE_COLOMBIA_ALLOC 영문 매칭, 결합GW 월드운송료, BakSangRateApplied
  스냅샷, `resolveCountryCustomsTotal`/`resolveColombiaCustomsAllocation`/`effectiveRatesForWeek`/
  `computeColombiaAllocationFromTotal` 신설, `computeCustomsAndForwarding()` 리팩터.
- `pages/api/sales/customs-clearance.js` — GET이 같은 resolver를 공유하도록 리팩터, `totalSource` 필드 추가.
- `components/CustomsClearancePanel.js` — carry 분리, 안내 문구 갱신, 감사기준값 배지.
- `__tests__/customsForwardingAuto.test.js` — 결합GW로 바뀐 `effectiveCountryWorldFreight` 기대값 갱신 + 요청사항 2번 원문 예시 추가.
- `docs/contracts/weekly-profit-report.json` — scope/actions(`COLOMBIA_INPUT_SAVE`/`RATE_SAVE` 추가)/requiredTestFiles/`auditedBaselinePolicy` 갱신.
- `docs/exe-golden/FormProfitReport.md` — 결함 1~4 근거 섹션 추가.
- `package.json` — `test:erp-contract`에 신규 테스트 2건 연결.

## 미변경(의도적으로 손대지 않음)

- `computeCountryCustomsTotal()`/`computeColombiaCustomsTotal()`의 H 공식 자체(백상·관세 그대로,
  선율/월드운송료/방역 ÷1.1, 베트남 선율 예외)는 요청사항 1번 원문과 이미 정확히 일치해 재검증만
  하고 변경하지 않았다.
- 콜롬비아 4품목의 반차수별(트럭 포함) 계산 구조는 요청사항 3번 원문 그대로 유지했다(국가별과
  달리 결합하지 않음).
- 호주 28차/베트남 29차 검증 시작차수 정책(`lib/profitReportAudit.js`)은 이미 "경고 생성만
  억제하고 실제 계산값은 건드리지 않는" 올바른 구조였으므로 코드 변경 없이 회귀 테스트로만 고정했다.

## 남은 리스크

- 국가별(콜롬비아 수국 포함) 감사 기준값은 카테고리 최종 H 합계만 저장하고, GW/관세/선율 개별
  구성요소는 별도로 저장하지 않는다. 원본 워크북은 그 구성요소 값도 포함해 전부 read-only로
  분석했다 — 재추출이 불가능해서가 아니라, 그 구성요소들이 운영 DB(`WebCustomsWeekly`)의 입력
  필드로 저장된 적이 없는 상태에서 "저장됐어야 할 값"을 역산해 발명하지 않기 위한 의도적 설계다
  ("Do not invent values absent from the fixture" 원칙은 값을 몰라서가 아니라 존재한 적 없는
  운영 DB 저장값을 만들어내지 않는다는 뜻으로 적용했다). 따라서 22~27차 국가 행을 나중에 운영자가
  직접 저장(부분 입력 포함)하면 그 순간 감사 기준값이 아니라 입력된 구성요소 기반 공식으로
  전환되며, 구성요소가 불완전하면 감사값과 달라질 수 있다 — 이는 새 결함이 아니라 "explicit saved
  row가 항상 최우선"이라는 요청사항 7번 정책 그대로다.
- `CustomsClearancePanel.js`의 carry 분리·미리보기 재계산은 실제 렌더링·클릭 상호작용까지는 이
  저장소에 React 테스트 러너가 없어 커버하지 못한다(`__tests__/customsClearancePanelLiveTotal.test.js`는
  소스 문자열 검사 + 계산식 자체의 입력/출력만 검증). 실브라우저 스모크로 추가 확인을 권장한다
  (배포 스모크 절차에 이미 포함된 hydration 검사 범위 밖).
- `BakSangRateApplied` 컬럼은 idempotent `ALTER TABLE`로 저장(POST) 경로에서만 생성되므로, 운영
  DB에는 실제 저장이 처음 일어날 때 컬럼이 추가된다(마이그레이션 SQL 파일을 별도로 만들지 않음 —
  기존 `WORLD_FREIGHT_MANUAL_FIELDS`/`COUNTRY_SPLIT_GROUPS` 컬럼과 동일한 기존 패턴을 그대로
  따랐다).

## 후속 검토 반영 (2026-08-12)

독립 리뷰에서 남은 결함 2건을 지적받아 수정했다.

1. **`WorldFreight2` 레거시 이중계상 잔존** — `effectiveCountryWorldFreight()`가 결합 GW 자동값이
   있어도 `WorldFreight2Manual` 플래그 없는 레거시 `WorldFreight2` 리터럴을 그대로 보존해, 1차
   (결합 트럭 전액)+2차(레거시 리터럴)가 함께 더해지는 이중계상 경로가 남아 있었다. 수정: override
   플래그 없는 2차 값은 결합 GW로 자동값을 낼 수 있는 한(`combined.amount > 0`) 항상 0으로 강제하고,
   레거시 리터럴은 결합 자동값 자체를 낼 수 없을 때(GW가 전혀 없는 구형 데이터)만 보존한다. 명시적
   수기 override(`WorldFreight2Manual=1`)는 그대로 존중한다. 회귀:
   `__tests__/customsForwardingAuto.test.js`("잔여 결함(2026-08-12)" 절 — override 없는 2차 레거시
   리터럴이 결합 자동값과 공존할 때 0으로 정리되는지, GW가 전혀 없을 때만 보존되는지 3개 케이스).
2. **`CustomsClearancePanel`의 저장 전 합계 stale** — 화면 입력칸을 고쳐도 "합계"·저장 버튼 옆
   합계가 마지막 조회(GET) 시점 값에 멈춰 있어, 저장 전까지 "보이는 값"과 "저장하면 반영될 값"이
   달랐다. 수정: `computeCountryCustomsTotal`/`computeColombiaCustomsTotal`/`computeColombiaAllocation`/
   `computeColombiaAllocationFromTotal`/`effectiveRatesForWeek`/`COLOMBIA_ALLOC_CATEGORIES`를
   `lib/customsForwarding.js`(DB 의존)에서 신규 `lib/customsForwardingCalc.js`(DB 의존 없음)로
   옮기고, `lib/customsForwarding.js`는 그 모듈에서 import한 뒤 그대로 재노출(re-export)한다.
   `components/CustomsClearancePanel.js`가 `lib/customsForwardingCalc`를 직접 import해, 수기 편집이
   있는 행만 즉시 같은 공식으로 재계산해 표시한다(편집 없는 행은 서버가 마지막으로 계산한
   `row.total`을 그대로 보여준다 — 특히 2026 22~27차 감사 기준값 행은 공식으로 재구성할 수 없는
   최종 합계이므로 편집이 없으면 절대 재계산하지 않는다). carry(전차수 참고값)는 이 미리보기에도
   여전히 자동 반영되지 않는다(명시적 적용 후에만). 회귀:
   `__tests__/customsClearancePanelLiveTotal.test.js`(순수 계산 모듈의 DB 무의존 검증, 재노출
   참조 동일성, 화면이 정적 `row.total`/`c.allocationH` 대신 재계산 함수를 쓰는지 소스 검사,
   편집 전/후 합계가 실제로 달라지는 시나리오).
3. **문서 표현 정정** — "구성요소를 원본에서 재추출할 수 없었다"는 표현이 워크북을 완전히 분석하지
   못한 것처럼 읽혔다. 실제로는 22~27차 6개 워크북 전체 시트를 완전히 분석했고, 국가별 개별 항목·
   콜롬비아 HandlingFee/CustomsFee 등 구성요소도 원본에서 읽을 수 있었다. 감사 폴백이 그 구성요소를
   별도 저장하지 않고 검증된 최종 H 총액(과 콜롬비아 TOTAL+GW+박스수량)만 저장하는 것은 "재추출
   불가"가 아니라, 운영 DB(`WebCustomsWeekly`/`WebColombiaWeekly`) 입력 필드로 저장된 적 없는
   값을 역산해 발명하지 않기 위한 의도적 설계다. 위 "근본 원인 3"·"남은 리스크"·
   `docs/exe-golden/FormProfitReport.md` "결함 3" 절과 `lib/customsForwardingCalc.js`(콜롬비아
   TOTAL 배분 주석)의 표현을 이에 맞춰 정정했다.
