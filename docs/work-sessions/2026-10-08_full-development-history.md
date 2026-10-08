# MindMap 최초 개발부터 전체 개발 이력

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-08 |
| 화면 | 개발 히스토리 `/dev/history` |
| 원장 부작용 | 없음. Git 메타데이터·안전한 문서 제목만 수집, ERP/SQL 미접근 |
| 배포 | 구현·검증 진행 중 |

## 고정된 결정

- 기존 메뉴별 이력은 전체 작업 원장이 아니며, 최초 MindMap 개발 기록을 포함하지 못했다.
- 기본 화면을 전체 개발 이력으로 변경하고 기존 메뉴별 기능 화면을 보존한다.
- `mindmap-viewer`, `nenovakakao`, `nenova-erp-ui`의 검증한 기본 브랜치 reachable 전체 Git 이력을 연결한다.
- 변경 커밋·병합·날짜형 업무 요약을 별도 집계한다. 대화 횟수·작업시간으로 주장하지 않는다.
- 메뉴에 분류되지 않은 커밋도 보존한다. raw 대화·author identity·diff·비밀 파일 내용은 수집하지 않는다.
- 외부 자료는 기준 hash·수집 시점을 표시하고 최신성 미확인을 숨기지 않는다. 미병합 브랜치·미커밋 작업·개인 대화는 정식 합계 제외.

### 1. 전체 범위 정정

**Q.** MindMap 최초 개발부터 현재까지 전체로 잡아 달라.

**A.** 최초 `ef520b2`(2026-02-27), MindMap 기본 브랜치 1,824개 커밋, Kakao 기본 브랜치 115개 커밋과 ERP 전체 reachable 이력을 확인했다. 기존 메뉴 경로 및 first-parent 제한 때문에 빠진 출처와 미분류 기록을 별도 전체 탭으로 연결한다. 날짜형 개발 요약 제목 85개도 확보했으며, 커밋 합계에 더하지 않는다.

## 작업 경계와 검증

- ARCHITECT gpt-5.6-sol xhigh, IMPLEMENTER gpt-6-sol medium(terra 미지원 대체), MECHANICAL gpt-6-luna medium(동급 대체). 외부 읽기·쓰기·배포는 메인 담당.
- source clone은 메인이 읽기 전용으로 준비했다. 하위 작업은 운영 DB·secret·외부 쓰기에 접근하지 않는다.
- 개인정보 대화 원문을 공유 저장소에 옮기지 않는다.
- 이전 메뉴 히스토리 최종 배포 기록의 로컬 변경은 보존한다.

## 검증과 남은 운영 반영

- 전체 이력 집중 테스트 16/16, 기존 메뉴 회귀 12/12 통과.
- `npm run test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest -- --changed-from origin/master`, `guard:erp-writes -- --changed-from origin/master` 통과. 새 정적 조회 API를 staged 변경으로 포함해 쓰기 가드 재검증했다.
- 첫 빌드의 중복 import 오류를 제거했다. 최종 `npm run build` 통과.
- 독립 검토의 외부 graph parent/DFS completeness와 과거 App Router 메뉴 연결 두 항목을 보완하고 실제 graph·fixture로 재검증했다.
- 통합 원장 4,840개 커밋(비병합 4,158 / 병합 682). 별도 문서 기록 294개 중 제목 확인 253, 날짜만 확인 41은 `제목 미확인`으로 명시한다. 이 baseline은 이후 빌드 HEAD에 따라 증가한다.
- 남은 작업: 독립 최종 승인, 커밋/PR, 운영 배포, 로그인 실제 화면 검증.
