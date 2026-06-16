# 견적서 Orange Flame / 그린화원 24차 — 원인·수정 (2026-06-16)

## 증상

| 케이스 | 화면 | 현상 |
|--------|------|------|
| **CARNATION Orange Flame** | nenova.exe 견적서관리 | 수량·단가 누락 |
| **그린화원 24차** | nenovaweb `/estimate` | MEL/중국 장미 등 수량·단가 0 행 표시 |

## 진단 결과 (운영 DB, 2026-06-16)

### Orange Flame — **데이터 이미 정상**

`estimate-period-repair?shipdates=24-01` 기준:

- `DetailEst=15`, `DateEst=15`, `DateShipQty=1`, `Cost=DetailCost=DateCost` (11000~11400)
- `estimate-cost-source-audit`: Detail ↔ Date 불일치 **0건**

**원인(과거):** 웹 분배가 `ShipmentDetail`만 갱신하고 `ShipmentDate.Cost/EstQuantity/Amount/Vat`를 비워 둠 → exe는 Date를 읽어 빈칸.

**이미 적용된 수정:** `lib/syncShipmentDateEst.js` + distribute/adjust/update-quantity/update-cost 경로 동기화 (오늘 배포 `e48c93e`까지 포함).

### 그린화원 24차 — **OutQuantity=0 유령 ShipmentDetail**

`ShipmentKey=5001/5002`, `SdetailKey` 76965~76970, 77178~77180:

- `DetailOut=0`, `DetailEst=0`, `DateShipQty=0`, `Cost=0` (또는 Cost만 있는 0출고 행)
- 주문·분배 실수량 없이 **ShipmentDetail + ShipmentDate 껍데기**만 존재
- 웹은 `byDate=1` + INNER JOIN ShipmentDate → **0수량·0단가 행이 견적 목록에 노출**

## 코드 수정 (이번)

| 파일 | 내용 |
|------|------|
| `pages/api/estimate/index.js` | `loadItems`: `AND ISNULL(sd.OutQuantity,0) <> 0` + 비-byDate도 `filterActiveEstimateShipmentRows` |
| `lib/estimateInvariants.js` | `filterActiveEstimateShipmentRows()` — 정상출고 유령행 제외, 차감 행은 유지 |
| `__tests__/estimateInvariants.test.js` | 유령행 필터 테스트 추가 |
| `scripts/probe-estimate-orange-green-24.mjs` | Orange Flame / 그린화원 진단 스크립트 |

## 배포 후 확인

```bash
node scripts/probe-estimate-orange-green-24.mjs
```

- 그린화원 SK=5001: bad rows **0** 이어야 함
- Orange Flame: DateEst=15, Cost 일치 유지

## nenova.exe 추가 확인

Orange Flame가 특정 거래처에서만 비면:

```http
GET /api/shipment/estimate-visibility?week=24-01&q=Orange%20Flame
GET /api/dev/estimate-cost-source-audit?week=24-01&prod=Orange%20Flame
POST /api/shipment/estimate-period-repair  { "weeks":["24-01","24-02"], "action":"syncDateEst" }
```
