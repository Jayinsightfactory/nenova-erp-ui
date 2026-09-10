# 불변 기준 엑셀 ↔ ERP 현재값 union grid

Status: 구현 계약 확정, 아직 미구현. 정식 manifest는
`docs/contracts/distribution-baseline-reconciliation.json`이다.

이 기능은 읽기 전용 참고 화면이다. 결과·오류·미확인 상태는 기존
parse/register/distribute/fix 흐름을 막거나 ERP 저장 조건으로 사용하지 않는다.

## 1. 구현 범위

- API: `POST /api/orders/distribution-baseline-reconciliation`
- 순수 projector: `lib/distributionBaselineReconcile.js`
- 신규 UI: `components/orders/DistributionBaselineReconciliation.js`
- 기존 패널 연결: `components/orders/DistributionBaselinePanel.js`
- 테스트:
  - `__tests__/distributionBaselineReconciliation.test.js`
  - `__tests__/distributionBaselineReconciliationApi.test.js`
  - `__tests__/distributionBaselineReconciliationUi.test.js`

서버 동작은 불변 baseline 파일 읽기와 parameterized ERP SELECT뿐이다. baseline·review
저장, LLM, lease, ERP SP/쓰기, 자동 등록은 추가하지 않는다.

## 2. 권위 입력과 확인된 근거

- baseline은 `distributionBaselineStore`의 public object를 그대로 사용한다.
  `{id,year,week,coverage,parsed:{sheets:[{id,clients,rows}]}}`를 포함한다.
- `id`는 저장소가 반환한 소문자 SHA-256이며 정확히 `/^[0-9a-f]{64}$/`여야 한다.
  대문자·임의 ID·브라우저가 보낸 parsed cells는 거부한다.
- parser row는 `{id,label,key,values,remaining}`, client는
  `{id,col,label,day,key}`이다. `row.key/client.key`는 후보이지 확인값이 아니다.
- ERP current projection은 `lib/distributionChangeFacts.js`와 같은 읽기 전용 shape를 쓴다:
  `{year,week,custKey,prodKey,SdetailKey,SdateKey,shipmentDate,qty,unit}`.
- Product catalog는 DB의 `ProdKey, ProdName, DisplayName, CounName, FlowerName, OutUnit,
  BunchOf1Box, SteamOf1Box`를 직접 읽는다. `lib/pivotStats.js`의 Product 직접 컬럼 조회가
  근거이며 label로 국가·화훼를 추론하지 않는다.
- 실제 preflight 근거:
  - 수국: 23개 row key 모두 활성 Product, 고객 55열 중 48 key,
    `(콜롬비아,수국)`과 `(콜롬비아,루스커스)`의 정상 혼합.
  - 장미: 55개 row key 모두 활성 Product, 고객 39열 중 29 key,
    `(콜롬비아,장미)`.
  - 카네이션: 85개 row key 모두 활성 Product, 고객 55열 중 48 key,
    `(콜롬비아,카네이션)`.
- 샘플은 명시 단위 셀이 없고 `client.day`는 목/일/화/미정 또는 14/17 같은 힌트다.
  완전한 출고일이나 단위 확인값으로 간주하지 않는다.

## 3. POST 계약

모든 사용자 선택값은 `bindings` 아래에 둔다. 생략 또는 `{}`는 유효한 discovery 요청이다.

```json
{
  "year": "2026",
  "week": "37-02",
  "baselineId": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "bindings": {
    "sheetScopes": {
      "수국": {
        "confirmed": true,
        "groups": [
          {"country": "콜롬비아", "flower": "수국"},
          {"country": "콜롬비아", "flower": "루스커스"}
        ]
      }
    },
    "keymapBatch": {
      "수국": {"confirmRows": true, "confirmClients": true}
    },
    "rowOverrides": {},
    "columnOverrides": {
      "수국!B3": {"custKey": 456, "confirmed": true}
    },
    "dateGroups": [
      {
        "columnIds": ["수국!B3", "수국!C3"],
        "shipmentDate": "2026-09-10",
        "confirmed": true
      }
    ],
    "columnDateOverrides": {},
    "unitAttestation": {"originalExportUnitsPreserved": true},
    "rowUnitOverrides": {}
  }
}
```

Binding shape:

- `sheetScopes[sheetId]`: `{confirmed,groups:[{country,flower}]}`. 그룹은 1~10개다.
- `keymapBatch[sheetId]`: `{confirmRows,confirmClients}`.
- `rowOverrides[rowId]`: `{prodKey,confirmed}`.
- `columnOverrides[columnId]`: `{custKey,confirmed}`.
- `dateGroups[]`: `{columnIds,shipmentDate,confirmed}`. 한 column은 한 그룹에만 속한다.
- `columnDateOverrides[columnId]`: `{shipmentDate,confirmed}`. 그룹 날짜보다 우선한다.
- `unitAttestation`: `{originalExportUnitsPreserved:true}`이며 기본값은 false다.
- `rowUnitOverrides[rowId]`: `{unit,confirmed}`, unit은 `박스|단|송이`다.

모든 map은 own property만 읽는다. `__proto__`, `prototype`, `constructor`, 알려지지 않은
sheet/row/client ID, 중복 date-group column, 잘못된 value shape를 거부한다. 검증된 값만
`Map` 또는 null-prototype 객체로 옮기며 caller key를 일반 객체에 spread/assign하지 않는다.

## 4. Scope와 key 확인

1. 서버는 sheet의 모든 `row.key`가 각각 하나의 활성 Product로 해석되는지 확인한다.
2. 모두 유효할 때 해당 Product들의 정확한 `CounName + FlowerName` unique set을
   `candidateGroups`로 만든다. 한 sheet에 1~10개 그룹을 허용한다.
3. 빈 bindings 응답은 이 집합과 ERP candidate를 보여주지만 전부 미확인이다.
4. `sheetScopes[sheetId].confirmed=true`는 다음을 모두 만족할 때만 유효하다.
   - `keymapBatch[sheetId].confirmRows=true`
   - 보낸 groups의 순서 무관 unique set이 서버 candidate set과 정확히 동일
   - group 수가 1~10
5. 확인된 `CounName + FlowerName` 집합만 그 sheet의 ERP-only append 범위가 된다.
   `OutUnit`은 별도 단위 확인값이며 scope를 넓히거나 줄이지 않는다.
6. row override는 해당 row 비교에는 사용할 수 있지만 ERP-only category scope를 조용히
   확장하지 않는다.
7. `confirmClients=true`는 표시된 non-null 활성 `client.key`만 일괄 확인한다. key가 없는
   고객열은 정확한 Customer 선택과 `columnOverrides`가 필요하며 fuzzy match는 금지한다.

확인 전 행은 `ERP_CANDIDATE`로만 표시한다. 확인된 scope 밖이거나 어느 sheet에도 안전하게
배정할 수 없는 current 행은 모든 sheet에 복제하지 않고 최상위 `unclassifiedCurrent`에
한 번만 둔다. `ERP_ONLY`도 “기준 누락”이나 “처리 필요” 판정이 아니다.

## 5. 차수·출고일·단위

- `coverage=single`은 저장된 `week`만 조회한다.
- `coverage=combined`는 `WW-02` baseline에만 허용하며 `WW-01`과 `WW-02`를 정확히 한 번씩
  조회한다. 이미 합산된 baseline에 01을 다시 더하지 않는다.
- 모든 SQL은 명시적 `OrderYear`와 정확한 `OrderWeek`를 사용한다. 전년도 같은 차수는 제외한다.
- invoice year/week는 ERP 행 범위이고 `shipmentDate`는 grid 열 identity다. 둘은 서로
  대체하지 않으며 출고일을 invoice week에서 계산하지 않는다.
- UI는 동일한 raw `client.day`별로 열을 묶어 사용자가 ISO 날짜를 한 번에 지정하게 한다.
  14/17·요일·미정은 계속 표시하되 날짜를 자동 생성하지 않는다. column override를 허용한다.
- `shipmentDate`는 실제 calendar `YYYY-MM-DD`여야 한다. 사용자가 선택한 ISO가 raw hint와
  달라도 raw를 보존하고 명시적 override로 취급한다.
- 체크되지 않은 **원본 내보내기 단위 유지 확인**은 비교 단위를 확정하지 않는다.
- 체크하면 일반 행은 Product `OutUnit`, exporter의 알스트로 규칙 행은 `raw*16`을 OutUnit으로
  환산한다. 알스트로 판정은 서버 Product `FlowerName + ProdName`의 기존 exporter 규칙을 쓴다.
- row unit override는 양수로 검증된 `BunchOf1Box/SteamOf1Box` 비율만 사용할 수 있다.
  비율·OutUnit이 불명확하면 delta는 null이다.

## 6. Current 조회와 순수 projector

API는 current를 `TOP 10001`로 조회한다. 10,001번째 행이 있으면 HTTP 422
`CURRENT_RESULT_LIMIT_EXCEEDED`, `currentComplete=false`로 전체 대조를 중단한다. 일부를
잘라 합산하거나 없는 값을 0으로 추정하지 않는다.

순수 함수 signature는 다음으로 고정한다.

```js
reconcileDistributionBaseline({
  baseline,
  bindings = {},
  products,
  customers,
  currentRows,
  currentComplete = true,
}) // => { sheetCandidates, sheets, unclassifiedCurrent, issues }
```

API는 projector 결과에 다음 envelope만 추가한다.

```json
{
  "success": true,
  "advisoryOnly": true,
  "baseline": {"id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "year": "2026", "week": "37-02", "coverage": "combined"},
  "scope": {"year": "2026", "weeks": ["37-01", "37-02"], "coverage": "combined", "currentComplete": true},
  "catalog": {"products": [], "customers": []},
  "observedAt": "server ISO-8601 UTC",
  "sheetCandidates": [],
  "sheets": [],
  "unclassifiedCurrent": [],
  "issues": []
}
```

Projection rules:

- baseline sheet/row/column 순서를 보존한다.
- 확인된 scope 안의 ERP-only ProdKey를 이름+key 순으로 행 뒤에 추가한다.
- 확인된 scope 안의 ERP-only `CustKey + shipmentDate`를 날짜+고객명+key 순으로 열 뒤에 추가한다.
- contribution identity는
  `year|week|custKey|prodKey|SdetailKey|SdateKey`이며 원본 week와 keys를 보존한다.
- 동일 identity 중복은 `DUPLICATE_CURRENT_IDENTITY`; 두 번 합산하지 않고 관련 delta를 null로 둔다.
- `LEFT JOIN` 결과의 null `ShipmentDtm`, `SdateKey`, `qty`는 0이 아니라 unknown이다.
  같은 확인된 `ProdKey + CustKey`에 이런 행이 하나라도 있으면 그 pair의 모든 날짜 cell delta를
  null로 두고 unresolved contribution을 표시한다.
- 정확한 current 행이 없을 때 0을 쓸 수 있는 조건은 current 전체 조회 완료, scope/product/
  customer/date/unit 확인 완료, 관련 unknown 없음이다. 하나라도 빠지면 null이다.
- baseline은 finite number만 수량이다. 숫자 0은 유효하지만 null, 빈칸, text, NaN, infinity,
  formula cache 누락은 0이 아닌 unknown이다.
- `delta = erpCurrentQuantity - baselineQuantity`는 모든 확인 조건과 complete current가 만족될
  때만 계산한다. 같은 총량만으로 처리완료를 판정하지 않는다.
- 전체 sheet의 `projectedRows * projectedColumns` 합이 100,000을 넘으면 HTTP 422
  `UNION_CELL_LIMIT_EXCEEDED`로 부분 cells 없이 중단한다.
- top-level `complete`, `matchedAll`, `canSave`, `blocker`, `erpWriteAllowed`는 반환하지 않는다.

## 7. UI 계약

- `DistributionBaselinePanel`은 save와 restore 성공 시 `result.baseline.id`를 별도 상태로
  보존한다. 기존 confirmed timestamp를 baseline identity로 사용하지 않는다.
- `DistributionBaselineReconciliation`은 저장된 baseline ID가 있을 때만 렌더링하며 첫 POST는
  빈 bindings로 catalog, keymap 후보, candidate groups, current 후보를 읽는다.
- Product/Customer 후보 전체를 먼저 표시하고 시트별 **원본 keymap 일괄 확인** checkbox를
  기본 unchecked로 제공한다. 수국+루스커스 같은 다중 그룹을 한 집합으로 보여준다.
- key가 없는 고객열은 직접 선택한다. raw day별 ISO 날짜 일괄 입력과 개별 override를 제공한다.
- **원본 내보내기 단위 유지 확인**은 별도 unchecked control이며 key/date 확인과 독립이다.
- 미확인 값과 `unclassifiedCurrent`는 중립 색상·`delta —`로 표시한다. ERP-only에는
  “전산에만 있음 · 기준 누락 판정 아님”을 표시한다.
- API 오류와 incomplete 상태는 이 panel 안에서만 알리고 기존 parse/register/distribute/fix
  버튼의 disabled/validation 조건을 변경하지 않는다.
- UI 테스트 기준은 1920×1080 CSS px, zoom 100%이며 표 scroll, sticky 가림, 오류 표시와 기존
  workflow 버튼 보존을 확인한다.

## 8. 수용 테스트

1. 소문자 64 hex baseline ID만 허용하고 uppercase·scope 불일치·unknown ID를 거부한다.
2. 빈 bindings가 discovery 응답을 만들며 모든 미확인 delta는 null이다.
3. 수국 sheet의 수국+루스커스 두 그룹 집합이 candidate와 confirmed scope로 유지된다.
4. candidate와 다른 group, 0개, 11개, label 추론 group은 확인되지 않는다.
5. row/client key 일괄 확인은 활성 non-null key만 포함하며 keyless 고객은 override 전 미확인이다.
6. single은 한 차수, combined 02는 01+02를 한 번씩만 읽고 전년도 같은 차수는 제외한다.
7. 10,001 current rows는 전체 422이며 부분 union·0 추정이 없다.
8. null date/SdateKey/qty는 unknown이고 같은 ProdKey+CustKey의 모든 관련 delta를 막는다.
9. 완전 조회+모든 binding 확인+unknown 없음일 때만 정확히 없는 current를 0으로 표시한다.
10. baseline 숫자 0은 유효하고 blank/text/formula-cache-missing은 unknown이다.
11. Product/Customer/date/unit/scope 확인 전 delta는 null이다.
12. 확인된 OutUnit에서만 delta를 계산하고 알스트로 및 명시 unit conversion을 검증한다.
13. 중복 current identity를 한 번만 보이고 합산하지 않는다.
14. baseline 순서를 보존하고 confirmed scope의 ERP-only 행/열만 결정적으로 append한다.
15. scope 밖 current는 sheet마다 복제되지 않고 `unclassifiedCurrent`에 한 번만 나타난다.
16. projected cells 100,001개는 전체 422이며 baseline/current 원본은 변경되지 않는다.
17. prototype key, unknown ID, 중복 date-group column과 잘못된 binding shape를 거부한다.
18. panel은 save/restore 후 lowercase baseline ID를 유지하고 신규 UI에 전달한다.
19. API/UI 실패·미확인은 기존 workflow 버튼을 비활성화하거나 ERP guard로 사용하지 않는다.
20. API 경로에 ERP INSERT/UPDATE/DELETE/MERGE/DDL/SP, baseline write, LLM, lease 호출이 없다.

## 9. Side-effect matrix

| Action | Baseline files | ERP Order/Shipment/Date/Farm/Stock/Estimate | Kakao/source | Existing workflow |
|---|---|---|---|---|
| 빈 bindings discovery | read only | SELECT only | preserve | preserve |
| binding 입력·일괄 확인 | preserve | preserve | preserve | preserve |
| reconciliation POST | read only | SELECT only | preserve | preserve |
| union grid 렌더링 | preserve | preserve | preserve | preserve |
