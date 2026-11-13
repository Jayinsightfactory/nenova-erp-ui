# 개인업무 시간·바로가기 적용 기준

2026-11-12, 사용자 승인한 docs/design/task-launch-1112 디자인 적용.

| 사용자 동작 | 개인업무 JSON | 공유 ERP 테이블/견적/재고 |
|---|---|---|
| 조회·시간순/시간표 표시 | 읽기 | 모두 보존 |
| 추가·수정·완료·삭제·복구 | 기존 계정별 CAS/원자적 저장 | 모두 보존 |
| 메뉴/웹 바로가기 실행 | 변경 없음 | 모두 보존 (화면 이동만) |

기준 원천: 사용자 디자인 합의 + 기존 personalHomeStore occurrence/version 계약 + desktop main의 인증 상태/동적 bootstrap 메뉴.

- startTime/endTime: 선택, 빈 문자열 미정, KST HH:mm 00:00~23:59. 종료가 있으면 시작 필수, 종료>시작. 자정 경계 업무는 분리. omitted는 기존값 보존, explicit empty는 해제. 표시/저장/메인 IPC가 task-settings.normalize를 사용한다.
- shortcut: null 또는 {kind:desktop|web,target,label}. null 해제, omitted 기존값 보존. label1~24자. desktop은 상대 메뉴 경로이며 실행 직전에 현재 계정 bootstrap 목록과 정확히 대조, 로그인/API/쿼리/해시 거부. web은 http(s), 자격증명/제어문자/비웹프로토콜 거부. 메인 프로세스가 정규화한 URL만 시스템 브라우저로 열며 확인창 뒤 계정 재검증.
- 선택 occurrence의 시간/링크 즉시 수정, 반복 규칙은 기존 계약대로 max(선택일,KST오늘) 다음날부터. 전년/이전 실행 snapshot 및 완료 보존. title-only 구형 클라이언트가 시간/링크를 지우지 않는다.
- 홈 처음8개, 전체보기/과거이월/보관/기존소식 유지. 날짜→시간→ID 안정정렬, 미정 아래. 시간표의 빈 시간 선택은 추가 폼을 열고 시간 입력. 실제 완료와 이동은 분리.
- 메모장 기본 content폭320/최소폭280, 제목12px·보조10px·기본행51px. 추가/편집은 dialog, 기존 알림/고정/복사/삭제 유지. 길면 줄바꿈/페이지 스크롤, 정보 숨김으로 숫자를 맞추지 않는다.
- 새 네트워크 API/SQL 없음. 기존 계약 확장, 소유자·CAS·멱등 요청·계정변경 fencing·기존 저장본·전년 동일날짜 fixture 유지.

검증 계획: normalize 양성/경계/오류/생략·해제, 저장→재조회·구형수정·과거/교차연도·계정분리·CAS, 실행 권한/계정전환·이동후완료불변, 실제 shell/notes Chromium320/1920·키보드·8개·시간표·오류입력보존, Electron IPC, 공식 ERP/manifest/writeguard/dnspy/build, 실제 합성가이드 촬영/재생, PR CI/배포/설치파일.

## 2026-11-13 메뉴 검색 보완
- 메뉴명/분류 NFKC·대소문자·공백 정규화. 검색어는 UI에만 유지, 현재 계정 메뉴에서만 필터. 선택 경로는 검색만으로 변경하지 않는다. 검색 결과와 다른 기존 연결의 묵시적 저장 차단. Enter 첫 후보 명시선택(업무등록 아님), ArrowDown 목록 이동, Escape 검색초기화 후 창닫기. 없는결과 안내/메뉴갱신·기존연결·웹전환·좁은창 회귀검증. backend/IPC/SQL/개인업무 저장계약 변경0.
