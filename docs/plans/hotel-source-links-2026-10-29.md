# 호텔 다중표 원본 연결과 여백 축소

원본 이미지의 좌우 다중표 때문에 전체 가로줄 정렬이 불가능한 사례. 신규 OCR에 품목별 정규화 sourceBox 요청, 유효한 좌표만 반환. 품목/단위/수량 기존 정규화 보존. 기존 자료는 명시 선택행→원본 클릭으로 위치 지정, 일반 hover는 저장하지 않음. 선택행 원본 강조 및 연결선. 반복 원문열 재도입 없음. 최소행40→30px,컨트롤32→26px,설명/도구 여백 축소.

|동작|부작용|
|---|---|
|OCR|기존 SELECT/LLM,sourceBox 표시정보만 추가; ERP쓰기0|
|행 hover/focus|원본 highlight/line 표시,쓰기0|
|위치 지정|기존 server draft/CAS에 row.sourceBox만 저장,qty/unit/prodKey 보존|
|수량/매칭|기존 흐름 그대로|

업무키OrderYear+OrderWeek+CustKey+ProdKey 및 Order/Shipment/Stock/Estimate/WebProfitReport/금액/확정 정책 변경없음. 기존 FormOrderAdd 실제dnSpy/읽기probe 근거 적용. 새로운SQL없음. 계약/교차연도 fixture/API bbox회귀/빌드/실브라우저 확인. 메뉴기준 단일shell/키보드/페이지스크롤 적용,좌표지정은 이미지 포인팅 보조기능. 실제OCR 좌표는 추정 가능하므로 사용자 수정 제공.
