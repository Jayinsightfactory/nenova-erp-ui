# 주광 수량·요일 확정 전환 (2026-10-09)

## 근거와 범위
사용자가 확정 수량 수정의 취소→수정→재확정, 미확정 요일 수정의 확정→이동을 명시했다.
`output/early-shipment-integration/fix-cycle-{FormShipmentDistribution,FormEstimateView,FormShipmentView,ClassShipmentDate}.txt`는 설치 EXE를 dnSpy CLI로 새로 추출한 성공 결과다. 같은 폴더 fix-cycle-probe.jsonl 및 fix-cycle-downstream.jsonl은 운영 SELECT-only 결과다. 비밀값과 원본 업무행은 커밋하지 않는다.
Native usp_ShipmentFix/Cancel은 CountryFlower 전체 범위이므로 직접 호출하지 않고, 동일 재고 반환/차감·이력 의미를 정확한 상세 업무키로 제한한다. native usp_StockCalculation은 실제 SP를 호출한다.

## 처리 기준
- 확정+수량: 취소(기존 수량 반환), 수량 저장, 재확정(신규 수량 소비), 필요한 날짜 이동.
- 확정+요일만: 확정을 유지하고 날짜 이동.
- 미확정+수량만: 수량 저장, 미확정 유지.
- 미확정+요일 이동(복합 포함): 수량 저장이 필요하면 먼저 저장, 확정, 날짜 이동.
- 같은 업체·품목 요청 전체의 감소와 증가를 이동으로 판단한다. 세부차수 이동은 단순 delta로 오판하지 않는다. 단가가 모호한 이동은 차단한다.
- 소비 증감=(최종 확정?신규수량:0)-(기존 확정?기존수량:0). 0개 삭제는 취소 후 삭제하고 빈 상세를 확정하지 않는다.
- 새 분배만 등록하는 경우 미확정 유지. 선출고 내부 호출은 기존 정책을 유지하도록 일반 weekday API의 trusted dependency로 새 전환을 선택한다.

## 부작용과 계약
| 대상 | 변경 |
|---|---|
| OrderMaster/Detail | 기존 주문 보존, 기존 ALLOCATION 신규 양수 주문 계약 유지 |
| ShipmentDetail | 정확한 대상 수량/금액/대표일/isFix |
| ShipmentDate/History | 대상 날짜 및 이력, 단계별 로그 |
| ShipmentMaster | 실제 surviving 자식의 확정 상태 재계산, 다른 상세 보존 |
| Product/StockHistory | 실제 확정 반환·차감, 출고확정 취소/출고확정 |
| StockMaster/ProductStock | native 재계산, 현재·후속연도 실제 음수 시 rollback |
| ShipmentFarm | 보존, 0개 native purge 예외 |
| Estimate/WebProfitReport | 직접 원장 쓰기 없음; 실제 View/확정 날짜로 출력 |
| 감사/UUID | 같은 outer transaction, before/final 상태·단계·소비량 기록, replay 추가 쓰기 없음 |

## 검증
4가지 상태와 복합·세부차수 이동·0삭제·현재/후속재고 부족·모든 단계 실패 rollback·동일 UUID·이전연도/다른업체 sentinel·날짜 합계/단위/금액·요일별 인쇄를 테스트한다. 운영 ERP 쓰기로 검증하지 않는다. UI는 1920×1080/100%, 페이지 세로 스크롤과 가로바 유지. 필수 ERP gates/build 통과 후 PR/master/Cafe24 배포한다.

## 기준 원장과 소비자
| 기준 | 권위 | 소비자·검증 |
|---|---|---|
| 연도+세부차수+업체+품목, 실제 상세키 | 잠긴 Master/Detail, EXE View | compare snapshot→preview→prepare→전환 SQL→readback, 이전연도/다른업체 sentinel |
| 수량 절대 최종값·명시0·미입력 보존 | 기존 normalize/buildWeekdayChangePlan | UI 제출·서버 잠금 재검증·날짜 합계, 0삭제 fixture |
| 수량 vs 날짜 이동 | 같은 연도/업체/품목 요청 전체 날짜 감소·증가 | 공유 classifyWeekdayConfirmationLifecycle, preview와transaction 공통 |
| 최종 확정 소비량 | 실제 before.isFix 및 사용자 최신 4규칙 | checkPositiveStock/transitionConfirmation/verifyFinalProductStock/nativeStockRecalculation |
| 단위·세금·단가 | native units/amount helper 및 실제 날짜단가 | 수량staging·최종writePlan·견적SQL·인쇄HTML; 모호한복수단가차단 |
| API 전환 opt-in | 신뢰할 수 있는 normal API dependency | 사용자 본문으로 opt-in불가, 선출고wrapper 기존정책보존 |
| 선택 요일 인쇄 | 실제 선택업체·활성날짜 상세 DetailFix | Matrix 준비표시→서버 exactdate전량검사→EXE quote SQL→printbundle |
| 재시도 | 영속 UUID+사용자+payload hash | 동일응답 replay 물리적무변경, 응답불명 status만조회 |

한 업체·품목의 감소와 증가를 같은 요청에 입력하면 날짜 이동으로 미리보기에서 표시한다. 서로 다른 날짜 단가의 복합 이동을 확정 전에 임의 비례배분하지 않으며 안전한 단가배분이 모호하면 전체 차단한다. 기존 음수현재고를 개선하는 감소·소비0 날짜이동은 새 음수 발생으로 오판하지 않는다.
