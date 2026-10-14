# 업로드 품목 매칭 확인 UI

## 목적
업로드 결과의 기본 목록은 DB 미매칭 및 정확 연결/명시 수동 확인 근거가 없는 품목만 표시한다. 전체 품목은 선택해서 조회한다. 유사도 점수는 확정의 근거가 아니다.

## 기준 ledger
- 입고 어댑터의 resolveUniqueProdKey 및 erpMatchReview를 공용 판정으로 사용한다. 생성 당시 Product snapshot(generatedErp)을 UI에 전달한다.
- 미매칭 flag/유효한 유일 ProdKey 없음: UNMATCHED. 유효 ProdKey지만 정확 원문명 또는 검증된 MANUAL 근거 없음: REVIEW. 기존 근거 통과: EXACT 또는 MANUAL.
- 기본 필터 REVIEW_REQUIRED, 전체 보기 ALL. 원본 index를 유지해 행 식별·매칭 callback이 바뀌지 않는다.
- 매칭은 기존 fresh GET/CAS 저장/성공 후 rebuild 경로만 사용한다. 서버 저장 실패 시 행을 완료로 숨기지 않는다.
- 정확/수동 완료 개수와 확인 대기 개수 요약. 전체 완료라도 수량·단위·GW/CW·원가 확인 완료로 표현하지 않는다.
- 수량/합계/이슈 요약/다운로드/입고 어댑터는 전체 원본 배열을 유지한다. 화면 필터만 적용한다.

## 부작용
| 동작 | Product | 웹 매칭 | Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport |
|---|---|---|---|
| 목록·필터·건수 | 기존 snapshot 읽기 | 보존 | 보존 |
| 품목 검색/수동 선택 저장 | 기존 GET 읽기 | 기존 CAS/작성자 이력만 | 보존 |

EXE MakeTempTable의 품명+SIZE와 CheckData 정확 품명 조인을 확인했다. 이번 작업은 ERP writer/SQL/단위 변환을 바꾸지 않는다. 기존 읽기 전용 live smoke의 Product 후보/API 근거를 사용하고 배포 후 재확인한다.

## 수용 기준
정확/수동/유사/미매칭/중복명/삭제대상/타국/근거변조 fixture. 수동 저장 성공 후 대기 감소, 실패 유지. 전체/대기 전환과 키보드 조작. 1920×1080/100% 및 작은 화면 레이아웃. 수량·금액·입고 저장 조건 보존. 전체 ERP 게이트 후 배포.
