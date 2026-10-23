# 2026-10-23 주광 인쇄 표시 보완

## 사전 근거와 범위
실제 설치 EXE의 dnSpy ReportEstimate.InitializeComponent 재확인: 표180mm, 품목명58.235287mm, 상세행6.35mm, A4 좌우15/상하10mm. FormEstimateView.Print는 Title/CustName/Descr/TotalKorea/TotalNumber만 바인딩한다. TEL/FAX 고객칸은 원래 빈칸이며 공급자 TEL/FAX는 고정 회사정보다. 웹은 우측 헤더의 주소행 높이를 모든 행과 동일하게 강제하여 원본과 다르고, 행 페이지 분할 방지와 반복 페이지 여백이 누락됐다. 로고 리소스를 직접 확인했으며 직인은 없다. 직인 원본/기존 사용 여부 사용자 확인 중; 임의 직인 생성 금지.

읽기전용 probe: 2025/2026 43-01 Cust533 Prod359/363/866의 수량/확정/금액 대조, SELECT만 수행. 현재 카네이션359 3박스=45단/2박스=30단, 수국866 15박스=450송이. 출력은 저장 분배/금액 유지.

## 기준 및 부작용 표
- 미리보기/인쇄: OrderDetail, ShipmentDetail(Amount/Vat/isFix 포함), ShipmentDate, ShipmentFarm, Estimate, Stock, WebProfitReport 모두 보존.
- 차수 표시 수정: 주광 인쇄 전용 파일만 저장. 기본 대차수+차, 명시 빈 문자열 유지. 실제 ERP 차수/날짜 변경 아님.
- 문서 식별: year+majorWeek+CustKey+mode+dates. 별도 document-header 디렉터리의 기존 원자적 CAS note store 재사용. 내부 prodKey 슬롯에는 CustKey를 넣되 ERP 품목 의미가 없는 파일 키이며 품목별 적요 디렉터리와 분리.
- 표 열폭: native58.235287mm 유지; 헤더/본문 공통 colgroup. 페이지마다 @page 여백, thead 반복, tr 분할 방지. 긴 적요 줄바꿈 보존.
- TEL/FAX 공급자 행 잘림 해소; 고객 전화는 별도 DB 연결 필요성을 확인한 뒤 범위 추가 여부 결정.
- 메뉴 기본값 적용: 기존shell, Tab/ShiftTab/Escape/초점복귀, 실패입력보존. 새메뉴 해당없음. 인쇄모달/A4는 명시예외.

검증: 기존 순수 HTML/저장 CAS/교차연도 fixture 확장, 필수gate, Chrome 미리보기/인쇄 페이지 확인 후 배포. 실제 종이 출력은 하지 않는다.

추가 DB probe: Customer에는 Tel(nvarchar)만 존재하고 Fax열 없음. Cust533 활성행 Tel있음만 확인(번호 미기록). 사용자 TEL/FAX 요청에 따라 고객 Tel을 SELECT하여 빈 TEL/FAX칸에 표시하며 Fax를 추정하지 않는다. 고객 마스터 쓰기 없음.
