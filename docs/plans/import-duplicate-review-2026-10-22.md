# 중복 품목 사용자 확인 — 2026-10-22
사용자 승인: 중복을 병합/삭제/영구 기본값 지정하지 않고 사용자가 확인·수정한다.
기준: 원문 중복 후보를 모두 표시, ProdKey/국가/품종/단위 식별, 선택 연도·차수의 해당 파일 업체 주문 여부를 표시한다. 기존 자동 해소 정책은 유지하되 결과를 다시 수정할 수 있다. 선택은 기존 productOverrides와 서명 무효화/재검증 경로를 사용한다.
부작용: 후보 조회/선택/재검증은 Product, OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, StockHistory/ProductStock, Estimate/WebProfitReport 전부 보존. 최종 적용은 기존 서명·확정·연도 계약 그대로.
사전 근거: 설치 Nenova.exe FormShipmentDistribution dnSpy CLI 재실행; ProdKey별 ViewOrder 연결 확인. 앞선 golden의 btnSave_Click 상세→농장→날짜 저장 경로 변경 없음. 운영 SELECT 4쌍 활성·단위·국가·분류 확인, 952/3464 및1846/2030 양쪽 주문 이력,2195/2197 국내왁스 분류 확인. EXE GUI 수정은 없음.
검증: 2025/2026 같은 차수 fixture에서 후보 주문 여부가 선택 연도로 제한됨, 수동 재선택 키와 skip 기존 계약 검증. DB 쓰기 없는 브라우저 fixture로 선택/재검증 및 작은 화면 확인 예정.
메뉴 기본값: 적용=원본/선택 비교, 네이티브 select 키보드, 페이지 스크롤, 재검증, 명시 승인. 해당없음=새 메뉴/원장보정/영구 공용매칭. 모달 후보 검색의 기존 동작은 보존.
