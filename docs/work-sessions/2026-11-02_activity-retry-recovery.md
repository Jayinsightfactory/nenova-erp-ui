# 활동 기록 33건 보류 복구

## 원인 확인

- 운영 Cafe24 PM2 오류 로그 마지막 4MiB에서 `[user-activity] write_failed` 4,145건을 확인했다. 추가 집계에서 `MODULE_NOT_FOUND` 4,259건, `STORE_ERROR` 40건이었다. 집계 범위와 시점이 달라 두 수치는 일치하지 않는다.
- 운영 파일은 `/var/www/nenova-erp/lib/userActivityWorker.cjs`에 존재하고 `.next/server/pages/api/work/userActivityWorker.cjs`에는 없다. `userActivityAsync.cjs`의 `__dirname` 기준 상대 경로는 Next API 번들 위치에서 없는 파일을 가리켰다.
- 브라우저는 서버 저장 ACK를 못 받은 기록을 로컬 큐에 유지하고 5초 주기로 재전송한다. 사용자 화면의 33건 보류는 이 경로와 일치한다.

## 수정과 검증

- 워커 위치를 배포 서버의 `process.cwd()/lib/userActivityWorker.cjs`로 고정했다. 서버가 `next start`를 저장소 루트에서 실행하고 원본 `lib` 폴더를 보존하는 배포 계약을 따른다.
- API 번들 `__dirname`이 별도 폴더인 상황을 재현하는 테스트를 `test:user-activity`에 추가했다. 파일 영속 저장과 조회를 확인한다.
- 진단 workflow는 활동 기록 오류 코드와 원본/번들 워커 파일의 존재 여부만 집계하며 고객 데이터나 원본 오류 줄을 출력하지 않는다.
- ERP 원장 읽기·쓰기 변경 없음. 배포 후 브라우저 큐의 실제 33건 ACK와 서버 오류 감소는 운영에서 재확인한다.
