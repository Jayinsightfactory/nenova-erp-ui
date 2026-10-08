# 주광 대차수 선출고 연동 사전 근거 — 2026-10-08

## 실제 EXE/운영 DB 읽기 확인

- EXE: `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`.
- dnSpy CLI: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormStockAdd` 및 `-t ClassStockHistory`로 해당 EXE를 새로 추출했다.
- 저장 순서: 선택한 연도·차수, ChangeType, ProdKey로 `StockHistory.BeforeValue=Product.Stock`, `AfterValue=BeforeValue+증감량`; Product.Stock을 AfterValue로 갱신한 뒤 native 재고 계산을 호출한다. 재고 값을 목표값으로 직접 덮는 기능이 아니다.
- SELECT-only probe: 원장 스키마39열, 2026-10-01~21 PeriodDay21행, 주광 Cust533/Prod359·363·1364의 40/41차 출고6행, 해당 재고15행, 이력 유형8종 및 실제 `usp_StockCalculation`/`usp_ShipmentFix`/`usp_ShipmentFixCancel` 정의3개를 확인했다. 운영 쓰기는 수행하지 않았다.
- 40-01 대상 출고는 확정, 41-01은 미확정이었다. 혼합 상태를 하나의 전체차수 bool로 추정하지 않는다. 실제 물량·단위·수량은 저장 전 최신 snapshot으로 재검증해야 한다.
- 재고 계산 SP는 `OrderYearWeek >= 선택차수`를 연도 경계 이후까지 순회한다. 현재고·선택차수 재고·후속 재고는 서로 다르다.
- 실제 계산식: 직전 재고 + `ViewWarehouse` 수량 − `ViewShipment` 확정 수량 + 해당 차수 `StockHistory.AfterValue-BeforeValue`. 재고조정 인정 유형은 `CodeInfo.Category='StockType'`와 ChangeType/Descr 조인이다. `StockType`이라는 별도 테이블을 가정하지 않는다.
- StockHistory에는 업체 FK가 없으므로 별도의 선출고 연결 원장이 업체·대차수·품목·수량과 앞/뒤 조정 이력을 묶어야 한다.

## 구현 판단

사용자 기준은 대차수 간 선출고이다. 내부 native StockHistory는 실제 세부차수 키를 요구하므로 PeriodDay에서 확인한 대차수의 목요일 anchor를 사용하며, 사용자에게 세부차수 간 선출고로 노출하지 않는다. 날짜별 분배는 기존 실제 업무키를 유지한다.

원본 업로드는 절대 최종 SET이다. 원본 환산량에서 선출고 제외량을 계산한 **최종 목표**와 현재 분배의 차이를 저장한다. 기존 분배를 원본에서 다시 빼면 재업로드 때 누적 차감되므로 금지한다.

선출고 등록의 원장 쓰기/검증은 하나의 outer transaction으로 묶고, source+q 재고 조정→기존/draft 절대 날짜 분배 저장→target−q 재고 조정→earliest source부터 native 재계산 및 모든 후속 음수 검증→연결 이력 저장 순서로 설계한다. 기확정·미확정 상태를 확인하고 확인 없는 추가 재고 보정은 하지 않는다. 이전 원문 수동 선출고 비고는 처리 완료 이력으로 자동 승격하지 않는다.

StockHistory +/− 쌍, 실제 분배, 연결 상태가 부분적으로 성공해서는 안 된다. 기존 분배를 선출고로 분류한 건을 취소할 때 원래 분배를 삭제해서는 안 된다. 재고 조정 쌍의 반대 조정과 분류 취소를 기록하며 원장 이력은 삭제하지 않는다.

상세 raw 추출물과 프로브는 git-ignored `output/early-shipment-integration/`에 남긴다. 이 문서는 실제 조회·저장 순서 근거를 요약하며 비밀값/원본 전체 운영 자료는 커밋하지 않는다.

## 견적·매출 downstream 읽기 확인

동일 2026/40·41, Cust533, Prod359·363·1364 키로 ShipmentDetail 6행의 Amount/Vat/isFix, ViewOrder7행, ViewShipment6행을 SELECT로 대조했다. 해당 키의 Estimate 직접 원장은0행이었다. 이는 원장 신규 생성이 필요하다는 뜻이 아니며 실제 EXE 견적 노출은 ViewShipment/DetailFix와 기존 인쇄 경로를 따른다. 이 작업은 Estimate 및 WebProfitReport에 직접 쓰지 않는다. 상세 조회 결과는 ignored `output/early-shipment-integration/downstream.jsonl`에만 보관한다.
