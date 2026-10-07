# 2026-10-07 인보이스 단일 업로드·입고·도착원가 PRD 및 구현 착수

| 항목 | 상태 |
|---|---|
| 작업공간 | work/import-team-tools |
| 브랜치 | codex/invoice-receipt-cost-prd |
| 기준 | origin/master ab3150ab 병합(a97ba624), 기존 미커밋 매칭 세션 로그 보존 |
| 운영 부작용 | 인증/조회/원가파일 다운로드만. ERP 쓰기·DDL·EXE/SP 변경 없음 |
| 배포 | 미배포. 초안 PR #960, 구현커밋 eb725113. 통합 기능 구현/검증 완료 아님 |

## 고정 결정

- 인보이스 업로드→매칭/검토→실제 입고→도착원가→영업/관리 피벗까지 한 흐름.
- 엑셀 내려받기·다시 업로드를 필수 단계로 요구하지 않는다.
- 실제 입고량 기준 원가가 기본, 중국 해상95% 적재 예상원가는 비교용(사용자 답변).
- 입고완료와 원가완료는 별도 상태. 미인식/미산정은0이 아니다.
- native 공용 staging/SP/잠금 검증 전 실제 입고 writer 연결 금지.

## 질문과 처리

Q. 전체 PRD 만들고 바로 작업해.
A. 전체 PRD, 기준 ledger, 부작용, UI/API/문서·원가 버전/중복/동시성/수용 기준을 작성.
첫 구현으로 순수 주문·입고 대조 엔진과 테스트를 작성했다. UI/저장 API에는 아직 연결하지 않았다.

Q. 실제량 원가를 기본으로,95%는 비교로.
A. PRD에 확정. 예상원가를 실제원가 누락 시 fallback으로 쓰지 않는다.

## 산출물

- `../plans/invoice-receipt-arrival-cost-prd-2026-10-07.md`
- `../contracts/invoice-receipt-workflow.json`: 1차 대조 기능 계약, 전체writer출시 계약 아님.
- `../../lib/invoiceReceiptReconciliation.js`, `../../__tests__/invoiceReceiptReconciliation.test.js`
- `../diagnostics/packing-receipt-readonly.sql`: SP/트리거·스키마/원가 연결 읽기 진단 보강.
- `../../scripts/inspect-invoice-cost-sources.cjs`: 인증 환경변수로 원본 수식 읽기만, 비밀값 저장 없음.

## 실제 확인

dnSpy CLI ExcelLoadingPackingList 재실행: TempWarehouseDetail, exact Product,
CheckFixSave, uspCreateWarehouse, 명시 year/week stock계산 호출.
운영 warehouse GET82건;7593/7592=2026/41-02. 직접 SQL 접속 env 없음.
중국 해상/NL40-2 드라이브 원본 수식 표본 확인, 해시·셀 위치는 PRD에 기록.
중국95% 예상/실제분모 별도, NL FOB비율 운임·통관 배분과 VAT 별도 확인.
국가 전체 수식 재계산 일치나 native 저장/수정 검증 완료가 아니다.

## 하위 작업

메인: guard-nenova-erp-changes, interpret-work-intent로 범위/ERP 경계 결정,
스프레드시트 스킬로 원문 수식 읽기, session-knowledge-backup으로 본 기록.
Nietzsche(gpt-5.6-sol/high): P0_LOCAL 대조모듈/테스트2파일. terra 미제공 대체.
Dirac(gpt-6.1-sol/high): P0_LOCAL 독립 PRD검토. 중복키/공식선택/공동운임/피벗분모/상세연결5항 보완.
외부/DB 접근·병합/배포는 하위 작업 금지. 메인이 canonical orchestration 지침을 읽고 범위 제공.

## 검증과 차단

- 초기 대조10개 테스트 통과, 메인 검토에서 차수패딩·PK·혼합단위 상태·다른차수 초안 거부 보완.
  최종11개 테스트와 구문검사 통과, ERP contract manifest 연계 실행 통과.
- dnSpy evidence guard 통과, write scope guard 통과(변경API0).
- contract manifest84개 검증 통과.
- 전체 `npm run test:erp-contract`와 build는 ENOSPC로 종료1. 전체통과라고 표시하지 않는다.
- C: 여유0. 이 작업의 .next/cache 약1.08GB 확인 후 경로 검증하여 정리를 시도했으나
  실행 정책이 삭제를 차단. 다른 파일 삭제/우회 시도 없음. 사용자 디스크 정리 필요.
- 재확인 시 여유 약1.56GB로 회복(메인 삭제 성공 아님). 재시도한 build/전체 ERP계약은 모두 종료0 통과.
- 운영 저장은 현행 SP/트리거 읽기 결과, 격리SQL, 신규 영구 문서 DDL승인도 필요하다.

## 이어서

현재 빌드/전체계약 통과, 디스크 여유 재점검 필요. 진단 SQL결과 또는 준비된 읽기 연결로
현행 usp_CreateWarehouse/usp_StockCalculation/트리거와 CheckFixSave 근거 확보.
문서·원가 스키마 최종결정 및 신규DDL 별도승인 → 공동초안/previewUI → nativewriter격리검증
→ 입고/원가/pivot연결 → 필수회귀/PR/배포. 운영 임의 시험입고 금지.
이 파일과 PRD를 먼저 읽고 진행하며, 순수계산 구현을 실제입고 배포완료로 오인하지 말 것.

초안 PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/960
실제 SQL 원문/격리쓰기 근거와 신규DDL 승인이 없으므로 운영 writer 구현 및 병합·배포는 보류.
