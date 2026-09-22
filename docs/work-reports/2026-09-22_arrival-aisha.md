# Aisha 도착원가 매칭 보정

## 선검증/기준/부작용
- dnSpy CLI FormWarehouseView GetData/GetDetail의 WarehouseMaster/Detail 조회 재확인. 도착원가 WebArrivalCost 전용 경계 유지.
- 운영 SELECT: Product3170은 활성 네덜란드 백합 `Lily Oriental Double Roselily Aisha 2+`; 1211은 콜롬비아 ROSE.
- 2026 Import23 현재본11행(23-1,28-2~37-2)이 정확한 원본명인데1211/장미로 오매칭. 수동 MATCH/BASIS_CHANGE0건. FarmKey0/FARM_REQUIRED 유지 대상.
- 파서 실제 함수 빈 mapping에서도 재현: Roselily가 rose 부분일치+품종보너스로 정확일치와 동점, 먼저 나온 ROSE 채택.

|동작|기준|변경|보존|
|---|---|---|---|
|새 업로드 매칭|유일한 정규화 품명 정확일치 먼저, 중복 정확후보는 미매칭|공통 파서 선택 순서|수량/원가/단위|
|품종 추론|rose/roses 단어 경계, lily/roselily 백합|파서 품종 힌트|전산 마스터|
|운영 보정|배포 후 정확한 연도/Import/원본명/기존키/11개PK 재검증|ProdKey3170,FlowerNameRaw백합,감사 전후|원가/수량/단위/농장/상태/과거본/ERP/호텔 매입단가|

기존 Order/Shipment/ShipmentDate/ShipmentFarm/Warehouse/Estimate/ProductStock/WebProfitReport에는 쓰지 않는다. 호텔 참고원가 조회의 품목 연결은 바로잡되 저장된 매입단가는 수정하지 않는다.

## 완료 검증
- 전체 ERP계약/dnSpy/manifest/write guard/build 통과. 후보 순서 반전, 잘못된 learned rose, 정확 후보 없음, 중복 정확명 fixture 통과.
- PR732 CI35674319394 성공, master7b6068b6, Cafe24 배포35674412944 및 브라우저 smoke 성공.
- 운영 배포 버전 확인 후11행 정정 및 MATCH 이력11건 기록. 대상 보존컬럼 해시, 나머지 Import23행 전체 해시 동일. 과거본/중국 Aisha 미변경.
- 1920×1080 실화면 `37-02 / aisha`: 정상 백합 품명과3,470원 한 행, 이전 ROSE/원가 미업로드 중복 없음.
