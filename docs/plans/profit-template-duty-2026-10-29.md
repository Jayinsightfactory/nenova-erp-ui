# 승인 양식 관세의 본표 연결

## 기준 ledger (구현 전)
- 사용자 승인: 2026년 보고서에 원본 exact_name/user_policy 587품목 후보를 승인 추정으로 사용. 원본 연도 검증을 뜻하지 않는다. 국가+ProdKey+NFKC 정규화 품명 지문 일치 필요. keyword/충돌/미매칭은 보류.
- 관세 실제 SQL/역사 저장 및 명시0 우선. missing 활성 반차수만 품목별 CNF×승인율로 보완. 기존 태국5%는 중복하지 않고 기존 관세 구성분을 교체한다.
- 과세표준은 실제 TPrice+기존 AWB 무게/CBM 배분 운임. 호주 CNF에는 운임 재가산 금지. 원본 cached 환율 복사 금지.
- H 수기 총액 우선. 기본 주차·월별·출력 공통 loadWeeklyReportPayload에서 저장본을 복제해 derived view 적용. 과거 무거운 전체 보고서 재계산/DB snapshot 갱신 금지; 연도별 SELECT-only 근거를 제한된 메모리 캐시로 공유.
- 평균 E/F는 보관된 동일 평가차수 평균식의 수량/분모로만 관세차액 평가. 품목별 평가의 근거가 없으면 이익률 보류; 임의 평균식으로 변경 금지.
- 확정 CALC 원본/DB 불변, derived 표시와 original 메타 구분. 자동 확정/자동 저장 없음. 기존 noEnding 합계 분모와 C/G/AC/AJ 보존.

## 부작용 표
| 동작 | Warehouse/Product/Flower/FreightCost | StockMaster/ProductStock | Shipment/Estimate | WebProfitReport/확정/계산본 |
|---|---|---|---|---|
| 기본 주차·월별·엑셀/인쇄 | SELECT만 | 보존 | 보존 | SELECT만; 응답 clone 계산 |
| 명시 최신 조회 | 기존 SELECT만 | SELECT만 | SELECT만 | 읽기 응답만 변경 |
| 저장/확정 | 이번 기능은 호출하지 않음 | 보존 | 보존 | 기존 별도 정책 유지, derived 자동 저장 금지 |

## 사전 근거
실제 dnSpy.Console.exe --no-color -t FormStockView 재실행: StockMaster→ProductStock, 현재/직전 OrderYearWeek 및 ViewWarehouse.OrderYearWeek2 조회. 부모의 실제 FormWarehouseView CLI .verify/dnspy-warehouse.txt. 기존 독립 SELECT 감사의 2026 1~41차 snapshot/입고/세율 자료를 검토했고 원장 쓰기는 없음. 수량/저장순서 변경 없음.

## 검증 기준
양성/교차연도/지문변경/부분미확인/명시0/실관세보존/혼합율/동일 AWB 배분합계/단위독립/평균 이월/직접원가 보류/저장본 clone 불변/본표 월별 엑셀 동일값. 전체 ERP gate와 build, 운영 SELECT·브라우저 검증은 완료 전 필수.

메뉴 기준: 기존 메뉴/키보드/스크롤 유지(신규 shell 없음). 본표 근거 라벨만 추가. 운영 원장 반영 UI는 해당 없음(SELECT-only).

## 구현·검증 기록
- 587개 exact-name/user-policy 후보만 2026 승인 추정으로 사용. 국가+품명 지문 불일치, keyword/충돌/미매칭은 보류.
- 기본 주차/월별/export 공통 loadWeeklyReportPayload 파생값 적용. 확정 원본 totals는 originalConfirmedTotals/originalCalc에 보존하고 DB 원본은 변경하지 않음.
- 실제·명시0·과거 관세와 수기 H 우선. 기존 태국5% 추정분은 빼고 신규 관세를 1회 추가. 동일 차수 평균식이 증명된 E/F만 재평가; FIFO/직접 평가 근거 불명은 K 보류.
- EC41 운임 과대 산출 원인: 레거시 freightPerStem은 모형 송이분모, 원행은 실제 송이수여서 곱하면 4/3배. 이번 관세 전용 경로는 같은 AWB/품종 bucket 운임금액 고정 후 기존 단/박스, 없으면 입고 원행 송이로 배분. 레거시 perStem/표시단가는 변경하지 않음(후속 검토 위험).
- year/policyVersion 메모리 캐시60초, 실패5초만 cooldown. 새 입고 원천 SELECT는45초 AbortSignal/request.cancel. 기존 snapshot/confirm 메타조회는 기존 DB timeout 유지.
- 순수 회귀13개, 기존 freightCalc238검사, weeklyCache, confirmedSnapshotImmutability, rangeOutput, pivotFreightArrival 통과.
- 독립 SQL 감사: 1~41차 산술 불변 위반0, EC41 관세445176.577125/H581176.577125/K−17.35906822%. 기본38/39/41 및 월별43차수5.052초, SELECT28/쓰기0, 월별 합계 불일치0. 상세 근거는 독립 감사 문서 참조.
- 전체 ERP gate/build/운영 브라우저·배포는 부모 담당이며 이 기록 작성시 미검증.
