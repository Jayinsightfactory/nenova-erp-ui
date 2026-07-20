# 2026-07-20 주차별 매출이익보고서 국가별 중량 자동화

## 결론

28차 이후 주차별 매출이익보고서에서 입고 원장의 Gross Weight/Chargeable Weight를 국가별 H(그외통관비)와 콜롬비아 4품목 배분에 자동 병합하도록 수정했다. 콜롬비아 국내 운송 트럭 대수도 기존 매출원가 엑셀에서 반복 확인된 GW 구간으로 자동 계산한다.

자동값이 정상적으로 존재하는데도 `CUSTOMS_GW_AUTO` 때문에 검증 필요로 표시되던 경고는 제거했다. 실제 입고 중량이 없거나 반차수가 빠진 경우의 `CUSTOMS_INCOMPLETE`/`CUSTOMS_NO_PURCHASE` 검증은 유지한다.

## 근거와 적용 규칙

검토한 로컬 원본은 `Downloads/매출원가 양식 - 22차_재고수정.xlsx`부터 `27차_재고수정.xlsx`까지다. 콜롬비아 1·2차 시트에서 확인된 운송료 등급은 다음과 같다.

| Gross Weight | 자동 트럭 대수 |
|---:|---:|
| 0 초과 ~ 1,000kg | 1t 1대 |
| 1,000kg 초과 ~ 2,500kg | 2.5t 1대 |
| 2,500kg 초과 | 5t 1대 |

실측 예시는 22~27차의 237/553/655/966kg → 1t, 27차 1,371kg → 2.5t, 23~27차의 6,404~7,530kg → 5t이다. 이는 엑셀의 운송료 등급 선택을 재현한 것이며, 물리적 차량 적재한계를 새로 추정한 규칙이 아니다.

입고 중량은 다음 순서로 읽는다.

1. `WarehouseDetail`의 `Gross weight`/`Chargeable weight` 행에서 Box/Bunch/Steam/OutQuantity 중 실제 중량값을 추출한다.
2. 같은 `WarehouseKey`의 `Product.CounName`, 같은 AWB의 품목 국가, 농장명·인보이스 태그 순으로 국가를 판별한다.
3. 특수 중량행이 없으면 `WarehouseMaster.GrossWeight/ChargeableWeight`를 fallback으로 사용한다.

## 변경 파일

- `lib/colombiaTruck.js`: GW → 1t/2.5t/5t 자동 등급 순수 함수.
- `lib/customsForwarding.js`: 국가별 GW/CW 추출, AWB/품목국가 매핑, 콜롬비아 트럭 자동 병합, `Freight Wise` 공백 농장명 인식.
- `pages/api/sales/customs-clearance.js`: 콜롬비아 GW/CW 및 트럭 자동값을 API 응답에 포함.
- `pages/api/sales/forwarding-clearance.js`: 포워딩 화면의 콜롬비아 GW/CW와 배분 계산에도 동일 자동값 사용.
- `components/CustomsClearancePanel.js`: 트럭 대수 수기 입력칸 대신 GW 기반 자동값 표시 및 저장.
- `lib/profitReportAudit.js`: 자동 GW 자체를 검증 경고로 세지 않음. 중량 누락/부분 누락은 계속 검증.
- `lib/profitReport.js`: 매출·불량·그외매출 집계에 `ShipmentMaster.isFix=1` 필터 추가.

## 단가 충돌 보존

`Downloads/28-1 콜롬비아 원가자료.xlsx`의 28-1 상세 시트에는 백상 단가 410원/kg, 국내 운송비 99,000원이 보인다. 반면 22~27차 기존 요약 양식과 현재 웹 단가표는 백상 460원/kg, 트럭 1t/2.5t/5t = 99,000/187,000/275,000원 체계다. 이번 요청은 “입고 GW 기반 트럭 대수 자동계산”으로 한정되어 있어 기존 웹 단가표와 과거 회귀 검증을 유지했고, 410원/kg으로 임의 변경하지 않았다. 28차 원가자료를 최종 기준으로 확정할 경우 백상 단가 변경은 별도 승인·엑셀 재검증이 필요하다.

## 검증 결과

- `node __tests__/customsForwardingAuto.test.js`: 성공 — 22~27차 GW 구간, 7,613kg 5t 계산, 자동 GW 검증 경고 제거.
- `node __tests__/profitReportWorkbookParity.test.js`: 성공.
- `node __tests__/freightCalc.test.js`: 238개 계산 성공.
- `node scripts/verify-customs-forwarding.mjs`: 17개 성공.
- `npm run test:erp-contract`: 성공.
- `npm run build`: Next.js 프로덕션 빌드 성공.

DB 연결정보가 이 작업 트리에 없으므로 실제 운영 DB의 28차 응답값과 배포 후 화면까지는 여기서 직접 조회하지 않았다. 배포 후에는 `customs-clearance?week=28`에서 국가별 `autoGw`, 콜롬비아 `truckAuto`, `forwarding-clearance?week=28`의 GW/CW를 확인하면 된다.
