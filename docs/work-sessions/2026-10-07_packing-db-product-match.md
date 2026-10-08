# 패킹 결과 전산 품목 매칭·한 줄 표시

|항목|내용|
|---|---|
|일자|2026-10-07|
|화면|수입부 업무도구 > 패킹 리스트|
|브랜치|codex/packing-db-product-match|
|원장 부작용|Product SELECT만 추가. 주문/입고/출고/재고/견적/매출 변경 없음|
|웹 저장|packing.erp-matches, CAS revision, 인증 계정·전후 매칭 이력|
|배포|최종 검증/배포 결과는 아래에 기록|

## 이어받을 때 고정된 결정
- 이전 미매칭은 업로드 카탈로그 기준이었다. 이번부터 활성 전산 DB Product 기준으로 자동/수동 매칭한다.
- 원문 품목을 눌러 국가별 전산 목록 검색 → 선택 → 서버 검증/공동 저장 → 결과 재생성.
- 국가+원문(한글/한자 보존, 장미 length 포함)을 ProdKey와 연결. 삭제/이름 변경/중복 이름은 재확인 필요, 다른 키로 조용히 대체하지 않는다.
- 결과표는 원문 한 열과 매칭·확인사항 한 열. 우측 중복 카드 제거, 인라인 메모는 기존처럼 해당 화면에만 유지.
- 매칭 저장은 입고 저장이 아니다. nenova.exe 및 운영 SQL 원장은 변경하지 않는다.
- GW/CW/운송비 확인창·원본 근거 표시·다운로드 차단 규칙·카톡 복사는 유지한다.

### 1. 요구와 발견
**Q.** 미매칭 품목을 클릭해 전산 품목 검색·선택, 매칭 재사용, 매칭/이슈를 한 줄로 합치고 여백을 줄여 달라.

**A.** 기존 결과표는 클릭 연결이 없고 하단 별도 카탈로그 선택만 있었다. 실제 DB 아닌 업로드 카탈로그 기준이라는 점을 확인하고 바로잡았다. 참고 카탈로그 업로드는 보관용 접힌 영역에 남겼다.

### 2. ERP·DB 근거
- 실제 decompile ExcelLoadingPackingList.MakeTempTable/CheckData: name+SIZE와 Product.ProdName 정확 일치, isDeleted=0. 따라서 동명 중복은 저장 후보에서 제외한다.
- 운영 읽기 `/api/products/search?country=중국&flower=장미` HTTP200, 활성186개. ProdKey/ProdName/CounName 확인.
- 새 GET/POST는 동일 PACKING_PRODUCT_SCOPE_SQL + packingErpProducts로 후보와 저장 재검증. POST도 SQL SELECT만 하며 웹 파일만 변경한다.
- Estimate, ShipmentDate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport 모두 보존.

### 3. 검증과 검토
- 로컬 브라우저: 실제 중국 XLSX 입력, DB 후보/저장 응답은 fixture. 저장 충돌409 후 재조회/재시도, 재업로드 재사용, 방향키·Enter·Escape·초점복귀 통과. 운영 ERP 쓰기 없음.
- 1920×1080 CSS/100%, 900/480 가로잘림 검증. 최종 행 밀도는 최종 smoke에서 기록.
- 독립 검토가 발견한 NL 사전집계/수동매칭 우선순위, CJK 키 충돌을 회귀 fixture로 보완. 상세 기준은 docs/plans/2026-10-07-packing-db-matching.md.
- 역할: 메인 설계·계약·통합·외부쓰기; gpt-5.6-sol/high 구현3개(terra/luna 미제공 대체), gpt-6.1-sol/high 최종검토. 하위 작업 P0_LOCAL, 메인 사전 준비 후 수행.
- 검토 중 저장 중 모달 포커스 이탈도 수정하고 실행 가능한 빈 포커스 목록/Tab/Escape 테스트를 추가했다.
- 최종 집중/수입부 테스트 32+183(선택적 skip 포함), 지침17개 통과. ERP 전체 계약, dnSpy 근거, manifest와 API 쓰기 범위 가드 통과.
- 실제 XLSX 101행, 수량5390단/68775송이 보존, 매칭 실패409 후 재시도/재업로드 재사용 검증. 1920×1080/100%에서 행31px·품목14px. 900/480px 가로잘림 없음.
- 실제 예시 PDF의 로컬 렌더링과 GW/CW 수정/0값/근거 강조 회귀 통과(추출 응답 fixture, 유료 AI 호출 없음).

## 남은 경계
- 실제 AI 추출 정확도 전체 검증 또는 ERP 입고 자동저장은 이번 변경에 포함하지 않는다.
- output/의 로컬 smoke·스크린샷·로그는 비커밋 검증 자료. 인증값은 기록하지 않는다.
