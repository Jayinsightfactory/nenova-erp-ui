# 통관 03차·베트남 증빙 비용 인계

- 날짜/작업: 2026-11-20, `/root/audit_web_evidence`, `codex/customs-phase03`.
- 위치: `C:/Users/USER/nw-cdx-customs-phase03`. 구현/로컬 검증 완료, PR/CI/배포 전 기록.

## 사용자 의도와 승인 순서

1. 03차 정산서를 01/02에 억지로 넣지 않고 실제 차수·AWB로 입력/ZIP/주차별 보고서에 연결한다.
2. 기존 중국 40/41/43의 1차 반영은 보존하고 중복을 막는다. 44-03 신규 원천을 지원한다.
3. 베트남은 기존 엑셀 수수료 VAT 포함 방식으로 맞춘다. 증빙 net/VAT/total은 보존하고, 정확히 증빙과 일치할 때만 웹 계산에 gross를 투영한다. 미확인 과거 수기는 일괄 1.1배하지 않는다.
4. 운영 SQL 수정, 운영 ZIP 등록, 과거 보고서 갱신은 하지 않는다. 코드 배포 및 읽기 검증만 수행한다.

## 결과·근거

기준/부작용/실제 dnSpy/SQL/PDF 대조는 `docs/plans/customs-phase03-2026-11-20.md`, 계약은 `docs/contracts/customs-phase03.json`에 있다. 원본 PDF와 SQL 결과는 커밋하지 않았다. 신규 13개·기존 통관 22개·전체 ERP 계약 및 로컬 webpack build가 통과했다. 최종 영상은 합성 API와 격리 임시 파일만 사용하며 6단계 번호·확대·자막·재생·재조회를 검증했다. 데스크톱 메뉴는 1.3.78에 연결했다.

## 남은 단계 및 제한

PR/CI와 Cafe24·desktop 배포, `customs-phase03-smoke.yml`의 읽기 전용 운영 검증을 이어간다. 37 베트남 SQL 입력행 부재는 누락 원천 생성 권한이 아니다. 기존 보고서 저장본이 이번 코드만으로 갱신됐다고 설명하지 않는다. 배포 후 결과는 PR 완료 댓글과 WORK_MEMORY 후속 인계를 확인한다.

## 새 문맥용 지시

`codex/customs-phase03`의 CI/배포 상태를 먼저 읽고 이미 끝난 검사를 중복 실행하지 말 것. 실패가 있으면 해당 항목만 진단하되 필수 gate를 건너뛰지 말 것. 운영 원천·DB·저장 보고서 쓰기는 금지이며 35/37/40/41/43/44 GET 및 실제 44 화면까지만 검증한다. 완료 커밋·배포 run·운영 검증 상태를 구분하여 부모 `/root`에 인계한다.

## 2026-11-20 18:47 KST 완료 추가 기록

- [PR #1932](https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1932), master merge `c2a0ceb332d3f0d95f200953615e2db19bd0d70f`.
- [ERP CI](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44710861371), [Windows CI](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44710861502) 성공.
- [Cafe24](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44711909305), [desktop 1.3.78](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44711909269) 배포 성공. 코드 전용 배포 로그 확인, 운영 ping DB 정상 및 desktop 피드 HTTP200.
- [원천·실제44UI](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44713338665): 6차수 GET, 베트남 증빙 gross, 역사 중복 방지, 44 exact03 입력창 모두 PASS. 업무 쓰기0.
- [44 보고서 GET](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/44713345139): HTTP200, 1,734ms, `financialBasis=stored`. 기존 저장본 보존을 확인했으며 새로운 수익률 저장/재계산을 수행하지 않았다.
- 구현 범위 남은 작업 없음. 운영 금액 입력/ZIP 연결/과거 보고서 갱신은 별도 승인 범위다. 이 배포 후 기록은 작업 브랜치의 인계 커밋이며 추가 코드 배포를 만들지 않는다.
