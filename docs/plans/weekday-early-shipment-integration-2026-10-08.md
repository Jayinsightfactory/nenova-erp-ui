# 주광 선출고 분배·재고 연동 설계 (2026-10-08)

상태: 설계 계약. 이 문서는 구현 완료나 운영 데이터 변경을 의미하지 않는다.

## 사용자 동작과 범위

선출고는 실제 업체·품목·단위에 대해 원천 **큰 차수**에서 대상 **다음 큰 차수**의 물량을 먼저 출고하는 업무다. UI에는 40→41처럼 큰 차수만 선택한다. 실제 출고 날짜는 원천 화면의 목~수 날짜 중 하나를 명시한다. 업무키는 연도를 포함한다. 2026/40과 2025/40은 다른 원장이다. 연말의 다음 차수도 전산 달력의 날짜 순서로 해석하며 53차 등을 만들어내지 않는다.

사용자가 미리보기에서 수량·날짜·원천 +재고·대상 -재고·분배 증가·확정 처리 범위를 확인하고 **선출고 적용**을 눌렀을 때만 저장한다. 기존 페이지 비고의 `MANUAL_USER_DECLARATION`은 참고 정보이며 처리 실적이 아니다. 기존 비고를 자동으로 원장에 적용하거나 업로드에서 차감하지 않는다.

## 읽기 근거

- `output/early-shipment-integration/FormStockAdd.txt`: `btnSave_Click`은 사용자 입력 증감량을 현재 Product.Stock에 더해 StockHistory BeforeValue/AfterValue를 작성한다. `ColumName='수량'`, 선택한 실제 OrderYear/OrderWeek, 로그인 사용자와 비고를 사용한다.
- `output/early-shipment-integration/ClassStockHistory.txt`: `Insert()`는 StockHistory를 생성하고 `ProductStockUpdate()`는 이름과 달리 **Product.Stock**을 `ROUND(AfterValue,2)`로 갱신한다. 이 메서드를 ProductStock 스냅샷 갱신으로 오해하지 않는다.
- `output/early-shipment-integration/probe.jsonl`: 읽기 전용 schema 39행, 달력 21행, 출고 6행, 스냅샷 15행, 이력 유형 8행, SP 3개 근거. PeriodDay에는 큰 차수와 날짜가 있으나 StockHistory/StockMaster의 실제 업무차수는 별도 검증해야 한다.
- 같은 probe의 `usp_StockCalculation`: StockMaster가 없으면 생성하고 `OrderYearWeek >= 시작차수`의 현재·후속연도 스냅샷을 순회한다. 입고 + 확정출고(DetailFix=1) 차감 + CodeInfo StockType에 연결되는 StockHistory의 `AfterValue-BeforeValue`를 반영한다. 재고는 두 자리 반올림이다. **Product.Stock을 갱신하는 SP라고 가정하지 않는다.**
- `usp_ShipmentFix`/`usp_ShipmentFixCancel`은 확정 상세를 기준으로 Product.Stock과 출고 이력을 바꾼다. native gate owner V2와 트랜잭션·출력 결과를 사용한다.
- `lib/weekdayDistributionApply.js`: 단일 tQ executor에서 gate→idempotent operation→lease→fresh snapshot→분배 projection/write→native 재계산→전량 readback→guard/audit를 수행하는 재사용 근거다.
- `lib/shipmentImport.js`: uploadQty는 최종 절대값이며 `shipmentDiffQty=uploadQty-currentOutQty`다.

`docs/CODEX_SUBTASK_ORCHESTRATION.md`는 현재 checkout에 없다. 이 작업의 직접 지시와 AGENTS의 외부 쓰기 분담을 따른다. main이 native/DB preflight를 준비했고 본 설계 작업은 SQL/API 쓰기를 수행하지 않았다.

## 재고·분배 의미

q는 양수 선출고 분류량이다. 원천 큰 차수에 StockHistory **+q**, 대상 큰 차수에 **-q**를 연결 기록한다. 원천 실제 날짜 분배는 사용자가 확인한 **최종 절대수량**으로 적용한다. 이미 분배된 물량의 선출고 분류라면 분배 변경은0이며 q를 다시 더하지 않는다. 새 물량 입력을 함께 적용할 때도 날짜 최종값과 기존값의 차이만 쓴다. q는 최종 날짜량 이하이고 동일 날짜의 활성 선출고 분류 누계가 최종량을 넘을 수 없다. 가능한 초과분/적자에 대한 별도 cap도 preview 근거로 검증한다. 분배가 확정되면 native 출고 차감이 별도로 발생한다. 조정쌍 합계가0이라고 선출고 분배까지 재고 영향0으로 간주하지 않는다.

예: 대상 원문 총량10, 선출고3, 대상 기존분배2. 원천에 +3 조정 및 실제 분배3(확정 시 -3), 대상에 -3 조정, 업로드 대상 최종량은7이며 기존2에 대한 저장 delta는+5다. `10-3-2=5`를 최종량으로 저장하면 이중 차감 오류다. 원천 확정3과 대상 확정7은 총 출고10이다. 대상 스냅샷에서는 원천 조정+3과 대상 조정-3의 누적 효과가 상쇄되고 실제 원천 출고3이 남는다.

## 최소 구조와 데이터 계약

MSSQL에 새 linked ledger를 둔다. 파일/localStorage만으로 ERP 처리 실적을 판정하지 않는다. 제안 테이블명 `WebEarlyShipmentOperation`, `WebEarlyShipmentRevision`, `WebEarlyShipmentEffect`는 구현 전 schema migration 계약으로 확정한다.

- operationId(UUID), requestHash, actor, 입력 이유, sourceYear/sourceMajorWeek, targetYear/targetMajorWeek, custKey, prodKey, unit, quantity, sourceDate, revision.
- 서버 검증으로 결정한 sourceDistributionYear/sourceOrderWeek, sourceStockAnchorYear/sourceStockAnchorWeek, targetStockAnchorYear/targetStockAnchorWeek. 클라이언트가 숨은 세부차수를 임의 선택하지 않는다.
- 원본 quantity, nativeOutQuantity와 포장계수/정규화 단위 snapshot, 업무키별 beforeDigest, before/after 날짜 분배, 변경 전후 확정 상태, 순수 재고 영향. `allocationIntent=MARK_EXISTING|APPLY_ABSOLUTE`, sourceDateBefore/sourceDateFinal/sourceDateDelta 및 분류된 subset q를 구분한다.
- 각 effect의 StockHistoryKey, shipment/detail/date 업무키 및 PK, native gate/감사 operation 참조. Description 문자열만으로 중복 여부를 판단하지 않는다.
- operation 상태 PREVIEW(쓰기 없음), APPLIED, REVERSED. 트랜잭션 중 PENDING은 외부에 성공으로 노출하지 않는다. 실패 응답은 ROLLED_BACK이며 business effect가 0임을 나타낸다. 별도 실패감사는 rollback 이후 선택적으로 기록하되 적용 실적으로 계산하지 않는다.
- expectedRevision과 requestHash CAS. 같은 UUID/같은 요청은 저장 결과 replay, 같은 UUID/다른 요청은409. 동일 업무 물량의 다른 UUID 재등록은 preview에서 기존 처리량을 보여주고 명시적 추가 의도가 있을 때만 허용한다.

큰 차수→실제 stock anchor는 해당 큰 차수의 **검증된 전산 달력·기존 업무차수 목록**에서 날짜순 최초 세부업무차수로 서버 결정한다. sourceDate의 분배 업무차수는 실제 달력/저장 업무키로 따로 결정한다. 큰 차수만인 PeriodDay.OrderWeek에 `-01`을 무조건 붙이지 않는다. 달력 누락/중복/연도 불일치/anchor 없음은 미리보기 차단이다. native 재계산은 두 anchor가 실제 StockMaster에 포함되는 것을 확인하고 가장 이른 source anchor부터 target 이후까지 계산한다. target StockMaster가 없다면 native로 target materialization 후 source부터 재계산하는 순서를 같은 트랜잭션 안에서 검증한다. 임의 0 StockMaster/ProductStock을 만들어 덮어쓰지 않는다.

## 원자적 provider와 재사용 제한

새 provider는 **단일 withTransaction의 tQ**를 받는다. 내부에서 HTTP로 stock/adjust-batch와 weekday-apply를 차례로 호출하지 않는다. 각각 commit되는 API 조합은 부분 적용 위험이 있다.

1. 인증된 서버 actor, 이유, 양수 finite 수량, 실제 active 업체/품목, 정확한 연도·달력 및 인접 큰 차수 검증.
2. gate owner V2를 ERP 행 lock 전에 획득하고 원천/대상/품목의 edit lease를 결정 순서로 획득. ledger operation/CAS 및 관련 ERP·재고·포장·확정 범위를 fresh lock/read.
3. 원천 날짜를 요청의 최종 절대값으로 projection하고 이미 있는 q는 추가하지 않는다. MARK_EXISTING이면 정확한 현재값을 보존하는 no-op 분배도 ledger 저장을 허용한다. 기존 주문 존재 시 보존, 없을 때 양수 분배 증가에만 양수 주문 생성, CANCEL/역처리는 주문 보존. 일반 ALLOCATION의 절대값 의미는 그대로 유지한다.
4. source +q 조정을 **engine operation reservation/source lease 이후, preparePlans 이전** trusted server-only `beforePrepare` hook에서 기록·live 적용·native 계산한다. 이후 engine은 +q가 반영된 live 재고를 기준으로 가용성 및 fixed 출고delta를 검증한다. engine 결과 후 target -q 조정을 동일 outer tQ에서 기록·live 적용한다. 양쪽 effect와 operation은 같은 최종 commit에 속한다. ChangeType은 native 재계산이 읽는 검증된 `재고조정`을 사용하며 CodeInfo 중복/미지원이면 차단. source+q와 target-q를 engine앞에 동시에 넣으면 live allowance가 상쇄되어 부족검사가 오작동하므로 금지한다. 스냅샷과 live 재고는 별도 readback한다.
5. 확정된 날짜 분배 변경은 검증된 기존 fixed 수량 변경 provider 또는 native cancel→변경→원래 범위만 재확정 방식을 사용한다. 미확정은 자동 확정하지 않는다. 원천·대상 무관 품목/업체의 확정상태 보존, 범주 SP가 바꾸는 범위까지 감사·검증한다. 둘을 중복 실행해 출고 차감하지 않는다.
6. target -q 이후 가장 이른 영향 anchor부터 native 재계산. **inner engine의 재고 검증은 target debit 전의 임시 상태라 최종 승인 근거로 사용하지 않는다.** outer provider에서 SP returnCode와 @oResult/@oMessage, 전체 affected current/future ProductStock `ROUND(Stock,3)<0`, Product.Stock 및 native 저장 정밀도를 다시 검증한다. 후속 스냅샷 존재 자체로 차단하지 않는다.
7. 조정쌍 각각의 증감량, 원천 날짜/총분배 증가, 주문 보존/생성, 금액·VAT·단가·DetailFix, target 원장 및 downstream을 readback 후 audit/operation APPLIED. 어느 단계든 실패하면 전체 rollback한다.

`executeWeekdayDistributionApply`를 wrapper 안에서 그냥 두 번 실행하면 gate/lease/operation/최종 재고 검증이 중복되고 조정쌍 때문에 기존 verifyFinalProductStock의 기대값이 바뀐다. 기존 native-safe 순수 projection/read/write 함수를 추출하거나 새 명시 mode/provider에 pair effect를 포함해야 한다. 기존 모드의 정책은 변경하지 않는다. `stock/adjust-batch`의 HISTORICAL_STOCK_EDIT_BLOCKED를 새 기능에 복사하면 source40→target41 존재 때문에 기능이 성립하지 않으므로 직접 API 재사용은 금지한다.

최소 재사용 대안은 단일 engine 호출과 trusted hook을 위 순서로 감싸는 outer provider다. target lease와 gate는 hook 전부터 보유한다. beforePrepare는 클라이언트 전달 불가이며 기존 호출에는 absent/no-op이다. wrapper ledger와 engine operation UUID/hash를 연결한다. ledger APPLIED는 전체 response replay이며 hook을 다시 실행하지 않는다. engine audit만 존재하고 linked ledger가 없으면 standalone 작업과 충돌한 것으로409 처리하여 조정만 다시 쓰지 않는다. 현재 snapshot digest의 product에는 단위/포장계수만 포함되고 Stock은 없으나, 분배 digest 및 별도 locked live 재고는 hook 전후 보존·검증해야 한다. engine audit의 성공도 outer commit 전에는 처리완료가 아니다.

단위는 ERP OutUnit과 재고 원천 단위가 일치해야 한다. 확인된 양수 포장계수만 환산하고, 반올림 손실은 조용히 수용하지 않는다. decimal 서버계산·native ROUND(2) 재현과 정확한 conversion/readback을 계약 테스트한다. NULL/UNKNOWN을0으로 변환하지 않는다.

## 업로드 연동

업체·품목·단위·**targetYear+targetMajorWeek**의 APPLIED 잔여 실적만 qExcluded에 합산한다. source와 target의 연도를 모두 보존하고 역처리된 실적은 제외한다. 기존 참고 비고·미적용 초안·다른 업체·다른 연도·다른 target은 계산하지 않는다.

미리보기에는 원문 O, 기존 대상 E, 처리 선출고 Q, 최종 F=O-Q, 적용 차이 D=F-E를 함께 표시한다. 동일 파일 재업로드나 재검증도 원문 O에서 계산하며 이미 줄어든 F에서 다시 Q를 빼지 않는다. 원문 total에 선출고 포함인지 명시된 upload mode/column provenance를 유지한다. 이미 제외된 export/파일은 별도 명시 provenance 없이는 자동 차감하지 않고 확인을 요구한다. F<0·단위 충돌·target 세부차수 선택 모호성은 차단한다.

같은 target 큰 차수에 -01/-02 입력이 모두 있으면 Q를 각 행에서 두 번 빼지 않는다. 최소 구현은 서버가 target의 검증된 첫 stock/business anchor를 `TargetImportWeek`로 고정하여 ledger에 저장하는 방법이다. UI에서 사용자는 여전히 큰 차수만 선택한다. 기존 업로드의 실제 year/week를 서버 검증하고 **원문 포함 모드이며 selectedUploadYear/week가 TargetImportYear/week와 일치할 때만** Q를 차감한다. 같은 target 큰 차수의 다른 세부차수 업로드에는 처리 Q를 참고 표시하되 실제 차감은0이고 이유를 표시한다. 재업로드에는 원문을 기준으로 같은 F를 재계산하므로 Q를 누적 소비하거나 적용 완료를 이유로 다시0으로 바꾸지 않는다.

전체 큰 차수 파일이면 원문 총량 O와 target anchor bucket을 명시적으로 연결한 경우에만 이 규칙을 적용한다. O가 여러 세부차수에 배분된 파일이나 Q가 특정 비anchor 칸에 포함된 파일은 anchor로 임의 이동/비례배분하지 않고 preview에서 모호성을 차단한다. 따라서 미리보기에는 `processedEarlyTotal`과 이번 행의 `earlyExcludedApplied`를 별도 표시한다. 기본 모드는 사용자 합의 예시의 ORIGINAL_INCLUDES_EARLY이며 ALREADY_EXCLUDED를 명시 선택할 수 있다. 미매칭 선출고 원문 열을 사용자가 제외하여 정상 수량 O에 이미 포함되지 않았다면 ALREADY_EXCLUDED로 처리한다. raw 제외열 합계는 실제업체 연결·단위·품목을 신뢰할 수 있을 때만 참고 metadata로 표시하고 ledger의 처리실적으로 바꾸지 않는다. 선택하지 않은 모호한 업체열로 업체를 추정하지 않는다.

fullCategoryReplacement의 원래 실제업체/품목 누락→0 계약은 보존한다. 선출고 원문 열 제외 선택은 ledger 실적 등록과 별개다.

## 수정·취소 및 원장 동기화

배포 구현은 신규 적용과 분류 취소를 제공한다. 분류 취소는 revision CAS와 저장 후 원천 snapshot 검증을 거쳐 원천 -q/대상 +q 보상조정, native 재계산을 수행하고 REVERSED로 기록한다. 기존 StockHistory는 편집/삭제하지 않는다. **MARK_EXISTING 및 APPLY_ABSOLUTE 모두 분류 취소는 기존 원천 분배를 보존한다.** 실제 날짜 수량 수정·취소는 기존 ALLOCATION 흐름을 사용한다. 활성 선출고 분류량 이하로 줄이는 일반 날짜 수정은 분류를 먼저 해제하도록 차단한다. 연결 분배가 EXE에서 바뀌었으면 읽기 검증에서 차단하며 자동 삭제/보정하지 않는다. 별도 단일 버튼 revision 변경 및 저장 당시 날짜 수량 복원은 이번 배포 범위에 포함하지 않는다.

현재 클라이언트와 서버 모두 실제 출고일의 기존 원장 차수를 우선한다. 예를 들어 달력상 화요일40-02라도 실제 날짜행이40-01이면40-01을 유지한다. 원천+q·대상-q 표시 보정은 이월 계산 전에 적용하여 다음 차수에 일관되게 이어진다. 동일 작업은 한 번만 반영하고 가장 높은 revision을 사용한다. 저장 결과 미확인 요청은 사용자·조회 범위별 세션 저장 후 같은 UUID로 재확인하며, 성공 또는 명시적인 롤백 외에는 복구 기록을 해제하지 않는다.

## 검증 및 UI 완료 기준

fixtures: 40→41 O10/Q3/E2→F7/D5; 기존 주문 보존/없으면 양수생성; 재시도·다른UUID추가; 전년도동일40 격리; 실제 연말달력; -01/-02 중복제외 방지; 원천+q/대상-q와 source fixed/unfixed의 live/snapshot 기대값; native target materialization 후 cascade; 미래스냅샷 음수 rollback; 각각 history/date/fix/recalc/audit 실패 전량 rollback; 정확환산/정밀도/NULL; EXE 변경 CAS; 취소/revision 원자성; upload-original/already-excluded provenance.

1920×1080 100% 및 작은 화면에서 페이지 주 세로스크롤을 사용한다. 업무표 가로스크롤은 허용한다. 실제 수량·5개 업로드 비교값·오류·수정/취소 이력은 접근 가능해야 한다. 모달 첫초점/복귀, Tab/Shift+Tab, Enter/Space, Escape, 반복후보 방향키 선택을 검증한다. 구현 전에 새로운 schema/API 계약과 migration rollback을 준비하고 ERP 필수 gate/test/build 및 운영쓰기 없는 readback 근거를 남긴다. 병합·배포·운영쓰기 및 권한 변경은 main만 수행한다.
