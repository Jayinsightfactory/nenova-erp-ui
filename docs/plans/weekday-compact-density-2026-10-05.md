# 주광 견적표 기본 밀도와 버튼 정리 · 2026-10-05

사용자 첨부의 브라우저 65% 구조를 1920×1080 CSS pixel / 확대100%에서 읽을 수 있는 기본 표 배치로 구현한다. 전체 페이지 zoom/transform 대신 실제 열 폭·행 여백·표시 글꼴·버튼을 조정한다. 품목 고정열, 요일 일반/윌슨/합계, 실제01/02 합계·잔량, 대차수 합계·잔량·변경은 보존한다. 긴 단위는 숫자+단위를 함께 줄바꿈하며 잘라내지 않는다. 주요 수량14px, 품목12px, 상태10~11px, 상세창18px를 기준으로 한다.

## 범위와 부작용

| 동작 | UI 결과 | 공유 ERP / 웹 수량 저장 |
|---|---|---|
| 표 조회·스크롤 | 좁은 열, 조밀한 행, sticky 품목/헤더 | 모두 보존 |
| 내역·견적 대조·변경·잔량 버튼 | 일관된 버튼, 기존 내역·오류·편집창 | 기존 handler/disabled 조건 보존 |
| 일반/윌슨 편집·분류 | 기존 수량과 분류 표시 유지 | 기존 canonical T=N+W 및 revision/UUID 복구 보존 |
| 인쇄/Excel | 기존 버튼과 합산 결과 | 확정 조건 및 canonical 합계 한 번 보존 |

이번 변경에는 API/SQL/수량 계산/업무키 변경이 없다. Estimate, ShipmentDate, ShipmentDetail.Amount/Vat/isFix, StockHistory, WebProfitReport 및 Order/Shipment 원장은 모두 보존한다. 같은 세션의 실제 FormEstimateView dnSpy 확인과2026/40~42 SELECT probe 근거는 weekday-wilson-subweek-2026-10-05.md 및 FormEstimateView golden을 따른다. 교차연도 같은차수, 초안 잔량, 실제업무차수, 단위환산, Wilson 합산·분류 전용 handler fixture를 재실행한다.

프로젝트 CODEX_SUBTASK_ORCHESTRATION.md는 현재 origin/master에도 없다. 사용자 제공 운영 규칙을 적용하여 메인 preflight/계약/배포, 구현 agent, 독립 검토 agent로 분담한다.

## 수용 기준

1920×1080 / 100% popup 작업 화면에서 약 두 차수를 함께 보고 일반 품목10개 이상 표시한다. 반복 상태·견적 버튼이 불필요하게 행을 키우지 않는다. 상세·오류·수량단위 접근성은 유지한다. 작은1280×800에서는 페이지 가로 overflow 없이 표 자체 스크롤로 조작한다. sticky 겹침, 모달 화면 이탈, 요일 선택, 버튼·오류 상태, 가로/세로 스크롤을 실제 브라우저에서 확인한다. 필수 ERP 계약/dnSpy/manifest/write guard/build 이후 PR→master→Cafe24 배포 및 실화면 확인을 수행한다.

## 로컬 실브라우저 확인

35품목/3차수 fixture, viewport1920×1080/100%: 실제표2642px(기존4304px 대비61%), 품목170px/일반46px, 두 차수 마지막변경열right1837px, 일반10품목 bottom920px. 일반행52px, 기준미확정행59.8px. 긴환산단위는 더 높은행으로 원문 모두 보존한다. 1280×800 outerwidth1280, 표bottom758px; 내역dialog504..1264/583..784로 화면내. 요일월→일선택, 내역열기닫기, 세로sticky/품목고정, 가로차수jump와3스크롤바동기화 확인. API/SQL변경없음, 운영수량쓰기없음.
