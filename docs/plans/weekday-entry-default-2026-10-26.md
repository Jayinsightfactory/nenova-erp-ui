# 2026-10-26 주광 최초 차수 선택값

사용자는 웹앱 첫 차수 선택▲▼ 실패라고 확인했다. Native Nenova Desktop의 실제 주광탭에서F5 후빈값(예:43)→▼1을 재현했다. 앞선 직접44입력→43 검사는 첫진입빈값경로를 놓쳤다.

변경: 기존 weekday-calendar defaultNext GET1회만 호출해 전산 달력의 다음 대차수를 실제값으로 채운다.분배/업체/템플릿/주기갱신 등heavy workspace는조회전마운트하지않는다. 빈칸은1로추정하지않고버튼비활성화.직접입력우선,지연응답/언마운트보호.

native: 설치Nenova.exe FormEstimateView CLI 재추출,OrderYearWeek 선택필드와PeriodDay 사용확인. 기존API normalizeNextCenterDate/selectNextShippingCenter를재사용하며SQL수정없음. 읽기전용SELECT 2026-10-26기준PeriodDay 목요일anchor202643=10/22,202644=10/29 확인. 기본44가 맞음. 원장쓰기는없다.

|동작|읽기|보존|
|---|---|---|
|첫진입|기존PeriodDay 달력GET1회|Order/Shipment/Stock/Estimate/WebProfitReport 전부|
|▲▼/직접입력|폼 state|연도·정확한선택값,지연응답은수동값보존|
|조회|기존workspace조회|기존쓰기/인쇄/확정계약불변|

메뉴기준선 적용: 가벼운초기화/명시조회/키보드/페이지스크롤.해당없음 신규메뉴·인쇄·DB쓰기.예외:이전entry무조회계약에서기본차수달력조회1회만허용(실제기본값에서증감이라는사용자요구반영).
검증: default center+entry9건통과.직접입력전44→43,빈값/실패값1추정금지,교차연도2027/01,수동입력우선,언마운트abort. 전체gate와배포후실제웹앱확인예정.
