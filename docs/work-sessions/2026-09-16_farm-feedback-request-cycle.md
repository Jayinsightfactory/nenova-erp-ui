# 농장 피드백 요청·답변 순환

## 사용자 합의
요청 전에서 요청 작성 → 답변 대기 → 답변하기 → 답변 도착 → 재요청 → 답변 대기.
요청은 원 작성자만 수정, 다른 업무 사용자도 요청 추가 가능. 기존 요청·답변·수정 전 내용 보존.

## 기준 및 범위
- 기존 접근 허용 사용자(영업/수입/지원)에게 인박스 REQUEST 추가 허용. 답변·개선은 기존 수입부 권한 유지.
- 명시적 메모 COMMENT는 상태 보존. 요청 전 기본 입력 모드는 REQUEST.
- REQUEST_EDIT는 원본 REQUEST EventKey 참조, 원본 AuthorId와 인증 사용자 exact match. 관리자 우회 없음.
- 수정은 새 감사 이벤트 INSERT. 원본 Body·증거 보존. 상태·기한·새 원본 확인 범위 불변.
- 단일 연도 잠금, 대상 revision, case/inbox version, UUID 멱등성·rollback 유지.
- 웹 전용 Event에 nullable RequestEventKey 추가. 기존 행 backfill/삭제 없음.

| 동작 | WebFarmQualityCase/Event/Inbox | 불량 원본·Order·Shipment·Stock·Estimate·WebProfitReport |
|---|---|---|
| 요청 추가 | 기존 인박스 이벤트 트랜잭션, WAITING | 보존 |
| 답변 저장 | WAITING만 ANSWERED | 보존 |
| 요청 수정 | 원본 보존·수정 이벤트 추가·버전 증가, 업무 상태 보존 | 보존 |

## 작업 분담
메인: 설계·계약·화면·전체검증·배포. IMPLEMENTER: 준비된 독립 작업공간에서 backend/helper/migration 및 실행형 테스트만 P0_LOCAL. 임의 모델 지정 제한에 따라 상속 모델 사용. 외부 쓰기·운영 DB 접근은 메인만. 운영 사용자 데이터 smoke 쓰기 금지.

## 검증
작성자/타인/잘못된 연도·case/오래된 버전/재전송/rollback, REQUEST→RESPONSE→REQUEST, 명시적 메모 상태 보존, 기본 입력과 버튼, 1920×1080 및 작은 화면을 검사한다. 실제 DB schema probe와 배포 결과는 후속 검증 기록에 남긴다.

### 로컬 검증 결과
- 전체 ERP 계약 테스트, dnSpy 근거, 62개 manifest, API 쓰기 가드, Next production build 통과.
- 독립 검토에서 저장 후 GET 실패 시 이력 소실 및 제외 항목 작성자 수정 차단을 발견해 회귀 테스트와 함께 수정.
- 모든 API가 메모리 fixture에서 종료되는 브라우저에서 요청→답변 대기→답변 도착→요청 수정(상태 보존)→재요청→답변 대기 확인. 수정 전 원문과 감사 이벤트 보존 확인.
- 1920×1080/100%: 가로 넘침 없음, 저장 버튼 bottom 606px. 1280×800: 가로 넘침 없음, 상세 독립 스크롤 접근 가능. 브라우저 오류 0건.
- 실제 SQL 트랜잭션과 권한은 fake SQL 실행형 테스트로 검증했으며 브라우저 fixture는 실제 운영 DB 저장 검증으로 간주하지 않음.
