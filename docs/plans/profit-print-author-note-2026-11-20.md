# 인쇄 비고의 직접 입력 원문 분리

## 기준 및 원인

2026-11-20 추가 지시: 인쇄는 직접 입력 비고만 표시한다. 자동 재고조정 상세/합계·운임 비교·진단 설명을 비고에 넣지 않는다. 본표 금액과 합계는 그대로 유지한다. 직접 쓴 재고 관련 내용은 삭제하지 않는다.

출력 API가 `data.note`와 `loadProfitImpactNotes().text`를 합쳐 builder에 전달했고, builder가 합친 문자열을 `!profitPrint.userNote`로 사용했다. 앞선 운영 인쇄 검사는 이 잘못된 metadata와 PDF의 일치만 확인했다. 이번에는 원천 비고와 metadata도 독립 대조한다.

| 기준 | 원천 | 소비자/보존 |
|---|---|---|
| 최신 비고 | `loadReportData`의 `cur.note` | 수기 입력 비고만 인쇄 |
| 과거 계산본 | `storedProfitPayload`가 보존하는 payload.note | 현재 note로 바꾸거나 계산본 갱신하지 않음 |
| 확정본 | `buildConfirmedPayload`의 confirm.notes | 확정 당시 직접 입력 비고 유지 |
| 자동 설명 | 별도 impactNotes.text, autoNote, audit.issues | 웹과 XLSX는 기존 유지; 인쇄 metadata에 혼합 금지 |
| 빈 비고 | 명시 빈 문자열/null | 자동 설명으로 fallback 금지 |
| 입력 내용 | 직접 작성한 모든 문자열 | 재고조정/입력안됨 같은 단어도 정규식 삭제 금지; 기존 가로 줄 연결만 유지 |

## 부작용 경계

| 동작 | ERP 주문/출고/입고/재고/견적 | WebProfitReport/저장·확정본 | 출력 |
|---|---|---|---|
| 인쇄 | 보존 | 기존 GET만, 저장/갱신 없음 | author note 별도 전달 |
| XLSX/웹 설명 | 보존 | 보존 | 기존 설명 및 금융 합계 보존 |

실제 설치 EXE에 dnSpy.Console.exe --no-color -t FormStockView를 다시 실행하여 GetData의 StockMaster/ProductStock 및 선택 OrderYearWeek 조회를 확인했다. 이번에는 SQL/SP/재고조회 정책을 변경하지 않는다. 운영 읽기 근거는 동일 출력 API의 44차/43~45차 read-only 검사44664444254/44664440664(업무 쓰기0)를 재사용한다. 새 원천/ERP 값 정합성 감사는 주장하지 않는다.

동일 /sales/profit-report는 Layout 및 desktop/menu.json에 이미 연결되어 있다. 새 메뉴/탭/작업순서를 추가하지 않고 출력 데이터 혼합만 수정하므로 데스크톱 셸·가이드 영상의 조작 단계는 변경하지 않는다. 회귀는 실제 API+builder+HTML을 연결해 최신/저장/확정·빈 비고·교차연도 및 원본 불변을 검증한다. 실제 운영 metadata와 report.note도 대조한다. 필수 gate/빌드/PR/배포 결과는 WORK_MEMORY에 기록한다.
