# FormShipmentDistribution — exe golden (dnSpy/CLI)

source: `C:\Users\USER\nenova-decompiled\Nenova\FormShipmentDistribution.cs`
verification: read-only decompile source and SQL structure inspection

## 견적 수정 품종 범위 재검증 (2026-08-26)

- 실제 dnSpy CLI의 `btnFix_Click/btnFixCancel_Click`은 `lueCountry.EditValue`를
  CountryFlower로 전달한다. CommonLogic의 이전/이후 확정 검사도 선택 품종 기준이다.
- 현재 운영 SP 정의를 SELECT로 재확인했다. 두 확정 SP는
  `ViewShipment.OrderYear=@OrderYear AND OrderWeek=@OrderWeek AND CountryFlower=@CountryFlower`
  로 대상을 고른다. 선택 품종 취소와 마지막 전 품목 스냅샷 계산은 다른 동작이다.
- 견적 자동 편집에서 빈 countryFlowers(전체)를 보내는 기존 코드/테스트는 이 근거와
  상충한다. 변경 ProdKey→Product.CountryFlower를 조회/재검증하고 한 품종씩 처리한다.
- 견적 편집 전용 요청은 한 품종 SP와 편집 기준값 갱신을 같은 트랜잭션에서 처리한다.
  중간 합산을 생략할 때는 성공한 요청의 WAIT_CALC/연도/차수/동작만 해제한다.
  전체 루프 끝에서 해제하면 두 번째 품종이 게이트를 기다리는 문제가 생긴다.
- 복구 대상은 이번 요청이 명시 성공으로 해제한 품종이다. 원래 미확정인 다른 품종과
  응답 불명 범위는 임의 재확정하지 않는다. 복구 실패는 별도로 보고한다.
- SP는 Product.Stock/StockHistory도 변경하므로 '플래그만 변경'이라고 설명하지 않는다.
  생략되는 것은 중간 usp_StockCalculation이다. 단가만 저장은 확정/재고/물량을 보존한다.
- 본 검증은 CLI 및 운영 SELECT만 수행했다. 운영 확정/취소/원장 저장은 하지 않았다.

## CLI verification record

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
$exe = 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& $cli --no-color -t FormShipmentDistribution $exe
```

The CLI output was inspected for `GetCustomerList`, `grdViewShipment_FocusedRowChanged`, `btnSave_Click`, `ShipmentFarm`, and `ShipmentDate`. This is a local decompile/read-only operation; no production write API or SQL write was executed.

## Farm save evidence

- `GetCustomerList`: `ViewOrder` joined with `ViewShipment` and `ShipmentDate`; no `ShipmentFarm` gate for the top customer list.
- `grdViewShipment_FocusedRowChanged`: `ViewWarehouse` grouped by `FarmName/OrderCode/ProdKey`, `Farm.FarmKey` lookup, and `ShipmentFarm` aggregation by `SdetailKey` for the farm grid.
- The farm candidate `ViewWarehouse` query is product-wide (`WHERE ProdKey=@pk`); it is not constrained by the selected shipment `OrderYear/OrderWeek`. The web GET, POST, and adjust transaction must share this exact scope.
- `btnSave_Click`: writes `ShipmentDetail` first. It inserts `ShipmentFarm` only when `dtFarm` has modified rows whose `FarmKey` is neither empty nor `0`, through `ClassShipmentFarm.Insert()`. Therefore an empty/unchanged farm grid is not a save blocker: a new shipment and an existing shipment with zero `ShipmentFarm` rows can both have their quantity saved without a farm assignment. When farm rows are explicitly edited, only valid `FarmKey` rows are inserted. It then updates/rebuilds `ShipmentDate` when quantity-unit columns change.
- `ClassShipmentFarm.Insert()`: `INSERT INTO ShipmentFarm (FarmKey, ShipmentQuantity, SdetailKey)`.
- `read-only`: no production write was performed while deriving this structure.

## 출고분배 엑셀 최종값·전체 되돌리기 계약 (2026-08-31)

- 엑셀 셀의 양수 수량은 증감값이 아니라 해당 `OrderYear + OrderWeek + CustKey + ProdKey`의 최종 분배수량이다. 기존 `ShipmentDetail.OutQuantity`에 더하지 않고 같은 값으로 맞춘다.
- 이 파일은 최종 분배표다. 숫자 0, 빈 셀, 파일 범위 안에서 빠진 품목행은 기존 주문등록값을 보존하고 `ShipmentDate`/`ShipmentFarm`과 분배상세만 제거해 분배를 0으로 맞춘다. 빈 셀과 빠진 행을 주문 취소로 해석하지 않는다.
- 빈 셀은 실제 업체×품목 pair 로 읽고, 품목행 자체가 삭제된 경우에는 export 시점 `_keymap`의 시트별 업체×품목 pair 로만 범위를 복원한다. 파일 범위 밖 거래처·품목은 0 처리하지 않는다.
- 주문과 분배는 한 트랜잭션에서 저장하고 커밋 전 `OrderDetail`, `ShipmentDetail`, `ShipmentDate` 합계를 함께 재조회한다. 확정행, 검증 이후 변경, 단위환산 실패 또는 사후 불일치가 한 건이라도 있으면 파일 전체를 중단한다.
- 전체 되돌리기는 웹 감사 기능이다. 적용 전후의 주문·분배·출고일·농장 상태를 불변 스냅샷으로 남기고, 현재 상태가 적용 직후 상태와 정확히 같을 때만 한 트랜잭션으로 복원한다. 이후 nenova.exe/웹 수정이 있으면 덮어쓰지 않고 전체를 중단한다. 기존 감사·OrderHistory·ShipmentHistory는 삭제하지 않는다.

## 견적서관리 02차 추가 품목등록 적용

웹의 추가 품목등록은 별도 Estimate 행을 만들지 않고 `FormShipmentDistribution.btnSave_Click`
경로를 따른다. 현재연도 `OrderWeek=NN-02`와 거래처·품목·검증된 `ShipmentDtm`을 업무키로
사용하며, 기존 활성 주문이 있으면 OrderDetail 수량은 보존하고 ShipmentDetail만 증가한다.
농장 입력은 사용자가 농장표를 명시적으로 수정할 때만 저장된다. 신규 출고 또는 기존에 `ShipmentFarm` 행이 없는 출고의 수량 변경 자체에는 FarmKey가 필수가 아니다. 웹의 명시적 농장배정 저장은 후보·합계 검증을 유지하되, 농장 입력을 생략한 수량 변경을 거부하지 않는다.

이 EXE 저장 사실은 차수피벗·붙여넣기 주문등록 분배의 수량 변경 계약에 적용한다.
견적서관리 추가 품목등록도 농장을 요구하지 않고 `ShipmentFarm`을 보존한다.
확정행은 화면에서 수량·단가·추가 품목을 한 번에 확정해제→저장→재확정하고 각 HTTP 쓰기는 SystemActionLog,
수량 변경은 ShipmentHistory에 기록한다. 기존 출고수량이 바뀌지 않으면 재확정 재고계산을 생략한다.
업체 단가 리스트와 참고단가는 금액만 적용하며 선택 업체를 바꾸지 않는다. 사용자가 출처 또는
직접입력을 명시하기 전에는 자동 확정하지 않는다.

모든 출고분배 GET/POST는 화면 차수에 포함된 연도 또는 별도 `year`를 명시한다. 짧은
`NN-NN`을 서버 현재연도로 보정하지 않는다. 입고 0/초과·음수잔량 경고의 `force`는 자동
일괄 작업이나 라움 이동에서 재시도하지 않으며, 경고 내용을 본 사용자가 단건 작업을 다시
확인한 경우에만 허용한다. 확정해제의 `force`와 재고부족 override는 서로 다른 계약이다.

## 붙여넣기 ADD 이월재고 검증 근거 (2026-08-10)

- `FormShipmentDistribution.GetProductList()`는 `GetBeforeOrderYearWeek(SelectOrderYearWeek)`로
  직전 결합키를 구하고 `StockMaster + ProductStock`의 같은 `ProdKey`에서
  `bs.Stock AS BeforeStock`을 읽는다.
- `usp_StockCalculation` 공식은 `PrevStock + 현차수 ViewWarehouse.OutQuantity
  - 현차수 ViewShipment.OutQuantity + 현차수 수동 StockHistory 조정`이다.
- 웹의 붙여넣기 ADD 사전검증은 쓰기 정책을 바꾸지 않고, 현재 `연도+차수` 결합키보다
  작은 최신 `ProductStock.Stock`을 이월재고로 더한다. `Product.Stock`이나 `isFix` 단독
  필터를 이 계산에 사용하지 않는다.
- 2025/2026에 같은 `OrderWeek`가 있어도 문자열 `OrderYear + REPLACE(OrderWeek,'-','')`
  전체를 비교하므로 현재 스냅샷과 전년도 동일 차수가 섞이지 않는다.
- 수량은 0.001 단위로 정규화해 부동소수점 꼬리와 미세 음수를 0으로 처리한다.
- 이 확인은 로컬 decompile 원문과 저장된 SP/View 근거의 읽기 전용 대조이며 운영 쓰기는
  수행하지 않았다.

## 잔량분배 게시판 예상물량(주문등록량) 원천 근거 (2026-08-11)

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
& $cli --no-color -t FormShipmentDistribution 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& $cli --no-color -t ClassOrderDetail 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

- `FormShipmentDistribution.GetCustomerList()`는 업체별 주문수량을
  `SELECT CustKey, SUM(OutQuantity) oOutQuantity ... FROM ViewOrder
   WHERE OrderYear=@year AND OrderWeek=@week AND CountryFlower=@cf
   GROUP BY OrderYear, OrderWeek, CustKey` 로 만든다. 즉 주문등록량의 단위 원천은
  `ViewOrder.OutQuantity` 단일값이며 Box/Bunch/Steam 합산이 아니다.
- `grdViewShipment_FocusedRowChanged()`의 품목 grid 는
  `vo.OutQuantity oOutQuantity`(주문)와 `ISNULL(vs.OutQuantity,0) sOutQuantity`(분배)를
  `vo.OrderYear = vs.OrderYear AND vo.OrderWeek = vs.OrderWeek AND vo.ProdKey = vs.ProdKey
   AND vo.CustKey = vs.CustKey` 네 키로 LEFT JOIN 한다.
- `ClassOrderDetail`의 INSERT/UPDATE 는 `BoxQuantity/BunchQuantity/SteamQuantity` 와 함께
  `OutQuantity`, `NoneOutQuantity` 를 실제 컬럼으로 기록한다. 따라서
  `OrderDetail.OutQuantity` 가 존재하며 `ShipmentDetail.OutQuantity` 와 같은 `OutUnit` 기준
  단일값이다.
- `ViewOrder` 정의(`docs/WEB_VS_ERP_CONFLICTS.md`)는 `om.isDeleted=0`, `od.isDeleted=0`,
  `Customer.isDeleted=0`, `Product.isDeleted=0` 을 포함한다. 웹 잔량분배 게시판의
  예상물량 조회는 `om.isDeleted=0`, `od.isDeleted=0`, `Product.isDeleted=0` 과
  `OrderYear + 대차수 prefix + CustKey + ProdKey` 를 동일하게 사용하고, `OutQuantity` 가
  NULL 인 레거시 행에서만 `OutUnit` CASE 로 대체한다. 거래처 활성 여부는 조회 때마다
  다시 조인하지 않고 업체그룹 저장 시 `Customer.isDeleted=0` 으로 검증한다. 현재분배
  조회도 같은 원칙으로 `sm.isDeleted=0` 과 양수 `sd.OutQuantity` 만 사용한다.
- 다만 `ViewOrder` 의 `UserInfo`/`Country` INNER JOIN(주문 담당자·국가 마스터 누락 시 EXE
  화면에서 주문이 사라지는 알려진 함정)은 이 게시판의 업무 범위가 아니라 별도 진단
  기능(`/api/shipment/item-trace` 의 ViewOrder 적격성)의 대상이므로 재현하지 않는다.
  게시판은 실제 등록된 주문을 숨기지 않고 그대로 예상물량으로 보여준다.
- 이 확인은 로컬 decompile 원문과 저장된 View 정의의 읽기 전용 대조이며 운영 주문·출고
  쓰기는 수행하지 않았다. 게시판의 '업체 최종분배'는 EXE 의 `isFix`/확정 상태와 무관한
  웹 전용 업무 수량이며 ERP 원장에 기록하지 않는다.

## 잔량분배 게시판 업체 식별 근거 — CustKey (2026-08-11)

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
& $cli --no-color -t FormShipmentDistribution 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
```

- `FormShipmentDistribution.GetCustomerList()` 는 업체를 `ViewOrder ... GROUP BY OrderYear,
  OrderWeek, CustKey` 로 묶고, `grdViewShipment_FocusedRowChanged()` 의 주문↔분배 LEFT JOIN 도
  `vo.CustKey = vs.CustKey` 를 키로 쓴다. EXE 어디에서도 거래처를 `CustName` 문자열로 매칭하지
  않는다. 따라서 웹 게시판도 `WebShillaMiuBoardGroup.BaseCustKey/ReceiverCustKey` 만으로
  ERP 를 읽고, 이름 `LIKE` 매칭으로 되돌리지 않는다.
- `Customer` 마스터에는 이름이 비슷하지만 원장 실적이 전혀 없는 껍데기 코드가 존재한다
  (읽기 전용 확인: `신라상사`/`신라상사2` 는 `OrderMaster`·`ShipmentMaster` 생애 0건,
  실제 신라 거래처는 `신라호텔` `OrderCode='CLS'`, `Descr='신라/중-화/네-화/CLS'`).
  그룹 자동 seed 는 이름이 유일한 것만으로 부족하고 `OrderMaster` 실적 존재까지 확인한다.
- 이 확인은 로컬 decompile 원문과 운영 DB 의 읽기 전용 `SELECT` 대조이며, 주문·출고·재고·
  견적 원장에 대한 쓰기는 수행하지 않았다. 복구 대상은 웹 전용
  `WebShillaMiuBoardGroup` 한 테이블뿐이다.

## 붙여넣기 명시 단위 환산 근거 (2026-08-10)

- `FormOrderAdd.GetDataProduct()`는 `OutUnit`, `OrderBox/OrderBunch/OrderSteam`,
  `BunchOf1Box`, `SteamOf1Bunch`, `SteamOf1Box`를 함께 조회한다.
- 수량 셀 변경 시 입력한 Box/Bunch/Steam 열을 기준으로 나머지 수량을 환산하고,
  저장 시 세 수량을 모두 기록한 뒤 `UnitQuantity(true, row)`가 `OutUnit`에 해당하는
  값을 `OutQuantity`로 선택한다.
- 따라서 웹도 `1박스`라는 명시 입력을 먼저 BoxQuantity=1로 보존하고 마스터 환산값으로
  Bunch/Steam을 만든 뒤 `OutUnit='단'`이면 BunchQuantity를 OutQuantity로 저장해야 한다.
- 마스터 환산값이 0/NULL인 상태에서 1로 추정하면 전산의 세 수량 구조와 달라지므로
  조용한 fallback 없이 오류로 차단한다.
- 이 근거 확인은 로컬 dnSpy decompile 원문의 읽기 전용 검토이며 운영 주문·출고 쓰기는
  수행하지 않았다.

## 출고확정 잔량 검사 근거 (2026-08-20)

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
$exe = 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& $cli --no-color -t FormShipmentDistribution $exe
```

- `btnFix_Click`(`FormShipmentDistribution.cs:990`)는 C#에서 음수재고를 계산하지 않는다.
  `CheckFixSave` 통과 후 `uspShipmentFix(SelectOrderYear, SelectOrderWeek, countryFlower)`를
  호출하고, 반환 메시지 `text`를 `XtraMessageBox.Show(text, "확정 실패")`로 그대로 보여 준다.
- 패치 전 `usp_ShipmentFix`는 당주차 `ProductStock.Stock - 미확정 OutQuantity`를
  `ROUND(...,0) < 0`으로 막았다. `usp_StockCalculation` leftover는 확정출고(`DetailFix=1`)만
  빼므로, 확정취소 후 재계산이 빠지면 스냅샷이 이미 출고를 뺀 기말로 남아 이중차감이 된다.
- `btnFixCancel_Click`(`:1070`)는 `uspShipmentFixCancel` 후 **별도 연결**로
  `uspStockCalculation(year, week, 0)`를 호출한다. 취소 커밋과 재계산이 한 트랜잭션이 아니라서
  재계산 실패/타임아웃 시에도 확정취소는 남는다.
- 2026-08-20 운영 읽기 전용 probe: 2026 `33-01` 콜롬비아카네이션 미확정 53 SKU,
  옛 검사 음수 52건, leftover−미확정 음수 0건(Zurigo `ROUND(-0.33,0)=0`).
- 재발 방지로 SP 잔량 검사만 leftover 공식으로 바꿨다. dnSpy/WinForms 패치는 하지 않는다.
  `@oMessage` 문구 `제품 잔량이 마이너스인 출고 정보가 존재합니다.` 는 EXE UI 호환을 위해 유지한다.
- 직전 스냅샷 키는 `StockMaster.OrderYearWeek < 현재 OrderYearWeek` 최신 1건이다.
  `OrderWeek` 단독으로 전년도 동일 차수를 이월로 쓰지 않는다.
- 이 확인은 로컬 decompile 원문과 운영 SP 정의의 읽기 전용 대조이며, 주문·출고 수량 원장
  쓰기는 수행하지 않았다. SP 정의 ALTER는 별도 마이그레이션으로 적용한다.

## 확정취소 다음차수 가드·재고게이트 (2026-08-23)

```powershell
$cli = 'C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe'
$exe = 'C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe'
& $cli --no-color -t CommonLogic $exe
& $cli --no-color -t FormShipmentDistribution $exe
```

- `CheckFixCancel`(`CommonLogic.cs:450`)은 `GetNextOrderYearWeek`로 **다음 `StockMaster.OrderYearWeek` 1건**만 고른 뒤,
  `GetProductFixStatus(nextOrderYearWeek, countryFlower, isFix=1)`로 `ViewShipment.DetailFix=1` 품목을 센다.
  1개라도 있으면 `"다음차수에 확정된 제품이 N개 존재합니다. 다음차수 확정 취소 후 시도해주세요."` 로 막는다.
  `StockMaster.isFix`와 `force` 우회는 없다.
- `GetNextOrderYearWeek`는 `StockMaster.OrderYearWeek > 현재` 오름차순 1건이다. `OrderWeek` 문자열 비교나 같은 연도만 보지 않는다.
- `btnFixCancel_Click`는 이 가드 통과 후 `uspShipmentFixCancel`을 호출하고, **별도 연결**로 `uspStockCalculation(year, week, 0)`을 호출한다.
  취소 커밋과 재계산은 한 트랜잭션이 아니다.
- 웹·EXE 재발을 막기 위해 `usp_ShipmentFix` / `usp_ShipmentFixCancel` / `usp_StockCalculation` 시작·종료에
  `NenovaStockWeekGate`를 넣는다. 취소 성공 후에는 `WAIT_CALC`로 다음 FIX/CANCEL을 재계산 완료까지 대기시킨다.
  취소 SP 안에 재계산을 중첩하지 않는다. 고정 `WAITFOR DELAY`는 쓰지 않는다.
- 웹 확정취소 API는 위 CheckFixCancel과 같은 `ViewShipment.DetailFix` 가드를 쓰고, `body.force`로 우회하지 않는다.
  재계산이 실패하면 취소를 성공으로 응답하지 않는다. 견적 `skipStockCalc` 중간 단계는 게이트를 비운다.
- 이 확인은 로컬 decompile 원문의 읽기 전용 대조이며, dnSpy/WinForms 패치는 하지 않는다.

## 사용자 승인 구조 변경: 기존 출고수량은 확정 유지 (2026-08-26)

`dnSpy.Console.exe --no-color -t Nenova.FormShipmentDistribution Nenova.exe`를 다시 실행하고
운영 `sys.sql_modules`의 `usp_ShipmentFixCancel`, `usp_ShipmentFix`,
`usp_StockCalculation` 정의를 SELECT로 대조했다. EXE 자체가 빠른 경로를 제공한다는
뜻이 아니며, 사용자가 승인한 웹의 저장 순서 변경이다.

- native Cancel은 기존 확정 출고를 `Product.Stock`에 더하고 Fix는 새 확정 출고를 뺀다.
  따라서 확정 출고 old→new의 순효과는 old-new이다. 웹의 기존 출고 수정은 이 결과를
  한 트랜잭션에서 반영하고 원래 Master/Detail의 확정 플래그를 유지한다.
- native Fix의 부족 검사는 증가/감소를 구별하지 않는다. 감소까지 Fix를 다시 호출하면
  불필요한 부족 검사와 전체 품종군 확정 사이클 문제가 남으므로 기존 출고 수정에서는
  Fix/Cancel 대신 잠금 조회한 실제 증가분에만 부족 검사를 실행한다.
- `usp_StockCalculation`은 확정 출고만 소비하며 `ProductStock`을 갱신하고
  `Product.Stock`은 갱신하지 않는다. 웹은 이 둘을 구분하여 변경 품목만 계산하고,
  출고 수량과 같은 트랜잭션에서 실패 시 전부 롤백한다.
- native 출고 이력 분류 `출고`는 운영 `CodeInfo.Category='StockType'`에 포함되지
  않음을 확인했다. 수량 변경을 `재고조정`으로 기록해 계산에 이중 가산하지 않는다.
- 운영 정의에서 Native CATCH가 전체 rollback 뒤 GateLeave를 호출함을 확인했다.
  따라서 새 경로는 획득별 토큰과 연결 소유자를 확인하는 잠금 계약이 설치돼야만
  실행한다. 단순 경과시간으로 실행 중 잠금을 회수하거나 다른 작업의 잠금을 지우지 않는다.
- 이 작업에서 운영 고객 자료를 수정하거나 이미 부분 해제된 차수를 복구하지 않았다.
  격리된 SQL 시험 결과와 운영 적용 여부는 별도 작업 보고서에 기록한다.
