# 경영관리(mgmt) 모듈 설계 — ECOUNT 이관 작업과 공존 규칙

작성 2026-10-21. 근거: [ERP 공백 3축 대조 보고서](../ERP_GAP_ANALYSIS_2026-10.md) 필요 공백 상위 10.
동시 진행 중인 ECOUNT 카피(동등성 이관) 작업과 **같은 저장소·같은 DB·같은 기간**에 작업되므로, 충돌 없이 합쳐지도록 경계를 먼저 고정한다.

## 1. 한 줄 원칙

ECOUNT 이관은 **"이카운트에 있던 화면을 그대로 옮기는 일"**, mgmt는 **"이카운트에도 없던 관리기능을 더하는 일"**이다. 두 작업은 파일·스키마·메뉴·계약을 전부 분리하고, 데이터는 mgmt가 이관 쪽을 **읽기 전용 어댑터로 소비**만 한다. 이관 쪽은 mgmt의 존재를 몰라도 된다.

## 2. 접촉 금지 영역(이관 작업 소유)

mgmt PR은 아래 경로를 **한 줄도 수정하지 않는다**. CI `test:mgmt-boundary`가 git diff로 검사한다.

| 영역 | 경로 |
|---|---|
| 코드 | `lib/ecount*`, `pages/ecount/**`, `pages/api/ecount/**`, `components/ecount/**`, `components/Ecount*.js` |
| 데이터·명세 | `data/ecount-workbench/**`, `docs/ecount-migration/**`, `docs/ECOUNT_*.md` |
| 검사 | `scripts/check-ecount-parity.cjs`, `scripts/ecount-*.cjs`, `__tests__/ecount*.test.*` |
| DB | `ecount_work` 스키마 전체(DDL·트리거·데이터). 읽기만 허용 |

반대로 이관 작업이 mgmt 영역(`lib/mgmt/**`, `pages/mgmt/**`, `pages/api/mgmt/**`, `components/mgmt/**`, `web_mgmt` 스키마)을 건드릴 이유도 없다.

## 3. mgmt 네임스페이스

| 종류 | 경로 |
|---|---|
| 서버 로직 | `lib/mgmt/*.js` |
| API | `pages/api/mgmt/<feature>.js` |
| 화면 | `pages/mgmt/<feature>.js` (독립 페이지). 기존 화면(거래처 마스터·채권·송금)에는 **탭/배지 1곳 삽입만** 허용하고, 삽입 컴포넌트는 `components/mgmt/*`에 둔다 |
| 테스트 | `__tests__/mgmt*.test.js` |
| 계약 | `docs/contracts/management-controls.json` (단일 계약, 기능 추가 시 scope만 늘림) |
| DDL | `docs/migrations/2026-10-21_web_mgmt_controls.sql` + `lib/mgmt/schema.js`의 ensure(멱등) |
| DB 스키마 | `web_mgmt` (dbo ERP 원장·`ecount_work`와 분리) |

## 4. 공유 파일(충돌 핫스팟) 취급

| 파일 | mgmt가 하는 일 | 규칙 |
|---|---|---|
| `components/Layout.js` | 메뉴 그룹 `경영관리` 1개 추가 | PR 직전 origin/master 리베이스. 다른 그룹 줄은 손대지 않음 |
| `package.json` | `test:mgmt`, `test:mgmt-boundary` 스크립트 2줄, `test:erp-contract` 끝에 `&& npm run test:mgmt` 1토큰 | 같은 줄 끝에만 덧붙임 |
| `__tests__/erpContractManifest.test.js` | `management-controls` 등록 assert 1줄 | 파일 끝 쪽 assert 블록에 추가 |
| `lib/i18n` | 건드리지 않음(라벨은 한글 상수) | |

PR은 기능군 단위로 작게 내고, 머지는 CI 통과 즉시 squash. 줄끝 LF 유지(`core.autocrlf=false`).

## 5. 데이터 경계

- **ERP 원장(dbo.Customer·OrderDetail·ShipmentDetail·Estimate·ProductStock 등)**: 읽기만. 계약 actions의 orderDetail/shipmentDetail은 전부 `preserve`.
- **`web_mgmt`**: mgmt 전용 쓰기. 모든 테이블은 `CreatedBy/CreatedAt`을 갖고, 변경이 의미 있는 테이블(여신한도·단가이력·승인요청)은 **추가 전용 이력 + 현재값 뷰** 구조(덮어쓰기 금지). 하드 DELETE는 `IsDeleted`/`Status='cancelled'` 소프트 처리.
- **`ecount_work`**: `lib/mgmt/sources.js`의 어댑터로만 읽음(`Head`의 활성 버전만). 이관 쪽이 입출금·채권 스냅샷을 적재하면 mgmt 입금대사·aging이 자동으로 그 소스를 쓸 수 있고, 적재 전에는 ERP 입금 테이블로 동작한다. 소스 선택은 어댑터 내부 결정이며 화면은 `source` 라벨만 표시한다.

## 6. 승인(결재선) 모델 — 이관 설계와 호환

이관 설계(`external-integration-design.md`)의 이체·발행 Outbox는 `초안→검토→요청→결과` 상태, 불변 버전, 추가 전용 감사다. mgmt 승인요청(`web_mgmt.ApprovalRequest`)도 같은 의미로 만든다.

- Status: `draft → requested → approved | rejected → applied` (+ `cancelled`). 역행 금지, 하드 삭제 금지(트리거).
- `TargetKind`(remittance·price-change·credit-limit…)+`TargetRef`+`PayloadJson`+`Version`.
- 감사 `web_mgmt.ApprovalAudit` 추가 전용.
- 향후 이관 쪽 Outbox가 구현되면 **뷰 하나로 합칠 수 있는 열 이름**을 쓴다(RequestId·Status·Version·ActorId·DecidedAt).
- `applied`는 web_mgmt 안의 상태 변경만 뜻한다. ERP 원장·은행·이카운트에 쓰지 않는다.

## 7. 기능군과 순서

| 군 | 기능 | 소스 | 쓰기 대상 |
|---|---|---|---|
| A 독립 | ① 여신한도 ② 채권 aging 일수구간 ⑥ 단가 변경이력 ⑦ 클레임 사유코드 ⑧ 차수 마감 체크리스트 ⑨ 거래처별 이익·목표 ⑩ 변경 감사로그 통합뷰 | ERP 읽기 + web_mgmt | web_mgmt |
| B 연계 | ③ 입금 대사 ④ 환차손익 ⑤ 송금 결재선 | ERP + ecount_work(어댑터) + WebFarmRemit | web_mgmt(승인요청·대사결과) |

A군 먼저. B군은 어댑터가 ecount_work 입출금 스냅샷을 읽을 수 있을 때 데이터가 채워지지만, 코드 자체는 소스가 비어 있어도 동작(빈 상태 문구)해야 한다.

## 8. 골든(변화 0) 규칙

- aging 합계 = `/api/sales/ar` 거래처 잔액 합계와 일치(전후표를 테스트에 포함).
- 거래처별 이익 합계 = `/sales/profit-report` 차수 총이익과 일치.
- 여신 경고는 분배·주문 **저장 로직을 바꾸지 않는다**(배지 표시만).
- 기존 화면 테스트(`test:erp-contract`) 전부 통과.

## 9. 개인정보·표시 원칙

감사로그 통합뷰는 **변경 사건**(무엇이 언제 어떤 값에서 어떤 값으로)이 주어. 실행자는 업무 액션(되돌리기·문의) 목적의 열로만 표시하고, 사람별 집계·평가 열은 두지 않는다.

## 10. 활성화

메뉴 그룹 `경영관리`는 `userIds: ['nenovaSS3']`로 시작(사장님만). 경영지원 계정 추가는 기능별 검증 후.
