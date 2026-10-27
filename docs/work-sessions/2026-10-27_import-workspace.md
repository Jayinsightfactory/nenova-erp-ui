# 입고와 도착원가 작업 분리

| 항목 | 기록 |
|---|---|
| 기간 | 2026-10-27 |
| 화면 | /import/tools?popup=1 |
| 작업트리 | nw-import-workspace-1027 / feat/import-workspace-1027 |
| 운영 부작용 | 운영 DB 수정·DDL·입고·원가 저장 없음 |
| 배포 | PR/CI/배포 결과 후속 기록 |

## 고정 결정
- 파일·품목 매칭 / 입고 작업 / 도착원가 작업을 분리한다. 탭 전환 시 마운트와 입력값을 유지한다.
- 입고 등록 버튼은 입고만 처리한다. 원가 자동 승인을 실행하지 않는다.
- 이미 웹에서 등록한 현재 버전은 모든 지원 국가에서 재조회만 한다.
- 전산-only 입고 연결은 기존 NL/CN/TH 검증 범위를 유지한다. 다른 국가의 기존 전산 입고는 자동 신규 등록으로 우회하지 않는다.
- 기존 입고 연결 실패/중복/불일치/응답 불명은 신규 입고로 fallback하지 않는다. 웹 연결 감사만 저장하며 원장은 보존한다.
- 이전 원가식·단위·양식·승인 및 다운로드 검증은 유지한다.

### 1. 요청과 처리
**Q.** 입고와 도착원가를 따로 작업하고, 입고가 있으면 패스하여 원가 파일만 받을 수 있게. 복잡한 패킹리스트 화면 최적화.

**A.** 상단 작업 선택 3개로 현재 작업만 표시한다. 상세 단계·다른 저장 문서·이력을 접는다. 기존 입고 연결은 초안 저장→정확 대조→사용자 연결 확인→재조회를 담당하는 writer 없는 전용 workflow로 분리했다. 국가별 기존 검증을 임의 완화하지 않았다.

## 검증
- 실제 dnSpy CLI ExcelLoadingPackingList: MakeTempTable, InsertMaster, uspCreateWarehouse, uspStockCalculation 확인. native 저장코드 변경 없음.
- workflow/작업대/기존입고 회귀 55건 통과. 교차연도·수량/금액/통화/단위 불일치·stale/unknown·취소·미지원 국가 포함.
- 원가/엑셀 회귀 78건: 69통과, 개인 원본 파일에 의존하는 선택 시험9개 건너뜀.
- 전체 test:erp-contract, dnSpy evidence, manifest, write guard 통과. 첫 webpack build 통과. 최종 CSS build 진행 중.
- 실제 Chrome의 로컬 production-build 페이지에서 시험 API fixture로 조회→기존입고 연결→원가 입력 화면 확인. receiptCommits=0, links=1, costApprovals=0.
- 환율1350 입력 후 입고 탭 왕복: 값 유지. 기등록 입고 버튼 비활성 확인.
- UI fixture는 모든 /api를 localhost에서 차단/시험 응답 처리한다. 실제 DB 또는 실제 송장의 입고/원가 저장 검증이라고 주장하지 않는다.
- 미검증: 이번 세션 운영 직접 SQL probe, 운영 실제 원가 다운로드. 원가 export는 자동회귀로 검사.

## 임시 파일 / 후속
- outputs/import-workspace-ui.cjs 및 시험 로그는 커밋하지 않는다. UI fixture PID는 이 세션에서만 사용.
- 전산-only 연결 CO/EC/AU/US/VN 확장은 국가별 원문 가격단위·ERP단위·무게/운임행 대조 계약을 별도로 검증해야 한다.
- 검색어: import-workspace cost-only 기존입고 건너뛰기 입고원가분리 UI 2026-10-27
