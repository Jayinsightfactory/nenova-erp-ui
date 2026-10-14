# 패킹 팀 공용 DB 매칭 조회·수정

## 범위/수용 기준
- 파일 업로드 없이 패킹 페이지 상단에서 팀 공용 `packing.erp-matches` 목록 열기. 기존 변환 별칭/seed 목록과 명확히 구분.
- 국가(기본 전체), 원문/DB 품목명/코드 검색, 상태(전체/확인 필요). 표는 원문, 국가, 저장된 DB 연결 이름/코드, 상태, 수정 버튼. 전체 이름 줄바꿈, 페이지 세로 스크롤, 1920×1080/100% 우선.
- 수정은 원문/국가 identity 보존하고 연결 DB 품목만 변경. 기존 후보 모달 재사용, 단일 클릭 저장/닫기, 오류·409 선택 보존 및 재조회 후 재선택.
- 삭제/일괄변경/새 SQL writer/새 권한은 추가하지 않음. 이미 입고한 문서에는 소급 적용하지 않음.

## 기준 ledger와 부작용
|동작|원천/공통 기준|저장 영향|ERP 원장|
|---|---|---|---|
|조회/검색|기존 GET products/value/revision, packingErpAliases와 같은 country+ProdKey+ProdName+selectable 조건|없음|Product SELECT 외 모두 보존|
|수정 열기|fresh GET, 기존 country+sourceKey 존재 확인, 최신 연결명 표시|없음|모두 보존|
|품목 선택|기존 POST upsertPackingErpMatch + expectedRevision CAS|해당 웹 팀 매칭 연결 및 기존 감사 이력|Product/Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport 모두 보존|
|수정 완료|새 snapshot 설치, 현재 파일 매칭 미리보기 재계산, 생성 바이트 무효화|원문 검토/파일 보존|입고 자동 저장 없음|

기본 전체 국가/빈 검색/전체 상태. 이름 변경/삭제/동명 모호/다른 국가 연결은 정상으로 표시하지 않는다. 원문 키는 packingSourceKey 사용. 차수별 원장에 접근하지 않으므로 이전 연도 동일 차수와 현재 연도 모두 불변.

## 근거와 검증
직전 작업에서 확인한 ExcelLoadingPackingList.MakeTempTable/CheckData ProdName+SIZE 정확연결과 독립 수량/명시 입고 경계 유지. 기존 product-matches GET SQL과 POST가 PACKING_PRODUCT_SCOPE_SQL/packingErpProducts를 공유함을 재확인. 운영 GET에서 실제 품목/매칭 수만 확인하며 테스트용 운영 매칭 변경 금지.
단위/컴포넌트: 정상/미등록/이름변경/동명/다른국가, 검색/필터, 업로드 없는 수정, CAS409, 실패 유지, 현재 파일 검토 유지. 전체 ERP contract/dnSpy/manifest/write guard/build, 로컬 mock UI와 운영 읽기 전용 smoke.
