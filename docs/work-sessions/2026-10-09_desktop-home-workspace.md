# PC 홈 개인 업무·최신 지침 적용

| 항목 | 내용 |
|---|---|
| 날짜 / 작업 | 2026-10-09 / desktop-home-workspace |
| 화면 | 네노바 PC 네이티브 홈, 지침/농장 피드백 원문 이동 |
| 상태 | PR1003 병합·Cafe24 배포·PC1.3.5 공개 완료. 사용자 설치 적용 미확인 |
| 원장 부작용 | 개인 소유 파일만 쓰기. 주문·출고·재고·견적·매출·공용 체크리스트 변경 없음 |
| 버전 | PC 1.3.5 |

## 고정된 결정

- 기존 남색·연한 파란색과 즐겨찾기를 유지한다. 웹 전체 색상 개편은 하지 않는다.
- 홈 제목 아래 지침/수입부 피드백 두 뉴스 줄, 그 아래 개인 업무, 기존 즐겨찾기·전체 메뉴 순서다.
- 개인 업무는 인증 사용자별 서버 저장이며 공용 수입부 업무와 분리한다.
- 업데이트 240px/검색 260px. 긴 글씨는 줄바꿈, 페이지 주 스크롤, 작은 창에서 세로 배치한다.
- 소식은 30초 폴링과 피드백 25초 캐시. 최대 약 55초+통신 시간, 초 단위 push 아님.
- 실제 사용자 앱을 강제 종료하지 않는다. 설치 적용은 앱의 명시적 업데이트/재시작으로 진행한다.

### 1. 요청 — 기존색상이 좋은데 새 지침 등 적용

**Q.** 기존 색상은 유지하고 기획한 개인 업무·지침·피드백을 적용해 달라.

**A.** PC 홈에 생성/수정/완료/해제/요일 반복/이월/보관/복구/반복 종료를 구현했다. 날짜별 실행 건과 과거 완료 기록을 보존한다. 최근 지침과 피드백을 독립 순환하고 정지·이전/다음·전체·상세·원문 이동을 제공한다. 자동 노출만으로 읽음 처리하지 않는다.

**결과.** `desktop/shell/home-workspace.js`, `/api/desktop/home-workspace`, `lib/personalHomeStore.js`, `docs/contracts/desktop-home-workspace.json`. 원문은 검증된 itemId/caseKey와 실제 연도로 열린다. 2025/2026 및 차수 미확인을 구분한다.

## 데이터/권한 계약

| 동작 | 읽기 | 쓰기 |
|---|---|---|
| 개인 업무 조회 | 인증 사용자 파일 | 없음 |
| 개인 업무 변경/읽음 | 인증 사용자 파일, 현재 허용 피드 | 같은 소유 파일만 CAS·idempotency·원자 교체 |
| 지침 소식 | 기존 CURRENT 지침 | 없음 |
| 피드백 소식 | 기존 권한 predicate와 loadQuality | 없음 |
| 원문 이동 | 기존 지침/피드백 페이지 | 이동만으로 저장하지 않음 |

PC renderer는 임의 URL·소유자를 선택하지 못한다. main의 고정 HTTPS 경로와 인증 세션으로 요청하며 계정 세대가 바뀐 지연 GET/POST는 새 계정에 노출하지 않는다. CSP connect-src none 유지. 개인 기능은 EXE 동작/신규 SQL이 없어 dnSpy/운영 DB probe 대상이 아니며 기존 읽기 함수만 재사용했다.

## 검증

- desktop unit 21개, 전체 native smoke, 별도 프로세스 restore, exit/취소, updater hash/손상 파일 거부 통과.
- 실제 Electron fixture: 1920×1080 CSSpx/100%, 1024/800px, IPC 생성·완료·읽음·503 재시도·409·계정 A/B 지연 응답 격리·Enter/Space/Escape·Tab/CtrlT/F2.
- Chrome IPC fixture: 1920/800px 긴 제목 줄바꿈·초안 보존·초점 복귀·상세·순환 정지·가로 잘림/중첩 스크롤 없음.
- 로컬 production source smoke: 1920/800px 지침 itemId, 피드백 2025/2026 caseKey 원문 이동. API 쓰기 0건.
- 최종 backend 수정 후 ERP contract/dnSpy evidence/manifest/write guard/UI layout/root build 재검증 통과. 200규칙·100년 반복 목록 page200 조회 13.6ms, brute-force 비교·강제 종료 잠금 복구·활성/불명확 잠금 보존·5000규칙 한도·2100년 날짜 fixture 통과.
- 설치파일 SHA256: `193a4f4f83ea06363edbdd5682e213de94418b457b2535c4a1ff082b9a6090c7`. ASAR의 main/bridge/shell 6파일과 최신 소스 일치, latest.yml 크기·SHA512 일치.
- 테스트는 임시 소유자와 차단된 fixture 네트워크를 사용했다. 운영 개인 업무·공용 체크리스트·ERP DB를 테스트로 수정하지 않았다.

## 메뉴 기준선

| 기준 | 판정 | 근거 |
|---|---|---|
| 공간/스크롤/키보드 | 적용 | 원래 색상·폰트, 줄바꿈, 주 스크롤, 작은 창, 키보드/focus 검증 |
| 입력 보존/실패/충돌 | 적용 | 초안 유지, 같은 requestId 재시도, CAS, 계정 전환 폐기 |
| 매칭/업로드/ERP 쓰기 | 해당 없음 | 개인 업무 및 기존 원천 읽기만 |
| 연도/권한 | 적용 | 실제 연도·차수, source 권한, owner 검증 |
| 중복 Layout | 해당 없음 | native shell, 웹 원문은 기존 shell 유지 |
| 배포 | 적용 | PR1003 CI, Cafe24 성공, 공개 업데이트 feed1.3.5/hash 일치 |

## 미완/다음 작업

기존 모든 메뉴 UI 감사는 별도 진행 중이며 이번 홈 적용으로 완료 처리하지 않는다. 사용자 설치 앱이 1.3.5로 바뀌었는지는 명시적 업데이트 후 확인해야 한다. `.next-login-fixture/`는 기존 미추적 산출물이므로 커밋하지 않는다.

이어받기: 이 기록과 홈 계약을 읽고 PR·Cafe24 배포·desktop-v1.3.5 릴리스 결과를 확인한다. 기획 시안이나 fixture 통과를 사용자 설치 완료로 표현하지 않는다.

PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1003

## 배포 결과

- PR1003 최종 head75d91458: Windows installer/ERP guard 성공. master 병합c507b011.
- Cafe24 run37896854183 성공(https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37896854183), 운영 홈 API 게스트401 JSON 확인.
- https://github.com/Jayinsightfactory/nenova-erp-ui/releases/tag/desktop-v1.3.5 공개. 설치파일111708116bytes, GitHub asset SHA256과 로컬 SHA256 일치.
- 서버 배포 후 latest로 지정했다. 공개 latest/download/latest.yml 버전1.3.5·SHA512 일치, 운영 로그인 다운로드 링크1.3.5 확인.
- 운영 로그인 페이지를 읽고 API를 fixture로 차단한 Chrome smoke1920/800px 통과: ID 기억, 비밀번호 미저장, 재진입/계정 교체/실패 보존. 운영 로그인 POST/DB 쓰기 없음.
- 사용자 작업 앱의 강제 종료·설치는 하지 않았다. 앱 업데이트 확인 → 다운로드 → 업무 저장 후 재시작이 필요하다.

이 최종 결과 추가 기록은 병합 이후 현재 작업 브랜치에 보관한다. 기능 코드는 위 master 병합/배포에 포함되어 있다.
