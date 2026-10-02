# 주광 native NULL 조회·검증 정정 및 차수 오류 표시

## 범위 / 근거

2026-10-02 사용자 ‘수정’: 정상 EXE 상세 CustKey NULL의 웹 오탐과 셀마다 반복된 견적 오류를 수정·배포한다.
[실제 EXE와 운영 읽기 근거](../SHIPMENT_DETAIL_CUSTOMER_NULL_NATIVE_COMPAT_2026-10-02.md)를 적용한다.
EXE 해시 재확인 결과 동일. ClassShipmentDetail의 Insert/Update는 CustKey 미기록,
ViewShipment 고객은 ShipmentKey→Master.CustKey 권위다. 운영39차43+36건NULL은 정상 조회 가능했다.

## 기준 원천 / 소비자

| 기준 | 권위 | 적용 위치 |
|---|---|---|
| 상세 고객 NULL | 실제 EXE 저장 SQL | 공통 weekday customer-link helper에서 허용 |
| 상세 고객 non-NULL | 기존 보수적 웹 보호 | 같은 양수 Master 키만 허용, 0/다른 키 차단 유지 |
| 고객 scope | 잠긴 Master + 활성 Customer | 비교·최초 기준·인쇄·저장 재검증 |
| 수량 표시/이력 | Master로 연결한 실제 상세/날짜 | native NULL을 JOIN에서 제외하지 않음 |
| 동시 수정 지문 | 원본 상세 CustKey 포함 | compare에서 Master 고객과 raw 상세 고객 분리, save digest와 동일하게 구성 |
| 확정 | ERP 상세 isFix / 페이지 최초 기준 별개 | 정상 NULL은 연결경고 아님. 페이지 기준은 ‘기준 미확정’으로 구분 |
| 견적 오류 | 차수별 quoteResults.error | 상단 차수에 한 번 요약, 상세는 명시 펼침/내역. 각 품목 셀에 전체 오류 복제 금지 |

## 부작용 / 보존

| 동작 | Order/Warehouse | Shipment/Date/Farm | Stock/History | Estimate/WebProfitReport |
|---|---|---|---|---|
| 비교·확정 현황·인쇄·최초 기준 preview | 읽기·보존 | 읽기·보존 | 보존 | 읽기·보존 |
| 명시 요일 저장 | 기존 정책 보존 | 기존 확정·정확 날짜·단위·금액·대표일·rollback 계약 유지 | 기존 방향별 재계산/감사 유지 | 보존 |
| 정상 NULL 연결 판정 | 보존 | raw CustKey를 채우거나 변경하지 않음 | 보존 | 보존 |
| UI 오류 정리 | 보존 | 보존 | 보존 | 보존 |

운영 시험 쓰기/DB 보정/DDL/SP ALTER/EXE 변경 금지. 저장 guard만 NULL 정상 경로와 호환시키고
기존 미확정/중복/다른 고객/교차연도/날짜·금액 오류는 유지한다.
기존 최초 기준 기록은 덮어쓰지 않는다. 과거 조회 누락으로 잘못 보관된 기준은 자동 재확정하지 않는다.

## 검증 / 완료 조건

- native NULL 비교·기준·확정경고·인쇄 양성 fixture; 다른 고객·0·교차연도·중복·날짜/금액 near-miss.
- 비교 snapshot raw 키와 잠긴 저장 snapshot 지문 일치; NULL 자체 미수정, 실제 변경은 기존 원자 계약.
- 격리 SQL fixture에서 native NULL 실제 저장·인쇄 및 실패 전체 롤백.
- 1920×1080 / 100% fixture: 동일 차수 오류가 품목마다 복제되지 않음, 상세 접근/숫자/스크롤/버튼 회귀.
- ERP 계약·manifest·dnSpy·write scope·build → PR 검토·배포 → 운영 읽기 전용 smoke.
- 운영 미확정 자료를 자동 확정하거나 정상이라고 숨기지 않음. 검증 안 된606건 전체를 NULL이라고 주장하지 않음.

## 작업 배정

메인: SQL 조회·공통 판정·계약·통합 및 외부 반영. 고성능 검토: 정책·지문·ERP 부작용 독립 검토.
UI 한정 구현: 사용 가능한 저비용 모델로 대체(지정 terra/luna 모델은 도구 목록에 없음).
하위 작업은 P0_LOCAL, 운영/외부 쓰기 및 승인 요청 금지. 테스트 입력·기존 근거는 메인 제공.

## 별도 후속 범위

범용 distribute-diagnose / exe-errors / item-trace의 과거 NULL 진단 문구 및 보정 제안은 이번 요일 화면 저장·인쇄 호출 경로에 포함되지 않는다. 정상 NULL의 SQL 보정은 금지하며, 이들 API의 정정은 별도 작업으로 남긴다. 현재 변경을 전체 ERP 진단 API 정정 완료로 설명하지 않는다.
