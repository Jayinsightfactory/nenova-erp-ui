# 네덜란드 물량표 업로드 → 주문·분배·원화 단가 설계

작성일: 2026-10-05. 기준: `origin/master abd4e8bf`, `codex/dutch-upload-distribution`.
상태: **사전 설계만 작성. 구현·테스트 실행·운영 쓰기·배포 없음. KRW 및 전체 국가·품종 교체 사용자 확인 완료.**

## 1. 확정 요구

- 업로드 업체/품목 자동 매칭, 수동 재매칭 및 행 추가/수정, 적용 전 검증을 제공한다.
- 모든 단가는 **KRW**이다. 환율 계산이나 과거 EUR 숫자의 원화 재해석은 하지 않는다.
- 기존 활성 주문은 보존한다. 같은 연도·차수·업체·품목 주문이 없고 최종 분배가 양수일 때만 양수 주문을 생성한다.
- 분배는 증가 명령이 아닌 **최종 수량 SET**이다. 명시 단가를 수량과 같은 트랜잭션에서 저장한다.
- 기존 일반 엑셀 분배, 붙여넣기, 주광 개별단가/그 외 품목 균일가, 엑셀 도형 단가 내보내기 등은 보존한다.
- `업체/품목 추가`는 물량표 초안에 기존 ERP 마스터를 선택해 행을 추가하는 것으로 설계한다. Customer/Product 마스터 신규 생성은 별도 범위다.

**확정: 일반 엑셀 분배와 같은 `CATEGORY_REPLACE`를 사용한다.** 사용자는 파일에 없는 청화50이 0이 되는 것이 맞다고 확인했다. 기존→최종 수량과 증감량을 반드시 미리보기로 보여 준다.

| 선택 | 최종 대상 | 누락 자료 | 위험 |
|---|---|---|---|
| 검토 후 미선택: `EXPLICIT_PAIRS` | 사용자가 확인한 업체·품목 쌍만 | 전부 보존 | 이번 구현에 포함하지 않음 |
| 사용자 선택: `CATEGORY_REPLACE` | 기존 엑셀과 같이 DB 국가·품종 전체 | 파일에 없는 기존 분배를 0으로 정리 | 업로드에 없는 업체/품목도 변경됨을 표시 |

`pairKeysInScope` 인자만 전달해 범위가 제한된다고 가정하면 안 된다. 화면 필터로 가려진 행도 적용 대상에서 임의 제외하지 않는다. 서버가 합성한 0 대상의 업체·품목·현재량·최종0·감소량을 확인창에 모두 표시한다. 선택 차수/DB CountryFlower 범위 밖은 보존한다.

## 2. 근거와 발견한 차이

- 직접 확인: `lib/shipmentImport.js`의 `buildImportPreview`, `applyImportRowsCore`, `syncOrderDetailForShipmentImport`, `verifyAppliedShipmentRows`; `lib/shipmentImportSnapshot.js`; 기존 preview/apply API와 `pages/shipment/distribute-import.js`; Dutch board/price helper.
- `buildImportPreview`는 현재 국가·품종 전체 `buildReplacementProductKeys`의 누락 DB 행을 무조건 0으로 합성한다. `fullCategoryReplacement:false`를 apply에 주는 것만으로 이미 합성된 0 행을 막지 못한다.
- `syncOrderDetailForShipmentImport`는 이미 기존 활성 주문을 보존하고 없을 때 양수 생성한다. 이를 다시 구현하거나 구 문서의 “양수 주문 동기화” 설명대로 되돌리지 않는다.
- 현재 미리보기의 `orderDiffQty`/상태 설명은 이 주문 보존 정책과 불일치할 수 있다. Dutch 미리보기는 실제 순수 정책 결과로 주문 전후를 표시한다.
- 현재 no-change 분기는 수량/날짜만 본다. 가격만 바뀐 행이 건너뛰어지지 않도록 `costChanged`를 포함해야 한다.
- 현재 import 금액 SQL 일부는 `Cost * EstQuantity`를 직접 사용한다. 신규 명시 가격 경로는 `amountVatFromCostEst`의 EXE 반올림을 사용한다. 기존 일반 import의 전역 금액식 변경은 별도 검토 없이 하지 않는다.
- 현재 확정/동시수정 사전 검증은 트랜잭션 밖 조회이며 내부 반복문은 같은 fix map을 재사용한다. Dutch 경로에서는 잠금 후 재조회·재검증이 필수이며 확정행을 `continue`로 건너뛰는 부분 성공을 허용하지 않는다.
- snapshot은 6개 원장 전체 컬럼을 보관하므로 Cost/Amount/Vat도 포함된다. 그러나 현재 `TOP 1` master/detail 수집이므로 중복 master/detail 전체를 복구할 수 있다고 주장하면 안 된다. Dutch는 중복 업무키를 명시 차단하거나 snapshot 범위를 먼저 확장해야 한다.
- `buildImportPreview`는 명시 rawYear 인자가 없고 rawWeek에서 연도를 얻는다. 새 JSON 경로는 `requireOrderYear`로 검증한 year+week를 끝까지 전달한다.
- 명시 CustKey/ProdKey가 삭제·무효이면 현재 preview 코드가 자동 매칭으로 fallback할 수 있다. Dutch 명시 선택은 오류로 반환하고 다른 업체/품목으로 바꾸지 않는다.
- `executeEstimateCostOnly`는 Estimate/CustomerProdCost까지 쓸 수 있는 별도 계약이다. 통째로 호출하지 않고 금액 순수 helper와 검증 패턴만 재사용한다. 이번 가격 저장은 해당 ShipmentDetail/ShipmentDate만 변경한다.

메인 작업이 실제 dnSpy CLI로 확인한 근거(이 하위 작업이 독립 실행한 것은 아님): `FormShipmentDistribution.btnSave_Click`는 상세 Cost/Amount를 저장하고 수량 변경 시 날짜를 재생성한다. 수량 불변 가격 변경은 `ClassShipmentDate.UpdateCost`로 날짜별 Cost/Amount/Vat를 갱신한다. 식은 `Round(Cost * Round(EstQuantity,0) / 1.1,0)`, VAT는 세금 포함 합계에서 공급가를 뺀다. 확정 SP는 별도 동작이다.

메인 작업 제공 read-only 표본: 2026/40-01/Cust533/Prod2231은 분배100, Cost2100, isFix=true, ViewOrder/ViewShipment 각1, 날짜합100, 농장0. 따라서 실제 확정 차단 양성 근거이며 시험 저장 대상이 아니다. 같은40-01의 Dutch 주문은 2025년14/2026년35로 교차연도 격리가 필요하다. 원본 CLI/SELECT 증거 파일 경로는 구현 전 메인 작업의 golden 기록에 연결한다.

읽은 기준: ERP_CHANGE_GUARD, ERP_FEATURE_CHANGE_CHECKLIST, ERP_COMPAT_INVARIANTS, DB_STRUCTURE의 주문/출고/단가 구조, WEB_VS_ERP_CONFLICTS의 ViewOrder/ViewShipment, NENOVA_DNSPY_CLI_WORKFLOW, FormShipmentDistribution golden 관련 절, dutch-volume-board 계약. `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 이 기준 worktree에 없어 읽을 수 없었고 메인에 보고했다. 오래된 문서의 IDENTITY/상세 CustKey 필수/금액·확정 설명보다 실제 EXE·DB·현재 helper가 우선한다.

## 3. 최소 모듈 확장

1. `lib/dutchVolumeDistribution.js`(신규 권고): 순수 초안 정규화, 명시 키/중복쌍/가격/통화 검증, scope 계약, 가격 포함 최종 의도 및 비교 지문을 담당한다.
2. `lib/shipmentImport.js`: `buildImportPreview`의 기존 국가·품종 전체 누락0 합성을 재사용한다. `EXPLICIT_PAIRS` 분기는 만들지 않는다. `applyImportRows`→`applyImportRowsCore`에 명시된 Dutch 정책, 서버 재검증된 전체 scope와 KRW 가격을 전달한다. 기존 주문 helper/환산/채번/마스터 재사용/단일 tx/스냅샷/검증 경로를 재사용한다.
3. `pages/api/shipment/dutch-volume-preview.js`(신규): 인증된 JSON POST, SELECT-only. 기존 multipart preview의 bodyParser 계약을 깨지 않는다. 저장·rollback-only 쓰기·DDL·별칭 학습을 수행하지 않는다. 읽기 트랜잭션에서 잠금 일관된 snapshot을 얻고 서버 보관 계획 토큰을 발행한다.
4. `pages/api/shipment/dutch-volume-apply.js`(신규): 서버 보관 계획을 기존 `applyImportRows` 코어에 전달하는 얇은 어댑터. 기존 일반 apply endpoint는 보존하며 `/api/shipment/distribute-import-apply-progress?jobId=...` 진행 조회를 재사용한다. 서버가 scope/행/가격/지문을 재검증하며 클라이언트의 `force`, `skip`, 확정상태를 신뢰하지 않는다.
5. `pages/stats/dutch-volume-board.js` + `lib/dutchVolumePrice.js`: 원본 셀 식별을 유지한 편집초안, 자동/수동 매칭, 재검증 무효화, 원화 가격, 적용·로그·응답불명 복구. `dutchPriceShapes`와 기존 workbook 구조는 보존한다.
6. `lib/shipmentImportSnapshot.js`/`shipmentImportAudit.js`: 가격만 변경해도 snapshot·작업건수·행 로그가 남도록 확장한다. 상세/날짜 가격 전후·검증 결과를 로그에 남긴다. 새 원장/DDL은 가능하면 만들지 않는다.
7. `docs/contracts/dutch-volume-board.json`: 읽기 전용 보존 계약과 EUR 설명을 새 명시 Apply 동작과 분리해 갱신. 기존 import 계약 scope, golden, 실행형 fixture도 함께 갱신한다.

## 4. 기준 원천과 API 계약

| 기준 | 원천 | 모든 소비 위치 |
|---|---|---|
| 업무키 | EXE View 조인 | 표시/preview/apply/잠금/snapshot/readback 모두 year+week+CustKey+ProdKey |
| 적용 범위 | 사용자 확인 CATEGORY_REPLACE | DB CountryFlower 기반 동일 scope resolver를 preview와 tx 재검증에서 사용 |
| 수량 원천 | 입력 업체별 수량 셀 | uploadQty만 환산; 주문/입고/재고/잔량 요약은 감사 참고 |
| 주문 | 현재 helper의 활성 주문 보존 | preview 주문전후, 저장, readback |
| 단가 | 사용자 확인 KRW, 입력된 품목만 적용 | 빈칸/누락은 override 없음(기존/기본값 보존); 명시0은 유효한 가격으로 표시·확인; 음수·비유한은 차단 |
| 가격 기준 단위 | Product.EstUnit 및 EXE 금액식 | OutUnit 수량과 구분 표시; EstQuantity×단가로 예상 금액 |
| 확정 | 현재 import eligibility + tx 잠금 조회 | 하나라도 차단되면 전체 실패; 자동 확정취소/재확정 없음 |
| 가격 재사용 | 저장 draft currency/version | 구 EUR/통화없음은 보존하되 자동 적용 제외·재입력 안내 |
| 재시도 | 기존 jobId 진행 복구 | 502/503/504/네트워크 단절 시 새 POST 금지 |

메인과 합의한 API shape:

```text
POST /api/shipment/dutch-volume-preview
{ year, week, entries: [{ id, product, color, customer, quantity, unit,
                         custKey?, prodKey?, unitPrice? }] }
-> { ...기존Preview, rows, unmatched, customerOptions, productOptions,
     planToken, logs }

POST /api/shipment/dutch-volume-apply
{ planToken, jobId, ackQtyWarnings }
-> 기존 apply 결과 shape + 기존 jobId 진행 조회
```

서버가 sourceMode=`DUTCH_VOLUME_KRW`, currency=`KRW`, scopeMode=`CATEGORY_REPLACE`를 고정한다. 미리보기는 유효 키/매칭 후보·원본/환산 수량·주문/분배/금액 전후·확정/미매칭 차단 사유·서버 scope를 반환한다. 자동 매칭이 불명확하면 후보를 표시하고 적용하지 않는다. unitPrice는 선택값이며 빈칸/누락/null은 단가 변경 지시가 아니다. 명시 숫자0은 미입력으로 바꾸지 않고 0원 변경을 미리보기에 강조한 뒤 일반 적용 확인을 받는다. 합성 누락0 행도 가격을 요구하지 않는다. blank를 Number('')로 0원 변환하거나 `value || default`로 명시0을 덮어쓰지 않는다.

Apply는 rows를 재전송하지 않고 서버 발행 planToken/jobId만 사용한다. 서버 보관 계획은 인증 사용자, 업무키, 전체 범위, 최종 수량, 명시 단가, 단위환산 마스터 값, 잠금 조회한 기존 상세/날짜/농장/확정 snapshot 지문에 바인딩하고 만료·소유자·동일 token 중복실행을 검사한다. 전체 카테고리의 구성원 지문도 포함하여 preview 뒤 새 분배행을 조용히 0으로 만들거나 누락하지 않는다. 초안의 매칭/수량/단가/연도/차수 변경은 이전 preview를 무효화한다. 중복 쌍은 같은 단위·같은 명시가격일 때만 수량 합산을 설명하고 합치며 충돌은 차단한다.

트랜잭션 순서: 대상 scope와 업무키 잠금 → 활성 마스터/연도/단위/확정/가격·수량 기준 재검증 → before snapshot → 필요한 양수 주문 생성 → 최종 분배 SET 및 명시 가격 저장 → 날짜 동기화 → after snapshot·감사 → 원장/View/금액 검증 → commit. 잠금 뒤 확정·외부 수정·활성 상태 변경은 전체 rollback한다. 가격만 변경이면 날짜 수량·출고일·농장·확정은 보존한다. commit 뒤 별도 SELECT 실패는 “저장 여부 확인 필요”로 구분하며 자동 재적용하지 않는다.

## 5. 부작용 및 downstream

| 동작 | OrderMaster/Detail | ShipmentMaster/Detail | ShipmentDate/Farm | Estimate/손익/입고/재고/단가마스터 |
|---|---|---|---|---|
| 업로드·매칭·행 편집·JSON preview | 보존 | 보존 | 보존 | 보존 |
| 양수 SET, 기존 주문 있음 | 기존 모든 주문 보존 | 현재연도 재사용/생성, 최종량·명시 가격/금액 | 기존 import 날짜 수량 동기화; 농장 영향 사전 표시·기존 정책 | 직접 쓰기 금지 |
| 양수 SET, 주문 없음 | 양수 주문 생성 | 위와 동일 | 위와 동일 | 직접 쓰기 금지 |
| 명시 0 / 승인된 누락 0 | 보존; 0 가짜 주문 금지 | 기존 분배 정리; 없으면 생성 금지 | 해당 상세의 날짜/농장 정리 | 직접 쓰기 금지 |
| 수량 동일, 가격 변경 | 보존 | Cost/Amount/Vat만 | 날짜 Cost/Amount/Vat만; 수량·일자·농장 보존 | CustomerProdCost/Product.Cost 포함 보존 |
| 확정/충돌/검증 실패 | 전체 rollback | 전체 rollback | 전체 rollback | 보존 |

미확정 분배이므로 이번 저장이 확정 매출을 만들면 안 된다. `isFix`를 보존하고 자동 확정 SP/StockHistory/StockCalculation을 호출하지 않는다. 견적은 `ViewShipment+ViewOrder+ShipmentDate+PeriodDay+DetailFix=1` 기준 노출 여부를 기록한다. 확정행은 저장 차단하고, 해당 차수 확정 Amount/Vat 합계·WebProfitReport 원장 보존을 read-only로 대조한다. 농장 배정이 있는 기존 상세는 수량 변경 시 기존 import 정책의 구체적 영향을 preview에 표시하고 보존을 보장할 수 없는 경우 차단한다.

## 6. 필수 실행형 검증과 완료 기준

- 양성: 유일 활성 Dutch 품목/업체, 현재연도 주문 있음(보존)/없음(양수 생성), 최종 SET 재실행, 가격만 수정, 양수 수량+가격 원자 저장.
- 단가 경계 양성: 빈칸/누락/null은 override 없음, 명시0은 0원 저장·확인, 양수는 명시 가격 저장. 기존 가격과 기본가격 fallback 정책은 override 없을 때만 재사용한다.
- 근접 음성: 확정행, preview 뒤 확정/수량/가격/날짜/단위/삭제 변경, 잘못된 명시 키, 모호한 자동매칭, 중복 업무키, 중복쌍 가격 충돌, 음수/NaN/Infinity 가격, EUR/통화없음 구 draft의 자동 적용, 박스 계수0, 연도누락/불일치.
- 2025/2026 동일40-01 fixture: 선택 연도만 변경, 전년도 sentinel 전체 보존. 기존 native 상세 CustKey=NULL은 자동 보정하지 않는다.
- 범위 fixture: CATEGORY_REPLACE에서 파일 밖 같은 품종의 청화50→0 포함, 기존 주문 보존 및 delta=-50 표시. 다른 품종/연도/차수 sentinel은 보존. 승인 미리보기 뒤 scope 신규행 발생·행 누락/위조·빈 전체 scope는 재검증 실패로 차단.
- 금액 fixture: EstUnit≠OutUnit, 소수 EstQuantity, 반올림 경계, 여러 날짜별 금액, 상세·날짜 가격 readback 훼손 시 전체 rollback. 기존 모든 일반 import 테스트 유지.
- 실패 원자성: 앞행 성공 뒤 뒷행 가격/확정/감사/snapshot 실패 시 원장·날짜·로그 rollback; commit 이후 SELECT 실패와 실제 rollback을 구분.
- DB 사전/사후: 같은 네 키의 Order/Shipment, ViewOrder/ViewShipment, 날짜합·개별금액·PeriodDay, Farm, Estimate/DetailFix 노출 및 확정 매출 합계. 운영은 임의 시험 쓰기 금지; 쓰기 fixture는 격리 SQL 환경에서 수행.
- UI: 1920×1080 CSS px/100%에서 매칭·수량·원화단가·검증상태·적용 버튼, 긴표 scroll, 모달 이탈·sticky 가림·실패 알림·응답불명 복구. 작은 화면 핵심 기능 접근 유지. shell 1개.
- 필수 gate: `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from abd4e8bf`, `npm run guard:erp-writes -- --changed-from abd4e8bf`, `npm run test:ui-layout`, `npm run build` 및 새 정책/SQL/UI fixture.
- 메인만 커밋/PR/병합/배포/운영 스모크를 수행한다. 범위는 확정됐지만 실제 CLI/DB 근거 연결, 구현, 필수 gate와 배포 검증 전에는 기능 완료로 표시하지 않는다.
