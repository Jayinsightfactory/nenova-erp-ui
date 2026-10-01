# 주광 잔량 이월·수정 이력 / 중심 차수 +1

## 사용자 합의와 부작용

- 37차 마감 잔량을 수정하면 38차 잔량에 이월 합산한다. 이어지는 차수도 같은 품목/OutUnit에서 연결한다.
- 최초분배 불변 기준, Order/Shipment/Date/Farm/Stock/Estimate/WebProfitReport 모두 보존한다.
- 웹 전용 private runtime 잔량 기록만 저장한다. SQL DDL·원장 보정·공용 SP 수정 없음.
- 마감 잔량 수동 지정은 해당 차수의 ending override다. 다음 차수 잔량=이월+당차 기준-출고.
- 명시 0도 유효하다. 음수는 부족 잔량으로 표시한다. 단위·업체·연도·차수 혼합 금지.
- 직접 지정이 시작되기 전의 미등록 이월을 실제 재고 0이라고 주장하지 않는다. 기존 차수별 잔량을 유지하고 '이월 미등록'으로 구분한다.
- 최초 수동 마감 이후 계산된 마감 잔량은 다음 차수로 연속 연결한다. 새 수동 마감값은 그 차수부터 새 기준이다.
- 출고 초안이 있으면 이월도 예상값으로만 표시하며 견적 수량/금액에는 섞지 않는다.
- 최초 미확정 기준은 기존 preview 의미 그대로 '미확정 예상'으로 구분. 날짜합계/단위/달력 불명은 null, 임의 0 금지.

## 계약

### 저장

`lib/weekdayCarryoverStore.js`: private `data/runtime/weekday-carryovers`.
업무키 year+majorWeek+custKey+prodKey. record: version, 업무키, startDate(서버 달력), unit,
quantity, revision, updatedAt/By, history[]. history에는 before/after, reason, actor, timestamp/revision.
atomic envelope+digest, 파일 권한0600/dir0700, exclusive lock, revision 충돌, 손상 파일 fail closed.
현재값/전체 이력 같은 원자 파일. 이력은 임의 삭제/절단 금지(한도 초과는 저장 거부).
save input {year,majorWeek,custKey,prodKey,unit,quantity,reason,expectedRevision}, startDate는 서버 주입.
listCustomer(custKey)로 같은 업체 기록만 읽기. 기존 비고/최초 파일은 수정하지 않는다.

### API

`GET /api/estimate/weekday-carryover?year&majorWeek&custKey`: 활성 고객, PeriodDay의 실제 전후3차수,
이전 수동 마감 anchor부터 보이는 마지막 차수까지(최대104주; 초과는 명시 오류) 읽는다.
반환 {success,readOnly:true,records,context:{cycles,inputs}}.
cycles={year,majorWeek,startDate,endDate,calendarState,days}; inputs={year,majorWeek,startDate,prodKey,
prodName,flowerName,outUnit,unit,basis,allocated,provisional,valid,error}.
기준은 보관된 최초01+02 우선, 없는 세부차수는 현재 ERP detail 총량의 미확정 preview를 사용.
allocated는 실제 같은 업무차수 날짜 수량의 합. 범위 밖 날짜/합계 불일치/단위 불명은 valid:false.
목요일 anchor는 정확하고 7일 간격이어야 한다. 연도 경계는 PeriodDay 식별자를 그대로 사용.
제품 키는 visible ERP/최초/마감 기록에서 얻는다. 없는 날짜/상세는 SELECT 결과의 명시 부재로만0.
POST: 활성 계정·고객·품목, 실제 현재 OutUnit 일치, 달력 유일 anchor 및 해당 scope에 ERP/최초 기준이 있는지 SELECT 재검증.
서버 startDate로 저장하고 {success,record,erpChanged:false}. 기존 carry 기록만으로 eligibility를 만들지 않는다.

### 화면/계산

`lib/weekdayCarryover.js`: 순수 ledger helper. context를 날짜 순서대로 평가, 수동 마감이 없는 동안 기존 잔량 유지.
수동 seed 후 incoming+baseRemainder, 단위/달력/수량 오류는 전파하며 뒤 수동 마감만 재시작 가능.
visible matrix의 effective remainder로 inputs를 덮어 예상 초안 반영; 기존 sum/quote는 보존.
화면 밖 차수에 미저장 초안이 남아 있으면 저장 전산값으로 조용히 복귀하지 않고 이월을 미확인으로 표시한다. 유효 수동 마감 이후의 계산 의존상태는 재시작한다.
합계 옆 마감잔량 버튼 → 팝오버 입력·사유·수정 이력. 01 잔량은 이월 포함 파생값(마감 수정은 대차수 합계 영역).
이월 원천 차수와 수량을 한 줄 표시. 저장 후 재조회/재계산, 실패는 입력 유지, stale revision 안내.
수동 잔량/이월만 있는 품목도 숨기지 않는다. 다른 업체/차수 늦은 응답 무시.

### 중심 기본값

목~수 업무주를 PeriodDay 목요일 anchor로 찾고 실제 다음 anchor(+7일)를 중심으로 한다.
한국 날짜를 mount 후 API로 전달, SSR 첫값은 빈 입력(38 하드코딩 제거). 명시 사용자 연도/차수/좌우 이동은 자동 기본값으로 덮지 않는다.
일반 calendar API 기존 명시 조회 의미 유지. 새 default mode는 GET SELECT만 수행.

## 검증

37 마감5 →38 기준10/출고8→잔량7→39 기준4/출고3→잔량8.
명시0, 음수, 단위충돌,2025동일37차 배제, 연도경계, 화면 중심 이동 후 동일값,
이력 before/after/reason/actor, stale revision, 동시저장, 손상/실패 원자성, 초안/인쇄 분리.
1920×1080/100% 및1280×800 겹침·팝오버·스크롤. 전체 ERP gates/build 및 운영 read-only smoke.

## 작업 경계

사용자 추가 지적: 일요일 수량 편집 차단. 같은 날짜 01의 실제 양수와 02의 취소0 기록을 복수 원천으로 잘못 판단했다. 원문·합계·0 기록은 보존하고 편집 원천만 실제 nonzero 차수로 선택한다. 양쪽 실제 수량/불명 수량/단위충돌은 여전히 명시 차단한다. 전부0이면 실제 기록 중 달력 차수가 있는 경우에만 그 업무키를 사용한다.

앞서 진단한 CALENDAR_TIMESTAMP_MISMATCH 수정은 이번 잔량 원장 구현과 분리한다. 운영 출고 수량 수정/테스트는 하지 않는다.
하위작업 P0_LOCAL만. 메인만 push/PR/병합/배포. 구현모델 gpt-6.1-sol/high(terra 미제공), 기계검증 gpt-6-luna/high, 독립리뷰 gpt-6-astra/high.
