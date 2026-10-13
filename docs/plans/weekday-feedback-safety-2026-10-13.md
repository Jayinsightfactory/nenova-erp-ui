# 주광 입력·저장 결과·담당자 기준

## 사전 근거
- 실제 dnSpy CLI FormOrderAdd: 신규 lueManager 기본값은 Program.Option.LoginID, ValueMember는 UserID, 편집은 기존 OrderMaster.Manager. CommonLogic.GetUserInfo(false)는 isDeleted=0인 UserInfo를 읽는다.
- 읽기 전용 운영 probe: Cust533 Customer.Manager는 담당자 이름이며 UserID 조인되지 않는다. 2026/41-01,41-02,42-01,42-02의 기존 OrderMaster.Manager는 실제 UserInfo ID로 정상 조인된다. 같은 2025 차수도 별도 조회했다. ViewOrder는 om.Manager=ui.UserID로 조인하며 UserInfo 삭제 조건을 추가하지 않는다.
- 2026-10-13 조회 시 V2 gate는 idle, pending=0, owner 없음. 이전 CALC 원자성 패치는 별도 작업이며 이 작업은 owner를 해제하거나 SP를 수정하지 않는다.
- 저장 감사의 BeforeJson/AfterJson에서 실제 일요일 수량 분할 및 변경 후 확정 상태가 확인된다. 제출 초안은 감사 결과의 대체 근거가 아니다.

## 기준
| 동작 | 원천·기준 | 부작용 |
|---|---|---|
| 이월 입력 알림 | 현재 화면 계산 결과. 작게 표시하고 세부만 명시적으로 열기 | 모든 ERP 테이블 보존 |
| 차수·요일 고정 헤더 | 원본 표의 열 위치와 가로 스크롤 동기화, 1920×1080/100%, 페이지 세로 스크롤 | 모든 ERP 테이블 보존 |
| 적용 결과 확인 | 서버 저장 UUID 및 영속 before/after. 시각·업무키·날짜·수량·확정 전후 표시 | 추가 원장 쓰기 없음 |
| 기존 주문 마스터에 품목 추가 | 기존 Manager의 UserID 조인 확인, 기존 값 보존. Customer.Manager를 검사/대입하지 않음 | 기존 ADD 계약의 OrderDetail/Shipment/일자/감사 변경만 |
| 새 주문 마스터 | 인증된 현재 로그인 UserID의 활성 계정을 잠금 조회하여 저장 | 기존 ADD 신규 OrderMaster+Detail 계약, Customer.Manager/UserInfo 보존 |
| 재고 계산 대기 | V2 gate 기존 획득·native 계산·롤백. 저장 전 명시 no-write ack만 제한 재시도 | gate owner 임의 해제 금지 |

OrderYear+OrderWeek+CustKey+ProdKey 및 UUID 스냅샷을 유지한다. 확정 생명주기·Amount/Vat·견적과 매출 계산 정책을 변경하지 않는다. 사용자 이름 자동 매칭이나 admin 임의 대입은 없다. 계정 자체가 유효하지 않을 때는 구체적 오류를 유지한다.

## 실제 SQL 회귀
승인된 loopback 127.0.0.1:14339 Docker fixture만 사용한다. 운영 환경 변수가 있으면 중단한다. 거래처 담당자 이름+정상 기존마스터, 새마스터 로그인ID, 비활성로그인 오류의 전체롤백과 gate해제, 다른 transaction이 gate를 보유한 때 저장 전 busy ack, 후속 정상 저장을 확인한다. 다른 업체·전년도 sentinel 및 Estimate 미생성 검사를 유지한다.

## 메뉴 기준선
적용: 단일 shell, 페이지 세로 스크롤, 가로 표, 키보드, 비차단 알림, 실제 저장 전 확인, 감사/실제 결과 구분, 연도 업무키, 필수 테스트와 배포 후 브라우저. 해당 없음: 신규 메뉴 등록·파일 업로드/매칭 정책 변경. 예외: 넓은 표의 가로 스크롤과 사용자가 직접 여는 상세 모달.
