# 전산 피벗 전체 필터 상호 연동

Q. 국가 선택에 따라 꽃 후보가 달라져야 하고 다른 항목도 모두 연동되어야 한다.
A. 전체 조회 rows에서 모든 목록을 만들던 전산 피벗을 수정. 열린 필드에 대해 다른 적용 조건을 공통 filterRows로 평가한다.

## 기준·부작용
- 대상: 전산 피벗 모든 EXE_FIELDS. 필터/행/열/값 위치와 무관. 기존 웹 모드의 별도 dimension helper는 보존.
- 후보: 자기 체크 조건만 제외. 고급 AND/OR/NOT은 뜻이 변하지 않도록 전체 유지. 전역 필터 off면 전체 후보.
- 현재 선택이 조건 밖이면 별도 경고와 체크 해제/일괄 해제 제공. 자동 삭제하지 않음.
- 전체 선택은 현재 후보 선택. 원본 전체를 선택했을 때만 기존 필터 해제 동작. 좁아진 후보 전체를 전체 원본으로 오인하지 않음.
- 검색은 후보만 검색. 취소는 변경 없음. 기존 수량/단가/합산/엑셀 동일 모델 유지.
- Order/Shipment/Date/Farm/Stock/Warehouse/Estimate/Amount/Vat/isFix/WebProfitReport 모든 원장 보존, API·SQL 쓰기 없음.

## 근거와 검증
- 실제 dnSpy FormQuantityPivot GetData/ViewWarehouse/ExportToXlsx 재실행. 운영 SELECT-only2026 01-01~02-02 8,066행, 입고 main4,858/4,330. EXE예시농장630/400/10 유지.
- 국가↔꽃, 품목/거래처/구분/차수/연도/수량0/null, 교차연도, AND/OR/NOT, 빈 선택, stale, 비활성, 제한 후보 전체 선택 fixture 통과.
- ERP contract/dnSpy/manifest/write guard/build 통과.
- 1920×1080 실제 빌드 fixture16,000행: 콜롬비아 선택 후 꽃=장미만, 농장=CO농장만 표시. 꽃 전체해제 후 국가의 기존 선택을 자동 삭제하지 않고 조건 밖 경고 확인. 콘솔 오류0.
- 배포 진행 중. `.tmp` 파일은 커밋 제외.
