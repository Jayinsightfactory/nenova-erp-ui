# 인보이스 독립 도착원가 계산·다운로드

## 사용자 요청
- 기존 전산 입고 연결 미지원 알림 때문에 원가 다운로드를 못 함.
- 기존 입고/원가 자료 다운로드와 별도로, 인보이스 업로드 후 원가 생성·엑셀 다운로드가 있어야 함.

## 원인·결정
- 기존 prepareInvoiceCostOnly는 입고 연결 또는 COMMITTED가 필수이며 native 연결은 NL/CN/TH만 허용. AU를 강제COMMITTED하거나 입고 재등록하여 우회하면 안 됨.
- 별도 Product SELECT-only endpoint로 업로드 초안→품목/원문 검증→기존 원가식 계산→미승인 엑셀. 초안 저장·입고연결·재고SP·승인원가 쓰기 없음.
- 원가 탭에서 업로드 인보이스/기존 입고·승인원가 선택. 업로드 시작→매칭→다음 도착원가 준비. 기존 입고 단계 오류는 인보이스 계산 화면에서 분리.
- 매칭·수량·분류·국가·원가공식 검증 유지. 원가 계산에 불필요한 ERP FarmKey/헤더 저장제약만 제외. 날짜·운송 직접 수정 가능. 입력 변경/품목 변경/다운로드 생성중 변경은 지문으로 차단.
- 기존 AU TPrice5100/120=42.5 계산은 native 경로에서 보존. 인보이스 경로는 원문 단위·단가·금액 검산하며 5100을1020으로 고치지 않음. 출처가 다르면 각각 별도 계산본, 운영 입고 불변.

## EXE·실측
- 실제 dnSpy.Console ExcelLoadingPackingList 재실행: UPrice/TPrice 별도복사, InsertMaster→uspCreateWarehouse/uspStockCalculation 확인. 신규 경로는 둘 다 호출 없음.
- 기존 readonly7863 재확인: RedTip Bunch120/Steam600/UPrice8.5/TPrice5100, 상품총액24523.75. 기존native TEST_ONLY계산/다운로드 후 source hash 동일.

## 검증
- 국가별 등록된 모든 공식·템플릿 신규 인보이스 미승인 XLSX 및 native/승인 guard 회귀 통과. 신규/기존입고상태/연도·국가·품목·원문·단위·미입력·stale·권한·생성중 변경 시험 포함.
- 격리Chrome19846 실제 InvoiceDraftCost/InvoiceReceiptCostReview 및 실제 endpoint handler 사용. Product만fixture, 운영 DB 연결 없음.
- Woolly Green180단/1530AUD,Red120단/1020AUD **원문경로 시험자료**. FX1000/통관10000/관세0 TEST_ONLY 입력→합계2560000→다운로드 파일 생성·셀 확인. 실제입고5100 기준으로 승인한 결과가 아님.
- 미매칭 Red행으로 변경하면 행번호/품명/수정사유 표시 및 다운로드 차단 확인. 입고 연결 API/원가승인 API 호출 없음.
- 로컬 전체 ERP 계약·dnSpy guard·manifest·write guard·webpack 통과. 최종 증분검증/PR CI·배포 후 결과는 아래 기록 예정.

## 보존/남은 확인
- 운영 Warehouse/Stock/Order/Shipment/Estimate/손익/승인 원가 변경 없음. nenova.exe 변경 없음. AI 유료 분석 없음.
- 운영 실제 인보이스 업로드/저장 테스트는 하지 않음. 운영에서는 메뉴/배포버전 읽기만 확인.
- 검색어: invoice-cost-independent INVOICE_PREVIEW PREVIEW_ONLY Product SELECT 인보이스 계산본 기존입고 미지원
