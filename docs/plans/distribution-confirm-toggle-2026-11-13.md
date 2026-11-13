# 출고분배 실제 상태 확정 토글

구현 전 기준: 설치 Nenova.exe FormShipmentDistribution을 2026-11-13 dnSpy.Console로 다시 추출했다(외부 nw-confirm-toggle-1113-dnspy.log). GetFixStatus는 선택 CountryFlower의 ViewShipment.DetailFix=1을 판정한다. CounName/FlowerName 화면 분류를 CountryFlower와 동일시하지 않는다. 네덜란드 장미/튤립도 native 카테고리가 네덜란드이면 함께 처리됨을 확인창에 표시한다.

운영 SELECT 2025/2026 동일46-01 분리 확인. 2025 모두확정, 2026은 네덜란드 등 확정과 미국/콜롬비아 일부 미확정 혼재. 업무 중 상태는 바뀔 수 있으므로 과거 화면/로컬 bool을 신뢰하지 않는다. 운영 원장은 검증용으로 변경하지 않는다.

| 동작 | 허용 변경 | 보존 |
|---|---|---|
| 상태 조회/선택/새로고침 | 없음. 명시 연도+세부차수 DetailFix, Product로 선택 범위 해석 | 모든 원장 |
| 확정/취소 명시 확인 | 검증된 CountryFlower에 기존 fix API/native SP만 호출. 기존 재고/다음차수/부분확정 보호 유지 | 타카테고리 DetailFix, 전년도, OrderDetail, ShipmentDate/Farm, 수량/단가/Amount/Vat/Estimate |

기준 원장: 실제 Product.CountryFlower. 화면 기본 전체는 명시 빈 선택 객체로만 전체 카테고리 목록을 받는다. 빈 응답/잘못된 선택/조회 실패/오래된 응답이면 버튼 비활성. 확정행 하나라도 있으면 빨간 확정취소(일부 표기). 클릭 직전 재조회, 표시와 동작이 바뀌었으면 실행하지 않고 재확인 요구. POST에도 선택정보와 정확한 카테고리를 보내 서버 재해석/일치검증, native CountryFlower 인수 미지원은 전체처리 대체 금지. 이 표와 계약/실행회귀 일치 확인 후 배포한다.

검증: 실제 API+native SP LocalDB 확정→취소→재확정, 이전연도·타카테고리·주문/날짜/수량/금액 보존. 브라우저 상태/선택/에러/경합/요청범위 및 필수 ERP gates, 안내영상 재생성, CI/배포/운영 읽기전용 스모크.

## 후속 사용자 요청: 업체 presence와 분배, 고정 헤더
견적의 WebErpEditLease는 연도+메인차수+업체 단위여서 다른 품목 분배도 막고 있었다. 분배 workspace batch만 expected {outQty,cost}를 필수로 보내 native Master/Detail UPDLOCK,HOLDLOCK 안에서 변경행 단위 compare-and-set을 한다. baseline 누락400, 동시 수량/단가 변경409로 전체 배치 rollback. 다른 화면의 lease/기준 digest는 갱신하지 않으므로 그 화면이 오래된 값을 덮어쓰려 하면 기존 stale검사가 막는다. editGuard를 명시한 기존 클라이언트는 기존 lease검사도 유지. Order 등록·농장·확정·날짜/수량/금액 검증은 그대로이며, 원장 작업을 하지 않는 화면 표시만으로 분배를 차단하지 않는다.

양쪽 탭 toolbar/저장/차수/가로스크롤은 sticky. 우측 표는 별도 상하/좌우 scroll, table header sticky. 상단 스크롤바와 실제 표 양방향 동기화. 업체 하나 선택 시도 기존 pairGroupFilter와 같은 품종 선택 UI 제공, 필터로 초안/합계/저장대상 축소 금지. 신규 web ledger/migration 없음.

## 실행 결과
2026-11-13: 필수 ERP 전체 계약 검사, dnSpy evidence, 변경 API3개 write guard, 215개 manifest, npm run build 모두 통과. 실제 LocalDB 운영 API/native SP 취소→미확정 GET→재확정→확정 GET, 2025/2026 same37 전년도/타품종/주문/날짜/농장/Estimate/수량/Amount/Vat 보존 통과. 분배 실제 API 한 번 저장 2업체5/7→새 페이지 SQL GET 유지→견적/이카운트 Excel 각2행150/210단→실제xlsx재열기 통과. 다른 견적 lease 상태 row CAS 성공/변경409/누락400/lease보존 확인. 운영 writer 실행0. Chrome 종합회귀 및 40행 양쪽 내부스크롤/머리글/저장 toolbar/가로바/업체1품종 통과. 영상251.45초·1920x1080·100%,6단계 및 처음/중간/마지막 프레임 검수 완료. CI·배포·운영 읽기전용 확인은 후속 WORK_MEMORY 기록.
