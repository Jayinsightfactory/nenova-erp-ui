# 국가별 발주서 전산 자동조회 설계 — 2026-10-15

## 1. 목적과 범위

수입부 `/import/tools`의 **국가별 발주서**에서 Excel 업로드만 가능하던 흐름에
읽기 전용 전산 주문 조회를 추가한다.

- Asia/Seoul의 오늘이 속한 실제 ERP 대차수와 그 뒤 5개 대차수를 버튼으로 표시한다.
- 선택 대차수에 실제 존재하는 세부차수를 선택한다. `01`/`02`를 만들어 내지 않는다.
- 선택 국가·연도·세부차수의 원주문을 업로드 Excel과 같은 품목×업체 숫자 행렬로
  미리 본 뒤 기존 국가별 양식을 생성한다.
- 기존 파일 업로드 방식도 유지한다.
- 이 기능은 `PeriodDay`, `ViewOrder`, `Product`, `Customer`를 SELECT하고 브라우저에서
  파일만 만든다. 주문·출고·입고·재고·견적·매출 원장에는 쓰지 않는다.

이번 설계는 구현 전 계약이다. 운영 DB 쓰기, DDL, 기존 주문 보정, Product/Customer 수정,
배포는 범위 밖이다.

## 2. 확인 근거와 확정 결정

### 2.1 전산과 DB 근거

- 메인 작업의 설치 EXE dnSpy CLI 확인: `FormOrderView.GetData`는 `ViewOrder`에서
  `BoxQuantity`, `BunchQuantity`, `SteamQuantity`를 읽는다.
- `ViewOrder`는 활성 `OrderMaster`/`OrderDetail`과 활성 `Customer`/`Product`,
  `Country`, `UserInfo`를 INNER JOIN한다. 전산에 실제 보이는 주문 범위를 그대로 읽는다.
- 업체 발주 코드는 `ViewOrder.OrderCode`가 아니라 현재 활성 `Customer.OrderCode`다.
- 업무 식별자는 `OrderYear + OrderWeek + CustKey + ProdKey`다. 대차수 번호만으로
  다른 연도를 조회하거나 합치지 않는다.
- 메인 작업의 2026-10-15 읽기 전용 probe:
  - `PeriodDay.WeekDay=5`: 2026/42의 시작일은 2026-10-15이고 2026/47은 2026-11-19다.
  - 네덜란드 2026/42-01은 17행, 저장 `SteamQuantity` 합계 1,665다.
  - 전년도 2025/42-01은 119행, 저장 `SteamQuantity` 합계 18,352로 별도 범위다.
  - 표본 ProdKey 1983은 `OutUnit=단`, `OutQuantity=20`, `BunchQuantity=20`,
    `SteamQuantity=200`, `SteamOf1Bunch=10`이다. 자동조회 결과는 200송이다.
  - 표본 ProdKey 675는 `OutUnit=송이`, `OutQuantity=150`, `BunchQuantity=15`,
    `SteamQuantity=150`이다. 자동조회 결과는 150송이다.
  - 표본 ProdKey 2990은 `BunchQuantity=120`, `SteamQuantity=0`, 환산계수도 0이다.
    이 행은 0으로 숨기거나 추정하지 않고 `STEM_QUANTITY_UNAVAILABLE` 차단 경고로 남긴다.

### 2.2 첨부 Excel 근거와 사용자 확정

- 첨부 `발주 목록_2026-10-14.xlsx`는 1개 시트, 66행×24열이며 품목은 C열,
  업체 헤더는 6행이다.
- 확인된 헤더에는 `BCL16`, `CL21`, `CL23`, `CL4`, `CL83`, `CLE`, `CLR`,
  `KCL03`, `KCL52`, `MCL73`, `YCL06`, `YCL10`, `YCL2`, `YCL22`, `YCLS`가 있다.
- 사용자가 이 첨부의 네덜란드 수량은 **이미 모두 스팀(송이)** 이라고 확정했다.
  따라서 업로드 숫자는 그대로 송이로 사용하고 추가 환산하지 않는다.
- 기존 `parseCL`의 품명 기반 `tulip×10`, `hyacinth×5`, `skimmia×3`,
  `eucalyptus×3`은 근거 없는 중복 환산이므로 제거한다. 유사한 이름 기반 배수를
  다시 도입하지 않는다.
- 기존 파서는 `CL`로 시작하는 헤더만 찾아 `KCL`/`HCL`/`MCL` 등을 놓치고,
  첨부에서 품목 열을 C가 아닌 다른 열로 추측할 수 있다. 새 어댑터는 헤더와 실제
  숫자 영역을 함께 검증하고, 모호하면 조용히 다른 열을 고르지 않는다.

## 3. UX

### 3.1 진입과 조회

기존 국가·연도·차수·파일 입력을 다음 두 원천 탭으로 나눈다.

1. `전산에서 자동 불러오기`(기본)
2. `Excel 원본 업로드`

자동조회 탭의 순서는 다음과 같다.

1. 국가를 선택한다.
2. 서버가 반환한 `오늘 대차수 + 다음 5개` 버튼 중 하나를 선택한다.
3. 그 범위에 실제 주문이 있는 세부차수 목록에서 하나를 선택한다.
4. 품목×업체 원수량 행렬과 경고를 확인한다.
5. 차단 경고가 없을 때만 `미리보기 생성`을 누른다.
6. 기존 국가별 결과 카드와 Excel 다운로드를 사용한다.

대차수 버튼은 `2026 42차 · 10/15–10/21`처럼 연도와 날짜를 함께 표시한다.
연도 경계를 넘는 여섯 버튼도 같은 순서로 표시한다. 세부차수는 숫자 부분 뒤 정확한
suffix 코드포인트 순으로 정렬한다. 실제 주문이 없으면 `주문 없음`을 표시하고
가짜 `42-01`을 만들지 않는다.

### 3.2 행렬 표시

- 행 identity: `ProdKey + 출력단위`(국가 어댑터가 카테고리를 나누면 category 포함)
- 열 identity: `CustKey`
- 셀: 선택한 정확한 `OrderYear + full OrderWeek + CustKey + ProdKey`의 수량
- 같은 `Customer.OrderCode`를 여러 CustKey가 쓰면 각각
  `CL21 [CustKey:123]`, `CL21 [CustKey:456]`로 분리한다.
- 코드가 없으면 행을 버리지 않고 `코드미등록 [CustKey:123]`으로 표시한다.
- 같은 `ProdName`을 여러 ProdKey가 쓰면 각각 `품명 [ProdKey:123]`으로 분리한다.
- 원문 코드와 품명은 결과 모델에 그대로 남기고, 안전한 표시 접미사는 UI/Excel
  열 충돌을 막는 경우에만 붙인다.

1920×1080, 100%에서 국가/대차수/세부차수/생성 버튼과 경고가 첫 화면 또는 명확한
페이지 스크롤 안에 있어야 한다. 행렬만 가로 스크롤을 허용하며 헤더와 품목 열은 sticky다.
Tab/Shift+Tab, Enter/Space로 모든 선택과 생성이 가능하고, focus 표시를 유지한다.

### 3.3 비동기 상태

- 국가 또는 대차수 변경 시 기존 `AbortController`를 즉시 취소한다.
- 요청마다 증가하는 `requestGeneration`과 서버 `scopeKey`를 함께 검사한다.
- 늦게 도착한 이전 응답, 취소 응답, 현재 scope와 다른 응답은 state에 반영하지 않는다.
- 국가/대차수/세부차수/원천 탭/파일 중 하나라도 바뀌면 기존 생성 결과와 다운로드
  성공 문구를 즉시 무효화한다.
- loading/실패/부분 응답 동안 다운로드 버튼을 만들지 않는다.

## 4. API와 조회 계약

### 4.1 endpoint

`GET /api/import/tools/country-orders`

- query 없음: 달력만 반환한다.
- `country`만 있음: 오늘 대차수를 기본 범위로 조회한다.
- `country + year + majorWeek`: 반환된 여섯 대차수 안의 명시 범위를 조회한다.
- `year`와 `majorWeek` 중 하나만 있거나 허용 국가가 아니거나 여섯 대차수 밖이면 400이다.
- 인증이 필요하고 `Cache-Control: private, no-store`다.
- GET 외 메서드는 405다.

허용 country id와 DB의 정확한 `CounName` 매핑은 서버 상수 하나에서만 관리한다.

| country id | DB `CounName` |
|---|---|
| Colombia | 콜롬비아 |
| Netherlands | 네덜란드 |
| Ecuador | 에콰도르 |
| Australia | 호주 |
| Thailand | 태국 |
| China | 중국 |
| Vietnam | 베트남 |

국가명은 fuzzy/부분 일치하지 않는다.

### 4.2 실제 ERP 달력

서버가 Asia/Seoul 날짜 `@today`를 만든다. 다음 기준으로 현재 대차수를 찾는다.

```sql
WeekDay = 5
AND CONVERT(date, @today) BETWEEN CONVERT(date, BaseYmd)
                              AND DATEADD(day, 6, CONVERT(date, BaseYmd))
```

그 행부터 `BaseYmd` 오름차순의 6행을 사용한다. `OrderYearWeek`은 정확히 `YYYYWW`,
날짜와 키는 중복되지 않고 인접 시작일은 7일 차여야 한다. 여섯 행을 얻지 못하거나
현재 행이 없으면 ISO week나 시스템 연도로 대체하지 않고 409로 달력 오류를 표시한다.

### 4.3 주문 SQL 범위

선택 범위는 반드시 두 조건을 함께 사용한다.

```sql
v.OrderYear = @orderYear
AND v.OrderWeek LIKE @majorWeek + N'-%'
```

그리고 다음을 만족한다.

- `ViewOrder v`의 전산 노출 주문만 읽는다.
- `Product p`는 `ProdKey`로, 활성 `Customer c`는 `CustKey`로 연결한다.
- `v.CounName = @counName`과 `p.CounName = @counName`을 모두 확인한다.
- 업체 코드는 `c.OrderCode AS CustOrderCode`를 읽는다.
- `OrderYear`, full `OrderWeek`, `CustKey`, `ProdKey`로 묶어 각 수량 필드를 각각 SUM한다.
- `OutQuantity + BoxQuantity + BunchQuantity + SteamQuantity`를 합쳐 새 수량을 만들지 않는다.
- 원천 행 수와 숨김 주문 count 진단을 별도로 반환하되 숨김 주문을 0 주문으로 가장하지 않는다.

응답 행의 최소 필드는 다음과 같다.

```text
OrderYear, OrderWeek, CustKey, CustName, CustOrderCode,
ProdKey, ProdName, FlowerName, CounName, OutUnit,
OutQuantity, BoxQuantity, BunchQuantity, SteamQuantity, SourceRowCount
```

모든 숫자는 finite인지 서버와 모델에서 검사한다. 세부차수는 응답 주문의 정확한 full
`OrderWeek`로 만들고, 선택 후 다시 `OrderYear + OrderWeek`로 필터한다.

### 4.4 응답 envelope

```json
{
  "success": true,
  "readOnly": true,
  "todayKst": "2026-10-15",
  "currentCycleKey": "2026/42",
  "cycles": [
    {"key":"2026/42","year":2026,"majorWeek":"42","startDate":"2026-10-15","endDate":"2026-10-21","offset":0}
  ],
  "scope": {"country":"Netherlands","counName":"네덜란드","year":2026,"majorWeek":"42","scopeKey":"Netherlands/2026/42"},
  "subweeks": [{"key":"2026/42-01","orderWeek":"42-01"}],
  "rows": [],
  "warnings": [],
  "queriedAt": "ISO-8601"
}
```

달력 전용 응답은 `scope`, `subweeks`, `rows`가 null/빈 배열이다. UI는 응답의
`scopeKey`가 현재 요청과 정확히 같을 때만 행을 채택한다.

## 5. ERP 자동조회 모델과 국가 어댑터

### 5.1 모델 경계

기존 파일 변환의 국가별 파서와 workbook 생성 흐름은 회귀 범위가 크므로 그대로 둔다.
새 matrix 모델은 **ERP 자동조회 응답에만** 추가한다.

```text
Excel workbook ── existing generatePedidos(workbook, ...)  (기존 흐름 유지)

ERP API rows ── buildCountryOrderMatrix ── generatePedidosFromMatrix
```

`CountryOrderMatrix`는 다음 정확한 JS object shape를 사용한다.

```js
{
  source: 'erp',
  scope: { country: 'Netherlands', year: 2026, orderWeek: '42-01' },
  customers: [
    { key: '533', code: 'YCL2', name: '주광농원', label: 'YCL2' }
  ],
  rows: [
    {
      key: '1983|stems',
      prodKey: 1983,
      name: 'Tulip Example',
      flower: '튤립',
      unit: 'stems',
      quantities: { '533': 200 },
      total: 200
    }
  ],
  warnings: [],
  blockers: []
}
```

- `source`는 이번 진입점에서 `'erp'`다.
- `scope.country/year/orderWeek`는 선택한 정확한 국가·연도·full 세부차수다.
- `customers[].key`는 문자열 CustKey이고 `label`은 중복/누락 코드에 필요한 안전한 표시값이다.
- `rows[].key`는 충돌 없는 `ProdKey + unit` 기반 key다. `prodKey`는 양의 정수다.
- `unit`은 반드시 `stems`, `bunches`, `boxes` 중 하나다.
- `quantities`의 key는 `customers[].key`와 정확히 일치하며 값과 `total`은 finite number다.
- Colombia는 `flower`에 기존 정확한 category를 보존하고 `unit`에 원 주문 단위의
  `stems/bunches/boxes` 정규값을 명시한다. category별 기존 출력 규칙과 단위가 맞지 않으면 차단한다.
- warnings는 비차단, blockers는 다운로드 차단 문자열이다.

기존 `generatePedidos(workbook, ...)`는 wrapper로 재작성하지 않는다. 수정은 네덜란드
업로드의 prefixed CL 인식, `Total` 우선 규칙 보존, 품명 배수 제거, 중복 품명 합산/경고에
한정한다. 새 `generatePedidosFromMatrix(matrix, ...)`는 ERP matrix만 받아 기존 국가별
workbook builder를 재사용한다. 기존 중국 구조화 업로드 schema와 다른 국가 업로드 파서는 유지한다.

### 5.2 국가별 수량 권위

| 국가 | 자동조회 수량 | 업로드 수량 | 출력 |
|---|---|---|---|
| Netherlands | 저장 `SteamQuantity`만 | 첨부 숫자를 이미 스팀으로 보고 그대로 사용 | Holex/EZ, `stems` |
| China | `OutQuantity` + 정확한 `OutUnit` | 기존 구조화 numeric 원본 | Melody, 단위별 기존 형식 |
| Colombia | `OutQuantity`; 기존 category 규칙에 필요한 단위가 아니면 차단 | 기존 category numeric 원본 | Rosas/Clavel/Alstromeria/Ruscus/Hortensias |
| Australia | 저장 `BunchQuantity`; 0인데 양수 주문이면 차단 | 기존 numeric 원본 | 기존 Australia |
| Thailand | 저장 `BunchQuantity`; 0인데 양수 주문이면 차단 | 기존 numeric 원본 | 기존 Thailand bunches |
| Ecuador | 저장 `SteamQuantity`; 0인데 양수 주문이면 차단 | 기존 numeric 원본 | 기존 Ecuador stems |
| Vietnam | 저장 `SteamQuantity`; 0인데 양수 주문이면 차단 | 기존 numeric 원본 | 기존 Royal_base stems |

네덜란드 고정 규칙:

1. 자동조회는 `OutUnit`이 단/송이/박스 무엇이든 저장 `SteamQuantity`를 사용한다.
2. `OutQuantity`, `BunchQuantity`, `SteamOf1Bunch`, 품명 배수로 다시 계산하지 않는다.
3. 업로드는 사용자가 확정한 대로 숫자를 이미 스팀으로 보고 그대로 쓴다.
4. `tulip`, `hyacinth`, `skimmia`, `eucalyptus` 이름 기반 배수는 제거한다.
5. 자동조회에서 주문이 양수인데 `SteamQuantity<=0`인 행은 행렬에 남기고
   `STEM_QUANTITY_UNAVAILABLE`로 다운로드를 차단한다. 0을 정상 주문 없음으로 숨기지 않는다.

### 5.3 업체 코드 인식

업로드 헤더는 trim/대문자화 후 trailing ` Total`을 분리하고 다음 family를 인식한다.

```regex
^[A-Z]*CL[A-Z0-9_-]*$
```

따라서 `CL21`, `CLE`, `CLR`, `YCLS`, `BCL16`, `KCL03`, `HCL...`, `MCL73`을
모두 업체 코드로 읽는다. 일치하지 않는 non-empty 헤더는 버리지 않고 `UNRECOGNIZED_CUSTOMER_CODE`
경고에 셀 주소와 함께 남긴다. ERP 자동조회는 `Customer.OrderCode`를 원문 그대로 보존하며
정규식 불일치를 이유로 주문을 제외하지 않는다.

ERP 자동조회는 CustKey가 identity이므로 같은 코드의 서로 다른 업체를 절대 합치지 않는다.

업로드는 기존 네덜란드 matrix 의미를 보존한다.

1. `<코드> Total` 열이 있으면 그 코드를 대표하는 값은 Total 열 하나다.
2. 같은 코드의 detail 열이 함께 있어도 Total과 detail을 다시 더하지 않는다.
3. Total 열이 없고 같은 코드의 detail 열이 여러 개면 기존처럼 그 열들을 합산한다.
4. prefix 인식은 이 precedence를 바꾸지 않고 `BCL`/`HCL`/`KCL`/`MCL`/`YCL`에도 확장한다.

### 5.4 품목 열과 중복 품명

- 첨부형 네덜란드 matrix는 헤더 행의 인식 업체 열들과 같은 행 범위를 가진 숫자 셀을 먼저
  찾고, 그 왼쪽의 non-empty text 열 후보를 구한다. 현재 확인 파일에서는 C열이다.
- 한 후보만 구조 검증을 통과해야 한다. 여러 후보이면 `AMBIGUOUS_PRODUCT_COLUMN`으로 차단한다.
- ERP identity는 `ProdKey`다.
- 업로드의 같은 품명 행은 마지막 행으로 overwrite하지 않는다. 기존 업체코드별 수량을
  같은 품명에 합산하고 `DUPLICATE_PRODUCT_NAME` 경고에 실제 행 번호를 남긴다.
- 빈 품명 행, 합계행, 헤더행은 명시 규칙으로 제외하고 숫자 행을 조용히 다른 품명에 붙이지 않는다.

## 6. 오류와 경고

차단 오류 예:

- `ERP_CALENDAR_NOT_FOUND`, `ERP_CALENDAR_GAP`
- `SCOPE_OUTSIDE_SIX_CYCLES`, `INVALID_SUBWEEK`
- `AMBIGUOUS_PRODUCT_COLUMN`, `DUPLICATE_MATRIX_IDENTITY`
- `STEM_QUANTITY_UNAVAILABLE`, `REQUIRED_QUANTITY_UNAVAILABLE`
- 현재 요청과 다른 `scopeKey`

비차단 경고 예:

- `MISSING_CUSTOMER_CODE` — 행과 업체는 보존
- `DUPLICATE_CUSTOMER_CODE` — ERP는 CustKey로 분리; upload는 Total 우선/동일 code detail 합산
- `DUPLICATE_PRODUCT_NAME` — ERP는 ProdKey로 분리; upload는 동일 품명 수량 합산과 행 번호 경고
- `UNRECOGNIZED_CUSTOMER_CODE` — 원문 보존, 사용자 확인
- ViewOrder에서 숨겨진 활성 raw 주문 count — 수량으로 합치지 않음

오류에는 사용자가 고칠 대상(국가/차수/행/셀/품목)을 표시하고 stack/SQL/인증정보는 노출하지 않는다.

## 7. 부작용 표

| 사용자 동작 | PeriodDay/ViewOrder/Product/Customer | OrderMaster/OrderDetail | Shipment* | Warehouse* | ProductStock/StockHistory | Estimate/WebProfitReport | 로컬 파일 |
|---|---|---|---|---|---|---|---|
| 여섯 대차수 조회 | SELECT | 보존 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 국가·대차수 주문 조회 | SELECT | 보존 | 보존 | 보존 | 보존 | 보존 | 없음 |
| 세부차수/행렬 선택 | 응답 메모리만 | 보존 | 보존 | 보존 | 보존 | 보존 | 없음 |
| Excel 업로드 파싱 | 없음 | 보존 | 보존 | 보존 | 보존 | 보존 | 원본 읽기만 |
| 국가 양식 생성/다운로드 | 없음 | 보존 | 보존 | 보존 | 보존 | 보존 | 브라우저 파일 생성 |

`ShipmentDate`, `ShipmentFarm`, `ShipmentDetail.Amount/Vat/isFix`, 견적 가시성,
확정 매출과 재고 계산을 호출하거나 변경하지 않는다. 읽기 전용 기능이므로 downstream
사후 쓰기 검증 대신 SQL 무쓰기 계약과 기존 원장 보존 검사를 적용한다.

## 8. 구현 소유권 분리

### A. API + 공통 모델 담당

소유 파일:

- 새 `pages/api/import/tools/country-orders.js`
- 새 `lib/countryOrderSourceApi.js`
- 새 `lib/countryOrderSource.js`
- 새 `__tests__/countryOrderSourceApi.test.js`
- 새 `__tests__/countryOrderSource.test.js`
- `docs/exe-golden/CountryOrders.md`는 메인 작업이 작성한 근거를 읽고 유지한다.

완료 기준:

- KST 오늘 + 다음 5개 실제 PeriodDay 대차수
- 명시 연도+대차수 SQL scope와 실제 full subweek
- `Customer.OrderCode`, identity 충돌, missing code 보존
- NL `SteamQuantity` 전용과 unavailable blocker
- 전년도 동일 차수 배제 fixture
- 응답 schema와 scopeKey 고정

이 담당은 `PedidosTool.js` UI나 XLSX 스타일/국가별 workbook을 수정하지 않는다.

### B. 변환기 + UI 담당

소유 파일:

- `components/import-tools/PedidosTool.js`
- `lib/importPedidos.js`
- 필요 시 새 `lib/countryOrderPedidosAdapter.js`
- `__tests__/importPedidos.test.js`
- 새 `__tests__/countryOrderPedidosAdapter.test.js`
- 새 `__tests__/pedidosToolCountryOrders.test.js`
- 관련 범위의 `styles/ImportTools.module.css` 또는 현재 scoped style

완료 기준:

- ERP 자동조회만 고정 `CountryOrderMatrix`와 새 `generatePedidosFromMatrix`를 사용
- 기존 `generatePedidos(workbook, ...)`와 타 국가 upload 흐름은 재작성하지 않음
- 첨부 NL 수량 pass-through, 품명 배수 완전 제거
- prefix CL 코드, C열 품목, Total 우선, 동일 code detail 합산, 중복 품명 합산/경고 fixture
- 요청 취소 및 stale 응답 무시
- 국가/대차수/세부차수 변경 시 결과 무효화
- 1920×1080/100%, keyboard, 행렬 가로 스크롤 회귀

이 담당은 API SQL, DB helper, ERP 테이블을 수정하지 않는다. 두 담당은 먼저 이 문서의
response envelope과 위의 정확한 ERP `CountryOrderMatrix` fixture를 공유 인터페이스로 고정한 뒤 병렬 구현한다.

## 9. 필수 fixture와 검증

### 9.1 순수/API fixture

- `todayKst=2026-10-15`: 2026/42~47 여섯 버튼, 시작일 10/15~11/19
- 연말: 2026/52 다음 2027/01… 연도 경계
- 2025/42-01과 2026/42-01 동시 존재 시 2026만 응답
- 실제 `42-01`, `42-03`, suffix subweek 정렬; 가짜 `42-02` 없음
- Customer code `CL21`, `BCL16`, `KCL03`, `HCL07`, `MCL73`, `YCLS`
- 같은 OrderCode의 서로 다른 CustKey, 빈 OrderCode
- 같은 ProdName의 서로 다른 ProdKey
- NL 단 주문 Steam=200 → 200, 송이 주문 Steam=150 → 150
- NL Bunch=120/Steam=0/factor=0 → 행 보존 + 차단
- non-GET 405, invalid scope 400, calendar gap 409, DB failure 500/no partial rows

### 9.2 업로드/변환 fixture

- 첨부와 같은 BCL/KCL/MCL/YCL 열을 모두 찾고 품목 C열을 선택
- NL 총 9,220 원수량이 어떤 품명 배수도 없이 그대로 보존
- tulip/hyacinth/skimmia/eucalyptus 문자열을 바꿔도 수량 불변
- `<코드> Total`과 같은 코드 detail이 함께 있으면 Total만 사용하여 중복 합산하지 않음
- Total이 없는 같은 code detail 열은 기존처럼 합산
- 중복 품명 행은 업체별 수량을 합산하고 행 번호 경고를 남기며 overwrite하지 않음
- missing/unrecognized code 경고에 셀 주소 포함
- 기존 Colombia/China/Ecuador/Australia/Thailand/Vietnam golden layout 유지
- 생성 workbook 재개봉 후 filename/sheet/formula cache/style/freeze 확인

### 9.3 UI와 전체 gate

- 늦은 A 응답이 최신 B scope를 덮지 않음
- abort/실패/조회 중 다운로드 비활성
- 탭/국가/대차수/세부차수 변경 시 이전 결과 제거
- 1920×1080/100%: 가로 잘림, sticky 가림, 버튼 상태, 오류, 표 스크롤
- 작은 화면: 핵심 선택/경고/생성 버튼 조작 가능

```powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from origin/master
npm run guard:erp-writes -- --changed-from origin/master
npm run build
```

구현 후에는 인증 실브라우저에서 1920×1080/100%로 2026/42-01 네덜란드 행렬과
생성 파일을 읽기 전용 smoke한다. 운영 DB에는 쓰지 않는다.

## 10. 기준선 판정

| 기준 | 판정 | 근거 |
|---|---|---|
| 1920×1080/100% | 적용 | 버튼·경고·행렬 기준 viewport |
| 페이지 세로 스크롤 | 적용 | 행렬만 가로 스크롤 예외 |
| 키보드 완료 | 적용 | native button/select/file, focus 회귀 |
| 원본·매칭 수량 나란히 | 적용 | matrix + 원천 수량/단위/경고 |
| ERP 반영 전 확인 | 해당 없음 | ERP 쓰기 없음 |
| 저장 전 재검증/사후 readback | 해당 없음 | 조회·브라우저 파일만 생성 |
| 교차연도 업무키 | 적용 | year+full week+CustKey+ProdKey |
| 원장 downstream | 보존 | API GET/SELECT only 계약 |

## 11. 선행 문서 상태

지정 작업공간에는 `docs/CODEX_SUBTASK_ORCHESTRATION.md`가 없어 읽을 수 없었다.
메인 작업이 제공한 `APPROVAL_FREE_CHILD`/로컬 문서 전용 정책과 루트 `AGENTS.md`,
ERP 가드, dnSpy 근거를 적용했다. 구현 시작 전 메인이 표준 운영 문서가 다른 위치에
있는지 확인하고, 있으면 이 소유권 분리와 충돌 여부를 먼저 대조한다.
