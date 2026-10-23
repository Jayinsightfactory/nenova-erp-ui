# 주광 인쇄 적요의 웹 분리 (2026-10-23)

실제 `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`를 로컬 dnSpy.Console.exe로 FormEstimateView, FormPrintEstimate 각각 추출(exit0).
근거: ignored output/native-estimate-view.txt, output/native-print.txt.

- GetPrintDetail 정상행은 ProdKey+Cost별 SUM(ShipmentDate.EstQuantity/Amount/Vat), MAX(Descr), 차감은 Estimate 원문. ProductSort.OrderNo/CounName/ProdName 정렬.
- FormPrintEstimate.btnPrint_Click는 titleName을 전달하고 ReportEstimate.Descr 매개변수가 헤더 비고가 된다.
- 실제 EXE 정상견적은 DetailFix=1을 요구하나 주광 출력은 기존 사용자 계약대로 저장 분배 read-only 경로를 유지한다.
- 운영 SELECT Cust533/2026/43-01 Prod359: 10/25 3박스45단,10/27 2박스30단;866:10/25 15박스450송이. isFix=false에서도 주광 분배 인쇄 대상. 2025/43 동일키는 다른행·EstQuantity NULL이며 혼합하지 않는다. ShipmentDate 양 수량컬럼 float 확인.
- 신규 적요는 EXE ShipmentDate.Descr/Estimate.Descr을 수정하지 않는 웹 출력 overlay다. 별도 runtime/weekday-print-notes 파일에 exactscope/revision 저장. 수량/금액/확정/재고/매출은 보존한다.
- native 조회 산식/정렬/셀 크기는 수정하지 않는다. 사용자의 헤더 차수 단독 표기·박스 선택·셀 적요 편집만 출력용 확장.
