---
name: nenova-erp-change-guard
description: Nenova ERP의 주문·분배·입고·재고·견적 기능 변경을 dnSpy/DB 계약, 교차연도 업무키, 부작용 행렬, 자동 테스트와 배포 게이트로 검증한다.
---

# Nenova ERP Change Guard

이 저장소에서 ERP 핵심 테이블을 읽거나 쓰는 기능은 구현 전에 이 절차를 따른다.

## 필수 입력

1. `AGENTS.md`
2. `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`
3. `docs/ERP_CHANGE_GUARD.md`
4. `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`
5. `docs/WEB_VS_ERP_CONFLICTS.md`
6. `docs/DB_STRUCTURE.md`
7. 대상 기능의 `docs/contracts/*.json`
8. `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`와 대상 기능의 `docs/exe-golden/*.md`

## 수행 순서

1. 로컬 dnSpy CLI로 실제 `nenova.exe`의 관련 Form/Class/메서드/SQL 저장 순서를 확인하고 근거 문서를 먼저 남긴다.
2. 동일 업무키에 대한 읽기 전용 DB probe로 EXE의 현재 데이터 상태와 웹 대상 행을 대조한다.
3. 사용자 동작을 만들기·증가·감소·보존 단위로 분해한다.
4. Order/Shipment/Stock 부작용 행렬을 작성한다.
5. `OrderYear + OrderWeek + CustKey + ProdKey`가 필요한 모든 조회·잠금·쓰기 경로를 추적한다.
6. 후보를 보여주는 GET과 저장 트랜잭션의 최종 검증이 같은 SQL/helper scope를 사용하는지 확인한다. 농장 후보는 `ViewWarehouse` 전체 이력 + `ProdKey` 범위이며, `lib/shipmentFarmCandidates.js`를 재사용한다.
7. 견적·매출 영향 표를 먼저 작성한다. `Estimate`, `ShipmentDetail.Amount/Vat/isFix`, `ShipmentDate`, `WebProfitReport`가 직접 또는 View를 통해 어떻게 영향을 받는지 구분한다.
8. 기존 정책 함수를 재사용하되, 결합 API는 `mode`를 명시한다.
9. 기존 주문 있음/없음 × ADD/CANCEL과 전년도 동일 차수 fixture를 테스트한다.
10. farm-only 저장은 `ShipmentFarm`/`ShipmentDetail.Descr` 외 원장을 바꾸지 않는 소스 계약을 테스트한다.
11. `npm run test:nenova-dnspy-evidence`와 `npm run test:erp-contract`를 실행한다.
12. `npm run guard:erp-writes -- --changed-from <base-sha>`를 실행한다.
13. `npm run build`를 실행한다.

## 차단 규칙

- 계약 JSON이 없거나 필수 테스트 파일이 없으면 차단한다.
- 화면이 선택 연도를 API payload에 전달하지 않으면 차단한다.
- `OrderWeek`만으로 Master를 조회·잠금·수정·삭제하면 차단한다.
- 차수피벗의 `CANCEL`이 주문등록수량을 바꾸면 차단한다.
- ADD + 기존 주문이 분배와 함께 주문을 증감시키면 차단한다.
- 수량 0 가짜 주문행을 만들거나 전년도 Master를 재사용하면 차단한다.
- 후보 GET과 저장 검증의 범위가 다르면 차단한다.
- farm-only 경로가 주문·출고수량·금액·날짜·견적·매출 원장을 직접 변경하면 차단한다.
- 견적 노출(`ViewShipment + ViewOrder + ShipmentDate + PeriodDay + DetailFix=1`)과 해당 차수 확정 매출을 읽기 전용으로 확인하지 않으면 차단한다.
- 검증 실패 상태에서 배포하지 않는다.

## 결과 보고

파일과 줄, 사용자 동작, 예상 부작용, 실제 부작용, 견적·매출 read-only 결과, 실행한 명령과 결과를 남긴다. 변경 범위 검사와 저장소 전체 기존 위반을 구분해 보고한다. 이 스킬은 운영 데이터 보정을 승인하지 않으며, 코드 검증과 데이터 보정은 별도 단계로 유지한다.
