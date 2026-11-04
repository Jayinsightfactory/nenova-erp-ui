# 선택 불량 보류/해제
- 사용자: 체크해서 보류 이동, 자동수집 견적 충돌 및 등록가능 의미 설명.
- 원장키 DeductionKey + 원연도/차수 + RowVersionNo + 마지막 보류 HistoryKey CAS. 보류는 해당 원장만, 취소할 때 기존 가드를 재검사. 새 행/다른 차수/다른 수량 신고에 고정제외 전파 금지.
- 저장: 기존 WebSalesDefectDeductionHistory에 SUPPORT_HOLD / SUPPORT_RESUME만 추가. 원장 row를 UPDLOCK/HOLDLOCK으로 직렬화, 등록도 같은 원장 잠금을 사용. 원장 상태/수량/단가, Estimate, OrderDetail, ShipmentDetail/Date/Farm, WebProfitReport 모두 보존. DDL 없음.
- 조회/등록/미리보기/사전검증은 기존 공통 source projection + defectSourceReview에 manualHeld를 전달해 동일하게 차단.
- UI: 단가/충돌 등 미등록 행도 체크 가능, 등록은 선택 전체가 적격일 때만 가능. 보류에서 수동 보류만 해제 가능. 해제 후 시스템 검토사유가 남으면 계속 보류.
- 상태: 충돌은 같은 연도·대상부모차수·업체·품목·수량·단위의 다른 자동수집 연결 견적 존재. 업체·품목·차수·견적번호 표시. 등록가능은 해당 행 기준 미등록/적격이며 업체 전체 미등록을 의미하지 않음.
- 근거: 세션 native ClassEstimate 및 기존 원장 SELECT 근거 유지. 새 쓰기는 웹 이력뿐이며 native 견적 저장 순서 불변. 교차연도/다른 원장/동일키 CAS/원래 검토사유/재시도·다음차수·재등록 차단 테스트 필수.
