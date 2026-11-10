# 출고 Excel 실제 날짜·수량 보존

2026-11-10 설치 Nenova.exe를 로컬 dnSpy.Console로 재추출했다.
FormShipmentDistribution.GetCustomerList는 OrderYear+OrderWeek와 실제 ShipmentDate를
사용한다. FormEstimateView.GetPrintDetail/GetExcelDetail은 ViewShipment↔ViewOrder의
OrderYearWeek2+CustKey+ProdKey, ShipmentDate↔PeriodDay 정확한 시각 JOIN,
DetailFix=1, EstQuantity>0가 기준이다. 상세 CustKey NULL은 정상이며 Master가 기준이다.

운영 SELECT: 2025/46-01 미국29건(양수25/영수량4), 79박스/1690단/9785000원.
날짜금액 합도9785000원. PeriodDay=2025-11-12수~11-18화.
검증 전후 원장지문 비교; 개인정보/인증정보/실제 workbook 디스크 저장0.

| 기준 | 원천/소비자/정책 |
|---|---|
| 연도·차수 | requireOrderYear, 명시 또는 내장연도 필수, 불일치400, SQL Year+Week |
| 업체 | Master/ViewShipment, 양의 정수, 상세 CustKey NULL 허용 |
| 날짜 | 저장 ShipmentDate 전체시각, PeriodDay exact1, 날짜순, 토·일 포함 |
| 수량 | ShipmentQuantity, 합=OutQuantity, 재분배/반올림0, 명시0 출력제외 |
| 날짜 없음 | 날짜 PK 부재일 때만 미지정에 OutQuantity 한번 |
| 오류 | 중복/NULL/달력불일치/합계불일치409, 임의보정0 |
| 단위 | Product.OutUnit 원본 정밀도, 혼합단위 별도 소계 |
| 구버전 임시설정 | 요청값으로 저장 날짜·수량 덮어쓰기0 |
| 견적/ECOUNT | 기존 EXE SQL/API/builder 그대로 실제 출력 roundtrip |

| 동작 | Order* | ShipmentMaster/Detail | ShipmentDate/Farm | Stock* | Estimate | WebProfitReport |
|---|---|---|---|---|---|---|
| 출고XLSX GET | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 견적/ECOUNT 검증 | 보존 | 보존 | 보존 | 보존 | 보존 | 보존 |

메뉴기본값: ERP안전/오류안내/실브라우저 적용. 화면·탭·키보드·업무순서 변경없음,
신규영상 해당없음(기존 다운로드 backend 데이터 정정). 합성 교차연도/주말/분수수량/
혼합단위/NULL상세 XLSX, 실제SQL, 운영API출력 및 필수 ERP/빌드/CI/배포 검증한다.
