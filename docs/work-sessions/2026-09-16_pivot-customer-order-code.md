# 피벗 거래처 주문코드 필드

## 요청·설계
거래처 정보의 주문코드를 지역/품목명처럼 피벗 배치 필드로 추가한다. `Customer.OrderCode`의 현재 마스터 값이며 주문별 `OrderMaster.OrderCode`나 거래처코드 `CustCode`와 혼용하지 않는다.

| 기준 | 원천 | 사용 위치 |
|---|---|---|
| 필드 | Customer.OrderCode → CustOrderCode, 문자열 그대로(선행 0 보존) | 기본 filter, 행/열/필터/값 이동, 정렬·필터·엑셀·즐겨찾기 |
| 결합 | 활성 Customer.CustKey PK | 주문/미발주/출고 CustKey, null·농장·재고 행은 null |
| 누락 | 없는 거래처/NULL 값은 null, 명시 빈 문자열은 빈 문자열 | 기존 피벗 빈 값 표시 |
| 조회 실패 | 기존 원본 유지 + 주문코드 조회 실패 경고 | 기존 supplement Promise.allSettled 경계 |
| 저장 조합 | 기존 normalizeLayout 자동 보완 | 예전 즐겨찾기에도 filter에 신규 필드 추가, 기존 배치 유지 |
| 연도 | 기존 normalizePivotExeRange와 원본 SQL 유지 | 교차연도 집계·키 분리 유지 |

| 사용자 동작 | Customer | Order/Shipment/Warehouse/Stock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 주문코드 조회·배치·필터·정렬·엑셀 | SELECT only | 보존 | 보존 |
| 개인 즐겨찾기 저장 | 보존 | 보존 | 보존 (기존 UserFavorite만) |

## 선확인 근거
- 실제 dnSpy.Console.exe로 설치 Nenova.exe FormQuantityPivot 및 ClassCustomer 재확인. GetData의 주문/미발주/출고는 CustKey, 재고/입고는 NULL CustKey. ClassCustomer의 OrderCode는 Customer에서 읽고 저장하는 문자열 속성.
- FormQuantityPivot 원본 UNION·수량 SQL은 변경하지 않고 별도 Customer SELECT 후 CustKey로 행 수를 늘리지 않는 보강.
- 운영 거래처관리 읽기 전용 UI(2026-09-16): 673행, 주문코드 열 확인. 샘플 CL22/CL77/CL88. 개인정보/연락처 기록하지 않음. 저장 클릭 없음.
- 필수 ERP 가드·체크리스트·불변식·ViewOrder/ViewShipment·Customer 구조·pivot-exe-controls 계약 확인.

## 검증 계획
동명이인 다른 CustKey, 빈값/NULL/선행0, 농장·재고 미결합, 같은 차수 다른 연도 분리, 값필터·행열 재집계·즐겨찾기 역호환·엑셀 및 보강 실패 경고. 1920×1080/100%와 작은 화면 검증.

## 작업 분담
메인 설계/근거/계약/검토/배포. IMPLEMENTER는 사전 준비된 공유 작업공간의 지정 파일만 P0_LOCAL, 모델은 도구의 상속 모델 제약으로 상속. 외부 쓰기·DB 접근·비밀값 조회 금지.

## 로컬 결과
- `test:pivot-exe` 10개, 전체 ERP 계약, `test:pivot`, manifest, dnSpy 근거, API write guard, production build 통과.
- API 보강 실패 1종/전체 실패 경고와 원본 보존, 같은 차수 다른 연도·CustKey 분리, 선행0/공백/빈문자/NULL 코드, 행열 집계·엑셀 문자열·과거 즐겨찾기 보완 fixture 통과.
- 모든 API가 로컬 메모리에서 종료되는 4행 fixture에서 필터 0012 → 수량5, 행별 코드0012/CL22/null, 가로 열 코드 헤더 및 총수량34 유지 확인.
- 실제 브라우저 1920×1080/100% 캡처: 가로 넘침 없음. 1280×800: 신규 필드 접근 가능, 가로 넘침 없음. 콘솔 오류0. 운영 데이터 쓰기 없음.
