# 분배 수정 품종 재확정 복구

설치 Nenova.exe를 로컬 dnSpy.Console `-t FormShipmentDistribution`으로 재추출해 CountryFlower별 확정/확정취소를 확인했다. 로컬 출력: nw-distribution-refix-1113-dnspy.log. 원본 SP 백업도 격리 DB에 설치해 실행했다.

운영 SELECT AppLog: 2026/46-01 unfix_targets=1, 콜롬비아카네이션만 취소됐다. 이미 미확정인 미국더글라스/미국레몬잎 때문에 일반 부분확정 보호가 뒤이은 재확정을 차단했다. 미국 품종이 이번 작업에서 취소된 것은 아니다. Mandalay ProdKey433의 양수 거래처는7행으로, 변경하지 않은 행까지 제출하던 UI가 이를 적용완료로 표시했다.

| 동작 | 범위와 부작용 |
|---|---|
| 저장 대상 | 명시 OrderYear+week에서 실제 변경 거래처 수량만 제출. 신규 양수 주문은 기존 정책 유지 |
| 품종 범위 | distribute-save의 distributionEditProdKeys를 활성 Product에서 CountryFlower로 도출해 요청 품종 대조. SP 트랜잭션에서도 잠금 재검증 |
| 확정취소/재확정 | native CountryFlower 필수, 전체차수 fallback 금지. 수정품종 이전차수 미확정/음수재고 보호 유지. 일반 부분확정 보호 유지 |
| 보존 | 대상 밖 주문/출고 수량·Amount/Vat·isFix 보존. ShipmentDate/ShipmentFarm 변경 없음. Estimate 직접 생성 없음. native 상세확정 복구로 견적/매출 조회조건 복원 |
| 실패 표시 | 저장 후 재확정 실패는 저장완료·재확정실패로 구분, 타품종 자동확정 없음 |

공통 범위 helper: resolveFixCategoryScope → loadEstimateEditGroups → runFixTargetProcedure. 같은 변경 ProdKey를 unfix/fix에 전달한다. 카테고리 불일치/비활성/native 비지원 차단. Master 공유 표식은 native 동작 유지, 상세 isFix로 품종범위 판정(C-11).

검증: estimateCategoryCycle(정상/불일치/비지원/일반보호), distributionFixCycleRollback(타품종보존/실패복구/저장상태), 실제 Chrome(변경1행만 제출), test-distribution-localdb.cjs --fix-cycle(운영 handler+원본 native SP, 선택 unfix → 일반fix409 → scopedfix200, 같은 Master의 미국2행 수량/금액/상태 불변). 기존 SQL fixture의 전년도 동일차수 sentinel 유지.

운영 복구는 배포 후 최신 원장 기준. 미국 품종 보정과 부족재고 자동추가 없음.
