# 2026-10-28 수기 출처 오분류 정정

## 2026-10-28 최종 수기입력 보존 정정
사용자 “수기입력 묶음은 모두 보존” 확인. 앞선16archive/11견적삭제/4초안 계획은 실행 전 철회했고 해당 JSON은 executable:false로 봉쇄했다. 브라우저 혼합저장에서 첫 자동행의 sourceFileName이 수기행까지 공통 적용된 실제 저장버그를 확인했다. 1019 및1048~1060 총14수기와1139~1142 다음저장4수기는 수량·견적·원장버전 전부 보존하고 감사 이력만으로 출처를 정정한다.926도 보존한다.1066/1067 자동2건은 원문5233(25/6)과15/15 불일치로 삭제 없이 검토표시.별도 과거해제자동864→43차10803만 기존 선택삭제/편집잠금으로 정리한다.최종 고정계획 defect-manual-provenance-final-2026-10-28.json 및 reconcile-defect-manual-origin.mjs가 이전 계획보다 우선한다.

검증과 배포·운영결과는 완료 후 추가한다. 기존 ClassEstimate dnSpy 근거: Estimate CRUD만 변경하며 이번 출처확인은 History INSERT만 수행한다. 주문·출고·재고·손익 재계산은 없다.

검증: 전체 test:erp-contract, dnSpy evidence, 변경분 manifest/write guard 통과. 운영DB CTE SELECT-only로 수기확인 양성1/다른원천·다른근거종류·false3음성 통과. 원인코드는26bf5a555(2026-07-22)부터 있던 공통파일 우선순위이며2026-10-26/28 혼합저장 감사로 실제오염 확인. build/CI/배포는 진행중.
