# 후속 재고 재계산 검증 — 기준/부작용

## 권위 근거

2026-10-22 실제 CLI 실행:
`C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormStockAdd "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"`
동일 명령 `-t ClassShipmentDetail`, `-t FormStockView` 확인.
FormStockAdd.btnSave_Click은 ClassStockHistory.Insert/ProductStockUpdate 이후 DBMSSQL.uspStockCalculation 호출.
ClassShipmentDetail.Delete는 SdetailKey의 DELETE만 수행하므로 그 호출 자체가 CALC 보장을 뜻하지 않음.
운영 SELECT에서 과거 StockHistory 반영 후 다음 ProductStock 불일치와, 과거 확정 출고 삭제 전 수량이 잔존하는 ProductStock을 확인. 상세 수치/행키는 private .verify에 보관.
SP는 선택 OrderYearWeek 이후 현재·후속연도/legacy StockMaster를 순서대로 계산한다. DB/SP/EXE 바이너리 변경 없음.

## 기준 ledger

- 명시 연도+세부차수+양수 품목키. 현재연도 추정 금지. 정상 native 프로시저는 2026 이후만 수정.
- 물량 권위: StockMaster/ProductStock, ViewWarehouse, ViewShipment.DetailFix=1, CodeInfo.StockType와 StockHistory 차이.
- 저장 원자성: 기존 외부 transaction, native 결과/returnCode/transaction/gate 검증, 후속 전체 readback, 실패 전체 rollback.
- readback: 기존 verifyInvoiceStockReadback 재사용. 현차수만 검사하거나 연도 경계에서 중단 금지. 중복/누락/산술 불일치 차단.
- 재고 목표 일괄편집의 HISTORICAL_STOCK_EDIT_BLOCKED 정책은 보존. 명시 증감 조정의 후속 재계산 보강과 혼동하지 않음.
- 일반 구형 stock-status PATCH는 확정 상세 수정 우회 금지; 기존 정상 견적/요일 확정물량 경로를 이용.
- stock-status 고객/담당자 조회는 SQL 조회 연도를 행에 보존하고 일반/피벗 저장에 전달한다. 현재연도 추정 없음. ghost 정리는 헤더 미확정이어도 상세 확정이면 사전·트랜잭션 재검증에서 거부한다.
- 구형 시작재고 직접 저장은 이력 없이 ProductStock을 덮어쓰고 같은 업무키의 StockMaster를 추가할 수 있어 차단한다. 재고관리 조정 경로로 안내하며, 시작잔고를 현재고 증감으로 임의 해석하지 않는다.
- native EXE/외부 SQL 직접 삭제까지 웹 wrapper로 보호한다고 주장하지 않음. 공유 trigger/SP 변경은 별도 승인/설계 영역.

| 동작 | 주문/입고/Estimate/WebProfitReport | 출고·날짜·농장 | StockHistory/Product.Stock | ProductStock |
|---|---|---|---|---|
| 재고조정 | 보존 | 보존 | 기존 native 증감 순서 | native CALC+후속 readback |
| 확정 출고 감소/0삭제 | 보존 | 기존 견적/요일 계약 | 기존 확정 증감 계약 | native CALC+후속 readback |
| 운영 승인 이월 보정 | 보존 | 보존 | 전부 보존, 새 상쇄조정 없음 | 승인 두 품목만 native CALC |
| 1~41 조회 검증 | 보존 | 보존 | 보존 | SELECT only |

## 운영 적용 기준

코드 배포 후 두 품목 각각 시작차수부터 native 전범위 dry plan, 원천 지문, 보호원장 hash, 명시 legacy 노드, 새 음수 없음, rollback rehearsal 및 별도 readback을 통과해야 적용한다. 41차까지만 고치고 그 이후를 stale로 두지 않는다. 기존 에콰도르 보정 재실행 금지. 다른 품목 오차는 진단만 하고 임의 보정하지 않는다.

## 검증

양수 fixture: 단건/일괄조정·확정수량0 삭제 후 후속연도 반영. 음성 fixture: native 실패, 후속 불일치, 중복/누락 snapshot, 잘못된 연도, busy/transaction loss. 관련 기존 계약 및 전체 verify:erp-change/build, CI, Cafe24/ping/hydration.
