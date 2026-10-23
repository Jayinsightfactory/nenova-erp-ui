# 보고서 비용·환율 SQL 원천 복구 (2026-10-23)

## 범위와 권위

- 사용자 요청: DB를 변경하지 않고 1~41차의 남은 비용·운임·환율 문제를 실제 SQL 기준으로 조사한다. SQL에 완전한 근거가 있으나 웹이 놓친 경우만 보고서 읽기 경로를 수정한다.
- 원천 우선순위: 실제 설치 EXE dnSpy / 같은 연도·차수 SELECT probe / 현재 공통 helper / 계약. 오래된 문서의 판매단가 fallback이나 CHINA 무조건 우선 규칙은 최신 승인 계약보다 우선하지 않는다.
- 소유 함수: `customsForwarding*`, `taxableExchangeRate*`, `profitReport.js`의 `invoiceRatesByCategory`, `fifoWeekRateContext`, `fifoLayerRateAndCustoms` 비용·환율 부분. 수량 정규화 함수는 다른 담당자가 변경한다.
- 원천 상태를 `absent`, `partial`, `rejected`, `query_failed`, `available`로 구분한다. 기존 source=`missing`만으로 SQL 원천 부재를 단정하지 않는다.

## 부작용 표

| 동작 | Warehouse/Product/FreightCost | Stock/Shipment/Estimate | Web 입력·확정·캐시 |
|---|---|---|---|
| SQL 원천 조사 | SELECT only | SELECT only 또는 미조회 | SELECT only |
| 보고서 비용·환율 읽기 복구 | SELECT only | 보존 | 저장값·확정 revision 보존 |
| 테스트·미리보기·다운로드 | 보존 | 보존 | 자동 저장 금지 |

DB 쓰기, SP 호출, DDL, 보정, 수기값 삭제, 확정취소/재확정은 전부 금지한다. 근거를 못 찾은 값을 다른 차수나 현재 환율로 채우지 않는다. 명시 0과 NULL은 구분한다.

## 사전 근거

- 실제 `dnSpy.Console.exe --no-color -t FormWarehouseView` / `-t FormStockView`를 실행했다. `FormWarehouseView.GetData/GetDetail`은 WarehouseMaster/Detail 및 Product, UPrice/TPrice를 읽고 InputDate 라벨은 입력일자다. `FormStockView.GetData`는 StockMaster/ProductStock와 Product.OutUnit을 사용한다.
- 조회용 probe는 DB 드라이버의 query/batch/execute를 SELECT-only로 차단하고 같은 OrderYear+major 범위를 요구한다. 접속정보는 출력·파일 저장하지 않는다.
- 우선 조사: 18차 R, 35차 NL S, 39/40차 TH H/S, 초반 H. FreightCost/Detail과 보고서 구조화 입력을 별도 원천으로 조사한다.

## 수정 기준과 테스트

1. 같은 연도·대차수·국가·통화이며 금액 및 전체 적용 범위가 입증된 근거만 연결한다.
2. H 합계에 기존 실비와 기본값/추정비를 중복 더하지 않는다. S의 통화 및 CNF 포함 여부를 보존한다.
3. 일부 AWB만 환율이 있는 경우 전체 환율로 승격하지 않는다. 수동 H/R/S 및 명시 0은 우선한다.
4. 현재 DB와 확정 당시 값은 분리한다. 확정 revision은 재계산·저장하지 않는다.
5. 실행형 fixture: 완전 근거, 부분 근거, 조회 오류, 무근거, 명시 0, 동명 다른 연도·AWB, 다른 통화, 미래 차수, 중복 비용행, 기존 6카테고리와 4국가 평균 fallback.
6. 신규 helper는 계약 scope와 calc hash에 등록한다. 관련 비용/환율/분류/스냅샷/GET 읽기 전용 회귀 및 전체 ERP gate/build가 배포 선행조건이다.

## 현재 상태

사전 코드 검토와 기존 관련 테스트 PASS. SELECT-only probe 8회로 2026년 1~41차 입고 20,995행, FreightCost 2행/Detail 34행, WebCustomsWeekly 42행, WebForwardingWeekly 0행, WebColombiaWeekly 10행을 확인했다. 운영 DB 쓰기 없음.

### 실제 원천 조사 결과

- **40차 태국 S — 조회 분류 누락, 복구 가능:** WarehouseKey 7581, WdetailKey 44199/44200, 운송료 483.70 + 157.05 = 640.75 USD. FarmName=`EXCEL`, 별도 꽃 입고 7582의 AWB는 공란이다. 기존 정규식이 product/invoice/farm 결합 문자열의 시작에만 `excel`을 허용하여 전표가 미분류됐다. 정확한 업체명 EXCEL에 한해 기존 명시 국가/BILL/AWB 우선순위를 유지하여 연결한다. 유사 업체명 및 충돌하는 국가 근거는 추정하지 않는다.
- **4차 수국 S — 보조 AWB 연결 누락, 복구:** WarehouseKey 4333의 InvoiceNo=16096634963은 같은 04-01 실제 수국 입고 4283/4284/4285/4286/4288/4290/4291의 OrderNo와 정확히 일치한다. 자체 OrderNo=18012063074만 보던 기존 조회가 Wdetail20930/20931 비용 4561.2+3377.5=7938.7 USD를 놓쳤다. 세부차수까지 동일하고 실제 꽃 국가·화종이 유일하며 기존 BILL/primary AWB/명시 국가 근거를 덮지 않을 때만 `invoice_matches_goods_awb`로 연결한다. `콜수국 AWB` 업체명도 부합하지만 이 문자열 자체를 새로운 광역 규칙으로 추가하지 않았다.
- **39차 태국 H — 유형 근거 부족:** WarehouseKey 7474의 이름/ProdKey 없는 두 행에 SteamQuantity 209/270.5가 있으나 GW/CW 유형을 입증하지 못한다. master GW/CW도 NULL. S 772.315 USD는 이미 정상 연결이다. 행 순서·수치 크기만으로 GW/CW를 추정하지 않고 H missing을 보존한다.
- **35차 네덜란드 S — 현재 조회 원천 부재:** WarehouseKey 7103(35-02 Holex)에 GW 1106.6 / CW 1231은 있지만 운임 금액 전표가 없다. 해당 차수 FreightCost/WebForwarding도 없다. 무게만으로 운임을 만들지 않는다.
- **18차 R — 부분 적용 범위:** FreightCostKey 2/WarehouseKey 5560에 환율 1550이 있지만 같은 차수 여러 입고의 적용 환율이 없다. 부분 인보이스 환율을 국가/차수 전체 환율로 승격하지 않는다. 다른 FreightCost는 16차 WarehouseKey 5309 한 행뿐이다.
- **저장 원천:** `WebTaxableExchangeRate`가 현재 INFORMATION_SCHEMA에 없고, `WebForwardingWeekly`는 1~41차 0행이다. 28차 WebProfitReport R은 SourceRef/EffectiveAt/ConfirmedAt 없는 미검증 입력이므로 자동 확정 원천으로 쓰지 않는다. 31차 콜롬비아 H/S의 검증된 수기 입력은 그대로 보존한다.
- **중량 열 조사:** 이름이 Gross/Chargeable weight인 1~41차 행 중 EstQuantity에만 중량이 있고 기존 물리 수량에 없는 사례는 0건이다. 이번에 일반 상품 EstQuantity를 중량으로 읽는 확대 변경은 하지 않는다.

### 전체 1~41차 비용행 보존 대조

동일 SELECT 결과를 이전 배포 모듈과 변경 모듈로 각각 분류했다. 인식 가능한 운송료 원천은 **758행**이며, 모든 차수의 원천 행수·원천 금액이 동일하다. 미분류는 4행→0행. 국가별 직접합계 변경은 아래 두 건뿐이다(각 통화별 비교이며 서로 다른 통화를 합산하지 않는다).

| 차수·국가 | 기존 S 원천 USD | 변경 S 원천 USD | 변화 |
|---|---:|---:|---:|
| 4차 콜롬비아 수국 | 3375.3500366211 | 11314.0500366211 | +7938.7 |
| 40차 태국 | 0 | 640.75 | +640.75 |

40차에는 별도 중량행도 Prod3100 Gross weight 225kg / Prod3101 Chargeable weight 345.5kg로 확인된다. 따라서 S 복구 후 기존 사용자 승인 H 추정이 활성화될 수 있다. 이는 **실제 저장 통관비가 아니라 기존 `approved_customs_cost_estimate`**이며, 실제 실비 확정으로 표기하지 않는다. 39차 무명행과 달리 유형 근거가 명확하다.

FreightCost 환율 부분범위는 16차 카네이션 매입외화157449 중5292, 18차 카네이션121017 중9705에만 각각1550이다. 이 부분 환율은 기존과 같이 적용하지 않는다. 글로벌 evidence.status=`available`은 SELECT 성공이며, 카테고리별 `available/partial/absent/rejected`와 다르다. `query_failed`는 원천 부재를 뜻하지 않는다. 에러 원문/접속정보를 반환하지 않고 기존 대체 근거 및 수기값을 보존한다.

### 잔여 항목 — 기존 live 기준이며 최종 paired 결과로 재확인

아래는 실제 상품 매입이 있는 행에 한정한다. H 원천 부재는 비용이 실제로 0이었다는 뜻이 아니다. 호주28차 전/베트남29차 전 H 입력 도입 이전의 정상 예외와 매입 없는 행은 제외했다.

| 국가·항목 | 남은 차수 | 원인/한계 |
|---|---|---|
| 콜롬비아5종 H | 1~13,15 | 구조화 저장 통관비 없음. 조기 원천/중량 부족이며 현행 missing 보존 |
| 콜롬비아4종 H | 14,16,17 | 반차수 coverage 일부. 실제 존재하는 비용만 보존 |
| 네덜란드 H | 1~15 | 저장 통관비 없음/유효 자동 근거 부족 |
| 중국 H | 1~15,39 | 저장 통관비 없음/유효 자동 근거 부족 |
| 에콰도르 H | 1~5,7~13 | 저장 통관비 없음/유효 자동 근거 부족 |
| 태국 H | 1~6,8~16,18,20,39 | 실비/승인 추정에 필요한 중량·운임·환율 일부 부족. 39차는 무명 중량행 유형 불명, 18차는 환율 부족. 40차는 이번 복구 후 추정 활성화 기대 |
| 미국 H | 2,10,13,15,17 | 저장 통관비 없음/유효 자동 근거 부족 |
| 일본 H / 뉴질랜드 H | 일본1~2 / 뉴질랜드1 | 저장 통관비 없음/유효 자동 근거 부족 |
| 베트남 H | 41 | 저장 통관비 없음/유효 자동 근거 부족 |
| 콜롬비아 수국 S | 1~2 | 인식 가능한 운임 금액 원천 없음 |
| 카네이션 S / 루스커스 S | 카네이션1~2 / 루스커스1~4 | 일부 반차수 비용 coverage만 존재 |
| 태국 S / 에콰도르 S | 태국1 / 에콰도르1,5 | 인식 가능한 운임 금액 원천 없음 |
| 미국 S | 2,10,13,15,17,32,35,39,41 | 인식 가능한 운임 금액 원천 없음 |
| 일본 S / 뉴질랜드 S | 일본1~2 / 뉴질랜드1 | 인식 가능한 운임 금액 원천 없음 |
| 네덜란드 S | 35 | Warehouse7103 GW/CW만 존재, master 운임/DocFee NULL, FreightCost/WebForwarding 및 비용행 부재 |
| R | 18차 콜롬비아5종·NL·AU·TH·CN | 완전한 승인 환율 근거 없음. 카네이션 일부1550을 전체에 적용하지 않음 |

이 표는 **조사한 스키마와 식별 가능한 비용행의 범위**다. 이름·ProdKey가 없는 행은 비용/중량 유형을 단정할 수 없고, SQL 외 청구서가 존재하지 않는다는 뜻도 아니다. WarehouseMaster 실제 컬럼에는 InvoiceCost 같은 대체 비용 열이 없으며 GrossWeight/ChargeableWeight/FreightRateUSD/DocFeeUSD만 있다. 기타(미분류) 행은 국가 확정 전이므로 별도 원천 정리 대상이다.

### 검증 및 표시

- 신규 `test:profit-cost-source-recovery`와 기존 `customsForwardingAuto`, `profitReportCountryAverageIntegration`, `profitReportYearAndRateScopeContract` PASS.
- `pretest:profit-inventory-basis`에 신규 묶음을 등록하여 ERP 검증 체인에 포함했다. 신규 helper는 `profitReport*.mjs` 계산 지문 자동 포함 대상이다.
- API `rateSourceEvidence.current/previous`는 현재/전차수의 실제 invoice coverage를 반환한다. 기존 rates map 반환형은 유지한다.
- 기존 검증 패널에서 `INVOICE_RATE_PARTIAL/QUERY_FAILED/REJECTED`, `PREVIOUS_INVOICE_RATE_QUERY_FAILED` 메시지를 표시한다. 유효한 수기 R>0은 우선하며 R=0/공란은 조회실패를 숨기지 않는다.
- 일반국가 H missing이 계산상0으로 남는 기존 로직은 이번에 광역 변경하지 않았다. 기존 `CUSTOMS_INCOMPLETE` 오류가 이를 표시하므로 경고 없이 '정확한 수익률'이라고 보아서는 안 된다. 태국은 missing을 null로 보존한다.
- 최종 1~41 API paired 대조, DB SHA 보존, 전체 guard/build/배포/브라우저 확인은 주 담당자가 별도 수행한다. 이 하위 작업에서 DB 쓰기·커밋·배포 없음.
