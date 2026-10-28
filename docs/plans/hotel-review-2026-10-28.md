# 호텔 이미지 대조·번호별 요청수량 저장

사용자 기준: 업로드 이미지 바로 옆 품목/수량 매칭표, 명시 저장 후 요청수량1 반영. 다음 자료는2,3으로 구분. 이전 요청의 서버 차수별 이어하기 유지.

| 동작 | 원천/소비자 | 부작용 |
|---|---|---|
| 업로드 | 기존 parser/매칭과 단위·수량 그대로, 이미지 미리보기 추가 | 웹 전용 사용자별 immutable image 파일 저장, ERP 보존 |
| 검토 | pending[request/purchase]의 원문·매칭·수량·단위, 이미지 id | 서버 초안 자동저장만. 합산/주문 제외 |
| 요청수량N 저장 | pending id를 batch id로, rows에 batchId; 동일 id 중복 금지 | 서버 초안 CAS 저장, 성공 후 저장완료 표시. 요청 합산에 포함 |
| 품목 선택 | 기존 saveMapping overlay 정책 그대로 | WebHotelMiuProductMap 기존 동작만 |
| 주문등록 | 미저장 검토가 있으면 먼저 저장/취소 안내 | 기존 my-customer ADD/expectedCurrentQty/전후검증 유지 |

기존 저장 행은 요청수량1/발주수량1로 표시하며 삭제/수정량이 최신 합산에 반영된다. 스키마 및 ERP SQL 변경 없음. 기존 실제 FormOrderAdd dnSpy/읽기 probe(2026-10-27 golden) 재검토. 신규 endpoint는 인증 사용자별 파일 외에 DB를 읽거나 쓰지 않는다. Order/Shipment/Stock/Estimate/WebProfitReport/금액/확정 보존.

검증: pending 제외→명시 저장 포함,중복 클릭/실패 재시도,CAS,교차연도/구형초안,이미지 소유권·경로·크기·형식,실제 UI 이미지 옆 매칭/수량 수정/저장·재로드. 메뉴 기준 단일shell/페이지스크롤/키보드/원문대조/실제반영전확인 적용. 외부 OCR 품질은 별도이며 이번 변경은 기존 매칭결과를 수정하지 않는다.
