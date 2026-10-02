# 요일표 확정 플래그·연결 경고 분리

## 사용자 요청과 판단 기준

- 전체 미확인 배지를 실제 저장 확정/부분확정/미확정으로 구분한다.
- 권위: ShipmentDetail.isFix(양수 상세), 명시 OrderYear+메인차수 전체 세부차수·전체 거래처.
- 업체키 불일치/삭제 품목 같은 연결 진단은 확정 플래그와 별개다. 이를 경고로 보존하되
  알려진 CountryFlower의 저장 isFix 판정을 UNKNOWN으로 바꾸지 않는다.
- 누락 품종/품목으로 CountryFlower를 식별할 수 없으면 그 그룹과 전체는 미확인 유지.
- warningCount는 기존 SQL UnknownCount 진단 수. unknownCount는 품종 식별불명 수.
- 연결경고가 있는 확정 배지는 ‘확정·연결경고’로 표시. 저장/인쇄 가능 보증 아님을 명시.
- invalid count/scope/비정규 세부차수/조회실패/stale 응답은 계속 fail-closed.
- 수량 기본18px·중앙·700, 선택칸/요약내역 폭760px·본문18px·제목20px, viewport에 맞게 축소.
  숫자/입력/최초기준/잔량/합계 전부 적용. 오류/비고/단위는 보존.

## 부작용 표

|동작|Order/Shipment/Date/Farm/Stock/Estimate/WebProfitReport|웹 기준·비고·이월|
|---|---|---|
|확정 현황 SELECT·상태 표시|모두 보존|보존|
|숫자/내역창 표시 변경|모두 보존|보존|

저장·인쇄 SQL/payload/확정 SP/Quantity 계산/환산 변경 없음. 운영 보정 금지.

## 원본과 테스트

- 실제 CLI FormShipmentDistribution.GetFixStatus: ViewShipment.DetailFix=1 COUNT,
  CountryFlower+OrderYear+OrderWeek. 별도 데이터 연결 경고를 확정 플래그로 취급하지 않음.
- 운영 읽기 표본39차 total998/fixed998/연결경고606;40차 total1106/fixed334/경고318,
  41차 양수 분배없음. 이전 정책이 경고를 UNKNOWN으로 덮어 사용자 사진 상태를 만들었다.
- pure/API/SSR: 확정+경고, 부분확정+경고, 미확정+경고, 식별불명, 경고0, count모순,
  타 연도·메인차수, 조회실패 격리.
- 1920×1080/100%,1280×800: 전체 중앙18px,760px18px 선택창, 숫자 겹침·스크롤·헤더 경고.
- 전체 ERP 회귀·근거·manifest·쓰기guard·빌드 후 main만PR/병합/배포/운영 read-only 확인.
