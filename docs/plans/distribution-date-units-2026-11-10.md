# 출고일 순서와 단·송이 표시
## 기준과 근거
최신 사용자 요청이 이전 월~일 강제정렬보다 우선. 실제 dnSpy CLI outputs/native-date-units.txt GetCustomerList=PeriodDay.BaseYmd/WeekDay 실제날짜 및 ShipmentDate 정확연결. ShipmentQuantityToEstQuantity: 박스→단 BunchOf1Box, 박스→송이 SteamOf1Box 우선/없으면 Bunch*SteamOf1Bunch, 단→송이는 SteamOf1Bunch, 송이→단은 그 역수. 기존 generic perBox helper는 native 단→송이 우선순위와 다를 수 있어 날짜전용 순수helper와 canonical nativeDateEstimate 대조 fixture로 고정.
운영 SELECT:2026/45=11/4수~11/10화,2025/45=11/5수~11/11화;46도해당연도실제7일. Product3513=박스/견적단,15단/300송이/단20송이. 월~일 재정렬이 날짜 역행의 원인이며 DB 날짜오염 아님.
## 부작용
날짜순 표시·단위전환·입력초안은 Order*,Shipment*,Stock*,Estimate,Profit 전부 보존. 기존 date-only 명시저장만 기존 writer/gate/lease/snapshot/정수견적환산·금액/rollback 사용. 저장 원장단위 변경0.
## 기준 원장
- 날짜는 선택 연도+차수 native PeriodDay 그대로 오름차순. 기간 yyyy/mm/dd~yyyy/mm/dd 표시. ISO/오늘로 추정0.
- 숫자는 단/송이 정수: 기본 단(전체 저장날짜+총량을 정확히 정수환산할 때), 불가하면 송이. native송이는 우선 유지. 입수0/누락/정수환산불가면 반올림·가짜factor 없이 진단/보호.
- 입력은 선택 물리단위의0이상정수, native OutUnit으로 정확히 역환산해 기존 소수3자리 payload만 허용.1송이=1/300박스처럼 현재 저장정밀도로 정확표현불가하면 반올림하지 않고 안내/저장차단.
- 단위변경은 미저장 없음 때만, 초안은 native량과 unit/raw표시값 유지. GET master입수까지 signature 재검증해 편집중입수변경 차단. 매출/견적 원장은 기존 정책 보존.
- 메뉴기준선: 기존팝업/접근성/키보드/가이드 적용, 새메뉴·권한·원장정책 변경 해당없음. 이전 월~일 기준은 최신 사용자 정정으로 예외.
