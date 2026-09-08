# 견적서 수량·단가 반복 충돌 보강

## 수정 전 판단과 범위

- 기준 코드: 39f1816. 별도 작업공간에서 수행하며 기존 입고차수 복구와 분리한다.
- 확인: 수량 API는 재고 공용 게이트를 NOWAIT로 먼저 확보한다. 다른 업체 작업이라도 동일 재고를 공유하므로 게이트 자체를 제거하거나 업체별로 나눌 수 없다.
- 문제: 잠깐 잠겨 있어도 즉시 업무 오류로 끝나며, 모든 SQL 오류를 STOCK_GATE_BUSY로 오분류한다.
- 보완: 저장 시작 전 확인된 게이트 대기에만 서버가 retryable=true/saved=false를 반환한다. 브라우저는 같은 요청을 최대 5회, 총 15초 대기 후 다시 검증한다. 실제 변경 충돌과 저장 결과 불명은 이 경로로 재시도하지 않는다.
- 확인: 브라우저의 주기적 확인 요청에 세대/응답순서 검사가 없어 저장 전 응답이 저장 완료 응답을 덮을 수 있다. 저장 시작 이전 요청과 저장 중 관찰 응답을 무효화하고 마지막 서버 확인만 적용한다.
- 확인: 서버 GET의 lease/snapshot 병렬 읽기는 이전 기준과 새 데이터를 조합할 수 있다. 잠금 없는 읽기를 유지하면서 앞뒤 lease의 token/revision/baseline/ownership 일치를 최대 세 번 확인한다. 계속 변경 중이면 외부 변경으로 단정하지 않고 일시 확인 상태로 안내한다.
- 잠금 순서 검토: 주기적 확인이 편집권을 잠근 채 원장을 기다리고, 저장은 원장을 잠근 채 편집권을 기다릴 수 있다. HTTP heartbeat를 짧은 편집권 연장 거래 완료 → 잠금 없는 일관성 조회로 분리한다. 업무 저장의 잠금/계산/원장 검증은 약화하지 않는다.

## 근거와 부작용 표

| 동작 | 변경 허용 | 반드시 보존 |
|---|---|---|
| 게이트 대기 응답 | 저장 전 실패 응답 분류와 짧은 재시도 | 게이트 소유권·프로시저·업무 원장 전부 |
| 수량 저장 | 기존 명시 요청의 날짜·분배 수량 및 기존 재고 계산 계약 | 주문, 다른 연도·업체·품목, 확정 상태 |
| 단가 저장 | 기존 Cost/Amount/Vat 및 명시 지정단가 계약 | 수량·재고·확정 상태 |
| 실제 타 사용자 변경 | 안내 후 중단 | 덮어쓰기 금지·자동 기준값 갱신 금지 |

근거: docs/exe-golden/FormEstimateView.md, estimate-date-quantity 및 estimate-cost-update 계약.
EXE 출고일 행은 SdateKey, 차감 행은 EstimateKey로 구별한다. 금액 전용 저장에는 재고 계산을 추가하지 않는다.

## 완료 판단 기준

- 저장 전 대기→성공, 대기 초과, 대기 뒤 실제 변경, 재시도 허가 없는 오류를 실행 검사한다.
- SQL 잠금 오류 1222만 잠금 대기로 분류하고 미확인 SQL 실패는 그대로 전달한다.
- 본인 저장 경쟁과 실제 다른 사용자 변경을 구분하는 실행 검사를 추가한다.
- 필수 ERP 검사와 빌드 후 운영 화면은 1920×1080/100%에서 읽기 전용으로 확인한다.
- 운영 원장 시험 저장, 확정취소, 게이트 해제, SQL 정의 변경은 수행하지 않는다.

## 판단 기준표

| 항목 | 기준 | 소비 경로 |
|---|---|---|
| 재시도 허가 | STOCK_GATE_BUSY + retryable===true + saved===false | gate helper → quantity API → postEstimateWriteJson → recovery |
| 재시도 한도 | 5회·총 대기 15초, 명시 0회는 재시도 없음 | recovery 실행 검사 |
| SQL 오류 구분 | MSSQL 1222만 즉시 잠금 경합, 1205는 기존 거래 재시도 | lockDirectionalGate/withTransaction |
| 편집 범위 | 선택 OrderYear + 부모 OrderWeek + CustKey, token/clientId | 기존 scope 및 서버 소유권 검사 보존 |
| 본인 저장 확인 | transaction-advanced baseline과 현재 원장 비교, refresh 사용 금지 | endSaving heartbeat |
| 늦은 응답 | scope/epoch/sequence/revision으로 이전 응답·오류 폐기 | 공용 편집 확인 hook |
| GET 혼합 방지 | 앞뒤 lease 일치 최대 3회, 무한 대기·쓰기 없음 | getErpEditStatus |

## 작업 배정

- 메인: 별도 작업공간·의존성 준비, 계약/화면 안내·통합·운영 반영. P0/P1/P2, 운영 업무 원장 쓰기 금지.
- Lagrange: 고성능 검토 후 hook 응답 경쟁 수정/실행 검사. P0.
- Peirce: 서버 읽기 일관성 검토/수정. P0.
- Boyle: gpt-5.6-terra/high, 범위가 고정된 재시도/게이트 분류 구현. P0.
- 하위 작업은 외부 전송·인증정보·운영 DB·배포에 접근하지 않는다.

## 검증 결과

- npm run test:estimate 통과. 단가 전용 실행 검사 69개, 날짜 단가 기준 검사 22개 포함.
- npm run test:erp-edit-presence 통과. 실제 DB/React mount가 아닌 순수 요청 coordinator 및 가상 query 실행으로 응답 순서·원장 변경 보호를 재현한다.
- npm run test:erp-contract 전체 통과.
- npm run test:erp-manifest -- --changed-from 39f1816 통과(44개 계약).
- npm run guard:erp-writes -- --changed-from 39f1816 통과(변경 API 2개).
- npm run build 통과(103개 정적 페이지).
- 독립 검토: 서버 GET/heartbeat·재고 게이트·재시도 및 hook/race 검사 범위 모두 GO.
- 운영 재고 게이트는 작업 전 별도 읽기 확인에서 idle이었다. 최근 4시간 SystemActionLog의 견적 오류 검색은 0건으로 개별 사용자 오류 시점과의 연결은 확인하지 못했다. 코드상 재현 가능한 원인을 수정하는 것이며, 모든 기존 오류의 원인이 같다고 주장하지 않는다.
- 운영 업무 수량·단가·주문·재고·확정에 시험 쓰기를 하지 않았다. 배포 후 정상 화면 조회와 확인 응답만 점검한다.
