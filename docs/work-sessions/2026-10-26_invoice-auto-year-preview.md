# 인보이스 연도 자동 입력·서버 검증 복구

## 고정 결정
- 사용자 최신 요청에 따라 인보이스 날짜의 유일한 4자리 연도를 입고 연도 기본값으로 사용한다. 이전 세션의 무조건 수동 정책을 대체한다.
- 명시 차수/파일명 연도 우선. 현재연도 fallback 없음. 원본 연도와 충돌하면 선택 연도를 담당자가 확인하며 서버 초안 검증도 동일 정책 적용.
- 선택 연도 수정 시 이전 확인을 해제한다. 기존 저장 문서의 연도·입고일은 자동 변경하지 않는다.
- 운영 주문/입고/재고/원가 수정 없음. 실제 preview 진단은 감사 INSERT wrapper를 제외한 읽기 전용 함수만 사용.

## Q&A
**Q.** 인보이스에 연도가 있는데 입고 연도를 자동 입력할 수 없나? 서버 검증 실패 화면 첨부.

**A.** 인보이스 연도 자동 제안 및 근거 표시/충돌 확인 구현. 실제 EXE ExcelLoadingPackingList의 G3 날짜 연도 저장 근거 재확인.

첨부 문서 966a9e13…는 2026/44-01 CO DRAFT rev1로 연도 정상. 원문 날짜 2026-10-23. 기존 ViewOrder의 음수 조정 수량을 순수 대조 함수가 거부하여 generic503이 발생함을 SELECT-only preview로 재현했다.

기존 주문의 음수 조정은 그대로 순수량에 합산하도록 수정했다. 신규 입고 draft/receipt의 음수 허용으로 확대하지 않았으며 원장 수정도 하지 않았다.

**실제 데이터 재검증.** 같은 문서 SELECT-only preview 정상 완료, 151개 대조 행. 남은 이슈는 INPUT_DATE_REQUIRED / FARM_REQUIRED. 실제 입고일과 공급 농장은 담당자 입력 필요. 실제 입고 등록은 미실행.

## 검증·메뉴 기준
- focused 73개 통과: 날짜 형식/누락/충돌/기존 선택/교차연도/서버 확인/음수 주문 순합산/음수 초안 차단/overflow.
- CUA 실제 Workbench 격리 mock: 원본 연도 근거 표시, 2025 변경 시 충돌 차단, 확인 버튼 Enter 조작. 실제 업로드 파싱·DB 쓰기 end-to-end와 구별한다.
- 적용: 기존 화면틀·입력·직접수정 유지, 원본 근거 표시, 확인 후 연도 입력으로 초점 복귀. 새 메뉴/권한/다운로드 변경 없음.
- 전체 ERP contract/dnSpy/manifest/write guard 및 webpack build 통과. 격리 SQL writer fixture도 통과(운영 연결 없음): rollback, busy gate, 교차연도, 입고/원가 저장·재조회·export 및 보호 원장 보존.
- SQL fixture의 오래된 `추정 통관비` 표제 기대값은 현재 exporter의 TEST_ONLY 우선 정책과 달랐다. 실제 코드 기준으로 TEST_ONLY 표제와 비교 시트 A9 모두 검증하도록 수정했다. 원가 계산 코드는 변경하지 않았다.
- PR/배포 결과는 후속 기록. 운영 로그인 이후 화면 스모크는 별도 확인 필요.
- 로컬 outputs 및 autoyear-*.log 비커밋. 관련 계획: docs/plans/invoice-autoyear-2026-10-26.md.

검색어: invoice-auto-year-preview invoiceDateYear signed orders 966a9e13 44-01 INPUT_DATE_REQUIRED FARM_REQUIRED
