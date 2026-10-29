# 호텔 다중표 원본 연결과 여백 축소

원본 이미지의 좌우 다중표 때문에 전체 가로줄 정렬이 불가능한 사례. 신규 OCR에 품목별 정규화 sourceBox 요청, 유효한 좌표만 반환. 품목/단위/수량 기존 정규화 보존. 기존 자료는 명시 선택행→원본 클릭으로 위치 지정, 일반 hover는 저장하지 않음. 선택행 원본 강조 및 연결선. 반복 원문열 재도입 없음. 최소행40→30px,컨트롤32→26px,설명/도구 여백 축소.

|동작|부작용|
|---|---|
|OCR|기존 SELECT/LLM,sourceBox 표시정보만 추가; ERP쓰기0|
|행 hover/focus|원본 highlight/line 표시,쓰기0|
|위치 지정|기존 server draft/CAS에 row.sourceBox만 저장,qty/unit/prodKey 보존|
|수량/매칭|기존 흐름 그대로|

업무키OrderYear+OrderWeek+CustKey+ProdKey 및 Order/Shipment/Stock/Estimate/WebProfitReport/금액/확정 정책 변경없음. 기존 FormOrderAdd 실제dnSpy/읽기probe 근거 적용. 새로운SQL없음. 계약/교차연도 fixture/API bbox회귀/빌드/실브라우저 확인. 메뉴기준 단일shell/키보드/페이지스크롤 적용,좌표지정은 이미지 포인팅 보조기능. 실제OCR 좌표는 추정 가능하므로 사용자 수정 제공.


### 2026-10-29 좌우 표 분리 비교
- 원본 행 좌표의 가로 영역으로 2~4개 표를 구분하고 각 표 이미지와 해당 매칭 행을 나란히 표시. 이미지 바깥 공백을 잘라내고 패널 간격 8px, 이미지-매칭 간격 4px, 행 높이 30px/입력 높이 26px 적용.
- 좌표가 없는 기존 자료는 전체 원본 비교와 위치 지정 기능 유지. 좌표 변환은 표시 전용이며 수량/업체/ERP 원장 변경 없음.
- 검색어: 호텔 좌우 표 이미지 분리 매칭 여백 hotelSourcePanels

- 2026-10-29 운영 OCR 검증 보완: 위치 좌표가 원본 행보다 짧거나 위로 치우치면 세로 crop이 품목을 숨기는 문제 확인. 표별 가로 분리는 유지하고 원본 세로 범위는 전체 보존. 검색어: 호텔 원본 세로 잘림 crop safety
