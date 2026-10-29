# 호텔 박스계수 없는 주문 — 2026-10-29

사용자: 환산계수 없이 주문등록되어야 한다.
기준: 실제 dnSpy FormOrderAdd btnSave_Click/UnitQuantity, Product 읽기 probe의 GRACIOSA 활성7품목 모두 OutUnit=EstUnit=송이, 박스/단계수0. 같은 단위 수량은 변환 없이 my-customer ADD가 처리한다. 박스계수는 호텔여분 자동분류용이지 동일단위 주문 자격조건이 아니다.

| 동작 | 기준/부작용 |
|---|---|
| 합계·미리보기·최종 preflight | 공유 buildHotelOrderRows. 같은 단위 합계 보존. 박스계수 없으면 자동여분0, 전량 분류필요; 업체배정 후 등록 가능 |
| 서로 다른 단위 | 기존 hotelConvert 유지. 알려지지 않은 비율을1로 대체하지 않음 |
| 최종 확인 ADD | 기존 연도+차수+업체+품목, expectedCurrentQty 유지. OrderMaster/OrderDetail/History만 기존 계약대로. 신규 SQL 없음 |
| 출고/재고/견적/매출 | ShipmentMaster/Detail/Date/Farm, Warehouse, Stock, Estimate, WebProfitReport 보존 |

SELECT-only 2026/45-01 Cust680 및 전년도: ViewOrder/Shipment/Date/Farm/Estimate/DetailFix1 견적노출/확정매출/ProfitReport0. 실제 주문 쓰기 없음.
검증: 2025/2026 같은 차수의 송이/단/박스, 누락/0계수, 직접배정/미배정/과배정, 발주배정, 단위변환 필요 반례. UI 안내 추가, 기존 키보드/서버저장/확인 흐름 보존. 전체검사/배포 진행 중.
