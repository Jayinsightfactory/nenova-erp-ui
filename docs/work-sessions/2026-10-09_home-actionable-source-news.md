# 홈 지침·피드백의 실제 업무 내용

## 요청·확인한 원인
사용자는 지침 화면에 '확인 필요' 소독 관련 항목이 있으나 홈은 비어 있고, 피드백은 '농장 불량 반복 · 3개 품목'만 보여 어느 농장·품목에 어떤 피드백이 필요한지 알 수 없다고 보고했다.
기존 projection은 CURRENT만 포함했으며, ticker renderer는 summary도 표시하지 않았다. 피드백은 Case.Title과 Status만 반환하여 실제 농장/품목/요청 정보가 사라졌다.

## 기준·데이터 계약
- 지침: operationsKnowledgeSchema의 CHECK/현재 CURRENT를 표시한다. RETIRED는 제외하며 CHECK를 현재 적용으로 바꾸지 않는다. 상황/처리 방법/주의사항/체크리스트/연락처를 실제 원문으로 제공한다.
- 피드백: 기존 loadQuality의 case와 inbox membership을 정확한 CaseKey+OrderYear로 연결한다. Title은 문제 제목이지 품목명이 아니다. 실제 농장·품목·문제 및 제공된 요청/최근 기록을 표시한다. 없는 농장·내용은 추측하지 않는다.
- 홈 뉴스의 최근 여부와 개인 읽음 상태, 권한, 실제 연도·차수, 기존 원문 링크를 유지한다. 상세는 전체 내용을 읽을 수 있게 한다.
- UI: 기존 색상, 작업 탭, 즐겨찾기 보존. 제목과 실제 상황 요약은 홈에서 보이며 전체 항목은 더보기/원문으로 접근한다. 1920×1080 CSS px/100% 및 작은 창에서 줄바꿈·키보드·초점 복귀를 검증한다.

## ERP 부작용·기준선
HOME_GET는 기존 readKnowledge/loadQuality 결과를 읽기 전용으로 투영한다. OrderDetail/ShipmentDetail/ShipmentFarm/ShipmentDate/Estimate/WebProfitReport 및 피드백 원본/지침 원본은 모두 보존한다. SQL/DDL/원장 수정은 해당 없음. 개인 읽음 표시는 기존 소유자 파일만 변경한다.
적용: 내용 잘림 방지, 줄바꿈, 기존 색상, 키보드/초점, 실패/빈 결과 구분, 실제 원문 근거.
해당 없음: 신규 메뉴, ERP 반영/보정, 전체 메뉴 디자인 재작업.

## 검증·배포
홈 단위 fixture(CHECK/v8 ID/긴 본문/3품목/교차연도/확정 연결 vs 관련 그룹/1MiB UTF8), Electron 25 unit tests 및 native smoke, 복원/updater 무설치 검증, 1920×1080·800×1080/100% 브라우저 fixture(22품목 상세, 줄바꿈, textContent 안전, 키보드/초점/일시정지), UI layout, ERP 계약/dnSpy/manifest/write guard, production build 모두 통과. PC 1.3.7 설치 파일의 패키지 source 일치 및 SHA512 검증 통과. SHA256 `234F1613E862D2A057B5572F8E4638A4EFF5386A445F1404C69AD0B558D7323F`. 운영 DB 쓰기는 하지 않았다. 배포 결과는 완료 후 기록한다.

연결 안전성: 단일case+단일InboxKey가 실제case.InboxKey와 같은 그룹의 !isNew 원본만 확정 대상으로 취급한다. 그 외는 정확한 year+SourceKey anchor를 사용하고 관련 원본은 개별 이력 연결 미확인으로 분리한다. 큰 응답은1MiB feed예산 내에서 오래된 상세 전체만 원문 안내로 대체하며 제목/요약/링크를 보존한다.
