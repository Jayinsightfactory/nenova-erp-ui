# 주광 요일 저장·견적 EXE 호환

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-02 |
| 화면 | /estimate/weekday |
| 작업공간 | work/jugwang-weekday-test-deploy |
| 브랜치 | codex/weekday-exe-compatibility |
| 원장 부작용 | 명시 저장만 출고수량/일자/대표일/금액/재고 및 이력 원자 변경. 주문·입고·Estimate·최초기준 보존 |
| 배포 | 검증 후 PR/배포 결과를 아래 추가 기록 |

## 고정된 결정

- 사용자 요청은 요일 셀 변경을 실제 ERP 저장·출고일 변경·견적까지 호환되게 하는 것.
- 초안 입력만으로 운영 DB가 바뀌지 않는다. 변경 확인과 사유 입력 후 명시 저장.
- 기존 상세 확정 후 저장. 임의 전체 확정 해제·확정·재확정 없음.
- 최초 기준 확정은 page-only이며 ERP 상세 확정과 다르다.
- EXE 실제 순서(day1 일요일부터 day7 토요일)로 대표 ShipmentDtm도 동기화한다.
- 인쇄의 메인차수 전체 확정 요구는 사용자 안전 정책. EXE 자체 전역 검사라고 주장하지 않는다.
- 전역 isFix 현황과 선택 업체 견적 연결/수량/금액 검사를 분리한다.

### 1. 수량 변경하면 어떻게 처리하나

Q. 요일별 수량 변경의 처리 방식과 EXE 호환 여부.
A. 기존 초안→명시 저장 흐름을 확인했고 미확정 저장 및 대표 출고일 비동기 위험을 설명했다.

### 2. 호환성이 문제없게 로직 만들어줘

Q. 실제 호환 보완 구현.
A. 실제 CLI 3개 클래스/폼 재검증, 운영 조회 표본 확인, 공유 확정 predicate,
대표 출고일 digest·저장·readback, SERIALIZABLE 인쇄 검증/원본 결과 재대조를 구현했다.
운영 40-01 주광 블루20은 최신 조회 시 미확정이었다. 자동 복구/확정하지 않는다.
격리 DB에서 실제 저장·인쇄·전후연도·동시 변경·실패 롤백을 검사했다.

## 산출물과 검증

- docs/plans/weekday-exe-compatibility-2026-10-02.md
- lib/weekdayErpCompatibility.js, weekdayDistributionPolicy/Apply/Client.js, weekdayEstimatePrint.js
- 운영 코드 비교 API, 인쇄 API, workspace 안내 및 SQL/단위/브라우저 fixture
- output/compat-*.log는 로컬 증거이며 커밋하지 않는다. .next-*·기존 output 사용자 파일 보존.

### 출시 전 검증

- 실제 dnSpy 재확인: FormShipmentDistribution / FormEstimateView / ClassShipmentDetail.
- 단위·ERP 회귀, manifest 77개, 변경 API write-scope, dnSpy 근거 guard 통과.
- 격리 SQL Server 실제 트랜잭션 저장·인쇄 및 실패 롤백 검사 통과. 운영 SQL 쓰기 없음.
- 브라우저 fixture: 1920×1080 CSS px / 100%, 수량 수정·미확정 차단·실패 초안 보존·재시도·요일 인쇄 검증 통과.
- 최종 검토 P0/P1 없음. C# decimal midpoint-to-even과 기존 웹 half-up의 완전한 저장 금액 tuple만 허용한다.
- 명시 0단가는 보존하지만 견적 단가 NULL/빈값/비정상 값은 0으로 치환하지 않고 409로 차단한다.
- 배포 및 운영 읽기 전용 smoke 결과는 출시 후 기록한다.

## 한계와 이어받기

운영 실제 수량 시험 쓰기 및 EXE GUI 조작 시험은 하지 않았다. 실제 저장은 사용자 업무 시
서버의 최종 잠금 검사로 판정한다. 성공한 fixture만으로 모든 운영 원장에 이상이 없다고
주장하지 않는다. 기존 이월값은 웹 별도 기록이지 ERP 재고 변경이 아니다.

다음 작업은 이 문서/계약/최신 PR 상태를 읽고 시작한다. 운영 보정·확정 일괄 작업은
별도 사용자 승인 없이 수행하지 않는다.
