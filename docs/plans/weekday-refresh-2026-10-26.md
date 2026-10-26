# 2026-10-26 주광 차수 선택·자동 갱신

## 요청과 원인
-44에서 아래 버튼을 눌렀을 때1로 바뀐다는 신고. 운영 Chrome에서 직접44 입력 후 감소는43으로 동작하여 신고 경로 자체는 재현되지 않았다. DOM stepDown 직접 변경을 제거하고 visible value/React state를 사용한 경계 보존 산술로 보강한다.
-2026/01 조회의 이전 대차수2025/52를 선출고 GET이 year>=2026 조건으로 거부했다. GET만 명시조회 범위2000..2200로 일치시키며 쓰기2026+ 제한은 보존한다.
-2026/01~02의 ShipmentDate.EstQuantity가 NULL인 과거 자료 때문에 기준 미리보기 INVALID_ERP_DATES가 반환되고, 이를 전체 자동 갱신 실패로 처리했다. 해당 후보는 error/빈 rows로 유지하되 독립 검증된 최신 분배 갱신을 차단하지 않는다. 기준 확정 검사는 변경하지 않는다. 기타 네트워크/응답 오류는 이전 스냅샷을 유지한다.

## native / SELECT 근거
2026-10-26 설치본 C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe의 ClassShipmentDate를 dnSpy.Console.exe로 직접 재추출했다. GetInsertQuery는 ShipmentQuantity와 EstQuantity를 별도 저장하고, UPDATE 견적 경로는 EstQuantity/Amount/Vat/Descr를 SdateKey로 변경한다. 분배 조회의 성공을 견적량의 완전성으로 판단하면 안 된다. NULL을0으로 보정하지 않는다.
동일 MSSQL SELECT: 고객533,2026/01-01 날짜66행/EstQuantity NULL66,01-02 53/53,02-01 64/64,02-02 47/47. ShipmentQuantity NULL/음수 및 날짜NULL은 모두0건.42~43 조회한 날짜343행은 위 NULL/음수0건. 실제 baseline SQL43-01은93품목 정상 검증. 개인정보 없는 집계만 기록. 원본 probe는 ignored output에만 둔다.

## 영향 표
|동작|읽기|쓰기·영향|
|---|---|---|
|차수 +/-|폼 값|로컬 state만, 연도 불변|
|자동 조회|기존 compare/baseline/confirmation/Wilson/early/carryover|초안 보존, 기준 확정 금지 유지|
|과거 선출고 GET|PeriodDay, 선출고 연결 이력(연도+대차수+업체)|등록/취소 경로 불변|
|ERP downstream|ShipmentDetail/ShipmentDate/Estimate/WebProfitReport|수량·단가·Amount/Vat/isFix·재고·주문·견적 쓰기 없음|

## 메뉴 기준선
적용: 명시조회, 기존 page scroll/가로표, 키보드 표준입력 및 버튼 접근. 해당 없음: 새 메뉴/shell/모달/보고서 양식. 예외 없음.
## 검증
대상 회귀29건 통과:44→43,경계,연도보존,2025/52 vs2026/52,legacy baseline reject+초안보존,critical failure retention,strict baseline confirm guards. 전체 gate와 배포/브라우저 결과는 세션 기록에 추가한다.
