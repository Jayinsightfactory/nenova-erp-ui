# 회사 공통 일정·홈 버튼·접기/열기

- 사용자: 달력 2026년11월 제목 옆 공통 일정 입력, 상단 웹개발요청 버튼, 월간/주간 접기·열기, 홈을 다시 열면 펼침. 위치 확정: 사용자 답변으로 환영 제목 옆 요청버튼과 달력 제목 오른쪽 접기 승인.
- 회사 일정은 기존 개인 파일/ERP 원장과 별도 web-only company-calendar 파일. 로그인 활성직원 읽기·등록, 등록자 또는 기존 SS3 관리자만 수정·삭제. 전직원 일정이므로 개인 완료체크로 변경하지 않음. 날짜·제목·시간·메모, 작성/수정 주체와 시각 감사. 여러 PC 공유·원자 저장·CAS·요청멱등/계정변경 fencing, 오류 시 입력보존.
- 달력에는 회사 공통 배지/색으로 개인업무와 함께 표시. 월간/선택주간 동일 데이터, 날짜를 눌러 공통일정 상세·수정 가능. 새 타이머/외부 발송/ERP SQL/스키마/공유DB 쓰기 없음.
- 회사GET/등록/수정/삭제: OrderDetail, ShipmentDetail, ShipmentFarm, ShipmentDate, Estimate, WebProfitReport 모두 보존. 공통calendar파일만 명시 저장.
- 접기는 월간/주간 독립적. 재조회로 임의 펼침 없음, 숨긴홈을 다시 열면 모두 펼침. 키보드 aria-expanded/controls·초점·Escape, 초안보호.
- 검증: A등록→B읽기/권한없음수정차단→A수정→SS3삭제, 교차연도·시간/종료미정·동시저장/CAS/재시도·손상닫힘·원장0, 실제Chrome 및 nativeIPC4폭/재홈펼침·가이드 갱신, 필수ERP/dnSpy/manifest/writeguard/build/CI/릴리스/운영확인.
