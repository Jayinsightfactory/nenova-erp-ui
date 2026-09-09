# 견적서 다음 차수 배정 + 단가 동시 저장

- 날짜: 2026-09-09
- 작업: 견적 통합 저장 오류 후속 보완
- 작업공간: nenova-erp-ui / codex/estimate-overflow-combined-cost
- 이전 배포: PR541, cbdc6f7

## 질문 → 답변

**Q.** 다음 차수 배정 배포 후 통합 저장 화면에 “단가 수정부터 저장한 뒤 수량을 다시 저장하세요” 오류가 나타남.

**A.** 통합 저장은 수량을 먼저 처리하지만 신규 overflow 가드가 모든 단가 초안을 차단했다.
가드만 삭제하면 새 출고에 이전 단가가 들어갈 수 있어, 기존 가격 core와 수량을 같은
트랜잭션에서 처리하도록 보완한다. 단가 먼저 별도 저장하는 부분 성공 방식은 사용하지 않는다.

## 확정된 기준

- 출고일은 여전히 **다음 세부차수 업체 기본 출고일**. 이전 “현재 날짜 유지”는 폐기된 선택이다.
- 신규 다음 출고는 수정 단가(0 포함), 기존 다음 출고는 기존 가격 유지. 해당 상세 자체를
  명시 편집한 경우만 그 단가를 변경한다. 미리보기에 최종 가격을 구분한다.
- 기존 가격 core의 상세 전체 날짜 변경 범위 및 fixed/weekFav 모드를 유지한다.
- 연도/업체/부모차수·원본 단가·수량 검증, 오류 시 전체 rollback, 작업 UUID 중복 방지를 유지한다.
- 운영 데이터를 시험 목적으로 저장하지 않는다. 무관한 AGENTS.md/기존 미추적 문서는 제외한다.

## 근거와 작업 결과

- [기준·부작용표](../work-reports/2026-09-09_estimate-overflow-combined-cost.md)
- [계약](../contracts/estimate-next-subweek-overflow.json)
- 실제 dnSpy CLI ClassShipmentDate.UpdateCost 및 운영 동일 연도·차수 read-only probe 재확인.
- 격리 SQL: 전량/부분 overflow + 가격, 명시0, fixed/weekFav, 기존 target 유지/명시가격,
  가격 stale/충돌/교차연도 차단, 같은 UUID 재실행 무변경·다른가격 거부,
  native 실패 및 가격 단계 실패 전체 rollback 통과.
- 날짜 삭제/purge 후 가격 재검증, 미리보기 후 가격 의도 변경 차단도 격리 SQL에서 통과.
- `test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest -- --changed-from cbdc6f7`,
  `guard:erp-writes -- --changed-from cbdc6f7`, `npm run build` 통과.
- 1920×1080 / 100% 로컬 production build 브라우저 검사 통과. 확인창 화면 이탈/가로 잘림 없음.
  취소 후 적용 요청 0회, 확인 후 적용 1회, 별도 단가 POST 0회. 최종 수량/단가와 다음 차수 로그 확인.
- 브라우저 검증 중 기존 기본 저장 onClick 이벤트가 modeOverride로 섞이는 순환 JSON 오류를
  발견해 명시 인수 호출+모드 검증으로 수정했다. fixed/weekFav 선택은 유지한다.
- 성공한 단계만 초안을 정리하고 실패/새 입력은 보존한다. 전체 성공의 일괄 초안 초기화도 제거했다.
- 운영 배포와 재검증 결과는 이 작업 PR의 완료 댓글로 확정한다.

## 이어받기

위 기준과 PR 완료 댓글을 먼저 읽을 것. 로컬 검증은 완료했으며 남은 배포 확인은
PR→master→Cafe24→읽기 전용 운영 확인 순이다. 계획만으로 배포 완료라고 말하지 말 것.
운영 증거/화면/비밀값은 공개 GitHub에 올리지 않는다.
