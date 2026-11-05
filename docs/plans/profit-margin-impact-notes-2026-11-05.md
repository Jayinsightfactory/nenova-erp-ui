# 표시 이익률·운임/재고 비고 (2026-11-05)

## 권위와 사전 근거

최신 사용자 승인: 모든 표시 이익률은 표시 J/C이며 C=0이면 공란. 과거 workbook K=J/(C+F)는 원본 근거로 보존하고 웹 표시 정책만 대체한다. 저장된 C/J/E/F 등 금액·revision·payload·DB는 변경하지 않는다.

실행: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe --no-color -t FormStockView "C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe"` 정상 종료. GetData는 StockMaster→ProductStock, 전차수키, ViewWarehouse/ViewShipment 별도 합산과 StockHistory.AfterValue−BeforeValue, CodeInfo.Category=StockType/Descr=ChangeType를 사용한다. 상세 이력도 After−Before를 별도 표시한다. 이 변경은 SP/저장 이벤트를 호출하지 않는다.

실제 SELECT probe: WebColombiaWeekly 2026/31-01 저장 GW/CW3342/3342 확인. WarehouseMaster 헤더 양수 중량은0행이므로 헤더만으로 입고GW를 추측하지 않는다. 기존 loadWarehouseGw의 전표 중량행 해석을 그대로 사용한다. StockHistory2026/31 StockType 이력 존재 확인(공개 fixture는 합성값). 인증정보·개인정보 출력 없음. `scripts/probe-profit-margin-notes.cjs` SELECT만 사용한다.

추가 실제 실행: `loadWarehouseGw('31','2026',{reportWeightEvidence:true})`가 기존 입고 전표 중량행 해석으로 GW1420/CW3342를 재확인했다. 저장3342/3342를 입고1420/3342로 읽기 선택하는 기존 정책을 유지한다. 신규 조정조회 SQL 실제 실행52행, exact WebStockPriceEvidence평가가격0행 확인. 정확가격이 없으면 적용된 보고서의 같은 연도·대차수·분류·물리단위환산과 일치하는 평균원가만 **보고서 평균원가 기준 조정평가액**으로 표기하며 역사적 실제 금액이나 이익추가로 주장하지 않는다.

부모의 실제 SELECT 전체차수 감사: 2026년01~44 저장본44개와 활성확정0개. 표시 K외 금액·원본 JSON불변 통과. 26~44 합계 비율이 J/C로 변경, 01~25는 기존값 유지(빈값 포함). 45~53은 저장본 없음이며 검증 완료 차수로 세지 않는다. 이 감사는 raw 저장본 범위이고 templateDuty최신 투영·운임/재고 비고·실브라우저는 별도 검증이다.

## 기준/부작용표

| 동작/기준 | 정책 | 원장 부작용 |
|---|---|---|
| 본표·저장본·확정본·월별·XLSX·인쇄 K | displayProfitCalc가 J/C만 복사 적용; C/J 원본 보존; 0/null C→null | 없음 |
| 콜롬비아 배분 | 기존 computeColombiaAllocation/resolveColombiaWeight/profile사용. 같은 연도/세부차수, 유효GW/CW,실제운임,박스,적용요율 근거만 비교 | 없음 |
| 과거 배분 메타데이터 없음 | 현재 SELECT 원천 참고임을 명시. 본표T와 일치하지 않으면 J효과 계산하지 않음 | 없음 |
| 반대기준 비교 | 실제배분−같은운임 반대비율 비교. H는 항상무게 유지. 세부차수별 비교 후 품종 합산 | 없음 |
| 이익효과 | 증빙된 카테고리평균의 재고유보율 반영. 원가인식/수기override/불완전 근거면 확인필요. 운임차와 재고효과를 이중 가산하지 않음 | 없음 |
| 실제 조정 | CodeInfo StockType에 해당하는 이력만 After−Before; OutUnit 그대로, 동일품목/연도/세부차수 검증가격을 명시환산 후 평가 | 없음 |
| 전기말→당기초/당기말→차기초 | 인접 확정/저장본만 읽음. 재고평가액 차이를 StockHistory조정이라고 부르지 않음. 없는 근거 역산금지 | 없음 |
| 수기비고 | 기존입력/저장경로보존; 시스템금융비고는 별도 표시·출력만 | 없음 |

OrderMaster/Detail, ShipmentMaster/Detail(Amount/Vat/isFix/OutQuantity 포함), ShipmentDate/Farm, Warehouse, ProductStock/StockHistory, Estimate, WebProfitReport 및 모든 확정/저장본 보존. 기존 수기비고 저장은 기존 별도 사용자동작으로만 수행된다. 이번 작업은 GET 조회/표시/출력 뿐이다.

기본메뉴 기준: 기존표/비고확장·페이지스크롤·텍스트접근성 적용. 새메뉴/탭/업무순서 변경 없음→새 가이드영상 해당없음. ERP쓰기/파일업로드/초안변경도 해당없음. 최종 실브라우저/배포 검증은 별도 기록한다.
