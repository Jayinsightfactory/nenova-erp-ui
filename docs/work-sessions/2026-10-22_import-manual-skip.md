# 분배 업로드 수동 매칭·건너뛰기

|항목|내용|
|---|---|
|기간|2026-10-22|
|화면|/shipment/distribute-import|
|작업트리|C:/Users/USER/.codex/worktrees/d403/nw-import-manual-skip|
|브랜치|codex/import-manual-skip|
|원장 부작용|운영 SELECT만, 운영 쓰기·배포 없음|
|PR/배포|검증 후 draft PR, 기존 2시간 배포 유예 유지|
|이어받기|docs/plans/import-manual-skip-2026-10-22.md|

## 고정 결정
- 유효한 수동 품목 키는 파일 제목 분류/내장 키보다 우선. 잘못된 키는 차단.
- 건너뛰기는 원문 sheet/label/family에 명시 선택, 재검증 필수. 닫기는 제외 아님.
- 건너뛰기가 있으면 남아 매칭된 품목만 교체, 제외 및 파일 밖 품목의 기존 원장 보존. 포함 품목의 누락 업체 분배0은 유지.
- 서명에 품목 범위 포함, preview/coverage/트랜잭션/사후 확인 동일 범위. 기존 연도·확정·stale·원자 저장 보존.
- 기존 사용자 업로드 보호 지시에 따라 약11:22 KST 전 배포/병합 금지. 이후도 진행 중 업로드 종료를 확인하지 못하면 운영 배포 보류.

### 1. 원인 분석과 수정
**Q.** 루스커스/40cm를 연결해도 미매칭, 건너뛰어도 나머지 분배 불가. 3~4일 전과 달라졌다.
**A.** PR1081 전체 검증계획/버튼 잠금과 PR1213 제목품종 상속·수동매칭 거절을 확인. 실제 이전/현재 파서로 제목 수국 아래 루스커스2종의 family 빈값→hydrangea 재현. Product1717/3085 루스커스 분류 확인. 현장 파일은 미확보.

### 2. 실행형 검증
**Q.** 수동 연결은 반영, 건너뛴 품목만 제외하고 나머지 분배하도록 수정.
**A.** manual choice 우선, explicit skip UI/취소, signed product scope, 동일 SQL scope helper 구현.
**결과.** 신규 회귀6개 및 업로드 관련 검사 통과. 로컬 브라우저1920/1280에서 수동 선택→Space 건너뛰기→재검증→취소→재제외→활성 적용→올바른 payload 포착 확인. 모든 API 가로채기/외부 요청 차단, 운영 저장 없음. 최종 전체검사/빌드/CI는 후속 기록.

## 후속
- 필수 검사 최종 결과와 draft PR 연결 기록.
- 기존 automation에 이 작업트리/PR 인계. 새로 동일 기능을 중복 구현하지 않는다.
- 약11:22 이후 업로드 종료가 확인될 때 CI 통과 PR squash 병합→Cafe24→브라우저 스모크. 운영에 시험 분배하지 않는다.
- .next-choice-smoke, 임시 screenshot/log는 커밋 제외. node_modules junction은 기존 의존성 재사용이며 변경하지 않는다.

- 최종 검증: 전체 test:erp-contract 통과, test:nenova-dnspy-evidence/manifest/write guard 통과. 빌드 통과 후 마지막 UI 비동기 선택 처리까지 최종 재빌드 중. 운영 배포/실파일 적용은 유예 및 미검증.

- 완료 검증: 마지막 UI 비동기 수정 포함 최종 npm run build 성공. 최종 산출물에서 격리 브라우저 전체 흐름 및 전부 건너뛰기 안내/비활성 통과. 전체 ERP 계약·dnSpy·manifest·쓰기 가드 성공. PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1221 draft 생성, CI는 원격 진행 중. 자동화에 작업트리/PR 인계 완료. 약11:22 이후 업로드 종료 확인 전까지 병합/배포 금지. 운영 스모크·실파일 저장·EXE GUI는 미검증.
