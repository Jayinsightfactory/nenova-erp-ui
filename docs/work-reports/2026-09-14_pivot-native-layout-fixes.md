# 전산 피벗 표시·조작 수정 설계

## 범위와 완료 기준

- 1920×1080 CSS pixel, 100% 확대 기준. 작은 화면에서도 표 내부 스크롤과 팝업 접근 보장.
- 국가/꽃 행 머리글 병합, 연도→차수→구분→업체 다단 열 머리글. 명확한 셀 테두리.
- 열 너비 직접 조절/자동맞춤, 행 높이 변경. 숫자 원본과 합계는 보존.
- 소수점 숨기기/표시 버튼은 표시와 엑셀 숫자 형식만 변경.
- 필터와 필드 설정 별도 좌클릭 버튼. 팝업은 누른 버튼 아래, 화면 밖이면 내부로 보정.
- 검색/전체/없음/체크 목록/적용/필터 해제. 오름차순/내림차순/정렬 해제와 상태 화살표.
- 기존 조회 실패 시 마지막 정상 결과 유지, 원본 기반 집계, 교차연도 분리 유지.

## 기준 원천과 소비자

| 기준 | 근거 | 소비자 |
|---|---|---|
| 원본 필드·수량·업무키 | FormQuantityPivot dnSpy golden + 기존 GET/모델 계약 | 기존 API와 pivotExeModel 그대로 |
| 그룹 순서·접힘·합계 | 기존 pivotExeModel axis/path/key | 새 표 렌더러, 엑셀 |
| 너비/높이 | 사용자 표시 설정, 최소/최대 정규화 | 표와 저장된 화면 설정 |
| 소수 0/1/2 | 표시 형식, 기본 2, 명시 0 보존 | 화면·엑셀 numFmt, 원본 number 보존 |
| 필터·정렬 | 명시 좌클릭 선택 | 기존 safe filterRows/buildPivotModel |

## 부작용 표

모든 사용자 동작(필터, 정렬, 너비/높이, 소수점, 접기/펼치기, 엑셀)은
OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, WarehouseMaster/Detail,
ProductStock/StockHistory, Estimate, WebProfitReport 및 매출/견적 View를 보존한다.
SQL/API/공유 SP/nenova.exe 변경 없음. 표시·브라우저 설정·다운로드만 변경한다.

## 검증

모델·표 구조·엑셀 실행형 fixture, 기존 ERP/manifest/dnSpy/write guard/build,
1920×1080 및 1366×768 로컬 화면 검증, 운영 읽기 전용 smoke 후 완료 판정.
