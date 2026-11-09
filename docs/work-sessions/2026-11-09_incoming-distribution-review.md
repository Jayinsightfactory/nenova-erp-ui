# 입고 정정 영향 차수별 분배 검토·수정

| 항목 | 기록 |
|---|---|
| 세션 | 2026-11-09 incoming-distribution-review |
| 화면 | 영업지원 입고 정정 검토·확정 |
| 원장 부작용 | 기존 승인 원자 writer, 선택 기존확정 상세의 임시해제/복원 추가; 운영쓰기0 |
| PR/배포 | 진행 중, 미검증 |
| 작업트리 | C:/Users/USER/nw-incoming-distribution-review-1109 |
| 사용량 | 시작 계정전체41%, reset1794459857; 작업 단독 비용 아님 |

## 이어받을 때 고정된 결정

- 영업지원은 자동 검증 문제 유무와 관계없이 영향 차수별 분배 검토창을 연다.
- 원래 확정된 선택 상세만 자동 해제→입력→재확정한다. 원래 미확정은 미확정으로 유지한다.
- 전체 국가품종 FIX/CANCEL SP는 선택 범위 밖을 변경하므로 호출하지 않는다. 기존 receipt gate/locked preview/signed delta/native 재계산을 유지한다.
- 부족재고 정확수량 동의, 최종 승인, 원가·확정손익 검산과 전체 rollback을 유지한다.
- 원장 쓰기 검증은 격리 SQL, 교육 영상은 합성 API 실제 UI로 수행한다. 운영 변경시험 없음.

### 1. 요청 — 영향 차수별 확인·변경

**Q.** 입고 수정에 영향을 받는 차수별 분배값을 영업지원 수정창에서 확인·변경하고 현재 확정 상태 확인 후 자동 해제·입력·재확정, 재고도 함께 변경해 달라.

**A.** 항상 열 수 있는 명시 모달에 연도·차수 필터, 업체·품목 검색, 기존→최종 수량/판매단가, 현재/최종 확정 상태와 재검증한 재고 전후를 제공한다. 임시 입력은 미검증으로 표시하며 요청 저장과 ERP 최종 확정을 구분한다. 상태 복원은 선택 상세만 처리하고 기존 원자 writer를 재사용한다.

**근거.** [기준·부작용](../plans/incoming-distribution-review-2026-11-09.md), [실제 EXE 및 SELECT 근거](../exe-golden/IncomingApproval.md). 격리 SQL 45-01→45-03 fixed/unfixed·재고단일반영·2025보존·중간실패복구 PASS. 최초 하네스의 독립 pool 조회가 자체 트랜잭션 잠금에 막힌 timeout은 동일 tx 조회로 수정한 뒤 PASS.

## 검증·가이드

대상20 PASS, 최종 실제 격리SQL writer PASS(현재190/후속100·190/2027동일 재고, 2025동일 업체·품목45-03 및 헤더 보존 포함). local dnSpy/manifest/write scope/guide 검사가 통과했다. 전체 `npm run test:erp-contract`는 중복 로컬 전체 실행을 피하고 필수 PR ERP Contract Guard CI에서 수행한다.

실제 production build 브라우저에서 모달 수량60→50/연도차수 필터/재검증, Tab20회·ShiftTab·Escape 초점복귀·Enter, 390px 모달 범위 PASS. 수입부196초/영업지원148.5초, 1920×1080/100%/20fps 실제 화면의 두 역할 MP4·한국어 자막·목차·원본 해시 등록 완료. 모든 API는 연습 fixture로 처리했다. 개발서버 촬영은 두 번 중단되어 완료로 등록하지 않았고 운영 모드로 전환해 정상 촬영했다. 단일 시나리오 dry-run의 잘못된 요청번호 선택도 보완했다.

최신 origin/master3f91e0e1(PDF/분배검색) 통합. 녹화 대상 소스 변경 없음. `incoming-distribution-review-before-origin-sync-1109` stash는 apply 후 보존했다. prebuild에서 재생성되는 대형 개발이력 JSON은 배포 빌드 산출물로 검증하고 이번 소스 PR에 무관한 재생성 차이를 넣지 않는다.

## 미완·후속

정식 `npm run build` exit0 및 실제 MP4 player(역할/목차/한국어 자막/다운로드/접기정지/1920·390) PASS. 모달의 Space 열기·체크와 방향키 차수 선택도 PASS. 최종 영상의 중간·끝 프레임을 직접 시각 확인했다. PR 전체 ERP CI/병합/Cafe24 배포/운영 읽기 smoke는 후속 진행(미검증). .verify의 probe/원본 decompile/임시 녹화는 커밋 제외.

검색어: incoming distribution-review 45-01 45-03 fixed unfixed native stockDelta rollback
