# 신라 시트별 결산 기간 식별자 설계 — 2026-10-05

## 목적과 승인 범위

신라 원본의 `39차`와 `39차-2`를 서로 독립적인 결산으로 미리보기·선택 저장하고,
저장 목록·상세·품목 연결·매입단가 관리·비교·엑셀/인쇄에서 끝까지 구분한다.
`39-2차`는 `39차-2`의 표기 변형이며 같은 기간이다. 두 표기가 한 파일에 함께
존재하면 같은 기간 중복으로 차단한다. `39차`와 `39차-2`는 합산하거나 서로 덮어쓰지 않는다.

웹 결산 기간을 ERP 세부차수로 해석하지 않는다. 이번 변경의 저장 대상은 기존
`WebRaumPnl`/`WebRaumPnlItem`뿐이며, 사용자 명시 저장과 기존 snapshot 검증을 유지한다.
업로드 자동 저장, 운영 데이터 보정, 원본 엑셀 수정, ERP 동기화는 추가하지 않는다.

이 문서는 ARCHITECT/REVIEWER의 P0_LOCAL 설계 산출물이다. 외부 쓰기·DB 쓰기·비밀값
읽기·승인 요청은 수행하지 않았다. `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 이
worktree에 없으며 메인이 준비한 canonical 운영 규칙과 역할 배정을 따른다.

## 읽기 근거와 현재 실패 경로

메인 preflight가 확인한 실제 원본은
`C:/Users/USER/Desktop/2026 신라 상반기 입고 손익계산_이사님보고.xlsx`다.
`39차`의 A1은 `신라호텔39(9.29)`, `39차-2`의 A1은 `신라호텔39-2(10.2)`다.
후자는 2개 품목, 원본 매입액 299,928원, 매출액 389,200원이다.
운영 SELECT 근거는 `WebRaumPnl.MajorWeek NVARCHAR(4)` 및 `OrderYear NVARCHAR(4)`,
2026년 신라 `39`의 PnlKey 60/10개 품목/매출액 28,636,904원, 2025년 동일 39차 없음이다.
독립 DB probe와 실제 dnSpy CLI 실행은 메인이 수행했으며 이 하위 작업에서 재실행하지 않았다.
메인의 실제 브라우저 read-only preview는 `PRESERVATION_COLLISION`을 반환했다.
기존 39차 호접 화이트(8스팀) 한 원본행에 `39차` 11행과 `39차-2` 4행이 합쳐져
원본행 수가 달랐다. 현재 저장 차단은 보존 guard의 정상 동작이며 guard를 완화하지 않는다.

직접 확인한 코드의 실패점:

- `lib/shillaPnlParse.js`: `classifySheetName`은 `^(\d{1,2})차`만 읽어 `39차-2`를 `39`로
  분류하고 `39-2차`는 읽지 않는다. `buildBatch`는 같은 major의 시트를 합친 뒤 중복 실패로 막는다.
- `lib/shillaPnlImportPolicy.js`: `selectedMajors`가 정확히 두 자리 숫자여야 한다.
- `lib/raumPnl.js`: preview/transaction major는 문자열이지만 `assertImportBatches`의
  검증 identity는 비숫자를 제거한다. `39-2` 검증 key를 `392`로 만들면 서로 다른
  기간을 검사하는 위험이 있다. 실제 batch 저장이 392를 기록했다고 단정하지 않는다.
  충돌 위치 설명도 비숫자를 제거한다.
- `pages/api/raum/pnl.js`: 상세 save도 비숫자를 제거한다.
- `lib/raumPnlPurchaseCost.js`, `lib/shillaPnlDetailCost.js`: isolated-hotel 단가 scope를
  Number로 읽고 SQL Int를 사용한다. 하이픈 기간은 거부되거나 SQL 변환 오류가 난다.
- `lib/shillaPnlProductMatch.js`, `lib/shillaPnlBulkMatchState.js`,
  `lib/shillaPnlBulkMatch.js`: scope/부모 감사 수정/그룹 snapshot이 정수 major를 전제한다.
- `lib/raumPnlCostComparisonServer.js`, `lib/pnlHotelCostHistory.js`,
  `lib/raumPnlCostComparison.js`: Number 또는 TRY_CONVERT(INT) 전제는 하이픈 기간을
  NaN/누락/잘못된 정렬로 만들고 독립 단가 셀을 잃게 한다.
- `lib/raumPnlPartner.js`, `lib/raumPnlExcel.js`, `pages/raum/pnl.js`,
  품목 연결 모달: 제목·시트명·알림·선택 라벨의 Number 변환은 NaN차를 만든다.
- 도착원가/연결 업체 출고 참조는 ERP 대차수 입력을 요구한다. 결산 기간 전체를
  그대로 넘기면 실패하며 `39-2`를 ERP `39-02`로 바꾸는 것은 근거 없는 해석이다.

`docs/exe-golden/FormRaumPnl.md`의 기능 경계와 메인의 실제 FormOrderAdd CLI 근거는
웹 결산과 공유 ERP 주문키가 다름을 뒷받침한다. 기존 ERP `OrderYear + OrderWeek`
정책은 변경하지 않는다.

## 결정: 무DDL, 길이 4 이내 canonical 기간

기존 `MajorWeek` 컬럼과 API의 `major` 필드 이름을 유지하되 의미를
**웹 결산 기간 식별자**로 명시한다. 신라 하위 기간만 문자열을 허용한다.
별도 schema migration이나 기존 저장행의 일괄 변환은 필요 없다.

| 원본/입력 | canonical 저장·payload | 표시 | ERP read-reference 대차수 |
|---|---|---|---|
| `39차`, `39`, `039` 금지 | `39` | `39차` | `39` |
| `5차`, `5`, `05` | `05` | `5차` | `05` |
| `39차-2`, `39-2차`, `39-2` | `39-2` | `39-2차` | `39` |
| `5차-2`, `5-2차`, `05-2` | `05-2` | `5-2차` | `05` |
| `39-10`, `39-02`, `39-0`, `39-2-1` | 거부 | 저장 불가 이유 | 조회하지 않음 |

범위는 기존 두 자리 PNL 대차수의 양수 1..99를 유지하고, 하위 기간은 명시적인
1..9만 허용한다. ERP 달력의 1..53 제한을 PNL 기간에 새로 적용하지 않는다.
길이 4를 넘는 기간은 앞부분만 자르거나 major에 합치지 않고 미리보기/저장 양쪽에서
명확히 차단한다. 10 이상의 하위 기간을 지원해야 할 때만 후속 명시 migration으로
컬럼 확장 및 계약을 변경한다. 이번 실제 원본 `39-2`에는 그 확장이 필요 없다.

`39-1`과 `39`도 서로 다른 기간이다. `-1`을 삭제하는 동의어 규칙은 만들지 않는다.
유니코드 하이픈·소수점·지수·부호·임의 문자 제거 등 느슨한 정규화는 금지한다.
기존 제목 접미사(`31차8월`, `5차ㅇㅋ`) 허용은 시트 분류에서만 유지하고,
`39차-` 또는 `39차-10`처럼 하위 기간을 시도한 잘못된 이름은 일반 접미사로 우회하지 못한다.
범위/결산/검토 시트 제외 규칙과 금액/행 검증 규칙은 그대로다.

## 공통 helper 계약

새 browser-safe 순수 파일 `lib/raumPnlPeriod.js` 하나를 backend/UI가 공유한다.

- `parsePnlPeriod(value)` → 유효 시 `{ key, baseMajor, subPeriod, label }`, 무효 시 null.
  `key`와 `baseMajor`는 두 자리 문자열, subPeriod는 null 또는 1..9 정수다.
- `normalizePnlPeriod(value, { allowSubPeriod })` → canonical key 또는 설명 가능한
  validation error. `allowSubPeriod=true`는 명시 `PartnerCode='shilla'`에서만 허용한다.
  기존 라움/초이문/등록 호텔의 숫자 대차수 및 ERP 동기화 범위는 확대하지 않는다.
- `formatPnlPeriod(value)` → 표시 라벨. `Number('39-2')` 대체 용도이며 invalid를
  valid처럼 꾸미지 않는다.
- `comparePnlPeriods(a,b)` → baseMajor 숫자, subPeriod(null=0) 숫자 순서.
  ascending은 38, 39, 39-1, 39-2, 40이고 descending은 역순이다.
- `pnlPeriodBaseMajor(value)` → 검증된 canonical baseMajor만 반환. ERP 참조
  어댑터에서 사용하며 suffix를 ERP OrderWeek로 만들지 않는다.
- `pnlPeriodValue(value)` → 기존 numeric DTO/테스트 형식을 유지하기 위한 어댑터.
  일반 기간은 number(예: 39), 하위 기간은 canonical string(예: `39-2`)을 반환한다.
  무효 입력은 null을 반환하며 쓰기 boundary가 설명 가능한 validation error로 거부한다.
  표시/정렬/비교는 이 혼합형 자체를 Number로 변환하지 않고 helper로 수행한다.

모든 기간 identity, snapshot key, 선택 key, 비용 cell key는 canonical `key`를
사용한다. 저장 scope는 `OrderYear + PartnerCode + periodKey`이며 상세 수정을 위한
`PnlKey + ItemKey`와 전체 expected snapshot 검증은 추가로 유지한다.
shared Raum/Choimun 단가 경로는 기존 숫자 입력/같은 두 호텔 범위만 유지한다.

## 기준 ledger와 부작용

| 기준 | 정식 근거 | 소비자 / 강제 규칙 |
|---|---|---|
| 기간의 원천 | 실제 시트명 | parser, preview, selectedMajors, token, save, 상세; A1/전산 메모로 재배정하지 않음 |
| canonical identity | 컬럼 NVARCHAR4 + 기존 year/partner scope | 공통 helper; 하위 기간 분리, 연도/호텔 분리, 무효값 거부 |
| 명시 연도 | 기존 신라 import 계약 | preview/save/비용/연결의 모든 payload; 다른 연도 같은 기간과 별도 |
| 날짜·월 | 원본 A1 날짜 + 기존 QuoteDate/AssignedMonth | 39는 9/29, 39-2는 10/2; 월 합계는 각 저장행의 기존 날짜/월 정책 |
| 저장 권한 | 기존 명시 저장/선택/snapshot | preview는 read-only, 자동 저장 없음, 기존 period만 overwrite 경고, 실패 자동 재시도 없음 |
| 원가 출처 | 원본 shilla 값/보존된 수기값 | 기존 수기 CostPrice·ProdKey 보존을 정확히 같은 period 안에서만 수행 |
| ERP 참조 | 기존 read-only helper 정책 | baseMajor를 명시 파생; 모든 세부차수 조회 범위는 기존 정책 유지, 결산 -2와 ERP -02 대응 없음 |
| 정렬/표시 | canonical tuple/label | 목록, 비용 matrix/history, export, 알림/접근성 라벨에 동일 helper 사용 |

| 사용자 동작 | WebRaumPnl | WebRaumPnlItem | Order/Shipment/Warehouse/Stock | Estimate / ShipmentDetail Amount,Vat,isFix / WebProfitReport |
|---|---|---|---|---|
| 업로드 preview/목록/상세/비교/export/참조 | SELECT | SELECT | 보존(기존 명시 참조 SELECT만) | 전부 보존 |
| 선택 import/상세 결산 save | 정확히 같은 year+partner+period INSERT/UPDATE | 그 PnlKey 범위 기존 교체/보존 정책 | 전부 보존 | 전부 보존 |
| isolated 원가 저장 | 대상 부모 audit만 UPDATE | 대상 CostPrice/CostSource만 UPDATE | 전부 보존 | 전부 보존 |
| 단건/동일호텔/일괄 품목 연결 | 대상 부모 audit만 UPDATE | 명시 대상 ProdKey만 UPDATE | 전부 보존 | 전부 보존 |
| 기존 삭제/월 배정 | 기존 PnlKey+partner 범위만 | 기존 정책 | 전부 보존 | 전부 보존 |

같은호텔 자동 연결은 이미 승인된 연도+정확 이름/단위 그룹 정책을 유지한다.
그룹에는 39와 39-2가 모두 있을 수 있으나 멤버 snapshot에는 각 period/PnlKey/ItemKey를
그대로 담는다. 이는 품목 연결키 재사용일 뿐 두 결산 수량/가격/금액/원가를 합치는 것이 아니다.

## 구현 파일 소유권 분리 제안

동시에 수정하지 않도록 아래처럼 소유한다. 공통 helper API를 먼저 확정한 후 각 구현을 시작한다.

### A. 핵심 parser/storage 담당

- 신규 `lib/raumPnlPeriod.js` 및 `__tests__/raumPnlPeriod.test.js`.
- `lib/shillaPnlParse.js`, `lib/shillaPnlImportPolicy.js`: 두 표기 분류, 기간별 배치,
  exact period 중복 차단, 선택 검증 및 정렬.
- `lib/raumPnl.js`, `pages/api/raum/pnl-import.js`, `pages/api/raum/pnl.js`: 단일·다차수
  save/preview key/snapshot/token/정확 scope, 서버 정렬 및 참조 adapter.
- 구현자는 아래 C 소유 참조 helper에 넘기는 `major`를 baseMajor로 명시 파생하되
  동일 helper 자체의 정책을 변경하지 않는다.

### B. UI/export 소비자 담당

- `lib/raumPnlPartner.js`, `lib/shillaPnlDetailCost.js`, `lib/raumPnlCostComparison.js`:
  제목/상세 단가 요청/isolated matrix/history/combined key 및 정렬.
- `lib/raumPnlExcel.js`: 서로 다른 `39차`/`39-2차` 시트명과 결산 행/수식 참조;
  교차연도 같은 기간만 기존 연도 접두사 충돌 해결 유지.
- `lib/raumPnlCollisionLocation.js`: 보존 충돌 위치와 period 라벨, 392차 방지.
- `pages/raum/pnl.js`: preview 선택/표시/overwrite 확인/월배정/목록/상세/인쇄/
  단가/매칭 결과 알림/기간 입력을 하이픈 보존으로 변경.
- `components/raum/ShillaProductMatchModal.js`,
  `components/raum/ShillaBulkMatchModal.js`, `components/raum/HotelCustomerMapping.js`,
  필요 시 `pages/raum/purchase-costs.js`, 비용 cell/history 컴포넌트: period를 Number로
  재변환하지 않음. reference 표시에서 결산 period와 ERP 대차수를 구분한다.

### C. 비용/품목연결 backend 담당 (구현 슬롯이 있을 때 분리)

- `lib/raumPnlPurchaseCost.js`: isolated 경로만 canonical 문자열 및 `sql.NVarChar(4)`;
  shared 경로는 기존 숫자 정책 유지.
- `lib/shillaPnlProductMatch.js`, `lib/shillaPnlBulkMatch.js`,
  `lib/shillaPnlBulkMatchState.js`: 요청/멤버 scope·부모 audit의 문자열 period.
- `lib/raumPnlCostComparisonServer.js`, `lib/pnlHotelCostHistory.js`: DTO의 period 보존,
  최신순 SQL base/suffix 정렬 또는 helper 기반 안정 정렬(품목 Seq/ItemKey 순서 유지).
- `lib/raumPnlArrivalReference.js`, `lib/pnlHotelCustomerMap.js`: explicit read-reference
  boundary에서만 baseMajor 파생; 저장/비교 identity에는 base로 축약하지 않음.

두 구현 담당만 사용할 때 C 파일들은 A 담당에게 포함하며 B 파일과 겹치지 않는다.
테스트/fixture는 별도 저비용 담당의 명시 소유로 배정할 수 있다. 그 경우 구현 담당은
test 파일을 동시에 수정하지 않고 완료 기준·helper stub/API를 테스트 담당에게 전달한다.
테스트 담당은 `__tests__/raumPnlPeriod.test.js` 및 관련 parser/import/purchase/match/
bulk/history/UI/render/Excel/combined/detail-cost/collision 테스트와 교차연도 fixture를 소유한다.

### 메인 소유

- `docs/contracts/raum-pnl-settlement.json` scope/동작/fixture 등록,
  `docs/DB_STRUCTURE.md`, `docs/exe-golden/FormRaumPnl.md`, 세션 백업.
- 통합 회귀·실제 원본 read-only 검증·1920×1080 CSS pixel/100% 브라우저 smoke.
- 커밋/PR/병합/배포 및 실제 사용자 선택 저장이 필요한 경우의 외부/DB 쓰기.

## 모바일 경계

직접 읽은 `/m/executive`의 `ExecutiveReports`와
`mobileExecutiveReportPreview/mobileWeeklyDemo/mobileMonthlyDemo`는 **가상 demo 전용**이며
WebRaumPnl을 읽지 않는다. 이번 요청을 이유로 운영 자료를 client fixture에 넣거나 demo를
실자료 저장/공유 화면으로 바꾸지 않는다. 실제 사용 대상이 Nenovaweb 모바일 브라우저의
`/raum/pnl`이면 같은 페이지의 반응형 표시와 같은 JSON으로 39/39-2를 확인한다.
별도 운영 모바일 소비 경로가 메인 preflight에서 확인되면 canonical 문자열 period와
PnlKey를 보존하는 adapter만 추가한다. demo 자료에 실제 업로드 금액을 복사하는 것은 금지한다.

## 최소 실행형 fixture와 완료 기준

1. 한 workbook의 2026 신라 `39차`와 `39차-2`가 별도 verified batch/선택/token key로
   나온다. 원본 39-2의 2행/매입액 299,928/매출액 389,200 및 10/2 날짜를 유지한다.
   현재 실제 파일의 preview가 기존 `PRESERVATION_COLLISION` 없이 두 별도 배치를 보여야 하며
   호접 화이트 수기 원가/연결 보존 guard 자체를 완화해서 통과시키지 않는다.
2. 표기 변형 `39-2차`는 동일 canonical이다. 두 변형을 같이 넣으면 정확히 39-2 중복으로
   차단되며 39 정상 batch를 오염시키지 않는다. 범위/결산/검토 제외 회귀도 통과한다.
3. 기존 2026 shilla 39를 가진 mock DB에 39-2만 저장하면 39-2 신규 부모/품목만 쓴다.
   39/PnlKey60의 10행/매출/수기원가/ProdKey는 보존한다. 39-2 재업로드는 자기 PnlKey만 갱신한다.
4. 2025 동일 39/39-2 및 raum/choimun/다른 호텔 fixture는 SELECT lock/UPDATE/DELETE에서
   제외된다. period 문자열을 제거해 392로 만드는 요청은 어느 소비자에도 없다.
5. 39-2의 상세 비용 edit와 매입단가 matrix/history에 실제 셀이 표시된다. snapshot은
   exact year+partner+period+PnlKey+ItemKey이며 stale/추가/삭제/변경 시 전체 rollback한다.
   0과 null은 보존, shared 두 호텔에는 영향 없음.
6. 단건/동일호텔/일괄 품목 연결이 39-2를 정상 scope로 검증한다. 별도 period 멤버가
   snapshot에 보존되며 ERP/Product/글로벌 이름·단가 학습은 쓰지 않는다.
7. 순서는 40,39-2,39-1,39,38(최신순)이고 기존 numeric period 소비의 순서는 유지한다.
   기존 최신 결산의 품목 Seq/ItemKey 정렬과 새 품목 append 계약은 유지한다.
8. Excel은 `39차`와 `39-2차` 별도 sheet, 제목/결산 행, 올바른 별도 수식 참조/캐시를
   가진다. NaN차/392차/동일 시트 덮어쓰기 없음. 월별 합계는 각 QuoteDate/AssignedMonth 기준이다.
9. omitted/명시 numeric/leading-zero numeric/유효 -2/무효 -0,-02,-10/다른 연도/stale
   snapshot fixture를 모두 확인한다. 길이초과는 parser/save/비용/연결에서 일관되게 거부한다.
10. 도착원가/업체 출고 read-reference는 선택 39-2에서 base 39의 **기존 정책 그대로**
    조회하며 결산 -2를 ERP 세부 -02로 추정하지 않는다. 원장/Excel 모델에는 참조를 저장하지 않는다.

필수 통합 gate: `test:erp-contract`, `test:nenova-dnspy-evidence`, 변경 기준 SHA를
사용한 `test:erp-manifest`와 `guard:erp-writes`, `build`, `test:ui-layout`.
실브라우저 desktop은 1920×1080/100%로 목록·두 기간 선택·상세·비용·표 스크롤·모달/
sticky 가림·실패 안내를 확인하고 작은 모바일 viewport에서 핵심 기능 접근을 확인한다.
실제 사용자 원장 쓰기 수행 여부와 read-only smoke는 최종 보고에서 구분한다.

## 2026-10-05 통합 read-only 검토

검토 범위는 이 branch의 period helper/parser/storage/API/비용·품목 연결 scope와
UI/비교/월합계/Excel 소비자 diff다. 리뷰어는 코드·DB·외부 서비스를 변경하지 않았으며
이 설계 문서만 갱신했다. 통합 ERP gate·build·브라우저 검증·배포 여부는 메인 기록을 따른다.

- `npm run test:shilla-pnl` 전체 통과. 이후 parser decimal boundary 수정 뒤
  `shillaPnlPeriodImport`, `shillaPnlPeriodConsumers`, `shillaPnlPeriodScope` 재실행도 통과했다.
- import snapshot/transaction은 정확한 `OrderYear + PartnerCode + canonical period`를
  함께 사용한다. 39-2-only 저장 fixture가 기존 39의 10행/수기원가/ProdKey, 전년도
  39/39-2, 다른 호텔을 보존하고 child insert 실패를 rollback한다.
- isolated 비용/단건·동일호텔·일괄 연결의 부모 scope는 전체 기간과 NVarChar(4)를
  유지한다. shared Raum/Choimun의 숫자 경로 및 허용 호텔 범위는 유지한다.
- 비교/history DTO는 일반 기간 number와 하위 기간 canonical string을 유지하며
  helper tuple 정렬을 사용한다. 39/39-2는 별도 matrix cell과 Excel sheet/결산 formula다.
- 실제 월 helper를 별도 실행하여 9/29의 39는 2026-09,
  10/2의 39-2는 2026-10에 각각 합산되고 기간 문자열도 보존됨을 확인했다.
- ERP read boundary의 baseMajor만 파생하며 결산 -2를 ERP -02로 해석하지 않는다.
  기존 신라 full-document save 차단과 ERP 자동수정 차단은 그대로다.
- 메인의 최신 실제 원본 parse는 40개 period이며, 39는 10행의 원본 합계 불일치를
  계속 표시하고 39-2의 2행/매입액 299,928/매출액 389,200/10월 2일은 검증 통과한다.
  따라서 이 파일의 39까지 검증 성공이라고 보고하거나 금액 guard를 완화하면 안 된다.
  위 최초 완료 기준의 verified batch는 원본 금액이 정상인 fixture 기준이며,
  실제 파일의 기존 금액 불일치를 고친다는 뜻이 아니다.

발견하여 메인에 전달한 경계 이슈:

1. P2: `39차-2.5`, `39차-2.0`, `39-2차.5`가 39-2로 포함되는 decimal fallback.
   메인이 subperiod 뒤 접미사를 빈 값/공백/괄호로 제한하고 3개 fixture를 추가했다.
   수정 diff 및 실행 테스트 통과를 리뷰어가 확인했다.
2. P2: `39차–2`, `39차−2`, `39차‐2`, `39차.2`가 일반 제목 접미사로 간주되어
   39에 포함되는 fallback. 로컬 XLSX fixture로 재현하여 메인에
   initial-rest `[-‐‑‒–—−.]` 차단과 near-miss fixture를 권고했다.
   메인이 이 최소 차단과 fixture를 반영했다. 리뷰어가 수정 diff와 parser/import
   테스트 통과를 재확인했으며, 정상 `31차8월`/`5차ㅇㅋ`와 실제 `39차-2`는 보존한다.

추가 테스트 권고(현재 코드 결함으로 단정하지 않음): 신규 scope test는 bulk
member snapshot과 단건 product-match를 실행하지만 기존 full same-hotel/bulk mutation
fixture는 숫자 35/30 위주다. 혼합 39+39-2 그룹의 `applySameHotel=true` 및
`saveShillaBulkMatch` 실행형 fixture로 각 부모 감사 SQL의 전체 period와 rollback을
확인하면 하위 기간의 연쇄 저장 경로도 직접 보장할 수 있다.
메인이 두 mixed-group 경로의 테스트 보강을 별도 담당에 배정했다. 메인 전달 상태는
전체 `test:erp-contract` exit 0이며, 리뷰어의 독립 검증 범위와 구별한다.

이 read-only 검토 시점의 blocking code finding은 두 parser 경계 수정으로 해소되었다.
배포 승인은 메인의 나머지 gate와 실제 브라우저 smoke 결과를 포함해 판단한다.
