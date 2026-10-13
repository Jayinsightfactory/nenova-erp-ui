# 패킹 PDF 504 및 DB 품목 선택 동선

## 요청·결정
- 41-1 중국 해상 ci1.pdf에서 HTTP504 후 '인보이스 읽는 중'이 남는 문제 수정.
- 같은 원본 7페이지의 실제 AI 검증은 사용자 승인 최대 1회. 입고·재고 저장 없이 분석·검토만 한다.
- 원문품목/길이 바로 옆에 실제 DB 매칭품목을 표시. 미매칭·유사확인을 누르면 단어·순서·자모 유사도 순 후보 버튼을 연다. 긴 품목명은 생략하지 않는다.
- 수동 선택은 기존 팀 공용 저장과 작성자 이력을 유지하고 다음 업로드의 fresh GET에 적용한다. 추천과 확정은 구분한다.

## 확인한 원인·범위
- parse-pdf의 180초 단일 동기 요청 timeout이 사용자와 같은 504 문구를 반환한다. provider 내부 지연 원인까지 확인한 것은 아니다.
- catch가 진행 steps를 종료하지 않았고 resetResults가 AI 재확인 버튼 상태를 지웠다.
- 예전 분할 분석은 개별 검증 스크립트였으며 이번 수정 전 웹 경로에는 없었다.
- 품목 표의 매칭 상태는 span으로 클릭할 수 없었고 원문/DB 이름의 nowrap·ellipsis로 이름이 잘렸다.

## 구현 계약
- [설계·criteria ledger](../plans/packing-pdf-timeout.md), import-team-tools 및 packing-team-matching 계약.
- 접수202 → 인증된 GET 결과조회. 같은 작업은 재사용, GET은 유료 호출하지 않는다. 동기·비동기 공유 admission, 호출 전 영속 attempt 표식, owner fencing.
- 결과불명은 추가 비용 확인과 retryJobId 없이는 새 유료 호출 금지. 최초 원본은 디스크에 저장하지 않는다. 결과·job은 사용자별 웹 runtime, TTL/크기/보관 제한.
- 수량·단위·원가·입고 writer와 SQL/dnSpy 저장 구조는 변경하지 않는다. Product SELECT와 웹 공용 매칭 저장만 기존 계약대로 사용.
- 입고·주문·분배·재고·견적·매출 원장 보존. ERP 호환성 전체가 새로 실증되었다고 주장하지 않는다.

## 작업 배정
- 메인: 설계/계약/UI연결/통합검토/검증/외부쓰기를 담당.
- 구현 Locke: gpt-6-sol/high, P0_LOCAL. 지정5.6-terra 불가로 동급 대체, 백엔드와 모의 테스트만.
- 검토 Banach: gpt-5.6-sol/xhigh, P0_LOCAL, 읽기 전용 과금/동시성 검토.
- 화면검증 Mill: gpt-6-luna/high, P0_LOCAL. 지정5.6-luna 불가로 대체. 컴파일된 실제 컴포넌트 1920×1080 및1280×800/100%, 모의 네트워크. 추가 표 UI는 확정 설계 범위만.
- 입력/의존성/근거는 메인이 사전 준비. 하위 작업은 유료API/운영ERP/push/병합/배포 없음.

## 검증 상태
- 구현·회귀 검증 진행 중. 실제1회 분석은 아직 실행하지 않았다.
- 초기 모의 테스트에서 정리 시 background cache write 경합과 편집 중 UI 함수 참조 누락을 발견, 수정 후 전체 재실행 필요.
- 기준선 적용: 기존 shell/한글/키보드/페이지 세로스크롤/표 가로스크롤/오류 종료/원본 유지. 신규메뉴/ERP원장쓰기/단위변환변경은 해당 없음.
- 완료·배포·실제 분석 결과는 확인 후 추가한다. private outputs는 커밋하지 않는다.

## 추가 검증·검토
- 매칭 화면/후보/정렬/팀 저장 집중 테스트20개 통과. 부모 UI·저장 재적용36개 중35통과, 기존 선택형 실제파일 테스트1skip.
- 실제 컴포넌트 source-browser 1920×1080 및1280×800/100%: 원문→길이→DB품목 열순서, 긴 품목명2줄 전체표시, 미매칭 버튼, 순위 후보, 키보드/초점, 확인완료 행 필터, 다운로드 전체배열 보존 통과. 원장·유료 호출0회.
- PDF UI: 두 해상도의 504 및 결과불명 취소4조합 통과. 파일유지/진행종료/재확인활성, 자동2차POST 없음.
- 독립 검토에서 stale recovery 파일의 영구 busy 발견. OS 소유 IPC mutex로 교체(Windows named pipe/Linux abstract socket), 짧은 상태변경만 잠근다. 작업 프로세스 종료 시 커널이 해제. 기존 file guard/recovery는 사용하지 않는다.
- 동시에 실행된 Windows 회귀에서 named pipe 종료 중 EACCES 가능성을 보완. bounded retry 뒤 실패 시 유료 호출 전 차단한다. retryId 형식/원문일치 검증과 sync 결과불명 표시 계약도 보강.
- 최종 전체 test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest(origin/master), guard:erp-writes(origin/master), production build 통과. 실제 유료분석/배포 결과는 아래 후속 기록으로 구분한다.
