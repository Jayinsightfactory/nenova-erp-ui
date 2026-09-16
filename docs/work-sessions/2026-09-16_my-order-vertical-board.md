# 내 업체 주문등록 세로 품종 보드

| 항목 | 내용 |
|---|---|
| 기간 | 2026-09-16 |
| 화면 | /orders/my-customers |
| 원장 부작용 | 없음: UI 배치 및 표시 정렬만 변경 |
| 작업 브랜치 | codex/my-order-vertical-board |
| 다음 힌트 | 기존 수량·추가/최종 초안·승인 fingerprint를 보존할 것 |

## 고정 결정

- 차수와 업체는 왼쪽 세로 선택 영역에 상시 표시한다.
- 기존 이력 기반 후보 범위와 품종 그룹 순서를 유지한다.
- 각 품종의 품목을 A–Z 순으로 세로 정렬하고 품종 열은 가로 스크롤한다.
- 영문 품종/국가/농장 접두를 건너뛴 품목명으로 정렬하며 한글 전용 이름은 뒤에 둔다.
- 기존 우측 주문수량과 승인 후 저장 절차는 변경하지 않는다.

### 1. 세로 배치 요청

**Q.** 차수·업체는 왼쪽에, 품목은 품종별 세로 열로 나열하고 A–Z 순서 및 좌우 이동을 제공해 달라.

**A.** 왼쪽 선택 rail, 가운데 품종별 독립 세로 스크롤 열 및 가로 보드, 오른쪽 기존 주문 내역을 유지했다. API 및 원장 조회 조건은 변경하지 않았다.

**근거.** 기존 FormOrderAdd 증거(`docs/exe-golden/FormOrderAdd.md`)의 CountryFlower 그룹과 OrderDetail.OutQuantity 계약을 유지한다. 이번 변경은 프런트 표시만 대상이므로 운영 DB 쓰기 테스트를 하지 않는다. 프로젝트 orchestration 문서는 현재 checkout에 없다.

| 동작 | OrderMaster/OrderDetail/OrderHistory | ShipmentDetail/ShipmentDate/ShipmentFarm | Estimate/WebProfitReport/Stock |
|---|---|---|---|
| 정렬·가로/세로 스크롤·그룹 이동 | 보존 | 보존 | 보존 |
| 차수·업체 선택 | 기존 읽기 전용 API | 보존 | 보존 |
| 승인 후 주문등록 | 기존 계약 그대로 | 기존 계약 그대로 | 기존 계약 그대로 |

**검증.** ERP 계약, dnSpy evidence, manifest, write guard 및 production build. 전체 API를 fixture로 차단한 Chrome 1920×1080 smoke에서 A–Z/세로행/가로이동 확인, 1280/768/390 외부 가로 넘침 검사. 기존 승인 smoke에서 승인 전 POST 없음, 수정 시 재승인, 추가/감소 payload 확인. 실제 운영 주문 쓰기 0건.

## 미완 및 임시 파일

- PR·배포 결과는 해당 브랜치 PR 및 CI 기록에 남긴다. 실패하면 배포 완료로 간주하지 않는다.
- Temp의 my-order-board-smoke.cjs, my-order-approval-smoke.cjs 및 스크린샷은 검증용이며 커밋하지 않는다.
