# 주광 요일표 소수 박스 환산 표시 / 합계 강조

## 고정 기준

- 사용자 요청: 소수 부분은 단/송이로 표현. 합계 숫자를 더 크게, 여백은 줄인다.
- 화면 기준 1920×1080 / 100%, 1280×800 추가 검증. 기존 상하 스크롤/행 강조 유지.
- 계산·입력·저장·초안·최초 기준·견적/인쇄 수량은 원본 숫자 및 원본 단위 보존.
- `Product.BunchOf1Box`, `SteamOf1Bunch`, `SteamOf1Box`를 표시에만 사용한다.
  이미 weekday-compare가 SELECT한 Product를 응답의 packaging으로 전달하며 SQL을 바꾸지 않는다.
- 업무 범위별 Product metadata만 사용하며 과거 연도/다른 차수/초안 포장값을 환산 fallback으로 쓰지 않는다.
- 환산 결과가 정수 단이면 단, 단+송이가 정확히 맞으면 복합 표시, 아니면 정수 송이를 사용한다.
  0/NULL/불일치/분할 불가능 값은 임의 반올림/1 fallback 없이 원본+환산 확인 표시.
  정수 환산 허용오차는 min(1e-6, Number.EPSILON×max(1,값)×8)인 기계 오차만 허용한다.
  0.20000001박스를3단으로 반올림하지 않는다.
- 카네이션 1.2박스(15단/박스,20송이/단,300송이/박스)는 `1박스 3단`.
  0.21박스는 `3단 3송이`. 음수는 전체 절대량을 분해 후 부호를 한 번 붙인다.
- 알스트로 48(3) 표시 합의 유지. 50단은 소수 박스 `3.125` 대신 `50(3박스 2단)`.
  알스트로의 16단/박스 표시는 명시 사용자 기준으로만 표시하며 SQL 포장값을 덮어쓰지 않는다.
- 합계 전용 큰 숫자(16px 이상)를 우선 표시, 잔량·미확정/초안 상태·변경/견적 버튼 구분.
  패딩 1~3px, 탭 숫자 정렬, wrap 허용. 표/입력 숫자 14px 이상, 원본 툴팁 보존.

## ERP 부작용 행렬

| 동작 | Product | Order/Shipment/Date/Farm | Baseline/Notes/History | Stock/Estimate/Profit |
|---|---|---|---|---|
| 환산 표시/합계 강조 | 기존 SELECT값 재사용, 보존 | 보존 | 보존 | 보존 |
| 기존 수량 편집/저장/출력 | 기존 정책 보존 | 기존 payload/handler 보존 | 기존 정책 보존 | 기존 정책 보존 |

## 실제 근거

- decompile `FormShipmentDistribution.cs` 720~722: Product의 세 포장 필드, 단/송이/박스 환산.
- 운영 읽기 전용 product-search: 콜롬비아 카네이션 Moon Light(447), Doncel(389), Caramel(363):
  OutUnit=박스, BunchOf1Box=15, SteamOf1Bunch=20, SteamOf1Box=300. DB 수정 없음.
- 기존 FormEstimateView 출력 근거/요일 저장 계약은 보존하며 인쇄 helper를 수정하지 않는다.

## 검증 및 역할

- 메인: 고성능 설계·계약·환산 helper 및 API 연결, 외부 쓰기/병합/배포만 수행.
- 구현: 사용 가능한 gpt-6.1-sol/high (지정 terra 미제공), component만 수정.
- 기계 검증: gpt-6-luna/high, 별도 순수 fixture/브라우저 표시 검증.
- 독립 최종 검토: gpt-6-astra/high. 하위 작업 P0_LOCAL, 승인/DB/secret/push/병합/배포 금지.
- 준비된 node_modules/Node24/Playwright 사용. 금액·수량 mutation 테스트는 로컬 격리 fixture만.
- 정수/분수/음수/0/누락/0 factor/충돌/cross-year/알스트로 fixture, 기존 저장 회귀,
  전체 ERP gates, production 빌드, 실제 운영 read-only 화면 검증 후 배포 완료 판정.
