---
name: 출고분배 엑셀 업로드 출고일 기준 보정
description: 23-01 엑셀 업로드 후 신규 분배 행의 출고일이 전산 기준보다 6일 뒤로 저장된 문제와 재발 방지 기준
date: 2026-06-02
type: incident
---

# 출고분배 엑셀 업로드 출고일 기준 보정

## 요약

- 증상: 차수피벗/물량표 엑셀 업로드 후 신규 생성된 출고분배 행의 `ShipmentDetail.ShipmentDtm`과 `ShipmentDate.ShipmentDtm`이 기존 `nenova.exe` 분배 행보다 6일 뒤로 저장됨.
- 대표 사례: `23-01` 공주플라워 중매 1523 / `CARNATION Mariposa`가 `0 → 1`로 신규 분배되었으나 출고일이 `2026-06-09`로 저장됨. 같은 업체 기존 분배 행은 `2026-06-03`.
- 원인: 웹 출고일 계산이 차수 시작일 이후의 수요일을 찾는 방식이라, `23-01`처럼 차수 시작일이 목요일인 경우 다음 주 수요일 기준으로 밀림.
- 처리: `23-01`에서 동일 패턴 18건을 업체 `BaseOutDay` 기준 정상 출고일로 보정.
- 재발 방지: 출고일 계산 기준을 “차수 시작일의 직전/당일 수요일 + `BaseOutDay` 오프셋”으로 통일.

## 전산 기준 출고일 계산

`getCurrentWeek()`의 단순 7일 분할과 맞춘다.

```text
Week N 시작일 = 해당 연도 1월 1일 + (N - 1) * 7일
기준 수요일 = Week N 시작일보다 뒤의 수요일이 아니라, 시작일과 같거나 바로 앞의 수요일
출고일 = 기준 수요일 + Customer.BaseOutDay 오프셋
```

`BaseOutDay` 오프셋:

| BaseOutDay | 출고요일 | 기준 수요일 대비 |
|---:|---|---:|
| 0 | 수 | +0 |
| 1 | 일 | +4 |
| 2 | 월 | +5 |
| 3 | 화 | +6 |
| 4 | 목 | +1 |
| 5 | 토 | +3 |
| 6 | 금 | +2 |

예시:

| 차수 | 기준 수요일 | BaseOutDay 0 | BaseOutDay 6 | BaseOutDay 1 | BaseOutDay 2 |
|---|---|---|---|---|---|
| 2026-23-01 | 2026-06-03 | 2026-06-03 | 2026-06-05 | 2026-06-07 | 2026-06-08 |

## 금지 사항

- 차수 시작일 이후의 수요일을 찾는 방식 금지.
- `Date` 자정값을 그대로 SQL `DateTime`에 넘기는 방식 금지. 시간대 변환으로 전날/다음날 밀릴 수 있음.
- `toISOString()` 기준 날짜 문자열 사용 금지.
- `ShipmentDetail.ShipmentDtm`만 고치고 `ShipmentDate.ShipmentDtm`을 그대로 두는 부분 보정 금지.

## 보정된 파일

- `lib/shipmentImport.js`
- `pages/api/shipment/distribute.js`
- `pages/api/shipment/adjust.js`
- `pages/api/shipment/stock-status.js`
- `pages/shipment/week-pivot.js`
- `pages/api/shipment/distribute-diagnose.js`

## 진단 API

```http
GET /api/shipment/distribute-diagnose?week=23-01&year=2026
```

중요 필드:

- `summary.shipmentDateMismatch`: `ShipmentDate` 합계/일자와 `ShipmentDetail` 불일치
- `summary.shipmentDateBaseMismatch`: 엑셀 업로드 신규/수정 행 중 전산 기준보다 6일 뒤로 밀린 출고일

정상 상태:

```json
{
  "shipmentDateMismatch": 0,
  "shipmentDateBaseMismatch": 0
}
```

## 복구 API

```http
POST /api/shipment/distribute-diagnose
Content-Type: application/json

{
  "week": "23-01",
  "year": "2026",
  "action": "repairShipmentDateBaseOutDay"
}
```

동작:

- 확정된 차수면 실행 차단.
- `ShipmentDetail.Descr`에 `엑셀업로드` 로그가 있거나 `ShipmentMaster.WebCreated=1`인 행만 대상으로 함.
- 잘못 들어간 `ShipmentDetail.ShipmentDtm`과 `ShipmentDate.ShipmentDtm`을 함께 보정.
- 보정 로그를 `ShipmentDetail.Descr`에 추가.

## 2026-06-02 운영 처리 결과

운영 대상: `2026 / 23-01`

보정 전:

- `shipmentDateBaseMismatch`: 18건
- 대표 행: 공주플라워 중매 1523 / `CARNATION Mariposa` / `2026-06-09 → 2026-06-03`

보정 실행 결과:

```json
{
  "before": 18,
  "detailUpdated": 18,
  "dateUpdated": 18,
  "after": 0
}
```

보정 후:

- `duplicateMasters`: 0
- `missingCustKey`: 0
- `shipmentDateMismatch`: 0
- `shipmentDateBaseMismatch`: 0
- `keyNumberingNeedsSync`: 0
- `missingProcedures`: 0

공주플라워 중매 1523 확인:

- 보정 전: `2026-06-03` 행 7품목, `2026-06-09` 행 1품목
- 보정 후: `2026-06-03` 행 8품목, 총 10박스

## 관련 커밋

- `13a95d5` `fix: align shipment dates with ERP week calendar`
- `8bca486` `docs: clarify ERP shipment date calendar`

