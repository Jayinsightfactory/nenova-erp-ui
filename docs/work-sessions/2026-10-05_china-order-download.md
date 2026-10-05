# 중국 발주 현황 다운로드 — 2026-10-05

| 항목 | 내용 |
|---|---|
| 화면 | 중국 발주 현황 다운로드 `/stats/china-order-download` |
| 기준 브랜치 | origin/master 9916866c, 독립 codex/china-order-download |
| 원장 부작용 | SQL SELECT만, 기존 EXE/주문/분배/출고/입고/재고/견적/Product 변경 없음 |
| 구현/배포 | 로컬 기능·ERP 회귀·브라우저·빌드 검증 완료, PR #867 검증 후 배포 예정 |
| PR | https://github.com/Jayinsightfactory/nenova-erp-ui/pull/867 |

## 고정 결정
- 중심차수 이전3+현재+다음3, 총7개 **메인차수**. 전체 세부차수 주문을 합산하고 상세 시트에 원래 세부차수·업체 키 보존.
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
