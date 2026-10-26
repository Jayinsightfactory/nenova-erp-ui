# 초안 중복 POST로 다음 단계 차단

## 사용자 질문과 결정
- Q: 다음으로 계속 넘어가야 하는데 초안 저장에서 `POST can only create a new invoice document`로 멈춘다.
- A: 고정 sourceHash/index 문서ID에 대해 화면 재준비가 revision=null을 재생성하고 기존 GET을 하지 않는 원인 확인. 서버 POST 신규 전용 보호를 없애지 않고 화면 재개 흐름 수정.
- 운영 DB 수정 없음. 실제 EXE dnSpy InsertMaster의 입고→재고계산 순서 재확인, 해당 writer 변경 없음.
- 이전 스크린샷 문서는 SELECT-only로 2026/44-01 DRAFT revision1 존재 확인. 이번 메시지의 정확한 실패 문서 ID는 미제공이므로 동일 문서라고 단정하지 않음.

## 구현
- 최초 원본 준비 시 기존 문서 GET. 문서ID/hash/연도/차수/양수버전 검증 후 저장값 재개, 명시404만 신규.
- 같은 화면 source 재준비는 source baseline 3-way 병합으로 명시 편집/저장버전/rowVersion/작업이력 유지. 다른 직원의 변경을 PATCH로 자동 덮어쓰지 않음.
- revision null/빈값/0은 null 유지. 신규 POST payload에 expectedRevision=0을 넣지 않음.
- 동시 생성·버전충돌은 한국어 재조회 안내와 기존 복구 버튼 제공. 실제 입고/원가 명시승인 및 낙관적 잠금 유지.

## 검증
- 집중56 tests 통과: 신규→next 반복→refresh→편집PATCH, saved 재업로드, 매칭/수량 편집 보존,404/403/500/네트워크 구분, 교차연도/다른hash,409 복구.
- ERP contract/dnSpy/manifest/write guard, webpack build 통과. localhost 격리 SQL 입고/원가/export/rollback/busy gate fixture 통과.
- CUA 실제 Workbench+실제 adapter, 로컬 mock API: 동일 인보이스 기존rev3 자동 연결→next→목록 갱신→메모 편집→PATCH rev4→next 반복→ERP 최종 확인 모달→Escape 초점복귀 검증. POST /drafts 0회, PATCH1회, preview3회. 실제 인보이스 AI 분석/운영 입고 등록 테스트와는 구별.
- 증빙: outputs/draft-next-verified.png (로컬 비커밋), draft-next-ui.log. 운영 DB 연결 없는 fixture.
- 메뉴 기준 적용: 기존 화면/키보드·초안/매칭 보존/이슈 안내/명시 승인 유지. 해당없음: 새 메뉴·다운로드·권한 변경.
- 배포 결과 후속 기록. 운영 인증 이후 실제 버튼 조작 미검증.

검색어: invoice-draft-next POST can only create INVOICE_DOCUMENT_ALREADY_EXISTS source resume revision PATCH
