# FormWarehouse 입고 엑셀 업로드 — nenova.exe golden

## 2026-11-23 업로드일 기본값 · native 저장 경계 보존

사용자가 입고일 기본값을 최초 업로드 시점의 한국 날짜로 확정했다. 기존 MakeTempTable G3/InputDate 및 InsertMaster 저장 순서·재고 트랜잭션은 바꾸지 않는다. 웹 신규 초안에서만 원래 업로드일을 입력하고, 발행일은 참고일로 유지한다. 기존 수동일자·저장초안·확정원장은 보존한다. 실제 공식 등록/SELECT 후조회: 2026/47-02 Holex 1222993 입고8247, InputDate2026-11-23,140행/13,320송이/14,291.55EUR/미연결0, 중복0. 이 등록은 사용자 매칭과 명시 승인 뒤 기존 native writer를 사용했다.

## 2026-10-23 태국 기존 입고 원가 전용 연결 재확인

실제 dnSpy.Console.exe --no-color -t ExcelLoadingPackingList 명령을 설치된 Nenova.exe에 재실행했다.
MakeTempTable은 박스/단/송이/UPrice/TPrice를 각각 보존하고 InsertMaster는
uspCreateWarehouse 후 uspStockCalculation을 호출한다. 태국 원가 연결은 이 native
쓰기 경로를 호출하지 않는다. 2026/38-01 Super Fresh 6902981 WarehouseKey7345는
19행,362단,4300송이,USD1452.40,상세 박스0으로 SELECT-only 확인했다.
원가 배분의 명시 패킹 그룹 박스는 웹 원가 입력이며 입고 박스를 채우는 값이 아니다.
실제 수식·ERP golden 산식 변경 없음. 상세 기준은 plans/thai-existing-cost-2026-10-23.md.

## 2026-10-08 재검증 정정 — 아래 과거 요약보다 우선

- 실제 `CommonLogic`을 dnSpy CLI로 다시 확인했다. `CheckFixSave`는 같은 CountryFlower의
  현재 `ViewShipment.DetailFix=1`, 직전 `ISNULL(DetailFix,0)=0`, 직후 `DetailFix=1`을 검사한다.
  전후 차수는 달력 증감이 아니라 StockMaster.OrderYearWeek의 가장 가까운 `<`/`>` 행이다.
  연도 경계도 포함하고 수량/거래처/입고 대상 ProdKey로 추가 축소하지 않는다.
- **CheckFixSave 메서드가 있다는 것과 엑셀 업로드에서 호출된다는 것은 다르다.**
  실제 ExcelLoadingPackingList.CheckData의 품종 SQL은 INNER JOIN 뒤
  `ISNULL(p.ProdKey,0)=0`이 있어 정상 양수 품목에서는 루프가 비어 있을 수 있다.
  아래의 "대상 CountryFlower별 검사 통과"는 의도된 정책의 요약이며 실제 모든 업로드가
  이를 실행한다는 보장이 아니다. 웹은 의도된 CommonLogic 검사를 명시 적용한다.
- CommonLogic은 조회 예외를 0건으로 반환하지만 웹은 조회 실패 시 fail-closed 한다.
- 실제 운영 usp_CreateWarehouse는 공용 TempWarehouseDetail **전체**를 소비한다.
  아래의 기존 SP 재사용 권고는 새 인보이스 writer에 적용하지 않는다. 공용 staging을
  사용하지 않는 경로의 native 상세/StockHistory/Product.Stock/StockCalculation 효과를
  격리 SQL에서 검증한 후에만 writer를 연결한다. 현재는 미연결이다.
- 실제 ViewWarehouse.OrderYearWeek2는 계산 컬럼이며 Master에 추가 저장할 필드가 아니다.
  WarehouseMaster의 실제 일자는 InputDate다. TPrice는 SP가 원문을 복사하므로
  통화를 항상 USD라고 추정하지 않는다.

실행: `dnSpy.Console.exe --no-color -t CommonLogic "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
근거: `C:\Users\USER\nenova-decompiled\Nenova\CommonLogic.cs`의 위 네 메서드,
`docs/diagnostics/2026-10-08-invoice-receipt-live-evidence.json`.
새 SELECT 사전검사 계약: `docs/plans/invoice-receipt-eligibility-v1.md`.

## dnSpy/CLI 원본

- 실행 파일: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\ExcelLoadingPackingList.cs`
- SP wrapper: `C:\Users\USER\nenova-decompiled\Nenova\DBMSSQL.cs`
- 재현 명령: `dnSpy.Console.exe --no-color -t ExcelLoadingPackingList "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`

이 문서는 decompile 소스의 `read-only` 검사 결과다. 운영 DB 쓰기나 보정은 수행하지 않았다.

## ExcelLoadingPackingList.isPacking — 고정 레이아웃

EXE는 임의 헤더 탐색을 하지 않고 0-based index 4, 즉 엑셀 5행의 고정 열을 검사한다.
공백을 제거하고 대문자로 바꾼 값이 다음과 정확히 같아야 한다.

| 열 | 값 |
|---|---|
| A | `COD` |
| B | `VARIETYNAME` |
| E | `SIZE` |
| F | `BOX` |
| I | `TOTAL\nBUNCH` |
| J | `TOTALSTEAM` |
| L | `T.PRICE` |

상세는 6행부터 읽는다. F/I/J가 모두 비어 있으면 건너뛰고, COD가 `TOTAL`이거나
VARIETY NAME이 비면 읽기를 끝낸다. `TOTALSTEAM`은 `TOTAL STEAM`이나
`TOTAL STEMS`로 임의 치환하지 않는다.

## ExcelLoadingPackingList.MakeTempTable — 필드 매핑

- `ProdName`: `VARIETY NAME`을 우측 trim한 뒤 SIZE가 있으면 공백 한 칸과 SIZE를 붙인다.
- `OrderCode`: COD 원문.
- `BoxQuantity`: BOX.
- `BunchQuantity`: TOTAL BUNCH.
- `SteamQuantity`: TOTALSTEAM.
- `SteamOf1Bunch`: G열.
- `SteamOf1Box`: H열.
- `UPrice`: K열.
- `TPrice`: L열.
- 모든 상세행은 먼저 `TempWarehouseDetail`에 bulk copy된다.

Master 메타는 `WarehouseMaster` 스키마로 준비한다. `OrderWeek=G2`, `FarmName=C2`,
`InvoiceNo=K2`, `OrderNo=C3`, `InputDate=G3`이며, `OrderYear`는 G3 날짜의 연도다.

## ExcelLoadingPackingList.CheckData — 품목과 확정 검사

품목 조인은 아래 의미의 대소문자 무시 정확 일치다.

```sql
LOWER(TempWarehouseDetail.ProdName) = LOWER(Product.ProdName)
```

따라서 SIZE를 버리거나 `LIKE '%name%'`, `TOP 1`로 유사 품목을 선택하면 EXE와
다르다. 웹 계약은 미등록 또는 중복 정확 일치가 하나라도 있으면 저장 후보 전체를
비워 부분 저장을 금지한다. 웹의 의도적 안전 보강으로 대상 `CountryFlower`별
`LogicManager.Common.CheckFixSave(OrderYear + OrderWeek, ..., true)` 정책을 적용한다.
실제 EXE CheckData는 위 정정에 적은 불가능한 품종 조회 조건 때문에 정상 품목에서
이 호출이 누락될 수 있으므로, EXE bulk 업로드의 검사 실행을 보장한다는 뜻이 아니다.

참고로 현재 decompile의 미등록 개수 SQL은 LEFT JOIN 뒤 `p.isDeleted=0` 조건을 두어
NULL 행을 제외할 여지가 있다. 웹은 이를 복제해 누락시키지 않고 EXE가 의도한
“등록되지 않은 제품이 존재하면 중단” 메시지와 파일 전체 실패를 강제한다.

## ExcelLoadingPackingList.InsertMaster — 저장 순서

1. CheckData를 호출한다. 품목/확정 검사 SQL의 누락 가능성은 위 정정 참조.
2. 준비한 `WarehouseMaster` 한 행을 bulk copy한다.
3. `DBMSSQL.uspCreateWarehouse()` → `usp_CreateWarehouse(@iUserID, @oResult)`를 호출한다.
4. 성공한 경우 `uspStockCalculation(SelectOrderYear, SelectOrderWeek, 0)`을 호출한다.
5. SP 또는 재고계산 실패는 성공으로 표시하지 않는다.

웹의 동일 작업은 이 native 입고·이력·재고 효과를 모두 검증해야 한다. 공용 staging 전체
소비가 확인되었으므로 신규 invoice writer는 위 정정의 격리 경로를 따른다.
상세 일부 INSERT만으로 호환 완료를 주장하지 않는다. 주문·출고·견적·매출 원장은 보존한다.

## 교차연도 fixture

### 2026-10-19 중국 기존 입고 원가 연결 근거

로컬 dnSpy CLI로 `ExcelLoadingPackingList.MakeTempTable` 및 `InsertMaster`를 다시 확인했다.
단수(BunchQuantity), 송이수(SteamQuantity), 단가(UPrice), 금액(TPrice)은 별도 필드다.
2026년 42-01 HUBFRESH 입고 7671 읽기 전용 대조에서 상품 64행, 2,280단,
상품금액 57,230 CNY 및 부대비 37,559.5 CNY를 확인했다. 원장 송이 필드와
원본의 실제 송이 합계가 달라도 단 기준 원가를 송이로 나누지 않는다.
CN 연결은 CNY/단 및 상품·단가별 단수/금액을 대조하고 기존 67행 전체를 보존한다.
NULL 품목 2행은 금액 0이며 출고·견적수량 NULL인 경우에만 원가 배분에서 제외한다.
연결과 원가 저장은 native 입고 생성/SP/재고 재계산을 호출하지 않는다.
입고·출고·견적·매출 원장은 변경하지 않는다. 실제 운영 원가 저장 검증은 별도 기록한다.

2025년 `33-01`과 2026년 `33-01`이 함께 있어도 G3/명시 입력에서 얻은
`OrderYear=2026`, `OrderWeek=33-01`을 `usp_StockCalculation`까지 전달한다.
`OrderWeek`만으로 과거 `WarehouseMaster`, `StockMaster`, `ProductStock`을 선택하거나
재사용하지 않는다.

## 부작용 표

| 동작 | TempWarehouseDetail | WarehouseMaster/Detail | ProductStock | Order/Shipment/Estimate/WebProfitReport |
|---|---|---|---|---|
| 파싱/검토 | 보존 | 보존 | 보존 | 보존 |
| 검증 실패 | 정리/롤백 | 보존 | 보존 | 보존 |
| 업로드 성공 | stage 후 SP 소비 | EXE 순서로 생성 | 대상 연도·차수 재계산 | 보존 |

## 2026-11-23 CLOUD 원가 원본의 weigth 오타 두 행
실제 설치 EXE ExcelLoadingPackingList를 dnSpy CLI로 다시 확인했다. MakeTempTable은 B열 품명(끝공백 제거), A열 OrderCode, F/G/H/I/J/K/L 값을 보존하고 공란 가격을 0으로 넣는다. Product 매칭은 LOWER(td.ProdName)=LOWER(p.ProdName)이다.
읽기 전용 운영8160/2026/46-02/2026YY-053의50449/50450은 Product NULL, OrderCode47/48, 박스·단·단/박스환산각1, Steam2543, UPrice/TPrice0이었다. 업무드라이브 보관 원본 SHA0d47d73469576f1f537c44929660ead1b226540cfc67916829fbb39eb82a974e의 CN-CLD!B52:J53에서 Gross weigth/Chargeable weigth 오타와2543을 확인했고 A6:L53 전체48행을 원장과 대조했다. 상품 누락이 아닌 중량행이다.
원가 source에서만 검증기록의 정확업무키·파일명·전체지문·0원pair를 확인해 분리한다. 원장/SP/재고 SQL을 수정하지 않는다. 호접50438의 G41/I41/J41=1/80/80과원가표E66=80단은 계산본1:1단위근거다. native송이단위·수량·가격은보존한다. 다른연도/입고/금액·pair변경은기존차단을유지한다. 상세기준은 docs/plans/cloud-native-source-2026-11-23.md 및 nativeReceiptCostEvidence 회귀를 따른다.


## 2026-11-23 같은 차수 A/B·품종 통합 원가
실제 ExcelLoadingPackingList CLI 재확인: MakeTempTable의 G2 차수 및 G3 연도로 WarehouseMaster/Detail 저장, InsertMaster 후 native 재고계산 호출 순서는 변경하지 않았다. 운영 SELECT 중국2026/45-03 입고8061/8062는 동일 원장차수·서로다른AWB이며 패킹원본64행을 가격/금액/수량까지 전수대조했다. 원본 SHA bf76704f7f5327e4dc815278eec0bf58f69cb0f48dd2b36512b089615b07ba41 /60cd46d8f978d926112c1da4dbf502109ac9a68a26852539d0f9554f4ad3baa1. 두 weigth 오타 중량pair는 각각1050/980kg, exact 근거기록 일치시 원가상품에서만 분리한다.
콜롬비아2026/46-02는22입고94상품/44940송이, 하나의AWB01441369974에 수국·카네이션·장미·알스트로가 있다. 원본AWB와Apollo엑셀은GW3942/CW4824/운임13737.8USD 일치, MasterInvoice1쪽FB195.75와품종수량 전부일치.6쪽FE204138 PHYTO15USD·12쪽FC02182 추가청구15USD는 각송장비용으로별도표시한다. native가격/원장/재고/견적/손익 쓰기0. 통합 기준과 부작용은 plans/arrival-week-consolidation-2026-11-23.md.

## 2026-11-23 업로드일 기본값과 CLOUD 원본 Contract 지원
- 입고일 초기값은 최초 업로드의 한국 날짜이며 송장 발행일과 구분한다. 저장 초안의 명시 날짜·기존 입고일을 덮어쓰지 않는다. 사용자 확인 실제 송장번호는 A 2026YY-054 / B 2026YY-055이다. 원문에 없는 번호를 추출값으로 표시하지 않는다.
- 47-2A 원본 SHA fd136fbc2c0e33b58cf72a667a8197b2cb78eb00781b6809f13c0dfc79d2cb0b, Sheet1 A7:H7 정확 8열, 상품8:45 38행/2365단/54909CNY, 비용47:49 23168, 총액G50=78077. B SHA41c8778688245c80f93daa05667991a621bb94c2d3b1c0d2efdcb7696adc902b, 상품8:9 2행/2620CNY, 비용11:13 1830, G14=4450. 상품 단가=(E+F), 금액=D*(E+F). B8 25단/125송이, B9 90송이/단수미기재. D10의115는 혼합단위 소계로서 115단으로 저장하지 않는다.
- 원문 미기재 박스/GW/CW는 NULL. 국제운임 Quantity2452/70은 kg 표기가 없어 중량으로 간주하지 않는다. 실제 INFORMATION_SCHEMA에서 BoxQuantity/BunchQuantity/SteamQuantity nullable float 확인, 기존 NL8247의62행 Box NULL 확인. 기존 native MakeTempTable/InsertMaster 필드·Float파라미터·트랜잭션·재고계산 순서는 유지한다.
- NZ 초안210195/2026/47-01은 공급농장69의 Country NULL로 preflight가 차단했다. 동일명 기존입고3245의 상품원산지는 뉴질랜드이다. 후보조회에서 같은 이름뿐 아니라 국가까지 일치하는 마스터만 역사후보를 대체하도록 수정한다. 잘못된 국가·미확인 국가인 마스터는 유효 역사후보를 숨기지 않는다. writer의 저장직전 PK/정확농장명/상품국가 재검증은 유지하며 과거 상품·가격·연도·차수를 복사하지 않는다.

## 2026-11-23 원문 연도 미기재 초기화
날짜가 없는 CLOUD Contract는 아직 연도를 입력하지 않은 신규 편집자료이다. 이때 연도필수인 보조 자동채움 API를 먼저 호출하지 않는다. 빈 연도를 UI에 그대로 표시하고 사용자확정 연도·차수·실송장번호를 입력한 뒤 기존 server draft/preview/commit 검증을 받는다. 원문 날짜를 생성하지 않는다. 실제A38/B2 원본의 초기화와 원문대조창을 격리UI에서 검증했다. writer/EXE/SP/공유원장 필드·저장순서 변경없음. NZ210195는 기존 정식 경로로8248을 생성해3행740송이4253.8NZD·미연결0을독립SELECT로확인했다.

## 2026-11-23 수동 매칭 후 남은 원본 경고
38행을 모두 선택해도 최초 별칭 경고가 남아 초안 저장 전에 차단되었다. 정확한 파생 경고만 현재 행의 prodKey/erpMatchConfirmed 엄격 true 상태로 재계산하며 다른 원문 경고는 유지한다. 실제 updateLineProduct 동일-key 재선택으로 38/2행 확인 flag가 true가 되는 실행 회귀와 실제 원본 A/B·활성 중국 품목490개·실제 validateInvoiceReceiptLines를 사용한 격리UI 초안저장/preview가 모두 통과했다. A 78077/B4450CNY, 원장 commit은 격리 fixture에서 차단했다. 공유 DB SQL/SP/EXE/native 원장 필드와 트랜잭션·재고·견적·손익 부작용 계약 변경 없음.

## 2026-11-24 도착원가 공유 편집과 출처 승계
actual dnSpy CLI ExcelLoadingPackingList.MakeTempTable/InsertMaster를 재확인했다. 년도/차수·원장저장 순서는 변경하지 않는다. readonly47-02의8249/8250은38/2행·상품54909/2620CNY·미연결0·원장GW/CW NULL이다. 검증된 WebInvoiceDocument/operation에서 원문명을, 원가표 SHA1e36606d598edab2f58c337298c4e58f397f53227c3d7f68f5e3843b8a922563의47-2A/B CLOUD cbm C8/F8에서GW1823/21·CW2452/70을원가화면에만승계한다. E8계산부피는청구중량으로대체하지않는다. 정확한연도/차수/입고/파일/품목/금액지문이바뀌면참조를적용하지않는다. B호접의90송이/단NULL은원장에서보존하고원가표E35:F35의90계산수량으로만변환한다. 미확인통화·허가증·검역18은자동확정하지않는다. 카테고리공유는서버업무설정파일의CN/Cloudland/활성ProdKey만수정하며expectedRevision·파일lock·원자저장·사용자이력보존; ERP주문/출고/입고/재고/견적/손익쓰기0.
## 2026-11-24 수기 입고 단위와 금액 재확인

2026-11-24 설치본을 dnSpy CLI로 추출했다. `FormWarehouseAdd.CheckValue`는 품목·수량 및 `CheckFixSave`를 확인한다. `btnSave_Click`의 `UnitQuantity`는 `WarehouseDetail` 박스·단·송이에서 출고와 견적 수량을 각 단위대로 고른다. `TPrice=SteamQuantity×UPrice`이다. 상세·재고 이력·품목 재고와 연도/차수 재계산은 기존 보호된 웹 입고 트랜잭션으로 처리한다. [읽기 검증과 영향 표](../plans/manual-warehouse-upload-2026-11-24.md).
