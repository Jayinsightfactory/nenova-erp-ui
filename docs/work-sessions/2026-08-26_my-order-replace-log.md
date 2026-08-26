# 내업체 주문등록 현재수량 / 변경·추가 / 작업로그

## 요청
현재 주문수량 누락 점검, 실행로그 표시, 변경등록과 추가등록 두 버튼.

## 구현 전 기준 원천 → 소비 위치
- dnSpy FormOrderAdd.GetDataProduct의 OrderCnt=OrderDetail.OutQuantity → 현재수량 표시와 expectedCurrentQty 공통 기준.
- FormOrderAdd.btnSave_Click: modified rows만 절대수량 저장, 미입력 행 보존; 0 처리시 ShipmentKey 존재하면 차단 → REPLACE 대상은 명시 입력행만, 출고가 있는 품목 0 변경 금지.
- 기존 source=my-customer API의 추가경로 → ADD 기본 유지. 새 orderMode=REPLACE만 절대수량. 타 source에 REPLACE 금지.
- exact OrderYear+OrderWeek+CustKey+ProdKey → GET, 잠금, 사후검증. 중복 활성 주문행 발견 시 합산값은 표시하되 임의 한 행 변경 금지/409.
- 입력값: 빈칸=대상 아님, ADD 양수만, REPLACE 0 이상. NaN/음수/중복 ProdKey 차단. 동일한 최신수량 optimistic check 유지.
- 변경등록은 전체 주문 교체가 아니라 입력한 품목만 교체. 확인창에서 현재→변경 후, 추가는 현재+입력→합계를 표시.
- 실행로그: 시작/요청/서버 결과(이전·입력·최종·단위·품목)/재조회/오류. 실패시 성공으로 표시 금지. 결과 유실시 재실행 전 조회 요구.
- UI scope/load sequence를 검증, 등록 중 차수/업체/입력 조작 잠금, 실패 조회는 0으로 위장하지 않음.

## 부작용
|동작|OrderMaster/Detail/History|Shipment/Date/Farm/Estimate|재고·손익|
|조회/로그|SELECT only|preserve|preserve|
|추가|기존 현재 차수 추가 트랜잭션|preserve|기존 추가 SP 정책 점검|
|변경|입력한 해당 품목 절대량, 이력|preserve, 분배행 0 주문 제거 차단|임의 보정 없음|

## 근거/선검증
2026-08-26 dnSpy.Console.exe -t FormOrderAdd 실제 실행. 저장 GetChanges(Modified), UnitQuantity(true/false), 0+ShipmentKey 차단 확인. 기존 문서의 '항상 추가 전용'은 이번 사용자 요청으로 REPLACE 추가 예정.
운영 SELECT-only probe run 32940568091 성공. 2026 34-01~36-02에서 차이 큰 순 TOP30은 OutQuantity/기존 표시수량 차이 0 (현재 데이터의 표시 누락을 단위문제로 단정하지 않음). 2026/36-01 CustKey680 ProdKey3124 활성 주문 2행 합계16 발견: 합계표시와 단일행 저장 불일치 방어 필요. 2026/34-01 Cust317 Prod53 Out32단/Est320송이로 EstUnit 별도환산 근거. 2025/34-01 Cust461 Prod1003=700은 교차연도 제외 fixture. 기존 audit workflow는 브랜치 임시 프로브 실행 후 원상 복원. 배포/운영 원장 변경 없음.
docs/CODEX_SUBTASK_ORCHESTRATION.md는 저장소에 없음; 사용자 제공 메인 승인/하위 구현 역할 지침을 적용.

## 구현 및 검증
- GET은 같은 연도/차수/업체/품목의 활성 OutQuantity 합계를 표시한다. 로딩 scope/응답순서 방어, 실패시 쓰기 차단, 검색 추가시 현재수량 재조회.
- ADD/REPLACE 순수 정책과 실제 createOrder fake-transaction 테스트: 추가, 절대변경, 0+분배 차단/롤백, 미입력 보존, stale409, 중복 활성행409, 전년도700 보존, 3단=30송이 및0.5단=5송이 환산 통과.
- REPLACE는 출고/견적/재고 재계산을 건드리지 않는다. ADD는 기존 재고 재계산 절차를 유지한다. 실제 운영 주문 쓰기 테스트는 실행하지 않았다.
- UI는 시작/성공/실패/응답불명/저장후 조회실패를 구분하며 로그에 실행 당시 업체/차수와 기존·입력·최종 수량을 보존한다.
- ERP manifest/write guard/dnSpy 및 최종 Next build 통과. 전체 ERP 계약과 CI/배포 결과는 후속 기록한다.
