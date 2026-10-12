# EXE 확정취소 BUSY 복구와 재고 계산 원자성 — 2026-10-12

| 항목 | 기록 |
|---|---|
| 사용자 증상 | NENOVA.EXE 2026/41-02 네덜란드 등 여러 국가 확정취소 BUSY |
| 실제 잠금 | 공용 GateKey1, RUN/CALC, 2026/41-01, PendingCalc1, CalcProdKey0, session696, SQL시각16:19:57.120 |
| 운영 상태 | 수동 복구 및 native CALC 패치 적용 완료, capability2/ready, 최종IDLE |
| 범위 | 재고 재계산과 잠금 transaction 경계; FIX/CANCEL 업무 SQL 변경 없음 |

## Q&A와 결정

**Q.** 저번에도 확정취소가 BUSY였는데 다시 발생했다. 해결해 달라.

**A.** 실제41-1 공용 CALC 잠금이41-2의 다른 국가까지 차단했다. native CALC가 GateEnter를 선커밋하고 나서 계산 transaction을 시작해, 중간 연결 종료/attention이 CATCH를 건너뛰면 RUN이 남을 수 있었다. 이번 연결이 왜 중단됐는지에 대한 최초 요청 로그는 확보하지 못했다.

**Q.** 저번 작업처럼 그냥 처리되게 해 달라.

**A.** 전체 세션 조회 권한이 없어 세션696 종료는 입증하지 못했음을 설명한 뒤, 사용자가 관리자 확인 없이 수동 복구를 명시 요청했다. DMV0건과 DBCC OPENTRAN 빈 결과를 종료 증거로 쓰지 않았다. 정확한 token/scope/시간을 재검증하고 gate 및 관련 테이블을 NOWAIT로 잠갔다. RUN을 WAIT_CALC로 전환하여 미완료 의미를 보존한 뒤 동일 outer transaction에서 native full-product CALC를 완료했다. 공용 잠금을 단순 무조건 초기화하지 않았다.

복구 결과: 36,593 ProductStock 스냅샷 계산, 신규/악화 음수 없음, 보호12개 테이블의 행수/체크섬 전후 일치, IDLE/PendingCalc0을 새 연결로 재확인. 체크섬은 완전한 행 동일성 증명이 아니며, 잠든 기존 호출의 재개 불가를 입증한 것도 아니다. 사용자 요청에 따른 특정 잠금 한 건의 수동 복구이며 자동 reclaim 정책으로 만들지 않았다. EXE의 확정취소 자체는 대신 실행하지 않았다.

**Q.** 재발 방지 패치 동안 해당 작업을 모두 멈추겠음.

**A.** 명시적으로 모든 PC의 확정/취소/재계산 중지를 받은 후, fully idle singleton과 실제 module metadata를 다시 검사하여 CALC만 수정했다. GateEnter 전 BEGIN, 성공 GateLeave 후 COMMIT으로 계산·잠금 상태가 같은 transaction에 묶인다. 6개 native 인자와 재고 업무 SQL bytes, SET 옵션, execute-as, 서명 유무를 보존한다. 기존 외부 caller transaction 수준을 유지한다.

## 운영 배포와 검증

- 실제 EXE CLI `DBMSSQL` 추가 추출. uspStockCalculation은 성공 및 예외에서 Connection.Close를 수행한다. `FormShipmentDistribution`은 취소 성공 후 별도 CALC0을 호출한다.
- SQL2016(13.0.7095.1), 원래 CALC SHA256 UTF16LE `879357e7bf8aabe4cb60f853d18331109580f673e0dc3ba21570ad984bfbc67b`.
- 첫 installer는 SQL2016이 ALTER 후에도 CREATE 문구로 모듈 정의를 보관하여 post-hash 검증 실패, 전체 rollback. 원본 해시와 capability 복구 확인.
- 두 번째는 준비된 CREATE/ALTER **두 개의 정확한 전체 정의**만 허용해 검증. 업무본문 변경 허용 아님. 적용 후 해시 `24a415fa16e5fd4fcf2a1b342cc05b3e081142e9bd358ab11f010836907a7edd`, 업무본문 hash `3ee1afc95c4103e7a8a852c52c0ae78623704aa0d6ff158cb5526f9dfbe1fbfa`.
- ALTER와 기존 capability hash property 갱신은 같은 DDL transaction, 권한 변경 없음. 성공 후 exact metadata/서명/SET/parameter/capability/idle 검사.
- 실제 운영 CALC0(2026/41-01)을 rollback-only outer transaction에서 검증: return0/result0, 원래txcount1 보존, 게이트IDLE. rollback 후 새 연결 capability ready 및 새 modulehash 확인.
- 로컬 SQL fixture: busy·정상·외부rollback·2025거부·업무오류·attention+명시rollback·연결종료에 따른 IDLE/WAIT_CALC 복원 PASS. 실제 재고 본문은 sentinel로 대체한 제어흐름 fixture다. 본문 bytes 동일성은 별도 검사하고 실제 운영 rollback-only CALC도 통과했다.
- 사용자가 멈춘 작업을 재개해도 된다고 안내했다. EXE 재설치 필요 없음.

## 한계와 이어받기

이번 변경은 CALC의 영구 RUN 잔류 경로를 보완한다. 활성 transaction이 살아 있으면 정상 BUSY는 가능하며, attention만 받고 연결이 유지되면 caller rollback/disposal이 필요하다. FIX/CANCEL의 별도 진입 경계와 다른 종류의 BUSY까지 모두 제거했다고 주장하지 않는다. 자동 시간 만료/없는 세션 reclaim 금지는 유지한다.

원문 probe, 정확 토큰, 복구 전후 스냅샷은 `outputs/busy-*`와 `outputs/native-atomic-production-verified.json` 로컬 보관. 비밀값·운영 원문은 커밋하지 않는다. 버전 관리 fixture에는 SP 정의3개만 포함한다.

최종 소스 배포: PR #1028 / master7c3193f2 / Cafe24 run38222836288 success. 격리 stockGateOwnership --sql 29검사 PASS. Brut 보정 후에도 별도 연결에서 IDLE/PendingCalc0/capability ready 재확인. 사용자는 중지했던 확정·확정취소·재고 계산을 재개할 수 있다.
