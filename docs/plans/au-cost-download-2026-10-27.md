# 호주 기존 입고 원가 다운로드 진입

## 기준·부작용
- 업로드 문서의 승인/입고 연결과 별개로 기존 입고 계산본을 조회·다운로드한다. 문서를 연결 완료 또는 승인 완료로 만들지 않는다.
- 연도/세부차수/송장번호가 같은 입고만 표시하고 여러 농장은 사용자가 선택한다. 현재 초안의 미저장 수량을 DB 원가에 섞지 않는다.
- 기존 native-cost SELECT/지문 재검증/국가별 공식/미승인 XLSX 경로 재사용. Warehouse/Stock/Order/Shipment/Estimate/WebProfitReport/웹 승인원가 모두 보존. 새 저장 API 없음.
- 조회번호 누락이면 비활성 및 이유 표시. 기본 scope는 선택 문서. 문서/차수 전환은 기존 후보와 계산 상태 폐기.
- 페이지 스크롤·기본 button 키보드 조작 적용. 새 메뉴/shell 해당 없음.

## 근거
- 실제 dnSpy ExcelLoadingPackingList 재실행: BOX/BUNCH/STEAM 독립, uspCreateWarehouse→uspStockCalculation. 이번 조회/다운로드에서 호출하지 않음.
- SELECT 2026/44-01/41002: Warehouse7863 Premium Greens, 상품11+중량2행. Red Tip 120단×8.5와 저장TPrice5100 불일치(산술1020). 운영보정 금지, 담당자 확인 질문 전달. 계산본도 불일치를 무시하지 않는다.
- 기존 prepareInvoiceCostOnly는 NL/CN/TH만 지원하여 AU에서 원가 패널이 숨겨짐. 기존 승인 연결 가드를 완화하지 않고 별도 조회 전용 진입 제공.

## 검증
- 같은 송장 전년도/다른 차수/다른 송장 제외, 동일송장 복수농장 명시선택, 빈값 거절.
- 기존 nativeCost 10개 국가공식 XLSX/미승인표시/원장쓰기금지/변조지문 검증 유지.
- 완료 결과는 세션 문서에 기록.

## 사용자 확인 및 native 금액 기준 정정
- 사용자가 입고관리 출하단가5100이 맞음을 확인. 1020으로 보정하지 않는다.
- pages/incoming.js 출하단가=총액, /api/warehouse/[id] 총액=wd.TPrice. 실제 dnSpy FormWarehouseView.GetDetail은 UPrice/TPrice 별도 SELECT. ExcelLoadingPackingList K/L열을 별도로 저장하며 단수 곱으로 재계산하지 않는다.
- AU 기존 입고 계산본만 저장 TPrice를 권위로 단당 계산값=TPrice/BunchQuantity. Red Tip은5100/120=42.5. 저장UPrice8.5를 nativeStoredUnitPrice로 보존하고 UI 및 엑셀에 환산 기준 표시. 신규 인보이스/확정 원가 경로·원장 쓰기·golden 수식 변경 없음.
- 실제 입고 Red Tip SteamOf1Box30과 실제4박스/120단/600송이를 확인. AU 계산 입력의 단/박스=120/4=30, 송이/단=600/120=5를 실제 수량으로 산출한다. 원장 포장필드 및 원시 수량을 수정하지 않는다. 전체11품목 같은 기준 검산, TEST_ONLY AUD환율1000·통관10000·관세0으로 XLSX 생성, 상품총액24523.75/Red5100 유지·원장 지문 전후 동일.
