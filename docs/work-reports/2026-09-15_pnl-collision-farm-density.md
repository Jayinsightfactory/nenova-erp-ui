# 손익 중복행 위치 안내·농장 피드백 밀집 화면

## 목적·고정 기준

- 사용자가 중복 품목/단가의 호텔·연도·차수를 알 수 있어야 한다. 기존 API details가 HTTP helper에서 소실되고 문자열만 보이는 경로를 개선한다.
- 기준 데스크톱 1920×1080, 100%. 농장 피드백 목록은 적은 여백으로 많은 건을 읽고 선택 상세는 오른쪽에 유지한다. 작은 화면에서는 핵심 버튼을 자르지 않는다.
- 매칭 판단·저장 허용 기준·단가·수량·이력 데이터는 변경하지 않는다. 표시만 개선한다.

## 기준 원천/전달

| 기준 | 원천 | 소비자 |
|---|---|---|
| 중복행 연도·차수·호텔 | 기존 mergePnlImportedItems options.orderYear/major 및 검증된 partner | API 구조화 details → HTTP 오류 → 알림 영역 |
| 품목/원본행 | 충돌 incomingIndex 및 원본 remark, 기존행 candidateIndexes | 오류표에 표시; SQL/매칭 정책 불변 |
| 피드백 내용/순서/상태 | farm-quality 기존 selected-year GET의 Case/RecentEvents | 목록과 선택 상세, 기존 필터 그대로 |
| 저장/삭제/이미지 | 기존 명시 버튼과 권한·버전·연도 검사 | 이벤트 핸들러 변경 금지 |

## 부작용 표

| 사용자 동작 | 웹 결산 | 웹 피드백/증거 | ERP 주문·출고·견적·재고·WebProfitReport |
|---|---|---|---|
| 중복 위치 안내 | 기존 오류 읽기만 | 보존 | 보존 |
| 목록 밀집 표시·선택·접기 | 보존 | 기존 조회/브라우저 상태만 | 보존 |
| 저장·삭제·이미지 버튼 | 기존 계약 그대로 | 기존 계약 그대로 | 보존 |

FormRaumPnl/FormFarmQuality golden 및 저장 decompile FormSalesDefectView.GetData를 읽었다. 두 변경은 웹 표시 전용이며 새로운 SQL/SP/EXE 경로가 없다. 운영 DB 시험 쓰기 없음. 현재 오류가 난 실제 파일·차수는 미제공이므로 임의 차수를 추정하지 않는다.

## 검증 계획

- 중복 응답이 HTTP/UI까지 호텔·연도·차수·품목을 유지하는 fixture, 2025/2026 동일 차수 구분, 필드 누락은 미상 표시.
- 피드백 다수 fixture 및 긴 본문/농장명/품목명/빈 이력, 선택/전체 이력 접근, 1920×1080과 작은 화면.
- ERP 계약/manifest/쓰기 보호/dnSpy 근거, 대상 테스트, UI layout, Next build. 운영 읽기 화면만 확인.
- 모델: 메인 통합, 기존 Sol(high) 설계·최종검토, Terra(high) 오류표시 구현, Luna(medium) 밀집 UI. 외부 쓰기/배포 메인만.

## 구현·검증 결과

- 충돌 409 및 success:false의 code/details를 HTTP helper가 유지한다. 화면은 호텔·연도·차수·품목·업로드 원본 위치·선택적 판매단가·확인 내용 표를 표시한다. 기존 후보의 원본 위치를 추정하지 않는다. 0원은 보존하고 위치 누락은 미상으로 표시한다.
- 농장 목록은 한 열의 밀집 행, 최신 EventNo 3개 내림차순 가로 미리보기와 이전 건수, 명시적 상태 배지, 우측 전체 이력/입력창. 원본 GET/load/save/delete/evidence 핸들러는 변경하지 않았다.
- 중간 구현에서 base CSS 소실이 검사에 걸려 HEAD의 원본 CSS를 복구하고 단일 styled-jsx에서 override했다. 실패를 무시하지 않고 최종본의 전용검사와 전체 ERP 계약을 다시 통과시켰다.
- 로컬 읽기 전용 API fixture 24건: 실제 viewport 1920×1080, 100%에서 행 높이 117.5px, 상세 440px, 6개 완전 표시+7번째 일부. 최근 8→7→6 순서와 상세 전체 8개를 확인했다. 760×900은 페이지 가로 overflow 없이 세로 배치. 미답변 필터는 6건으로 전환됐다.
- npm run test:erp-contract, build, guard:erp-writes, test:nenova-dnspy-evidence, 전용 충돌/렌더/HTTP/밀집 UI 검사 통과. 최종 PR CI와 운영 배포 결과는 연결된 PR/workflow에 남긴다.
- 운영 DB·호텔·결산·피드백·증거 이미지 쓰기와 실제 업로드 시험은 하지 않았다. 실제 사용자의 오류 파일을 재업로드해 해결됐다고 주장하지 않는다.
