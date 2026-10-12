# JUGWANG-WEEKDAY-001 — 테스트 메뉴 배포 및 이어가기

## 기본정보

- 날짜: 2026-09-30
- 요청: 사용자가 직접 테스트할 수 있도록 주광 요일별 견적 메뉴 배포.
- 작업공간: `C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/jugwang-weekday-test-deploy`
- 최초 브랜치: `codex/jugwang-weekday-test`, 수정 브랜치: `codex/jugwang-compare-runtime-fix`.
- 상태: SMOKE_VERIFIED (초안/읽기 대조 테스트 버전). 전체 ERP 저장·인쇄 제품 완료가 아님.
- 메인: 현재 고성능 Codex 모델, 설계/계약/ERP 판단/통합/외부 쓰기 담당.
- 하위 작업: 상속 모델의 IMPLEMENTER 및 독립 REVIEWER, P0_LOCAL만 사용. 지정 중간·저비용 모델을 별도로 고를 수 있는 환경이 아니어서 모델을 임의로 표기하지 않음.
- 메인 사전 준비: 독립 worktree, 의존성, 사용자 엑셀, 승인 계정 인증 및 dnSpy/읽기 전용 DB 근거 준비 완료. 인증정보는 이 문서에 저장하지 않음.

## 사용자 질문과 합의

1. 주광 견적 메뉴를 만들고 다른 업체도 선택할 수 있게 해 달라 → 고객 검색/직접 선택, 원본 엑셀 임시 파싱, 요일 초안 및 전산 대조 메뉴 구현.
2. 목금토일은 01, 월화수는 02이며 한 대차수 견적과 요일별 견적이 모두 필요하다 → 실제 PeriodDay 목요일 기준으로 업무주기를 연결. 단순 ISO 주차를 사용하지 않음.
3. 37/38/39가 함께 보여야 하고 날짜·차수 이동을 추적해야 한다 → 전/현재/후 차수 행렬과 부분수량 이동 초안, 사유 및 전후 표시 구현. 영속 이력/ERP 적용은 남아 있음.
4. “입고원천을 변경하는게아니라 재고 수량을 변경했어” → 입고 편집 입력 제거. 입고는 읽기 참고만 표시하고 재고 전후값 연결은 별도 구현 대상으로 유지.
5. “배포해서 내가 테스트할수있어야해” → 배포 권한으로 PR/병합/정상 Cafe24 배포 수행. 운영 ERP 데이터 보정 권한으로 확대하지 않음.

## 이번 제공 범위와 제한

URL: https://nenovaweb.com/estimate/weekday?popup=1

- 거래처 선택, 엑셀 원문 조회, 행별 ERP 품목 연결 및 단위 확인.
- 3개 업무주기의 실제 달력, 요일별 초안 수량과 날짜 이동.
- 주문/분배/ShipmentDate/확정 SP 이력 읽기 대조.
- ERP 적용/요일 인쇄 버튼은 비활성. 초안은 새로고침 시 사라짐.
- 입고 후보를 실제 배정 원천으로 단정하지 않음. 입고−주광 분배를 재고잔량으로 위장하지 않음.

## 배포와 검사 근거

- PR #828: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/828
- 최초 master: `d16defb39ccfafbcc1e10eb96a1900873de56384`.
- 최초 Cafe24 배포 36690848418 성공. 실제 달력200이나 대조500을 발견하여 기능 완료로 보고하지 않음.
- 오류 수정 PR #829: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/829
- 수정 master: `1d1405d1fc11e00a40829318cec7e36870ec315b`.
- 수정: bit 확정값 MIN/MAX 내부 int CAST. 기존 shipment/stock-status 집계와 같은 방식이며 두 집계 회귀 검사 추가.
- 전체 ERP 계약, dnSpy 근거, 변경 API manifest/write scope, 요일 테스트 4개, production build 통과. 독립 재검토 P0/P1 없음.
- 1920×1080 CSS pixel/100% Chrome 로컬 fixture: 업로드·연결·대조·부분수량 다음차수 이동, 적용/인쇄 비활성, 가로 잘림 없음, pageerror 없음.
- 후속 Cafe24 Deploy 36692560681: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/36692560681
- 실제 계정으로 후속 대조/업로드 확인은 아래 최종 검증 보충에 기록한다.

### 최종 운영 검증

Cafe24 Deploy 36692560681은 master `1d1405d1fc11e00a40829318cec7e36870ec315b`에서 success로 완료했다. 실제 인증 세션의 신규 달력/대조 API가 200으로 응답했다. 2026/37·38·39의 01/02, 주광농원533, 품목69/2371: 12개 업무키 결과와 날짜행5개 확인. 연도 누락400, 비인증401, 2025 동일차수 요청의 결과 연도 격리 확인.

사용자가 제공한 `C:/Users/USER/Downloads/주광 요일별 출고량.xlsx`를 실제 운영 UI에 업로드하여 원문74행/1시트 파싱 확인. 1920×1080 CSS pixel, deviceScaleFactor1/100%, 가로 잘림 없음, pageerror0. ERP 적용/인쇄 버튼 비활성 확인. 테스트 중 실제 ERP 분배·재고·견적 쓰기 없음.

화면 캡처: `C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/jugwang-weekday-test-deploy/output/weekday-smoke/production-1920x1080.png` (직접 시각 검토 완료).

단위/품목 연결 및 부분수량 이동 전체 사용자 흐름은 로컬 fixture에서 검증했고, 운영에서는 실제 파일 업로드와 신규 조회 API를 검증했다. 실제 분배 저장·확정 재고·인쇄는 아직 구현/검증하지 않았다.

## ERP 부작용과 금지사항

모든 신규 DB API는 SELECT-only. Order*, Shipment*, ShipmentDate, Warehouse*, Stock*, ProductStock, Estimate, WebProfitReport 원장 변경 없음. 정상 배포 파이프라인 자체의 기존 idempotent migration과 신규 원장 쓰기를 구분한다. 다른 세션의 공용 파일 변경·손익/재고 보정은 이번 브랜치에 포함하지 않음.

## 남은 제품 작업

1. 초안 및 연결 결과 영속 저장, ERP 외부 편집 대비 기준 스냅샷/동시수정 검사.
2. 재고 수정의 실제 전후값·수정자·사유·시간과 분배 증감 연결. 직접 기초재고 변경과 분배에 따른 변동 구분 필요.
3. ShipmentDetail 1행+ShipmentDate N행의 단위별 안전한 저장, 확정 취소/재계산/재확정 및 실패 롤백.
4. ViewOrder/ViewShipment/ShipmentDate/ShipmentFarm/견적 DetailFix/확정 매출의 쓰기 전후 실DB·EXE parity 검증.
5. 단일/부분/전체 요일과 대차수 견적 인쇄, EXE ReportEstimate 출력 골든 대조.

## 새 컨텍스트 이어가기

이 문서와 `docs/plans/PRD_JUGWANG_WEEKDAY_ESTIMATES_2026-09-30.md`, `docs/plans/weekday-estimate-change-criteria.md`, `docs/contracts/estimate-weekday-workspace.json`을 읽는다. AGENTS 및 CODEX_SUBTASK_ORCHESTRATION/ERP 가드 적용. 실제 master 배포 상태를 확인하고 완료 범위(초안/비교)와 남은 ERP 저장/인쇄를 구분한다. 입고기록을 바꾸지 않으며 재고 수정 전후 추적 요구를 보존한다. 기존 원본 workspace는 다른 세션의 dirty changes가 많아 통째로 stage/reset/checkout하지 않는다. 인증정보를 로그/문서/커밋에 넣지 않는다.
