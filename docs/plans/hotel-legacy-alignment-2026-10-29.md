# 이전 호텔 초안 위치 복구

원본 이미지가 같은 현재 연도/차수 초안의 행 위치를 재사용한다. 후보는 원본 품목명(공백/구두점 정규화)+원본 수량으로 유일하게 일치하고 sourceBox가 유효해야 한다. 중복/충돌은 추측하지 않는다. 모든 누락행이 확인될 때만 적용. 없는 경우 명시적인 원본 위치 다시 읽기로 기존 이미지 parse 수행, 같은 유일 일치 계약 적용. qty/unit/prodKey/id/year/week/allocations/receipts/history 보존.

|동작|부작용|
|---|---|
|불러오기 위치 복구|동일 계정/연도/차수 기존 GET만 사용, 위치 sourceBox만 기존 CAS 초안 저장|
|위치 다시 읽기|인증 이미지 GET와 기존 parse API, 위치만 저장; 후보 매칭 결과는 버림|
|실패/중복/행누락|전체 보존, 오류 안내|

ERP 공유 원장/SQL/API 정책 변경없음. OrderYear+OrderWeek+CustKey+ProdKey 보존. 기존 FormOrderAdd dnSpy/probe 근거 적용. 단일 shell/기본키보드/페이지스크롤 적용, 신규메뉴/ERP쓰기 해당없음.
