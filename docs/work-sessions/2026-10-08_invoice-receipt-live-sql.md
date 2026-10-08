# 인보이스 통합 입고 — 로그인된 SSMS 읽기 검증

## 사용자 요청과 실제 수행

- 요청: PC SQL에 로그인해 두었으니 직접 작업. 인보이스→입고→실제량 도착원가 통합 검증/배포의 후속.
- 수행: Windows Computer Use 스킬의 sky로 SSMS 새 쿼리에서 SELECT 실행.
- 접속 DB nenova1_nenova, VIEW DEFINITION=1. 로그인/비밀값을 읽거나 변경하지 않음.
- 실행한 쿼리는 객체 정의/스키마/인덱스/기본값/집계/잠금 상태 조회뿐.
- 운영 INSERT/UPDATE/DELETE, EXEC, DDL, 채번, 잠금 해제, 확정 변경, 입고 시험 저장 없음.

## 새로 확인한 핵심

1. usp_CreateWarehouse가 공용 TempWarehouseDetail 전체를 입고 상세·StockHistory·Product.Stock에 반영한다. 문서/사용자 scope 인수가 없다.
2. 조회 순간 staging 4행/1 WarehouseKey 존재. 고아로 단정하지 않았으며 삭제하지 않았다.
3. gate Mode=NULL/PendingCalc=0/ProtocolVersion=2. 현재 순간 idle이며 과거 busy 원인·재발 없음의 증거가 아니다.
4. WarehouseMaster.WarehouseKey는 비identity/NOT NULL/기본값 없음. 기존 웹 POST는 키를 생략한다. EXE는 GetNextKey("WarehouseKey")를 명시 호출하고 Master/Temp에 같은 키를 넣는다.
5. 실제 usp_GetNextKey는 KeyNumbering을 증가시킨다. 조사에서는 정의만 읽고 실행하지 않았다.
6. 관련 트리거 조회는 Product tiny-stock 정규화 1개 반환. WarehouseMaster 키 자동생성 트리거 없음.
7. FreightCostDetail은 WarehouseDetailKey가 있으나 WebArrivalCostLine은 입고 상세 연결키가 없다. 기존 원가 API를 그대로 연결하면 문서별 원가 보존을 보장할 수 없다.
8. 실제 ViewWarehouse는 wm.isDeleted=0 조건이며 Product.isDeleted 조건은 없다.

## 읽기 집계

| 연도/세부차수 | 활성 입고 Master | Detail |
|---|---:|---:|
| 2025/40-01 | 41 | 228 |
| 2025/41-01 | 53 | 562 |
| 2025/41-02 | 18 | 58 |
| 2026/40-01 | 65 | 574 |
| 2026/41-01 | 45 | 429 |
| 2026/41-02 | 8 | 31 |

FreightCostDetail 34행 중 WarehouseDetailKey 비NULL 34행. FK 유효성/계산 정확성은 별도 검증 필요.

## 근거와 변경 파일

- `docs/diagnostics/2026-10-08-invoice-receipt-live-evidence.json`: UI에서 읽은 SP/트리거/스키마.
- `docs/diagnostics/2026-10-08-invoice-receipt-key-counts.json`: 채번 SP/기본값/집계.
- `docs/diagnostics/packing-receipt-readonly.sql`: 재현용 SELECT 확장.
- PRD §12 현행 SP 미확인 문구 갱신, §15 실DB 근거/배포 차단 조건 추가.
- invoice-receipt-workflow 계약 근거 갱신. 실제 writer 미연결 상태는 유지.
- 진단 JSON의 SQL 정의는 UI가 줄바꿈을 정규화한 읽기 근거다. SQL 실행/배포 원문으로 사용 금지.

## 검증과 남은 작업

- 기존 순수 대조 테스트 11/11 통과, git diff --check 통과.
- 이 턴은 진단/문서 변경. UI/저장 코드 구현, 전체 빌드, 배포, 운영 쓰기 테스트는 하지 않음.
- SQL 접근 차단은 해소됐지만, 기존 POST 직접 연결은 안전하지 않다.
- 후속 사용자 `진행.`으로 웹 전용 문서/행/operation/이력/원가버전 6개 빈 테이블 추가 승인. 기존 ERP/공유 SP/EXE 변경 승인은 아님. 실제 적용 여부는 후속 저장 구조 검증 기록으로 확인한다.
- 공용 staging을 건드리지 않는 writer 설계와 native 효과 대조, 격리 SQL 저장/실패/EXE 동시성 검증 후 연결.
- 주문/출고/견적 원장 자동 변경이나 EXE/기존 공유 SP 수정은 이 조사로 승인된 것이 아니다.

## 하위 검토

- 모델 gpt-5.6-sol / REVIEWER / high / P0_LOCAL 읽기 전용.
- 사전 준비: main이 인증된 SSMS에서 민감 로그인값 없는 근거 JSON 준비.
- 권한: 파일수정/SQL접속/외부쓰기/운영쓰기/배포 금지.
- 대상: 실제 SQL 근거와 현행 API/PRD의 호환 위험 교차검토.
- 완료 판정: 현행 POST 직접 연결/배포 불가. 채번만 고치면 전체 staging 소비 위험이 실제로 활성화될 수 있어 부분 패치 금지. 신규 웹 전용 저장 설계/승인 및 격리 동시성·롤백 검증이 먼저다.
- 미검토: 구체 신규 DDL/격리 writer, 기존 원가 참조 유효성, 실제 동시성 결과. 검토자가 이 범위를 검증 완료로 주장하지 않음.

## 다음 작업 인계

PRD §15와 진단 JSON을 먼저 읽는다. ‘DB 연결이 없어 SP 미확인’이라는 과거 설명을 반복하지 않는다.
그러나 ‘SQL 조회 성공=입고 자동등록 검증/배포 완료’로 보고하지 않는다.
기존 dirty `2026-10-07_packing-db-product-match.md`는 이전 작업 변경이므로 보존한다.
