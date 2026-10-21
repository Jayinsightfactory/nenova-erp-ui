# 매칭 이후 인식값 수정·입고 준비 연결

## 범위와 기준
- 품목 매칭 완료와 인보이스 검증 완료를 구별한다. 오류를 지우거나 확인 표시만으로 통과시키지 않는다.
- 원본 날짜·통화·총액의 현재값/기대값/차이를 목록에 표시하고 해당 입력으로 이동한다.
- 상품 금액 합계 + 국가별 명시 부대비 = 송장 총액, 허용차0.01 유지. 빈 값은0으로 대체하지 않는다.
- 수정 사유와 원문은 보존. 실패 시 입력 유지. 재검증 성공 후 기존 입고 준비 CTA로 이어진다.
- 2025/2026 날짜·세부차수 보존. 생성 파일은 다시 만들고 기존 서버 승인/쓰기 권한을 재사용하지 않는다.

## 부작용 표
| 동작 | Product | WarehouseMaster/Detail | Order/Shipment/Stock/Estimate/WebProfitReport |
|---|---|---|---|
| 오류 표시·수정·재검산·변환 | 조회용 목록만 사용 | 보존 | 보존 |
| 격리 파일/브라우저 테스트 | fixture | fixture만 | 운영 접근 금지 |
| 실제 입고 승인 | 기존 계약 그대로 | 기존 명시 승인 writer | 기존 계약 그대로, 이번 변경 없음 |

## 근거
저장된 dnSpy ExcelLoadingPackingList.MakeTempTable/CheckData/InsertMaster 재확인: BOX/TOTAL BUNCH/TOTALSTEAM/UPrice/TPrice 독립 필드, 명시 입고 저장 경계 유지. docs/exe-golden/FormWarehouseUpload.md 및 DB_STRUCTURE.md 참조. 신규 SQL/SP/ERP writer 변경 없음.

## 검증 기준
정상값, 날짜/통화/총액 오류, NL handling 누락, 명시0, 수량 오류, 미지의 추출 오류 보존, 교차연도, 수정 실패 후 초안 유지, 실제 중국 PDF 로컬 파싱·수정·생성·입고 어댑터 검증. 운영 DB 수정 및 유료AI 호출 금지.
UI: 기존 shell 보존, 목록 페이지 스크롤·반응형·키보드 적용, PDF 대조 모달 내부 스크롤은 예외.
