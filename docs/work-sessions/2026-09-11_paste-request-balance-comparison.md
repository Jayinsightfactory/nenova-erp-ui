# 카톡 분배요청·실제 변경·잔량 대조

| 항목 | 내용 |
|---|---|
| 화면 | 붙여넣기 주문등록 영업방 수신함 |
| 기준 코드 | 9aa92ae57eab3da080bd2acaebc5c916fbfed72d |
| 원장 부작용 | 전부 보존; 조회 전용 대조 |
| 상태 | 구현·계약 검사·빌드·로컬 브라우저 검증 완료; 배포 진행 |

## 고정 결정

- 전체 대화/이력을 나열하는 대신 분배 요청과 해당 업체·품목의 변경량을 비교한다.
- 기본은 미확인·부분·수량 차이 우선, 일치 이력은 접어서 볼 수 있다.
- A업체 취소와 B업체 추가가 상쇄되어 잔량 변화 0이어도 정상일 수 있다.
- 주문 이력은 분배 완료 근거가 아니다. 현재 잔량도 과거 완료의 근거가 아니다.
- 저장 잔량과 예상 잔량은 다르며 근거 없는 예상 잔량을 생성하지 않는다.
- 비교 결과로 ERP 등록·분배·확정을 제한하지 않는다. 수동 표시는 별도로 보존한다.

## Q&A

### 1. 사용자 요청

**Q.** 잔량과 분배요청을 비교하는 API가 필요하다. 모든 내용을 보여주는 것이 아니다. 작업 시작.

**A.** 기존 읽기 전용 이력 API를 확장하고 원문 바로 옆에 요청·확인된 분배 변화량·차이·잔량 근거를 표시한다. 수량 쓰기나 자동 LLM 실행은 추가하지 않는다.

## 사전 근거

- 로컬 dnSpy 추출 `FormShipmentDistribution.GetProductList`의 StockMaster/ProductStock 선택 차수 조회와 ViewWarehouse/ViewShipment OutQuantity 기준 확인.
- `lib/exeStockViewSql.js`와 `lib/shipmentFixReconcile.js`를 대조: 저장 snapshot에서 미확정분을 단순 차감하면 stale snapshot 이중차감 가능. 임의 재고 계산 금지.
- 2026-37-01 운영 출고·재고상황 화면 읽기 조회 성공. 직접 API 문서 열기는 브라우저 정책으로 차단되어 우회하지 않았다.
- 하위작업은 로컬만, 외부 쓰기·병합·배포는 메인만 실행.
- `outputs/` 및 기존 사용자 파일 `scripts/check-baseline-local-files.cjs`는 커밋 대상 제외.

## 검증·운영 결과

- `npm run test:erp-contract` 전체 통과; 분배 연결 22개 테스트 포함.
- `npm run test:erp-manifest -- --changed-from 9aa92ae5` 57개 manifest 통과.
- `npm run guard:erp-writes -- --changed-from 9aa92ae5` 변경 API 1개 확인 통과.
- `npm run build` 103페이지 통과. 기존 module type/webpack cache 경고는 비차단.
- 최종 독립 검토: 잔량 조회 실패 시 기존 이력 200 응답 보존, 중복 StockMaster 독립 확인, 원문별 요청 분리, 중간 응답 호환 보강 후 차단사항 없음.
- 운영 재고 조회에서 SALAL TIPS 저장 잔량 44와 출고·재고상황 계산 잔량 37이 달랐다. 따라서 저장 잔량을 추가 가능 수량이나 과거 반영 증명으로 사용하지 않는다.
- 로컬 Chrome `1920×1080`, 100%: 기본 예외 필터, 일치 포함, 요청별 -1/+1, 요청3/분배1/차이2, 저장잔량/미확인 구별, 실패 시 마지막 결과·입력 유지 통과. 가로 잘림 없음, 오류 없음, 허용 외 POST/외부 네트워크 없음.
- 재현 스크립트: `scripts/paste-request-balance-ui-smoke.cjs`; 결과 캡처는 `outputs/paste-request-balance-ui-1920.png` (로컬 보관).
- PR·운영 배포 결과는 후속 기록한다.
