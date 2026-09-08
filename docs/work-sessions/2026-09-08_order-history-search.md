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
