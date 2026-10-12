# Nenova ERP 작업 가드

이 저장소의 주문·출고·입고·재고·견적 기능은 `nenova.exe`와 같은 MSSQL 데이터를 사용한다. 관련 기능을 만들거나 수정할 때 아래 절차는 선택사항이 아니다.

## 기본 미래대응·최신근거 검토

모든 기능 작업은 [`docs/FUTURE_READY_ENGINEERING.md`](docs/FUTURE_READY_ENGINEERING.md)를 기본 적용한다.

- 사용자의 현재 요구사항뿐 아니라 최신 공식 기술·보안 기준과 향후 변경 시나리오를 함께 검토한다.
- 코드가 존재하는지와 운영 데이터에서 실제로 동작하는지는 분리해서 보고한다.
- 작업에 적용되는 운영 DB·최신 `nenova.exe`·실제 브라우저·MOYI/외부연동 검증을 확인하지 못하면 운영 완료로 표시하지 않는다. `미확인`과 근거가 있는 `해당 없음`은 구분한다.
- 최신 기술은 호환성·지원기간·롤백·의존성·보안 영향을 비교한 뒤 적용한다.
- 사용자가 요청하지 않은 보완도 장애·유출·데이터 손실·확장성에 영향을 주면 제안한다. 운영 원장 변경이나 범위 확장은 승인 후 실행한다.
- 향후 다른 업체 제공 시 MOYI 공통 Core와 Nenova connector를 분리할 수 있어야 한다.

## 작업별 규칙 안내

요청과 실제 변경 파일·API·데이터 흐름으로 적용 범위를 정한다. 여러 유형이면
필요한 검증을 합친다. 화면 파일만 바뀌어도 payload, 업무키, 수량·금액 계산,
저장 호출이 달라지면 ERP 기능 변경으로 분류한다.

| 작업 | 먼저 읽을 근거 | 완료 확인 |
|---|---|---|
| 질문·조사 | 관련 규칙·코드·공식 출처 | 사실·추론·미확인 구분, 출처 |
| 문서·규칙만 수정 | 대상 문서와 연결된 규칙 | 변경 차이, 링크, 정책 충돌, 대표 요청별 적용 검토 |
| 순수 배치·스타일 수정 | 화면 코드, 호환성 범위 문서 | 1920×1080·100% 브라우저 검증, 잘림·겹침·sticky·모달·버튼·표 스크롤 |
| ERP 조회·저장·계산·업무 동작 | 아래 작업 전 필수 확인 전체와 대상 계약 | dnSpy·동일 업무키 DB 근거, 계약·교차연도 fixture, 아래 필수 검증 전체, downstream·배포 후 확인 |
| ERP 조회를 사용하는 인쇄·엑셀 | 대상 계약, 조회·계산 코드, 원본 업무키 | 표시값·합계·레이아웃 대조, ERP 조회 변경이면 위 ERP 검증도 적용 |
| MOYI·외부연동 | 대상 저장소 규칙, 연동 계약·권한·이벤트 흐름 | 실제 연동 검증, 공유 ERP 영향이 있으면 ERP 검증 추가 |
| 배포·운영 확인 | 대상 변경·CI·배포 절차 | 배포 버전, API·실브라우저 smoke, 관련 원장 대조 |
| 세션 백업·인계 | 아래 백업 규칙과 해당 스킬 | 결정·산출물·미완료·다음 작업 입력 보존 |

- 문서 전용·순수 스타일 분류는 API, SQL, 스키마, 업무 계산·저장 동작이 바뀌지 않는 것을 확인한 경우에만 사용한다.
- 위 표는 기존 ERP 필수 검사나 CI를 생략하는 허가가 아니다. 영향 범위를 확인할 수 없으면 `미확인`으로 남기고 조사한다.
- 문서 전용 작업은 문서에 맞게 검증한다. 웹 기능 수정의 커밋/PR·병합·배포 절차는 아래 원칙을 유지한다.
- 완료 단계와 검증 결과는 `docs/FUTURE_READY_ENGINEERING.md`의 완료 판정 기준을 사용한다.

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

## 하위 작업 모델·권한 운영 (필수)

하위 작업을 만들거나 병렬 작업을 시작하기 전에 [`docs/CODEX_SUBTASK_ORCHESTRATION.md`](docs/CODEX_SUBTASK_ORCHESTRATION.md)를 읽고 적용한다.

- 설계·데이터 계약·ERP 부작용 판단·최종 통합 검토는 고성능 모델이 담당한다.
- 범위가 확정된 구현은 중간 비용 모델, 검색·fixture·테스트 실행·문서 정리는 저비용 모델이 담당한다.
- 메인 작업이 입력 파일, 의존성, 인증, 읽기 근거와 수정 범위를 먼저 준비한다.
- 하위 작업은 승인 요청을 생성하지 않는다. 추가 권한이 필요하면 가능한 로컬 작업을 끝낸 뒤 `NEEDS_MAIN_PREFLIGHT`로 메인에 반환한다.
- push, 변경사항 검토 요청, 병합, 배포, 운영 DB 쓰기, 비밀값·권한 변경은 메인 작업만 수행한다.

## 세션 지식 백업 기본 규칙

사용자가 세션 종료, 백업, 인계 또는 컨텍스트 초기화를 요청하면 개인 스킬
`session-knowledge-backup`을 적용한다.

- `docs/session-backups/YYYY-MM-DD_<작업명>.md`에 세션별 기록을 남긴다.
- 사용자 질문과 답변·조치를 시간순으로 요약한다.
- 결정사항, 생성 파일, 관련 작업 ID, 미완료 항목, 다음 세션 인계문을 포함한다.
- 실제 완료 결과와 제안·계획을 구분하고, 비밀값이나 대형 도구 출력은 기록하지 않는다.
- 컨텍스트 초기화 요청 시 백업을 먼저 만든 뒤 새 작업을 생성한다. 기존 작업은 명시적 요청 없이 삭제하거나 보관 처리하지 않는다.
