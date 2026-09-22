# 도착원가 예시 혼입·조회 범위 수정

## 선검증 및 기준 원장
- 실제 dnSpy CLI FormWarehouseView GetData/GetDetail 재확인: WarehouseMaster/Detail 경계 유지.
- 운영 SELECT: 2026 #23 37-2 정상 53 + 예시 16, #22 38-2 정상 18 + 예시 16. 해당 차수 2025 현재본 없음. 예시 SheetName은 정확히 `08-1(예시)`.
- 업로드 #23은 누적 workbook 전체 2032행 저장. 재업로드로 과거 원가를 덮지 않는다.
- 기존 34행 검증은 예시 16행 혼입을 놓쳤다. 행수뿐 아니라 SheetName/SourceRow provenance를 검사한다.

## 기준표 / 부작용
|동작|기준과 소비자|변경|보존|
|---|---|---|---|
|예시 제외|실제 workbook 시트명, isArrivalExampleSheet / 수동·자동 공통 파서|새 import의 입력 집합만|정상 과거 시트 정책, 수량/단가 원본|
|업로드 후 조회|저장된 행의 연도·차수, 파일명 우선/최신 fallback|화면 필터/목록|원장|
|차수 표기|arrivalWeekPredicate / 목록·품종·누락 조회|SELECT 조건 37-2=37-02|연도 필수|
|운영 예시 보정|배포 후 #22/#23 + 연도/차수/시트/현재 여부 잠금 재확인|WebArrivalCostLine.IsCurrent, History|정상 행, 수동 단가/매칭, ERP 전체|

Order/Shipment/ShipmentDate/ShipmentFarm/Estimate/ProductStock/StockHistory/Warehouse/WebProfitReport에는 쓰지 않는다. 호텔 화면 참고 원가의 예시 혼입만 제거하고 저장된 호텔 매입단가는 보존한다.

## 검증
- 실제 파일 2032→2016행, 37-2 정상53행; 예시16행 제외. 원본 파일은 미변경.
- 원본행/품명/수량/단위 53행 일치. 기존 저장 원가는 원 단위 반올림이며 raw parser 소수점과 직접 비교하면 53행 차이가 있으나 표시 원 단위는 53행 모두 일치. 정밀도 저장 정책은 이번 작업에서 변경하지 않았다.
- ERP 전체 계약, dnSpy, manifest, 쓰기 guard, webpack build 통과. DB SELECT fixture 2025/2026 및 37-2/37-02 비교 통과.
- PR726 CI35672004747 통과, 병합 bf99930a, 배포35672115564 성공.
- 최종 API 프로토콜 대조에서 allVarieties=true가 아닌 기존 '1' 필요 확인. PR728에 실제 upload handler 실행 fixture 추가, 필수 게이트 재통과. CI35672252228 통과, master51223578, 배포35672348970 성공.
- 1920×1080 운영 브라우저에서 버전51223578, 37-02→네덜란드 탭 조회 확인. 가로 document scrollWidth=1920, 버튼/필터/원가 표 접근 가능.
- 배포 후 #22/23 예시32행에 EXAMPLE_EXCLUDE 이력(전체 BeforeJson+정정 사유)을 남겨 IsCurrent=0. import applock, 정확히16+16 재검증, 수동 MATCH/BASIS_CHANGE 없음을 확인. 정상 행 전체 JSON SHA256 전후 동일.
- 보정 후 #23 37-2 정상53행, #22 38-2 정상18행. UI 37-02 NL 55행은 정상53+기존 누락 안내2행. 자동반영 상단 34건은 당시 처리 결과 기록이며 현재본은18행이다.
- 운영 전체 재업로드는 하지 않음. 저장 후 화면전환은 실제 upload handler 격리 fixture, 운영 조회는 실브라우저 확인.
- 원복은 각 EXAMPLE_EXCLUDE BeforeJson의 대상 키/원래 IsCurrent로 가능. 정상 원가/ERP/호텔 매입단가에는 쓰기 없음.
