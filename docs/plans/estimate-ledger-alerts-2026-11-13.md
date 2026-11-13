# 견적서관리 원장 연결 알림

최신 사용자 결정: 차단하지 않고 웹에서 상황을 볼 수 있게만 한다. EXE 수정, 트리거, DB DDL/DML, 자동복구 없음. 철회된 deletion-safety 초안을 포함하지 않는 origin/master72064052 전용작업트리.

기준: 실제 EXE FormEstimateView.GetExcelDetail은 Product.isDeleted=0을 필터한다. Product 삭제 뒤 남은 ShipmentDetail/Estimate는 출력 누락 위험이다. ClassEstimate.Delete는 과거 삭제감사를 남기지 않으므로 현재 DB만으로 모든 과거 물리삭제의 담당자/시각/메뉴를 알 수 없다. 웹 불량원장의 명시적 EstimateKey가 현재 없는 경우만 연결차감없음으로 표시한다(삭제확정 또는 삭제자라고 단정하지 않음).

|동작|Product/ShipmentMaster/Detail/Date/Estimate|웹불량원장|EXE/스키마/매출금액|
|---|---|---|---|
|선택차수 알림/다시확인|SELECT 보존|SELECT 보존|전부 변경0|

연도4자리+대차수1~53필수. 연도+OrderWeek의 첫 숫자(세부차수전체), 활성ShipmentMaster만, 업체/요일필터와 무관한 차수전체 알림임을 명시. Product.isDeleted=1 또는 Product실체없음과 실수량/금액잔존을 조회. 출고수량은OutQuantity/OutUnit 원값, 차감은Quantity/Unit 원값. 금액은저장Amount(공급가)이며 자동합계보정안함. LastUpdate는삭제시각/삭제자증거로표시하지않음.

불량원장테이블/필수컬럼없음은해당검사미지원으로표시,자동생성안함. 연결차감없음은활성웹원장의EstimateKey>0+적용차수우선범위+해당PK없음만검사. 의도적웹삭제의연결해제/삭제원장은제외. 연결키없는예전삭제는감지불가를항상설명. 행수종류별200개제한과전체건수를분리표시. 조회실패는경고,빈결과정상으로위장금지. 오래된응답은차수변경/재조회시폐기.

기본UI: 기존shell/버튼공통스타일 적용, 기존작업순서/새탭변경없어가이드신규제작해당없음(읽기알림추가). 페이지스크롤/키보드details/버튼,인쇄제외. 필수ERP게이트·build·실브라우저·배포후스모크미검증은완료로주장하지않음.

사용자 2026-11-13 명시 승인: ‘이번 알림만 영상 없이 배포’. 기존 두 견적 workflow의 pages/estimate.js exact source hash에만 waiver를 추가한다. 기존 영상/자막/촬영 증거를 갱신한 것처럼 처리하지 않는다.
