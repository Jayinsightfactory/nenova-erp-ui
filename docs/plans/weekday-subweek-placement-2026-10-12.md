# 주광 출고일 열과 저장 차수 불일치 수정

## 확인된 문제와 범위

사용자는 2026년 주광농원(CustKey533) CARNATION Brut(ProdKey359)를 41-01 일요일 4박스, 41-02 2박스로 의도했다. 운영 SELECT에서 41-01 상세94736은 확정6박스(10/11 4, 10/13 2), 41-02 상세는 없었다. 기존 41-02 주문3박스는 활성 상태다. 최근 41-02 출고3박스 삭제 감사 기록은 있으나, 기존 41-01의 2박스를 만든 당시 입력 요청은 확인하지 못했다.

수평 표는 날짜를 달력 세부차수로 배치하면서 effectiveOrderWeek에는 원장의 실제 차수를 사용한다. 따라서 41-02로 보이는 화요일 열에 있는 실제41-01 행을 편집하면 기존41-01로 저장하는 경로가 있다. 기존 행을 달력차수로 조용히 재매핑하는 대신 차이를 표시하고 명시적인 차수 정정 작업으로 분리한다.

## 기준 원장과 근거

- fresh dnSpy: 설치 EXE SHA256 `4033996D20006213BD7D7C5454396421FC18B3836CCB7F2C47B1CB8C93C1BD63`, ClassShipmentDate / FormShipmentDistribution 추출 exit0. 기존 WeekdayConfirmationLifecycle golden과 동일 바이너리.
- ClassShipmentDate.Insert는 상세키와 날짜, 출고/견적수량, 단가/금액/세금을 저장한다. 상세의 차수 변경은 날짜 표시만으로 수행할 수 없다.
- SELECT 전용 probe: `outputs/subweek-preflight.mjs`, `outputs/subweek-preflight-downstream.mjs`.
- source 단가10500, target CustomerProdCost10500, 박스→단15배. source 금액+세금945000=90단×10500.
- 활성 주문은 41-01 5박스, 41-02 3박스. 이번 출고 정정에서는 둘 다 보존한다.
- ShipmentFarm 없음, Estimate 없음, 2026/41 WebProfitReport 없음. 재고 스냅샷은 2027까지 있으므로 존재만으로 차단하지 않고 native 재계산 후 음수 검사한다.
- 조회 당시 주광 2026/41 편집 lease는 만료 상태. 저장 직전 재검증하며 강제 해제하지 않는다.
- `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 현재 저장소에 없어서 AGENTS의 역할 분담 규칙을 적용했다.

## 구현 전 기준표

| 기준 | 원천 | 소비자/검증 |
|---|---|---|
| 연도+전체차수+업체+품목 | ERP Master/Detail | matrix, client paired drafts, 기존 API scope/snapshot 검증 |
| 달력 Thu–Sun -01 / Mon–Wed -02 | weekday shipping cycle + PeriodDay | 표시, 차수 정정 target, preview |
| 실제 차수와 다른 열의 일반 수정 차단 | 이번 사용자 요구와 원장 증거 | matrix input/client 제출 |
| 명시 source0 + canonical target 최종수량 | 사용자 의도, 기존 ALLOCATION 원자 저장 | 같은 날짜 두 초안의 완전한 pair에만 중복 예외 |
| 동년·동대차수·동업체·동품목·동단위 | full business key | pair builder/제출 시 재검증 |
| 각 업무키 전체 물리 snapshot+digest | 기존 readActualScope/policy | stale/중복/단위 변경 거부 |
| 기존 날짜와 합계 보존 | ShipmentDate + projectWeekdayDistribution | source Sunday4 보존, 날짜 누락=보존 |
| 단가·총금액 보존 | CustomerProdCost+physical source | 기존 assertWeekdayPricePreservation |
| 확정 취소→수량→재확정 및 native 재고 | dnSpy/SP + 기존 lifecycle | 기존 core 단일 transaction, SQL fixture |
| 실패와 재시도 | 기존 operation UUID/audit | 모든 단계 rollback, replay 무변경 |

## 부작용 표

| 동작 | Order* | ShipmentMaster/Detail | ShipmentDate | ShipmentFarm | Product/Stock* | Estimate/WebProfitReport |
|---|---|---|---|---|---|---|
| 조회·차수 정정 초안·preview | 읽기 | 읽기 | 읽기 | 보존 | 읽기 | 보존 |
| source 감소 + target 증가 원자 저장 | 활성 주문 보존; target 주문 없을 때만 양수 신규 | 선택 두 키만 기존 lifecycle 변경/신규 | 선택 날짜 source0,target최종량; 다른 날짜 보존 | 기존 계약에 따른 검증, 임의 농장 지정 없음 | 확정 전환 후 native 연쇄 재계산, 음수 시 전체 rollback | 직접 쓰기 금지, 합계/노출 검증 |

## 완료 기준

client positive/near-miss(반쪽 pair, 다른 연도/차수/품목/단위, 중복 실제행, stale snapshot)와 실제 SQL 같은 날짜 차수 이동/rollback/UUID fixture를 통과한다. 1920×1080 100% 및 작은 화면에서 실제 차수 안내·키보드·preview를 확인한다. 필수 ERP gates/build 뒤 PR/master/Cafe24 배포 및 실브라우저 확인을 수행한다. 운영 정정은 배포 후 직전 재조회와 같은 core를 통해 별도로 실행하고 전후 Views, 날짜, 확정, 주문, 재고, 견적 노출을 기록한다. 미실행 상태를 완료로 표시하지 않는다.
