# Claude 인계서: 영업매출관리/ECOUNT API 연동

작성일: 2026-06-03

## 현재 목표

`nenovaweb`에 추가된 `영업매출관리` 화면을 이어서 구현한다.

최종 흐름은 아래와 같다.

1. 사용자가 연도/차수/기간/지점을 선택한다.
2. `이카운트 API 조회 및 저장`을 누른다.
3. ECOUNT 판매현황 read-only API에서 데이터를 가져온다.
4. 가져온 원본을 네노바웹 비교용 DB 또는 안정적인 저장소에 Batch로 저장한다.
5. 이카운트 거래처명과 네노바 통용 업체명을 매칭한다.
6. 미매칭 업체는 사용자가 검색/선택해서 최초 확정 저장한다.
7. 저장된 매칭은 다음 조회부터 자동 적용한다.
8. `매출비교.xlsx`처럼 업체 전체 목록 기준으로 24/25/26년 차수별 매출을 비교한다.

## 절대 기준

- 이 기능은 엑셀 업로드로 자료를 만드는 기능이 아니다.
- 엑셀 파일은 기존 실무표/컬럼 구조를 확인하기 위한 참고자료다.
- 운영 원본은 ECOUNT API 조회 결과다.
- ECOUNT 원본에 쓰기, 저장, 수정, 삭제, 판매전표 전송을 하면 안 된다.
- 기존 `/api/ecount/sales-push`는 네노바웹 데이터를 ECOUNT로 보내는 push API이므로 이 작업에서 호출하면 안 된다.
- 새 기능은 ECOUNT read-only 조회 결과만 네노바웹에 저장한다.
- 화면 로딩만으로 ECOUNT API를 호출하면 안 된다.
- API 호출은 사용자가 `이카운트 API 조회 및 저장` 또는 `강제 재조회`를 누를 때만 실행한다.
- 같은 연도/차수/기간/지점은 저장된 Batch를 먼저 보여주고, 강제 재조회는 별도 버튼으로 처리한다.

## 운영 배포 상태

최신 운영 커밋:

- `c41c9bb feat: add revenue customer mapping workflow`

운영 확인:

- GitHub Actions `Deploy to Cafe24`: success
- 운영 URL: `https://nenovaweb.com/sales/revenue-management`
- 운영 페이지 응답: 200
- 운영 HTML 확인 문구:
  - `업체명 매칭 설정`
  - `차수별 매출 비교표`
  - `이카운트 API 조회 및 저장`

## 관련 파일

현재 추가/수정된 파일:

- `components/Layout.js`
  - `채권관리` 그룹 안에서 `판매현황` 바로 아래 `영업매출관리` 메뉴 추가.
- `pages/sales/revenue-management.js`
  - 현재 1차 화면.
  - `매출비교.xlsx`처럼 업체 전체 목록 기반 표 표시.
  - 이카운트 원본 거래처명 매칭 상태 패널 표시.
  - 미매칭/후보 업체 선택, 네노바 거래처 검색, 통용명 저장 UI 포함.
  - 현재 `이카운트 API 조회 및 저장` 버튼은 실제 API 연결 전 안내만 표시한다.
- `pages/api/sales/revenue-customer-mappings.js`
  - 영업매출관리용 이카운트 거래처명 매칭 조회/저장 API.
  - `GET`: 저장된 매핑 조회.
  - `POST`: 이카운트 거래처명과 네노바 통용명/거래처 정보 저장.
- `lib/salesRevenueMappings.js`
  - `data/sales-revenue-customer-mappings.json`에 매칭 저장.
  - `normalizeCustomerToken`을 재사용해 업체명 정규화.
- `docs/SALES_REVENUE_MANAGEMENT_PLAN_2026-06-03.md`
  - 영업매출관리 기획 문서.
- `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`
  - ECOUNT 전체 활용/안전 원칙 문서.
- `docs/work_history.md`
  - 지금까지 작업 이력.

## 참고 파일

사용자가 제공한 샘플:

- `C:/Users/USER/Documents/카카오톡 받은 파일/25년 24차_양재동.xlsx`
  - ECOUNT 판매현황 화면에서 조회한 값.
  - 컬럼: `일자-No.`, `거래처명`, `품목명`, `수량`, `단가(vat포함)`, `공급가액`, `부가세`, `합계`, `적요`.
  - 25년 24차 샘플 총합: 59,354,000원.
  - 원본 거래처 23개.
- `C:/Users/USER/Documents/카카오톡 받은 파일/매출비교.xlsx`
  - 기존 수기 매출 비교표.
  - 6월 시트 업체 목록 기준:
    - `미우`, `소재2호`, `그린`, `꽃길`, `알파`, `꽃동산`, `레바논`, `미카엘`, `꿀벌`, `공주`, `성남`, `플로르아름`, `나래꽃`, `경향`, `대한꽃집`, `송우`, `코코도르`, `청지화원`, `존버`, `시흥장미`, `매일`, `남촌`, `신초원`, `선미`, `미소`, `꽃사레`, `유니온`, `아이엠`, `정원꽃`, `청목소재`, `코벤트`, `파란마을`, `타우블`, `스타일`, `녹색`, `자연원예`, `강남`.

## 현재 화면의 임시 샘플 데이터

`pages/sales/revenue-management.js`에는 아직 실제 DB/API가 아니라 아래 샘플이 들어 있다.

- `BASE_CUSTOMERS`: `매출비교.xlsx`의 업체 전체 목록.
- `SAMPLE_2025_BY_WEEK`: `매출비교.xlsx`의 22차/23차 일부 금액.
- `RAW_2025_WEEK_24`: `25년 24차_양재동.xlsx`에서 읽은 24차 ECOUNT 원본 거래처별 금액.
- `BUILT_IN_ALIASES`: 내장 후보 매칭.

다음 구현에서는 이 하드코딩 샘플을 저장된 Batch/API 조회 결과로 대체해야 한다.

## 매칭 기준

현재 저장 구조:

- 저장 파일: `data/sales-revenue-customer-mappings.json`
- 저장 키: 이카운트 거래처명 정규화 값.
- 저장 값:
  - `ecountName`
  - `canonicalName`
  - `custKey`
  - `custName`
  - `custArea`
  - `note`
  - `savedAt`

적용 우선순위:

1. 사용자가 확정 저장한 `sales-revenue-customer-mappings.json`
2. 화면 내장 후보 `BUILT_IN_ALIASES`
3. 원본 이카운트 거래처명 그대로

사용자가 원하는 방식:

- 미매칭 업체는 검색해서 최초 매칭 설정.
- 설정한 매칭은 계속 동일 적용.
- 예: `선미원예(중매1484)`을 `선미`로 저장하면 다음 API 조회부터 자동으로 `선미`에 합산.

## 다음 구현 단계

### 1. ECOUNT 판매현황 read-only API endpoint 확정

해야 할 일:

- `lib/ecount.js`의 `ecountPost(endpoint, data)`를 사용한다.
- 기존 `pages/api/ecount/raw-test.js`는 endpoint 테스트용이지만, 운영에서 무분별하게 쓰지 않는다.
- ECOUNT 판매현황을 가져오는 read-only endpoint를 확인한다.
- `Sale/SaveSale`, `/api/ecount/sales-push`, 구매/회계 push 계열 endpoint는 사용 금지.

검증 기준:

- ECOUNT 홈페이지 판매현황 조회 화면/엑셀 컬럼과 API 응답 컬럼이 일치하는지 확인.
- `거래처명`, `품목명`, `수량`, `단가(vat포함)`, `공급가액`, `부가세`, `합계`, `적요`, 조회기간을 매핑할 수 있어야 한다.

### 2. 저장 구조 생성

우선 테이블 설계:

- `SalesRevenueImportBatch`
  - `BatchKey`
  - `SourceType`: `ecount_api`
  - `SalesYear`
  - `OrderWeek`
  - `Channel`
  - `DateFrom`
  - `DateTo`
  - `FetchedBy`
  - `FetchedDtm`
  - `EcountEndpoint`
  - `EcountRequestHash`
  - `EcountResponseHash`
  - `ApiStatus`
  - `Memo`
- `SalesRevenueRaw`
  - `RawKey`
  - `BatchKey`
  - `EcountDateNo`
  - `EcountCustName`
  - `ProductName`
  - `Quantity`
  - `UnitPriceVatIncluded`
  - `SupplyAmount`
  - `Vat`
  - `TotalAmount`
  - `Remark`
  - `MappedName`
  - `MappingStatus`
- 필요하면 `SalesRevenueSummary`는 View로 시작해도 된다.

주의:

- 기존 주문/출고/재고 테이블을 수정하지 않는다.
- ECOUNT 원본도 수정하지 않는다.
- 저장은 네노바웹 비교용 테이블에만 한다.

### 3. API 추가

예상 API:

- `POST /api/sales/revenue-fetch`
  - 입력: `salesYear`, `orderWeek`, `dateFrom`, `dateTo`, `channel`, `force`
  - 동작:
    1. 기존 Batch 확인.
    2. `force`가 아니면 기존 Batch 반환.
    3. `force`면 ECOUNT read-only API 호출.
    4. 원본 저장.
    5. 매칭 적용.
    6. 요약 반환.
- `GET /api/sales/revenue-summary`
  - 입력: 비교 연도/차수/채널.
  - 저장된 Batch 기준으로 업체별 비교표 반환.
- 기존 `GET/POST /api/sales/revenue-customer-mappings`는 유지.

### 4. 화면 연결

`pages/sales/revenue-management.js`에서:

- `이카운트 API 조회 및 저장` 버튼을 `POST /api/sales/revenue-fetch`에 연결.
- `강제 재조회`는 `force: true`.
- 하드코딩 샘플은 API 결과가 없을 때만 안내/예시로 사용하거나 제거.
- 표는 항상 `BASE_CUSTOMERS` 전체 행을 유지하고, API 저장 데이터가 있는 업체만 금액을 채운다.
- 원본에 있는데 `BASE_CUSTOMERS`에 없는 통용명은 표 아래 추가 행으로 표시한다.
- 미매칭 금액/건수는 KPI에 항상 표시한다.

### 5. 검증

필수 검증:

- `next build` 통과.
- 운영 배포 후:
  - `/api/dev/git-log?type=log` 최신 커밋 확인.
  - `/sales/revenue-management` 200 응답 확인.
  - 화면에 `업체명 매칭 설정`, `차수별 매출 비교표`, `이카운트 API 조회 및 저장` 표시 확인.
- ECOUNT API 조회 기능 연결 후:
  - ECOUNT 원본 총합과 저장 Raw 총합 일치.
  - 공급가액 + 부가세 = 합계 검증.
  - 매칭 후 총합과 원본 총합 차이 0.
  - 미매칭 금액 별도 표시.
  - 저장된 매칭이 다음 조회에서 자동 적용되는지 확인.

## Claude에게 바로 붙여넣을 프롬프트

아래 프롬프트를 Claude에 붙여넣고 시작하면 된다.

```text
nenovaweb 영업매출관리 작업을 이어서 해줘.

먼저 아래 문서를 읽고 기준을 지켜줘:
- docs/CLAUDE_HANDOFF_SALES_REVENUE_MANAGEMENT_2026-06-03.md
- docs/SALES_REVENUE_MANAGEMENT_PLAN_2026-06-03.md
- docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md
- docs/work_history.md 의 2026-06-03 영업매출관리 항목

현재 운영 최신 커밋은 c41c9bb feat: add revenue customer mapping workflow 이고, /sales/revenue-management 화면과 /api/sales/revenue-customer-mappings API는 배포되어 있어.

중요 기준:
- 이 기능은 엑셀 업로드 기반이 아니라 ECOUNT API 판매현황 read-only 조회 기반이다.
- ECOUNT 원본에 쓰기/저장/수정/삭제/push 하면 안 된다.
- /api/ecount/sales-push 또는 Sale/SaveSale 같은 전송 API는 사용하지 마라.
- 조회 결과만 네노바웹 비교용 DB에 Batch/Raw로 저장해라.
- 업체 미매칭은 화면에서 검색 후 최초 저장하면 다음 조회부터 자동 적용되어야 한다.
- 표는 매출비교.xlsx처럼 업체 전체 목록 기준으로 보여야 한다.

다음 작업:
1. ECOUNT 판매현황 read-only API endpoint를 확인한다.
2. SalesRevenueImportBatch, SalesRevenueRaw 저장 구조를 만든다.
3. POST /api/sales/revenue-fetch 를 추가해 연도/차수/기간/지점 기준 ECOUNT API 조회 결과를 저장한다.
4. GET /api/sales/revenue-summary 를 추가하거나 같은 API 응답으로 24/25/26년 업체별 비교표를 반환한다.
5. /sales/revenue-management 화면의 샘플 하드코딩 데이터를 저장된 Batch 데이터로 대체한다.
6. next build, 운영 배포, 운영 URL 응답까지 검증한다.

절대 기존 주문/출고/재고/ECOUNT 원본 데이터를 직접 수정하지 말고, 구현 전 관련 MD와 코드 검색부터 해줘.
```
