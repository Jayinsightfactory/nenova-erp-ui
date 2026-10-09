# 중국 외 국가 실제 인보이스 테스트

## 요청과 범위
- Q: 다른국가로 테스트해줘.
- 추가 승인: 국가별 대표 파일 최대 7개 AI 분석까지 테스트, 운영 입고·재고 저장 제외.
- 실제 업무드라이브 PDF 13개/6개 국가의 로컬 인식 경로 실행. 모두 NEEDS_AI. 이후 대표 6개를 실제 운영 parse-pdf API로 분석했고 응답 source=ai 확인.
- PDF 추출은 Node PDF.js positioned items를 브라우저 reader와 같은 형태로 구성했다. 실제 브라우저 업로드/worker/UI 스모크는 이번에 하지 않았다.
- 후속 변환은 현재 웹의 parsePackingResponse, 국가별 generator, ERP catalog/aliases, adaptPackingReceipts를 로컬에서 실행. ERP 품목·매칭 자료는 운영 GET.
- 승인된 AI 분석은 비용 추적/분석 캐시를 서비스 정상 경로로 기록한다. 운영 주문/입고/재고/초안/원가/품목매칭 저장은 호출하지 않았다.

## 실제 파일별 결과
| 국가 | 파일 | 인식 행 | 전산 매칭 | 주요 결과 |
|---|---|---:|---:|---|
| NL | 18-2 NL Holex CI.pdf | 78 | 78 | 10,027송이, 상품 EUR 10,918.43 + 운임 2,159.94 + handling 50 = 13,128.37 일치. GW714.2/CW795 |
| CO | SanJuanInvoice_FVI6405 (1).pdf | 1 | 1 | 300송이/USD57 일치. GW9 확인창에 표시. 운임 미표시인데 AI가 0 및 총액을 근거로 반환 |
| EC | 40-1 ECUA Rosaleda CI #21796.pdf | 7 | 5 | 1,200송이/USD800 일치. BLUSH-PM, CHOCOBLOOM-MO 미매칭 |
| TH | 40-1차 태국 CI CO PL Phyto180-2008 9495 (1).pdf | 26 | 9 | USD2,152.36 일치. 17행 미매칭. GW225/CW295 확인창 인식 |
| AU | 49-1차 호주 PGREENS 수입서류 (인보이스).pdf | 7 | 6 | 1,525단/12,750송이/42박스/AUD14,178.75 원본과 대조. 7행 모두 변환 수량 불일치, 통화 형식 오류 |
| US | 40-1 미국 CI 180-53083796.pdf | 1 | 0 | 70박스/43,750송이/USD4,721.50 일치. SALAL TIPS 미매칭 |

전산 매칭은 ProdKey 연결 성공 개수이며 전체 품목 의미·등급의 정답률을 뜻하지 않는다. 전체 120행 중 99행 연결/21행 미매칭. 입고 가능 판정이나 저장 성공을 뜻하지 않는다.

## 확인한 결함과 주의사항
1. NL 무료 파서 `CBS_UNITS_MISSING`: 원본 PDF 4페이지에 CBS 합계 Units 10.027이 실제 존재한다. 원본 누락으로 안내하면 안 된다. 좌표 기반 인식 문제를 추가 조사해야 한다.
2. AU 7행 source stem 합계12,750, generator preview qty는 전부0. AI total_stems 필드 부재/기존 변환 preview와 adapter 파생 수량 간 불일치. 현재 mismatch 경고는 7행 모두 검출했다. 단순히 0으로 저장하거나 경고를 지우지 않는다.
3. AU AI currency가 문자열이 아니라 `{value:null,unit:'AUD$',...}` 객체여서 adapter currency=null. 원본은 AUD$ 명시. invoice total도 AI에서 누락되어 독립 총액 검증 근거가 없다. 이번에는 원본 이미지와 행 합계14,178.75를 수동 대조했다.
4. CO 운임 근거가 `TOTALL US$ 57.000`이고 freight_total=0이다. 총액은 운임 0의 증거가 아니다. 미기재와 명시0을 구분해야 한다. GW=9, Net=9.5는 원본 자체 표기이며 Net을 CW로 쓰면 안 된다.
5. TH 9,005는 동일 단위의 송이 합계가 아니다. 원본에는 3,865 stems + 5,100 loose blooms + 40 garlands가 따로 있다. 현재 adapter stemQuantity 단순 합산값9,005를 재고 송이 합계로 승인하면 위험하다. Garland 70 blooms each 등 품목 단위 변환 검증 필요.
6. AI bbox가 실제 글자 위치와 어긋나는 사례가 보인다(CO GW 원본은 페이지 약73% 위치인데 bbox y=.88). 원문 하이라이트가 정확하다는 판정은 하지 않았다.
7. CO/TH draft의 검토 전 GW/CW null만 보고 인식 실패로 단정하지 않는다. makePackingReviewRows에서 review_evidence를 읽고 applyPackingReview 뒤 adapter로 전달하면 CO GW9, TH GW225/CW295가 정상 전달됨을 로컬 검증했다. 이 테스트 확인 체크는 메모리에서만 수행했고 저장하지 않았다.

## 미검증
- 베트남: 이름 기반 드라이브 검색에서 운송 청구서/송금증빙은 있지만 적절한 PDF 상품 인보이스를 찾지 못했다. Royal Base XLSX는 별도 대상. 베트남까지 통과라고 말하지 않는다.
- 원가 자동 계산은 현재 등록 공식이 CN_SEA_ACTUAL_V1/NL_AMOUNT_V1뿐이다. 나머지 국가 변환 성공이 원가자료 생성 완료를 뜻하지 않는다.
- 운영 입고 writer·원가 저장, 실제 사용자 브라우저 인쇄/업로드는 이번 테스트에서 실행하지 않았다.
- 이번은 테스트 요청으로 기능 수정/배포 없음.

## 재현 자료
- `outputs/drive-other-country-audit/report.json`: 무료 경로13개 결과.
- `outputs/drive-other-country-audit/ai-report.json`: 승인된 AI6개 결과.
- 같은 폴더의 ID별 PDF/해시/AI 응답/adapter documents/렌더링 이미지.
- `outputs/drive-country-ai-audit.cjs`: 운영 AI 테스트. 재실행은 유료 분석 또는 캐시 조회가 될 수 있으므로 무조건 재실행하지 않는다.
- 스킬 guard-nenova-erp-changes에 따라 업무 원장 쓰기 없이 분석·변환 검증만 진행.
- 하위 원본 독립 검토: gpt-6-luna/medium MECHANICAL P0_LOCAL (지정 gpt-5.6-luna 미제공 대체). 입력 렌더 이미지/텍스트 사전 준비, 네트워크/DB/수정 금지. 최종 메인 검토에서 AU 행 수/합계를 이미지로 정정(7행/1,525단), CO Net≠CW 명확화. 하위 보고를 그대로 정답으로 채택하지 않음.
