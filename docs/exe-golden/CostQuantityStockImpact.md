# 단가·수량 수정이 재고·경고에 미치는 영향 (dnSpy 근거)

조사 목적: "단가 수정은 수량 변경이 없으니 재고에 문제가 없다"는 가설을 `nenova.exe`
실제 구현으로 검증하고, 품목·수량·단가 입력 시 DB에 저장되는 파생값과 버튼별 경고를 고정한다.

## 0. 근거 출처

- exe 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile 소스: `C:\Users\USER\nenova-decompiled\Nenova`
- 대상: `FormShipmentDistribution`, `FormEstimateView`, `ClassShipmentDate`,
  `ClassShipmentDetail`, `CommonLogic`, `DBMSSQL`
- 조사일: 2026-08-19 / 읽기 전용

## 1. 결론: 가설은 원장 수준에서 맞다

`usp_StockCalculation`을 호출하는 지점은 EXE 전체에서 아래뿐이고, **저장(btnSave) 경로에는 없다.**

| 호출 위치 | 트리거 |
|---|---|
| `FormShipmentDistribution.cs:1034` | `btnFix_Click` (확정) |
| `FormShipmentDistribution.cs:1091` | `btnFixCancel_Click` (확정취소) |
| `FormOrderAdd.cs:981` | 주문 저장 |
| `FormWarehouseAdd.cs:163`, `FormWarehouseView.cs:223,344` | 입고 등록·삭제 |
| `FormStockAdd.cs:157` | 재고조정 |
| `ExcelLoadingPackingList.cs:355` | 패킹리스트 로딩 |

`FormEstimateView`(견적서관리)는 `usp_StockCalculation`을 **한 번도 호출하지 않는다.**

결정적 증거는 `FormShipmentDistribution.btnSave_Click`이 수량 변경 여부로 분기하는 부분이다.

```
// FormShipmentDistribution.cs:1235-1263
string[] array = { "sBoxQuantity", "sBunchQuantity", "sSteamQuantity" };
bool flag6 = array.Any(c => !Equals(dr[c, Original], dr[c, Current]));
if (flag6) {                       // 수량이 바뀌면
    list.Add(classShipmentDate.Delete());   // ShipmentDate 전체 삭제
    list.Add(classShipmentDate.Insert());   // 재생성
} else {                           // 수량이 그대로면 = 단가만 바뀐 경우
    list.Add(new ClassShipmentDate {
        SdetailKey = classShipmentDetail.SdetailKey,
        Cost = classShipmentDetail.Cost
    }.UpdateCost());               // Cost/Amount/Vat 만 UPDATE
}
```

즉 EXE도 "수량 미변경 = 단가만 변경"을 별도 경량 경로로 구분하며, 그 경로는
`ShipmentDate` 행을 재생성하지 않고 재고 재계산도 하지 않는다. **단가는 재고 수치에
전혀 관여하지 않는다**는 것이 EXE 구현으로 확인된다.

### 1-1. 다만 EXE에는 "확정차수 단가수정" 정식 경로가 없다

- `FormEstimateView`의 단가 컬럼은 편집 불가다.
  `FormEstimateView.Designer.cs:734` → `gridColumn6.OptionsColumn.AllowEdit = false`
  (`gridColumn6.FieldName = "Cost"`, Caption `단가`)
- `FormShipmentDistribution`은 확정되면 저장 버튼을 잠근다.

```
// FormShipmentDistribution.cs:161-175
private void SetButton(bool enable) {      // enable = isFix
    bool flag = this.rankType != "A";
    if (flag) { enable = false; }
    this.btnFix.Enabled = !enable;
    this.btnFixCancel.Enabled = enable;
    this.btnDistribution.Enabled = !enable;
    this.btnDistributionTotal.Enabled = !enable;
    this.btnClear.Enabled = !enable;
    this.btnSave.Enabled = !enable;
    this.btnShowHistory.Enabled = true;
}
```

따라서 EXE에서 확정차수 단가를 고치려면 `btnFixCancel` → 수정 → `btnFix` 순서이며,
확정취소와 재확정은 **각각 무조건** `usp_StockCalculation`을 동반한다.
단가가 재고에 무관해서가 아니라, 확정/해제 자체가 원장 전체를 다루는 굵은 연산이기 때문이다.

주의할 quirk 2건 (설계 계약이 아니라 EXE의 허점이므로 웹이 모방하지 말 것):

- `rankType != "A"`이면 `enable = false`로 덮여 **확정차수에서도 `btnSave`가 열린다.**
- `btnSave_Click`에는 `CheckFixSave`나 `isFix` 검사가 없다(`:1174-1188`). 확정차수 보호는
  버튼 활성화라는 UI 레벨에만 존재한다.

### 1-2. EXE가 확정차수를 해제 없이 저장하는 유일한 경우

`FormEstimateView`는 `DetailFix = 1`(확정된) 행만 조회하고(`:245`), 저장 시
`ShipmentDate`의 `EstQuantity/Amount/Vat/Descr`만 갱신한다(`:658-668`).
확정취소도, 재고계산도 없다. 이것이 허용되는 이유는 저장 직전에 **품목 합계 불변**을
강제하기 때문이다.

```
// FormEstimateView.cs:625-648  (ProdKey별 그룹)
decimal num  = grouping.Sum(r => r["EstQuantity"]);
decimal num2 = grouping.First()["TotalQuantity"];
if (num != num2) {
    XtraMessageBox.Show(string.Format(
      "출고 수량과 견적 수량이 맞지 않습니다. (품목명:{0}({1}/{2}))", arg, num, num2), "작업 오류", ...);
    return;                                  // 차단
}
```

정리하면 EXE의 실제 규칙은 다음과 같다.

| 편집 성격 | 총수량 | 확정해제 | 재고 재계산 |
|---|---|---|---|
| 견적수량을 출고일 사이로 재배분 | 불변(강제 검증) | 불필요 | 없음 |
| 단가만 변경 | 불변 | (확정차수면 UI가 차단) | 저장 경로에 없음 |
| 출고수량 변경 | 변동 | 필요 | 확정/해제마다 |

## 2. 품목·수량·단가 입력 시 저장되는 값

### 2-1. ShipmentDetail (출고분배 저장 — `FormShipmentDistribution.btnSave_Click`)

| 컬럼 | 값 / 수식 | 근거 |
|---|---|---|
| `SdetailKey` | 신규는 `GetNextKey("ShipmentDetailKey")` | `:1201` |
| `ProdKey` | 그리드 품목 | `:1202` |
| `ShipmentDtm` | `GetShipmentDate(OrderYear, OrderWeek, GetBaseOutDay(CustKey))` | `:1203-1204` |
| `BoxQuantity` / `BunchQuantity` / `SteamQuantity` | 그리드 입력 3종(상호 환산됨) | `:1205-1207` |
| `OutQuantity` | `Product.OutUnit`이 가리키는 1개 값 | `:1208`, `:780-795` |
| `EstQuantity` | `Product.EstUnit`이 가리키는 1개 값 | `:1209`, `:797-812` |
| `Cost` | `ISNULL(ViewShipment.Cost, ISNULL(CustomerProdCost.Cost, 0))` | `:1210`, SQL `:304-318` |
| `Amount` | `Round(Cost * Round(EstQuantity, 0) / 1.1, 0)` | `:1211` |
| `Vat` | `Cost * Round(EstQuantity, 0) - Amount` | `:1212` |
| `isFix` | 설정 안 함 → `false`. 확정은 `usp_ShipmentFix`만 | C# 기본값 |
| `Descr` | `FarmCode:수량/FarmCode:수량` 문자열 | `:1213`, `:1147-1170` |
| `ShipmentKey` | `GetShipmentMaster(CustKey)` | `:1214` |

`Cost`는 **부가세 포함 단가**다. `Amount + Vat = Cost × Round(EstQuantity, 0)`이 항등식으로
성립하며, `Vat`을 나눗셈이 아니라 차감으로 구하기 때문에 합계 오차가 생기지 않는다.

### 2-2. ShipmentDate (출고일별 원장)

`ClassShipmentDate`의 SQL은 4종이고 WHERE 키가 서로 다르다.

| 메서드 | 컬럼 | WHERE | 호출 지점 |
|---|---|---|---|
| `Insert()` | `ShipmentDtm, ShipmentQuantity, EstQuantity, Cost, Amount, Vat, Descr, SdetailKey` | — | 수량 변경 시 |
| `Update()` | `EstQuantity, Amount, Vat, Descr` | `SdateKey` | 견적서관리 저장 |
| `UpdateCost()` | `Cost, Amount, Vat` | **`SdetailKey`** | 단가만 변경 시 |
| `Delete()` | — | `SdetailKey` | 수량 변경 시 |

`UpdateCost()`는 WHERE가 `SdetailKey`이므로 **해당 출고상세의 모든 출고일 행에 같은 단가를
일괄 적용**하고, 금액은 각 행의 자기 `EstQuantity`로 다시 계산한다.

```
-- ClassShipmentDate.cs:183-192
UPDATE ShipmentDate
   SET Cost   = @Cost
      ,Amount = ROUND((@Cost * ROUND(EstQuantity,0)) / 1.1, 0)
      ,Vat    = (@Cost * ROUND(EstQuantity,0))
              - ROUND((@Cost * ROUND(EstQuantity,0)) / 1.1, 0)
 WHERE SdetailKey = @SdetailKey
```

### 2-3. 수량 환산 (Product 계수)

`BunchOf1Box`, `SteamOf1Bunch`, `SteamOf1Box`로 3종 수량이 서로 파생된다
(`FormShipmentDistribution.cs:717-816`).

| 입력한 칸 | 파생 |
|---|---|
| 박스 | `단 = 박스 × BunchOf1Box`, `송이 = 단 × SteamOf1Bunch` 또는 `박스 × SteamOf1Box` |
| 단 | `박스 = 단 ÷ BunchOf1Box`, `송이 = 단 × SteamOf1Bunch` |
| 송이 | `단 = 송이 ÷ SteamOf1Bunch`, `박스 = 단 ÷ BunchOf1Box` 또는 `송이 ÷ SteamOf1Box` |

`OutQuantity`는 `OutUnit`, `EstQuantity`는 `EstUnit`이 지목하는 값을 **그중 하나만** 취한다.
합산하지 않는다. 두 단위가 다르면 두 값이 정상적으로 달라진다.

`ShipmentDtm` 기본값은 `Customer.BaseOutDay`(0이면 4=목요일)로
`PeriodDay.BaseYmd where OrderYearWeek = OrderYear + LEFT(OrderWeek,2) and WeekDay = BaseOutDay`를 읽는다
(`CommonLogic.cs:327-371`).

## 3. 버튼별 영향과 경고

### 3-1. 출고분배 (`FormShipmentDistribution`)

| 버튼 | 쓰는 테이블 | 재고 재계산 | 주요 차단 경고 |
|---|---|---|---|
| `btnSave` | `ShipmentDetail`, `ShipmentFarm`, `ShipmentDate` | 없음 | (없음 — 확정 시 버튼만 잠김) |
| `btnFix` | `usp_ShipmentFix` | **있음** | `등록하지 않은 수정된 내용이 있습니다. 저장 후 시도해주세요.` / `확정할 수 있는 데이터가 없습니다.` / `CheckFixSave` 결과 |
| `btnFixCancel` | `usp_ShipmentFixCancel` | **있음** | `CheckFixCancel` 결과 |
| `btnDistribution` / `btnDistributionTotal` | 분배 SP | 없음 | `등록하지 않은 수정된 내용이 있습니다.` / `기존에 입력된 분배 및 출고일 지정 정보가 사라집니다.` |
| `btnClear` | 초기화 SP | 없음 | `기존에 입력된 분배 및 출고일 지정 정보가 사라집니다.` |

확정 가드 문구는 모두 `CommonLogic.cs:395-471`에서 만들어진다.

| 문구 | 조건 |
|---|---|
| `이미 확정된 차수는 등록할 수 없습니다.` | 현재 차수에 `DetailFix=1`이 있고 `isCheck=true` |
| `전차수에 확정되지 않은 제품이 {n}개 존재합니다. 전차수 확정 후 시도해주세요.` | `GetBeforeOrderYearWeek`에 미확정 존재 |
| `다음차수에 확정된 제품이 {n}개 존재합니다. 다음차수 확정 취소 후 시도해주세요.` | `GetNextOrderYearWeek`에 확정 존재 (확정·확정취소 양쪽) |

음수재고 경고는 EXE C# 코드에 문자열이 없다. `usp_ShipmentFix`의 반환 메시지가
`XtraMessageBox.Show(text, "확정 실패")`(`:1056`)로 그대로 표시된다.

### 3-2. 견적서관리 (`FormEstimateView`)

| 항목 | 상태 | 근거 |
|---|---|---|
| 수량(`EstQuantity`) | 편집 가능 (`Sort=0` 행만) | Designer 기본값, `grdViewEstimate_ShowingEditor:899-907` |
| 비고(`Descr`) | 편집 가능 | 동일 |
| 단가(`Cost`) | **편집 불가** | `Designer.cs:734` |

| 버튼 | 동작 | 차단 경고 |
|---|---|---|
| `btnSave` | `ShipmentDate.Update()`만 | `출고 수량과 견적 수량이 맞지 않습니다. (품목명:X(a/b))` |
| 불량/검역 수정·삭제 | `Estimate` 테이블 | `견적서 불량/검역 내용만 수정가능합니다.` / `…삭제가능합니다.` |
| `btnPrint` / `btnExcel` | 읽기 | `선택된 견적서 내용이 없습니다.` |

## 4. 웹 구현과의 차이

### 4-1. 확정차수 단가수정 사이클 (성능 이슈의 실체)

웹은 확정차수 단가수정을 `확정해제 → 저장 → 재확정`으로 처리하고
(`docs/contracts/estimate-cost-update.json`), 클라이언트는 수량 불변임을 알고
`lightStock: true` → `skipStockCalc: true`를 보낸다. 그러나 서버가 이를 버린다.

```
// pages/api/shipment/fix.js:669, :975
const skipStockCalc = false;
```

이 고정은 실수가 아니라 2026-08-13 `7e8fc9c "fix: close stock confirmation bypasses"`에서
의도적으로 잠근 것이다. 같은 커밋에
`scripts/repair-confirmed-negative-stock-from-31-01.mjs`가 포함되어 있어 31-01 확정 음수재고
실사고 후속 조치였음을 알 수 있다. 사유는 코드 주석에 남아 있다: 브라우저가 수정 도중
닫히거나 연속 호출이 실패하면 `Product.Stock`과 `ProductStock`이 영구 불일치한다.
`__tests__/estimateFixCycle.test.js:45`가 재도입을 막는다.

→ 그러므로 "재고 재계산을 생략해 빠르게 만들자"는 방향은 EXE 근거로도, 사고 이력으로도
정당화되지 않는다. EXE 근거가 지지하는 방향은 다르다: **총수량이 변하지 않는 편집은
애초에 확정해제 사이클을 타지 않는다**(§1-2). 지연을 없애려면 사이클 내부를 가볍게 하는
대신, 단가·재배분 편집을 사이클 밖으로 빼는 설계를 검토해야 한다. 단 웹의 단가수정은
EXE에 정식 대응 화면이 없는 웹 확장 기능이므로, 확정 원장을 해제 없이 쓰려면 별도 계약과
음수재고·견적 노출 검증이 선행되어야 한다.

### 4-2. 부가세 반올림 방식 차이 — 이론상 존재, 실데이터 영향 3건

| | Amount | Vat |
|---|---|---|
| EXE | `Round(Cost × Round(EstQuantity,0) / 1.1, 0)` | `Cost × Round(EstQuantity,0) − Amount` |
| 웹 | `Math.round(qty × cost / 1.1)` | `Math.round(qty × cost / 11)` |

1. **수량 반올림 시점**: EXE는 `Round(EstQuantity, 0)`으로 수량을 먼저 정수화한 뒤 곱한다.
   웹은 `qty`를 그대로 곱한다. C# `Math.Round`는 banker's rounding(`2.5 → 2`),
   JS `Math.round`는 half-up(`2.5 → 3`)이라 소수 수량에서 갈릴 수 있다.
2. **Vat 산출**: EXE는 차감이라 `Amount + Vat = Cost × 수량`이 항상 성립한다. 웹은 별도
   나눗셈이다. `t = qty × cost`가 정수인 한 `Round(10t/11) + Round(t/11) = t`가 성립하므로
   (`frac(10t/11) = 0.5`는 `20t = 22k + 11`이 되어 불가능) 정수 구간에서는 합계가 일치한다.

읽기 전용 probe(`scripts/probe-cost-vat-rounding-parity.mjs`, `OrderYear >= 2025`) 결과:

| 항목 | 값 |
|---|---|
| 소수 `EstQuantity` (ShipmentDetail) | 55,122행 중 **59행** |
| 소수 `EstQuantity` (ShipmentDate) | 27,159행 중 **3행** |
| `Amount ≠ ROUND((Amount+Vat)/1.1, 0)` = 순수 반올림 규약 차이 | 54,895행 중 **3행** (건당 1원, 2026 23-01 주광농원) |

→ 체계적 불일치가 아니다. 그 3행은 EXE식도 웹식도 아닌 내림값이라 과거 다른 경로의
잔재로 보인다. **확정 매출 소급 재계산은 3행·약 3원을 위해 원장을 건드리는 것이므로
비례하지 않는다.** 새 쓰기만 `Vat = 총액 − Amount`로 맞춰 향후 드리프트를 막는 편이 안전하다.

`1 ≤ 총액 ≤ 200,000` 전수 확인 결과 **정수 총액에서는 두 수식이 단 한 건도 갈리지 않는다.**
드리프트는 소수 `EstQuantity`(분수 박스, 예 `155송이 ÷ 30 = 5.17`)에서만 발생한다.
probe가 확정 54,895행 중 3행만 잡은 이유가 이것이고, 그 3행이 §4-2 표의 소수 수량 3행과
같은 모집단이다.

**적용한 조치 (새 쓰기 한정, 원장 재계산 없음)**: `Estimate` 쓰기 4개 경로와 불량차감 모달
미리보기를 공용 헬퍼 `lib/distributeUnits.js#amountVatFromCostEst`로 통일했다.

| 파일 | 이전 | 이후 |
|---|---|---|
| `pages/api/estimate/index.js` (INSERT) | `Math.round(gross/11)` | `amountVatFromCostEst` |
| `pages/api/estimate/update-cost.js` | 동일 | 동일 |
| `pages/api/estimate/update-quantity.js` | 동일 | 동일 |
| `pages/api/estimate/update-entry.js` | 동일 | 동일 |
| `pages/estimate.js` (모달 미리보기) | 동일 | 동일 |

`Amount` 산출식은 바뀌지 않았고 `Vat`만 차감으로 바뀌었으므로 정수 수량 행의 저장값은
이전과 완전히 동일하다. `__tests__/estimateAmountVatParity.test.js`가 `Amount + Vat = 총액`
항등식(음수 수량 포함)과 위 5개 경로의 헬퍼 사용을 고정한다.

### 4-3. `EstQuantity`와 금액 기준 수량이 다른 행은 정상이다

같은 probe에서 확정행 54,244건 중 **23,143건**이
`Amount + Vat ≠ Cost × Round(EstQuantity, 0)`이었다. 이는 오류가 아니다.
박스로 출고하지만 단/송이 단가를 쓰는 품목(카네이션·수국·미니카네이션 등)에서
`EstQuantity`는 1(박스)이고 금액은 15·25·30 기준으로 잡힌다.

실측 예: `MiniCarnation 피치` `Cost=6,100`, `EstQuantity=1`, `Amount+Vat=183,000`
→ `183,000 ÷ 6,100 = 30`. 금액 기준 수량은 30이다.

→ 따라서 `Cost × EstQuantity`로 저장 금액을 검증하거나 보정하는 코드·probe를 만들면
23,143행을 오탐한다. 루트 `CLAUDE.md`의 "EstQuantity = OutQuantity 일괄 보정 금지"와 같은 함정이다.

### 4-4. 확정 SP는 금액을 되돌리지 않는다

`OBJECT_DEFINITION`으로 확인한 실제 SP 본문(`.agent_tmp/sp-defs/*.sql`, git 미추적):

| SP | 쓰는 대상 | `Cost/Amount/Vat` 대입 |
|---|---|---|
| `usp_ShipmentFix` | `ShipmentDetail.isFix`, `ShipmentMaster.isFix`, `Product.Stock`, 이력 | **없음** |
| `usp_ShipmentFixCancel` | 동일 역방향 | **없음** |
| `usp_StockCalculation` | 재고 스냅샷 | **없음** |

`usp_ShipmentFix`의 차단 메시지 원문도 확보했다.

- `제품 잔량이 마이너스인 출고 정보가 존재합니다.`
- `출고수량과 출고일 지정 수량이 다른 항목이 존재합니다.`

이 두 문구가 EXE에서 `XtraMessageBox.Show(text, "확정 실패")`로 표시되는 실체다(§3-1).

웹의 `pages/api/shipment/fix.js`도 `Amount`/`Vat` 문자열을 아예 포함하지 않는다.

→ 그러므로 `pages/api/estimate/update-cost.js:164-171`의 주석이 적은 사유
("확정된 차수에 단가가 일단 저장됐다가 재확정 시점에 값이 되돌아가는 문제")는
**현재 코드베이스의 SP·fix API로는 재현되지 않는다.** 당시 다른 코드 상태였을 수 있으므로
`FIXED_WEEK` 가드를 근거 없이 해제하지 않는다. 해제하려면 되돌림을 재현하거나
불가능함을 증명하고, 계약·테스트를 함께 갱신해야 한다.

## 5. 금지 사항

- 클라이언트 신호로 `skipStockCalc`를 되살리지 않는다(§4-1).
- `FormEstimateView`가 단가를 못 고친다는 이유로 웹 단가수정 기능을 제거하지 않는다.
  웹 확장 기능이며 계약(`docs/contracts/estimate-cost-update.json`)이 존재한다.
- `rankType != "A"`일 때 확정차수 저장이 열리는 EXE quirk를 웹이 모방하지 않는다.
- `Cost × EstQuantity`로 확정 금액을 검증·보정하지 않는다(§4-3).
- 3행짜리 반올림 차이를 이유로 확정 매출을 소급 재계산하지 않는다(§4-2).
- `update-cost.js`의 `FIXED_WEEK` 가드를 재현 근거 없이 해제하지 않는다(§4-4).
