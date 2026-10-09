# 업무드라이브 실제 인보이스 변환 테스트

## 사용자 요청
- Q: 업무드라이브에서 찾아서 테스트해봐.
- A: 실제 업무드라이브에서 중국 CI/인보이스 XLSX 14개를 내려받아 현재 웹에서 호출하는 `parseChinaInvoiceWorkbook`에 원본 바이트 그대로 입력했다. 14개 모두 지원 양식 검사에서 차단되었다. 입고·원가까지 실제 파일로 검증 완료했다고 말하면 안 된다.

## 실행 범위와 근거
- 코드: `2f120d1d08106cb3b49e29196b095c6895dade33`의 파서. 브라우저 업로드 경로는 PackingListTool의 CN XLSX 분기에서 같은 함수를 직접 호출한다.
- 실제 운영 GET: 업무드라이브 목록, 원본 다운로드, ERP product-matches 품목 조회.
- 로그인 외 POST, 입고/재고/원가/초안/품목매칭 저장은 호출하지 않았다. 서비스의 통상 로그인·파일 다운로드 감사 기록은 남을 수 있다.
- AI API 호출 0. 원본 파일 수정 0. 테스트용 로컬 사본과 JSON 보고서만 생성.
- 재현 스크립트: `outputs/drive-invoice-audit.cjs` (환경변수 인증, 비밀값 저장 없음).
- 파일별 ID/SHA256/크기/시트/실제 헤더: `outputs/drive-invoice-audit/report.json`.

## 결과
| 범주 | 파일 수 | 중단 사유 |
|---|---:|---|
| `Invoice 日报表` 시트 | 6 | 정확히 INVOICE라는 시트만 허용 |
| `NNV` 시트 | 6 | 정확히 INVOICE라는 시트만 허용 |
| `Sheet1` 등 | 1 | 정확히 INVOICE라는 시트만 허용 |
| `Invoice` 시트 | 1 | 지원 열 제목과 불일치 |

예: `19-2차 중국 CI.xlsx`의 실제 6행은 `品名 / 英文名 / 数量Qty / 单价PRICE / 金额AMOUNT / 规格BU/PCS`다. 기존 파서는 `English item name / Stem length / Specification / Order / Total of flower material / Unit price CNY BH PCS / Stems / Amount CNY` 구조를 요구한다.

`31-2 중국 CI (1).xlsx`는 `Items / picture / specification / Quantity / unit price / packing fee / total(CNY) / Supplier` 형식이다. 시트 이름만 완화해도 열/단위 해석은 여전히 다르므로 이름 변경만으로 해결하지 않는다.

## 해석 및 제한
- 운영 DB 오류가 아니라 업로드 파서가 실제 공급사 양식을 충분히 지원하지 못하는 문제를 재현했다.
- 안전 차단 자체는 발생했다. 그러나 실제 파일의 매칭·수량 대조·입고 저장·원가 계산 성공은 이번에 검증하지 못했다. 파서에서 중단됐기 때문이다.
- 기존 `importChinaInvoice.test.js`: 18 통과, 실제 XJ 선택 테스트 1 skip. 기존 fixture 통과는 업무드라이브 양식 호환을 증명하지 않는다.
- 다른 국가 PDF/OCR 및 원가표 계산 비교는 이번 테스트 범위에서 실행하지 않았다. 원가 관련 파일은 목록만 확인했다.
- 신규 기능 수정·배포는 이 테스트 요청에서 수행하지 않았다.

## 다음 수정 시 필수 사항
1. 공급사/헤더 구조별 파서를 분리하고 시트명을 유일한 식별 근거로 쓰지 않는다.
2. Qty가 단/송이/박스 중 무엇인지 규격/단가/금액과 대조한다. 모호하면 사용자가 확인하기 전 저장 금지.
3. 인보이스 및 Packing list가 함께 있을 때 동일 물량 중복 합산 금지. 상품 합계·부대비·최종 합계 별도 검증.
4. 원본 14개를 익명화한 회귀 fixture로 포함하고, 변환→매칭→검증→격리 입고→원가 순으로 검증한다.
5. 누락 GW/CW/운송비를 0으로 추정하지 않는다. 검증 실패 상태에서 자동 입고로 넘어가지 않는다.
