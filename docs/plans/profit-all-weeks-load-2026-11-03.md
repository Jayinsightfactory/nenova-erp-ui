# 전체 2026 차수 읽기 검증 및 관세 연결 보완

## 범위와 확인 근거

- 기준 origin/master d0651146, 전용 codex/profit-all-weeks-load. DB·스키마·확정·저장본 쓰기 없음.
- AGENTS/CLAUDE, ERP 가드·체크리스트·호환 불변식, WEB_VS_ERP_CONFLICTS 입고 영역, dnSpy workflow와 FormWarehouseView golden, Next Pages API 지침 확인.
- 실제 dnSpy.Console.exe FormWarehouseView 실행: OrderYear/OrderWeek 및 uspStockCalculation 호출 확인. 본 작업은 해당 저장 순서·EXE 원장을 변경하지 않음.
- SELECT 전용 probe: SQL 실제 2026 차수 01~50, 저장본 01~43, 활성 확정 0. 연간 근거 21,888행. 저장본 감사 12 SELECT, 44~50 live 전체 감사 5,233 SELECT, 쓰기 0. IF OBJECT_ID의 원가자료 SELECT만 정확 허용하고 DML/DDL/EXEC/transaction 차단.
- 첫 live 감사는 읽기문 IF OBJECT_ID가 차단되어 불완전하므로 폐기하고 정확 허용 후 재검증함.
- 원품목 국가 콜롬비아인데 품명에 CHINA가 있는 과거 품목 확인. 운임은 국가 기반 USD/박스 추정, 보고서는 명시 품명으로 중국/CNY 분류. 통화 원문 증빙 없이 통화나 단위를 강제 변경하지 않음.

## 변경 정책

1. 정확한 숫자 세부차수 03~99는 실제 입고행별 관세 계산에 포함. 01/02 실제 관세 및 명시 0 우선 보존. 양수 Customs1/2 저장액과 03+ 입고가 공존하면 입력액의 AWB 범위가 없어 중복 가능하므로 보류한다. 문자 suffix를 숫자로 잘못 합치지 않음. 미확인 세율·환율·배분은 보류 유지.
2. 원Product.CounName, 보고서 국가, 추정 통화 및 운임 총액/분모 차이를 읽기 전용 진단에 보존·표시. SQL에 통화 필드가 없다고 오해시키지 않음.
3. 기초·기말 평균식/확정 원본/수기H/기존0 유지. 없는 근거를 0으로 보충하지 않음. 회사 수익률 보류 조건은 유지.

## 부작용 / downstream

| 대상 | 영향 |
|---|---|
| OrderDetail / ShipmentDetail.Amount,Vat,isFix / Estimate / StockMaster,ProductStock | 읽기 검증 외 변경 없음 |
| WebProfitReport / WebProfitReportSnapshot / 확정 원본 | 쓰기·갱신 없음 |
| 주별/월별/엑셀/인쇄 | 공통 applyTemplateDutyView 파생 계산만 변경 |
| EXE 운임/원가 화면 | 기존 freightCalc 수치 변경 없음 |

## 검증

- 03/10 추가 입고, 실제0·실제금액 우선, 문자 suffix 차단, 반차수 중복 가산 방지, 교차연도 fixture.
- 진단 추가 전후 금융값 동일성, 무활동 수익률 해당없음과 근거 부족 구분.
- test:erp-contract, test:nenova-dnspy-evidence, changed-from origin/master manifest/write guard, verify:erp-change, build. 부모가 최종 통합 검증/PR/배포 담당.

원천 누락을 억지로 복구하지 않으며 최종 잔존 차수별 목록을 별도 보고한다.
