# 최신 합계 변경을 정상 수량으로 표시

사용자 요청: ERP 값이 변경됐어도 최신값은 정상이므로 재확인 느낌표와 팝업 없이 최신 수량을 표시한다.

동일 연도·세부차수·업체·품목·출고일, 같은 단위, 검증된 currentTotal과 표시 합계 일치, 0≤기존 윌슨≤최신 합계 조건이면 일반=최신 합계−윌슨을 정상 수량으로 표시한다. 기존 초안이 우선하며 임의로 덮어쓰지 않는다. 웹과 웹 작업 엑셀은 동일 판정 함수를 사용한다. 미검증, 단위 불일치, 초과량 등 실제 오류는 유지한다.

이 동작은 조회 결과의 표시 계약이다. 자동 분류 저장·ERP 쓰기는 하지 않는다. 명시적 편집은 기존 Wilson revision/CAS와 분배 최종 재검증 경로를 사용한다. Order/Shipment/ShipmentDate/Stock/Estimate/Amount/Vat/isFix/WebProfitReport 모두 조회만으로 변경되지 않는다.

사전 근거: 2026-10-15 실제 dnSpy FormEstimateView 재실행(`output/weekday-latest-quantity-dnspy.txt`), 동일 업무키 2025/2026 Cust533/42차 Doncel·MoonLight SELECT probe 재실행(`output/weekday-latest-quantity-probe.log`) 성공. 기존 저장 SQL·확정·인쇄 조건은 변경하지 않는다.

메뉴 기준선: 화면·키보드·초안보존·명시적 적용 전 검증 적용. 새 메뉴/레이아웃/ERP 저장 API 변경 해당 없음. 예외 없음. orchestration 문서 부재는 기존과 같아 사용자 AGENTS 분담 기준 적용.

검증: 최신 표시/내역/엑셀 일치, 경고 없음, 명시 편집 보존 및 단위·연도·미검증·초과량 차단 회귀검증 후 필수 ERP 게이트와 실브라우저 확인.
