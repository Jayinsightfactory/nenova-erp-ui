# 신라 출고·손익·입고 기간 대조 기준 (2026-10-20)

사용자 기준: 창고 전산은 분배/출고 차수, 손익 엑셀은 차수 또는 신라 월~금 집계, 세금계산서 월은 신라 실제 입고일의 YYYY-MM. 말일 자체를 다음 달로 넘기지 않는다.

동작/부작용: prepare/compare는 WebRaumPnl/Item/Product/Customer/ShipmentMaster/Detail/Date SELECT만 수행. Order*, Shipment*, Stock*, Estimate, WebProfitReport 및 원본파일 보존. 세금계산서 발행/수정 없음.

기준표:
- 거래처: 활성 Customer.CustName 정확히 신라호텔인 유일행. 운영probe446. 신라상사444/445와 삭제된652 제외; 다중후보 실패.
- ERP: 명시 OrderYear+활성Master+Master.CustKey, 상세PK별 1행. OutQuantity/OutUnit과 EstQuantity/EstUnit 모두 표시. 비교는 저장 EstQuantity와 공급가 Amount, 단가는 Amount/EstQuantity. Cost는 native 부가세포함판매단가이므로 매입단가로 쓰지 않음. 0나누기는 미확인. 일자분할은 별도보존, 총량복제금지.
- 원본: 기존 ProdKey 연결과 사용자확인 안시리움 송이 규칙 사용. 엑셀 차수와 ERP 대차수를 동일하다고 확정하지 않음.
- 자동판정: 원본날짜 또는 같은대차수에서 가까운(14일 이내) 전산차수를 후보로 제시. 입고는 날짜별 및 월~금 묶음의 품목/단위/단가/수량/금액 일치 후보를 탐색. 같은 행집합 후보 중복 제거. 후보 복수 또는 여러 엑셀기간이 같은 전표집합을 요구하면 확인 필요. 후보는 원본 간 공통전표키가 없으므로 확정연결이 아님.
- 월집계: 조회완료 원본의 실제입고일 YYYY-MM로 집계, 품목미연결도 포함. 월의 일부만 조회되면 부분월 표시. 발행된 세금계산서 검증과 구분.
- 저장손익은 참고검증으로 별도유지; ERP와혼동되는 DB작업데이터 이름 제거.
- 검증: 같은차수다른연도, month end, 업무주/일별중복, 중복소비/동일수치복수, 520vs521, unit불명, 결측/0/음수, PK중복.

근거: 실제 dnSpy FormShipmentDistribution 실행 성공. GetCustomerList와 저장 EstQuantity 및 Amount=Cost*round(EstQuantity)/1.1 확인. 운영40-02 안시리움181 Out/Est520,Amount4316000,Cost9130; 엑셀40차521 및신라10/7 521. 이는출고원장과저장손익이서로다름을확인한읽기결과.
- EXE ViewShipment 활성Product 조건 재확인 후 원장 중 삭제품목1행 제외: 운영 화면 비교 대상314행(원장전체315행과 구분). 40-02 안시리움 차이는동일. 후보14일경계로잘린월~금도완전한주로판정하지않는반례추가.
