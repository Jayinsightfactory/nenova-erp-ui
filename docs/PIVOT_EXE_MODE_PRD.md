# EXE 피벗 모드 구현 계약

## 목적
기존 /stats/pivot의 확장 물량표 기능을 보존하면서 EXE와 동일한 원본 15필드를 자유롭게 배치하는 전산 피벗 모드를 제공한다. 모든 기능은 좌클릭으로 접근한다. 우클릭은 필수 아님.

## 원천과 안전
- GET /api/stats/pivot-exe, fromYear/fromWeek/toYear/toWeek 명시. 조회 후보는 StockMaster 연도·차수. 연도 범위도 허용한다.
- 기존 lib/exeQuantityPivotSql.js의 sqlQuantityPivotGetData 재사용. 임의 SQL/필터 문자열 입력 금지, 파라미터 바인딩. 원본 Quantity 의미와 수량 단위는 변경하지 않는다.
- 조회 API와 UI는 모든 ERP 원장을 보존한다. POST/수정/SP/DDL 없음. UI 배치 저장은 브라우저에 배치 정보만 저장한다.
- EXE 원본 특이사항: 미발주는 NoneOutQuantity>0 조건에 OutQuantity를 집계. EXE 기준임을 접힌 근거 설명에 표시; 임의 수정하지 않는다.
- StockMaster 없는 차수는 조회 원천이 없음을 표시하며 다른 범위를 추정하지 않는다.

## 데이터 계약
- 필드 id는 원본 컬럼 그대로: CounName, FlowerName, ProdName, CountryFlower, CustArea, ShipmentDtm, UPrice, TPrice, OrderNo, CustDescr, CustName, OrderYear, OrderWeek, ListType, Quantity.
- 기본 행 CounName/FlowerName/ProdName, 열 OrderYear/OrderWeek/ListType/CustName, 값 Quantity, 나머지 필터.
- 각 필드는 정확히 한 영역에 속하거나 숨김 목록에 있다. 모든 필드 행/열/필터로 이동 가능, 숫자 필드는 값으로 이동 가능. 필드를 텍스트 값으로 집계시 개수만 제공.
- 원본 명칭 보존, null/빈값/숫자0 구분, 중복 원본 행 합산, 연도별 동일차수 분리.
- 합계/평균/최소/최대/개수 집계. 하위 평균의 합산 금지, 모든 합계는 원본 행에서 계산.
- 행과 열 그룹 접기/펼치기, 소계/총계, 정렬, 너비 조절/자동맞춤. 값이 없는 조합은 빈칸, 실제0은 설정으로 표시.
- 필터 AST AND/OR/NOT, 다중값 IN/NOT IN, 문자열 포함/시작/끝, =/!=/>/>=/</<=, 범위, null. 코드 실행 eval 금지. 필터 적용/취소, 전체 활성/비활성, 초기화.
- XLSX는 현재 필터/배치/정렬/접힘/소계/총계/표시자릿수와 동일한 모델로 생성. 숫자는 숫자, 텍스트는 문자열(수식 주입 금지).

## 좌클릭 UI
- 시작/종료 연도·차수, 새로고침, 엑셀, 닫기.
- 필드 버튼 좌클릭: 값 필터, 정렬, 영역 이동, 처음/이전/다음/끝, 숨김, 너비 자동맞춤.
- 필드 목록: 체크 표시/숨김, 영역 선택/이동, 드래그 보조.
- 화면 전체 필터 편집, 조건 추가/그룹추가/삭제, 적용/취소.
- 모든 행/열 펼침·접기, 소계/총계 토글, 표시 자릿수.
- 처리 중 상태와 실패 원인 표시. 범위 변경/요청경합 시 지난 응답 무시. 엑셀은 마지막으로 성공한 표시 범위와 일치, 새 범위 미조회 상태는 명시.
- 1920×1080 CSS px,100% 기준, 작은 화면에서도 모달/메뉴 가림 및 주요 조작 손실 금지.

## 검증
순수 집계·필터·이동·cross-year·엑셀 roundtrip 테스트; mock UI 모든 좌클릭 조작/오류/경합/가로스크롤/작은 화면; ERP 계약/manifest/쓰기 보호/빌드; 운영 읽기 검증. 미검증 기능을 완료로 표기하지 않는다.
