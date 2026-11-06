# 중국 관세·품목별 재고 읽기 계층 복구

## 구현 전 기준표 및 부작용

| 동작 | Warehouse / Product / FreightCost | StockMaster / ProductStock | Shipment / Estimate | WebProfitReport / Snapshot / Customs / Invoice |
|---|---|---|---|---|
| 주차·월별·출력 조회 | SELECT only | SELECT only | 보존 | SELECT only; 응답 복제만 변경 |
| 관세 품목 연결 | 저장소 exact 품목 정책만 수정 | 보존 | 보존 | 운영 DB 전부 보존 |
| 품목별 재고 평가 | 같은 연도·차수 실제 품목별 수량·원가 근거 사용 | SELECT only | 보존 | 원본 계산본 보존 |

- 실제 납부 관세와 원가 양식 계산값을 구분. FreightCostDetail.TariffKRW는 계산 스냅샷으로 납부 증명이 아니다. WebArrivalCostLine.CustomsPerUnitKRW 역시 업로드 원가 계산값이며 관세와 그외통관비를 임의 분해하지 않는다.
- 원본 H=0/source=missing은 실제 면세 또는 비관세 비용0의 증명이 아니다. 분리 불명 양수 비용은 그대로 보류. 승인된 평균 도착원가 보완 정책은 explicit 추정 메타데이터 유지.
- 품목 정책은 2026 + ProdKey + 국가 + 정확명 지문. 기존 워크북 직접 품목/차수 예외 우선. 새로운 품목은 승인된 같은 상품형태 기준과 직접 참조 품목/원본 셀을 기록하고 실제 특혜자격/납부 검증으로 표시하지 않는다.
- product_cost는 normalization.eligible만으로 category_average로 바꾸지 않는다. 실제 ProductStock 품목·단위 및 수량별 원가 보완을 사용한다. 단위·통화·연도·원천 불일치는 null 유지. 표시 K=J/C, C=0/null이면 null.

## 실제 EXE 및 SELECT-only 사전 조사

2026-11-06 actual CLI: `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe --no-color -t FormWarehouseView "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"` exit0. GetData는 WarehouseMaster.OrderYear/OrderWeek와 WarehouseDetail 합계를 읽고 GetDetail은 WarehouseKey로 Product JOIN. 삭제는 WarehouseDetail→StockHistory→uspStockCalculation 순서이나 본 변경은 이 경로와 SP를 호출하지 않는다.

INFORMATION_SCHEMA 및 SELECT probe: 중국 2026 FreightCost/FreightCostDetail 연결0. WebCustomsWeekly 중국은26,28~33차만 존재,44차 없음. 업로드 도착원가에는 다수 차수 CustomsPerUnitKRW 존재하나 AWB와 독립된 계산원가로 납부관세 증명이 아니다. WebForwarderInvoice는 AWB/InvoiceNo 매핑만, 금액 없음. WebForwardingWeekly.AmountUSD는 포워딩이며 관세 근거로 사용 금지. WebInvoiceCostLine의 ComponentAmountsJson은 정확 receipt/단위/승인상태 확인 후에만 사용할 수 있다.

44차 원본: H0(source missing), E1539010.2040645164, F2383761.1654007607. F product_cost(unit_mismatch), unit=null, quantity351. FIFO 출처는 품목별 매입차수가 섞여 있어 일괄 평균 관세차액을 가산할 수 없다.

메뉴 기준: 새 메뉴/탭/작업 순서 없음(가이드 재촬영 해당 없음), 기존 shell/키보드/스크롤 보존. ERP 쓰기/실제 반영 확인 UI 해당 없음. 운영 DB writes0, migration0, cache backfill/refresh0.

## 확정 구현 기준 및 실행 검증

- exact registry124개: 기존 정책에 없는 중국91품목 및 보고서는 중국이지만 전산 국가가 콜롬비아인 MEL33품목. 원본 워크북 해시/시트/셀 및 같은 상품형태 참조키를 각 행에 기록. 이름에 China가 들어가는 네덜란드 Hyacinthus China Pink/White는 제외. 분류/통화 모순은 원장 정정이나 통화 변환으로 숨기지 않고 원래 진단을 보존한다. 직접 원본 세율·공식 HS 인증이 아니라 사용자 승인 상품형태별 계산 참고 기준이다.
- `profitApprovedReceiptCosts.mjs`: 기존 `readInvoiceCosts`의 현재 문서 revision/operation, APPROVED, liveReceiptStatus MATCH를 그대로 사용. 정확 연도/세부차수/WdetailKey/품목/실제 수량·단위/원가 성분 합계 및 원화 출력·CNY 입력을 확인한다. 부분·중복·변경·TEST_ONLY·다른 통화는 제외. 42차 해상입고64행이 통과했으며 승인 모드 ACTUAL이나 expenseBasis ESTIMATED다. tariffKRW는 계산 관세이고 otherKRW는 승인된 원가 성분이다. 실제 납부 증빙으로 승격하지 않는다.
- `profitNativeUnitCosts.mjs`: 품목별 매입 외화금액×같은 차수 승인 환율과 실제 단 수량을 보존. 같은 국가·통화·단위/과거기간의 전체 비용 합계÷실제 수량 합계를 사용한다. 송이 환산을 하지 않으며 모순된 SteamQuantity나 master10을 고치지 않는다. 원본 FIFO를 복구했다고 하지 않고 `approved_native_unit_acquisition` 승인 평균 보완으로 표시한다. 충돌하는 같은 source id는 마지막 값으로 덮지 않고 보류한다.
- H는 현재 입고별 알려진 관세에 누락 비관세 비용만 가산한다. donor 전체 통관비에 새 관세를 더하지 않는다. `150원 관세+20원 그외=170원` 양성 fixture와 단위/통화/연도/부분승인/중복/수기0 near-miss를 실행 검증했다.
- 품목별 F는 원본 평가액에 관세를 가산하는 방식이 아니라 실제 품목별 SQL 수량으로 승인 원가를 새로 평가한 표시값이다. originalBasis와 당시 금액·수량을 보존하고 현재 단위/수량·비교 불가 여부를 표시한다.

## 전체 차수 읽기 전용 감사 (구현 최종 소스)

SELECT-only 연간 context + 같은 canonical `applyTemplateDutyToReport`로 저장 계산본이 있는 2026년1~44차 전체 검사. 운영 원장/계산본 갱신·SP 실행0. 최신 저장 계산본은44차이며 입고는45차까지 존재한다. 45차 계산본을 임의 생성하지 않았다.

- 중국 입고 계산 대상2818행. FreightCost 납부 증빙0. 직접 관세 기준 미연결: 변경 전361행 → 변경 후0행. 품목별 평가 미지원1건 → 최종 표시0건. E/F/H/I/J/K null 차수: 변경 전44차1건 → 변경 후0/44차수.
- 원본 진단은 삭제하지 않는다. 최종 원본 진단 합계: 운임 배분 대사 미통과470, 국가 추정 통화 불일치436, 기존 H 관세/비관세 분리 불명18, 환율값/출처 미확인 각57. 새 기준이 연결되어 기존에 가려졌던 하위 진단이 노출되어 일부 raw 진단건수가 증가했다. 해당 차수 표시는 기존 승인 평균 보완으로 계산 가능하나 이 진단은 실제 납부·통화·배분의 원천 검증 완료를 뜻하지 않는다.
- 전체44차수의 저장 payload JSON 불변 assertion 및 이미 존재하는 C/G/R/AC/AJ 보존 assertion PASS. K=J/C 유지.

44차 최종 표시 (원): E1,833,777.480294 / F4,006,725.232037 / H13,989,631.366468 / I71,788,333.614726 / J−31,328,601.614726 / K−77.4315598895%.
H=현재104입고행 계산관세12,242,065.378131 + 승인 그외 비용 보완1,747,565.988337. 매입·운임 G59,971,650가 순매출 C40,459,732보다 크므로 이익률을 양수로 만들지 않았다. 실제 납부액 또는 확정 회계 손익이 아니다.

44차 F는 현재 canonical SQL17품목515단 기준. 저장 당시351/단위불명과 물리수량을 직접 비교할 수 없으며 이 사실을 `valuationBasisChange.physicalQuantitiesComparable=false`로 남긴다. 참조 donor는25/27/34~38/40/41/43차10개 원본 완전 자료이며 누락 보완 결과를 다시 donor로 사용하지 않는다. 국가단위 운임1,847.840655원/단, 통관1,654.307545원/단으로 상품비는 각 품목의 매입 근거를 유지한다. 동일 자료 재조회에서 수량은 운영 업무에 따라 달라질 수 있으며 저장 당시 수량으로 가장하지 않는다.

대상 회귀42개 PASS(기존 diagnostic30전후 동등 시나리오 포함), manifest195개 PASS, write guard 변경 API0 PASS, dnSpy evidence PASS. 필수 전체 verify/build·PR/CI·운영 배포/브라우저는 이 기록 시 진행 단계이며 완료로 표시하지 않는다.

## 로컬 최종 검증 상태

첫 공식 `npm run verify:erp-change`는 board/pretest/main ERP contract core를 통과하고 posttest의 `profitWorkbookDuty.test.cjs`에 남은 v4 release-version 상수에서 중단했다. 기대 버전만 v5로 갱신(분류·금액 검증 완화 없음), 해당5회귀 PASS 후 중단한 `test:profit-weekly-cache`부터 잔여 공식 posthook → manifest → writeguard → `npm run build`를 재개해 exit0. 로그 `.verify/china-full-gate.log` 및 `.verify/china-gate-resume.log`. `CIRCLE_NODE_TOTAL=2`, `NENOVA_BUILD_WORKERS=1`, webpack 빌드 및 정적136페이지1worker PASS. 첫 전체 명령 자체의 exit0로 주장하지 않는다. Linux CI의 전체 suite와 배포는 부모 담당이다.

실제 로컬 Chromium1920×1080/모든API합성응답44차 검증 PASS: H13,989,631/J−31,328,602/K−77.4% 표시, 수평 스크롤 후 K가 viewport 안에 들어옴, 접힌 근거 summary에서도 현재515단/저장351단위미확인 노출, 유한 셀에 계산불가 없음, JS error0/API write0. 스크린샷 `.verify/china-44-ui.png`, `.verify/china-44-ui-rates.png` 직접 확인. 이 UI fixture는 중국1행만 제공하므로 합계 완전성의 근거가 아니며 전체 국가 손익 완료를 주장하지 않는다. 본 작업 생성 로컬3245포트 서버 세션54074는 Ctrl+C로 종료했고 LISTEN 없음 확인.

빌드 생성 `data/generated/full-development-history.json`, `data/generated/menu-development-history.json`은 본 기능 변경이 아니므로 커밋에서 제외한다. 운영 SQL은 조사 이후 추가 실행하지 않았으며 데이터 보정·캐시/계산본 갱신 없음.
