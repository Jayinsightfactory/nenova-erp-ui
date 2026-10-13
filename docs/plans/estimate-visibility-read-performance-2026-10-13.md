# 견적 노출 진단 조회 지연 — 사전 기준 (2026-10-13)

## 문제와 근거
- 이전 배포38333367829와 이번38333701277 모두 같은 GET estimate-visibility(year2026/week23-01/qHydrangea White)만60초후500, 나머지12검사통과.
- 운영 SELECT-only 원문재현60초 timeout, OPTION(RECOMPILE)30초timeout. 기준대상21행조회는48~65ms. SHOWPLAN10초timeout. VIEW SERVER STATE권한없어잠금배제는불가.
- 설치 EXE의 FormEstimateView를 실제 dnSpy CLI로 다시추출(output/weekday-visibility-native-20261013.txt). ViewShipment→ViewOrder OrderYearWeek2 동등조인, ShipmentDate/PeriodDay 정확시각과 DetailFix=1을 확인했다.

## 계약과 완료 기준
- 기준 SELECT TOP400의 year/weeks/q, 순서, 업체전체검색 의미 및 출력 shape 유지. 기존 cust query무시를 이번에 다른필터로바꾸지않는다.
- 복잡한 단일 상관문을 후보조회와 독립 범위집계 SELECT로 분해할 수 있다. 후보SdetailKey를 매개변수로 한정하고 SQL에서 원래조인·중복행COUNT 의미를보존, JS는numericPK별결과만합친다.
- InViewShipment/InViewOrder의 연도·차수·업체·품목 기준, 원본주문삭제필터, 날짜정확vs달력날짜비교, 두 GetDetail의 broad vs cust/prod 구분, split행수 유지.
- 모든 Order/Shipment/Stock/Estimate/Profit/확정원장과SP·인덱스 보존. NOLOCK, timeout증가, 계정권한변경, 진단skip금지. 읽기진단결과는수량저장전제의대체가아니다.
- 구현전계약갱신. 교차연도동일차수/중복join/null상세CustKey/미확정/날짜시각차이 fixture와실제격리SQL원문대조, 운영동일GETshape/성능확인후배포.

## 검증 결과
- 실제 격리 MSSQL에서 원문과 새 helper의 전체 결과 필드, 행수, 정렬 기준이 6개 조회 모두 일치했다. 교차연도, 중복 조인, NULL 상세 거래처, 정확시각 불일치, 미확정, 분할행을 포함한다.
- 동일 운영 SELECT-only 조회: 기존 60초 timeout → 새 helper 1,751ms / 21행. 영속 원장 변경 없음.
