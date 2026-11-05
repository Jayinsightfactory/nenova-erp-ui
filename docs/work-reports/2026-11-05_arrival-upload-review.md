# 도착원가 시트 검토 업로드
## 근거와 기준
실제 dnSpy CLI FormWarehouseView GetData/GetDetail 재실행: WarehouseMaster.OrderYear/OrderWeek, WarehouseDetail 조회. WebArrivalCost는 웹전용. SELECT probe: Import53 40-2 52행/54 41-2 82행과55 동일차수 통합행을 품명/농장/단위/수량/원가/RawJson.cells 다중집합으로 비교,134행 전부일치.53/54 CountryName콜롬비아 오분류;55네덜란드.세Import 수동MATCH/BASIS_CHANGE0.
## 부작용
|동작|파일|WebArrivalCost|ERP·Estimate·ShipmentDate/Farm·Amount/Vat/isFix·WebProfitReport|
|---|---|---|---|
|분석/재검토|원본/해시/단계/오류/요청자 보존|읽기|보존|
|확인 저장|검토 해시/선택 시트 기록|기존 동일연도·차수·국가 원자 revision|보존|
|배포후 정리|검토해시|53/54 정확134행 IsCurrent만0+전체감사|보존|
## 기준 ledger
연도/국가/차수는 시트별 명시입력; 기본연도는선택값,국가는빈값;파일/시트명국가근거 충돌시차단.검역표 임의문자열은국가근거제외.연도충돌은해제불가,연도미확인은사용자명시확인필수.차수는1~53/1~4 정규화.시트선택제외는파서전적용하여다른시트오류가선택시트차단하지않음.검토와저장은같은파서/정책사용,현재마스터로재파싱후검토해시비교.원본SHA/소유자/버전고정,클라이언트행신뢰금지.누락원가행은차단,이상단가/미매칭은표시.저장후동일필드읽기검증실패시롤백.재시도는동일검토중복등록금지.
메뉴기준 적용:시트검토/원본보존/페이지스크롤/키보드/가이드영상.새메뉴shell해당없음.
