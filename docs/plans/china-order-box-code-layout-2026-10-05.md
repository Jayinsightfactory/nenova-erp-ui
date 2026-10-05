# 중국 발주 박스 병기·CL 그룹 개편

## 최신 요구
- 품목명에서 HF 미등록/미매칭/검토 문구 제거. 존재하는 명시 HF만 품목명(HF) 표시, HF 없으면 품목명만. 매핑 상태 필터/감사 시트는 기존 데이터 보존.
- 수량은 수량(박스수) 표시. 원본 숫자는 변경하지 않는다. 단=수량/현재 Product.BunchOf1Box, 송이=수량/현재 Product.SteamOf1Box, 박스=수량. 0/NULL/비정상 분모를 1·16 등으로 추정하지 않으며 괄호 —, 별도 안내. 품목별 총수량·업체 수량·단위 footer에 동일 계산 적용. footer 박스는 품목별 환산값 합, 다른 분모에 총 단수를 임의 나누지 않는다. 미환산 양수 포함 footer는 박스합계 불명으로 둔다.
- Excel 첫 매트릭스 업체 헤더는 CL 코드만. UI는 업체명 검색/tooltip 유지. YCL/KCL/BCL 등 문자 접두어가 우선이며 각 그룹 안에서 코드 자연 정렬, 미등록은 마지막. CustKey로 구분하여 같은 코드의 업체를 병합하지 않는다.
- Excel 괄호 표시는 표시 수식. 원본 수량 숫자와 SUM은 숨김 `수량원본` 시트에 보관, 박스는 DB 분모 셀 참조 수식. XLSX 원본 값을 편집해도 표시/합계가 따라 계산되어야 한다. 기존4개 감사 시트 보존, 선택 단일 세부차수 유지.

## 사전 근거
main 실제 dnSpy.Console.exe --no-color -t ClassProduct 설치 EXE 재실행: OutUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box의 SELECT/decimal 속성 확인. 품목관리 UI 1박스당 단수/송이수 및 읽기 master API 동일 컬럼 확인. 기존 distributeUnits의 단에서 SteamOf1Bunch까지 곱하는 다른 견적 환산 분기는 이번 명시 박스 참고값과 다르므로 재사용/수정하지 않는다.
운영 SELECT-only GET 2026 중심40: 중국 양수 주문1337행, 관련 Product169개 모두 OutUnit단; BunchOf1Box>0 147개, 미등록22개. 원자료·인증은 ignore된 output에만 보관.

## 읽기·부작용 계약
| 동작 | Product/Customer/Order | Shipment/Date/Farm/Stock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 조회·그룹·괄호 환산 | 현재 Product 두 분모 SELECT, 원본 ViewOrder.OutQuantity 보존 | 보존 | 보존 |
| HF 업로드·필터 | 브라우저 전용 기존 매핑 | 보존 | 보존 |
| Excel 다운로드 | 같은 연도/fullWeek/CustKey/ProdKey/단위의 숫자·환산참고 수식 | 보존 | 보존 |
SQL은 SELECT 컬럼만 확장, 주문 범위/활성 조건 변경 없음. DB·EXE·SP·원장 쓰기 없음. DB 0분모 보정 금지.

## 공용 모델
lib/chinaOrderQuantityPresentation.js: chinaBoxConversion(order), chinaBoxQuantity(q,conversion), chinaQuantityText(q,box), chinaClientCodeGroup(code), compareChinaCustomers(a,b).
matrix.rows에 boxConversion, boxQuantities[CustKey], boxTotal 추가, totals에 boxQuantities/boxTotal 추가(null 전파). API orders/products에 bunchOf1Box/steamOf1Box raw nullable 숫자 제공.

## 검증·역할
main API/모델/UI/계약/운영 사전준비·외부 반영. 경제 모델 분리 worker는 workbook 및 해당 테스트만 수정. 지정 terra 미제공으로 제공 모델 gpt-6-luna/high 대체; 최종 검토 gpt-5.6-sol/xhigh. child 승인/운영쓰기/외부쓰기 금지.
단/송이/박스/소수/0·NULL·NaN 분모, 같은 CL 다른 고객, YCL1/KCL2/YCL99 교차 숫자, 동일 ProdKey 분모 모순, 교차연도·세부차수03/suffix·필터, 수식 리터럴·누락 HF·숫자 원본/SUM/박스수식 참조,1920×1080/100% 및1100px 브라우저와 실제 Excel 재독해/전시트 렌더. 전체 ERP/manifest/dnSpy/write guard/build/CI/배포운영smoke 필요.
