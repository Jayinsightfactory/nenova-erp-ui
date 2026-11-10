# 2026-11-10 국가 선택 및 분배 전 업체 후보
- 실제 dnSpy FormShipmentDistribution 재추출 outputs/native-country.txt. 기존 GetCustomerList는 ViewOrder+ViewShipment+ShipmentDate 필수조인: 분배 전 업체 제외됨. 웹의 분배 작업 후보에는 주문만 있어도 보여야 하므로 별도 읽기 전용 workspaceCustomers 범위를 사용한다. native customers endpoint/SP/writer는 변경하지 않는다.
- 운영 SELECT: 2025/2026 태국45-01 다수 품종 주문업체 있음/날짜 연결 업체0. 태국45-03 주문0. 따라서 단순 출고JOIN 제거만으로 빈45-03은 해결되지 않는다.
- 국가명 버튼은 국가::(꽃 빈 선택키)로 읽기 필터. 국가 선택=해당 국가 전체 품종, 꽃 선택=국가+꽃. 즐겨찾기 별은 표시설정만. country-only에서 CountryFlower를 만들지 않아 꽃 단위 SP/확정 후보로 오해하지 않는다.
- workspaceCustomers: 선택 연도+차수+활성 주문상세+활성 품목의 국가/품종 범위. 분배/재고/출고일 JOIN 없음. 대상 주문이0개면 활성 전체업체를 noOrder=true 후보로 표시하고 명확히 안내. 선택/조회는 원장 쓰기0, 양수 신규 주문→기존분배 저장 순서 유지.
- 모든 조회·미리보기는 같은 selection/productWhere helper. 연도/차수는 기존 명시 payload. 기존 수량 초안 보존과 취소 확인 유지. 국가/품종 변경은 업체 탭에서도 표시 필터 적용.
- Orders/Shipment/Date/Farm/Stock/Estimate/WebProfitReport 전부 보존, 신규 국가/업체 선택만으로 쓰기금지. SQL 교차연도/선택 품종·국가/주문만존재/0주문 fallback/삭제/빈화면/실제브라우저 회귀 및 전체 ERP gate/영상/CI/배포 검증.

| 사용자 동작 | Order* | Shipment* / Date / Farm | Stock* | Estimate / WebProfitReport |
|---|---|---|---|---|
| 국가·품종 선택 | 보존 | 보존 | 보존 | 보존 |
| 분배 전 업체·빈 차수 후보 조회 | 보존 | 보존 | 보존 | 보존 |
| 후보 업체·품목 선택 | 보존 | 보존 | 보존 | 보존 |
| 명시 수량 저장 | 기존 양수 주문등록 정책 | 기존 분배 writer | 기존 확정·재고 guard | 기존 downstream guard |

후속 확인: 주문도 품목도 없는45-03 업체를 고른 뒤 품목추가를 열 때도 전체 활성
카탈로그를 불러온다. native 목록의 빠진 국가/입수 메타데이터만 채우고 현재차수
수량 및 명시0단가는 보존한다. 품목 선택만으로 주문을 생성하지 않는 브라우저 회귀 PASS.
