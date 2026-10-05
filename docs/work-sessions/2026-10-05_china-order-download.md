# 중국 발주 현황 다운로드 — 2026-10-05

| 항목 | 내용 |
|---|---|
| 화면 | 중국 발주 현황 다운로드 `/stats/china-order-download` |
| 기준 브랜치 | origin/master 9916866c, 독립 codex/china-order-download |
| 원장 부작용 | SQL SELECT만, 기존 EXE/주문/분배/출고/입고/재고/견적/Product 변경 없음 |
| 구현/배포 | 로컬 기능·ERP 회귀·브라우저·빌드 검증 완료, PR #867 검증 후 배포 예정 |
| PR | https://github.com/Jayinsightfactory/nenova-erp-ui/pull/867 |

## 고정 결정
- 최신 합의: 중심차수 이전3+현재+다음3, 총7개 **메인차수는 선택 범위**. 범위 내 모든 실제 세부차수를 선택 목록으로 제공하고, **화면·엑셀은 선택한 세부차수 하나만** 표시한다. 업체명·CL 코드·품목·HF·단위·수량을 함께 보여준다. 최초 메인차수 합산 표시 결정은 폐기.
- 기본 중심차수는 KST 현재일의 실제 PeriodDay 목요일 업무주. ISO 주차/항상52주 추측 금지.
- 수량은 native ViewOrder.OutQuantity 양수 중국 주문등록 기준이다. 출고/분배나 환산세열 합계를 대신 사용하지 않는다. 단위별 합계.
- 첨부파일416품목/126명시 HF CODE를 기본 사전으로 적용. 업로드의 보조 HF match review Status는 경고로 보존, Closest catalogue code로 HF 빈칸 채우기 금지.
- HF 재업로드는 로그인 사용자별 **현재 브라우저** 사전이다. 다른 사용자/브라우저에 공유 저장하거나 ERP Product를 갱신하지 않는다.
- 조회범위 변경·실패·로딩·HF 작업 중 이전 모델 다운로드 금지. malformed storage는 기본사전 복원, 잘못된 업로드는 기존 사전 유지.

## Q&A
### 1. 메뉴와 HF CODE
**Q.** 중국 발주 현황 다운로드 페이지, 해당 차수 중국 주문등록 품목/수량과 첨부 HF CODE 표시/엑셀 요청.
**A.** 새 메뉴·조회 API·HF 정확키 매칭·브라우저 업로드·4개 시트 XLSX 구현. 품목번호/코드 모순이나 중복명 후보는 임의 선택하지 않는다.

### 2. 차수 범위
**Q.** 이전3개+현재+다음3개 총7개.
**A.** 실제 전산 달력을 연도 경계까지 연결한다. 누락·중복·불연속이면 부분7차수 결과 대신 오류. center 선택과 이전/다음 버튼, 재조회 제공.

### 3. 업체 클라이언트 번호
**Q.** 주문등록 업체의 전산 CL2, CLS 등 업체 코드까지 넣어 발주서 다운로드.
**A.** CustKey로 활성 Customer.OrderCode를 SELECT 연결, API custOrderCode 제공. 업체별발주 7차수 집계와 주문상세에 실제 CL 코드 문자열 포함. 내부키·CustCode·주문별 OrderCode로 추정 금지, 코드 없는 업체는 빈값과 경고. 기존 총수량 유지.

## 근거와 검증
- 실제 dnSpy.Console.exe --no-color -t FormQuantityPivot 설치 EXE 확인. GetData 주문 영역 vo.OutQuantity / ViewOrder. 문서 `docs/exe-golden/ChinaOrderDownload.md`.
- 운영 read-only: 2026/37~43 중국 주문1332행 fixture, 전체 활성 중국416품목 모두 첨부 ProdKey/ProdCode 일치. 해당 차수 달력 실제 조회.
- 실제 첨부 재업로드 파서와 기본사전의416품목 결과 차이0: missing287/conflict3/review64/matched62. 품목코드가 비어 있는 원본3행은 키만으로 일치시키지 않고 충돌로 표시. 원본 No match와 실제HF가 함께 있으면 HF보존+경고.
- 기능테스트, 전체 test:erp-contract, dnSpy evidence, staged 변경 API1개 write-scope, manifest78개 검사, production build 통과. 최종 HF 경계: 품목키+코드 검증, 중복 검토상태 순서 독립, 숫자 코드0마스크 선행0 보존/안전하지 않은 숫자서식 거부를 회귀검사한다.
- 브라우저1920×1080/100%: 169품목 7차수 가로 잘림없음, 숫자14px 진한 중앙, popup shell1/sidebar0, 일반 shell1/sidebar1. HF 검색·원본 업로드·실제XLSX 다운로드. 1100×800 문서 폭1100/표 내부 가로1280 정상.
- malformed storage 복원, 선택 차수 stale/서버scope mismatch/조회500 다운로드 차단, HF 복원이 조회오류를 숨기지 않음 검증.
- XLSX 네이티브 재독해 숫자/빈HF/원본명/세부차수/실제 CL 코드 검증 및 4시트 렌더. 운영 표본42업체의 CL2/CLS 등 현재 전산코드, 업체별발주579행+헤더, 주문상세1332행+헤더. 미리보기 도구의 빈 shared-string 인덱스 오독은 원본 ExcelJS 값으로 미리보기만 교정; 다운로드 파일 빈 HF 정상. 긴 품목명 행 높이 자동 계산.
- 최신 master 9c63260b 통합 후 기능15개, 전체 ERP 계약, manifest78개, 변경API1개 write-scope, dnSpy evidence, production build 최종 통과. 배포후 운영 대조 결과는 아래 후속 기록으로 남긴다.

## 모델·범위
- 설계/리뷰 gpt-5.6-sol xhigh P0_LOCAL. 지정 구현 gpt-5.6-terra 제공되지 않아 gpt-6-luna high로 대체(분리 UI와 HF/Excel 담당). 메인이 입력/의존성/운영읽기/계약/통합/외부반영 담당.
- 하위 작업은 승인창·외부 쓰기·운영 원장 쓰기 없음. 필요한 실제 첨부 검증은 메인이 수행.
- 기존 dirty primary 작업은 보존. output/**, .next-china-*/**는 운영 표본/임시 QA 산출물이며 커밋 금지. 인증정보 기록 금지.

## 이어받기
이 문서와 `docs/plans/china-order-download-2026-10-05.md`, `docs/contracts/china-order-download.json`을 읽는다. 주문 수량 또는 HF 변경 요청은 조회전용 계약을 ERP 쓰기 요청으로 확대하지 않는다. 공유 HF 사전 요구는 별도 저장범위 합의가 필요하다.

## 배포 후 정정 Q&A
### 4. 최초 배포 확인
**A.** PR #867 squash master `3d2298d049a29df81ccdb31a0cb3e19664640c31`, Cafe24 run37252994467 성공. 운영 읽기·1920 브라우저·다운로드 대조 당시1,336 주문/42업체 CL 값 확인. 최초 배포는 메인차수 합산 화면이었다.

### 5. 세부차수 범위
**Q.** 차수가 세부차수로 표시되어야 한다. 7개 메인차수 안의 세부차수를 모두 표시(예37-01,37-02…43-02).
**A.** 조회 범위7메인은 유지하고 실제 원본 OrderWeek를 전부 식별한다. 40-03도 운영 양수 중국 주문에 존재하므로01/02 고정 금지. 주문 없는 메인차수에서 가짜 세부차수를 생성하지 않는다.

### 6. 단일 차수와 업체명
**Q.** 단일 차수로 보여야 하고 업체도 같이 표시돼야 한다.
**확인 답변.** 세부차수 하나만 표시,7개 메인차수는 선택 범위.
**A.** 단일 선택 모델 `selectChinaOrderSubweek`로 정확한 연도+세부차수 주문만 표시/엑셀 생성. 화면 CustKey+ProdKey+단위 행에 업체명·Customer.OrderCode(CL)·품목/HF/수량 표시. 업체명/CL/품목/HF 검색 후 다운로드도 동일 고객 행만 포함. 같은 CL의 다른 업체는 합치지 않는다. 합계는 단위별 분리. 원장/EXE/SQL/API 쿼리 변경 없음.
**상태.** codex/china-order-subweeks 로컬 구현·검증 완료, 새 PR/배포 전.

### 7. 사전 근거와 검증 진행
**A.** main이 orchestration을 primary 정본에서 선독, npm ci와 운영 읽기 probe·actual dnSpy CLI 완료. 설계/리뷰 gpt-5.6-sol xhigh, 분리 구현 gpt-6-luna high(지정중간모델 미제공). 기능18개·전체 ERP 회귀·manifest78개·dnSpy evidence·write scope0변경API·최종생산빌드 통과. 개발 webpack instrumentation의 기존 mssql edge 모듈 오류는 기능 수정과 분리하고 생산 빌드로 브라우저 검증했다. 임시output/빌드자료/인증정보 커밋 금지.

### 8. 단일 차수 최종 로컬 QA
**A.** production bundle 실제 브라우저1920×1080/100%: 40-01 123품목·34업체·327업체/품목행, 업체명과 전산 CL 표시, 숫자14px 진한 중앙, shell1/팝업 sidebar0·일반 sidebar1, 문서가로폭1920. 전체 선택목록12실제 세부차수(40-03 포함),7메인범위 유지. 1100×800 가로문서 잘림0. 실제 페이지 스크롤 소유자에서650px 내려 헤더가 화면상단에 유지되는 것 검증.
**A.** 40-01/40-03 전환·특정업체 검색 후 각각 실제 다운로드 XLSX 재독해: 발주현황8열·업체별발주11열, 선택 연도/세부차수만 상세에 포함, 화면 customer row와 고객키/CL/원본수량/합계 전부 일치. 4시트 렌더 검토(회색흰색/모든테두리/원본명줄바꿈). 검색 후 전체 선택목록 유지, 원본HF 업로드/기본복원, 중심차수 stale 및 응답scope 불일치 다운로드 차단, 브라우저 pageerror0. 최종 고성능 리뷰 P0/P1 없음; sticky P2도 실브라우저로 종료.
