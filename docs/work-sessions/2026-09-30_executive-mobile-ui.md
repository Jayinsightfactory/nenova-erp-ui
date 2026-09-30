# 2026-09-30 임원 모바일 보고서 UI

## 요청과 결정
- 대표·이사 전용 모바일 페이지, ID 없이 공용 비밀번호(미정), 주차별 매출·이익과 라움/신라 순익계산서. 보고서/엑셀 5~10개로 확장 예정.
- 이번 명시 요청은 UI 구성. `/m/executive` 접속 화면, 로그인된 기존 사용자용 `?preview=1` 샘플 화면을 구현했다.
- 실제 비밀번호 인증·마감 자동 게시·실제 금액 및 다운로드는 미구현이다. 화면에 예시임을 명시하고 실제 파일 버튼은 비활성화했다. 주소 비공개만으로 보안을 대신하지 않는다.

## 구현
- 모바일 1열/데스크톱 2열, 차수 선택, 보고서 분류·검색, 3개 기본/10개 확장 미리보기, 상세/목록 이동, 지난 차수.
- 공용 비밀번호 입력 UI는 설정 전 비활성. 인증된 기존 사용자에게만 샘플 미리보기 허용. private no-store/noindex.
- 연도 포함 차수 키: 2025-39는 2026-39 자료를 표시하지 않는다.
- 원장/SQL/실제 보고서/API/권한/비밀번호 변경 없음. 웹 UI 전용 계약은 `docs/ui-contracts/executive-mobile-ui.json`; ERP dnSpy 계약을 허위로 작성하지 않는다. ERP read/write 및 EXE probe는 이번 UI-only 경계에서는 해당 없음.
- `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 현 checkout과 origin/master에서 존재하지 않아 하위 작업을 생성하지 않았다.

## 검증
- `node __tests__/executiveReportPreview.test.js`: 인증 조건, 목록 3/10개, 교차연도, 필터/검색, 실제 React SSR.
- `npm run test:ui-layout`, `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, manifest/write guard(origin/master 기준), production build 통과.
- 브라우저 로컬 실제 컴포넌트: 390×844, 320×760, 1920×1080 CSS pixel. 가로 overflow 없음, 상세/뒤로가기, 연도별 빈 상태, 10개 확장/기타/축소/검색 검증. 기존 ERP 호출 없는 fixture harness.

## 다음 연결 작업
- 공용 비밀번호 확정 후 서버 인증, 시도 제한·세션 만료·파일 요청별 권한 확인. 비밀번호나 원본 파일을 클라이언트 번들에 포함하지 않기.
- 실제 마감 상태 + 금요일 이후 조건으로 게시; 보고서별 원본/수정본/생성 실패 이력 및 Excel 권한 연결.
- 샘플 데이터는 실제 운영 자료로 오인하지 않도록 유지 또는 실제 연결 시 제거.

## 배포
- 배포 전 UI 검증 기록. PR/운영 결과는 완료 후 기록한다.
