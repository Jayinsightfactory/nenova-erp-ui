# 최신 원가 참고 표시 통합

## 요청/답변
- 모든 최신 참고 영역을 승인 인보이스 원가에 연결. 과거 확정 원가·매입액·손익·재고는 보존.
- 적용: 도착원가 본표/호텔 기존 승인 조회 + 카탈로그·물량/전산 피벗 공용 최신 조회. 입고·운송원가·손익 재고평가 상세에는 최신 참고를 별도로 표시.
- 예외: 당시 실제 입고 원가, 원가 계산기/다운로드, 과거 손익·재고 평가·저장 매입단가를 최신값으로 바꾸지 않는다. 카탈로그 명시 업로드 override는 보존.
- 인보이스 승인·현문서/operation/live receipt 대조·TEST_ONLY 제외 유지. 기존 현재 엑셀 근거도 유지하며 출처를 구별.

## 검증
- 실제 dnSpy FormWarehouseView, SELECT-only 운영 probe. 현재 엑셀10,592행/승인ACTUAL3revision.
- 공용 loader 153품목→최신178근거 중122인보이스. 2025동일품목은2026값 혼입없음.
- 격리 CUA 실제 읽기: 품목667 41-1 7687.16원/단→768.72원/송이, 잘못된단위 안내, 2025연결없음. 보호 fixture의 확정1200/매입9000/이익1000/재고10 유지.
- 전체 ERP 계약·dnSpy·manifest/write guard 및 webpack빌드 통과. 마지막 수정 재검사·PR·배포·운영 UI는 후속 기록 전 미완료.
- 보호 파일 lib/raumPnl.js,lib/profitReport.js,lib/pivotFreightArrival.js,lib/invoiceReceiptCost.js는 기준HEAD 대비 차이0.
- UI기준선: shell/페이지스크롤/native선택 적용. 신규 저장 해당없음. 고정1920x1080는 미검증; IAB 실제viewport로 검사.

검색어: arrival-display-unify 최신 승인 원가 카탈로그 전산피벗 입고 참고 역사 원가 보존
