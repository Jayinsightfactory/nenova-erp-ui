# 주광 출력 미리보기 적요·박스 선택

## 근거 및 기준
- 실제 dnSpy FormEstimateView.GetPrintDetail: ProdKey+Cost별 ShipmentDate.EstQuantity/Amount/Vat 합계, Descr; ProductSort 우선순위. FormPrintEstimate는 제목을 ReportEstimate.Descr로 전달. 기존 EXE 확정 출력 조건은 보존하고 주광은 사용자 요청으로 저장 분배 출력 사용.
- 2026-10-23 SELECT: Cust533/43-01, Prod359는 10/25 3박스45단, 10/27 2박스30단; Prod866은 10/25 15박스450송이. 모두 미확정. 2025 동일 키는 별도이며 EstQuantity 미설정. ShipmentQuantity/EstQuantity=float, Descr=nvarchar.
- 비고: 차수만(43차). 각 출력 클릭마다 박스 표시 예/아니오/취소를 선택하며 선택요일은 날짜별 문서 유지. 생략된 함수 옵션은 기존 true, 명시 false 보존.
- 미리보기 적요: 수량/단가 편집 금지. 날짜 또는 전체차수 문서+연도+차수+업체+품목+단가+정상/차감 identity별 웹 출력용 저장. 원장 적요와 구분하며 빈 문자열은 명시적 지움. revision CAS, 활성 출력행 서버 재확인, 서버 재조회로 유지. 한 날짜의 적요를 다른 날짜나 연도에 자동 복제하지 않는다.
- 입력창은 셀 편집 가능, blur 저장 및 인쇄 전 미저장 적요 저장. 실패 시 입력 유지·인쇄 차단. Escape/Tab/초점 복귀. iframe 내용은 제어된 escape HTML, 사용자 적요를 HTML로 해석하지 않는다.

## 동작별 부작용
|동작|Order/Shipment/ShipmentDate/ShipmentFarm|Estimate/금액/VAT/isFix|Stock/Profit|웹 출력 적요|
|---|---|---|---|---|
|분배 저장 검증|격리 SQL 기존 계약 테스트|동일|동일|보존|
|엑셀/인쇄 조회|SELECT|SELECT 보존|보존|조회|
|적요 저장|SELECT 대상 확인, 쓰기 없음|보존|보존|지정 행 CAS 저장|
|박스 표시/비고|보존|보존|보존|보존|

## 검증
- 박스+낱개 저장→재조회→엑셀 raw수치/일반+윌슨/합계잔량→선택요일 인쇄 실물단위 회귀. 수국1/30 등 소수9자리 보존.
- 적요 저장/재열기/빈값/타년도/타업체/타날짜/없는 품목/동시수정/저장실패/XSS/차감 독립성.
- 필수 ERP/dnSpy/manifest/write guard/build, PR CI/배포/Chrome.
- 메뉴 기본값 적용: 기존 shell, 키보드, 실패 입력보존. 새 메뉴 해당없음. 인쇄 미리보기는 명시 모달 예외.
