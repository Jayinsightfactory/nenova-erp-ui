# 중국 발주 현황 세부차수 표시 정정

## 최신 사용자 합의
- 이전 3개 + 중심 + 다음 3개, 총 7개 메인차수 범위는 그대로 유지한다.
- 최신 추가 지시: **세부차수 하나만 선택해 표시**한다. 7개 메인차수는 선택 범위이고 그 안의 실제 세부차수를 모두 선택 목록에 제공한다. 01/02 고정이나 선택 범위를 7개 세부차수로 축소하지 않는다.
- 화면 행은 업체명·실제 CL 코드·품목·HF·단위·선택 세부차수 수량. 품목만 합산해 업체를 숨기지 않는다. 업체 기준은 CustKey이며 같은 CL이라도 다른 업체를 합치지 않는다.
- 엑셀도 선택 세부차수와 화면 검색/매칭 조건만 포함한다. 전체 모델의 세부차수 열은 그대로 보존하되 선택 열 하나만 내보낸다.
- 기존 메인차수 합산 표시 결정은 이 합의로 대체된다. CL(Customer.OrderCode), HF, 단위별 총합과 주문상세는 보존한다.

## 구현 계약
- API SQL/인증/조회 범위 변경 없음. 전체 유효 중국 양수 주문에서 세부차수 열을 만들고 검색/매칭 필터 후에도 열을 보존한다.
- report.cycles: 실제 PeriodDay 기반 7개 메인차수. report.columns: cycles 순서 안에서 실제 전체 OrderWeek를 수치순으로 정렬.
- 실제 열: {key:`${orderYear}/${orderWeek}`, cycleKey, year, majorWeek, orderWeek, label:orderWeek, offset, empty:false}.
- 주문 없는 메인차수: 하나의 {key:`${cycle.key}/empty`, cycleKey, year, majorWeek, orderWeek:null, label:'주문 없음', offset, empty:true} 자리만 표시. 가짜 세부차수 생성 금지.
- rows.quantities / totals.quantities는 columns.key 기준. selectChinaOrderSubweek(report,key,customerRowKeys) 순수 선택 모델이 정확한 연도+OrderWeek와 optional CustKey|ProdKey|unit 필터로 orders/rows/totals/customerRows를 계산한다. 선택 수량과 업체 합계는 같은 orders에서 나온다.
- report.selectedColumnKey가 있으면 Excel은 실제 선택 열 하나만 표시하고 모든 orders가 그 열인지 검증한다. 미선택 전체 모델의 matrix는 내부 회귀용으로 보존한다.
- 기본 세부차수는 중심 메인차수의 첫 실제 차수, 중심에 없으면 가장 가까운 양수 주문 차수. 모든 범위가 비면 빈 상태·다운로드 비활성. 주문 없는 차수에 가짜 세부차수 선택값을 만들지 않는다.
- UI 단일 선택 헤더와 업체명/CL/품목/HF/단위/수량 고정 폭, 1920x1080/100%에서 검증. 좁은 화면 가로스크롤, 페이지 세로스크롤, 숫자 14px 중앙/진한 색 유지.
- Excel 4시트/문자 CL/HF/회색흰색/모든 테두리 유지. 헤더는 연도-선택 세부차수. 조회기준에도 선택 차수 기록.
- 세부차수 정렬은 숫자 suffix(01/02/03/10) 다음 단일 ASCII 문자 suffix의 codepoint 순서(없음,A,B,a). 원본 대소문자 식별자 보존.

## 사전 근거와 부작용
- 2026-10-05 main 실제 dnSpy CLI FormQuantityPivot: ViewOrder.vo.OutQuantity Quantity, OrderYear+OrderWeek를 그대로 읽음. 기존 EXE/SQL/SP 변경 없음.
- 인증된 운영 GET 2026/40 중심: 37~43 총7 메인, 1,336주문, 42업체. 실제 37-01/02,38-01/02,39-01/02,40-01/02/03,41-01/02,42-01. 43차 양수 중국 주문 없음. 데이터는 시점에 따라 변동 가능.
- 조회·검색·업로드·다운로드: Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존. 운영 DB 쓰기 0건.
- 하위 작업 구현 모델 gpt-5.6-terra/luna 미제공으로 gpt-6-luna high 대체. 설계/최종 검토 gpt-5.6-sol xhigh. main이 근거/입력/의존성/인증 준비, 외부 쓰기/병합/배포 담당.

## 완료 기준
연도 경계·53차수·01/02/03/suffix 분리, 동일 품목/단위 및 업체 CL 합계 보존, 필터 선택범위 고정, 빈 범위 명시, 모든 ERP 게이트/빌드, 1920 및 좁은 화면 회귀, 엑셀 실제 셀 재독해, PR 병합/배포/live 다운로드 대조.

로컬 기능18개·전체 ERP 게이트·생산빌드·실브라우저1920/1100·선택/업체필터 다운로드·헤더sticky 및4시트 렌더 완료. PR 병합/운영 배포 확인은 후속 세션 기록으로 남긴다.
