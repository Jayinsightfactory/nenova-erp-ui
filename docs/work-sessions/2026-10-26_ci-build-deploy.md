# GitHub 빌드로 배포 전환

|항목|내용|
|---|---|
|기간|2026-10-26|
|원장 부작용|없음. 기본 DB 마이그레이션 차단 유지|
|PR/배포|검증 후 기록|

## 고정 결정
- Cafe24 RAM3893MiB와 거의 소진된 스왑에서 Node 빌드 OOM 확인(run40292244908).
- 1536MiB 제한도 V8 heap OOM. 사용자가 GitHub 빌드 후 산출물만 전달 승인.
- 운영 .env, 직원 매칭/단위 학습, 업로드 파일은 아카이브에 포함하지 않는다.
- SHA/lock/checksum 불일치와 새 master 존재 시 교체 차단. 기존 DB gate/rollback 유지.
- 화면/업무 SQL/재고 산식/nenova.exe 변경 없음. 메뉴 기준선 해당 없음.

### 요청 → 처리
Q. GitHub에서 빌드하고 Cafe24로 전달하는 방식으로 변경.
A. Linux CI webpack + 무DB 로그인 스모크 후 명시 파일만 tar, 서버 checksum/manifest 검증 후 기존 pm2 교체. PR에서도 Linux 빌드 검증.

## 검증/미완
- 검증 중. 실제 배포 완료/버전 확인 전 완료로 보고하지 않는다.
- 로컬 로그와 빌드 결과는 커밋 제외.
