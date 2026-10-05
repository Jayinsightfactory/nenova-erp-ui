# 주광 웹 윌슨 구분 및 세부차수 요약

사용자 기준: 윌슨은 선택 요일 옆의 모든 품목에 공통인 웹 표시 열이다. 웹에서만 일반/윌슨을 구분하고 Excel과 실제 견적은 합산한다. 기본 요일 일요일, 선택 가능. 품목은 카네이션/장미/수국/알스트로/기타 순서다. 기준 viewport 1920×1080, 100%.

## 기준과 부작용

| 동작 | 기준 | 공유 ERP 원장 | 웹 파일 |
|---|---|---|---|
| 요일 선택 | 페이지 공통, 일요일 기본, 브라우저 보관 | 모두 보존 | 변경 없음 |
| 기존 합계 분류 | 실제 연도/업무차수/업체/품목/날짜/단위, 0≤W≤T, revision | Order*, Shipment*, Estimate, Stock*, WebProfitReport 모두 보존 | 윌슨 분류만 원자 저장 |
| 일반·윌슨 합계 변경 | 기존 plans.quantity=N+W 한 건, 기존 snapshot/UUID/확정 조건 | 기존 weekday-distribution-apply 계약 그대로 | ERP 성공 확인 후 분류 저장 |
| 분류 저장 실패 복구 | 제출 UUID와 분류 기록 sessionStorage, 같은 분류 idempotent 재확인 | ERP 재저장하지 않음 | 해당 분류만 재시도 |
| Excel/인쇄 | 날짜별 canonical 합계 한 번, 기존 확정 인쇄 조건 | 모두 보존 | 없음 |
| 세부차수 합계/잔량 | 실제 OrderWeek, 동일 연도/업체/품목/단위, 독립 baseline | 모두 보존 | 기존 대차수 수동 마감/이월 보존 |

일반량 N=T-W. 기존 T에 W를 다시 더하지 않는다. 별도 ERP 날짜/가짜 상세행/새 DB 테이블을 만들지 않는다. 외부 ERP 변경으로 total/unit/key가 달라지면 STALE/UNVERIFIED 표시하고 분류 편집을 재확인한다. 기존 합계 유지 분류 버튼은 새 SELECT 검증 후 저장한다. 01/02 잔량은 각 세부차수 기준 독립 잔량이고 대차수 잔량은 기존 이월 마감 기준이다. 달력 일요일이 실제 -02이면 -02에 합산한다.

## 실행 근거

2026-10-05 로컬 dnSpy CLI로 실제 Nenova.exe FormEstimateView 조회: DetailFix=1, ShipmentDate.EstQuantity 및 기존 날짜 합계 경로 확인. 읽기 전용 DB probe 2026/40~42 주광: 533의40-01 상세77/부분확정,40-02 상세22/부분확정;675의40-01 상세6/확정. 새 분류 API는 SELECT만 사용하고 원장·금액·확정·재고에 쓰지 않는다. downstream 실제 합계 수정은 기존 audited distribution 계약 및 전체 회귀로 검증한다. 프로젝트 하위작업 문서는 현재 체크아웃에 없으며 사용자 제공 AGENTS 운영 규칙으로 분담했다.

필수 fixture: 실제 업무차수와 달력 불일치, prior-year 동일 차수, 분류 전용 원장 보존, 0, 음수/범위/단위/키 오류, revision 충돌, 변조, 응답 유실 idempotent 재시도, ERP 저장 후 웹 저장 실패 복구. UI 검증은 sticky/스크롤/겹침/모달/버튼 오류와 작은 viewport를 포함한다.
