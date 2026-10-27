# 태국 39-01차 승인 사진 중량 — guardian 선행 검토

## 1. 범위와 결정

- 기준 작업트리: `C:/Users/USER/nw-thai39-weight-evidence`, base `acdc90d7`.
- 사용자 확인: 사진은 **2026년 39-01차 / AWB 21710637233 / EXCEL / WarehouseKey 7474** 자료이며 **GW 164kg / CW 225.5kg**을 적용한다.
- 허용: 정확한 해당 업무키의 웹 계산에 읽기 전용 문서 근거를 보완한다. 최신 미확정 매출자료의 H 및 재고 원가 재현이 달라질 수 있다.
- 금지: ERP/웹 DB 쓰기, WarehouseMaster/Detail 수정, Product 생성/연결, SP 실행, 원장 재계산, 수기값 덮어쓰기, 확정 revision 갱신. **운임 772.315 USD는 보존한다.**
- 사진은 중량 근거다. 비용 전체가 실제 청구로 확정된 것이 아니므로 기존 `approved_estimate` 통관비 정책을 `sql_actual_cost`로 승격하지 않는다.

## 2. 사전 근거와 재확인

### 사진

- 파일: `C:/Users/USER/AppData/Local/Temp/codex-clipboard-df652109-d3c3-4360-b366-7af0dc480446.png`
- SHA256: `364a7be5616b2cdb1fcb4711da0c4b6f35f380013aa322004101dfbba9e40427`
- 직접 확인: 14 packages, Gross Weight 164.00kg, Chargeable Weight 225.50kg, Rate 1.65.
- 잘린 사진 자체에는 AWB가 보이지 않는다. **사진과 대상 AWB/차수의 연결은 사용자의 명시 확인**이며 OCR 추정이 아니다.
- 사진의 `225.5×1.65`를 기존 전산 운임 대신 사용하지 않는다. 사용자가 기존 운임 유지와 중량 적용을 별도로 지정했다.

### 실제 dnSpy

- 실행 파일: `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`
- CLI: `C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe`
- 명령: `dnSpy.Console.exe --no-color -t FormWarehouseView Nenova.exe` (2026-10-27 guardian에서 재실행).
- `GetData`: WarehouseMaster와 WarehouseDetail 합계, `wm.isDeleted=0`, UploadDtm 기간 조회.
- 상세: `WarehouseDetail JOIN Product ON wd.ProdKey=p.ProdKey`, 선택 WarehouseKey, UPrice/TPrice 조회. 따라서 ProdKey NULL 보조행은 EXE 상세에서도 보이지 않는다. 이는 원장 삭제 또는 가짜 Product 생성 근거가 아니다.
- 삭제 경로의 StockHistory/uspStockCalculation은 읽기만 확인했고 실행하지 않았다.
- 기존 기록: `docs/exe-golden/FormProfitReport.md`, `docs/WEB_VS_ERP_CONFLICTS.md` 7.6/11.6, `docs/DB_STRUCTURE.md` Warehouse/FreightCost 구간.

### SELECT 전용 근거

- 기존 probe: `C:/Users/USER/nw-incoming-date-default/.verify/review-thai-weight.mjs` 및 `.json`.
- guardian fresh 재확인: 같은 DB 연결 모듈을 사용한 인라인 Node 실행. SELECT 이외 및 INSERT/UPDATE/DELETE/MERGE/DDL/EXEC/INTO, batch/execute/transaction.begin을 모두 차단했다. 초기 4 SELECT와 상세 지문 재확인 1 SELECT, **총 5 SELECT, DB writes 0**. 새 결과는 이 문서에 기록하며 별도 fresh JSON을 작성하지 않았다.
- 공통 범위: `wm.OrderYear=@yr AND wm.OrderWeek=@wk AND (wm.WarehouseKey=7474 OR normalized(wm.OrderNo)=@awb)`; 매개변수는 2026, 39-01, 21710637233. FreightCost도 이 WarehouseMaster 범위로 조인했다. WebCustomsWeekly는 2026/39/태국만 조회했다.

| 원천 | fresh SELECT 결과 |
|---|---|
| 같은 AWB 입고 | 7470 Krung, 7471 Super Fresh, 7474 EXCEL; 모두 2026/39-01, 활성 |
| WarehouseMaster GW/CW | 세 헤더 모두 NULL |
| FreightCost | 해당 AWB 헤더에 없음 |
| WebCustomsWeekly | 2026/39 태국 행 없음 |
| 42866 / 7474 / Prod2182 | 운송료, Bunch270.5, UPrice1.65, TPrice446.325 |
| 42867 / 7474 / Prod2182 | 운송료, UPrice0, TPrice325.99 |
| 42868 / 7474 | ProdKey NULL, OrderCode3, Box1/Bunch1/Steam209, Out/Est NULL, SteamOf1Box1/SteamOf1Bunch1, UPrice0/TPrice0 |
| 42869 / 7474 | ProdKey NULL, OrderCode4, Box1/Bunch1/Steam270.5, Out/Est NULL, SteamOf1Box1/SteamOf1Bunch1, UPrice0/TPrice0 |

**209/270.5를 각각 GW/CW라고 확정하지 않는다.** 사진 승인값과 원문 라벨을 잃은 NULL 보조행은 별개 근거다. 정확한 PK와 원문 지문은 사진 fallback을 현재 전표에 적용할 수 있는지 확인하는 가드로만 사용한다. **정정:** 초기 guardian 분석은 NULL행이 상품 분모에 남는다고 보았으나, 실제 `lib/freightCalc.js:157 isFreightRow`가 `isOrphanZeroRow`를 호출하여 품목·이름 없는 0원행을 이미 제외한다. 따라서 이번 작업에서 품목 분류나 분모 정책을 변경하지 않는다. 일반 미매칭 상품의 수량/비용 풀도 기존대로 보존한다.

## 3. 기준 결정표

| 기준 | 승인값/정책 | 미충족 시 |
|---|---|---|
| 연도 | `2026` 명시 | 타 연도/누락에는 적용하지 않음 |
| 세부차수 | `39-01` 정확 일치 | 39-02/40-01 등 비적용 |
| AWB | 공백/하이픈만 정규화 후 `21710637233` | 부분문자열·다른 AWB 비적용 |
| source WarehouseKey | `7474` | 같은 AWB의 다른 헤더에 각각 복제하지 않음 |
| FarmName | trim/case 정규화한 정확 `EXCEL` | 유사 농장명 비적용 |
| 활성 상태/국가 문맥 | 활성 source, 같은 연도·세부차수 AWB의 태국 상품 | 삭제/혼합·상충 국가에는 적용 보류 |
| 승인 문서 값 | GW164 / CW225.5 kg | 209/270.5를 대체 문서값으로 추론하지 않음 |
| 기존 실제 원천 | 유효한 명시 중량행/헤더/원가 스냅샷은 보존 | 사진과 충돌 시 덮어쓰지 않고 차이 표시/보류 |
| 수기값 | WebCustomsWeekly GW 및 유효 수기 H/S/R, 명시0 보존 | truthy fallback 금지 |
| 보조행 지문 | 42868/42869 및 위 원문 필드 지문 일치; 사진 fallback 가드만 | 변경/누락/중복상충이면 사진 적용 금지; 기존 분류/분모 정책 불변 |
| 운임 | 원장 TPrice 합 `446.325+325.99=772.315 USD` | CW×Rate로 다시 생성하지 않음 |
| 적용 횟수 | 원천 WarehouseKey/evidence ID당 1회, AWB 그룹 중복 금지 | 복수 join 행·상품 헤더 수로 증폭 금지 |
| 상태/출처 | 사용자 승인 문서 중량, 기존 통관비는 승인 추정 | SQL 실측/실비 확정으로 잘못 표기하지 않음 |
| 확정 보고서 | 기존 저장 revision 그대로 | fresh 계산으로 과거 확정본 재구성 금지 |

## 4. 최소 공통 연결 지점과 위험

1. 순수 evidence helper가 연도·세부차수·AWB·WarehouseKey·farm·활성 상태·원천 지문을 함께 검증한다. 결과는 적용 여부/거절 원인/중량/출처/검증한 상세키로 구분하며 입력 객체를 수정하지 않는다. 새 상품 제외/분류 정책을 추가하지 않는다.
2. `lib/customsForwarding.js:629 loadWarehouseGw`: 현재 SQL에는 상세키와 원본 연도가 빠져 있다. helper가 실제 행의 동일성을 검증하도록 필요한 읽기 필드를 보강한다. 상세행마다 164를 더하지 말고 기존 WarehouseKey 엔트리 또는 공통 그룹에서 한 번 반영한다.
3. `lib/pivotFreightArrival.js:239` Thai 실제/추정 원가 그룹: H 배부용 GW를 별도 계산한다. 같은 helper를 사용하지 않으면 본표 H만 복구되고 품목 원가 재현은 계속 실패한다. 기존 `isFreightRow`/`isOrphanZeroRow` 및 `approvedThaiArrival`의 `ALL_INVOICE_STEMS` 분모 정책은 그대로 유지한다. 이름 없는 0원행은 이미 비상품이며, 실제 일반 미매칭 상품은 기존 분모·미배부 풀에 남긴다.
4. 일반 피벗/운송원가 저장 경로로 예외를 확대하지 않는다. 보고서용 허용 경로와 그 근거 표시에서만 사용한다. 공통 loader에 옵션이 필요하면 기본은 비적용이며 본표/이전차수/품목원가에서 명시적으로 동일하게 활성화한다.
5. `resolveCountryWeight`는 명시 GW0을 보존한다. 단순히 문서값을 `erp_inbound`로 부르면 SQL 원천이라는 오해가 생기므로 별도 문서 provenance를 API와 설명에 전달한다. 기존 수기 저장 정책을 변경하지 않는다.
6. `pages/api/sales/profit-report.js:313/386` 이전/현재 Thai 승인 비용과 평균식은 동일한 입력 경로를 사용해야 한다. **39차 F가 바뀌면 40차 E가 같은 값으로 이어져야 한다.** 수량은 그대로이고 평가금액만 바뀐다. 이후 차수의 품목별 이전 매입 재현이 39차를 참조하면 그 영향도 별도로 보고한다.
7. 새로운 helper/근거 파일은 `lib/profitReportCalcHash.cjs` 계산 지문에 포함한다. 과거 자동 계산 캐시의 stale과 확정 revision 보존을 구분하며, 조회 중 snapshotRefresh/확정/수기 저장을 호출하지 않는다.

## 5. 사용자 동작별 부작용 표

| 동작 | WarehouseMaster/Detail, Product, FreightCost/Detail | Order/Shipment/ShipmentDate/ShipmentFarm/Estimate | ProductStock/StockHistory | WebCustoms/Forwarding/Taxable, WebProfitReport | Confirm/Detail, 계산 snapshot |
|---|---|---|---|---|---|
| 사진 근거 적용 가능 여부 조회 | SELECT/보존 | 보존 | 보존 | SELECT/보존 | 보존 |
| 최신39차 H·F/품목원가 계산 | SELECT/보존 | 매출 SELECT만/보존 | 수량 SELECT/보존 | SELECT/보존 | 읽기만/보존 |
| 40차 E 및 후속 원가 재현 | 같은 매입 업무키 SELECT/보존 | 보존 | 수량 SELECT/보존 | SELECT/보존 | 보존 |
| 화면·엑셀·검산 표시 | 보존 | 보존 | 보존 | 보존 | 확정값은 원래 revision 그대로 |
| 저장/확정/재계산/원장 보정 | 이번 작업에서 실행 금지 | 실행 금지 | 실행 금지 | 실행 금지 | 실행 금지 |

## 6. 필수 회귀와 배포 차단 조건

- 양성: 승인 업무키·지문 전체 일치 → GW164/CW225.5, source1회, 운임772.315 불변.
- 각 조건별 near miss: 2025/2027 같은 차수, 39-02/40-01, 다른 AWB/키/유사농장, 삭제행, 혼합국가, 키 누락, 자료 변경/중복상충. 승인되지 않은 모든 입력은 기존 결과 유지 또는 명시 보류한다.
- 실제 원천: 중량행/헤더/FreightCost가 새로 들어온 경우 보존하고 문서와 충돌을 숨기지 않는다. 수기 GW0/H0/S0/R 유효값 및 저장된 양수값의 기존 우선순위를 검증한다.
- source 중복: 같은 WarehouseKey 다수 상세, 동일 AWB 상품 헤더7470/7471, 중복 join → 중량·운임·H 배분을 중복 가산하지 않는다.
- 보조행: 정확한 두 NULL행의 지문으로 사진 적용만 제어하고 기존 분류/분모 정책을 변경하지 않는다. 다른 NULL 상품/다른 운임전표/금액이나 수량이 바뀐 행을 임의 제외하지 않는다. DB/입력 배열 불변 확인.
- 실제 loader fixture로 `loadWarehouseGw`와 Thai 원가 배부 경로의 중량/분모/운임 일치 검증. 순수함수 테스트나 문자열 검사만으로 완료 판정하지 않는다.
- 39차 F→40차 E 연속성, 38차 및 40차 자체 중량/운임 보존, 41차 이후 영향 범위를 before/after로 기록. 수량·Q·N·L·O·R·S가 예상 없이 바뀌면 배포 중단한다.
- 명시0/환율누락/원가부족/음수재고/혼합단위/확정 snapshot fixture 유지. 중량 하나 보완했다고 모든 차수 정상으로 표시하지 않는다.
- 코드지문 변경·일반 자동 snapshot stale·확정 revision 원본 보존 확인. 검증 도중 DB 쓰기 차단 훅을 사용하고 대상 원장/웹수기/확정/재고 전후 지문을 비교한다.
- 계약 등록: 새 helper/테스트와 사진 승인 정책을 대상 manifest에 추가하고 기존 `profit-actual-costs`, `profit-cost-source-recovery`, `profit-country-average`, snapshot 계약과 충돌하지 않게 한다.
- 필수: 관련 실제 loader/평균/원가/회계회귀 + `npm run verify:erp-change`/webpack + manifest/write guard/dnSpy. 실패하거나 근거/범위가 불명확하면 배포 금지.
- 운영 smoke는 로그인된 읽기 전용 GET/화면으로 39차 문서 근거, 운임 보존, 40차 E 연속성, 확정본 보존을 확인한다. 자동 저장 POST를 검증 절차로 실행하지 않는다.

## 7. 선행 판정

**위 조건을 구현·실행 회귀로 고정하는 전제에서 선행 검토 합격.** guardian는 이 계획 문서만 작성했다. 제품 코드·DB·확정본 변경, 구현 테스트/배포 승인은 아직 수행하지 않았다. 구현 diff와 실행 결과를 다시 검토해야 최종 합격이다.

메인 baseline 증거: `.verify/reports-before.json`, `.verify/integrity-before.json` (2026-10-27). 메인이 기존 `acdc90d7` 모듈로 38~41차를 4,034 SELECT로 읽었으며 관측 원장/수기/확정본 지문 동일을 확인했다. 구현 후 같은 조건의 before/after 대조가 필요하다.

## 8. 구현 후 독립 guardian 검토

2026-10-27 제품 diff를 읽기 전용으로 검토했다. 정확한 업무키·상세 지문을 공통 helper에서 검증하며 보고서 profile/실제원가 옵션에만 적용한다. `isFreightRow`/`isOrphanZeroRow` 정책은 변경하지 않았고, 실제 미매칭 유상 상품은 기존 배부 분모·미배부 풀에 보존한다. 평균평가의 현재/전차수, FIFO·이전 매입원가의 sourceRefs와 계산 지문 등록을 확인했다.

- 독립 실행 PASS: `profitReportWeightEvidence.test.cjs`, `profitReportActualCosts.test.cjs`, `profitReportAcquisitionCarry.test.cjs`, `customsForwardingAuto.test.js`, `profitReportCountryAverageIntegration.test.cjs`, `profitReportAuditDetails.test.js`, `profitReportStoredRatePriority.test.cjs`, `profitReportTimingIntegration.test.cjs`.
- 발견·수정 완료한 경계 결함: 미래에 원장 GW300/CWNULL 또는 GWNULL/CW100이 추가되면 사진과 결합한 GW>CW가 만들어질 수 있었다. 이제 **원장 값은 보존하고 충돌을 만드는 사진 필드만 미적용**하며 `native_photo_weight_pair_conflict`를 남긴다. 두 회귀 fixture와 신규 전체 테스트를 다시 통과했다. 현재 SQL은 두 값 모두 NULL이어서 이 방어 보완은 정상 승인값을 바꾸지 않는다.
- `.verify/comparison.json` 직접 확인: 38~41차 독립 산술검사 1,070건, 실패0. 입력 자동값 변화는 태국39 H `null→412050`, 태국39 F `105268.70031541296→95032.54300222978`, 태국40 E 같은 값으로 연결되는 3건이다. 파생 I/J/K는 그 입력에 맞게 재계산된다. 다른 국가/차수의 입력 자동값은 동일하다.
- `.verify/integrity-after.json` 직접 확인: 최종 재실행 4,038 SELECT, DB 쓰기0, 관측 지문 `stable=true`. 원장·수기·확정 자료 보존은 읽기 전후 관측 결과이며 하나의 원자적 DB snapshot으로 증명한 것은 아니다(`atomicSnapshot=false`).
- 화면 조회 안전성: API는 `loadWeeklyReportPayload(..., { preferLive: true })`로 읽는다. `pages/sales/profit-report.js`의 `load`와 `refreshSnapshot`은 모두 GET이며 자동 저장을 하지 않는다. API 내 오래된 `preferLive=false`/자동 POST 설명 주석은 현재 호출 동작이 아니므로 판단 근거로 사용하지 않는다.
- 전체 gate: 메인 실행 `npm run verify:erp-change` exit0, webpack build 포함 PASS (`.verify/erp-verify.log`). 별도 dnSpy 및 base 대비 read/write guard PASS, 마지막 P2 보완 후 신규 회귀 PASS. 최종 probe의 1,070 독립검사 실패0과 원장/수기/확정 지문 동일을 재확인했다.
- **최종 guardian 판정: 구현·계약·회귀·전체 빌드 검증 합격, PR/배포 진행 가능.** 실제 CI·배포·운영 브라우저 smoke는 메인 담당이며 이 기록만으로 배포 완료를 뜻하지 않는다. 사진은 사용자 확인 문서 근거이고 통관비는 승인 기준 추정이라는 제한을 유지한다. 이번 범위를 넘어 전체 1~41차 비용 문제가 모두 해결되었다고 판정하지 않는다.
