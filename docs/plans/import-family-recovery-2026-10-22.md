# 자동 품종 매칭 회귀 복구

사용자 확인: 어제부터 기존 자동매칭 품목이 미매칭이며 루스커스가 수국으로 표시됨.
PR1213의 제목 우선/교차품종 차단이 원인. PR1221은 수동 선택만 해결했음.

## 구현 전 근거와 기준
- 실제 설치 Nenova.exe FormShipmentDistribution dnSpy CLI 재실행. 연도/차수/업체 Master 및 상세→농장→날짜 기존 저장 순서는 변경하지 않는다.
- SELECT: Product1717 Ruscus Green / 루스커스 그린,3085 Ruscus Green 40cm / 루스커스 그린 40CM. 둘 다 FlowerName 루스커스,CountryFlower 콜롬비아루스커스,OutUnit 박스.
- 2025/43-01 두 품목 ViewOrder22/ViewShipment22/Date22/Farm0,출고58,확정22,금액10368182.145454548,Vat1036818.2245454547. 2026 같은 차수 주문28/출고0/날짜0/농장0. 같은 세션의 Estimate/확정견적/손익 probe는 FormShipmentDistribution golden 참조. 시험 저장 없음.

|동작|Product|Order/Shipment/Date/Farm|Estimate/Amount/Vat/isFix/Stock/WebProfitReport|
|---|---|---|---|
|파일 파싱·자동 매칭·재검증|SELECT|SELECT/보존|보존|
|사용자 승인 적용|보존|기존 서명계획 및 native writer 계약 유지|기존 보호/검증 유지|

## 기준표
- 행에 명시된 품종 우선, 제목/시트명은 보조 단서. 원본 라벨과 품종 근거(row/heading)를 보존한다.
- 제목만으로 얻은 품종은 유일한 DB 원본 이름 정확매칭을 거부하지 않는다. 축약명 중복은 품종 단서로 구분하고 잘못된 품종의 fuzzy로 우회하지 않는다.
- 루스커스 인식, Green/그린의 규격 보존 별칭을 추가한다. 40cm를 일반 루스커스에 합치지 않는다.
- 매칭 이후 품종 및 환산 판정은 해당 DB 품목을 사용한다. 제목이 다른 품목을 알스트로16배/장미단 단위로 오염시키지 않는다. 기존 실제 품종 환산식은 보존한다.
- 수동 선택/skip키는 원본 파싱값 기준으로 고정. 확정·서명·연도·파일 범위·skip 보호는 유지.
- 회귀: 실제 XLSX→실제 preview,수국 제목+루스커스/40cm,다른 품종 제목+유일 DB이름,동명 교차품종/무효키,수량/교차연도 및 수동/skip.
- 메뉴 기준: 원본 비교/명시 승인/재검증 적용. 새 shell/메뉴/DB schema 해당 없음.
# 배포 중 기존 선택키 보존 후속

- 품종 판별 변경 전 브라우저가 보낸 `sheet|label|family` 선택도 동일 시트·정규화 품목명이 유일할 때만 현재 키로 옮긴다. 현재 정확한 키의 선택이 항상 우선한다.
- 복수 원본 품종 또는 복수 이전 선택이면 자동 추측하지 않고 해당 행을 미매칭으로 남겨 다시 선택하도록 한다. 다른 시트/품목 선택은 적용하지 않는다.
- 수동 선택, 유효하지 않은 선택, 건너뛰기를 모두 보존한다. 적용 연도 2025/2026 교차 fixture로 확인한다.
- 기존 dnSpy/읽기 전용 DB probe 증거와 downstream 표를 그대로 적용한다. 이번 변경은 preview 선택 해석만이며 OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport 쓰기 및 수식 변경 없음.
