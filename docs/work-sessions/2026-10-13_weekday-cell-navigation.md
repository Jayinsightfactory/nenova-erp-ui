# 주광 선택 내역·방향키 입력 (2026-10-13)

## 요청과 범위
- Q: 선택 칸 내역 창이 너무 크고 입력칸에서 방향키 이동이 안 되어 불편하다.
- A: 자동 선택 내역을 페이지 흐름의 작은 요약으로 바꾸고, 명시적으로 상세를 펼친다. 일반/윌슨 수량 입력 사이 방향키 이동을 추가한다.
- 수용 기준: 1920×1080/100%에서 입력을 가리는 자동 고정 창 없음. 위/아래 동일 열, 좌/우 수량칸 이동. 숫자 내부 caret, 선택, 조합 입력, 수정키는 보존한다. 접힌 품종·비활성 셀은 건너뛴다.

## 부작용 및 근거
- 브라우저 초점/내역 표시만 변경한다. blur는 기존 미적용 초안 경로를 사용하며 분배 적용 버튼을 자동 실행하지 않는다.
- Order/Shipment/Stock/Estimate/WebProfitReport, 확정 상태, 단가·수량 계산 및 인쇄 연결은 모두 보존한다. 새 API/SQL/ERP 쓰기 없음.
- 기존 실제 EXE/읽기 전용 근거: docs/exe-golden/WeekdayEarlyShipmentIntegration.md 및 직전 주광 작업 기록. 이번 변경은 native 저장 순서를 변경하지 않는다.
- 프로젝트 orchestration 문서는 현재 checkout에 없으므로 사용자 제공 AGENTS 분담 규칙을 적용했다. 구현 하위 작업과 메인 검토·배포를 분리했다.

## 검증
- 진행 중: 방향키 정책 테스트, ERP 계약/근거/쓰기 가드/빌드, 실제 Chrome 로컬 및 배포 화면 검증.
- 로컬 전체 ERP 계약, dnSpy 근거, manifest, write guard, production build 통과. 실제 Chrome 1920×1080에서 5→7 초안 기록 후 아래행 이동, 좌우 이동, 자동 팝업 없음(요약43px), 명시 내역420×138px, Escape 초점복귀, 스크롤 후 입력 top466px > 고정헤더 bottom108px 확인.
- PR1041 병합 b7121cfe, 배포38359199016 및 hydration 검사 성공. 운영 Chrome에서 Brut 10/08→10/09→Caramel 10/09 이동, 요약 높이43px/자동 popup0/입력 내역0건 확인. 운영 수량·ERP 쓰기 없음. 작은 화면800×700도 로컬 확인. 화면 output/weekday-cell-production.png. 배포 임시 swap 준비38358447350 및 정리38359749716 성공, viewport 복원/로컬 서버 종료.
