# ERP 공백 3축 대조 보고서 — 2026-10-21

목적: 이카운트 기능 베끼기가 아니라 **사업 흐름 9단계에 빠진 관리기능**을 찾아 보완 순서를 정한다. 보고서만 작성했고 코드·수식·contracts·이카운트 데이터는 건드리지 않았다(이카운트 조회전용 준수). 직원은 사람이 아니라 업무 절차 기준으로만 서술.

**검증 한계(먼저 읽을 것)**
- 이카운트 공식 help 사이트는 검색으로 접근하지 못했다. 축1의 메뉴 목록은 **2026-10-20 로그인 계정 사이트맵**(저장소 `docs/ecount-migration/menu-inventory.md`, 말단 430개)이며 공식 매뉴얼 대조는 **미검증**.
- "실사용"은 `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`(경영지원 화면 인벤토리 25화면+즐겨찾기 8)와 메뉴명 일치로 판정한 **근사치**다. 같은 이름이 다른 탭에 있으면 재고I/회계I/MyPage 탭만 인정.
- "웹에 이미 있음"은 메뉴명→웹 화면 대응을 규칙으로 매긴 근사치다. 이카운트 workbench(`/ecount/workbench`)에 전 메뉴 초안이 있으나 원본 동등성 검증 완료는 0/373(`docs/ecount-migration/progress-2026-10-21.md`)이라 '있음'으로 세지 않았다.
- 현재 로컬 체크아웃은 낡아 `origin/master` 기준으로 스캔했다(/import, /work/manuals 포함).
- 문서에 있다던 "커버리지 40%" 수치 문서는 저장소에서 찾지 못했다(**미검증**). 대신 위 근사 집계를 쓴다.

## 축1. 이카운트 전 메뉴 태깅 (말단 430개)

| 탭 | 메뉴 수 | 웹에 이미 있음 | 실사용(웹 없음) | 미사용 |
|---|---:|---:|---:|---:|
| MyPage(즐겨찾기) | 8 | 7 | 1 | 0 |
| Self-Customizing(설정) | 26 | 6 | 0 | 20 |
| 재고 I(영업·구매·재고) | 145 | 69 | 3 | 73 |
| 재고 II(A/S·로트·계획·원가) | 27 | 2 | 0 | 25 |
| 회계 I | 107 | 8 | 13 | 86 |
| 회계 II(채권채무·수표·예산·수입비용·계약) | 75 | 2 | 0 | 73 |
| 관리(급여·인사·근태) | 39 | 0 | 0 | 39 |
| 그룹웨어 | 3 | 2 | 0 | 1 |
| **합계** | **430** | **96 (22%)** | **17 (4%)** | **317 (74%)** |

- 실사용은 전체 42개(그중 25개는 웹에도 이미 있음). 사장님 판단("대부분 안 쓰인다")과 일치: **74%가 미사용**.
- 실사용인데 웹에 없는 17개는 거의 회계 I(전표·원장·카드·계좌·판매일괄회계반영) — 이카운트에 남겨야 하는 회계 영역.
- 전 메뉴 개별 태그: [ERP_GAP_ANALYSIS_2026-10_menu-tags.csv](ERP_GAP_ANALYSIS_2026-10_menu-tags.csv)
- 근거: `docs/ecount-migration/menu-inventory.md`, `docs/ECOUNT_FULL_USAGE_PLAN_2026-06-03.md`, 집계 스크립트 결과.

## 축2. 중견 ERP 모듈 지도 → 수입유통 중견기업용 압축

| 출처 | 확인된 모듈/기능 | URL |
|---|---|---|
| SAP S/4HANA | 재무결산, 관리회계(CO), 자금·외환, 신용관리(한도·노출 모니터), 주문-수금, 구매·재고평가, 품질·클레임 | https://erpresearch.com/en-us/sap-s/4-hana-modules |
| SAP 채권 | 독촉(dunning), 여신 마스터/한도/자동 신용점검, 외화평가·기말마감 | https://www.rheinwerk-verlag.de/financial-accounting-with-sap-s4hana-business-user-guide_5698/toc , https://blog.sap-press.com/upgrades-to-receivables-management-in-sap-s4hana |
| Oracle Fusion | 채권·고급수금, 비용정산, 현금관리, 예산통제(경비 결재 세부는 **미검증**) | https://www.oracle.com/latam/a/ocom/docs/fusion-apps-suite-product-overview.pdf , https://erpresearch.com/erp/oracle-erp-cloud/modules |
| 영림원 K-System | 회계/IFRS, 인사/급여, 영업/물류, 구매/외주, 원가/EIS, 생산/품질 | https://files-scs.pstatic.net/2024/08/26/lTVAzbfCbT/영림원소프트랩 24년8월 IR자료.pdf (무역·관리회계 독립 모듈 여부 **미검증**) |
| 더존 Amaranth 10 | ERP+그룹웨어+문서 통합, 회계·인사 우선, 영업·구매·자재·생산 순차 (상세 모듈 목록·iCUBE 라인은 **미검증**) | https://www.taxtimes.co.kr/mobile/article.html?no=249790 |

압축 원칙: 네노바(수입 화훼 B2B, 직원 ~10명)에 의미 있는 것만 — 여신, 채권 aging, 가격정책, 클레임코드, 환차손익, 결재선, 예산대실적, 결산체크, 내부통제, 관리회계. 제외: 고정자산, 연결회계, 급여·4대보험, 생산/BOM, A/S, 수표, 전자계약.

## 축3. 네노바웹 현황 (9단계 위에 올림, origin/master 스캔)

| 단계 | 현재 화면 |
|---|---|
| ①발주 | `/incoming`, `/incoming-price`, `/purchase/status`, `/stats/pivot-import`, `/import` |
| ②입고 | `/warehouse`, `/arrival-cost`, `/freight`, `/import/freight-calc`, `/sales/customs-clearance` |
| ③분배 | `/shipment/distribute`, `/shipment/distribute-import`, `/shipment/week-pivot` |
| ④현장출고 | `/shipment/view`, `/shipment/fix-status`, `/shipment/stock-status`, `/stock`, `/pre-shipment` |
| ⑤견적 | `/estimate`, `/estimate/weekday`, `/sales/status`, `/sales/defect-deductions` |
| ⑥거래처전달 | `/catalog`, `/sales/tax-invoice`, `/m/*`, `/orders/kakao-audit` |
| ⑦입금 | `/sales/ar`, `/ecount/receivables`(미수개월 aging), `/finance/bank` |
| ⑧해외송금 | `/import/finance`, `/incoming-price/ledger`, `/incoming-price/credit-history`, `/finance/exchange` |
| ⑨이익 | `/sales/profit-report`, `/sales/profit-validation`, `/raum/pnl`, `/sales/revenue-management` |
| 횡단 | `/admin/order-requests`(주문 승인만), `/dev/action-log`, `/admin/activity`, `/work/manuals` |

코드 스캔 근거(키워드 존재 여부): 여신한도 화면 0건, 예산 0건, 환차손익 0건, `/sales/ar` 일수 구간 0건(`/ecount/receivables`만 월 단위 aging).

## 9단계 × 4열 표

판정 표기: **필요**=사장님/경영지원이 지금 엑셀·카톡·머릿속으로 하고 있을 개연성이 높은 관리(**추정 — 사장님 확인 필요**) / **불필요**=대기업이라서 필요한 것.

| 단계 | 큰 기업 기능 | 네노바웹 현황 | 이카운트 | 공백 → 판정 |
|---|---|---|---|---|
| ①발주 | 발주 승인 결재선, 계약/단가계약, 발주 대비 입고 차이 | 발주·입고 비교 `/import` 있음 | 발주서 4메뉴 **미사용** | 발주 결재선 → 필요(소규모 승인 상태열) / 구매계약관리 → 불필요 |
| ②입고 | 입고 검수·품질 클레임코드, 수입원가 배부, 통관비 정산 | 입고·통관·운임·원가 있음, 콜롬비아 통관비 이중소스 미해결 | 구매입력 **실사용** | 클레임 사유코드 → 필요 / 시리얼·로트 → 불필요 |
| ③분배 | 여신 점검 후 배분, 재고 가용 확인 | 분배·엑셀 임포트 있음 | 주문서 **미사용** | 여신한도 경고 → **필요** |
| ④현장출고 | 출고 승인, 재고평가, 폐기/불량 보고 | 출고·재고·FIFO 있음 | 재고 메뉴 대부분 **미사용** | 폐기·불량 보고 → 필요(약) / 창고이동·BOM → 불필요 |
| ⑤견적 | 가격정책(특별단가·적용순서), 단가 변경 승인·이력 | 견적·단가 마스터 있음, 변경이력 화면 **미검증** | 견적서 **실사용**, 단가관리 **미사용** | 단가 변경이력/적용순서 → **필요** |
| ⑥거래처전달 | 전자세금계산서, 거래명세서 | 세금계산서·카탈로그 있음 | 세금계산서 진행단계 **실사용** | 홈택스 대조 → 필요(약, 이카운트 유지) |
| ⑦입금 | 여신·채권 aging, 독촉, 입금 자동대사 | 입금등록·월단위 aging·은행 조회 | 채권관리/입출금 **실사용** | aging 일수 구간·독촉 이력 → **필요** / 입금 자동대사 → **필요** |
| ⑧해외송금 | 환차손익, 송금 결재선, 외화평가 | 송금·크레딧·환율 있음 | 외화·구매 **실사용** | 환차손익 → **필요** / 송금 결재선 → **필요** |
| ⑨이익 | 관리회계(거래처·품목별 이익), 예산 대 실적, 결산 체크리스트, 내부통제 | 차수 매출이익·원인분석·라움 PnL·action-log | 월별손익 **미사용** | 거래처별 이익/목표 → **필요** / 마감 체크리스트 → **필요** / 변경 감사로그 통합 → **필요** / 연결회계·고정자산 → 불필요 |

## 필요 공백 상위 10 — 어느 화면에 무엇을 더하나

1. **여신한도**: `/master/customers`에 '여신한도(원)' 칸 추가, `/shipment/distribute`·`/orders/new`에 한도 초과 경고 배지, `/sales/ar`에 '한도 대비 %' 열. (근거: SAP 신용관리 https://erpresearch.com/en-us/sap-s/4-hana-modules)
2. **채권 aging 일수 구간**: `/sales/ar`에 0-30/31-60/61-90/90+ 탭 추가(`/ecount/receivables`는 월 단위만). (https://www.rheinwerk-verlag.de/financial-accounting-with-sap-s4hana-business-user-guide_5698/toc)
3. **입금 대사**: `/finance/bank`에 '채권 매칭' 탭(입금→거래처 후보→확정 시 `/sales/ar` 입금 등록 연결, 쓰기는 승인 단계). (https://blog.sap-press.com/upgrades-to-receivables-management-in-sap-s4hana)
4. **환차손익**: `/import/finance` 송금 행에 '인보이스환율 vs 송금환율 차이(원)' 칸, `/finance/exchange`에 '차손익' 탭. (https://www.rheinwerk-verlag.de/financial-accounting-with-sap-s4hana-business-user-guide_5698/toc)
5. **송금 결재선**: `/import/finance` 송금 건에 '요청→승인→완료' 상태열과 승인자 칸(현재 승인은 `/admin/order-requests` 주문에만).
6. **단가 변경이력·적용순서**: `/master/pricing`에 변경이력 탭(전·후 단가, 시각)과 적용순서 칸. 이카운트 단가관리 4메뉴가 미사용이라 웹이 유일 원장이 됨.
7. **클레임 사유코드**: `/sales/defect-deductions`에 사유코드 선택 칸, `/sales/farm-quality`에 농장별 클레임율 열. (SAP 품질/클레임 https://erpresearch.com/en-us/sap-s/4-hana-modules)
8. **차수 마감 체크리스트**: `/shipment/fix-status`에 '마감 점검' 탭(verify:week 불변식 결과, 미견적·미입금·미송금 건수).
9. **거래처별 이익 + 목표(예산) 대비**: `/sales/profit-report`에 거래처 축 탭과 월 목표 입력 칸 → 달성률. (K-System 원가/EIS 영역 https://files-scs.pstatic.net/2024/08/26/lTVAzbfCbT/영림원소프트랩 24년8월 IR자료.pdf, 세부 **미검증**)
10. **변경 감사로그 통합 뷰**: `/admin/activity`에서 `/dev/action-log`를 단가·수량·확정 변경만 필터해 표시(누가·언제·전후값).

## 불필요 판정(대기업용)

고정자산(대장·감가상각), 연결회계·IFRS, 급여·4대보험·인사·근태, 생산/BOM/작업지시, A/S, 수표관리, 전자계약, 프로젝트계획, 시리얼 재고 — 이카운트에서도 미사용(관리 탭 39개 전부 미사용).

## 미검증 목록

이카운트 공식 help 대조 / "커버리지 40%" 원문 / 1~10번이 실제로 사장님·경영지원이 수기로 하는 관리인지(추정) / 단가 변경이력의 기존 존재 여부 / Amaranth·iCUBE·K-System 상세 모듈 / Oracle 경비 결재 세부.
