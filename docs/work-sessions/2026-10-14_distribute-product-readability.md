# 출고분배 품목명·전차수 잔량

| 항목 | 내용 |
|---|---|
| 요청 | 품목 잘림/여백 개선, 중복 품종 접두어 생략, 입고 옆 전차수 잔량 표시 |
| 범위 | /shipment/distribute 표시 전용 |
| 배포 | 진행 중 |

## 구현 전 기준 및 부작용

- 목록 320px 고정폭과 nowrap 때문에 9개 열이 잘림. 패널 폭을 반응형으로 넓히고 품목 버튼은 자연스럽게 줄바꿈한다.
- 선택한 품종과 일치하는 이름 맨 앞 접두어만 생략. 내부 단어, 다른 품종, Mini/Spray 구분과 원래 검색/저장값은 보존.
- EXE BeforeStock인 `_exeParity.prevStock`만 전차수 잔량으로 표시. 여기서 입고를 빼지 않는다. 전체(legacy) 조회의 같은 필드는 현차수 snapshot이므로 전차수로 추정하지 않고 품종 선택 안내.
- 입고/전차수는 별도 숫자. 분배 입력, 자동계산, 저장 및 기존 입고 대비 잔량 계산은 보존.

| 동작 | Order/Shipment/Date/Farm | Warehouse/Stock/ProductStock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 품목명·잔량 표시 | 보존 | 기존 응답 읽기만 | 보존 |

## 근거

- 2026-10-14 설치 EXE FormShipmentDistribution을 dnSpy.Console.exe --no-color -t로 읽음. GetProductList의 BeforeStock=bs.Stock, wOutQuantity는 ViewWarehouse 합계임을 확인.
- sqlDistributeGetProductList 및 mapExeDistributeProductRow가 같은 필드를 전달. resolveBeforeOrderYearWeek는 연도 포함 결합키의 직전 StockMaster를 선택.
- 인증 운영 GET products, 2026/41-01/콜롬비아카네이션 read-only: Apple Tea345 전차수2/입고1, Brut359 전차수18/입고10, Pastel Crimea3199 전차수0/입고0. 사용자 사진과 조회 시점·선택차수는 다를 수 있음.
- SQL/조회/저장/SP 변경 없음. 운영 수정 및 재분배 없음.

## 검증 및 기준선

- 적용: 1920×1080/100%, 기존 shell, 좁은 화면 가로 스크롤, 품목 선택 키보드 버튼.
- 해당 없음: 새로운 저장/권한/매칭/확정.
- 통과: 표시 helper/실제 페이지 SSR fixture, npm run verify:erp-change(exit0). 이후 추가 SSR fixture를 연결한 shipmentDistributionEdit도 재실행 통과.
- 실브라우저 fixture: 1920×1080/100%와 768×900 확인. 긴 이름 버튼 scrollWidth=clientWidth, 768px 문서폭 유지/표 가로 스크롤/자연 줄바꿈. 원래 이름은 title로 보존. 새 버튼 Tab/Enter/Space 및 위아래 초점 이동 경로 추가.
- 운영 배포 후 실제 품목 선택 스모크 진행 예정. ERP 저장은 실행하지 않음.
