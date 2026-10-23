# 네덜란드 물량표 추가 업체·수량 Excel 왕복

## 질문 → 답변
- Q: 추가 업체·수정 수량을 다운로드하고 다시 업로드해도 동일 분배인가? dnSpy와 기존 MD를 검토하여 수정·배포해 달라.
- A: 기존 추가 업체는 화면 투영만 했고 다운로드는 added 행을 건너뛰었다. 별도 ERP적용초안은 기존 업로드에서 읽지 않아 누락됐다. 원본 지역 열을 실제 생성하고, 표시 셀을 수량의 유일한 원천으로 재업로드하도록 수정했다.
- Q: 작업 저장만 하면 ERP 분배되는가?
- A: 아니다. 작업 저장·다운로드는 원장 변경 없음. 재업로드 후 새 검증과 명시 등록·분배 적용이 필요하다. 기존 주문 보존·출고 최종 SET·누락 쌍0 정책은 유지한다.

## 변경
- 공통 projectDutchInlineCustomers를 다운로드에도 사용. 지역 열 삽입, 수정 수량, 합계 캐시/수식, 이동된 참조, 단가 사각형 좌표 동기화.
- ERP적용초안 V1은 연도·차수, 매칭키, 단위, 단가 빈값/0/양수, 일괄 설정과 원본 셀 식별만 저장. 수량은 원본 숫자 셀에서 읽음.
- 재업로드 파일이 오래된 로컬 초안보다 우선. 잘못된 연도·차수/셀 이동/삭제/음수/연결정보 중복은 차단. 구형 추가행 별도 시트 파일은 새 버전 재다운로드 안내.
- 업로드 파일 키는 명시 입력과 동일한 검증을 거침. LIVE _keymap 신뢰·서버 계획 재사용 없음.

## 검증
- 실제 xlsx-js-style 직렬화→재파싱 2회, 추가업체12.5/기존7/0취소, 단가15000/0/빈값, 단위·키, 합계, 수식, 2025/2026 범위 차단 통과.
- 격리 SQL 실제 export/import→API preview→apply: 동일 수량/단가 계획, 기존 주문 보존, 신규 양수 주문, 환산단위, 누락0, native NULL, 날짜/농장/확정/동시변경/중복/rollback, Estimate/WebProfitReport/Stock/Warehouse 보존 통과.
- 실제 dnSpy 재실행 및 SELECT-only 운영 기준선은 exe-golden/DutchVolumeDistribution.md 참조. 운영 시험 분배는 하지 않음.
- 전체 ERP 계약, pivot, dnSpy evidence, manifest, write guard, UI layout, production build 통과. 최신 master 중국 보호 로직 병합 후 SQL/전체 계약/가드/빌드 재실행도 통과.
- PR #1278 squash merge 6cb792063881b6a71a2bb6d49bc968a8d2cc82ab. GitHub verify 39918798245 성공. Cafe24 배포 39919158769 및 hydration smoke 성공.
- Chrome 운영 v6cb79206에서 테스트 원본 업로드→주광 수량1→7→일신원예 KCL52 추가→수량12→다운로드→재업로드 확인. 실제 다운로드 파일 D4=7,F4=12,G4=19,G6=21,F3=일신원예/KCL52. 재업로드 4행(명시0 포함) 동일 수량 확인.
- 파일43-02에서43-01 선택 시 차수 불일치 안내와 entries 비움 확인;43-02로 돌아오면7/12/전체21 복원. 브라우저 console error0.
- 합성 fixture의 Campanula 이름은 운영 품목 미매칭으로 정상 차단됨. 이를 억지 매칭하거나 운영 ERP 적용하지 않음. 실제 저장 성공 검증은 격리 SQL fixture에서 수행했다.
- 운영 다운로드: C:/Users/USER/Downloads/roundtrip-browser-source_물량표.xlsx. 화면 증거: C:/Users/USER/nw-dutch-roundtrip/roundtrip-production-proof.png. 배포 후 같은 SELECT-only 기준선 재조회도 동일.

## 후속 시작점
branch codex/dutch-roundtrip, worktree C:/Users/USER/nw-dutch-roundtrip. lib/dutchVolumeWorkbook.js, __tests__/dutchVolumeWorkbook.test.js, scripts/test-dutch-volume-distribution-sql.cjs 참조. 테스트 실패 시 배포 중지.

검색어: dutch-xlsx-roundtrip 추가업체 다운로드 재업로드 ERP적용초안 NENOVA_DUTCH_MATRIX_V1
