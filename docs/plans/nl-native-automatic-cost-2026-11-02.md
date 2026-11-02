# 네덜란드 기존 입고 자동 계산본

## 원인과 근거
2026/43-02 Holex Warehouse7814 SELECT-only 74행 중 상품71행. GW1226.1,
CW1364는 별도 상세행에 있으며 Box/Bunch=1은 native 보조값이다. 기존 strict
중량 비교가 이를 kg 충돌로 오판했다. 서로 다른 실제 kg가 있으면 여전히 차단한다.
운송료 상세 TPrice3689.69EUR를 그대로 사용한다. 다른 차수 비용은 복사하지 않는다.
Nicholii는 저장50단/150송이를 사용해 계산용 단당3송이로 환산한다. 원장수정 없음.

## 기준 ledger
- 원가용 EUR 환율: 조회시 현재 시장시세+15원. quote/request time 및 출처 보존.
- NL AIR 범위만 자동설정. 다른 국가의 통화·운송은 변경하지 않는다.
- 관세: Product.TariffRate의 명시0 포함 유효값 우선, 없으면 기존 nlExcelTariffRate.
- 통관: 기존 NL_FREIGHT_DEFAULT_CUSTOMS, GW×460+33000+품목수×10000+90000+220000-0.
  회사 서식 기본값(ESTIMATED)이며 실제청구/승인이 아님. 수정 가능.
- 빠진 운송료/GW/환율은 0으로 채우지 않는다. 원인을 표시하고 직접수정 경로 유지.
- 자동 버튼은 미승인 계산본만 생성. 가격·수량·sourceHash는 서버가 재조회.

## 부작용
조회/계산/다운로드는 WarehouseMaster/Detail/Product SELECT만 실행한다.
Order/Shipment/Estimate/Stock/WebProfitReport 및 승인 원가 모두 보존한다.
기존 승인원가 다운로드의 MATCH/APPROVED 검사를 우회하지 않는다.

## 검증
실제71행 계산 issues0, 전체원가25757441.861325KRW(시세1488.6+15 시점),
XLSX48356bytes 생성. 환율변동시 결과도 변경되므로 고정 정답으로 쓰지 않는다.
실웹앱/배포 검증은 작업기록에 별도 남긴다.
페이지 주스크롤·기존 shell 유지, ERP 반영전 확인은 해당없음(ERP 쓰기0).
