# 패킹 중량·운송비 근거 확인 계약

## 범위와 기준
- 추출 후 확인창을 자동 표시. 인보이스별 GW/CW/운송·부대비를 자동 채우고 직접 입력/수정한다.
- 확인 전 다운로드 보류. 닫으면 초안 보존; 결과 상단에서 다시 열기. 확인 후 수정해도 재생성 및 기존 품목/금액/잘림 검증 유지.
- 인식 원문과 수정 최종값을 별도로 보존한다. 미인식은 null/빈칸, 명시0은0. 음수 무게/비숫자는 거부. CW와 GW는 서로 대체하지 않는다.
- 부대비 국가별 기존 의미 보존: CO freight_total, NL freight(handling 별도), CN freight(기존 운송·부대비 합계), 그 외 freight. CN XLSX의 additional_costs는 보존하고 사용자의 합계 변경분은 명시 조정행으로만 기록. 원본 invoice total을 자동으로 덮어써 검증을 통과시키지 않는다.
- 국가별 기존 양식에서 지원하지 않는 중량/운송비는 기존 양식에 임의 행 삽입하지 않는다. 모든 확인값·원본값·수정사유는 다운로드의 별도 `인식값 확인` 시트로 보존한다. UI에 ERP 입고 자동저장 아님을 명시한다.
- 기본값: 원문 명시 숫자만; 누락은 빈칸. 통화 미인식은 미확인. 자동환율/단위환산 금지. 무게는 kg 기준이고 원본 단위를 함께 검토.

## 근거/화면
- PDF 원본 bytes는 브라우저 내부에서 렌더링. 별도 업로드/외부 뷰어 없음.
- AI는 항목별 page(1-based), exact quote, normalized bbox[x,y,w,h] (회전 적용 화면 좌상단0~1)를 반환하도록 요청.
- 해당 페이지 텍스트에서 유일한 quote가 확인되면 실제 텍스트 좌표를 우선 사용. 동일 문구 중복/누락은 확정 근거로 취급하지 않는다.
- 스캔에서 AI bbox만 있으면 `AI 추정 영역 · 직접 확인`으로 표시. 잘못된 좌표/페이지는 강조하지 않는다.
- 1920×1080: 왼쪽 원본 PDF, 오른쪽 인식값/입력/확인. 페이지 이동/확대, 키보드/모달 Escape/초점복귀. 작은 화면은 세로 배치.
- XLSX는 PDF 하이라이트로 가장하지 않는다. 원본 근거는 Excel 별도 확인 안내.

## 부작용
|동작|브라우저/파일|ERP 주문/분배/입고/재고/견적/손익|
|---|---|---|
|추출|기존 명시 AI 선택 정책|보존|
|값 확인·수정|브라우저 초안, 출력 재생성|보존|
|근거 보기|로컬 PDF 렌더|보존|
|다운로드|기존 국가별 양식 + 확인 시트|보존|

## 검증
0/누락/오입력/수정 취소/다중 인보이스/같은 파일명 재업로드/비동기 교체/교차연도 격리,
quote 중복·없음/좌표 범위/스캔 추정 라벨, 원본 수량·비용 세부행 보존, 다운로드 gate,
실제7페이지 중국 PDF 렌더·하이라이트 위치, 1920/900/480 및 ERP 전체 계약·빌드·운영 smoke.
# Native Excel read verification

Read-only decompiled `C:/Users/USER/nenova-decompiled/Nenova/ExcelLoadingPackingList.cs`,
`GetExcelLoading`: assigns `this.excelTable = dataSet.Tables[0]`.
The review sheet is appended after the existing first sheet. No native executable or SQL is changed.
This proves sheet selection only, not end-to-end production receipt import compatibility.
