# 호텔 도착원가 농장·출처별 전체 표시

최신 요청은 실제 공급 농장을 추적할 수 없으므로 관련 차수의 농장별 단가를 모두 보여 주는 것이다. 종전 세부차수별 최고가 선택을 제거했다. 당차수의 모든 세부차수와 같은 연도 다음 대차수 1차를 조회하고, 둘 다 없을 때만 이전 최신 대차수로 대체하는 범위는 유지한다.

## 변경 전 읽기 근거

dnSpy CLI `FormWarehouseView` 실행에 성공했다. `GetData`의 연도·차수·농장, `GetDetail`의 `WarehouseDetail.UPrice/TPrice` 조회를 확인했다. 운영 DB에는 아래 SELECT만 수행했다.

```sql
SELECT ArrivalLineKey,OrderYear,OrderWeek,ProdKey,FarmNameRaw,Unit,
       SelectedArrivalCostKRW,SourceFileName,SheetName,SourceRow
FROM WebArrivalCostLine
WHERE OrderYear='2026' AND ProdKey=2330 AND IsCurrent=1
  AND SelectedArrivalCostKRW>0
ORDER BY OrderWeek,ArrivalLineKey;
```

결과는 `40-1`차 왁스 화이트 5행이다. 단위는 모두 `단`이고 파일은 `CHINA 중국 원가자료 (40-1차) - 해상.xlsx`다.

| ArrivalLineKey | 농장 | 시트 | 행 | 원가(원/단) |
| --- | --- | --- | ---: | ---: |
| 42946 | MELODY | 해상 | 42 | 11,450.6709 |
| 43046 | MELODY | 해상 (2) | 42 | 10,886.0779 |
| 43146 | MELODY | 40-1 해상 | 46 | 9,993.8277 |
| 43246 | MELODY | 40-1 해상 (95% 기준) | 46 | 9,796.8234 |
| 43346 | 미기재 | 40-1 해상 (95% 기준) (2) | 61 | 8,641.4405 |

이 행들에서 실제 호텔 공급농장을 선택할 근거는 없다. 같은 농장의 서로 다른 원본 시트·단가도 각각 표시한다. 농장 미기재 값 또한 다른 농장 값으로 채우거나 합치지 않는다.

## 보존과 중복 판정

연도·품목·숫자상 같은 차수·농장·원본 파일/시트/행·단위·원가와 환산/환율 사실이 동일할 때만 하나로 표시한다. `040-01`/`40-1` 같은 표현 차이만 있는 동일 원본은 중복이다. 출처가 없는 DB 행은 ArrivalLineKey로 각각 구분한다. DB 키가 있으면 `arrival:<ArrivalLineKey>`, 없으면 출처 합성키를 `referenceKey`로 전달한다. 입력 순서에 따라 기준 행과 표시 순서가 흔들리지 않도록 정렬한다.

환산 오류도 해당 원본 행의 경고로 유지한다. 원본원가 및 저장 매입원가를 변경하지 않는다. Product, Order/Shipment/Warehouse/Stock, Estimate, WebProfitReport 쓰기 및 가격 추정·평균·자동선택은 추가하지 않는다.

## 검증

`node __tests__/raumPnlArrivalReference.test.js`에서 실제 5행 사례, 같은 농장 다른 원본/원가, 농장 미기재의 다른 출처, 출처 미상의 서로 다른 DB행, 동일 원본 padded 차수 중복, 역순 입력의 안정성, 이전 최신 fallback의 모든 농장 보존을 확인한다. 화면은 메인 작업의 `hotelArrivalFarmRender.test.js` 및 1920×1080 실브라우저 검증을 따른다.

변경 후 실제 helper를 같은 운영 데이터에 SELECT로 실행하여 위 5개 원가와 `arrival:42946`~`arrival:43346`의 각 실제 DB키가 모두 반환됨을 확인했다. helper·실제 React 렌더·결산 계약·dnSpy 근거 검사 모두 통과했다. 운영 쓰기는 수행하지 않았다.

메인: test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest --changed-from efdee1ae, guard:erp-writes --changed-from efdee1ae, npm run build 모두 통과. 220px 농장별 원가 목록과 300px 환율 비교 목록에 내부 스크롤을 적용하고 각 원본 시트/행을 표시한다.
