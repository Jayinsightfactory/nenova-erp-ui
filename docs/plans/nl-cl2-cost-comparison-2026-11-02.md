# 네덜란드 주광·기타 주문/입고 비교

## 기준 및 부작용
- 사용자 승인: 주광 주문량 우선 배분, 실제 업체 귀속이 아닌 추정임을 명시. 품목 왼쪽 주광 표시, 미입고 수량은 숫자 0을 `-` 서식으로 표시.
- 읽기 전용 probe: 2026/43-02 NL 활성 주문142행, 주광 주문13행, 다른 업체와 공동 품목9개. 주광농원 CustKey533의 현행 Customer.OrderCode는 YCL2. 이름이 유사한 주광여분코드(CL000)는 제외. WarehouseDetail에는 CustKey가 없고 OrderCode는 COD 원문(표본1~5)이다.
- 업무키: OrderYear+OrderWeek+ProdKey+Customer.CustKey. Customer.OrderCode의 정확 CL2/YCL2 유일 활성 업체만 주광으로 해석. 코드 숫자 suffix·이름 부분일치 금지.
- 주문 SteamQuantity와 실제 WarehouseDetail.SteamQuantity는 송이 기준. 선택 차수 전체 입고를 WarehouseKey,WdetailKey 순서로 배분해 여러 농장/송장에서 주문량 중복 귀속 방지. 선택 송장의 배분과 차수 누적을 분리.
- 모든 주문/입고/출고/확정/재고/견적/손익/승인원가 테이블은 SELECT 또는 보존. SP/DDL/보정/입고 등록/비용 승인 호출 없음.
- 새 인보이스 미등록 계산에서는 인보이스 수량을 실제 입고로 승격하지 않고 전산의 차수 전체 실제 입고만 비교. 원가는 이 계산본 기준임을 표시.
- 기존 원본 계산 시트 및 수식은 유지. 품목 왼쪽 A열에 주광/기타 표시, 비교 시트의 송이 원가는 원본 계산 M열을 연결하여 환율·비용 변경에 반응. 동일 품목 복수 행은 수량 가중원가.
- 정상: 전량/부분/초과/미입고, 공동 주문, 복수 송장, 삭제/전년도 제외. 반례: YCL22/CL000 오인, 중복 고객, 불명/음수 입고, SQL 실패, 생성 중 주문·입고 변경. 실패를 정상 0으로 숨기지 않음.
- dnSpy 근거: ExcelLoadingPackingList.MakeTempTable은 COD를 WarehouseDetail.OrderCode에 복사하며 고객 귀속을 저장하지 않음. 로컬 decompile과 docs/exe-golden/FormWarehouseUpload.md 확인. DB 변경 없음.

## 검증 기록
- 실제 EXE를 dnSpy.Console으로 재확인: COD가 OrderCode로 복사되고 CustKey 고객귀속은 없음.
- 운영 SELECT 전용 실제 native HTTP handler GET→download: 2026/43-02 Holex 71품목, GW1226.1/CW1364, DB 읽기5회, 출력88KB. 재등록·승인 없음.
- Excel 앱 열기 및 Ctrl+Alt+F9 재계산: 주광 주문1170송이, 선택입고 추정1070송이, 기타8906송이, 합계9976송이. 미입고 Tulip Renegad Red100송이는 입고 `-`. 주광/기타 합계원가와 원본 수식 연동 확인.
- 이 로컬 예시는 이전 검증 환율1509.8을 재사용한 시험본이며 현재 시세나 확정 비용으로 주장하지 않음. 운영 다운로드는 기존 현재환율+15/서식 기본값 경로 유지.
- 관련 실행 247건 중211통과, 외부 과거 원본을 요구하는36선택검사 제외. 전체 가드·빌드·CI·배포·운영 최종 다운로드는 PR에서 이어서 확인.
