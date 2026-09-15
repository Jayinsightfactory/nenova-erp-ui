# 왕자원예 기존 매칭과 합산 취소 이력

## 질문과 확인 결과
- 사용자: 영림은 왕자이며 기존 업체 매칭으로 확인하고 배포할 것.
- 운영 GET `/api/orders/customer-mappings`: 영림원예 → 왕자원예, CustKey 478.
- 원문 2026-09-14 09:25 휘슬러 2단 취소, 09:59 휘슬러 1박스 취소.
- 읽기 전용 정식 품목 대조: ProdKey 53, ALSTROMERIA Whistler, 1박스=16단.
- ShipmentHistory 100582: 2026-09-15 09:56:15.710, 2026/37-02, 48→30단. 합계 -18단과 일치.

## 변경 기준
- 저장된 업체 별칭의 원예 접미사 생략은 후보 업체가 하나일 때만 연결.
- 휘슬러는 정확한 ALSTROMERIA Whistler로만 연결, Butterplus/Perfection 등 제외.
- 같은 연도/차수/업체/품목/단위의 같은 방향 요청 전체 합과 유일한 이후 로그가 일치할 때 합산 근거로 표시.
- 부분집합 탐색 금지, 여러 이벤트/연도 불일치/근사시각/중복/다중출고일/잘린 자료는 제외.
- 개별 원문 완료를 직접 기록한 로그가 아니라 합산 수량 근거임을 화면 사유에 명시.

## 부작용
OrderDetail, ShipmentDetail, ShipmentDate, StockHistory, Estimate, WebProfitReport 모두 보존. 기존 API의 읽기 결과 해석만 수정. LLM 호출, 운영 원장 수정, 별칭 파일 쓰기 없음.

## 검증
`combinedHistoryEvidence.test.js`: 2+16=18, 별칭 충돌, 복수 이벤트, 타연도, 수량불일치, 다중출고일, 혼합방향, 잘린 조회.
ERP 계약 전체/manifest/쓰기 가드/빌드 검증. 임시 운영 probe는 Temp에만 보관하며 비밀값은 문서에 기록하지 않음.
