# 패킹 결과: 전산 품목 선택과 재사용 매칭

## 근거와 범위
- 기존 미매칭은 업로드 카탈로그 기준이었다. 이를 실시간 Product 기준으로 바꾼다.
- 실제 decompile `C:/Users/USER/nenova-decompiled/Nenova/ExcelLoadingPackingList.cs` MakeTempTable/CheckData: 품목명+SIZE와 Product.ProdName의 대소문자 무시 정확 일치, Product.isDeleted=0. 원장 저장은 별도 입고 경로다.
- 2026-10-07 운영 읽기 probe `/api/products/search?country=중국&flower=장미`: HTTP200, 활성 186개. ProdKey/ProdName/CounName 확인. 운영 데이터 변경 없음.
- 결과 파일의 기존 품목명/SIZE 호환, 수량·단가·중량 검토를 유지한다. 이 작업은 입고 저장 기능을 추가하지 않는다.

## 기준 원장
|동작|기준·기본값|소비자|
|---|---|---|
|후보 읽기|활성 Product, 지원 국가, 비어 있지 않은 ProdName|목록·검색·저장 재검증 공통 helper|
|품목 선택|ProdKey, 원문 matchingDescription, 선택 국가, expectedRevision 필수|전용 API; 서버에서 실제 이름 결정|
|명칭 중복|EXE 이름만으로 구별 못하는 동일 이름은 선택 저장 금지|후보 상태 및 POST 동일|
|재사용|국가+정규화 원문(장미 length 포함) -> ProdKey; 현재 활성 품목 재검증|재업로드·결과 재생성|
|저장|웹 공동 runtime CAS와 인증 계정 이력; 성공 응답 이후 적용|전용 API·확인 모달|
|실패|초안과 모달 보존, 409 재조회 안내; 삭제/이름 변경 매칭은 조용히 다른 품목으로 대체하지 않음|UI·API|
|표|원문 품목 클릭 검색; 매칭·이슈 한 열; 1행 최소 여백, 긴 글은 title/상세|1920×1080/100%, 900/480 회귀|

## 부작용
|동작|Product|웹 매칭 기록|주문/입고/출고/재고|Estimate/ShipmentDate/Amount/Vat/isFix/WebProfitReport|
|---|---|---|---|---|
|조회·검색|SELECT|읽기|보존|보존|
|선택 저장|SELECT 재검증|CAS 저장 + 수정 계정 이력|보존|보존|
|변환/다운로드|보존|읽기|보존|보존|

## 완료 기준
- 품목 클릭 후 전산 후보 검색·선택, 저장 성공 즉시 재생성. 다음 업로드도 같은 매칭 재사용.
- 전산 품목 부재/삭제/중복/국가 불일치, CAS 충돌, 인증 실패의 근접 실패 fixture.
- 원문/매칭명 반복 카드 제거, 해당 행에 상태/메모 표시, 기존 카톡 복사 유지.
- ERP 필수 gate, build, keyboard/modal/스크롤 smoke, PR/배포/live 확인.
- 메인: 계약·서버·통합·외부 쓰기. 구현 하위 작업: 결과표와 원문 메타데이터로 파일 분리. 요청 모델 terra/luna 미제공으로 사용 가능한 sol 구현 모델 사용.

## 최종 검토에서 발견·수정
- 기존 aliasKey가 한자 원문을 제거함: 영속 전산 매칭은 NFC/대문자/공백만 정규화하는 packingSourceKey를 별도 사용한다. 기존 수입 별칭 규칙은 보존한다.
- NL 사전 집계가 다른 원문과 수동 선택을 섞음: 서로 다른 원문은 합치지 않고, 저장된 전산 매칭(및 stale 차단)을 사전 품명보다 먼저 적용한다.
