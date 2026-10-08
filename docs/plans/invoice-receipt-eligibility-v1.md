# 인보이스 입고 eligibility V1 — 2026-10-08

실제 입고 writer를 연결하기 전 공통 사전검사를 구현한다. 이 단계는 SELECT 전용이며
저장 권한이나 stock gate 획득, ERP 등록 성공을 의미하지 않는다.

## 근거

실행: `dnSpy.Console.exe --no-color -t CommonLogic "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
CommonLogic.CheckFixSave → GetProductListFixStatus / GetBeforeOrderYearWeek /
GetNextOrderYearWeek 확인. 저장된 decompile ExcelLoadingPackingList.CheckData도 대조.
현재 운영 스키마/SP 근거는 `diagnostics/2026-10-08-invoice-receipt-live-evidence.json`.

CheckData의 품종 조회는 INNER JOIN Product 뒤 `ISNULL(p.ProdKey,0)=0`을 요구하므로
정상 양수 품목키에 대해 CheckFixSave 루프가 실행되지 않을 수 있다. 웹은 이 결함을
재현하지 않고 CommonLogic의 의도된 검사를 명시 적용한다. EXE 자체를 수정하지 않는다.
CommonLogic의 조회 예외를 0건으로 삼는 동작도 복제하지 않고 조회실패를 차단한다.

## 기준 ledger

| 기준 | 원천 | 소비자/처리 |
|---|---|---|
| 연도·세부차수 | 명시 입력 | 4자리 연도/01~53,01~99 세부차수. 현재연도 추정 없음 |
| 2026 이전 | 실제 usp_StockCalculation 제한 | 등록용 검사 거부; 과거 읽기 조회를 막는 정책 아님 |
| 품목/품종 | 요청 ProdKey를 활성 Product(isDeleted=0)에서 재조회 | 요청 CountryFlower 신뢰 금지, 미존재/중복/빈품종은 차단 |
| 전/후 차수 | StockMaster.OrderYearWeek TOP1 < 또는 > | 달력 +/-1 아님. 연도 경계 포함 실제 가장 가까운 기존 차수 |
| 확정 | ViewShipment.DetailFix, ISNULL(NULL,0) | 현재=1 차단, 직전=0 차단, 직후=1 차단 |
| 범위 | ViewShipment.OrderYearWeek2 + CountryFlower | 수량>0/CustKey/ShipmentMaster.isFix/ProdKey 추가필터 금지 |
| 품종 범위 | 선택 품목이 속한 전체 CountryFlower | 같은 품종 다른 품목도 검사의 대상 |
| 조회 실패 | SQL 결과/오류 | 누락을 0으로 바꾸지 않음, 실패는 예외 |
| 결과 | canProceed + blockers | 미리보기와 향후 트랜잭션 재검증 공통 함수. 저장허가 토큰 아님 |

## 부작용

SELECT 검사: Product/StockMaster/ViewShipment 읽기만. 문서·주문·입고·출고·견적·재고·
채번·공용 임시입고·잠금·원가 모두 보존. 런타임 DDL/SP/자동확정해제 없음.
향후 writer는 stock gate와 원장 잠금을 확보한 같은 트랜잭션에서 이 함수를 다시 호출해야 한다.
단독 검사 성공으로 EXE와의 동시성/입고 원자성 검증이 완료됐다고 표시하지 않는다.

API `POST /api/import/receipts/eligibility`는 키 목록을 전달하는 읽기 요청이다.
서버 인증 후 기존 입고 담당 범위(관리자/수입부)만 허용하고 비활성 계정을 차단한다.
입력: orderYear, orderWeek, prodKeys(양수 정수, 최대1000개).
성공 응답은 조회 성공이며 eligibility.canProceed와 별개다. 항상
commitAvailable=false, erpWritePerformed=false. SQL 실패는503, 잘못된 입력400,
비허용계정403. SQL 내부 상세는 응답하지 않는다. 요청 actor/category/권한은 사용하지 않는다.
아직 화면·실제 등록 API에 연결하지 않으며 기존 입고 POST를 변경하지 않는다.

## 검증

순수 정책 + 실제 loopback SQL fixture: 정상, 현재확정, 전미확정, 후확정,
DetailFix NULL/0/1/2, 0수량/다른거래처, 같은 품종 다른품목, 다른품종,
연도경계 및 전년도 동일차수, 불연속 StockMaster, 빈 이웃, 삭제/NULL삭제 품목,
조회 실패/불완전 결과. 공용 staging와 원장 sentinel 보존.
