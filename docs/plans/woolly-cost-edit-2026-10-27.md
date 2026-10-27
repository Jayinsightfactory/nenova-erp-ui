# Woolly 원가 화면 품목 변경

- 원인: 분류 버튼이 receipt 화면에만 있고 원가 표는 ProdKey만 표시. 정상 prepare이면 편집 버튼도 숨김.
- 사용자 동작/부작용: 원가에서 분류 열기→명시 품목 선택→합계검증 적용은 브라우저 문서만 변경. Product SELECT, Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport/승인원가 모두 보존. 공용 매칭 저장 없음.
- 기준: 기존 applyInvoiceAllocation의 AU 활성 후보/원문/수량·금액 합계 검증을 그대로 공유. 적용 뒤 prepare 새 지문, 이전 계산·다운로드 폐기. 다른 파일·연도·차수에는 비용 입력 재사용 금지. 같은 문서의 환율·통관비와 변경되지 않은 행 입력은 보존, 변경 행의 관세·배분 입력은 재확인.
- 실제 dnSpy 재실행: ExcelLoadingPackingList UPrice/TPrice 별도, uspCreateWarehouse→uspStockCalculation. 이번 UI는 두 SP 미호출. 운영 SELECT2997 Wolly Bush Green Tip/2998 Wolly Bush Red Tip 모두 활성·호주·단 확인. 원장 쓰기 없음.
- 메뉴 기준: 페이지 스크롤/한영 품목명/기존 모달 키보드·초점복귀 적용, 신규 shell 해당없음. 원가식·입고 writer 변경 없음.
- 검증: 품목 바꾸기·취소·합계불일치·stale·비용 보존·다른연도 격리 및 기존 원가 XLSX 회귀. 결과 후속 기록.
