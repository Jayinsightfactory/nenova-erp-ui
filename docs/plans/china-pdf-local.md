# 中国 Hubfresh 文本 PDF 本地读取 / 중국 해상 PDF 복구

## 목적·근거
- 사용자: 41-1 중국 해상 PDF 정상 처리, 검증 후 배포. 입고/재고 시험 저장은 하지 않는다.
- 2026-10-13 17:26 KST 분석 시작 후 다른 PR 배포38368892257이17:29:07에 PM2를 reload.17:36 작업 오류는 recoverDeadOwner 전용 메시지였다. 공급자가10분 동안 처리했다고 단정한 과거 설명은 정정한다.
- 기존 extractPackingDocument는 NL만 무료 PDF 해석, CN은 텍스트 PDF도 AI 경로로 보냈다.
- 실제 파일522104bytes/7pages/hash1e66a6877cc58cdebc73055664ed7bda0fe612b0d32e3c075a964e1077ef530d. PDF.js 위치 텍스트가 온전하다.

## 기준 ledger
| 기준 | 원천 | 소비자/판정 |
|---|---|---|
| 양식 | 실제 PDF 영어 열명/위치, 공급사 Hubfresh | allowlist 좌표 파서, 미지 양식은 needsAI(자동 유료 호출 없음) |
| 수량 | Order=박스, Total of Flower Material=단, Stems=송이 | 각각 원본 보존, 마스터 수량으로 치환 금지 |
| 검산 | 인쇄된 독립 합계 | 박스/단/송이/GW/품목금액/비용/최종합계 대조, 불일치 부분 성공 금지 |
| 원문 대시 가격 | 실제 마지막 품목의 '-' | null과 원문 근거 보존, 0 추정 금지, 기존 PDF 개별행 확인 후 사용자 입력 |
| 날짜 | 인쇄 DATE 4/10/2026 | 원문 보존, 확정 순서 없는 DMY/MDY는 사용자 검토 |
| CW | 원문 없음 | null, GW로 대체 금지 |
| 부대비 | 비용행1~7;8은 반복 품목금액 | freight=비용만, 최종합계에 품목금액 중복 합산 금지 |
| 자료 위치 | PDF.js page/좌표 | 기존 원본 검토창 quote/page 연결; 확인 못한 bbox 생성 금지 |
| 저장 | 기존 명시 확인 workflow | PDF 해석만으로 입고/재고/도착원가 저장 금지 |

## 부작용 표
| 동작 | Order/Shipment/Warehouse/Stock/Estimate/WebProfitReport | 웹 공동매칭 | AI |
|---|---|---|---|
| PDF 로컬 해석/원문 검토 | 모두 보존 | 기존 조회만 | 0회 |
| 미지/불완전 양식 | 모두 보존 | 보존 | 사용자 선택 전 호출 금지 |

## 범위 및 검증
- 신규 순수 중국 PDF 파서, 기존 브라우저 readAwbPdf 재사용, CN 로컬 라우팅, 기존 정확수량 중국 변환 경로 연결.
- 원본101행,429박스/5390단/68775송이/GW4005.12/상품126325CNY/최종172150.50CNY를 대조. 값은 소스에서 읽으며 하드코딩하지 않는다.
- missing/duplicate/reordered pages, unknown header, malformed number, omitted row, mismatched total, dash-price vs explicit0, multiple invoice, scan, CN vs NL 격리 fixture.
- 무료처리 POST0/ERP0, 실제 파일 브라우저1920×1080/100%,1280×800 및 원문검토 확인. null가격은 확인 전 다운로드/입고 차단 유지.
- 모든 ERP 계약/manifest/write guard/dnSpy evidence/build 통과 후 PR/배포/운영 업로드 smoke.
- 일반 스캔 PDF 및 공급자 지연은 이 allowlisted 경로의 성공과 구분한다. 유료 분석 재시도는 실행하지 않는다.
