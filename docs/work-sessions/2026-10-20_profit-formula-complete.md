# 전체 차수·확정본 계산식 검증

## 사용자 질문과 판정

- 질문: 최초 웹 설계식대로 모든 항목이 표시되는가? 모든 차수와 확정본을 검증하고 불일치는 수정·배포.
- 판정: 현재 원장 76개 연도·차수의 28,001개 항목, 자동 저장 입력 116 revision의 42,451개 항목에서 독립 산술 불일치 0건. 이것은 원가 증빙·실사·입력 누락이 없다는 인증이 아니다.
- 수동 보고서 확정 테이블은 활성/비활성 모두 0건이다. 존재하지 않는 확정본을 검증했다고 세지 않는다. 자동 저장 116건은 입력 payload이며 과거 최종 산출금액을 동결한 수동 확정본과 다르다.
- 원본 22~27차 xlsx에서 추출된 fixture 898셀을 기존 실제 계산 함수로 재현하는 회귀도 통과. 이후 승인된 AC/AJ, FIFO, 취득원가 이월 정책은 과거 수식으로 되돌리지 않았다.

## 조회 범위와 한계

- 2025: 01, 02, 06, 28~53 (29개).
- 2026: 01~45, 50 (46개).
- 2027: 39 (1개).
- ShipmentMaster/WarehouseMaster/StockMaster 및 WebProfitReport/계산 snapshot/수동 확정 테이블의 차수 합집합을 추가 대조했다. 위 76개 외에는 연도 NULL의 15·17·19, 2025의 60만 존재한다. 유효 보고서 차수로 추정하거나 정상 처리하지 않았다.
- 읽기 전용 probe는 lib/db.query에 SQL 쓰기 키워드 차단을 주입하여 실제 loadReportData를 호출했다. 운영 ERP/수기/확정/캐시 쓰기 없음. private `.verify/outputs`에 payload와 비교 결과를 보관하며 원장 금액·품목 개인정보를 저장소에 넣지 않는다.
- 원천 NULL 경고는 59개 차수, 334개 행(동일 행 복수 열 가능). 2026은 30개 차수에 경고가 있으며 주로 호주 과세환율, 에콰도르 기초/기말 단가, 미분류 원천이다. 활동이 없는 미래·과거 차수의 자료 없음도 포함하므로 이를 모두 손실/회계 오류로 부르지 않는다.
- 기초·기말 금액은 본표 산술의 입력이다. FIFO/평균/이월/판매단가 증빙 자체의 적정성을 산술 MATCH로 인증하지 않는다. 기존 독립 재고 대사와 원천 경고를 별도로 유지한다.

## 수정한 결함과 원인

1. 확정 저장 SOURCE/CALC 열 목록에서 AC/AJ가 빠졌다. C/J에는 조정이 반영되지만 확정 후 조정 칸과 근거 산술을 복원할 수 없었다. 신규 사용자 확정 INSERT에 두 열을 보존하고 재조회도 저장된 조정값만 사용한다. 과거 revision은 덮어쓰지 않는다.
2. 포워딩 자동값 및 엑셀 Q/S 합계가 `|| null`로 0을 빈칸으로 바꿨다. `??`로 명시적 0과 누락을 구분한다. 금액을 임의로 증감하지 않는다.
3. 상세/차수별/연간 화면 합계 D/U의 `?? 1`이 분모 0의 null을 100%로 표시했다. 실제 합계 null을 그대로 표시해 Excel과 맞춘다. 실제 formatter·세 군데 바인딩과 xlsx를 실행하는 회귀를 추가했다.
4. 계산식 도움말 C/J에서 조정 설명이 누락되고, 합계 범위/100% 설명이 부정확했다. AC/AJ, 공제·국내 제외 범위, 베트남 제외 U 합계와 분모 0을 명시했다.

## 재발 방지

- `lib/profitFormulaAudit.mjs`: production 계산기 import 없이 19개 본표 항목 + 2개 조정 및 합계를 독립 산술 대조. 국가별 noEnding 예외, 열별 합계 범위, 0/NULL, 교차연도, 확정 조정값 보존 검사.
- 검증 새창에 전체 항목 검산과 원천 누락을 분리 표시. 기존 1~선택 차수 검산에도 전 항목 검사 추가.
- 신규 양성 fixture, 각 열/합계 오염 음성 fixture, 누락·명시적 0·빈칸·과거 확정·교차연도 fixture. 원본 fixture와 새 회귀를 전체 ERP gate에 포함.
- 로컬 dnSpy 실제 Nenova.exe FormStockView.GetData의 StockMaster/ProductStock 조회 확인. 보고서 산술/웹 전용 확정 열 보존이며 ERP writer/SP는 변경하지 않음.
- 계약: `docs/contracts/profit-formula-audit.json`. 원장/Estimate/ShipmentDate/ShipmentFarm/ShipmentDetail.Amount·Vat·isFix 보존.

## 검증 상태

- 신규 산술·확정 roundtrip·화면 formatter·Excel 0/null·원본 fixture·source guide·기존 independent audit·dnSpy 증거 테스트 통과.
- 전체 verify:erp-change(빌드 포함), dnSpy, origin/master 기준 manifest/write guard 통과. 1920×1080/390px, Enter/Space, 교차연도·API 실패·GET only·일반 shell 합성 브라우저 회귀 통과. PR/CI/Cafe24/운영 smoke는 아직 미검증이며 완료 결과를 후속 기록한다.
- 중단 조건: 계산/계약/빌드 실패, 확정본 변조, 연도 없는 자료 추정 합산, 원천 누락을 정상으로 표시, CI/배포 실패. 자료 없는 원가를 가짜 값으로 채우지 않는다.

검색어: profit-formula-complete 전체항목검산 AC AJ 확정조정누락 합계100퍼센트 70452
