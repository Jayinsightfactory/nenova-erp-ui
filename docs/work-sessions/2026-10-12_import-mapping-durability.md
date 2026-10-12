# 업로드 주문등록 저장매칭 복구 · 2026-10-12

| 항목 | 내용 |
|---|---|
| 화면 | /orders/import |
| 요청 | 매번 다시 고치는 품목매칭 원인 진단, 기존 작업 이력 재사용 |
| ERP 부작용 | 매칭은 Product SELECT 및 웹 runtime 사전만 사용. Order*, Shipment*, Warehouse*, Stock*, Estimate, WebProfitReport 보존 |
| 사전 근거 | 실제 dnSpy FormOrderAdd 실행 outputs/import-mapping-dnspy.txt. 원문 연도+차수 주문 저장 흐름 확인 |
| 운영 읽기 | 인증 GET으로 Product 3326, 공용 매칭485/수동178, 라움 Cust680 업체 사전0 확인. 백업 outputs/import-mapping-production-before.json |

## 고정 결정
- 저장/재조회 모두 업체+화종 문맥 matchName을 사용한다. 원문명/수량/단위는 보존한다.
- 확정 수동 exact/compact 매칭만 복구 적용. 다른 업체, 화종/국가/길이 충돌, 삭제품목, 단순 유사 추정은 복구 이력으로 승격하지 않는다.
- 새 업로드/업체 변경/초안 복원 시 fresh 사전을 조회하며 늦은 응답이 새 편집을 덮지 않는다.
- 성공 응답과 재조회 확인 전 저장 완료로 표시하지 않는다. 고객 매칭 변경 전후/작성자/시각을 보존한다.
- 기존 매칭 재사용 시 공용 사전을 재저장하지 않는다. 별도 주문등록 시 기존 FINAL_SNAPSHOT 계약 유지.

## Q&A
### 1. 업로드 품목매칭이 매번 사라짐
**Q.** 기존 작업 이력을 찾아 계속 적용해 달라.
**A.** parser는 inputName=화이트, matchName=수국 화이트로 구분하지만 결과가 matchName을 버렸고 저장은 화이트만 사용했다. 동명 화종 덮어쓰기와 문맥 fuzzy의 기존 수동값 가림을 확인했다. 서버 runtime은 배포 보존 중이며 배포 초기화라고 단정하지 않는다. 기존 수동178건을 새 exact/context 우선 경로에서 재사용하고 초안에도 재적용한다.

## 기준 ledger / 부작용
| 동작 | 읽기/쓰기 | 보존 |
|---|---|---|
| 저장매칭 재적용 | 활성 Product 조회, 고객+공용 runtime fresh read | 모든 ERP 원장, 원문 qty/unit/skip/year/week |
| 수동 선택 저장 | 고객+문맥 runtime, before/after 이력, readback | 공용 ERP 원장 |
| 재업로드 | 기존 저장 사전 읽기. 명시 override만 학습 | 확정 수동 사전의 stale 자동 재쓰기 금지 |

## 메뉴 기준선
- 적용: 기존 단일 shell, 페이지 세로 스크롤, 기준1920×1080/100%, 키보드 버튼, 오류/진행 표시, 서버 확인 후 완료.
- 적용: 원본/매칭 병렬 표시, 업체 scope, 초안 보존, 실행형 회귀+배포 후 smoke.
- 해당 없음: 신규 메뉴, 재고조정, 견적/매출 원장 변경. 웹 별칭만 변경하므로 downstream 쓰기 없음.
- 예외/환경: docs/CODEX_SUBTASK_ORCHESTRATION.md 없음. 사용자 제공 역할분담 적용. outputs는 운영 읽기 백업/검증 산출물이며 커밋하지 않음.

## 검증 / 배포
진행 중. API/화면 회귀, 필수 ERP gates, build, PR/master/Cafe24, 운영 읽기 smoke 결과를 추가한다.

### 검증 중간 결과
- 전체 test:erp-contract 성공. dnSpy/manifest/write guard 성공.
- 신규 재사용/복구 테스트 성공: 화종 동명, 업체 분리, 규격50/60 분리, 명시 대체품/공백변형, stale/deleted, 교차연도 값/수량/단위/제외 보존, 이력 보존.
- 운영 읽기 snapshot의 기존 수동178건을 현재3326품목과 재대조:178/178 재적용, 미존재/충돌0. outputs/import-mapping-recovery-audit.json.
- Playwright 실제 페이지 fixture:1920×1080/1366×768, 복원·새로고침·저장실패 후 재시도·문맥키·방향키/Enter/Escape·가로 overflow 없음·브라우저 오류0. 운영 ERP 쓰기0.
- 사용자 변경 중 늦은 응답 가드와 명시 수동값 우선 독립 검토 완료. 복구는 자동 후보를 계산하지 않는 savedOnly 모드로 수행.
