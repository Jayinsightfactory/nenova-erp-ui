# 2026-10-23 실제 송장 승인 원가 연동 검증 / 정수 표시

## 요청과 안전 범위
- 실제 인보이스로 입고·원가 승인 후 라움/초이문, 카탈로그, 피벗, 입고의 최신 원가 대조.
- 운영 DB 접속/쓰기 없음. Docker loopback 14339의 호출별 신규 DB만 사용하고 종료 후 삭제.
- 후속 지시: 도착원가는 소수점 없이 원 단위 반올림. 저장/계산 값은 유지.

## 자료와 실제 실행
- 기반 커밋 3e6846b7, 작업트리 nw-arrival-approval-e2e-1023.
- 실제 `43-2 수국 Hortensias CI Invoice.pdf`의 기존 AI 추출 캐시 중 송장2914만 사용. 전체 7송장의 신규 OCR 완전성 검증은 아님. 유료 분석 없음.
- 콜롬비아 Florentina Export S.A.S, 6품목, 48박스, 1,440송이, 상품 USD1,084.50.
- 실제 adapter → draft → preview → receipt writer/native SQL → cost revision approval → cost export.
- CO_GROUP_42_1_V1, 시험 비용 환율1400/운임100USD/통관10000KRW, 총1,668,300원. 재승인 환율1350 총1,609,075원.
- 첫 비용의 다운로드 XLSX 33,685바이트, `2026 43-02` 및 `원본수식 비교` 시트 파싱 성공.
- 기존 입력/원가 캐시만 사용하고 자동 매칭 DB 학습이나 운영 입고 등록 없음.

## 통과한 검증
1. 승인 전 2026/42-1 시험 기준 원가 유지, 신규 미승인 송장 제외.
2. 승인 후 실제 hotel history / latest catalog map / native pivot ledger / incoming reference reader 모두43-2.
3. 품목889 화이트: 환율1400에서888.1666651원/송이 =26,644.999953원/박스(30송이).
4. 재승인1350:856.6944원/송이 =25,700.833원/박스. 모든 reader 갱신.
5. 2025 동일차수 분리, live receipt mismatch / pending approval / stale document revision / TEST_ONLY basis 제외.
6. 원가 승인·조회 전후 주문/출고/재고/입고 전열 snapshot 동일. 과거 WebArrivalCostLine 동일.
7. 관련10개 회귀 테스트 및 Next build 통과(정수 표시 수정 전). 정수 표시 수정 후 관련9개 테스트 및 실제 React 렌더 통과.

## 실제 브라우저 확인
- 빌드된 실제 `/incoming`, `/raum/pnl` 라움·초이문 탭, `/catalog`, `/stats/pivot` 기존 웹 모드를 Computer Use로 확인.
- 원가 데이터는 위 격리 SQL에서 실제 loader로 조회. 비원가 호텔 헤더/손익행/피벗 수량 등은 화면용 fixture다. 전체 운영 API 인증/배포 검증을 의미하지 않는다.
- incoming 승인 금액과 최신참조 값 일치; 라움·초이문 동일 농장43-2; 카탈로그 VAT별도857원/송이; 기존웹피벗25,700.83원/박스.
- 카탈로그 기본 VAT포함을 해제한 뒤 비교. 원가는 단위/부가세/반올림 차이를 제거해서 대조해야 한다.
- 전산 피벗은 실제 ledger loader SQL 검증 완료, 전산피벗 전체 UI는 미검증. 기존웹피벗 UI는 확인.
- 브라우저 원본 PDF 업로드 클릭부터 모든 API를 무가공으로 연결한 단일 E2E는 미검증. 실제 저장/승인 경로 SQL 통합검증과 실제 표시 페이지 브라우저검증을 조합했다.
- 증거는 `.local-arrival-e2e/report.json`, `native-events.json`, 각 `*-ax.txt`, `catalog.png`, `choimun.png`; 비공개 출력이며 git 제외.

## 소수점 후속 수정
- LatestArrivalReference, HotelArrivalCostReference, 입고 actual/comparison/total, 기존웹피벗 cost/VAT를 정수 표시.
- 카탈로그와 전산피벗은 기존 정수 표시 유지.
- DB/API 계산값·환율입력·수량·엑셀 원본 계산 정밀도 변경 없음.
- 후속 코드 아직 미배포. 정수 수정 후 전체 브라우저 재실행/빌드 결과는 후속 기록 필요.
- 메뉴기준: 표시/ERP불변 적용; 새메뉴/업로드변경/키보드변경 해당없음; 브라우저 폭은 IAB 제한으로1920x1080 미검증.

검색어: arrival-approval-e2e 송장2914 최신승인원가 정수표시 소수점 원단위반올림 43-2
