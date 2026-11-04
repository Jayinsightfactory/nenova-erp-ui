# 중국 자동물량표 분배단가

|항목|내용|
|---|---|
|기간|2026-11-04|
|화면|/stats/china-volume-board|
|범위|업체×품목 입력 단가 → 기존 중국 등록·분배 저장|
|ERP 부작용|명시 단가만 기존 shared writer로 Cost/Amount/Vat 동기화; 기존 주문 보존|
|검증|dnSpy 실제 실행, 운영 SELECT-only, 격리 SQL 실제 저장·재조회, 실제 Next 브라우저|
|배포|로컬 전체 ERP/dnSpy/manifest/write/UI-layout/build PASS. PR/운영 확인 진행 중|

## 고정 결정
- 사용자 `aside` 의미 확인: 격리 환경 실제 저장·재조회. 운영 테스트 값 쓰기 금지.
- 박스번호 기능 보존. 단가와 박스번호는 별개다.
- 원화·ERP EstUnit 단가, 공란/누락은 기존 유지, 명시0 허용. 개별 업체×품목만 변경.
- 작업 저장은 웹 초안, 등록·분배 저장은 검토창 명시 확인 후 ERP 반영.
- 기존 주문 보존/신규양수 주문 생성/확정·stale·교차연도·native readback 가드 유지.

### 1. 요청
**Q.** 중국도 단가 입력하고 등록·분배 시 저장, MD/dnSpy 확인 및 실제 테스트.
**A.** 화면 payload에 unitPrice가 없고 서버 중국 분기가 단가를 명시 거부하던 원인 확인. 기존 네덜란드 shared writer 연결, 브라우저/서버 공통 가격 정규화, CellsJson 저장/복원 및 인보이스 재적용 보존, 현재→적용 단가 검토 추가.
**결과.** `docs/work-plans/2026-11-04-china-price-input.md`에 기준·부작용·실제 dnSpy/DB 근거.

### 2. 격리 검증
**Q.** 격리 테스트에서 실제 저장·재조회 검증.
**A.** localhost 무마운트 SQL 컨테이너의 임시 DB에서 실제 preview/apply 후 별도 SELECT로 상세/날짜 단가·금액·VAT 확인. 양수/0/공란·신규행·교차연도·기존 주문·downstream 보존, 날짜 단가 변조 및 후반실패 전체 rollback PASS. 네덜란드 전체 교체 SQL 회귀도 PASS.
**결과.** `scripts/test-china-volume-distribution-sql.cjs`, `scripts/test-dutch-volume-distribution-sql.cjs`. 테스트 DB만 종료 시 제거. 브라우저는 loopback fake API로 입력·Enter이동·저장/새로고침·preview payload 검증, 실제 SQL 증거와 구분한다.

## 남은 확인
PR CI/병합, Cafe24 배포 및 운영 읽기 전용 smoke가 남았다. 실제 EXE GUI 조작 테스트는 수행하지 않았다. 공유 SQL 호환성을 dnSpy 원문/격리 DB readback으로 검증했다. CUA 브라우저 inventory는 Work 설정의 Local browser use disabled를 반환하여 운영 로그인 UI 직접 확인은 현재 불가.
로컬 `china-price-review.png`는 가상 데이터 화면이며 커밋하지 않는다. build 자동 생성 history JSON 변경은 이번 변경에서 제외했다.
