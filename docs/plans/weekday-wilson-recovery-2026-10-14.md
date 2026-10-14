# 주광 윌슨 분류 변경 후 수량 편집 복구

## 문제와 계약

ERP 날짜 합계가 바뀌어 저장된 윌슨 분류가 STALE이면 일반 수량까지 편집 불가였다. 검증된 동일 업무키·단위의 최신 합계가 있고 기존 윌슨이 그 합계 이하인 경우, 기존 윌슨을 유지한 일반 예상값을 편집할 수 있게 한다. 저장된 분류는 여전히 미확인이다. 사용자가 값을 변경해야 기존 onEditWilson 경로로 수량+분류 초안을 만든다. 단순 focus/blur 또는 같은 값 입력은 쓰지 않는다. 최종 적용은 기존 최신 ERP snapshot, Wilson revision 검증을 그대로 수행한다.

미확인 합계, 단위 변경, 다른 연도/업체/품목/날짜, UNVERIFIED, 합계 초과 윌슨, 조회 오류, 기존 초안 또는 잠긴 날짜는 추측으로 복구하지 않는다. 다른 날짜 초안을 보존한다.

## 사전 읽기 근거

- 실제 로컬 dnSpy.Console로 `Nenova.exe`의 `FormEstimateView` 역컴파일: `output/weekday-wilson-recovery-dnspy.txt`. ShipmentDate 연결 및 DetailFix=1 인쇄 조건 확인.
- SELECT 전용 동일 업무키 probe: `output/weekday-wilson-recovery-probe.cjs`, 결과 `.jsonl`. CustKey533/2026/42-01 Doncel389는 10/18 날짜합계13박스, MoonLight447은42박스, 둘 다 미확정. 2025 같은 차수는 별도 조회하여 혼입 없음을 확인.
- `verifyWeekdayWilsonRecord`는 식별자·활성 품목·단위·실제 합계 검증 후에만 STALE/currentTotal을 제공하며 미검증은 UNVERIFIED이다.
- 변경은 브라우저 초안 편집에 한정. OrderDetail, ShipmentDetail, ShipmentDate, StockHistory, Estimate, WebProfitReport 및 확정·인쇄 API 변경 없음. 기존 `editWilson`의 revision 보존 경로 사용.

## 메뉴 기준선

- 적용: 단일 화면틀 유지, 페이지 세로 스크롤과 표 가로 스크롤, 1920×1080 기준, 방향키/Enter/Escape, 간결한 오류 상세, 사용자 초안 보존, 명시적 분배 적용.
- 해당 없음: 새 메뉴 등록, 업로드 매칭, 새 ERP 저장 API/스키마, EXE 저장 순서 변경.
- 예외: 없음. 요청된 orchestration 문서는 현재 checkout에 없어 사용자 AGENTS의 역할 분리를 적용했다.

## 검증

순수 정책 및 실제 컴포넌트 회귀 테스트: STALE 편집 복구, 같은 값 무저장, 일반+윌슨 합산, cross-year/단위/unknown/초과량 차단. 운영 ERP 저장 테스트는 하지 않는다.

## 추가 요청: 최신 자료와 초안 동시 유지

화면이 보이는 동안 30초마다, 다른 창에서 돌아올 때 최신 분배·출고를 조회한다. plans/WilsonDrafts 및 셀 편집 입력은 바꾸지 않는다. 저장·변경확인·보조정보 편집 중에는 겹쳐 조회하지 않고, 시작한 백그라운드 응답도 작업/조회 scope가 바뀌면 폐기한다. 자동 조회는 기존 자료를 초기화하거나 수량 입력을 잠그지 않는다. 실패 시 마지막 자료와 초안을 보존하고 조회 실패 및 마지막 성공시각을 안내한다. 실제 분배 적용 직전의 강제 최신 조회와 서버 충돌 검사는 그대로 유지한다.

실제 Chrome 1920×1080에서 13합계/Wilson1 STALE를 일반10→합계11로 수정, Wilson2→합계12로 수정, 다른날 초안3 유지, 단순 focus/blur 기록0, UNVERIFIED 편집차단을 확인했다. 화면: output/weekday-wilson-recovery-browser.png.
