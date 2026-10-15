# 주광 저장 분배 기준 요일 견적 출력

## 요청과 기준

- 최신 사용자 지시: 확정 여부와 관계없이 저장된 분배를 선택 출고일별 견적서로 출력한다.
- Excel은 현재 웹 전체 품목과 일반/윌슨 구분, 합계, 누적 잔량을 반영하는 기존 exporter를 실제 다운로드로 검증한다.
- 인쇄는 저장된 분배만 사용한다. 미적용 수량 초안은 먼저 적용하도록 기존 안내를 유지한다.
- `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 현재 checkout에 없음. 제공된 AGENTS의 역할 분리를 적용해 main이 native/DB 선검증·계약·배포, 하위 작업이 backend/UI 구현·Excel 대조를 담당한다.

## 사전 근거

2026-10-15 실제 설치 EXE를 dnSpy.Console로 FormEstimateView decompile했다.
`output/weekday-distribution-print-dnspy.txt`의 GetPrintDetail은 ViewShipment + ViewOrder + ShipmentDate + PeriodDay를 조인하고 DetailFix=1, EstQuantity>0을 요구한다.
이는 기존 전산 확정 견적의 계약이다. 이번 웹 분배 출력은 사용자 지시에 따른 별도 읽기 기능으로 구현하며 기존 `/api/estimate/weekday-print` 및 견적 대조는 유지한다.

읽기 전용 운영 probe: CustKey533, 2026/42-01, 2026-10-18:

| 품목 | 저장 분배(박스) | 견적 환산 수량 | 공급가 | VAT | 확정 |
|---|---:|---:|---:|---:|---|
| Doncel 389 | 12 | 180 | 1718182 | 171818 | false |
| Moon Light 447 | 42 | 630 | 6013636 | 601364 | false |

2025/42-01 같은 품목의 5/23박스는 별도 연도 자료로 확인했다. 웹에서 42차 일요일 출력/선택은 실제로 미확정 때문에 disabled였다.

## 판단 기준과 소비자

| 항목 | 기준 | 소비자 |
|---|---|---|
| 업무키 | year + major/subweek + master customer + product + 실제 date | SQL, 검증, 출력 응답 |
| 정상 수량 | 저장 ShipmentDate.ShipmentQuantity; 견적 단위는 native 환산 정책 | 분배 출력 전용 reader |
| 윌슨 | 저장 총량에 이미 포함, 추가 합산 금지 | 출력 reader, Excel snapshot |
| 확정 | 출력 제한 없음, 진단 정보로 표시 | 버튼, API, 미리보기 |
| 날짜 | 서버 PeriodDay 검증 및 파라미터 날짜 필터 | 요청/reader |
| 원장 차감 | 선택일 등록분만; 전체 차수는 해당 차수 등록분 | 분배 출력 reader |
| 읽기 일관성 | 한 읽기 트랜잭션, no-store | API |
| 초안 | Excel에 현재 화면값, 견적 인쇄에는 미포함 | exporter, print UI |
| 이상 자료 | 잘못된 고객/품목/단위/중복/날짜/금액을 조용히 누락하지 않음 | reader validation |
| native NULL 상세 CustKey | Master의 거래처가 원천, NULL만으로 차단 금지 | 연결 검증 |

## 부작용

선택일/전체 분배 견적 출력과 Excel 다운로드 모두 OrderMaster/OrderDetail, ShipmentMaster/ShipmentDetail(수량·Amount/Vat/isFix 포함), ShipmentDate, ShipmentFarm, StockHistory/StockMaster/ProductStock, Estimate, WebProfitReport를 보존한다. 확정 취소·확정·재고 SP·견적 원장 생성은 호출하지 않는다.

## 검증/기준선

- 적용: 기존 화면틀, 페이지 세로/표 가로 스크롤, 키보드 선택/출력/닫기, 1920×1080/100%, 실제 ERP 조회, 실패 메시지, 계약·교차연도 fixture.
- 해당 없음: 새 메뉴 등록, DB 쓰기, 재고 조정 승인, native 앱 패키징.
- 예외: native 확정 필터는 별도 분배 출력에 적용하지 않음(최신 명시 요청). 전산 확정 견적 경로는 보존.
- 필수: 미확정 정상, 타 고객/타 연도 배제, 선택일별 개별 문서, 윌슨 중복 없음, 단위환산, 빈 날짜, 잘못된 응답/연결, read-only, Excel 화면 대조, 필수 ERP gates/build, 배포 후 실제 미리보기.
