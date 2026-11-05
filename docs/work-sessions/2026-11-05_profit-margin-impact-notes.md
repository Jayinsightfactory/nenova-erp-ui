# 2026-11-05 주차 이익률·운임/재고 비고

- 작업: profit-margin-impact-notes / `codex/profit-margin-impact-notes`
- 기반: origin/master `d0106f3f4`, 독립 worktree `nw-profit-margin-impact`
- 상태: 구현·대상검사 완료, 최종 잔여 ERP gate/빌드·브라우저 및 PR/배포 진행 중. 운영 DB쓰기0.

## 요청 → 처리

1. 모든 행·합계 이익률을 표시 J/표시 C로 맞춘다 → 공용 displayProfitCalc를 저장/확정본 복사에 적용하고 live/monthly/XLSX/print/독립검산/주차분해/업체별 화면의 **주차보고서 참고값**을 정렬했다. C=0/null이면 공란. C/J 및 다른 금융금액과 저장 payload 불변. 별도 업체 실판매마진 모형은 보존했다.
2. 기존 재고·냉해·특이사항에 콜롬비아 같은 세부차수 GW/CW 배분과 중량/부피 비교를 넣는다 → 실제 배분 helper와 report profile을 재사용하며 H는 항상무게, 국제운임만 GW≈CW 무게/그외 CBM. 실제−비교 운임과 재고유보 반영 이익·%p를 표시한다. 현재 원장과 저장본 운임 불일치/수기override/원가인식 근거 부족은 이익효과 확인필요다. 비교금액을 원장에 적용하거나 이중 이익으로 더하지 않는다.
3. 실제 재고조정 품종·품목·단/박스 증감·평가액과 인접 재고 차이를 설명한다 → StockHistory StockType After−Before와 물리 OutUnit을 보존. exact 검증가격 우선, 없으면 적용 보고서의 증빙된 평균원가×명시 단위환산을 참고평가액으로 구분한다. 전기말→당기초/당기말→차기초는 실제 PeriodDay 인접 저장/확정본만 비교하며 평가차이를 실제조정으로 부르지 않는다. 사용자비고는 기존입력/저장대로 보존, 시스템금융비고는 별도표시 및 inline XLSX/print에만 추가한다.

## 실제 근거

- 설치 Nenova.exe FormStockView를 실제 dnSpy CLI로 읽었다. StockHistory After−Before와 CodeInfo StockType, StockMaster→ProductStock, ViewWarehouse/ViewShipment 원천을 확인했다.
- SQL SELECT에서 저장2026/31-01 GW/CW3342/3342, 실제 loadWarehouseGw의1420/3342를 재확인했다. 신규 조정조회SQL52행 정상, exact단가0행. 공개 회귀는 합성품목·수량만 사용한다.
- 부모의 읽기전용 전체차수 감사: 2026/01~44 최신저장44개·활성확정0개, K외 금융금액/원본 JSON불변 PASS. 45~53저장본없음. raw저장본 검증이며 최신templateDuty/운임비고의 운영 HTTP검증은 별도 workflow에 있다.

## 검사와 한계

대상검사 PASS: 신규 profitMarginImpactNotes(저장본불변·분모0/null/음수·noEnding·같은세부차수/연도·GW/CW near-miss·수기0·환산·평균평가·53차달력·XLSX/print), StockAdjustmentNotes(API/경합/React), Monthly, Week28Totals, ExcelRulebook672검사, WorkbookFullParity898셀, RangeOutput, FormulaAudit, IndependentAudit, 주차 Shapley, 업체마진52검사.

첫 `npm run verify:erp-change`는 pretest·주요 ERP·manifest194·dnSpy 통과 후 WorkbookParity의 이전 소스문자열(assert rows:data.rows/note:data.note)1건에서 중단됐다. 새 display.rows+금융비고 조합으로 해당 assertion 수정 후 PASS. 검사 중 파일 병합/수정은 하지 않았다. 중단 후 독립 검산/주차분해/보고서참고 bridge의 남은 C+F를 수정하고 관련 대상검사 PASS. 완료한 prefix를 반복하지 않고 `scripts/resume-profit-margin-guard.cjs`로 잔여 ERP + posthook + manifest + writeguard + 공식build를 이어간다. 최종 CI는 전체 final source gate를 실행해야 한다.

호스트 PowerShell이 페이지파일 부족0x800705AF/StackOverflow로 진입실패하여 cmd.exe login=false로 순차실행했다. 광역프로세스종료는 하지 않았다.

실브라우저 합성 검사는 `scripts/profit-margin-notes-ui-smoke.cjs`; 운영 읽기 전용 전체차수 HTTP검사는 `scripts/profit-margin-all-weeks-production.mjs` 및 해당 workflow. 미실행 결과를 완료로 주장하지 않는다. PR/머지/Cafe24/운영 smoke는 부모가 담당한다.

## 이어가기

최종 잔여 gate 로그 `.profit-margin-resume.log`와 브라우저 결과를 확인하고 이 문서에 덧붙인다. source변경 없이 commit/PR, 전체CI통과 후 squash merge/Cafe24배포/운영 GET-only검증을 수행한다. DB보정/마이그레이션/재계산은 승인 범위가 아니므로 실행하지 않는다. 계약과 기준표는 `docs/contracts/profit-margin-impact-notes.json`, `docs/plans/profit-margin-impact-notes-2026-11-05.md`.

검색어: profit-margin-impact-notes J/C GW CW CBM StockHistory 평균원가 조정평가액 cross-year53
