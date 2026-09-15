# 농장 피드백 읽기 쉬운 요약

## 범위와 부작용

목록을 농장/불량 요약, 주요 품목, 진행 상태 3열로 표시한다. 상세보기에서 전체 품목과 원본/업체/이력을 유지한다.
조회: WebSalesDefectDeduction, Product.FlowerName, 웹 피드백 테이블 SELECT만. 기존 이벤트 저장·제외·복원 권한/트랜잭션/요청 형식 불변. Order/Shipment/Estimate/Stock/Warehouse/WebProfitReport 모두 보존. 신규 migration 없음.

## 기준

- 요약은 같은 연도 고유 sourceKey의 현재 감지 원본(historical 제외)만 사용. 다른 단위 합산/순위/비중 비교 금지.
- 품목은 prodKey+단위 기준. 주요 3개는 같은 단위에서 불량수량 내림차순. 혼합 단위는 단위별 상위 3개와 단위별 분모로 비중 표시.
- 품종명은 Product.FlowerName만 사용. 누락 시 품목 수로 대체하며 영문명을 임의 추정/번역하지 않음.
- 연속 발생은 실제 모든 중간 대차수에 원본이 있을 때만. 그 외 실제 차수를 나열해 기간 중 반복으로 표시. 품목별 차수 수량 표시.
- 진행 상태는 Case.Status만: NEW 요청 전, WAITING 답변 대기, ANSWERED 답변 도착, OBSERVING 개선 관찰, CLOSED 완료, RECURRED 재발 확인. 이력 없으면 요청 전. 여러 상태면 각각 건수 표시; 새 원본은 상태를 덮지 않음.
- 요청 전/재발 확인 우선, 답변 대기 다음. 새 불량은 별도 배지. 완료는 저장 상태 그대로.
- 최신 코멘트/작성자는 한 번만 표시. 요청 문구는 안내이며 실제 외부 발송/자동 REQUEST 없음.
- 1920x1080/100% 및 좁은 화면 검증. 상태 색상+텍스트, 상위 품목명/수량/차수 읽힘, 중복 농장명과 감지 종류 나열 제거.

## 검증

반복/간헐/단일 차수, 주요 품목 정렬/비중, 중복 원본, 다른 연도, 혼합 단위, historical, null 수량, 상태+새 원본, 기존 복수 이력 보존 fixture. 전체 계약/manifest/dnSpy/쓰기 guard/build 및 가상/운영 읽기 전용 브라우저 확인.

메인 사전준비: base 73ca67f4, 인증/의존성 확인. 기존 dnSpy FormSalesDefectView.GetData와 golden 경계 재확인. 직전 운영 probe34944218149의 원본436/활성412/기존Case3 기준이며 이번 변경은 표시용 메타데이터만 추가.
