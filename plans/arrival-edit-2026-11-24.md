# 도착원가 입력·공유 매칭 2026-11-24
연결 목표 g17/g19. 사용자가 선택한 국가·연도·차수·입고 집합만 원가 계산.

|동작|WarehouseMaster/Detail|Order/Shipment/Stock/Estimate/손익|서버 업무설정|
|---|---|---|---|
|차수조회·입고선택·계산·다운로드|조회만|보존|조회|
|CLOUD 카테고리 저장|조회 검증|보존|CN+검증농장+ProdKey 범위, expectedRevision/프로세스간lock/원자저장|

기준: 원문명과 ERP명 및 카테고리를 같은 고정 행에 표시. 입력 중 행을 숨기지 않음. 사용자 직접입력 우선, 초기값과 지연 응답은 편집값 덮어쓰기 금지. 원가 매칭만 공유하고 ERP 상품 매칭은 수정하지 않음.
검증된 문서/원가표에서 GW/CW 각각의 명시 필드·출처를 승계. 계산 CBM은 CW 대체 금지.47-02 원문 C8/F8은 A1823/2452, B21/70, 비용 C11은23168/1830CNY. 발행일/중량/부대비 추정 금지. 비용범위/AWB 없으면 입고별 계산단위로 명시하고 합쳐서1개 비용으로 취급하지 않음.
원문 47-2B E34:E35는25단+90송이를115 원가계산수량으로 사용. 법적 ERP단위는 보존하며 정확한 문서지문/원문행·품목·금액이 검증된 원가용 변환만 허용. A31통화·호접허가증·검역18 등 재무 예외는 별도 사용자 확인 전 확정하지 않음.
근거: actual dnSpy ExcelLoadingPackingList MakeTempTable/InsertMaster .verify/native-warehouse.cs. readonly8249/8250 2026/47-02 각각38/2행54909/2620CNY·미연결0·GW/CW NULL. 기존 native writer 보존.
검증: 입력유지/동일행대조/복수선택/권한/상충수정/국가농장품목범위/사용자카테고리규격·세율 검증/교차연도/원문중량단위/provenance/비용중복/실제다운로드. 필수ERP/pstack/가이드/CI/Cafe24 후 실UI.

메뉴 기준 적용: 1920×1080/100% 및390px, 같은 행 원문 대조/Tab·ShiftTab/명시 다음/상태 문구/충돌 보존. 기존 /arrival-cost 메뉴와 desktop 검색·즐겨찾기 경로 유지, desktop1.3.88. ERP 반영은 본 작업 비해당. 서버 설정 이력은 사용자·revision·시각 기록. 새로운 DB 테이블·ERP 쓰기 없음.
Plannotator 도구와 CLI 없음 확인. 계획은 이 파일로 보존하고 상위 세션에 보고.

이번 통합 매칭·공유 가이드 재현 명령: node scripts/test-cloud-cost-edit-ui.cjs --record-guide. 기존 국가별 전용 녹화는 registry의 동일 watched source 목록 사용. 최종 격리 캡처에서 저장상태 열 너비를 보완하고 현재 CSS 기준으로 해당2개 가이드 재촬영 완료.
