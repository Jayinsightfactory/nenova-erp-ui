# 입고 정정 간단 입력·문제 중심 검토

- 날짜: 2026-11-05
- 작업트리: C:/Users/USER/nw-incoming-simple-1105
- 기반: origin/master 7da5c5c5
- 상태: PR1563 병합·필수검증·배포·운영 조회 확인 완료
- 모델: 구현 Sol medium 하위1개(원장 검증 경계 포함), 추가 위임 없음
- 사용량: 시작 계정 주간 누적26%, 작업 단독 사용률 아님

## 고정한 사용자 기준

수입부는 선택한 농장의 기존 입고 안에서 농장 변경, 다른 품목과 수량 변경, 수량만 변경, 품목/수량 추가, 품목/수량 취소를 선택한다. 신규 입고 건 전체 추가/삭제는 이번 범위가 아니다. 농장 변경 외에는 농장을 유지한다. 영업지원은 실제 문제만 확인·조정하고 문제가 없으면 최종확정만 한다.

## Q&A

**Q.** 작업이 까다롭다. 수입부가 변경 종류를 정하고, 생길 문제만 영업지원이 확인하여 확정하면 된다.

**A.** 기존 원장 반영 writer를 재사용하고 수입부 직접 행 편집, 요청 한번에 생성/제출, 영업지원 자동 준비/검산과 문제 카드로 단순화한다. 내부 매칭/원가 입력 화면은 필요한 경우에만 노출한다.

**Q.** 기존 농장 안의 품목을 다른 품목으로 바꾸면서 수량도 각각 변경하거나, 기존 품목 수량만 변경한다. 사용량을 감안해 이어서.

**A.** 품목 변경에 수량 동시 수정을 포함한다. Sol 구현1개로 제한하고 대상테스트 안정화 후 최종검증/녹화/배포를 순차 수행한다. 불분명한 분배 귀속·원가·중량은 추정하지 않고 문제로 보여준다. 부족재고는 품목/차수/수량 명시동의를 유지한다.

## 사전 근거

실제 dnSpy ClassWarehouseDetail와 FormShipmentDistribution 재추출, 동일 운영 입고 원가 리더 SELECT-only7662/7671/7345/5560 PASS, 운영쓰기0. 기존 docs/exe-golden/IncomingApproval.md와 incoming-approval 계약이 원자 writer 근거다. 상세 설계는 docs/plans/incoming-simple-workflow-2026-11-05.md.

## 남은 작업

대상/필수 검증, 단순화된 화면의 역할별 가이드 재촬영, PR/CI/병합/배포와 운영 조회 검증. 아직 완료라고 보고하지 않는다.

검색어: incoming-simple-workflow 문제중심 검토 수입부 직접수정 Sol 사용량

## 최종 구현 및 검증 근거

수입부 5유형 직접 입력과 요청 생성/제출, 영업지원 자동 준비/문제 중심 검토를 구현했다. sourceDigest로 조회 후 다른 입고행이 바뀐 오래된 요청을 거부한다. prepared 계산과 최종 confirmed 동의를 분리하며 원장 writer는 기존 트랜잭션을 유지한다.

- 대상 정책/표시 테스트 PASS(30개 초기, 변경 후16개 및 표시2개).
- 실제 격리 SQL10개 및 prepared writer1개 PASS: 최종동의 누락 시 불변, stale 원장 거부, rollback/replay 포함.
- 합성 데이터 실제 브라우저8시나리오 PASS, 운영 ERP 쓰기0.
- dnSpy evidence, manifest193개, write guard PASS. 전체 ERP 및 최종 Linux build는 PR CI에서 검증한다.
- 촬영용 동결 production build PASS. 수입부5장면/영업지원3장면 1920×1080 실제 화면 가이드 재촬영 완료. 최종 미디어 증명/재생 확인 및 배포 결과는 후속 기록한다.

검색어: sourceDigest prepared confirmed simple-final-focused simple-prepared-writer

## 배포 완료 — 2026-11-05

- PR https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1563, squash c472131878a0f6e47026620eb4999bcb3ad13bf4.
- 전체 ERP 계약/교차연도/dnSpy/manifest/write guard/Linux build CI42001957637 PASS. 배포42002864270 PASS, hydration PASS.
- 최신 master 병합 후 로컬 공식 build PASS. strict 가이드2workflows/3videos PASS. production player 실제재생·자막·목차·키보드·다운로드·접기정지·1920/390폭 PASS.
- 운영 GET-only 브라우저: v1.0.2·c4721318, /incoming 및 /import/tools?tab=incoming, 승인목록200, 역할별실제영상·목차·자막 PASS. 운영시험쓰기0, 운영개인정보스크린샷저장0.
- 가이드 수입부213.7초/5목차, 영업지원120.15초/3목차, 모두1920×1080. .verify/simple-production-smoke.log에 최소근거 기록.
- 시작 계정 주간26%(reset1794459856), 종료32%(reset1794459857). reset 응답이1초달라 정책상 정식차감률을산정하지않음. 계정전체누적이며 병행채팅포함, 이작업단독사용률아님. 추가하위세션없이Sol1개, 대상검증분담, 전체회귀는CI사용.
- 상태: 요청한 단순화·가이드·필수검증·배포·운영조회 확인 완료. 실제업무요청의운영확정은사용자업무에맡기며 테스트데이터를운영원장에작성하지않음.

검색어: PR1563 c4721318 42001957637 42002864270 incoming-simple 배포완료 1080p
