# 태국 기존 입고 원가 전용 연결

## 기준과 부작용 (구현 전 고정)
- 사용자 승인: 인보이스 단가 사용. 비교 원가자료의 과거 상품가격 차이는 적용하지 않으며 수식/배분 규칙만 재사용.
- 2026/38-01 Super Fresh 6902981: 입고7345, 19행, 362단/4300송이/USD1452.40. SELECT-only 확인. 기존 입고 상세 digest df16be5d88cac890f9c18321fc85aaf176363660e7b8b680d4ee940fb14e6988.
- 실제 dnSpy CLI ExcelLoadingPackingList.MakeTempTable/InsertMaster 재실행: BoxQuantity/BunchQuantity/SteamQuantity/UPrice/TPrice 별도, 원장 생성 후 uspCreateWarehouse/uspStockCalculation. 본 기능에서는 이 경로를 호출하지 않는다.

| 동작 | Warehouse/주문/출고/재고/Estimate/WebProfitReport | 웹 전용 기록 |
|---|---|---|
| 기존입고 대조 | SELECT only, 연도+차수+송장+농장+발행연도 및 전체 상세 검증 | 없음 |
| 연결 | 전체 원장 보존, 잠금 재검증 | Document/Operation/History |
| 원가 승인 | 원장 보존, 현재 입고 snapshot MATCH | CostRevision/CostLine/History |
| 다운로드 | 읽기 전용 | 승인 입력/값으로 XLSX 생성 |

## 기준 ledger
- TH는 USD/송이 FOB, 원본행 합계와 실제 SteamQuantity/BunchQuantity/TPrice/품목/단가를 대조. 현재 지원은 OutQuantity=BunchQuantity인 입고이며 원가 단위는 단으로 보존하고 송이당 FOB와 구분한다. 박스는 원장에 역기록하지 않음.
- 기존 NL/CN의 동일 연도·차수·농장·송장 후보와 stale/중복 연결 방어를 공유한다.
- 원가 그룹 배분 = 그룹박스/전체박스 × 행송이/그룹송이. 운임과 통관비 모두 동일 배분. 관세=(상품+배분운임)×환율×관세율.
- 기본 기존 행 박스 합계 검증 보존. TH에서만 명시 PACKING_GROUP 선택 시 패킹 전체 박스 입력 필수, 양수 그룹박스 합계와 일치 필요. 행 박스0/미기재를 분배 수량으로 추정하지 않음. CO에는 적용 금지.
- 품목·송이·단가·금액·그룹송이 합계, 취소행 및 잘못된 환산 검증 유지. 원본/저장 결과 비교 및 승인 snapshot에 배분 기준을 남김.
- 수량/환율/비용 누락을 0이나 전차수로 자동 대체하지 않음. 0/false/누락/미지원기준/과거연도/stale fixture 검사.
- 수식은 기존 TH_GROUP_BOX_SHARE_V1 유지; 새 입력은 포장 그룹 증거의 범위만 명시한다.

## 검증 상태
단위·회귀 검사 및 실제 격리 MSSQL의 NL/TH 연결·재시도·교차연도·저장·재조회·XLSX·ERP 보존 통과. 기존 SQL fixture의 시트 기대값은 원본수식 비교 시트가 추가된 현재 계약으로 정정했다. 전체 게이트와 최종 빌드 진행 중. 배포·운영 원가 저장·다운로드 미검증. 기존 입고는 변경 금지.

## 메뉴 기본값
기존 화면틀/세로 흐름 보존. 새 select/number 입력은 기본 키보드 조작 제공. 승인 전 입력·원문·계산값 비교와 기존 저장 후 readback·이력 유지. 신규 메뉴/라우트/스키마 없음.
