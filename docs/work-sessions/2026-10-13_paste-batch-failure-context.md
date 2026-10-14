# 붙여넣기 추가/취소 실패 항목 구분 · 2026-10-13

| 항목 | 기록 |
|---|---|
| 화면 | 붙여넣기 주문등록 / 2026-41-02 |
| 원장 부작용 | 화면 오류 문맥만 변경. 운영 읽기만 수행 |
| PR/배포 | 진행 중 |
| 이어받기 | 아래 실제 로그와 품목키 차이를 기준으로 판단 |

## Q&A 및 확인된 원인
**Q.** 41-2 ALSTROMERIA Mlla90은 이미 분배돼 취소 가능해야 하는데 가용재고0으로 전체 롤백된다.
**A.** 운영 Log11424(14:42:45)는 수경원예436 CANCEL90 현재출고0으로 실패. Log11425(14:43:52)는 CANCEL2429로 수정됐고, 왕자원예478 ADD90 가용재고0으로 실패했다. 서버 재고검사는 type ADD에만 적용된다. 취소 재고검사가 문제라는 가정은 실제 로그와 다르다.

## 구현 전 기준과 부작용
- 전체 실패 안내에서 실제 실패동작(분배 추가/취소), 업체, 입력 별칭, 매칭품목명/#키, 수량·단위, 선택연도/차수를 표시한다.
- 서버 failedEntry.inputIndex로 원요청 항목을 찾되 업무키가 맞을 때만 부족한 이름을 보충한다. executionIndex를 원입력 index로 해석하지 않는다.
- API error가 있어도 행 설명이 버려지지 않도록 preflight와 실제저장에 같은 helper를 쓴다.
- 추가/취소 payload, force=false, 원자성, 수량환산, 저장 매칭 모두 보존. 이름유사성으로90→2429를 자동변환하지 않는다.

| 동작 | Order/Shipment/Date/Farm/Stock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|
| 오류 문맥 표시 | 모두 보존 | 모두 보존 |
| 운영 조사 | SELECT API만 | 조회만 |

## 운영 읽기 및 native 증거
- Product90 ALSTROMERIA Mlla Stock0, Product2429 ALSTROMERIA Mila Stock128. 같은 OutUnit단, 박스16단/160송이지만 별도 품목키.
- 2026/41-02 수경원예436 Mila2429: 주문16/분배16/날짜16단(1박스), Sdetail95892, MasterFix0. 왕자원예478:32/32/32단, Sdetail95862, MasterFix0. 둘 다 ViewOrder/ViewShipment 노출, ShipmentFarm없음. 전년도2025 동일차수 Mila/Mlla 조회0행.
- 견적진단: 위 양쪽 GetDetail0/DetailSplit1/PeriodExact1. 기존 상태 기록만, 견적/확정매출 정정 없음.
- global 및 두 업체 merged 저장매칭 `알스트로 밀라`→2429 manual=true, 2026-10-13 14:43:35 KST 저장. 저장매칭 자체는 유지돼 있고 이미 분석된 추가행이 이전90을 전송한 증거다.
- 로컬 dnSpy CLI로 설치 Nenova.exe의 FormShipmentDistribution GetShipmentMaster/btnSave_Click/ShipmentDate 연결 재확인. outputs/cancel90-native-distribution.txt. SQL/저장순서 변경 없음.
- sanitized probe: outputs/cancel90-logs.json, cancel90-scope.json, cancel90-mila-scope.json, cancel90-mappings.json. 커밋하지 않음.
- docs/CODEX_SUBTASK_ORCHESTRATION.md 없음. 사용자 제공 하위작업 역할규칙 적용.

## 메뉴 기준선
오류/피드백 명확성 적용. 1920×1080·작은화면 오류 모달 확인 적용. 메뉴 shell/저장정책/키보드 컨트롤 변경 해당 없음(기존 확인 버튼 유지).

## 검증·배포
- helper6회귀 fixture: ADD90/CANCEL2429 구분, CANCEL 실패, metadata 부족/다른 key, 실행순서/입력순서 불일치, 교차연도, 실제 페이지 연결. 관련 mixedBatch/history 테스트도 통과.
- 전체 ERP 계약, manifest102개, dnSpy evidence, 쓰기범위 guard(API수정0개) 통과. production build 통과.
- 실제 페이지 JSX 오류모달+helper를 실브라우저1920×1080·1366×768·390×844로 렌더: 정확한 ADD업체/품목/차수, 가로잘림·모달이탈0, Enter확인닫기, pageerror0. scripts/paste-batch-failure-smoke.cjs. 운영 쓰기0.
- 리뷰: 차단문제없음. 매칭저장 전체손상/취소재고차단으로 확대해 설명하지 않는다.
- 남음: PR/master/Cafe24/운영 읽기 스모크.
