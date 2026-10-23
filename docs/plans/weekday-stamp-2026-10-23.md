# 2026-10-23 주광 견적서 직인

사용자 제공 PNG를 변형 없이 배포 secret으로 저장(공개 저장소에 원본 제외)한다. 인증된 기존 출력 조회 응답에 포함하고 주광 native 인쇄 헤더에만 배치한다. 원본 사진 기준 오른쪽 11mm, 로고 아래 1.4mm, 지름 21mm. 흰 배경은 multiply 합성으로 표를 가리지 않게 한다.

인쇄 미리보기/출력 동작: OrderDetail, ShipmentDetail, ShipmentDate, ShipmentFarm, Estimate, Stock, Amount/Vat/isFix, WebProfitReport 모두 보존. SQL 변경 없음. 기존 dnSpy ReportEstimate 좌표 및 읽기 전용 검증 근거는 weekday-print-native 세션을 재사용한다.

기준선: 기존 shell/키보드/페이지 스크롤 적용 유지. 신규 메뉴/원장 쓰기 해당 없음. 원본 직인 복제이며 이미지 생성 없음. 자산은 공개 URL 없이 인증된 출력 API에서 전달. 이미지 decode 완료 후 인쇄하는 기존 경로 유지. 다중 날짜마다 헤더에 한 번 표시. 테스트/빌드 후 PR 및 배포, 브라우저 확인.
