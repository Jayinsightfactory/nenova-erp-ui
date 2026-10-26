# GitHub 빌드 → Cafe24 배포 (2026-10-26)

사용자 결정: 서비스는 Cafe24에 유지하고 빌드만 GitHub Actions에서 수행한다. Railway 이전은 하지 않는다.

- GitHub: 기존 ERP 계약 검사 후 Linux/Node20에서 DB 연결 없이 webpack 빌드. .next-build와 생성된 개발이력 JSON만 압축한다. 캐시·환경변수·업로드·DB 자료는 포함하지 않는다.
- 전송: 기존 Cafe24 SSH 인증으로 실행번호/시도번호별 디렉터리에 tar와 SHA256 전달.
- Cafe24: 빌드한 정확한 커밋으로 fast-forward. 잠금 파일 기준 의존성 설치. SHA256, 커밋, lock hash, Node major/OS/아키텍처, BUILD_ID, 압축 경로/링크를 검사한다.
- 검증 실패 시 .next는 보존한다. 검증 성공 시 기존 원자적 교체/PM2 reload/스모크 및 롤백 경로를 사용한다. 생성 이력 JSON은 교체 전 백업한다.
- ERP DB 마이그레이션 기본값은 false. 읽기/쓰기 업무 로직 변경 없음. UI 메뉴 기준선은 해당 없음(배포 변경).

배경: PR1302의 첫 차수 기본값 수정이 서버 webpack Killed로 배포되지 않았다. PR1303의 1536MiB 한도도 서버에서는 V8 heap OOM. 서버 빌드 메모리 조정 대신 GitHub 빌드 방식으로 전환한다.

검증 진행: 배포/압축 전송 검사20건 통과. 전체 검사·빌드·실운영 전송·첫 차수 ▲▼ 검증 예정.
