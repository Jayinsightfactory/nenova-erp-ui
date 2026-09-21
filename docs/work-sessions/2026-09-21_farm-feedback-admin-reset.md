# 농장 피드백 삭제 → 요청 전 복귀

## 요청과 고정 결정
- Q: 삭제하면 기존 요청 전 목록으로 돌아가며 NENOVASS3만 삭제 가능하게 설정.
- 계정은 기존 실제 userId `nenovaSS3`를 정확히 비교한다. 대문자 별도 ID·admin 역할·수입부 권한으로 확대하지 않는다.
- A: 통합 피드백 상세에 관리자 전용 `피드백 삭제 · 요청 전` 버튼. 여러 이력이면 사용자가 고른 CaseKey만 처리한다.
- 물리 Case 삭제 대신, 연결된 Event/Evidence를 삭제하고 Case를 NEW로 초기화한다. 원본 앵커·품목·농장·제목은 남겨 자동감지 패턴이 사라진 과거 건도 요청 전에서 찾을 수 있다.

## Criteria / 부작용
| 대상 | 삭제 후 |
|---|---|
| WebSalesDefectDeduction / ERP 주문·출고·재고·견적·손익 | 변경 금지 |
| 선택 연도+CaseKey+Version | 연도 잠금 및 버전 재검증, Status=NEW, DueDate/AppliedWeek=NULL, Version 증가 |
| 선택 Case의 Event/Evidence | 자식 순서로 삭제 |
| 삭제 Event에 연결된 InboxSource | 해당 연결만 해제; 불량 원본은 보존 |
| 해당 Inbox | 다른 Case와 공유되면 차단; 제외 해제 및 Version 증가 |
| 다른 연도/Case/미연결 이미지 | 보존 |

## 근거
- 웹 전용 기능으로 EXE 원장 또는 공용 SP 변경 없음. `docs/exe-golden/FormFarmQuality.md` 경계를 따른다.
- 운영 읽기 probe: 2026 Case 5건, NEW 0건, 여러 Case가 공유하는 Inbox 0건. LinkedEventKey NOT NULL/FK이므로 이벤트 삭제 전에 원본 연결 해제가 필요하다.
- 현재 NEW 필터는 `feedbackNeedsRequest`로 저장된 Case.Status=NEW를 포함한다.
- 기존 `deleteQualityCase`의 트랜잭션/연도 잠금/정확 계정 권한을 유지한다. stale·실패는 전체 롤백.

## 검증/배포
- PASS: 전체 `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, 변경 manifest 검사, ERP writes guard, `npm run build`.
- PASS: farmQualityStore / farmQualityInboxUi 실제 핸들러 회귀 검사.
- PASS: `node scripts/test-farm-quality-reset-sql.cjs` — 폐기 가능한 SQL2022 별도 DB에서 정확 계정·연도·버전·공유 이력 보호, 트리거 실패 전체 롤백, 동시 요청 1건만 성공, 요청 전 목록 재등장 확인.
- 운영 원본은 읽기만 수행했고 시험 삭제하지 않았다. 배포 및 운영 버튼 확인 진행 중.
