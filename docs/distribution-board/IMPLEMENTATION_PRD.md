# 물량 배분 기준본·카카오 변경 대조 구현 PRD

상태 기준: `IMPLEMENTED_CODE`는 현재 저장소 코드/테스트가 존재함, `RUNTIME_VERIFIED`는 읽기 전용 운영 probe까지 확인함, `PENDING`은 아직 구현 완료로 주장하지 않음.

## 1. 목표와 절대 경계

- 엑셀 기준본, 카카오 변경 요청, ERP 현재값/이력은 모두 **조회·자문용**이다.
- advisory의 오류·누락·부분일치·미확인은 기존 parse/register/distribute/fix를 disable하거나 preflight/save guard로 사용하지 않는다.
- 신규 경로는 ERP INSERT/UPDATE/DELETE/SP와 자동 주문등록·분배·확정·수정을 호출하지 않는다.
- 수동 disposition과 machine finding은 별도 상태다. 총량 또는 이력 한 건만으로 완료를 선언하지 않는다.

## 2. 현재 구현된 기준본 보관

### UI와 parser (`IMPLEMENTED_CODE`)

- `components/orders/DistributionBaselinePanel.js`가 `.xlsx`를 로컬 preview하고 사용자가 명시적으로 서버 보관을 누른다.
- `lib/distributionBaseline.js`가 A1 연도·차수, 3행 업체 header, 주문/입고/잔량 경계, `_keymap`, 원본 셀값을 파싱한다.
- panel은 기준본과 ERP를 합친 union grid가 아니다. 화면 문구대로 ERP snapshot/자동 대조는 아직 연결 전이다.

### API와 영속화 (`IMPLEMENTED_CODE`)

- endpoint: `GET|POST /api/orders/distribution-baselines`, `withAuth`, same-origin, `private, no-store`.
- POST body: `{year, week, requestId, fileName, fileBase64, coverage}`.
- GET list: `?year=YYYY&week=WW-SS` → `{items}`.
- GET one: `?year=YYYY&week=WW-SS&id=<64hex>` → `{baseline}`.
- 기본 위치: `data/distribution-board/baselines/<id>.json`; public 경로 밖이며 baseline/체크리스트가 공유하는 ignored root다.
- ID: `SHA256(year + week + authenticatedUserId + requestId)`. `dbb_` prefix, content-address ID, lineage/latest pointer는 현재 계약에 없다.
- 저장 JSON은 raw workbook `fileBase64`, raw SHA-256, 서버 재파싱 결과, coverage, createdBy/createdAt을 포함한다.
- 같은 ID+같은 payload는 기존 결과, 같은 ID+다른 payload는 409. overwrite/delete API는 없다.
- `.xlsx`, strict base64/ZIP magic, 파일 512KiB, 시트 300행/150열을 검사한다. API JSON body limit은 750KiB다.
- response의 `erpSnapshot=null`, `reconciliationStatus='NOT_CAPTURED'`가 현재 사실이다.

### 현재 coverage (`IMPLEMENTED_CODE`)

| 값 | 의미 | ERP scope로 아직 구현된 의미 |
|---|---|---|
| `single` + `WW-01` | 01 기준본 한 개 | 없음; baseline 보관만 |
| `single` + `WW-02` | 02만 있는 기준본 | 없음; 01 자동 가산 금지 |
| `combined` + `WW-02` | 원본 자체가 이미 01+02 합계 | 없음; 01 기준본을 다시 더하지 않음 |

`SEPARATE_01_02`, `SINGLE_01`, `ALREADY_COMBINED_02` enum과 두 파일 합성 저장은 현재 구현 계약이 아니다.

## 3. 현재 구현된 카카오 자문 흐름

### source/inbox

- source route는 exact `영업방`, configured room ID, `source='nenovakakao'`, dedicated bearer token으로 제한된다.
- source PR 8 merge `7c220fd`, Railway deploy `1ff91ed5` 성공; health 200과 무토큰 feed 401을 확인했다.
- Nenovaweb proxy `pages/api/kakao/sales-feed.js`는 server-only `NENOVA_SALES_READ_TOKEN`과 configured room ID를 사용한다. web 배포/실브라우저 검증은 main 소유다.
- inbox 선택은 paste text 준비만 하며 ERP 동작을 자동 호출하지 않는다.

### 수동 review (`IMPLEMENTED_CODE`)

- endpoint: `GET|POST /api/orders/distribution-checklist`.
- event: `{year, week, sourceIdentity, status, memo, requestId}`; `sourceIdentity`는 기존 inbox stable 문자열이다.
- status: `PENDING|REVIEWED|NOT_NEEDED|LATER`; memo는 JS `string.length <= 1000`.
- actor/time은 server-derived, event는 append-only, GET은 scope별 sourceIdentity 최신 event를 반환한다.
- 저장 위치: `data/distribution-board/baselines/checklist-events`.
- review 상태는 machine finding과 ERP workflow guard가 아니다.

### 자동 변경 증거 대조 (`IMPLEMENTED_CODE`, UI/배포 별도 진행)

- `lib/distributionChangeExtract.js`: 명시 버튼의 LLM 결과를 정규화하고 모든 message를 request 또는 unresolved로 보존한다. source identity/quote를 원문에 대조하며 달력에 없는 날짜를 거부한다.
- `lib/distributionChangeFacts.js`: exact year/week와 최대 7일 범위로 Customer, Product, ShipmentHistory, ViewShipment+ShipmentDate를 SELECT만 한다.
- `lib/distributionChangeCompare.js`: exact key/week/unit/date/time evidence를 순수 비교한다. 같은 sourceIdentity에 여러 request item이 있는 것은 정상이며 duplicate request ID나 같은 event 중복 claim만 ambiguous다.
- subweek는 `01..99`; combined mode는 선택한 `WW-02`에 대해 `WW-01 + WW-02`만 조회한다.
- `ShipmentHistory.BeforeValue/AfterValue`는 확인된 native history에서 OutUnit/date별 evidence다. 다만 `historyComplete=false`는 항상 유지하며 history 부재는 `NEEDS_REVIEW`이지 미처리 증명이 아니다.
- `ShipmentAdjustment`는 input unit이 저장되지 않으므로 자동 수치 비교에 사용하지 않는다. 삭제된 detail의 orphan history도 특정 업체/품목의 누락 증거로 만들지 않는다.
- 2026/37-01+02 읽기 probe: customers 672, products 3,225, joined history 347, current rows 809, unit 미확정 evidence 5. 비밀값/본문은 출력하지 않았다.

## 4. 아직 구현되지 않은 Excel baseline vs ERP current

상태는 `PENDING`이다. 현재 존재하지 않는 항목:

- 저장 baseline ID를 받아 ERP current rows를 조회하는 reconciliation API.
- baseline-only, matched, ERP-only 행/열을 합치는 union projector와 UI.
- workbook 업체 header `day`를 `ShipmentDate.ShipmentDtm` 달력일로 확정하는 binding.
- baseline cell 수량 단위가 `Product.OutUnit`과 동일하다는 검증 근거.
- per-cell `baselineQuantity`, `erpCurrentQuantity`, `delta`와 raw contribution trace.
- 저장된 baseline에 대한 ERP snapshot 고정. 현재 current는 조회 시점 값이어야 하며 baseline JSON은 변경하지 않는다.

따라서 현재 baseline 저장 성공, 카카오 history match, 수동 `REVIEWED` 중 어느 것도 union-grid 완료를 뜻하지 않는다.

## 5. 다음 최소 bounded 구현

ERP 쓰기 없이 다음 두 파일과 테스트로 제한한다.

1. `lib/distributionBaselineReconcile.js`: 저장된 `baseline.parsed`와 raw ERP current rows를 받는 순수 union projector.
2. `pages/api/orders/distribution-baseline-reconciliation.js`: authenticated GET으로 exact `{year,week,id}` baseline을 읽고 `ViewShipment + ShipmentDate + Product`를 parameterized SELECT한 뒤 projector를 호출한다.

응답은 `{baselineId, observedAt, scope, rows, columns, cells, issues}`이며 다음을 강제한다.

- row identity는 positive `ProdKey`; column identity는 positive `CustKey + exact shipmentDate`.
- `OrderYear + OrderWeek + CustKey + ProdKey + SdetailKey + SdateKey` contribution을 보존한다.
- coverage `single`은 저장된 week만 조회한다. `combined`는 `WW-02`일 때만 `WW-01`,`WW-02`를 각 한 번 조회한다.
- baseline 날짜 또는 단위가 미확정이면 current row는 표시하되 numeric delta는 `null`이고 issue를 반환한다.
- baseline 순서를 유지하고 ERP-only row/column을 뒤에 안정 정렬한다.
- API/순수 helper 어디에도 ERP write, baseline overwrite, LLM 호출, workflow blocker가 없다.

## 6. Side-effect matrix

| 동작 | web-owned file | ERP tables/SP | source archive | 기존 workflow |
|---|---|---|---|---|
| baseline POST | immutable JSON create | preserve | preserve | preserve |
| baseline GET/preview | read only | preserve | preserve | preserve |
| checklist POST | append-only event create | preserve | preserve | preserve |
| change analyze/compare | none | SELECT only | preserve | preserve |
| pending baseline reconciliation | baseline read only | SELECT only | preserve | preserve |

## 7. 배포 판정

- source production route/config는 검증됨. Nenovaweb 배포와 authenticated browser smoke는 main이 수행한다.
- baseline 파일이 deploy/restart 뒤 유지되는지는 별도 운영 검증 전까지 `PENDING`이다.
- union grid는 코드/API/UI/fixture가 생기기 전까지 배포 완료 항목으로 보고하지 않는다.
