# 불량차감 분배단가 직접입력

## 요청과 확인

- 요청: 영업지원 전산등록에서 분배단가 `확인 필요`인 행도 직접 단가를 입력해 등록.
- 운영 읽기 확인: 2026-08-26, 운영 버전 `3929823`, 2026/34차 영업지원 60행.
  일신원예 `ROSE / Mandala mc 50cm` 2단(30차 원장 이월)은 단가 없음으로 차단됨.
  같은 업체의 `ROSE / Mandala 50cm` 2단은 별도 품목으로 #8623 등록완료.
  비슷한 이름의 다른 품목 단가를 자동 대입하지 않는다.
- 저장된 decompile 원문 확인: `FormEstimateAdd.cs` CheckValue/btnSave_Click,
  `ClassEstimate.cs` Insert. EXE는 직접 입력한 speCost를 Estimate.Cost에 저장하며
  Quantity×Cost/1.1의 Amount와 Vat를 사용한다. 주문/분배 단가 변경은 없다.
- 직접 MSSQL probe는 이 작업트리에 DB 인증 설정이 없어 실행하지 못했다.
  위 운영 데이터 확인은 인증된 브라우저의 SELECT 기반 영업지원 조회 결과다.
- 필수 하위작업 운영문서 `docs/CODEX_SUBTASK_ORCHESTRATION.md`가 없어
  AGENTS에 제공된 역할 분리를 적용했다. 하위작업은 로컬 구현/테스트만 담당한다.

## 기준 원천 → 사용 위치

| 기준 | 원천 | 적용 |
|---|---|---|
| 단가 직접입력 | 사용자 요청 + EXE speCost | 영업지원 행별 입력, 저장, 공통 단가 선택 |
| 단가 > 0, 유한수, 소수 4자리 이내, 최대 9,999,999,999.9999원 | EXE 0단가 거절 + 웹 숫자 입력 안전 범위 | UI/API/실행 fixture |
| 명시적 해제는 null, 빈값/0은 해제가 아님 | 웹 입력 계약 | API 검증 및 최신 clear 이벤트 |
| 원장키+적용연도/차수+업체+품목+단위 | 교차연도 및 매칭 보존 계약 | 목록/검토/사전검증/등록 직전 공통 helper |
| 확정 여부는 등록 필수 아님 | 기존 사용자 명시 정책 | 기존 업체 분배 eligibility 보존 |
| 단가 저장은 등록 아님 | EXE 저장과 웹 초안 구분 | 저장 후 서버 재조회, 자동 견적 생성 금지 |
| 완료/연결된 견적은 단가입력 대상 제외 | 기존 중복/잔여 계약 | 잠금 후 서버 검증 |
| 동시 변경 감지 | RowVersionNo | expectedRowVersionNo와 행 매칭키 확인 |

## 부작용

| 동작 | Web 원장/History | Estimate | Order/Shipment/Date/Farm/Stock/손익 원장 |
|---|---|---|---|
| 단가 직접입력·해제 저장 | 행 감사 버전 갱신 + MANUAL_COST 감사 이벤트 | 보존 | 보존 |
| 목록·검토·사전검증 | 읽기 | 읽기 | 읽기/보존 |
| 불량차감 등록 버튼 | 기존 등록/이월 계약 | 기존 음수 INSERT/UPDATE, 선택 단가 반영 | 보존 |

직접입력 값은 기존 History AfterJson에 범위가 명시된 MANUAL_COST 이벤트로 저장한다.
새 스키마나 GET DDL을 추가하지 않는다. 적용 범위가 다른 이벤트는 사용하지 않고,
직접입력 해제 이벤트는 이전 값을 부활시키지 않는다. 저장·등록은 동일 원장 잠금으로
직렬화한다. 실제 운영 단가를 임의로 입력하거나 견적을 시험 등록하지 않는다.

## 검증/배포

실행형 fixture: 30차 원장→34차 직접단가 저장/재조회, 2025→2026 범위 분리,
동일 업체·품목의 별도 원장키 격리, 단위 변경, 명시 해제 후 자동단가 복귀,
0/음수/빈값/false/NaN/5자리 소수 거절, 완료·잔여0·기등록·삭제·낡은 버전 거절,
History INSERT 실패 시 감사 버전까지 롤백(가짜 transaction으로 실제 save 함수 실행).

로컬 필수 검증: test:erp-contract, test:nenova-dnspy-evidence,
test:erp-manifest --changed-from origin/master, guard:erp-writes --changed-from origin/master,
build 통과. 운영 값을 입력/등록하는 쓰기 스모크는 수행하지 않음.
PR/배포/실브라우저 확인은 진행 중.
