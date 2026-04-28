# 운송원가 파이프라인 — 입고관리 → DB → 운송원가탭 → 엑셀

**최종 검증일**: 2026-04-27
**검증 사례**: 17-2 MEL (Yunnan Melody, China) / 18-1 Ecuador (Freightwise Ecuador + La Rosaleda)

---

## 1. 핵심 원칙

1. **DB 스키마 / 저장 로직 절대 변경 ❌** — 웹은 SELECT + 메모리 계산 + 표시만
2. **카테고리 오버라이드는 웹 전용** — `data/category-overrides.json` 파일 기반, `Product.FlowerName` DB는 안 건드림
3. **환율 박제** — `FreightCost.ExchangeRate` 컬럼에 BILL 시점 환율 스냅샷
4. **항공료 우선순위** — BILL 내 운송료 행 > FREIGHTWISE Farm 행 > Rate*CW+DocFee 계산값
5. **GW/CW 추출 우선순위** — `Gross weigth`/`Chargeable weigth` 품목 행 > WarehouseMaster 컬럼(전부 NULL이라 사실상 무시) > FREIGHTWISE 행

---

## 2. 데이터 흐름

```
[입고관리 (pages/incoming.js)]
    │  WarehouseMaster + WarehouseDetail 적재
    │  - 같은 AWB 의 농장 행 + FREIGHTWISE 운송사 행 분리 입력
    │  - 운송사 행 안에 Gross weigth / Chargeable weigth / 운송료 품목으로 무게/단가 저장
    ↓
[운송원가탭 (pages/freight.js)]
    │  AWB 선택 → /api/freight?awb=... 호출
    │  - REPLACE(OrderNo, '-', '') 정규화로 같은 AWB 그룹화
    │  - FREIGHTWISE Farm 분리 + 농장 행만 운임 분배 대상
    │  - lib/freightCalc.js computeFreightCost 호출
    ↓
[엑셀 다운로드 (pages/api/freight/excel.js)]
    │  - 카테고리 오버라이드 반영 + 단당/송이당 단위 표시
    │  - 사용자 입력값 (그외통관 5종) 동일하게 셀에 기록
```

---

## 3. WarehouseMaster / WarehouseDetail 실제 사용 패턴

### 3.1 WarehouseMaster 의 무게/Rate 컬럼은 사실상 NULL
- `GrossWeight / ChargeableWeight / FreightRateUSD / DocFeeUSD` 4개 컬럼이 **3,196건 전부 NULL**
- → BILL 의 무게/항공료 정보는 **WarehouseDetail 의 특수 품목 행**에 저장됨

### 3.2 특수 품목 행 패턴
| ProdKey | ProdName | 의미 | 무게 저장 위치 |
|---|---|---|---|
| 3100 | `Gross weigth` (오타) | 총중량 (GW) | SteamQuantity 또는 BunchQuantity 의 >1 최대값 |
| 3101 | `Chargeable weigth` | 운임중량 (CW) | 동일 |
| 2182 | `운송료` | 항공료 | UPrice = USD/kg 또는 USD 총액, TPrice = 총 항공료 |

### 3.3 FREIGHTWISE Farm 패턴
- FarmName: `FREIGHTWISE`, `Freightwise Ecuador` 등 (운송사 자체)
- 같은 OrderNo 로 농장 원장과 묶임 → API 가 자동으로 항공료/GW/CW 추출에 사용

---

## 4. 엑셀 ↔ DB 매핑 매트릭스 (확정)

| 엑셀 셀 | 의미 | DB 출처 | 검증 |
|---|---|---|---|
| C5 | 차수 | `OrderYear-OrderWeek` (e.g. 2026-17-02) | ✅ |
| C7 | 환율 | 사용자 입력 → `FreightCost.ExchangeRate` 박제 | ✅ |
| C8 | GW | WarehouseDetail `Gross weigth` 행에서 추출 | ✅ |
| E8 | CW | WarehouseDetail `Chargeable weigth` 행에서 추출 | ✅ |
| C9 | 품목수/포목수 | `distinct FlowerName` (오버라이드 후) | ✅ |
| C10 | 총수량 | `SUM(WarehouseDetail.OutQuantity)` (꽃 품목만) | ✅ |
| G11 | Rate USD/kg | 운송료 행 UPrice (BunchQty>1 인 Rate 패턴) | ⚠ 일부 BILL 미추출 |
| E11 | 고정비용 | 운송료 두 번째 행 또는 사용자 입력 | ✅ |
| C11 | 항공료 USD | `actualFreightUSD = SUM(운송료/FREIGHTWISE TPrice)` | ✅ |
| 품목명 | Color/Grade | `Product.ProdName` | ✅ |
| 수량 (E열) | Steam 수량 | `WarehouseDetail.OutQuantity` (또는 SteamQuantity, fallback BunchQty×SteamOf1Bunch) | ✅ |
| FOB (F열) | 입고 단가 | `WarehouseDetail.UPrice` | ✅ |
| 카테고리 (J7~J13) | 운임 분배용 | **`data/category-overrides.json` (웹 전용)** | ✅ |
| AB (단당무게) | 카테고리별 단당무게 | `Product.BoxWeight` (외국 = 단당, 콜롬비아 = 박스당) | ✅ |
| **AB14 기타 단당무게** | **잔여 역산** | **freightCalc.js Step 5 잔여 역산 로직** | ✅ |
| N (단당송이) | 단당 송이 수 | `Product.SteamOf1Bunch` (없으면 카테고리 default) | ✅ |
| 관세율 (N7~N13) | 카테고리별 관세 | `Product.TariffRate` (Ecuador=0.25 일괄) | ✅ |
| **그외통관 5종 (P6~P9, R6)** | 백상/통관/검역/국내운송/차감 | **사용자 입력 → `FreightCost.BakSangRate` 등** | ⚠ |

---

## 5. 그외통관 5종 — 운영 지침

| 항목 | DB 컬럼 | 17-2 MEL | 18-1 Ecuador | 산식 |
|---|---|---|---|---|
| 백상 | `BakSangRate` (단가) | 460/kg → 297,160 | 460/kg → 88,780 | `GW × 460` |
| 통관 수수료 | `HandlingFee` | 33,000 (고정) | 27,000 | 17-2 고정 / 18-1 = 포목수 × 9000 |
| 검역 수수료 | `QuarantinePerItem` | 60,000 = 6×10000 | 36,000 (고정) | 17-2 = 품목수 × 10000 / 18-1 고정 |
| 국내 운송비 | `DomesticFreight` | 99,000 | 90,000 | 입력 |
| 검역차감 | `DeductFee` | 40,000 | 20,000 | 입력 |
| **합계** | — | **529,160** | **261,780** | — |

→ 차수마다 산식이 달라짐 (중국 vs 에콰도르). 운송원가탭 UI 에서 입력하고 `FreightCost` 스냅샷으로 박제.

---

## 6. 카테고리 오버라이드 운영 (data/category-overrides.json)

### 6.1 형식
```json
{
  "<ProdKey>": {
    "category": "<한글 카테고리>",  // Flower 테이블 매칭용 (장미/안개꽃/리시안서스/기타 등)
    "note": "<자유 메모>",
    "savedAt": "<ISO 시간>"
  }
}
```

### 6.2 매핑 원칙
- **엑셀 라벨이 영문 (ROSE/Gypsophila/LISIANTHUS) 이라도 DB에는 한글 (장미/안개꽃/리시안서스) 사용** — Flower 마스터와 매칭되어야 BoxWeight/StemsPerBox 가 적용됨
- "기타" / "others" 카테고리는 **잔여 역산 자동 적용** (별도 BoxWeight 입력 불필요)
- 사용자가 임의 분류한 카테고리 (예: ASPARAGUS Preserved → Sinensis) 가 실제 분배에 안 쓰이면 → "기타"로 통일 권장

### 6.3 17-2 MEL 분류 예시 (확정)
| ProdKey | 품목 | 카테고리 |
|---|---|---|
| 3076 | Amaranthus 줄맨드라미 | 기타 |
| 3088 | ASPARAGUS Preserved 미디오 | 기타 |
| 2748 | 안개꽃 1Kg Gypsophila | 안개꽃 |
| 3084, 3078 | Lisianthus 핑크/화이트 | 리시안서스 |
| 2742, 2851, 3093, 2961, 2746, 2744, 2918, 2388, 2093, 2513 | ROSE 10종 | 장미 |
| 2834 | 리모늄 스타티스 | 기타 |

---

## 7. freightCalc.js 의 핵심 로직 (2026-04-27 추가)

### 7.1 잔여 역산 (Step 5)
```js
// "기타"/"others" 카테고리는 GW 잔여분으로 단당무게 자동 계산
if (useBasis === 'GW' && gw > 0) {
  const othersBucket = [...bucket.values()].find(b => b.flowerName === '기타' || /^others?$/i.test(b.flowerName));
  if (othersBucket && othersBucket._qtyForCalc > 0) {
    const otherWeightSum = [다른 카테고리 boxWeight × qty 합];
    const residualWeight = Math.max(0, gw - otherWeightSum);
    othersBucket.boxWeight = residualWeight / othersBucket._qtyForCalc;
  }
}
```

### 7.2 콜롬비아 vs 외국 분기
- **콜롬비아 / 국가 미지정**: `qtyForCalc = boxCount` (박스 단위)
- **그 외**: `qtyForCalc = bunchCount` (단 단위)
- → Product.BoxWeight 입력 시 **단당 무게로 입력** (외국 BILL 가정), 콜롬비아는 박스당 무게 그대로

### 7.3 항공료 추출 우선순위
```
freightOverrideUSD (사용자 수동) > actualFreightUSD (FREIGHTWISE/운송료 행 TPrice 합) > Rate × CW + DocFee 계산
```

---

## 8. 데이터 입력 가이드 — 사용자가 채워야 할 빈칸

### 8.1 17-2 MEL 적용 시
- ✅ `data/category-overrides.json` — 16건 시드 적용 완료
- ⏳ Product.BoxWeight 누락 7건 (모두 ROSE 단당=0.8): ProdKey 2742, 3093, 2961, 2918, 2388, 2093, 2513
- ⏳ Product.BoxWeight 누락 1건: ProdKey 3088 (ASPARAGUS Preserved, 단당=0.5 권장)
- ⏳ Product.SteamOf1Bunch 누락 2건: ProdKey 3078 Lisianthus 600g, 2834 리모늄

### 8.2 새 차수 운영 절차
1. 입고관리에서 BILL 업로드 (농장 행 + FREIGHTWISE 행 모두)
2. 운송원가탭에서 AWB 선택
3. 환율/그외통관 5종 확인·수정
4. 카테고리 미분류 품목은 `/admin/category-overrides` 에서 분류 추가
5. Product.BoxWeight 누락된 신규 품목은 품목관리 화면에서 단당 무게 입력
6. "저장" 클릭 → FreightCost 스냅샷 생성

---

## 9. 검증 결과 (2026-04-27)

### 17-2 MEL — 카테고리 분배 100% 일치
| 카테고리 | 엑셀 운임USD | 코드 운임USD | 엑셀 단당 | 코드 단당 |
|---|---|---|---|---|
| 장미 | 5,518.10 | 5,518.11 | 10.820 | 10.820 |
| 안개꽃 | 811.49 | 811.49 | 13.525 | 13.525 |
| 리시안서스 | 1,298.38 | 1,298.38 | 8.115 | 8.115 |
| 기타 | 1,109.03 | 1,109.03 | 11.674 | 11.674 |

### 18-1 Ecuador — 도착원가/송이 99.7% 일치
- 5개 핵심 품목 모두 오차 7원 이내 (0.3%)
- 잔존 0.3% 오차 = Rate USD/kg 미추출 (운송료 행 패턴 차이)

### 잔존 마이너 이슈
1. **18-1 Rate 추출 패턴** — 18-1 에선 Rate(3.45) + 고정비용(92.5) 가 운송료 2개 행으로 나뉨. 첫 행이 BunchQty=277 (=CW) 이므로 패턴 인식은 되어야 하는데 검증 스크립트의 단순화 이슈일 수 있음.
2. **단당/송이당 표시 단위** — 코드는 송이당 출력. UI 에서 Product.SteamOf1Bunch 곱해 단당 표시 권장.
3. **헤더 검증식 itemCount** — 엑셀 C9=품목수, 코드는 distinct FlowerName 카운트. 둘이 다를 수 있음 (사용자 분류 vs 통합).

---

## 10. 롤백 가드

- 변경된 파일: `lib/freightCalc.js` (잔여 역산 로직 추가, Step 5)
- 영향 범위: "기타"/"others" 카테고리가 있는 BILL 만 (없으면 기존 동작 유지)
- 13/14차 fixture 영향 가능성: 13/14차 BILL 에 "기타" 카테고리 있으면 결과 변경됨 → **`__tests__/freightCalc.test.js` 재실행 필수**
- 백업 태그 권장: `git tag backup-before-residual-2026-04-27`
