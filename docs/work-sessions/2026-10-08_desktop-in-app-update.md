# 2026-10-08 PC 앱 내부 업데이트

Q. 재설치 파일을 직접 받지 않고 앱에서 업데이트 버튼으로 적용하고 싶다.
A. 1.3.0에 앱 업데이트 확인/다운로드/취소/재시작 적용을 추가한다. 기존 웹 메뉴 갱신과 구분한다. 이전 앱은 업데이트 코드가 없어 최초 1회 설치가 필요하다.

ERP 원장 및 API 쓰기 없음. 로컬 shell만 updater IPC를 호출하며 다운로드 중 업무 view는 보존한다. 설치 승인 전 입력 저장 안내, 취소 기본, 공간 검사와 snapshot 저장 성공을 확인한다. 실제 Windows 설치/복구는 사용자 PC에서 시험하지 않는다.

프로젝트 CODEX_SUBTASK_ORCHESTRATION.md는 현재 checkout에 없어 사용자 제공 AGENTS 역할 규칙에 따라 read-only 설계/코드 검토를 위임했다.

검증: 단위 17건, 1920×1080/800×1080 Electron shell smoke, 별도 프로세스 2025/2026 탭·즐겨찾기 복원 통과. 실제 NsisUpdater로 정상 bytes 다운로드/SHA512 일치 및 변조 bytes 거부 검증(설치 실행 금지). 최초 shell smoke의 UA 및 상태 렌더 오류를 수정했고 최종 smoke 통과. 한 차례 키보드 focus 타이밍 timeout은 재실행에서 통과했으며 CI에서도 확인한다.

실제 NSIS 교체/권한 상승/설치 후 재시작은 격리 VM에서 아직 검증하지 않았다. 사용자 PC의 설치기 실행은 하지 않는다. 서명되지 않은 기존 배포와 동일하며 HTTPS/GitHub 배포 권한+SHA512에 의존한다.

배포 검증:
- PR #964, functional head efc307c73eb43dd14fa8265b836cc51d3b512c06, master merge d183d0c93173a4e8a8da0e984b89104a5c0e3dcc.
- 로컬 ERP 전체/빌드/dnSpy/manifest/쓰기 guard 통과. CI Windows37712552848, ERP37712552942 통과.
- desktop-v1.3.0 assets를 검증한 뒤 GitHub latest로 활성화. 111698041bytes, SHA256 498F8F1CF4BBE100FEE051CC37E93CC0BC4273511484C7E1178066FC14626CD6. SHA512는 같은 빌드 latest.yml과 일치.
- ASAR production source, package version1.3.0, updater6.8.10 확인. builder가 package.json에서 빌드 전용 메타데이터를 제거하므로 파일 byte equality 대신 version/dependency 검증.
- 실제 packaged EXE는 별도 임시 프로필로 실행, 공개 feed를 키보드 Enter로 확인해 current/version1.3.0 수신. installer 실행 없음. 검증용 프로세스만 종료.
- 이전 latest tag desktop-v1.2.1에는 native feed가 없으므로 배포 중단 시 해당 tag로 돌리면 신규 업데이트 확인이 실패한다. 정상 feed 복구는 1.3.0 assets를 유지하거나 더 높은 수정버전으로 수행한다.
- Cafe2437712795903 배포 및 hydration smoke 성공. master Windows37712795851 / ERP37712795837 성공.
- 운영 로그인 페이지1920×1080에서 PC 다운로드 버튼을 키보드로 실행, 1.3.0 파일 다운로드 및 SHA256 일치, 원래 페이지 유지 확인.
