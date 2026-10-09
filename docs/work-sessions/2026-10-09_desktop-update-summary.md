# PC 시작 화면 업데이트 안내 — 2026-10-09

사용자 요청: 시작 화면의 즐겨찾기 아래에 있던 업데이트 버튼을 제목과 검색 사이 상단 중앙으로 옮기고, 바뀌는 내용을 짧고 이해하기 쉽게 표시한다.

- 구현: 상단 제목/업데이트/검색 3열. 1120px 이하는 검색을 다음 줄로, 800px 이하는 순서대로 세로 배치한다. 기존 업데이트 확인/다운로드/취소/재시작 동작과 상태 ID는 유지한다.
- 업데이트 메타데이터의 releaseNotes를 최대3개/문장240자로 제한하고 일반 텍스트로 표시한다. 안내 없는 경우 설치 버전의 기본 요약을 표시한다. 오래된 feed를 현재 변경내역으로 표시하지 않는다.
- 1.3.4 releaseInfo에 쉬운 문장3개를 기록하여 이후 업데이트 확인·다운로드 중에도 해당 버전 설명을 유지한다.
- 업무 데이터/API/권한/설치 승인/다운로드 검증 변경은 없다.
- 검증: desktop unit18 통과. Electron smoke1920×1080/1024×1080/800×1080에서 상단 위치·겹침·가로 넘침·긴 문구·일반 텍스트 안전성·고유 ID·기존 lifecycle 통과. 웹필수검증과 패키징 결과는 아래 기록 예정.
- 이 변경은 남은 전체 메뉴 UI 감사 완료를 의미하지 않는다.

## 1.3.4 공개 검증
- PR996: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/996
- source75862699, master a8e116f88a1481005b7fe9ee9bec0e82fed32f6f.
- 공개 https://github.com/Jayinsightfactory/nenova-erp-ui/releases/tag/desktop-v1.3.4
- 설치 파일111699545 bytes; SHA256962b4011ff77bdc114420f312c6d2299a57411af8e259e3cbb9f47e3c9033b60.
- 공개latest.yml/설치URL/크기/SHA512/3줄releaseNotes 확인. app.asar updater와shell이 검증소스와동일함확인.
- local web6종 필수검사 및 Next build115static 모두exit0. PR/최종master Windows+ERP CI 성공.
- 사용자 앱 업데이트/재시작은 실행하지 않았음. 설치 파일도 시험목적으로 실행하지 않음.
- Cafe24 앞선run37871639778 진행중, 자체run37871660422 대기. 서버workflow가origin/master를받으므로 앞선배포에서도최신웹이들어갈수있으나 운영버튼과hydration을직접확인한후완료판정한다.

## 운영 적용 완료
- 앞선 Cafe24 run37871639778 성공. 서버로그 HEAD is now at a8e116f8로 실제이번병합코드적용확인.
- 직접Chrome 1920×1080/800×1080 운영login smoke: 1.3.4다운로드링크, React hydration=true, 가로넘침=false. buildId build-1791510719975.
- 자체후속run37871660422는동일코드중복배포였으며 SSH단계pending인상태에서메인이취소해추가서버재시작을방지했다. 취소는배포실패가아니며 실제배포완료근거는앞선run의commit로그와운영browser이다.
- PC에서업데이트확인→다운로드→재시작으로적용. 사용자설치앱은임의로재시작하지않았다.
