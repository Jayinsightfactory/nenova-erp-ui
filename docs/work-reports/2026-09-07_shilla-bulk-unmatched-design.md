# 신라호텔 미매칭 품목 일괄 연결 설계

## 판정

GO. 선택 연도와 `PartnerCode='shilla'` 안에서 기존 `shillaHotelMatchKey`의 정확한 공백 정규화 원본명+단위로만 그룹화한다. 조회·후보 검색은 읽기 전용이며, 사용자가 그룹별 Product를 선택하고 적용 그룹을 체크한 뒤 명시적으로 확인했을 때 단 한 번의 원자적 POST로 빈 `ProdKey`만 채운다.

## 범위와 불변조건

- 대상: 선택 연도의 활성 `WebRaumPnl` 신라 결산에 속한 일반행(`IsCustom=0`) 중 `ProdKey IS NULL`이 하나 이상 있는 그룹.
- identity: `OrderYear + PartnerCode='shilla' + shillaHotelMatchKey(ItemName, Unit)`. 다른 연도·호텔·단위는 후보, snapshot, 충돌 검사, 쓰기에서 모두 제외한다.
- 그룹에는 미연결 행뿐 아니라 같은 identity의 연결된 형제행도 전부 포함한다. 연결된 형제행의 유일한 활성 Product만 suggestion이 될 수 있다.
- POST는 `ProdKey IS NULL`인 선택 그룹 행만 갱신한다. 기존 비NULL `ProdKey`는 같은 값도 다시 쓰지 않고, 다른 값이면 그룹 전체를 충돌 처리한다.
- 행 생성·삭제·연결 해제는 지원하지 않는다. `ItemName`, `Unit`, `Qty`, `SalePrice`, `SaleAmount`, `CostPrice`, 배분율, 날짜와 ERP 주문·출고·재고·견적·수익 원장은 모두 불변이다.
- GET과 `/api/products/search` 후보 검색은 절대 쓰지 않는다. 화면 진입, suggestion 표시, 검색만으로 연결하지 않는다.

## API와 DTO

신규 endpoint는 `pages/api/raum/shilla-bulk-mapping.js` 하나로 두 메서드를 제공한다. 모든 enum/boolean은 문자열·truthy 변환 없이 정확히 검증하고, `partnerCode`, `orderYear`, `action`, `confirmed`를 생략할 수 없게 한다.

### GET `/api/raum/shilla-bulk-mapping?partnerCode=shilla&orderYear=2026`

```json
{
  "success": true,
  "version": "shilla-bulk-unmatched-v1",
  "scope": { "partnerCode": "shilla", "orderYear": "2026" },
  "groups": [
    {
      "groupKey": "opaque-server-key",
      "label": "장미 · 쉬머",
      "unit": "단",
      "majors": [35, 30],
      "memberCount": 2,
      "unmatchedCount": 1,
      "suggestion": {
        "status": "unique",
        "product": {
          "prodKey": 2079,
          "prodName": "Rose Shimmer",
          "displayName": "",
          "flowerName": "장미",
          "counName": "네덜란드",
          "outUnit": "송이"
        }
      },
      "expected": {
        "members": [
          {
            "pnlKey": 101,
            "major": 35,
            "itemKey": 1001,
            "name": "장미 · 쉬머",
            "unit": "단",
            "qty": 16,
            "salePrice": 10800,
            "saleAmount": 172800,
            "prodKey": null,
            "isCustom": false
          },
          {
            "pnlKey": 99,
            "major": 30,
            "itemKey": 901,
            "name": "장미 · 쉬머",
            "unit": "단",
            "qty": 40,
            "salePrice": 10800,
            "saleAmount": 432000,
            "prodKey": 2079,
            "isCustom": false
          }
        ]
      }
    }
  ]
}
```

- `groupKey`는 UI 식별용 opaque 값일 뿐 쓰기 권한이 아니다. 서버는 POST에서 live row로 identity를 다시 계산한다.
- `expected.members`는 연결·미연결 형제행 전체를 `PnlKey, ItemKey` 순으로 정렬한 완전한 동시성 snapshot이다. 기존 단건 snapshot과 같은 원본 필드를 포함하고 독립 매입단가 변경을 막지 않도록 `CostPrice`는 제외한다.
- `majors`는 중복 제거 후 내림차순이다.
- `suggestion.status`:
  - `unique`: 연결 형제행의 서로 다른 양수 ProdKey가 정확히 하나이고 해당 Product가 현재 활성.
  - `none`: 연결 형제행이 없음.
  - `conflict`: ProdKey가 둘 이상이거나 비활성/삭제 Product 참조가 있음. 이 그룹은 bulk 선택을 비활성화하고 기존 단건 화면에서 먼저 해결한다.
- 그룹별 다른 후보는 사용자가 요청할 때 기존 canonical `GET /api/products/search?q=...`를 호출한다. 신규 검색 SQL이나 alias 규칙을 만들지 않는다.

### POST `/api/raum/shilla-bulk-mapping`

```json
{
  "partnerCode": "shilla",
  "orderYear": "2026",
  "action": "MATCH_SELECTED_GROUPS",
  "confirmed": true,
  "groups": [
    {
      "groupKey": "opaque-server-key",
      "prodKey": 2079,
      "expected": { "members": [] }
    }
  ]
}
```

성공 응답:

```json
{
  "success": true,
  "changedGroupCount": 1,
  "changedItemCount": 2,
  "affectedMajors": [30, 35]
}
```

- `confirmed`는 정확히 `true`여야 한다. 빈 그룹 배열, 중복 `groupKey`, 유효하지 않은 양수 `prodKey`, 과도한 그룹 수는 DB 접근 전에 거부한다.
- UI는 먼저 각 그룹의 Product를 고르고, 그다음 실제 적용할 그룹을 체크한다. confirmation에는 선택 그룹 수·미연결 행 수·적용 차수를 보여준다.
- 그룹마다 POST하지 않는다. 선택된 모든 그룹을 한 payload와 한 transaction으로 처리한다.

## 서버 정책과 동시성

순수 grouping·DTO·snapshot 정책은 신규 `lib/shillaPnlBulkMatchState.js`에 두고 `shillaHotelMatchKey`와 기존 source snapshot 필드 규칙을 재사용한다. DB 조회·transaction orchestration은 신규 `lib/shillaPnlBulkMatch.js`에 둔다. 기존 `lib/shillaPnlProductMatch.js`/`lib/raumPnl.js`의 year-lock SQL과 활성 신라 master/item 조회 shape를 공통 server helper로 추출하거나 그대로 export하여 SQL 의미가 갈라지지 않게 한다.

POST 잠금 순서는 반드시 다음과 같다.

1. `shilla-pnl-year:{OrderYear}` transaction-owned exclusive app lock을 획득하고, 누락·비정상·음수 반환값은 409로 fail closed.
2. 선택 연도의 활성 신라 master 전체를 `UPDLOCK, HOLDLOCK`으로 잠금.
3. 해당 master의 item 전체를 `UPDLOCK, HOLDLOCK`으로 잠금.
4. 요청한 Product key를 숫자 오름차순으로 잠그고 모두 `isDeleted=0` 재검증.
5. live 그룹 membership과 모든 source-row snapshot을 요청의 `expected.members`와 완전 일치 비교. 행 추가·삭제·이동, 원본값·ProdKey 변경은 모두 409.
6. 각 그룹의 연결된 형제행에 요청 Product와 다른 비NULL ProdKey가 있으면 409. 어느 그룹 하나라도 실패하면 쓰기 전에 전체 요청을 중단.
7. 검증이 끝난 뒤 대상 `ItemKey`를 고정 순서로 `ProdKey IS NULL` 조건과 함께 UPDATE하고, 실제 변경 부모만 `UpdatedBy/UpdatedAt` 갱신. 영향 행 수 불일치도 rollback.

이 순서는 기존 단건/group 저장과 신라 import save의 공통 year lock보다 먼저 또는 다르게 잠그지 않는다. GET은 일반 SELECT만 사용하고 app lock, `UPDLOCK`, UPDATE를 호출하지 않는다.

## UI PRD

- 신라 P&L 화면에서 선택 연도가 확정된 경우에만 `미매칭 품목 일괄 연결`을 연다.
- 첫 화면은 `품목명 · 단위`, 포함 차수, 미연결/전체 행 수, suggestion 상태를 보여준다. 충돌 그룹은 이유를 표시하고 체크할 수 없다.
- `unique` suggestion은 추천값으로 표시할 수 있으나 저장은 사용자의 그룹 체크와 최종 확인 이후에만 가능하다. `none`은 그룹 안에서 canonical 검색을 열어 사용자가 Product를 선택한다.
- 파트너·연도 변경, 모달 종료, 새 GET 시 이전 응답을 무효화한다. POST 중에는 연도·파트너·선택을 고정하고 중복 제출을 차단한다.
- 성공 후 목록과 열려 있던 상세를 기존 partner/year stale guard로 다시 불러오고 변경 그룹·행·차수를 보고한다. 실패 시 선택을 보존하고 서버 오류를 표시하며 자동 재시도하지 않는다.

## 부작용 표

| 동작 | WebRaumPnlItem | WebRaumPnl | Product 및 ERP 원장 |
|---|---|---|---|
| Bulk GET | 읽기 | 읽기 | 활성 여부 읽기만 |
| 후보 검색 | 없음 | 없음 | canonical Product GET 읽기 |
| Bulk POST | 선택 그룹의 기존 NULL `ProdKey`만 UPDATE | 실제 변경 부모 감사 컬럼만 UPDATE | 완전 보존 |

허용 쓰기는 `WebRaumPnlItem.ProdKey`, `WebRaumPnl.UpdatedBy`, `WebRaumPnl.UpdatedAt`뿐이다. `WebRaumItemMap`, `WebRaumCostPrice`, Product, Order/Shipment/Stock/Estimate/WebProfitReport에는 쓰지 않는다.

## 구현 분담

- Backend/API worker: `lib/shillaPnlBulkMatchState.js`, `lib/shillaPnlBulkMatch.js`, `pages/api/raum/shilla-bulk-mapping.js`, backend executable tests. 기존 단건/group/import 계약은 보존한다.
- UI worker: `components/raum/ShillaBulkMatchModal.js`와 `pages/raum/pnl.js` 진입·새로고침 연결, UI executable tests. 후보 검색은 `/api/products/search`만 사용한다.
- Main: 계약 manifest, DB/ERP 부작용 문서, package test wiring, 통합 검증·병합·배포. 동일 파일을 worker끼리 공유하지 않는다.

## 필수 회귀 검사

1. 같은 연도·신라·공백 정규화 name+unit만 한 그룹이며 다른 연도/호텔/단위/수기행은 제외된다.
2. 미연결이 있는 그룹만 반환하지만 snapshot에는 연결된 형제행까지 모두 포함된다.
3. 유일한 활성 ProdKey만 suggestion이 되고, 복수 key·삭제 Product는 conflict이며 자동 선택되지 않는다.
4. scope 누락·stale membership·행 추가/삭제/이동·원본값/ProdKey 변경·inactive Product는 409이고 UPDATE 0건이다.
5. 여러 선택 그룹이 한 POST/한 transaction에서 모두 성공하거나, 중간 실패·부모 감사 write 실패 시 전부 rollback된다.
6. 기존 다른 ProdKey는 절대 덮지 않고 NULL 행만 변경되며 no-op/영향 행 수가 정확하다.
7. app-lock 실패와 비정상 반환은 fail closed이고 lock 순서는 year → masters → items → sorted Products → writes다.
8. GET·검색은 UPDATE/INSERT/DELETE를 포함하지 않고 가격·수량·날짜·비율·ERP 원장은 전후 동일하다.
9. UI는 그룹별 선택 → 적용 그룹 체크 → 범위가 적힌 확인 → 단일 POST 순서를 지키며 stale 응답과 중복 제출을 차단한다.
10. 운영 프록시 기본 1MiB 미만으로 요청을 제한한다. 최대 200그룹·10,000행에 더해 UTF-8 JSON 900KiB 한도를 UI와 API가 적용한다. 초과하면 초안을 보존하고 선택 그룹을 줄이도록 안내하며 자동 분할 저장하지 않는다.
