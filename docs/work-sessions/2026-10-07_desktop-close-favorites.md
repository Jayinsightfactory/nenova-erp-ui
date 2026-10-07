# PC 닫기 확인과 기본 즐겨찾기 메뉴

Q. 계속 작업/진행 대신 닫기/취소로 바꾸고, 즐겨찾기는 메뉴 활성화가 기본값이다.

A. 닫기 확인을 닫기/취소로 변경했다. 기본/취소 키는 취소로 유지한다. 이동과 새로고침에는 해당 동작명을 쓴다. 시작 및 계정 로그인 후 저장된 탭을 복원하면서 메뉴를 먼저 열고, 즐겨찾기 영역은 등록 전에도 표시한다. 업무 중 메뉴는 접을 수 있고 탭 한 줄 기본 배치는 보존한다.

- 버전: 1.2.1. 웹 PC 다운로드 버튼도 새 파일로 연결한다.
- ERP 원장 쓰기 없음.
- 닫기 취소/승인 및 beforeunload 취소, 별도 프로세스의 탭·즐겨찾기 복원+메뉴 기본열림을 검증한다.
- 기존 설치기를 사용자 PC에서 실행하지 않는다. 설치 파일은 별도 배포하며 검증은 격리된 프로필로 실행한다.
## 검증·배포 기록

- 사용자 확인: 시작할 때 메뉴 열림 + 즐겨찾기 우선 표시. 메뉴 버튼을 누르면 즐겨찾기 다음에 권한별 전체 메뉴가 보인다.
- 로컬: 단위 12건, Electron smoke, 별도 프로세스 restore, ERP 전체 검증/Next 빌드, dnSpy evidence, origin/master 기준 manifest/쓰기 guard 통과.
- 1920×1080 / 800×1080 smoke 화면 확인. 패키지 실행 격리 프로필에서 버전 1.2.1, 로그인, 2개 창, 원격 Node/bridge 비노출 확인.
- ASAR main.cjs/shell.js와 커밋 소스 일치.
- PR #958: Windows installer 및 ERP CI 통과 후 병합 e882145a4054e040644bc47619cc748816443e06.
- 공개 릴리스: https://github.com/Jayinsightfactory/nenova-erp-ui/releases/tag/desktop-v1.2.1
- 파일 111372617 bytes, SHA256 58031FEA683908579A0C8C173FEE9A0CF1256343DB199C82CAC03ADF5E7D68F3. GitHub asset digest 일치.
- 현재 사용자 PC 설치기 실행/앱 교체 없음. 새 버전 적용은 설치파일로 업데이트해야 한다.
- Cafe24 배포 37594306687 성공, hydration 실브라우저 스모크 성공.
- 운영 https://nenovaweb.com/login, 1920×1080에서 PC 다운로드 버튼 키보드 실행 → 1.2.1 파일 다운로드 완료, SHA256 일치, 원래 로그인 페이지 유지 확인.
- master Windows/ERP CI 37594306605 / 37594306550 성공.
