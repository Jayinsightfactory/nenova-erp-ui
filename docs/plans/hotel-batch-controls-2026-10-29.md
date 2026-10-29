# 호텔 차수 조작과 주문등록 재검토
업체검색: 이름 입력 후 CustKey 확정. 차수삭제: 선택 side/id만 초안에서 제외, 원본 batchHistory 보존, 파생 최종수량/분류 초기화, frozen 금지. 원본은 클릭으로 열고 Escape/닫기 복귀. 품목 더블클릭은 기존 chooseProduct 재사용.
모든 신규 조작은 서버 CAS 초안만 변경하며 Order/Shipment/Stock/Estimate/WebProfitReport 보존. 등록은 기존 my-customer ADD/expectedCurrentQty 경로 재사용.
실제 dnSpy FormOrderAdd btnSave_Click 811~870 Master→Detail Out/Est→History 및 UnitQuantity 910 재확인. native 전체 신규저장과 웹 주문전용 보존 정책은 동일한 부작용으로 오인하지 않는다. 읽기전용 같은 업무키 probe와 계약검사로 검증. 운영 시험주문 없음.
메뉴기준: 검색/키보드/초안/등록전확인 적용. 새메뉴/스키마변경 해당없음. 실브라우저 도구 연결장애는 별도 미검증 보고.
