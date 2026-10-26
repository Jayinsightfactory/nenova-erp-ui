# 중국 단계별 가이드 · 양쪽 작업 초기화

## 질문 → 결정
- 중국 자동물량표에도 네덜란드와 같은 말풍선/버튼 강조/끄기 → 중국 작업 상태에 맞는 독립 가이드 적용.
- 둘 다 작업 초기화 필요 → 사용자 답변: 미저장 변경만 버리고 마지막 작업 저장본 복구. 저장 이력과 ERP 주문·분배 삭제 아님.

## 구현과 안전 범위
- 중국: 차수 확인/조회/편집/패킹 매칭/작업 저장/등록분배 검토/명시 적용 단계. 가이드는 작업을 자동 실행하지 않는다. 끄기 브라우저 저장.
- 중국 초기화: 선택 BoardKey GET 후 ID+연도+차수 검증. 네덜란드: 마지막 명시 저장 또는 이력 불러오기 ID 복구. 새 원본을 열면 이전 ID를 버린다.
- 저장본 없음/취소/조회 실패 시 현재 입력 유지. 복구 후 이전 적용 승인/미리보기 폐기. 품목 비고 등 이미 DB에 저장한 정보와 ERP 원장 보존.
- API/SQL/writer 변경 없음. Order/Shipment/ShipmentFarm/ShipmentDate/Estimate/WebProfitReport/Stock 금액·수량·확정 변경 없음.
- 실제 dnSpy CLI 및 SELECT-only 근거: ../work-plans/2026-10-26-china-guide.md. 운영 쓰기 시험 없음.

## 검증
- test:pivot, test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest(origin/master), guard:erp-writes(origin/master), build PASS.
- 실제 페이지 함수 실행: 중국 저장 수량 복구/취소/저장본 없음/잘못된 ID/교차연도/통신 실패 PASS. 네덜란드 복구/취소/GET-only 및 승인 폐기 PASS.
- 격리 Next 브라우저: 중국 수량8 저장/12 수정/주문·잔량 연동, 저장본 없는 초기화 보존, 가이드 끄기 새로고침 유지, 네덜란드 저장/수량 수정과 양쪽 버튼 표시 확인.
- 브라우저 네이티브 confirm 제어가 CDP focus timeout을 일으켜 확인창 이후 복구/취소의 시각적 완료는 미검증. 동일 실제 함수의 실행 검사로 검증. 이 한계를 배포 후 화면 스모크와 구분한다.
- 배포 결과: PR/CI/운영 확인 후 추가 기록 예정. 이전 세션 모든 작업 재검증을 뜻하지 않는다.

## 이어하기
- codex/china-guide, C:/Users/USER/nw-china-guide. 원래 2108 작업트리는 미수정.
- green PR squash merge → Cafe24 성공 → 실제 페이지 버전/가이드/초기화 버튼 읽기 검증. 운영 ERP 쓰기 금지.
- 검색어: china-guide-reset 작업 초기화 마지막 저장본 BoardKey guideSavedStamp
