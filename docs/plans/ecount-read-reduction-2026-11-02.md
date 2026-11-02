# ECOUNT 반복 조회 감소 기준과 부작용
사용자: PC에서 반복되는 ECOUNT 작업을 줄인다. 원본 ECOUNT 조회만, 회계전표 생성/수정 없음.
근거: 운영14시117원장 순회, 각 상세 전후 PENDING2회(각2개월), 별도6종 보고서 매시간. 로컬 dnSpy ClassCustomer exit0/GetData/BusinessNumber/Manager/OrderCode 확인. SELECT-only probe 활성676, ledger7231780, 신규check0. 공유ERP SQL/권한/재고·출고·견적 변경 없음.

| 동작/기준 | 원천/소비자 | 부작용 |
|---|---|---|
| 은행 before | 기존 sanitized PENDING 완전수집; pendingReader.before <90초; exact from/to + in-memory session | 원문/계좌/이름/세션 저장 없음; after는 반드시 실제 새 조회 |
| 은행 검증 | 기존 calculatePendingReceipts | before<=detail<=after,5분,history60분/범위/불변/공식수금/중복방지 그대로. 미확인은null |
| legacy6보고서 | 기존 ecountLedgerSchedule.dueSlot 평일08/11/14 5분창 | 매시간/재시작즉시/야간 작업 제거. slot 원자기록후 조회, source serial queue |
| 연결실패 반복 | accepted LINK_CHECK_REQUIRED만 sourceCode/lookupName/query SHA256+시각으로같은한국날짜만 보류 | 기술실패는보류안함; 변경/만료/수동/성공/명시복구는재확인. 원래 UI 실패와 마지막정상본 유지 |
| 수동최신화 | 기존08–18·10분요청제한·canonical scope | 보류무시, 기존 우선순위·커서·API장애보존 유지 |
| 생략한 조회 | 원본수집 시각 보존 | 새금액/0원/가짜최신시각 생성 없음 |

월경계/교차연도 키와 explicit0 TTL/오류상태/재시작/동시요청 검증. 생략은 source identity 실패 검색과 은행중복조회에 한정. 판매/입금 전체 변경감지로 상세까지 생략하려면 E040723의 동일관계기준 전체요약 모드/필터/합계 완전성을 실제 로그인 화면에서 검증해야 하므로 미검증 구현은 배포하지 않는다.

읽기/쓰기 및 downstream: Customer/UserInfo/PeriodDay read 및 WebEcountSnapshot 기존 append 그대로. Order/ShipmentMaster/Detail/Farm/Date, Estimate, StockHistory, ProductStock, WebProfitReport 전체 preserve. 원장수식·개별기준 전환 없음.
