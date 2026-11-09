# 입고 정정 영향 분배 검토

사용자 승인: 영업지원에서 입고 이후 영향 차수의 분배를 언제든 열어 확인·변경한다. 기존 확정 행은 승인 트랜잭션 안에서 자동 해제→입력→재확정하고 재고를 함께 반영한다. 미확정 원본은 미확정으로 유지한다. 부족수량 조정은 기존 정확한 수량의 명시 동의를 유지한다.

## 사전 근거·기준표

- 2026-11-09 실제 EXE를 dnSpy CLI로 FormShipmentDistribution, ClassShipmentDetail 재추출. Form의 btnFix/btnFixCancel은 usp_ShipmentFix/Cancel 후 usp_StockCalculation 호출. ClassShipmentDetail.Update는 물리 SdetailKey로 isFix와 수량·금액을 저장한다.
- 운영 SELECT로 두 SP와 ShipmentDetail 트리거 정의 확인: SP는 연도·차수·CountryFlower 전체 상세/헤더와 Product.Stock 및 StockHistory를 변경한다. 요청 범위보다 넓으므로 호출하지 않는다. 기존 receipt gate 아래 선택 상세만 상태를 해제·복원하며 기존 signed stockDelta와 native cascade를 사용한다. 이는 전체 차수 SP 호출과 동일 경로라는 주장이 아니다. 헤더 및 비대상 행은 보존한다.
- SELECT-only 표본: 입고7662/2026/41-02/ProdKey22, 2026/41~45 상세9/출고일9/견적조인9, 농장배정0, 2025 동일품목·차수5행, 45차 활성손익확정0. 45-01 입고→45-03 분배 표본은 현재 없으므로 격리 fixture로 확인한다. 운영 원장 쓰기0.

| 기준 | 정본 | 소비자 |
|---|---|---|
| 영향범위 | readIncomingApprovalFacts의 연도+차수 하한, 입고 원본·최종 품목 | 목록/모달/preview/locked writer |
| 현재 확정 | ShipmentDetail.isFix (헤더와 별도) | 모달/plan.fixed/writer/readback |
| 최종 확정 | 기존 상세 상태 보존, 대체 신규는 원본 상세 상태; 독립 추가는 기존 헤더 정책 | 모달/plan.fixed/writer |
| 수량·단가 | matching.rows 최종값, 0 유효 | 기존 policy/모달/preview |
| 재고 | Product.Stock signed delta, native ProductStock cascade | preview/승인/최종 readback |
| 자동해제 | 명시 사용자 승인 및 최종 확정, 기존 확정 상세만 | writer, 잠금/CAS/digest 보존 |
| 편집 기본값 | 미선택행 유지, 선택 시 원본 날짜·수량·단가 | editDate/normalizeApprovalMatching |

## 부작용 표

| 동작 | 요청/감사 | ShipmentDetail/Date | OrderDetail | 재고 | Estimate/매출/손익 |
|---|---|---|---|---|---|
| 모달 열기/입력 | 메모리만 | 보존 | 보존 | 보존 | 보존 |
| 검토 저장/재검증 | CAS/감사; rehearsal rollback | 영구변경0 | 영구변경0 | 영구변경0 | 영구변경0 |
| 최종 승인 | 기존 원자 writer | 선택 최종값·기존확정복원, farm 계약 유지 | 필요한 양수 신규만 | 입고+확정출고차액/native cascade, 부족 명시동의 | native 견적조인/날짜금액 검산, 독립차감보존, 기존 연결 원가손익 writer |
| 실패 | 전체 rollback | 원상복구 | 원상복구 | 원상복구 | 원상복구 |

표시 재고는 재검증 이전이면 미검증으로 표시하고 이전 preview를 최종값으로 표시하지 않는다. 화면은 연도·차수 필터/업체품목 검색과 현재→최종값을 제공하며 모달 Escape/초점복귀/Tab 범위를 검증한다.

사용자 최신 기준과 기존 policy의 모순: 미확정 원본을 다른 품목으로 옮길 때 새 상세를 헤더 확정값으로 만들던 기본값은 원본 상세 확정값으로 교정한다. 대상 기존 상세 또는 같은 신규 상세로 합칠 원본들 간 확정 상태가 다르면 `APPROVAL_FIX_MERGE_CONFLICT`로 차단한다. 같은 상태끼리의 합침, 명시 독립 신규 추가의 기존 정책은 유지한다. 양성/기존대상 혼합/신규대상 혼합 회귀를 추가한다.

메뉴 기본값: 화면/키보드/맥락/ERP확인/가이드/검증 적용. 파일 업로드·공용매칭 해당 없음. 모달 내부 세로스크롤은 명시 모달 예외. 새 shell/메뉴 없음.
