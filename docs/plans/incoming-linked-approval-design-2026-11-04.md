# 입고 정정 연결원장 승인 설계 — 2026-11-04

설계 담당: Astra. 구현·운영 쓰기를 수행하지 않은 설계 문서다. 기준은 origin/master `4be3c314`, 기존 승인 흐름 PR1504다. 원가 연결, 확정 손익, 기존 농장배정은 정상 지원 대상이며 그 존재만으로 차단하는 기존 제한을 완료 기준으로 인정하지 않는다.

## 1. 확인한 근거와 결정

- AGENTS.md, ERP 변경 skill, ERP_CHANGE_GUARD, ERP_FEATURE_CHANGE_CHECKLIST, ERP_COMPAT_INVARIANTS, NENOVA_DNSPY_CLI_WORKFLOW, MENU_DEVELOPMENT_DEFAULTS, DB_STRUCTURE의 입고/원가, WEB_VS_ERP_CONFLICTS의 View/SP 범위와 incoming-approval 계약을 검토했다.
- 실제 EXE의 직전 작업 CLI 재추출 `C:/Users/USER/nw-incoming-approval-flow-1104/.verify/FormShipmentDistribution.cs` 1080행 이후: btnSave_Click은 ShipmentDetail 환산수량·단가·금액 → ShipmentFarm → ShipmentDate 순서다. 수량 변경 때 날짜 삭제/재생성, 단가만 변경 때 UpdateCost. 공급가 `ROUND(Cost * ROUND(EstQuantity,0) / 1.1,0)`와 잔액 VAT가 근거다. 이미 저장된 실제 CLI 산출물을 검토했으며 이번 설계에서 재추출을 실행했다는 뜻은 아니다.
- `docs/exe-golden/IncomingApproval.md` 및 직전 `.verify/probe.json`: 2026 41/42/43/44차 각각 1558/1412/1445/1351 상세가 확정, 2025 동일차수가 존재한다. 당시 활성 41차 이후 손익확정본 0건은 표본 결과일 뿐 지원 제외 근거가 아니다.
- ShipmentFarm에는 WarehouseKey/입고행 FK가 없다. `FarmKey, ShipmentQuantity, SdetailKey`만으로 어느 입고가 출고되었는지 추론할 수 없다. 수입부 농장 변경을 모든 출고 농장배정에 일괄 적용하지 않는다.
- `lib/shipmentFarmAssignments.js`와 farm-distribution API의 normalize/assertTotal 및 제품 전체 `FARM_CANDIDATE_SCOPE_SQL`을 공유한다. API의 기존 확정 차단은 정책이며 농장배정 구조상의 불가능을 뜻하지 않는다.
- 기존 승인 writer의 WarehouseDetail 전체 DELETE/INSERT는 WdetailKey를 변경한다. FreightCostDetail.WarehouseDetailKey와 WebInvoiceCostLine.WdetailKey 및 operation.result.lineMappings가 물리행을 참조하므로 그대로 사용하면 안 된다.
- `invoiceReceiptCost.js`의 revisionLiveStatus는 WdetailKey, ProdKey, 수량뿐 아니라 header(FarmName 포함)를 검증한다. 농장만 바꿔도 원가 화면이 STALE이 될 수 있다. 경제값 보존과 연결증거 정정은 별도다.
- `profitReportConfirm.js` confirmSnapshot은 전역 query/자체 withTransaction/활성본 거절 구조다. 외부 승인 트랜잭션 안에서 그대로 호출할 수 없다. buildSourceHash/buildConfirmDetailRows는 공용으로 재사용 가능하다.
- `pages/api/sales/profit-report.js` loadReportData와 하위 lib/profitReport.js의 전역 query, FIFO 메모리 캐시는 승인 중 미커밋 값을 볼 수 없다. 새 SQL로 손익을 대충 증감하는 대신 같은 계산 경로의 query context와 캐시 우회가 필요하다.

## 2. 사용자 완료 기준

1. 수입부는 농장/품목/수량 최종값과 사유를 요청한다. 초안·제출·반려는 ERP를 쓰지 않는다.
2. 영업지원은 영향 업체·연도·차수·날짜·품목별 최종 분배, 농장배정, 입고행/원가행 연결을 검토한다.
3. A→B 동일수량도 source A 제거와 target B 추가를 한 계획으로 처리한다. 감소만도 허용한다. 없는 B 주문은 양수 신규 연결을 명시 승인하고 기존 주문은 보존한다.
4. 41차 수정은 42~44차 및 존재하는 미래연도 재고와 관련 보고서까지 추적한다. 전년도 같은 차수는 보존한다.
5. 최종 확인 한 번으로 입고·분배·재고·견적 표시·매출·연결원가·확정손익 revision·감사를 한 SQL transaction에서 반영한다. 어느 단계 실패도 전부 롤백한다.
6. 화면 요청/처리/이력과 실제 조회 결과가 일치해야 완료다. 운영 시험쓰기 없이 격리 fixture로 쓰기 경로를 검증하고 운영은 읽기 스모크로 확인한다.

## 3. 동작별 부작용

| 동작 | Warehouse | Order | ShipmentDetail/Date | ShipmentFarm | Stock | 원가 연결 | 손익/Estimate |
|---|---|---|---|---|---|---|---|
| 초안/제출/매칭/반려 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 농장만 확정 | Master.FarmName | 보존 | Descr만 허용, 경제·날짜·isFix 보존 | 명시 선택 배정의 농장만, 수량 보존 | 보존 | 경제값 보존, 필요시 새 연결증거 revision | 확정손익·독립 Estimate 보존 |
| 품목/수량 확정 | 명시 행 매핑으로 최종값 | 기존 보존, 승인된 양수 대체품 신규만 | 환산/날짜별 금액/확정 상태 일치 | 영향 그룹 최종 배정표 | signed delta + native 미래 cascade | 원천/수식 검증된 새 revision | 관련 확정본 새 revision, 독립 Estimate 보존 |

원가가 없는 행에 임의 원가·환율을 만들지 않는다. 수기 WebProfitReport 원천입력과 독립 Estimate 차감/단가차감은 보존하며 기존 보고서 계산의 수기 우선순위를 유지한다.

## 4. 입력과 기준 ledger

| 필드/판정 | 기준 | 모든 소비자 |
|---|---|---|
| warehouseKey + orderYear + orderWeek | PK와 선택 연도/세부차수 일치, 활성 원장 | 목록/초안/preview/잠금/감사 |
| receiptLineMappings | source WdetailKey → final row identity, 중복·타입고 금지 | 수입부 비교/지원 매칭/원가/쓰기 |
| rows.quantity | 날짜별 최종 OutUnit 수량, 누락행 보존, 명시 0=감소완료 | UI/정규화/분배 plan/write |
| rows.cost | 명시 판매단가, 0 유효, null/누락은 오류 | UI/preview/금액계산/write |
| farms | shipmentKey + prodKey의 최종 farmKey/quantity 목록 | 후보/매칭/합계/잠금/readback |
| receipt·matching revision/digest | 현재 DB facts와 payload 전체 해시, 낙관 잠금 | preview/최종확정/재시도 |
| financialRevisions | 기존 key/revision + 새 계산 fingerprint + 변경 이유 | 지원 미리보기/최종확인/쓰기/이력 |
| future scope | 선택 연도차수 이상 전체, 영향 제품 한정 | 재고/보고서 영향/검산 |
| farm candidate | 제품 전체 ViewWarehouse + 승인 후 해당 입고가 제공할 후보 | preview/잠금/저장 후 동일검증 |

입력 누락과 명시 0/false를 구분한다. 기본 매칭은 변경 없음이며 품목 이동·농장 이동·원가 재계산·보고서 정정은 사용자가 확인할 차이로 표시한다. 수량 자동 비례배분이나 최신 환율 대체는 하지 않는다.

## 5. 입고/원가의 물리행 식별

1. 같은 논리 원본행의 수량 수정 또는 1:1 품목 정정은 WdetailKey를 보존해 UPDATE한다. 행 순서나 ProdName만으로 identity를 결정하지 않는다. 양쪽 모두 유일한 source row identifier를 만들고 요청에 보존한다.
2. 분할/병합/제거는 명시 매핑이다. 기존 참조행을 무차별 삭제하지 않는다. 신규 행만 INSERT하여 생성키를 받아 cost mapping에 사용한다. 전량 제거가 필요한 연결행은 실제 FK/reader의 0행 처리 근거를 확인한 뒤 정책을 고정한다. 임의 tombstone·가짜 주문으로 해결하지 않는다.
3. FreightCost 활성 헤더/상세는 기존 저장 입력(환율, 요율, 중량, 비용, 판매가격)을 근거로 freightCalc를 실행한 새 스냅샷을 만든다. 이전 헤더를 삭제상태로 전환하더라도 상세 이력은 보존한다. active WarehouseKey unique 제약을 transaction 안에서 만족시킨다. 수량변경이 전체 BILL 배분분모를 바꾸면 해당 BILL 전체를 다시 계산한다.
4. WebInvoice 원문 sourceHash와 과거 operation/result는 역사적 사실이다. 덮어쓰지 않는다. 현재 문서의 승인 정정 revision과 새로운 연결 operation을 만들고 요청번호/원본 operation/행 매핑 전후를 이력에 기록한다. 실제 저장 schema enum과 reader 선택규칙을 재검증하여 기존 모드로 정정 경로를 명시 구현한다. 새 operation 때문에 입고를 중복 생성하지 않는다.
5. invoiceReceiptCost의 기존 previewInvoiceCost + revision writer를 외부 tx에서 실행한다. 새로운 receiptSnapshot/lineMappings/receiptDigest는 정정 후 실제 원장을 가리킨다. 이전 APPROVED는 STALE 이력으로 보존하고 새 ACTUAL(+기존 정책의 EXPECTED_95)을 append한다. farm-only는 비용수치가 같음을 검증한다.
6. 최신 원가 readback은 APPROVED와 MATCH, 문서/버전/operation/warehouse/행키/품목/단위/수량이 모두 맞아야 한다. 단순 Status=APPROVED 갱신이나 UI stale 숨김은 금지다.
7. WebArrivalCostLine/StockPrice 등 직접 입고행 FK 없는 원가는 동일 품목이라는 이유로 전역 이동시키지 않는다. 실제 source lineage가 해당 입고임을 입증한 연결만 정정 계획에 포함하고 나머지는 독립 원천으로 보존한다.

## 6. 농장배정

지원 화면은 영향 ShipmentKey+ProdKey별 기존 배정과 최종 배정을 보여준다. 기존 배정이 있는 그룹의 수량/품목 변경은 최종표를 반드시 제출한다. 전량 A→B는 A 최종표 빈 목록, B 최종표 합계=B 최종 OutQuantity다. 일부 이동이면 A/B 양쪽 합계를 각각 검증한다. 타 업체 배정은 건드리지 않는다.

새 그룹 생성 후 resultDetailKey를 확보하고 그 키에 최종 FarmKey/ShipmentQuantity를 저장한다. source/target 단위가 다르면 OutUnit 수량을 그대로 복사하지 않고 명시 최종값+환산검증을 사용한다. 기존 배정이 없는 경우에도 임의 농장을 생성하지 않는다. farm-only는 원래 수량을 그대로 보존한다. 농장 비고는 기존 FarmCode:수량 형식 helper와 동일하게 생성한다. 실제 CLI 코드의 일부 행이 상세 총량을 배정수량으로 넣는다는 이유로 N개 농장에 총량을 반복 복제하지 않는다.

## 7. 확정 손익 revision

- 활성 확정본의 존재는 차단 조건이 아니다. 영향 기간은 입고/매출 직접 변경차수, native 재고가 달라진 기간 및 그 재고를 기초/기말/이월 원가로 참조하는 후속 확정 기간이다. 초기에는 선택차수 이후 활성 확정본 전체를 보수적으로 재계산 비교하고 값/원천 지문이 달라지는 기간만 revision한다.
- loadReportData의 같은 계산 경로를 승인 queryFn으로 실행한다. 모든 하위 DB 조회는 같은 tx를 사용하고 외부 메모리 캐시/저장 확정본/이전 계산 캐시를 읽어 새 계산으로 가장하지 않는다. 새 계산 helper가 기존 웹 조회와 동등하다는 fixture가 필요하다.
- 기존 ConfirmDetail은 불변이다. 잠금한 기존 ConfirmKey/RevisionNo를 expected key로 비교한 뒤 기존 활성 헤더를 비활성화하고 새 RevisionNo=MAX+1/SourceHash/계산 상세/감사/actor/요청번호를 기록한다. 활성본은 기간당 정확히 하나다. 직접 cancelConfirm→confirmSnapshot 두 독립 transaction 호출은 금지다.
- snapshot cache는 기존 행 UPDATE가 아니라 insertSnapshot(runQuery=tx) 방식으로 새 계산을 append하고 이전 payload hash 관계를 보존한다. 보고서 화면/연간/엑셀에서 새 활성본 또는 새 cache가 동일 결과를 읽는지 확인한다.
- 정상 감사 오류는 입력 누락을 구체적으로 표시하여 정정한다. 기존 강제 확정 여부를 새 강제 승인으로 자동 계승하지 않는다. 강제 권한은 기존 admin+사유 계약을 지킨다.

## 8. 단일 transaction 순서

1. 요청 권한·revision·operation UUID 검증. 이미 applied이면 저장된 동일 결과 반환, 같은 UUID 다른 payload는 충돌.
2. native receipt gate, 요청, 입고, 제품, 관련 분배/날짜/배정, invoice/cost, 보고서 기간을 고정 순서로 잠금. 공용 writer의 applock 순서와 맞추어 deadlock 가능성을 검사한다.
3. 같은 공용 plan helper로 locked facts 재조회 및 digest 대조. 모든 원가/보고서 schema 능력도 이 시점에 확인하며 runtime DDL을 하지 않는다.
4. 명시 행 identity로 입고 수정, 필요한 양수 주문 연결, ShipmentDetail/ShipmentDate, 최종 ShipmentFarm 저장.
5. 현재고는 입고 delta와 확정출고 delta를 제품별 합산하여 최종잔량 기준으로 처리한다. 중간 A감소만 보고 부족 판정하지 않는다. 감사 StockHistory가 native StockType 집계에 재포함되는지 실제 CodeInfo/SP로 검증하고 중복계산하지 않는다.
6. 가장 이른 영향 차수부터 native CALC를 수행하고 모든 후속연도 영향제품 ProductStock의 ROUND(Stock,3)<0을 검사한다. 부족 시 전체 rollback. 별도 명시 부족보정 승인이 없는 자동 재고조정 금지.
7. 원가 연결/계산 revision, 이어서 새 stock/매출/원가를 보는 손익 계산 및 확정 revision 저장.
8. ViewOrder/ViewShipment/ShipmentDate/PeriodDay/DetailFix 견적 가시성, 날짜합계와 상세 Amount/Vat, farm 합계, invoice MATCH, 원가 합계, 손익 활성본·값 readback 검증. 독립 Estimate와 보존 원장 전후 fingerprint 대조.
9. 요청 applied, 모든 before/after/lineage/새 revision키/읽기검증을 같은 tx 감사에 기록. 감사 실패도 rollback. transaction/gate 상태 확인 후 commit.

외부 네트워크 호출·영상생성·파일쓰기·별도 DB transaction은 이 안에서 하지 않는다. 응답 유실은 요청 상태 조회와 같은 operation UUID 재시도로 해결한다. preview는 prospective plan과 지문을 보여주며 저장 후 DB 검산 전에는 반영완료라고 표시하지 않는다.

## 9. 화면/직원 안내 영상

1920×1080 CSS px, 100% 확대. 공통 shell 하나, 페이지 세로 스크롤, 키보드 Tab/Shift+Tab/Enter/Escape/방향키 및 초점 복귀를 검증한다. 3탭은 수정요청 / 매칭·확정 / 처리이력. 한 버튼이 어느 원장을 바꾸는지 업무용 한국어로 표시한다.

- 수입부 영상: 실제 입고 선택 → 기존/변경 농장 → 요청 사유 → 초안 재개 → 제출. 이어서 A→B 동일수량과 수량 감소 파일의 원본/매칭 비교. 제출 시점에는 입고가 바뀌지 않았음을 화면 상태로 확인한다.
- 영업지원 영상: 요청 열기 → 원래/최종 업체별 분배 → source/target 농장배정 → 연결원가 변경 전후 → 41~44/미래연도 영향 및 확정손익 revision → 명시 최종확인 → 처리이력·견적/매출 재조회. 감소만 사례도 별도 장면으로 보여준다.
- 실패 장면: stale 요청을 재조회하여 수정, 농장합계 오류 수정, 부족재고 안내와 전체 미반영, 응답불명 상태조회. 오류 코드만 읽는 대신 사용자가 고칠 필드에 실제 안내를 보여준다.
- 실제 구현 화면을 로컬 격리 SQL fixture로 녹화한다. 목업/API 가짜 성공을 실제 원장 완료처럼 제시하지 않는다. 운영 개인정보·자격증명은 영상에 노출하지 않는다. 수입부/영업지원 한국어 2개 파일, 장면별 제목/자막/커서동작/적절한 정지시간, 1920×1080 출력과 재생 검증이 필요하다. 광고/생성영상은 사용법 근거가 아니다.

## 10. 읽기 전용 증거와 실행형 fixture

구현 전 실제 sys.columns/FK/unique/status 제약과 `WebInvoiceOperation`, Document/Line, CostRevision/Line, FreightCost/Detail, ProfitConfirm/Detail/Snapshot을 조회한다. 원가 연결 입고 1건 이상의 key/lineage와 farm-only header 검증 범위를 캡처한다. 실제 SP/CodeInfo에서 입고·출고 StockHistory 중복 집계 여부를 확인한다. 운영 데이터는 최소 식별값·집계만 기록하고 개인정보/비밀은 저장하지 않는다.

| 양성 격리 SQL 사례 | 반드시 함께 실패/보존할 근접 반례 |
|---|---|
| 농장만 + 실제 원가 연결, 비용·수량 동일/MATCH | 타농장/다른 입고행 매핑, 농장수량 1 증가 |
| A→B 동일수량 + 기존 Farm 배정 + 고정매출 | B 농장후보 아님, A 잔존배정, 잘못된 단위 |
| 100→80 감소만 + 운송/인보이스 원가 revision | 음수수량, 원가 sourceId 다른 문서 중복 |
| 동일 WdetailKey 1:1 변경 + 이력 보존 | 타 WarehouseKey 행, 중복 source row, stale row |
| 41차 정정→42/43/44 및 2027 cascade | 2025 동차수·타제품·타업체 hash 완전보존 |
| 41~44 및 2027 활성손익 새 revision | 이전 ConfirmDetail 불변, revision 충돌 전체롤백 |
| native NULL 상세 CustKey 정상견적 | 잘못된 상위업체/달력 시각 차이 |
| 0단가 명시, 0 최종분배, false 확인 | 누락/null/NaN과 0 구별 |
| 같은 operation 재시도 결과 동일 | 같은 UUID 다른 payload, 동시 두 승인 |
| source 원가 preview와 persisted readback 동일 | 오래된 계산캐시/다른 tx 조회 감지 |
| 기존 판매/입고 산식 검산 | Farm·native CALC·원가·손익·감사 각 단계 fault injection 시 전체 hash 원복 |

순수 정책 테스트만 통과해서는 완료가 아니다. 격리 SQL writer 통합, 기존 freight/invoice/profit 회귀, 전체 ERP 계약/dnSpy/manifest/write guard/webpack build, CI, 병합, Cafe24 배포, 운영 ping/commit배지/실브라우저 읽기 스모크가 필요하다. 실 EXE GUI와 운영 승인시험을 하지 않았다면 미검증으로 명시한다.

## 11. 담당 분리 권고

Astra는 이 설계/기준 검토만 맡는다. 구현 담당은 core plan/identity/farm/financial transaction writer를 담당한다. 검증 담당은 실제 dnSpy/readonly evidence/격리 SQL/fault injection을 담당한다. UI·영상 담당은 입력/preview/확인/처리이력과 두 직원 영상, 1920/소형/키보드 검증을 담당한다. 공용 파일 소유자를 고정하고 통합 담당이 전체 gates/PR/배포를 마무리한다.

이 설계의 미확인 항목은 연결 제거행 FK/0행 reader 정책, 새로운 invoice 정정 operation의 실제 schema status 허용과 소비자 선택, 보고서 하위 query/cache 전체 전파다. 정상 사례 자체를 금지하여 우회하지 말고 근거/fixture를 확보해 구현해야 한다.

## 12. 통합 담당과 확정한 구현 선택 (위 preview 제안을 구체화)

### 정확한 미리보기: 동일 writer의 rollbackOnly rehearsal

기존 ERP_CHANGE_GUARD의 2026-09-02 preflightOnly와 db.withTransaction의 rollbackOnly 방식을 사용한다. 미리보기는 실제 native·원가·보고서 경로를 잠금 transaction 안에서 실행하고 **항상 rollback**한다. 승인 전 영구 원장 변경은 0이다. SELECT 문자열 overlay나 손익 금액 delta 추정은 사용하지 않는다. 화면에는 재계산 미리보기이며 실제 반영은 최종확정 시점임을 표시한다. rehearsal은 최종 요청 applied/audit 완료 이벤트를 남기지 않는다.

미리보기 응답은 정확한 입고/분배/농장/원가/확정손익 before/after, 원천 fingerprint, semantic result digest를 포함한다. commit은 같은 writer를 재실행해 승인된 digest와 대조한다. rollback으로 소모된 identity/새 UUID/시각 등 비업무 메타데이터는 결과 semantic hash에서 제외하되 원천의 기존 key/revision은 포함한다. native gate/SP와 모든 writer가 외부 transaction을 유지하고 implicit commit하지 않는지 반드시 격리 SQL에서 검증한다.

### 보고서 전용 read context

AsyncLocalStorage에 `{queryFn,bypassCaches,externalEvidence,forbidExternalIO,phaseCache}`를 넣는다. scope 밖 기존 동작은 보존한다. 전역 함수/pool을 갈아끼우지 않는다. query context 안의 db.query는 원래 transaction queryFn을 사용한다. transaction writer가 db.query를 재호출하여 recursion하지 않도록 raw q를 넣는다.

확인한 직접 pool 우회 지점:

- `lib/profitTemplateDutyData.js` boundedQuery: context query 분기, timeout/limit 의미 유지.
- `lib/profitAverageData.js` read: context query 분기, 150000행 limit 유지.

확인한 공유 캐시:

- `lib/profitReport.js`: `_fifoWeekEvidenceCache`, `_fifoRateContextCache`.
- `lib/profitTemplateDutyData.js`: 연도별 TTL cache.
- `lib/profitAverageData.js`: WeakMap cache, unchangedSources.
- 외부 원천 `lib/kcsTaxableRate.js`의 HTTP/TTL cache는 아래 캡처/replay로 격리.

위 캐시는 context phase마다 새 Map을 사용한다. before 계산이 after에 재사용되면 안 된다. 함수 로컬 Map은 호출단위로 이미 격리되지만 report phase를 넘어 공유하지 않는다. category override 파일과 정적 정책 hash도 승인 digest에 포함한다. loadReportData 내부의 catch가 DB 실패를 빈값으로 바꾸는 경로는 context에서 검산불가로 실패하도록 검증한다.

### KCS 네트워크 증거 캡처

`taxableExchangeRate.fetchKcsTaxableRate` 외에 `profitAverageData`가 `getKcsTaxableRate`를 직접 호출한다. 따라서 `kcsTaxableRate.js` public 함수의 context wrapper에서 원시 `(currency,declarationDate)` 응답을 캡처/replay한다. 가중평균 결과 자체를 고정하지 않는다. 입고 TPrice 변경이 날짜별 가중치를 바꿀 수 있기 때문이다.

트랜잭션 밖 읽기 단계에서 필요한 원시 응답을 캡처한다. rehearsal에 미캡처 key가 나타나면 key 집합을 기록하고 rollback한 뒤 외부 조회로 보완하여 rehearsal을 반복한다. pending key를 오류 또는 missing으로 위장하여 보고서를 승인하지 않는다. available=false 원천실패도 실제 근거로 저장하고 기존 감사에 반영한다. commit은 승인된 응답 map만 replay하며 새 key/분류정책 변경 시 미리보기를 갱신한다. 잠금 transaction 안에서는 네트워크 호출 0이다.

### 공유 입력 형태 (구현에서 정규화 명칭 조정 가능, 의미는 고정)

```js
matching = {
  rows: /* 기존 날짜별 최종분배 계약 */,
  receiptMappings: [{ sourceWdetailKey, targetRowIndex, sourceQuantity, targetQuantity }],
  farmGroups: [{ shipmentKey, prodKey, assignments: [{ farmKey, quantity }] }],
  financial: {
    acknowledged: true, reason, expectedDigest,
    costInputs: [{
      kind: 'INVOICE' /* 또는 FREIGHT */, sourceKey, expectedRevision, input,
      lineMappings: [{ sourceLineId, targetRowIndex, quantity }]
    }]
  }
}
```

source/target quantity는 각각의 명시 단위와 환산검증을 함께 가진다. receipt many→one/one→many를 허용하며 원본 lineId별 수량 총계가 최종 입고 환산수량과 일치해야 한다. EXISTING_NL/CN/TH의 여러 invoice line→하나 receipt행 집계를 보존한다. source line 분할이면 새 corrected document line UUID를 만들고 parentLineId/원본 source를 감사한다. 제거된 역사 FK 입고행을 삭제할 수 없으면 실제 ClassWarehouseDetail.Update의 0수량 행 유지 정책을 사용하고 현행 cost mapping에서는 배제한다. 이에 따라 reader의 전체 row snapshot과 실제 native 0행 동작을 fixture로 검증한다. 가짜 0 주문을 생성하지 않는다.

검증 담당이 새로 확인한 운영 SELECT 근거: `.verify/linked-schema-probe.json`, 실제 invoice 연결 7662/41-02(146 lines, EXISTING_NL), 7671/42-01(64 lines, EXISTING_CN), 7345/38-01(19 lines, EXISTING_TH), 모두 LINK_EXISTING_COST 및 saved input 존재. 활성 손익확정본은 운영 표본에서 없으므로 반드시 격리 SQL에 활성본을 만들어 양성검증한다. fresh CLI `ClassShipmentFarm.cs`, `ClassWarehouseDetail.cs`는 검증 담당 산출물이다.
