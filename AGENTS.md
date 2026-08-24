# Nenova ERP 작업 가드

## 새 메뉴·페이지 화면틀 규칙

일반 페이지의 왼쪽 메뉴와 상단바는 `pages/_app.js`만 소유한다. 새 `pages/**` 파일은 내용만 반환하고 `components/Layout`을 import하거나 `<Layout>`으로 다시 감싸지 않는다. 기존 자체 화면틀을 유지하면 `_app.js`의 `NO_LAYOUT`에 명시해 shell이 정확히 하나가 되게 한다. 새 메뉴는 `components/Layout.js`의 `MENU_ITEMS` 한 곳에만 등록한다. 일반 URL은 메뉴/상단바 각 1개, `?popup=1`은 간소화 상단바 1개/왼쪽 메뉴 0개인지 `npm run test:ui-layout`과 실브라우저로 확인한다. 자세한 예시는 `docs/UI_LAYOUT_AND_MENU_CONTRACT.md`를 따른다.

이 저장소의 주문·출고·입고·재고·견적 기능은 `nenova.exe`와 같은 MSSQL 데이터를 사용한다. 관련 기능을 만들거나 수정할 때 아래 절차는 선택사항이 아니다.

## 호환성 범위 고정

이 저장소의 호환성 대상은 **Nenovaweb 브라우저와 `nenova.exe`의 공유 ERP 원장**이다.
Google Play/Expo/Android 15·16 경고, AAB, 네이티브 `.so` 정렬은 MOYI 같은 별도
모바일 앱 저장소의 작업이며 이 저장소의 Nenovaweb 기능 변경에 적용하지 않는다.
`/m` 경로도 네이티브 앱이 아닌 Nenovaweb 모바일 웹 화면이다. 상세 분류와
웹 전용/ERP 원장 부작용 표는 [`docs/NENOVA_WEB_COMPATIBILITY_SCOPE.md`](docs/NENOVA_WEB_COMPATIBILITY_SCOPE.md)를 따른다.

## 작업 전 필수 확인

1. `docs/ERP_CHANGE_GUARD.md`
2. `docs/ERP_FEATURE_CHANGE_CHECKLIST.md`
3. `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`
4. `docs/WEB_VS_ERP_CONFLICTS.md`의 작업 대상 View/SP/dnSpy 섹션
5. `docs/contracts/*.json`의 대상 기능 계약
6. 대상 API의 읽기·쓰기 테이블과 사용자 동작별 부작용 표
7. `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`와 대상 기능의 `docs/exe-golden/*.md` 근거 기록
8. 견적·매출 downstream 영향 표: `Estimate`, `ShipmentDetail.Amount/Vat/isFix`, `WebProfitReport` 및 관련 View

Nenova 연동 기능은 코드를 먼저 작성하지 않는다. 작업 전에 로컬 dnSpy CLI로 실제 `nenova.exe`의 관련 Form/Class/메서드와 SQL 테이블·저장 순서를 확인하고, 동일 업무키에 대한 읽기 전용 DB probe 결과를 남긴 뒤 구현한다. `ViewOrder`와 `ViewShipment` 조회만으로 `ShipmentFarm`, `ShipmentDate`, `OrderDetail`의 동작을 추정해서는 안 된다.

DB 쓰기 기능은 `OrderYear + OrderWeek + CustKey + ProdKey`를 업무 키로 취급한다. `OrderWeek`는 매년 반복되므로 `OrderWeek`만으로 Master를 조회·수정·삭제하거나 집계하지 않는다. PK로 한 행을 지정한 뒤 표시용으로 `OrderWeek`를 읽는 경우만 예외다.

## 차수피벗 주문/분배 계약

| 동작 | 같은 연도·차수·업체·품목의 활성 주문 | OrderDetail | ShipmentDetail |
|---|---:|---|---|
| ADD | 없음 | 양수 주문 신규 등록 | 증가 |
| ADD | 있음 | 변경 금지 | 증가 |
| CANCEL | 있음/없음 | 변경 금지 | 감소 |

- 주문 유무 판정에 전년도 동일 차수를 포함하지 않는다.
- EXE 노출을 위한 수량 0 가짜 주문행을 만들지 않는다.
- 공용 API를 재사용할 때는 `mode`와 순수 정책 함수로 부작용을 명시한다.

농장분배 후보는 EXE의 `ViewWarehouse` 품목 전체 범위와 동일해야 한다. 후보를
보여주는 GET과 최종 저장 트랜잭션은 `lib/shipmentFarmCandidates.js`의 공통
`FARM_CANDIDATE_SCOPE_SQL`을 사용한다. 한쪽에만 연도·차수 조건을 추가하지 않는다.

farm-only 저장은 `ShipmentFarm`과 `ShipmentDetail.Descr`만 변경할 수 있다.
`OrderDetail`, `ShipmentDetail.OutQuantity/Amount/Vat/ShipmentDtm/isFix`,
`ShipmentDate`, `Estimate`, `WebProfitReport`, 영업 매출 원장은 보존 대상이다.
ADD/CANCEL로 출고 수량을 바꾸는 경우에는 견적 노출 진단(`DetailFix=1` 포함)과 해당 차수 확정 매출
집계를 읽기 전용으로 확인하고, 직접 `Estimate` 원장을 생성하지 않는다.

기능 추가·수정은 반드시 계약 JSON과 교차연도 fixture를 함께 추가·갱신한다. 계약이 없는 ERP 기능은 구현 완료로 간주하지 않는다.

## 변경 후 필수 검증

```powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from HEAD^
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
```

동일 검증은 `npm run verify:erp-change` 또는 `scripts/run-erp-change-guard.ps1`로 실행할 수 있다.

운영 DB 보정은 수정 코드가 배포된 뒤에 수행하고, 보정 전후에 같은 연도·차수·업체·품목의 `ViewOrder`와 `ViewShipment`를 대조한다. 계약검사나 빌드가 실패하면 배포하지 않는다.
견적·매출 영향 검증까지 남지 않으면 주문/분배 변경은 완료로 판정하지 않는다.

## 수정 요청과 배포 동시 진행 원칙

사용자가 기능 수정·보완을 요청하면 별도의 배포 지시를 기다리지 않고, 해당 요청을
`수정 → 필수 테스트 → 커밋/PR → master 병합 → Cafe24 배포 → 실브라우저 스모크 확인`
까지 포함한 하나의 작업으로 처리한다. 테스트 실패, GitHub 권한·Runner 장애, 운영
환경 오류처럼 안전한 배포를 진행할 수 없는 사유가 있으면 실패 단계와 재시도 방법을
즉시 보고하고, 검증을 건너뛴 배포는 하지 않는다.

확정 시 음수재고가 발생하면 부족 품목·부족수량을 표시하고, 사용자가 명시적으로 확인한 경우에만 부족수량만큼 `StockHistory(ChangeType='재고조정')`를 기록한 뒤 재고 재계산·재확정을 수행한다. 이력 등록과 재계산은 한 트랜잭션으로 묶고 재계산 실패 시 롤백한다.

## 세션 Q&A 백업 (기본)

의미 있는 작업이 끝나거나 사용자가 백업·컨텍스트 초기화를 말하면 `docs/work-sessions/YYYY-MM-DD_{slug}.md`에 질문→답변을 남기고 `docs/work-sessions/INDEX.md`를 갱신한다. 규칙 `.cursor/rules/session-qa-log.mdc`, 스킬 `.cursor/skills/session-qa-backup/SKILL.md`. 새 채팅은 대화 기억이 아니라 최근 세션 md를 읽는다.
