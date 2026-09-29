# 피벗 도착원가 연결·정수 표시

Q. 주문 피벗에서 도착원가가 비며 소수점 없이 표시하고 싶다.
A. 입고에만 값을 붙이던 조건 및 FreightCost 원천을 확인. WebArrivalCostLine 현재본을 조회하여 같은 연도/품목/차수 우선, 없으면 이전 최신 세부차수로 참조한다.

## 구현 전 기준·부작용
- 원천: WebArrivalCostLine.IsCurrent=1, 정확한 ProdKey. 이름 유사 매칭 금지.
- 연도 격리, 숫자 차수 정규화(38-1=38-01), 미래 차수 금지. 최신 차수의 복수 농장 원가 MAX. 단위는 Product.OutUnit으로 환산, 근거 불명은 빈값.
- 원가 부가세 별도, 저장 소수점 보존. 그리드/XLSX 표시 형식만 도착원가 0자리 반올림. 다른 수량/단가 설정 보존.
- OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Warehouse, Stock, Product, Estimate, WebProfitReport, WebArrivalCost 원장 모두 보존(SELECT only).
- dnSpy 실제 FormQuantityPivot GetData/ViewWarehouse/ExportToXlsx 재확인. 원본 UNION/수량은 변경하지 않음.
- 운영 SELECT: Be Sweet50cm ProdKey1330 최신37-1 단당10,205/9,625. 60cm1371=10,495. 현재원가에는38/39차 콜롬비아 없음. 이를 해당차수 원가라고 표시하지 않음.

## 검증
- ERP contract/dnSpy/manifest/write guard/build 통과. mock loader 500개 배치와 연도 바인딩, 실패 전파, 미래·다른연도·잘못된품목·비현재본·환산누락·숫자차수·0원 fixture 통과.
- 수정 loader로 운영 SELECT 재검증: 2026 38-01~39-01 원본3,952행/원가연결3,268행. 범위품목키642개 중 이전차수참조409개. 1330 주문10,205 확인. 수량/행수 불변.
- 1920×1080 로컬 production build: 도착원가10,205.75→10,206, 분배단가12,500.25와 수량 소수점 유지. XLSX 원본 number와 정수 numFmt 검증.
- 배포 대기. 기존 unrelated 문서와 `.tmp`는 제외.

## 다음 세션
작업 경로 action-log-outcome/nenova-erp-ui, branch codex/pivot-arrival-ledger. 배포/실브라우저 결과를 아래에 추가하고 사용자에게 원인·수정·미연결 제한을 안내한다. ERP DB 보정 없음.
