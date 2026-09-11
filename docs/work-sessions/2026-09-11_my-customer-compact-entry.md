# 내 업체 주문등록 선택 접기·직전 주문 불러오기

| 항목 | 내용 |
|---|---|
| 기간 | 2026-09-11 |
| 화면 | `/orders/my-customers` |
| 상태 | 구현·필수 검증 완료, PR·배포 예정 |
| 원장 부작용 | 없음. 직전 주문 조회와 화면 초안만 추가하며 저장 API는 변경하지 않음 |
| 기준 화면 | 1920×1080 CSS px, 확대 100% |

## 이어받을 때 고정된 결정

- 로그인 담당자 업체를 우선 노출하되, 활성 업체 전체를 검색·선택할 수 있는 기존 정책은 유지한다.
- 사용자가 차수와 업체를 고르면 선택판을 접고, `차수·업체 변경`으로만 다시 펼친다.
- 품목은 데스크톱에서 세 열 카드로 표시하고, 현재 주문·입력수량·단위·입력 후 값을 행 안에 유지한다. 1180px 이하에서는 두 열, 모바일은 한 열이다.
- `바로 이전 차수 주문 불러오기`는 같은 업체·같은 연도·현재 차수보다 작은 것 중 가장 큰 `OrderWeek`의 활성 양수 주문만 초안에 복사한다. 조회만 수행하며 사용자가 추가/변경등록을 누르기 전에는 원장을 바꾸지 않는다.
- EXE `FormOrderAdd`의 지난 주문 SQL을 2026-09-11 dnSpy CLI로 재확인했다. `CustKey + OrderYear + OrderWeek < current + isDeleted=0`, `ORDER BY OrderWeek DESC`, `TOP 1` 후 `MergeDataBefore`이다.

## 부작용 표

| 사용자 동작 | 읽기 | 쓰기/보존 |
|---|---|---|
| 차수·업체 선택 접기/펼치기 | 화면 상태 | 모든 ERP/웹 원장 보존 |
| 직전 차수 주문 초안 불러오기 | `OrderMaster`, 활성 `OrderDetail`, `Product` — 같은 연도·업체·이전 차수 | 조회만. `OrderMaster`, `OrderDetail`, `Shipment*`, `Estimate`, `WebProfitReport` 보존 |
| 이후 추가/변경등록 | 기존 `/api/orders` 경로 | 기존 계약 그대로; 이번 변경에서 저장 경로 미수정 |

### Q. 차수·업체를 고르면 선택 영역을 닫고, 품목을 세 열로 촘촘히 보여 달라

A. 선택 요약 바와 재개방 버튼을 추가하고, 데스크톱 3열·타이트한 29px 품목 행·내부 스크롤로 변경했다. 품목 원문은 title로 보존하고 화면에서는 카네이션 접두가 반복되지 않는다.

### Q. 바로 이전 최근 차수 주문을 같은 업체 기준으로 곧바로 불러와 달라

A. 과거 목록과 별도인 `previous-order` 읽기 전용 요청을 추가했다. EXE와 동일하게 같은 연도의 가장 큰 이전 세부차수를 고르고, 활성 양수 품목만 현재 입력 초안으로 복사한다.

## 결과·검증

- 변경: `pages/orders/my-customers.js`, `pages/api/orders/my-customers.js`, `docs/contracts/my-customer-order-entry.json`, `docs/exe-golden/FormOrderAdd.md`, `__tests__/myCustomerOrderEntry.test.js`.
- `npm run test:my-customer-orders` 통과.
- `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from 20482685`, `npm run guard:erp-writes -- --changed-from 20482685`, `npm run build`, `git diff --check` 통과.
- DB 쓰기/운영 보정은 수행하지 않았다. 배포 뒤 인증된 1920×1080 화면 스모크가 남아 있다.

## 다음 작업

커밋·PR·master 병합·Cafe24 배포 후 `/orders/my-customers`에서 실제 차수/업체 선택, 선택판 자동 접기, 직전 주문 초안, 세 열 입력을 확인한다.
