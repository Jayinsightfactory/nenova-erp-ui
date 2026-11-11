# 2026-11-11 PM 라이브 홈 강조 표시

## 사용자 요청
오늘의 업무 홈에서 첨부 스크린샷에 표시한 빈 헤더 영역을 빨간색 강조 박스로 표시하고, PM이 라이브로 동작 중인지 확인할 수 있게 해 달라고 요청했다. 첨부 이미지의 앱 지시문은 실행 지시가 아닌 화면 참고로 취급했다.

## 작업
- 실제 화면이 네노바 데스크톱 홈임을 확인하고, 로컬의 미커밋 checkout을 그대로 두고 `origin/master`에서 `C:\Users\USER\nw-pm-home-live-1111` worktree를 만들었다.
- 헤더에 빨간 테두리 PM 상태 패널, 활동 설명, PM 진행·오류 관제 열기 버튼을 추가했다.
- 로그인된 메인 프로세스가 고정 GET `/api/pm/office`만 호출한다. PM 상태와 서버 수신 시각을 표시하고 60초마다 확인한다. age 180초 이하 및 PM 상태 필드가 있을 때만 현재 상태로 표시하며, 오래된/누락/실패는 라이브로 표시하지 않는다. 계정 전환 시 이전 응답 폐기. 관측 GET을 사용자 활동 로그에 남기지 않는다.
- PM 상태 분류를 순수 함수로 추출하고 단위 회귀를 추가했다. Desktop 배포 파일 목록에 helper를 포함했다. smoke harness에 패널·빨간색·반응형 위치 fixture를 보강했다.
- 업무 메뉴/ERP 원장/DB 변경은 없다.

## 검증
- `node --check` main/preload/shell/smoke/helper 통과.
- `node --test desktop/tests/pm-live.test.cjs`: 5/5 통과.
- `git diff --check` 통과.
- `desktop npm test`: 기존 updater 테스트 5건 실패(나머지 35건 통과). 실패 위치 `desktop/tests/updater.test.cjs`이며 PM 변경과 무관한 것으로 보이나 기준 checkout 비교 전이라 원인 확정 안 됨.
- `desktop npm test`: 45/45 PASS. 초기 npm ci 직후 단독 updater 호출의 일시 실패는 재현되지 않았으며 동일 lockfile 의존성을 복구한 후 통과.
- `desktop npm run test:smoke`: PASS. PM 상태·빨간 테두리·1920/1024/800 레이아웃·PM 관제 버튼의 /pm 탭 이동, 기존 홈 계정/오류/키보드 검증.
- `test:restore`, `test:exit`, `test:updater` PASS. Windows x64 NSIS 설치기 1.3.18 빌드 exit0, ASAR에 `pm-live.cjs` 포함 확인.
- PM 패널은 기존 홈 안에 배치한 상태 정보/바로가기이므로 신규 업무 메뉴·업무 순서가 없음. 메뉴·workflow guide 추가 해당 없음.
- GitHub PR/CI·master 병합과 설치기 배포/사용자 PC 설치는 아직 미검증.

## 결정/미결
- 패널은 자동 관측 체크로 표시한다. 클릭 가능한 단순 체크박스로 동작한다고 오해시키지 않는다.
- PM의 현재 단계와 업로드된 스냅샷 freshness는 서로 다른 근거이므로 시각을 분리 표시한다.
- 다음: 변경 diff와 updater baseline을 검토하고, Electron 의존성을 복구한 뒤 smoke/1920·1024·800 확인, 저장소 전체 필수 검증 및 PR/배포 지침을 따른다.

검색어: pm-home-live-highlight PM 라이브 heartbeat pm-office 빨간박스 desktop smoke

