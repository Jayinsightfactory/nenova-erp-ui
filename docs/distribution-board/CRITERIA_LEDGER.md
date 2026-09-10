# 물량 배분 구현 Criteria Ledger

상태: `IMPLEMENTED_CODE`, `RUNTIME_VERIFIED`, `PENDING`. 미래 계약은 코드가 없으면 구현 완료로 표시하지 않는다.

| ID | 기준 | 현재 canonical 값 | 상태 | 검증/비고 |
|---|---|---|---|---|
| BASE-01 | API | `GET|POST /api/orders/distribution-baselines` | `IMPLEMENTED_CODE` | list `{items}`, get/post `{baseline}` |
| BASE-02 | 저장 root | `data/distribution-board/baselines` | `IMPLEMENTED_CODE` | private/ignored; deploy 지속성은 별도 |
| BASE-03 | ID | 64hex SHA-256(year, week, userId, requestId) | `IMPLEMENTED_CODE` | `dbb_` prefix/lineage 없음 |
| BASE-04 | source | raw `.xlsx` base64+SHA-256+server parsed result 저장 | `IMPLEMENTED_CODE` | client parse만 신뢰하지 않음 |
| BASE-05 | file limit | 512KiB; API body 750KiB | `IMPLEMENTED_CODE` | ZIP magic/strict base64/xlsx 검사 |
| BASE-06 | workbook | A1 year/week, row3 headers, `_keymap`, 300x150 | `IMPLEMENTED_CODE` | year/week mismatch 거부 |
| BASE-07 | coverage | `single|combined`; 01은 single만 | `IMPLEMENTED_CODE` | 02 single 또는 이미 01+02 combined |
| BASE-08 | immutability | same request payload idempotent; conflict 409; no delete/overwrite | `IMPLEMENTED_CODE` | tmp+exclusive link |
| BASE-09 | ERP snapshot | `erpSnapshot=null`, `reconciliationStatus=NOT_CAPTURED` | `IMPLEMENTED_CODE` | 완료/대조 주장 금지 |
| AUTH-01 | baseline auth | existing `withAuth` + same-origin | `IMPLEMENTED_CODE` | `accountActive`를 권한 근거로 가정하지 않음 |
| SRC-01 | room | exact `영업방` + configured room ID + `nenovakakao` | `RUNTIME_VERIFIED` | 5,184 rows, unique room ID |
| SRC-02 | token | dedicated server-only read token | `RUNTIME_VERIFIED` | source PR8 `7c220fd`, deploy `1ff91ed5`; health200/feed401 |
| SRC-03 | web proxy | `/api/kakao/sales-feed` withAuth and row revalidation | `IMPLEMENTED_CODE` | web deploy/smoke main 소유 |
| REVIEW-01 | event | year, week, sourceIdentity string, status, memo, requestId | `IMPLEMENTED_CODE` | server actor/time |
| REVIEW-02 | status | `PENDING|REVIEWED|NOT_NEEDED|LATER` | `IMPLEMENTED_CODE` | machine finding과 분리 |
| REVIEW-03 | memo | JS `memo.length <= 1000` | `IMPLEMENTED_CODE` | UTF-8 byte 제한 아님 |
| REVIEW-04 | storage | append-only `baselines/checklist-events`; latest per source | `IMPLEMENTED_CODE` | ERP action 없음 |
| EXTRACT-01 | source preservation | every message → request(s) 또는 unresolved | `IMPLEMENTED_CODE` | exact sourceIdentity/quote 검사 |
| EXTRACT-02 | date | 실제 calendar `YYYY-MM-DD` 또는 null | `IMPLEMENTED_CODE` | 2026-02-30 거부 |
| FACT-01 | scope | explicit year, single `WW-SS` or combined `WW-01+WW-02` | `IMPLEMENTED_CODE` | SS 01..99; cross-year 금지 |
| FACT-02 | reads | Customer, Product, ShipmentHistory, ViewShipment+ShipmentDate SELECT | `IMPLEMENTED_CODE` | ERP write/SP 없음 |
| FACT-03 | actual probe | customers672/products3225/history347/current809/unknown-unit5 | `RUNTIME_VERIFIED` | 2026/37-01+02 read-only |
| FACT-04 | history coverage | always `historyComplete=false` | `IMPLEMENTED_CODE` | missing history ≠ 미처리 증명 |
| CMP-01 | identity | year+week+CustKey+ProdKey+unit+date/time | `IMPLEMENTED_CODE` | positive keys, exact matching |
| CMP-02 | duplicate | duplicate request ID 또는 same event claim만 ambiguous | `IMPLEMENTED_CODE` | duplicate sourceIdentity는 정상 |
| CMP-03 | current rows | context only | `IMPLEMENTED_CODE` | current total로 완료 판정 금지 |
| CMP-04 | ShipmentAdjustment | numeric comparison 제외 | `CONTRACT_FIXED` | stored input unit 없음 |
| SAFE-01 | advisory isolation | 모든 오류/상태가 existing workflow 비차단 | `CONTRACT_FIXED` | disabled/preflight/save guard 연결 금지 |
| SAFE-02 | ERP writes | 신규 경로 0 | `IMPLEMENTED_CODE` | 모든 ERP 원장/SP preserve |
| GRID-01 | baseline-current API | 없음 | `PENDING` | exact baseline ID + SELECT-only 필요 |
| GRID-02 | union rows/columns | 없음 | `PENDING` | baseline-only/matched/ERP-only |
| GRID-03 | date binding | workbook header day → calendar shipmentDate | `PENDING` | 미확정이면 delta null |
| GRID-04 | unit binding | baseline quantity unit ↔ Product.OutUnit | `PENDING` | 미확정이면 delta null |
| GRID-05 | cell delta | exact key/date/unit에서 current-baseline | `PENDING` | raw Sdetail/Sdate trace 필수 |
| GRID-06 | coverage projection | single 1주; combined 01+02 각 1회 | `PENDING` | 01 이중 가산 금지 |
| DEPLOY-01 | baseline persistence | deploy/restart 후 동일 ID 재조회 | `PENDING` | 확인 전 durable production 완료 주장 금지 |
| DEPLOY-02 | union grid | API/UI/fixtures/browser smoke | `PENDING` | 1920x1080 기준 |

## 남은 검토 gate

- approximate source timestamp가 machine match를 확정적으로 만들지 않는가.
- shipmentDate가 null인 request를 exact-day match로 승격하지 않는가.
- orphan/deleted detail history와 unit 미확정 evidence가 per-item 누락 증명으로 사용되지 않는가.
- combined scope가 `WW-01`,`WW-02`를 각각 한 번만 조회·표시하는가.
- baseline reconciliation 실패 전후 기존 parse/register/distribute/fix 상태가 동일한가.
