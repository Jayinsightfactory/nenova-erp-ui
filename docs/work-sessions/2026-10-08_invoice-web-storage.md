# 2026-10-08 인보이스 웹 저장 구조 V1

## 요청 / 승인 경계

사용자의 `진행.`은 웹 전용 문서·이력·원가 버전 저장 구조 추가에 대한 승인이다.
운영에는 빈 WebInvoice 6개 테이블만 추가한다. EXE, 기존 ERP 테이블·프로시저,
공용 임시입고, 채번, 주문·분배·재고 자료 변경은 이번 단계에 포함하지 않는다.
설계는 `docs/plans/invoice-web-storage-v1.md`, 통합 PRD는
`docs/plans/invoice-receipt-arrival-cost-prd-2026-10-07.md`를 따른다.

## 구현

- WebInvoiceDocument / Line / Operation / History / CostRevision / CostLine.
- 최초 생성 트랜잭션과 제한 시간, 외부 트랜잭션·대상 DB·부분 설치 거부.
- 문서/버전/저장 요청/입고번호 범위 FK, 동일 인보이스 업무키 중복 차단.
- 열·인덱스·FK·CHECK 구조 및 정의 fingerprint 비교. 기존 기준 재생성 금지.
- 실제 입고 API 연결, 화면 활성화, 운임 중복 배분 방지는 아직 구현하지 않음.

## 메인 실행 검증

- `node --test __tests__/invoiceWebStorageContract.test.js __tests__/invoiceReceiptReconciliation.test.js`: 12/12 통과.
- `npm run test:erp-contract`: 통과. 최초 실행은 신규 manifest에 변경 SQL guard 명령 누락으로 실패했으나, 명령 추가 후 전체 재실행 통과.
- `npm run guard:erp-writes -- --changed-from origin/master`: 통과.
- `npm run build`: 통과.
- `git diff --check`: 통과.
- `node scripts/test-invoice-web-storage-sql.cjs`: 최종본으로 2회 통과.
  - SQL2022 공식 컨테이너, mount 없음, 127.0.0.1:14339, compatibility=130.
  - 최종 fixture: `NenovaInvoiceFixture_20261008_992c1bd2c907`, 실행 후 자체 정리.
  - 신규 6테이블0행/재실행, 부분 설치 거부, 2025·2026 같은 차수 분리,
    차수를 바꾼 동일 업무 해시 거부, 잘못된 연도·차수, 음수/0/NULL 구별.
  - 정상 이력·원가행 삽입과 타 문서·입고 연결 거부, 요청 UUID 중복 거부,
    실패 다중 쓰기 rollback, 열 drift 및 같은 이름의 약화 CHECK 거부.
  - ERP sentinel 3개 테이블과 mock 입고 SP 보존. 운영 자료를 사용한 쓰기 시험 아님.
  - 초기 시험에서 예약어 인용/문자열 및 부분 구조 사전 컴파일 문제를 수정했다.
    운영에서 시험하거나 실패한 것이 아니다.

검증 DDL SHA256: `B8C7F25CBF99B00478BD082A000C7721B30A9D6064116EF59F653490D816AF97`.

## 운영 상태

적용 전: 로그인된 SSMS에서 SELECT로 권한·호환수준130·동명객체 없음·열린 transaction없음 확인.
DB DDL trigger 조회 결과 없음. 공유 SP5개 지문과 staging4행/checksum1343479630 기록.
2026-10-08 11:09:59 +09:00, 동일 SHA의 DDL을 로그인 SSMS 세션1469에서 실행 완료했다.
동일 세션 SELECT readback: TranCount=0, 6테이블 모두0행, FK7개 활성/신뢰/NO_ACTION,
CHECK38개 모두 활성/신뢰/최초 정의 fingerprint 일치. 기존 공유 SP5개 지문과
staging4행/checksum1343479630은 적용 전과 동일하다.
근거: `docs/diagnostics/2026-10-08-invoice-storage-production-readback.md`.
운영 test INSERT, 기존 ERP 원장 쓰기, EXE/공유 SP 수정은 하지 않았다.

독립 최종 검토는 같은 SHA 기준 차단사항 없음. 초기 3건(CHECK 정의 누락,
filtered-index 부분 일치, 짧은 통화코드)을 보완했다. DDL/fixture 구현자는 로컬 파일만
수정했고, 실제 SQL fixture·운영 조회·DDL 실행은 메인이 수행했다.

## 다음 단계 / 과장 금지

웹 저장 공간 준비는 통합 입고 등록 기능의 완료나 웹 배포가 아니다.
기존 POST는 채번 누락과 공용 staging 소비 위험이 있어 그대로 연결하지 않는다.
후속에는 공용 staging을 건드리지 않는 writer와 EXE 효과 대조, 동시성/재시도/실패 검증,
원가 수식·공동 운임 중복 방지, UI 저장/재조회까지 연결해야 한다.
