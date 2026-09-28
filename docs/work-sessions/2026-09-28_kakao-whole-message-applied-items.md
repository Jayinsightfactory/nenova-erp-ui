# 2026-09-28 카톡 원문과 품목별 적용 표시

## 요청과 결정
- 사용자는 붙여넣기 주문등록의 영업방 이력에서 좌측에 정리된 카카오 메시지 전체를 보고, 우측에는 적용 항목과 적용 상태 색만 간결히 확인하고 싶다고 명확히 했다.
- 기존처럼 품목별 원문/전산 설명을 반복하거나 상세 사유를 기본 표시하지 않는다. 전산 상세 근거는 접힌 영역에 둔다.
- 개별 품목 audit 연결 근거가 없다는 이유만으로 미적용으로 단정하지 않는다. 검증된 품목 단위 audit이 일치하면 초록색 `적용`, 그 밖에는 주황색 `미확인`이다.

## 구현 범위
- `DistributionSalesInbox`: 전체 원문과 우측 적용 목록의 2열 표시. 작은 폭(1100 CSS px 이하)에서는 위아래로 쌓는다.
- `distributionMessageApplicationStatus`: 성공·검증·차수·원문 identity·파서 request ID·업체/품목 키가 각각 유일하게 일치하는 경우만 적용으로 판정한다. fuzzy 텍스트/수량 매칭 금지.
- 붙여넣기 이력 parser는 verified 플래그를 노출해 검증되지 않은 로그가 초록색으로 오인되지 않게 한다.
- 계약과 UI 및 브라우저 fixture 검증을 갱신한다.

## API / DB 부작용 표

| UI 데이터/동작 | API | 데이터 범위 | 효과 |
|---|---|---|---|
| 카카오 원문 목록 | `GET /api/kakao/sales-feed` | 카카오 feed | 읽기 전용 |
| 현재 전산 이력 참고 | `POST /api/orders/distribution-live-history` | OrderHistory/ShipmentHistory 참고 조회 | `advisoryOnly`, ERP action NONE, ERP 원장 변경 없음 |
| 확인표시·비교 보고서 | 기존 scoped GET API | 수동 확인 ledger 및 감사 보고서 | 읽기 전용 |
| 품목별 붙여넣기 이력 | `GET /api/orders/paste-history` | 붙여넣기 작업 audit | 읽기 전용 |
| 레이아웃과 상태 계산 | 브라우저/순수 함수 | 기존 응답 | 원장 쓰기 없음 |

`OrderDetail`, `ShipmentDetail`, `ShipmentDate`, `Estimate`, 재고 및 매출 테이블 변경은 없다. 외부 쓰기, 운영 DB 보정, 배포는 구현 범위에 포함되지 않으며 배포는 품질 게이트 및 사용자 배포지시에 따르는 프로젝트 절차로 처리한다.

## 검증 기준
- 원문 모든 비공백 줄 유지, 중복 공백줄만 정리.
- 우측에서 업체·품목·수량·상태를 간결히 표시하며 초록/주황색이 구분됨.
- 미확인 상태를 미적용으로 오표시하지 않음.
- 1920×1080 (100% zoom) 및 1366×768, 1100×768에서 가로 넘침·겹침·잘림 없음.
- 관련 node 테스트, ERP contract/evidence/manifest/write guard, production build, 브라우저 fixture smoke 통과 후에만 PR/배포.

## Q&A
- Q: 원하는 화면 결과는? A: 왼쪽의 온전한 정리된 카톡 메시지, 오른쪽의 적용 항목과 색상 상태만.
- Q: 근거 없는 행은 미적용인가? A: 아니다. 미확인으로 둔다.
