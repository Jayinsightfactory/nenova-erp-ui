# 입고 박스·중량 현황 확장

## 기준과 부작용
- 운영 DB 변경 금지. 조회는 WarehouseMaster/Detail, Product SELECT만 한다. Order/Shipment/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport/Stock 및 과거 원가 모두 보존한다.
- 기존 /incoming/boxes 메뉴를 별도 `입고 박스·중량 현황` 메뉴로 유지·확장한다. 페이지 shell은 _app만 소유한다.
- 차수/연도는 명시 OrderYear+OrderWeek. 월은 실제 InputDate의 YYYY-MM이며 날짜 미기재는 별도 표시한다. 연도 조회 범위는 명시 시작/끝(최대 10년).
- 박스는 저장 BoxQuantity. 단/송이 또는 현재 포장규격으로 추정하지 않는다. NULL과 0, 소수 합포장 보존.
- 국가/품종은 Product.CounName/FlowerName, 누락은 미분류. 삭제 Product의 과거 입고도 포함한다. Master 삭제만 제외. Farm 조인 중복 방지.
- GW/CW는 WarehouseMaster의 입고건 단위 kg. 같은 건의 상세 반복을 합산하지 않는다. 선택 분류에 여러 그룹이 있으면 해당 중량을 임의 배분하지 않고 `혼합 입고 중량`에 건당 한 번 표시한다. 필터로 한 품종만 남아도 전체 중량을 그 품종에 귀속하지 않는다.
- 새로고침/탭 복귀 시 SELECT로 갱신한다. 입고 writer·공용 SP·재고 계산식·확정 원가 변경 없음.

## 근거
2026-10-23 설치 Nenova.exe에 dnSpy.Console.exe --no-color -t ExcelLoadingPackingList 실행. BoxQuantity=F, BunchQuantity=I, SteamQuantity=J 독립 저장 및 InputDate/OrderYear/OrderWeek 확인. DB_STRUCTURE의 헤더 GrossWeight/ChargeableWeight와 실제 invoiceReceiptWriter 저장/readback을 대조했다. 운영 probe 대신 localhost14339 격리 SQL에서 같은 조회 실행(운영 무접속).

## 검증 계획
실제 캐시 인보이스→기존 writer→새 조회의 박스 합계. 국가/품종, 월/연도, 교차연도 동일차수, 삭제헤더, NULL/0/소수, 혼합 중량, 빈 결과, 필터 및 원장 불변 검증. 실제 페이지와 전체 계약/빌드 후 코드만 배포. 미완료 단계는 미검증.
