# 업체비중·이월포함 판매마진 구현 기준

## 승인과 범위
- 사용자2026-10-27: DB를건드리지않고기존수익률유지,모든품종 업체비중/이월재고포함평균원가판매마진과차이원인을웹에추가하고검증·배포. 추가38/39차원인SQL감사.
- base04b3c958, 별도codex/profit-customer-margin작업트리. 이전작업의미커밋문서/생성파일보존.
- 별도 `/sales/profit-customer-margin`와인증GET `/api/sales/profit-customer-margin`, 기존보고서링크만추가. 기존본표공식/저장/확정/캐시갱신경로변경없음.

## 부작용/downstream
| 동작 | Order/Shipment/Date/Farm | Warehouse/StockHistory/ProductStock | Estimate/금액/VAT/isFix | WebProfitReport/확정/캐시 |
|---|---|---|---|---|
| 조회·비교·필터·펼치기 | SELECT 또는보존 | SELECT만 | SELECT/보존 | SELECT/보존,갱신금지 |
| 페이지이동 | 보존 | 보존 | 보존 | 보존 |

## 실제 EXE 근거
- 2026-10-27 설치 EXE를 `dnSpy.Console.exe --no-color -t FormSalesView`, `-t FormStockView`, `-t FormWarehouseView`, `-t ClassShipmentDetail`로각각실제실행,exit0.
- EXE SHA256 FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79. 출력 `.verify/dnspy-*.txt`.
- FormSalesView.GetData는ViewShipment.Amount와ViewOrder/ShipmentDate/PeriodDay의기존매출조인. 신규분석은사용자승인본표의확정ShipmentMaster/Detail 직접N집계와대사하고EXE의날짜조인으로수량중복생성하지않음.
- FormStockView.GetData:StockMaster→ProductStock,OutUnit/EstUnit별표시;기초현재스냅샷/입출고/StockHistory분리. StockMaster.isFix로걸러내지않음. 실제물리잔량과금액기준청구수량구분.
- FormWarehouseView.GetDetail:Box/Bunch/Steam/Out/SteamOf1Box/SteamOf1Bunch/UPrice/TPrice원천. 통화/원가를수량또는품목판매Cost에서추정금지.
- ClassShipmentDetail.Insert/Update에CustKey없음,Amount/Vat/EstQuantity/Cost저장. 거래처는ShipmentMaster.CustKey. docs/DB_STRUCTURE의Estimate.CustKey및Cost'원가'과거표기보다실제스키마/현재SQL우선:Estimate는ShipmentKey→Master에서귀속하고Cost는분배판매가다.
- 기존FormProfitReport/ProfitInventoryCycleEvidence와비교. 새원가공식은별도관리분석이며EXE원장평가를변경하지않는다.

## criteria ledger
- 명시연도+대차수;요청배열/빈값/잘못된차수400. 비교차수도연도분리. 기본직전차수는실제PeriodDay순서,전년52고정금지.
- N=동일year+week+rawmajor,activeMaster,master/detail확정,OutQuantity!=0,무게/운송료제외. L/O별도Estimate/Freight. 국가품종분류는현재공용resolver/override와일치.
- 판매평균=공급가/EstQuantity(같은EstUnit),gross=(Amount+Vat)/EstQuantity. 물리수량별도. 양수판매비중과반품/0수량금액조정분리. 같은ProdKey·unit에서품목구성통제.
- 모든품종·업체계산,top300 제한금지. 화면필터는전체합계보존. 단위다른행합산평균금지.
- 신규품목원가=(검증된기초원가금액+당차수완전도착원가)/(같은단위기초수량+입고수량). 미래매입/현재FX/판매단가/다른품목평균으로빈근거대체금지. 연속평균복원은검증된zero/specific-cost anchor와품목수량연속성필요. 오래된취득원가단독이월을완전한가중평균처럼표시금지.
- 원가null은미확정. 일부원가만있으면전체마진null+알려진부분별도/coverage. 승인비용추정은estimated표식유지. 환산충돌/음수기초/분모0/수량차이명시,자동보정없음.
- 판매마진분모순매출; 기존보고서일반행K=J/C,noEnding행및전체합계K=J/(C+F)는별도보고서수익률로명시. 재고조정은고객별판매손익에임의배부하지않고보고서손익과의차이를별도표시.
- 원인:품목구성/업체구성/동일품목가격/판매량/원가/차감/기타와재고조정/평가차이. 공통항목비교coverage와신규/이탈/미설명차이표시. 원가내FX/운임을두번가산금지. 기여합계가실제차이에맞지않으면검증실패표시.
- 보고서저장시점과현재SQL시점은별도표시. 본표N/L/O대사차이면stale경고,기존계산본refresh금지.

## API/UI 공통 응답 v1
GET query `year`, `week`, optional `compareYear`, `compareWeek`. 서버가누락비교만실제직전차수로해석,응답에명시.
`{ok, current:{year,major,asOf}, previous:{year,major,asOf}, groups:[], reported:[], warnings:[], metadata:{readOnly:true,modelVersion}}`.
group:`{key,category,country,flower,unit,current,previous,customers:[],products:[],drivers}`.
current/previousmetrics:`{quantity,positiveQuantity,netSales,shipmentSales,vat,avgNetPrice,avgGrossPrice,costAmount,marginAmount,marginPct,quantityShare,revenueShare,coverage:{knownSales,totalSales,unknownProducts},warnings:[]}`. 마진율은fraction,미확정null.
customer:`{custKey,custName,current,previous,products:[]}`; product:`{prodKey,productName,unit,current,previous,costBasis}`. costBasis에는기초/입고수량·원가·평균·source/status/이유.
drivers:`{profitDelta,marginDeltaPp,contributions:[{key,label,amount,percentagePoints}],residual,coverage,warnings}`. percentagePoints없으면null(임의0금지).
reported는기존분류별`{category,current:{C,E,F,G,H,J,K,AJ,source,asOf},previous,drivers:[],adjustments:[]}`. 원국가/품종/단위그룹마다본표값복제합산하지않음.
위shape의상세필드추가는호환허용,이름변경은UI/서버담당동시협의.

## 메뉴 기준선
- 적용:독립페이지singleLayout,popup=1,페이지세로스크롤,고정폭가로표,명시조회/취소중복요청방지,원가근거펼침,키보드Tab/Enter/Space/Escape/방향키,1366/1920/좁은창.
- 해당없음:업로드/ERP적용/승인저장/신규DB/새sidebar메뉴. 기존매출보고서에서새창링크가진입점.
- 회귀:교차연도·이월원가·매입없음·부분원가·단위충돌·0/null·신규이탈·VAT·고객mix만·가격만·원가만·기여검산·원장쓰기차단·원본수익률보존·기존보고서성능.

## 검증/배포 기록
- 신규계산/API/원인분해/UI회귀,기존도착원가/FIFO회귀통과. `npm run verify:erp-change` 1차전체통과(ERP계약/manifest/writeguard/webpackbuild). 추가독립리뷰보완뒤최종재검증·CI·배포는계속진행한다.
- 현재38→39SQL읽기875회,5.9초,쓰기0. 49판매·차감그룹과18기존보고서행. N/L/O저장본대사차이0. 별도본표독립검산1292건통과.
- 39차295판매품목중원가복원176/미확정119,매출확인범위23.8%(승인추정포함). 전품목비중은표시하되원가없는전체마진확정금지. 38차는23.2%.
- 실제SQL SP의세부차수ROUND2로39차원시대사차이8품목을별도재검산하면전부맞는다. 다른취득원가/양수조정근거부족은해결되지않았으므로원가null유지. 과거전체기간ROUND2자동복원은미검증이며UI는원장오류로단정하지않는다.
- 기존원가모듈3개변경은named export와추가입고행ID/가격수량coverage뿐이다. 기존숫자/필터/산식변경없음. 동일ProdKey중복입고행의원가수량복제가능성은새소비자에서불완전근거로거절한다.
- 본체보고서수정은새창링크4줄뿐이며SQL원장·기존확정·수기·저장계산본보존. 로그/세션은기존공통인증정책을유지한다.

## 배포 차단 조건
1. 필수계약/교차연도/원인기여합계/원가누락/단위검사또는build실패.
2. 조회에서업무DB쓰기·DDL·SP·보고서재저장시도발견.
3. 부분매입원가나판매Cost가가중평균원가로승격되거나미확정을0으로표시.
4. 기존수익률·확정본변화,실SQLN/L/O의설명없는불일치.
5. CI실패/Cafe24실패/hydration오류/운영새창인증또는조회실패.
6. 실브라우저검증전에는배포완료라고보고하지않는다. 금융원장등록·보정행위는스모크에포함하지않는다.
