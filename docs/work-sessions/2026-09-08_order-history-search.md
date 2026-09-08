# 주문 변경이력 상시 진입·검색

## Q / A
- Q: 분석 전에도 작업 히스토리를 열고, 차수·거래처·품목 검색을 보완해 달라.
- A: 상단 상시 버튼 + 연도/본차수/세부차수/거래처/품목 검색과 500건 단위 페이지 조회. 조회 전용이며 분배만 변경/실패·롤백 내역은 포함하지 않는다고 명시.

## 구현 전 기준/부작용
- OrderHistory → OrderDetail → OrderMaster, Customer/Product LEFT JOIN 기존 읽기 경로. 모든 ERP/견적/매출/재고 테이블 보존, 신규 쓰기 없음.
- 실제 설치 EXE dnSpy.Console --no-color -t ClassOrderHistory: OrderHistoryKey, ChangeDtm, OrderDetailKey 및 Insert 컬럼 확인. FormOrderAdd 이력 조회는 동일 연결키로 FormHistory 표시.
- 연도는 명시값/full week 우선, 생략만 현재년도. 전체차수도 연도 유지. 서로 다른 명시연도는 400.
- 빈 차수=연도 전체, 36차=36-01~36-99 범위, 36-1=36-01. 숫자0/오류형식은 전체로 넓히지 않고 거부.
- 검색 문자열은 SQL 파라미터와 LIKE escape. 검색은 과거 이력만 필터링하며 매칭값/원장 변경 없음.
- 500개 제한을 숨기지 않고 다음 페이지로 조회. 최신 요청 아닌 응답은 화면에 반영하지 않음.
- 상단 버튼의 현재차수 연도 전달, 검색초기화는 선택연도 유지. 1920×1080 기준.
- orchestration 지침 파일은 저장소에 없음. UI만 저비용 하위작업, 설계·API·검증·배포는 메인.

## 검증/배포
- 구현 전 운영 GET /api/orders/history?week=2026-36-01: 200 성공, 최근 500행, 기존 반환 연도 필드 없음 확인. 읽기만 수행.
- 새 주문이력 helper/API 실행형 테스트, manifest, dnSpy, write guard, build 통과.
- 로컬 Chrome 1920×1080/100% mock-read-only smoke 통과: 분석 전 상단 버튼 표시, 36차+상희+Novia 검색 Enter 제출, 검색 유지 페이지2 조회, 문서 가로넘침 없음, pageerror 0. 운영 반영 검증은 아직 아님.
- **배포 차단**: test:erp-contract가 기존 shillaPnlParse.test.js:322의 사용자 Desktop 원본 선택검증에서 실패. 고정 기대 35개 단일차수 vs 현재 파일 36개. 신라 파서/테스트는 origin/master와 동일(이번 diff 없음). 파일·테스트를 바꾸거나 검사를 건너뛰지 않음.
- 미완: 신라 원본 변경과 fixture 기준의 별도 확인/승인 → 전체 계약 재실행 → PR 병합·배포·운영 스모크. 원본 파일은 수정하지 않음.
- outputs/의 진단 스크립트·스크린샷은 커밋 제외.

## 배포 재개 / 불량차감 재클릭 문의
- Q: 배포하고, 영업수입불량차감 등록 후 기존창 오류가 남는 이유와 재클릭 시 두 배 등록되는지 확인.
- 사용자 창은 이미 닫힘. 정확한 오류 문구/차수가 아직 없어 해당 실행의 성공·실패 또는 중복 여부는 단정하지 않음.
- 코드 확인: 검토창은 10건씩 저장한 뒤 registration-preview로 다시 조회한다. 저장 이후 조회 실패도 catch로 오류 표시되므로 오류 표시만으로 전체 롤백을 뜻하지 않는다. 본창 실시간 로그는 과거 오류 로그를 완료 후에도 보존한다.
- 확인한 추가 경로: 이월 전량 처리 후 RemainingQuantity=0이면 registrationPreview의 assertConfirmedForRegistration→assertRemainingForRegistration이 '잔여수량이 없는 완료 행'을 row.error에 넣는다. 기존 Estimate는 before에 남고, 완료 검증과 행 오류가 공존할 수 있다. 사용자 사례와 동일한지는 미확인.
- 일반 동일 DeductionKey는 연결 EstimateKey UPDATE(가산 아님). 이월 동일 DeductionKey+RequestKey는 기존 Application 재사용, DB unique index/행잠금 존재. 완료 잔량0은 재등록 차단. 새 업로드 원장/새 요청키 부분처리는 동일 재시도와 다르므로 무조건 중복 없다고 안내하지 않음.
- 불량차감 생산 코드/운영 원장은 변경하지 않음. salesDefectDeductionState 및 salesDefectDeductions 테스트 통과. 차수 회신 후 GET 이력/견적 연결 대조 필요.
- 배포 검사 보완: 승인 SHA의 35차 스냅샷 기대값을 변경된 개인 파일에 적용하던 테스트 문제. 생산 파서/승인 정책/사용자 엑셀은 보존하고, 항상 실행되는 합성 35→36 차수 추가 및 5개 승인 보정 fixture를 보강. 현재 파일은 일반 출처·품목 누락·비변경 검증, 승인 SHA 동일 파일만 기존 스냅샷 검증. 승인 원본 미검증은 명시하고 현재 파일을 대신 승인하지 않음.
