# 규칙·지침 파일 실측 (2026-11-12)

> **조사 뒤 정해진 것(2026-11-12 사장님 결정)** — ① 작업 기록은 `WORK_MEMORY.md` 한 곳으로 통일(아래 충돌 3번 해소). ② Cursor는 쓰지 않으므로 `.cursor/` 폴더(규칙 3개·스킬 1개)와 Cursor 전용 완료 보고 틀(`.claude/tasks/_COMPLETION_REPORT_TEMPLATE.md`)을 지웠다(충돌 5번 해소). 아래 표는 **지우기 전 조사 시점** 그대로 남긴다.
>
> **2차 정리(2026-11-12, 백로그 D절 작업)** — 줄 번호는 정리 뒤 달라졌다. 아래 표의 줄 번호는 조사 시점 것이다.
> - 충돌 1(`xlsx-js-style`): `.claude/CLAUDE.md`의 금지 문장과 옛 라이브러리 목록을 빼고, 루트 `CLAUDE.md`에 "사용 라이브러리" 절을 만들어 한 곳에만 둠.
> - 충돌 2(올리기·배포): `.claude/CLAUDE.md`와 `nenova-orchestrator.md`의 "명시 요청 시에만" 문장을 `AGENTS.md` 기준을 가리키는 문장으로 바꿈.
> - 충돌 3(작업 기록 위치): `.claude/PROGRESS.md`·`.claude/PLAN.md` 맨 위와 `docs/work-reports/README.md`에 "새로 쓰지 않는다" 표시. `.claude/CLAUDE.md`의 체크리스트 2·3번, 종료 시 저장 규칙, 컨텍스트 복구 프롬프트와 `docs/NENOVA_WEB_MASTER_ISSUES_AND_WORK_GUIDE.md`·`docs/REGRESSION_PREVENTION_GUIDE.md`·`docs/work-sessions/README.md`의 기록 지시 문장을 `WORK_MEMORY.md`로 고침. `session-historian.md`에는 "정본 참조" 표시만 닮(다른 PC 경로를 가리키는 옛 문서).
> - 충돌 4(단일 기준): `.claude/CLAUDE.md` 끝 문장을 "세션 시작 체크리스트·보존 태그의 담당 파일"로 바꿈.
> - 충돌 6(`CustKey` 빈 값): 수리 행을 루트 `CLAUDE.md`에서 `AGENTS.md` "작업 전 필수 확인"으로 옮김. 수리 기능 자체(코드)는 그대로다.
> - 충돌 7·8(낡은 문서): `PROJECT_STATUS.md`·`SOLUTION_LINK.md` 맨 위에 "옛 기준" 표시. 내용은 그대로.
> - 충돌 9(메인 작업 폴더에만 있는 규칙): `.claude/rules/insight-agreement.md`(4줄)를 본편에 넣음. 스킬 2종(`insight-requirement-review`, `insight-button-evidence`)과 Codex용 사본은 넣지 않음 — 아래 2절 끝 참조.
> - 충돌 10~15(PC 전역): 고치지 않고 [`PC_GLOBAL_RULE_FIX_PROPOSAL_2026-11-12.md`](PC_GLOBAL_RULE_FIX_PROPOSAL_2026-11-12.md)에 줄 단위 제안을 적음.
> - 옛 기록 경로를 스크립트·검사가 참조하는지 전수 검색함: `.claude/PROGRESS.md`·`.claude/PLAN.md`를 읽는 스크립트·검사·자동 검사 설정은 0건(`lib/fullDevelopmentHistory.cjs`의 `PROGRESS.md`는 저장소 맨 위 파일 이름 허용 목록이며 `.claude/` 아래 파일과 무관). `docs/work-reports/`는 계약 9개·테스트 기준값 3개·코드 주석 6곳·스크립트 1개가 가리켜 옮기지 않음.

정본([`CANON.md`](CANON.md))을 어디에 둘지 정하려고 한 조사 기록이다. 읽기만 했고, 저장소 밖(PC 전역·바탕화면·`nenova-pm`) 파일은 하나도 고치지 않았다.
확인하지 못한 것은 "미검증"으로 적었다. 줄 번호는 조사 시점(본편 `275666d6`) 기준이다.

## 1. 정본을 어디에 두었고 왜인가

**`docs/canon/CANON.md` 새 파일 1개.** 기존 파일을 정본으로 삼지 않은 이유:

- **모든 도구가 자동으로 읽는 파일이 없다.** Claude Code는 `CLAUDE.md`만, Codex·Cursor는 `AGENTS.md`만, Cursor는 추가로 `.cursor/rules`만 자동으로 읽는다. PC의 PM 루프는 이 저장소 지침 파일을 아예 읽지 않는다(`nenova-pm`의 모든 .js에서 `CLAUDE.md`·`AGENTS.md` 문자열 0건). 어느 파일을 고르든 나머지가 그것을 가리키게 해야 한다.
- **`AGENTS.md`는 ERP 원장 변경 절차 문서다**(약 15KB, Next.js가 자동으로 다시 쓰는 구역 포함). 판단 기준을 얹으면 더 길어지고, Claude Code는 이 파일을 자동으로 읽지 않는다.
- **`.claude/CLAUDE.md`는 스스로 "단일 진실 소스"라고 적었지만 낡았다**("마지막 업데이트: 2026-04-24", 다른 파일과 부딪히는 문장 3곳).
- **판단 기준(무엇을 먼저 지킬지)은 저장소 어느 파일에도 없었다.** 있는 것은 전부 도메인 규칙(ERP·DB·화면)이다. 그래서 정본은 판단 기준과 "어느 규칙이 어디에 있는가"만 담고, 도메인 규칙 본문은 원래 파일에 그대로 둔다.
- 기획 대화가 제안한 `.nowlink/` 폴더는 쓰지 않았다. 이 저장소는 네노바 ERP이고 NOWLINK 상품 저장소는 따로 있다(`C:\Users\USER\nowlink`). 여기에 `.nowlink/`를 만들면 규칙 파일이 한 벌 더 생긴다.

연결 방식: 루트 `CLAUDE.md`는 `@docs/canon/CANON.md` 한 줄로 **세션 시작 때 자동으로 불러온다**(Claude Code의 파일 불러오기 기능). `AGENTS.md`와 `.cursor/rules/canon.mdc`는 "작업 전에 읽는다"는 문장으로 가리킨다. Codex와 Cursor가 실제로 그 문장을 따라 읽는지는 **미검증**이다.

## 2. 저장소 안 규칙·지침 파일

| 파일 | 크기 | 읽는 도구 | 내용 | 자동 주입 |
|---|---|---|---|---|
| `CLAUDE.md` | 7.5KB | Claude Code | DB 쓰기 규칙 5개, 이슈 패턴, 진단 API, 빌드 주의 | 자동 |
| `.claude/CLAUDE.md` | 7.9KB | Claude Code | 세션 시작 체크리스트, 금지 목록, 종료 시 기록 규칙, 보존 태그 | 자동 |
| `AGENTS.md` | 15KB | Codex, Cursor | 메뉴·가이드 영상·화면틀·키보드 기준, ERP 변경 절차, 계약, 검증 명령 | 자동(Claude는 아님) |
| `.cursor/rules/ai-orchestrator.mdc` | 0.9KB | Cursor | Cursor가 지휘, Claude 구현, Codex 설계 | 자동(`alwaysApply`) |
| `.cursor/rules/session-qa-log.mdc` | 0.8KB | Cursor | 세션 질문·답변을 `docs/work-sessions`에 기록 | 자동 |
| `.cursor/skills/session-qa-backup/SKILL.md` | — | Cursor | 위 기록의 형식 | 호출 시 |
| `.claude/agents/*.md` 14개 + `README.md` | 1~5KB씩 | Claude Code | 지휘 1 + 전문 담당 13 | 호출 시 |
| `.claude/skills/nenova-erp-change-guard/SKILL.md` | — | Claude Code | ERP 변경 가드 절차(`AGENTS.md`를 필수 입력으로 지정) | 호출 시 |
| `.claude/PLAN.md` · `.claude/PROGRESS.md` | 20KB · 124KB | Claude Code | 계획·세션 기록 | `.claude/CLAUDE.md`가 "먼저 읽어라" |
| `WORK_MEMORY.md` | 432KB | Codex(전역 규칙이 지시), Claude도 씀 | 작업 기록 2,616줄 | 아님(찾아 읽음) |
| `docs/work-sessions/` 526개 · `docs/work-reports/` 191개 | — | Cursor, Codex | 세션 Q&A · 완료 보고 | 아님 |
| `PROJECT_STATUS.md` | 10.5KB | 없음(가리키는 곳 없음) | 2026-03-27 현황. "Next.js 14.2.0", "배포예정: Railway", "쓰기 → `_new_` 테스트 테이블" — 전부 지금과 다름 | 아님 |
| `SOLUTION_LINK.md` | 3.4KB | Cursor("항상 포함할 것"이라고 적혀 있음) | 다른 저장소와의 연결 지점. "`_new_` 테이블 경유"는 지금과 다름 | 아님 |
| `.claude/settings.local.json` | 1.1KB | Claude Code | 허용 명령(다른 PC `C:\Users\cando\…` 경로가 남아 있음) | 자동 |
| 저장소 hooks | — | — | **없음.** `.claude/settings.json`·`.husky`·`.claude/hooks` 없음. 자동 검사는 GitHub Actions(`erp-contract.yml`)뿐 | — |

본편에 없고 메인 작업 폴더(`C:\Users\USER\nenova-erp-ui`)에만 있는 미추적 파일: `.claude/rules/insight-agreement.md`(합의 보존 규칙 4줄), `.claude/skills/insight-*` 2개, `.agents/skills/insight-*` 2개(Codex용). **작업 폴더를 새로 만들어 일하는 세션에는 이 규칙이 따라오지 않는다.**

2차 정리(2026-11-12)에서 메인 작업 폴더를 읽기만 해서 다시 확인한 결과(미추적 33개 중 규칙·스킬 19개):

| 파일 | 판단 | 처리 |
|---|---|---|
| `.claude/rules/insight-agreement.md` (4줄) | 유효 — 정본 2절("승인 질문은 되돌리기 어려운 작업에만")·사장님 학습 기록("기존 로직 + A", 되묻고 멈추지 않기)과 같은 방향 | **본편에 넣음**(글자 하나 바꾸지 않고 그대로) |
| `.claude/skills/insight-requirement-review/` (8개 파일) | 판단 보류 — 바깥 공개 스킬(ECC, Superpowers)을 고쳐 만든 것이고, 출처 기록(`PROVENANCE.json`)에 이 PC의 실험 폴더 절대 경로가 들어 있다. 효과를 잰 기록이 없다 | 넣지 않음 |
| `.claude/skills/insight-button-evidence/SKILL.md` | 판단 보류 — 근거가 다른 저장소(`mindmap-viewer`) 파일과 이 PC에서만 열리는 주소(`127.0.0.1:4317`)이고, 본문에 "실제 개발 효율과 운영 효과는 미측정"이라고 적혀 있다 | 넣지 않음 |
| `.agents/skills/insight-*` (Codex용 사본 10개 파일) | 위 두 스킬과 같은 내용 | 넣지 않음 |

나머지 미추적 14개는 규칙이 아니라 진행 중이던 코드·백업 파일이다(`lib/costMasterStore.js` 등 원가 관련 4개와 테스트 3개, `pages/api` 3개, `scripts/ecount-scraper/*.bak-*` 3개, `wt-hub-motion/` 폴더). 이번 범위 밖이라 건드리지 않았다.

## 3. PC 전역 규칙·지침 파일 (저장소 밖, 읽기만 함)

| 파일 | 읽는 도구 | 내용 | 자동 주입 |
|---|---|---|---|
| `~/.claude/CLAUDE.md` (0.8KB) | Claude Code 전 세션 | 가이드 영상 지침 2문단뿐. 판단 기준 없음 | 자동 |
| `~/.claude/settings.json` 훅 3개 | Claude Code | 매 지시에 "지시 보완기"(`hooks/prompt-guard.js`), 세션 끝에 기록 2개 | 자동 |
| `~/.claude/persona/rules.json` (32KB) | 지시 보완기, `/brief`, PM `owner-rules.js` | 사장님 지시 이력에서 나온 규칙 41개 + 지시 빈칸 5종 | 조건이 맞을 때만, 한 지시에 4개까지 |
| `~/.claude/persona/PERSONA.md` (21KB) | 지시 보완기 | 영역별 목적·판단 기준·화나는 지점·기본값 | 세션 첫 지시에 **앞 3,000자만**(전체 9,474자) |
| `~/.claude/agents/` 2개 | Claude Code | 실행 담당, 읽기 전용 측정 담당 | 호출 시 |
| `~/.claude/projects/C--Users-USER/memory/` 167개 | Claude Code | 기억 파일(프로젝트 125, 교정 27, 참조 13) | `C:\Users\USER`에서 연 세션만 |
| `~/.claude/projects/C--Users-USER-nenova-erp-ui/memory/` 2개 | Claude Code | "테스트까지 끝내고 자동 반영" 1건 | 이 저장소 세션 |
| `~/.codex/AGENTS.md` (3.3KB) | Codex | 저장소 지도, 공통 금지, 묻지 말고 반영, 이카운트 조회 전용, `WORK_MEMORY.md` 기록 | 자동(제목은 "Codex/Claude 공용"이나 Claude는 자동으로 읽지 않음) |
| `~/.codex/USAGE_POLICY.md` · `WORKFLOW_VIDEO_GUIDELINES.md` · `config.toml` · `rules/default.rules` · 스킬 3종 | Codex(영상 기준은 Claude도) | 사용량·영상·설정 | 일부 자동 |
| `C:\Users\USER\nenova-pm\pm.js` 외 | 작업 스케줄러(30분마다) | PM 루프. 규칙은 코드 문자열과 JSON(`pm-config.json`, `playbooks.json` 카드 55장) | PM 실행 시 |
| `C:\Users\USER\nenova-pm\owner-rules.js` | PM 조사관 | `rules.json`에서 5개까지 골라 조사관 지시문에 넣음 | PM 실행 시 |
| `C:\Users\USER\nenova-pm\github-radar\radar.js` | 작업 스케줄러(월·목 07:30) | GitHub 저장소 수집·평가·게시 | — |

`pm.md`: `C:\Users\USER` 전체, `D:\`, `E:\`에서 **없음**(접근 권한 때문에 건너뛴 폴더가 있었는지는 미검증).

## 4. 충돌 목록

### 저장소 안

| # | 주제 | 한쪽 | 다른 쪽 |
|---|---|---|---|
| 1 | `xlsx-js-style` | `.claude/CLAUDE.md:84` "**금지**: `xlsx-js-style` (Turbopack 빌드 실패)" | `CLAUDE.md:141` "webpack 전환으로 사용 가능 … 과거 금지 사유(Turbopack 실패)는 소멸" (`package.json`에 `^1.2.0` 실제 설치) |
| 2 | 올리기·배포 | `.claude/CLAUDE.md:141` "GitHub push 여부 확인 (사용자 명시 요청 시만)", `nenova-orchestrator.md:61` "`git push` 는 사용자 명시 요청 시에만" | `AGENTS.md:105` "별도의 배포 지시를 기다리지 않고 … master 병합 → Cafe24 배포 → 실브라우저 스모크 확인까지 포함한 하나의 작업으로" |
| 3 | 작업 기록 위치 | `.claude/CLAUDE.md:117` "`.claude/PROGRESS.md` 최상단에 세션 블록 추가" | `AGENTS.md:117` "`docs/work-sessions/YYYY-MM-DD_{slug}.md`" · `ai-orchestrator.mdc` "`docs/work-reports/`" · `~/.codex/AGENTS.md` "`WORK_MEMORY.md` 끝에 append" — **네 곳 모두 지금도 쓰이고 있다** |
| 4 | 무엇이 단일 기준인가 | `.claude/CLAUDE.md:176` "이 파일은 프로젝트의 단일 진실 소스" | `AGENTS.md:142` "전역 규칙은 `~/.codex/AGENTS.md`, 진입 문서는 `.claude/CLAUDE.md`·루트 `CLAUDE.md`" |
| 5 | 도구별 역할 | `ai-orchestrator.mdc` "Cursor: 요청 분석, 역할 분담 … Cursor만 직접: git / gh" | `AGENTS.md:132` "수정은 항상 `git worktree add …` → PR"(Codex·Claude가 직접), `nenova-orchestrator`가 "수석 기술 리드" |
| 6 | 출고상세 `CustKey` 빈 값 | `CLAUDE.md:132` `repairMissingCustKey` "비었거나 … 다를 때 같은 값으로 복구" | `AGENTS.md:49` "NULL만으로 오류·조회 제외·인쇄 차단·SQL 보정을 판단하지 않는다" |
| 7 | 쓰기 방식 | `PROJECT_STATUS.md` "쓰기(POST) → `_new_` 테스트 테이블 저장", `SOLUTION_LINK.md` "전산과 공유하는 테이블 직접 쓰기 금지 → `_new_` 테이블 경유" | `CLAUDE.md`·`AGENTS.md`는 계약 범위 안에서 원장 직접 쓰기를 전제로 함(`_new_` 언급 0건) |
| 8 | 기술 버전 | `PROJECT_STATUS.md` "Next.js 14.2.0", "배포예정: Railway" | `package.json` `next ^16.2.1`, `CLAUDE.md` "Cafe24 Ubuntu 서버" |
| 9 | 규칙이 폴더마다 다름 | 메인 작업 폴더에만 있는 `.claude/rules/insight-agreement.md` | 본편과 새 작업 폴더에는 없음 |

이번 수정안은 1·2·4·6에 "정본 참조" 표시를 달았다. 3·5는 사장님 결정이 필요해 정본에 "미정"으로 올렸다. 7·8(`PROJECT_STATUS.md`, `SOLUTION_LINK.md`)은 건드리지 않았다 — 어느 도구도 자동으로 읽지 않는 낡은 문서라 "보관 처리" 제안만 한다.

### PC 전역 (제안만, 고치지 않음)

| # | 주제 | 내용 |
|---|---|---|
| 10 | 임시 보관(stash) 방법 | `~/.codex/AGENTS.md` "`apply`만" ↔ 기억 파일 `git-concurrent-session-safety.md` "`git stash pop`으로 복원" ↔ `rules.json` `git-concurrent` "stash push --file" |
| 11 | 반영 기본값 | `~/.codex/AGENTS.md` "CI 통과 시 묻지 말고 squash 머지" ↔ 승인 전 후보(`belief-candidates.md`) "커밋·푸시·병합·배포는 명시 지시가 없으면 하지 않는다" |
| 12 | 이카운트 예외 | `~/.codex/AGENTS.md` "입력·수정·저장·삭제 절대 금지" ↔ 기억 파일 "2026-10-21 예외(사장님 결정): 표식 샘플 입력 후 즉시 삭제는 허용" — 예외가 한쪽에만 있음 |
| 13 | PM 한도 | 기억 파일 "하루 3건", "규칙 최대 6개 주입" ↔ 실제 `pm-config.json` `"maxPerDay": 999`, `owner-rules.js` `max = 5` |
| 14 | 프로파일이 낡고 일부만 들어감 | `PERSONA.md` 갱신 2026-10-01, 앞 3,000자만 주입되어 배포·Orbit·MOYI·문서보고·카톡 절은 들어가지 않음 |
| 15 | 같은 규칙이 3~5곳 | webpack 고정, `isDeleted` 없음, 쉬운 말 보고, 1대 먼저 시험, `reset --hard` 금지 — 문구가 제각각이고 한 곳을 고쳐도 나머지는 남음 |

## 5. 기획 대화 설계와 이미 있는 것

| 기획 대화의 설계 | 이미 있는 것 | 이번에 한 일 |
|---|---|---|
| 사장님 판단 방식 지침 | `~/.claude/persona/PERSONA.md`(영역별 판단 기준 3개씩) + `rules.json` 41개 + 매 지시 자동 주입 훅 | 새로 만들지 않음. 정본에는 학습 기록과 맞는 것만 넣고, 안 맞는 것은 "확인 필요"로 분리 |
| `.nowlink/rules.json`(검사 가능한 규칙) | `~/.claude/persona/rules.json`(조건·문구·근거 필드, 사람 승인으로만 편입, 과하게 걸리는 규칙은 편입 거부) | 만들지 않음. 규칙 파일이 둘이 되는 것을 피함 |
| `.nowlink/implicit-dev-rules.json` | 없음 | 만들지 않음(위와 합치기로 한 결정대로) |
| `.nowlink/golden/`(과거 정답 사례) | `docs/exe-golden/*.md`, `__tests__/fixtures/*golden*`, `scripts/golden/`, `docs/contracts/*.json` 213건 | 만들지 않음 |
| `diff-log.jsonl`(수정+왜) | 기억 파일 중 "왜/어떻게 적용" 형식 71개(PC), `persona/data/pending-lessons.jsonl` 106건(전부 대기), `WORK_MEMORY.md` | 저장소 안에는 없어서 `docs/canon/why-log.jsonl`로 형식과 예시 3건만 만듦 |
| 원리 승격(후보 → 승인 → 규칙) | `persona/bin/distill.js`(후보 만들기) → `review.js`·`add-rules.js`(사람 승인). 단 **자동 실행이 아니고** 마지막 후보 생성이 2026-10-01 | 만들지 않음. 백로그에 "멈춘 곳" 기록 |
| PM 관제탑 | `C:\Users\USER\nenova-pm`(30분 주기 루프, 대장 74건) + 화면 `/pm` | 겹치지 않는 부분(아이디어 가르기·설계 수 한도·측정 관문)만 `.claude/agents/nenova-pm.md` 초안으로 |
| 기술 레이더 | `nenova-pm\github-radar\radar.js` + `/pm/radar` + 시험 담당 `pm-radar-pilot.js` | 만들지 않음. 출처 확장은 백로그 |
| `scripts/check-rules.js`(hook 검증) | 저장소 hook 없음. 자동 검사는 GitHub Actions | `scripts/check-canon.cjs`를 기존 자동 검사(`erp-contract.yml`)에 한 단계로 추가 |

## 6. 바탕화면 기획 파일

| 파일 | 수정 시각 | 성격 |
|---|---|---|
| `nowlink.txt` (8.4KB, 81줄) | 2026-11-11 15:44 | 1차본, 4개 절 |
| `nowlink.html` (22KB) | 2026-11-11 16:43 | 시연용 화면. 버튼 5개가 전부 글자·색만 바꾸고 서버 호출이 없음. 숫자(`+₩420,000`, `99.8%`, `22%`)는 화면에 박아 넣은 값 |
| `nowlink2.txt` (8.3KB, 86줄) | 2026-11-11 17:01 | "최종 통합본", 8개 절 |
| `nowlink_master_session_memory.txt` (8.4KB, 85줄) | 2026-11-12 09:10 | 정본 13개 절. 머리말에 "이후 추가된 PART A~F·수정본은 포함돼 있지 않다"고 적혀 있음 |

**두 txt의 차이** — 글자 그대로 같은 줄은 20줄뿐이다. `nowlink2.txt`가 더 새롭지만 `nowlink.txt`를 완전히 대체하지는 못한다.

- `nowlink.txt`에만: 인프라 상태("GitHub PR #24 병합 및 Railway … 배포 완료", 도메인 연결), 업계별 현장 은어 예시, 도메인 지식 수집 경로(외주 의뢰서·직무기술서), 오픈소스 2개(Twenty CRM, Baserow), "기술 레이더의 4대 모델 분석 기준", "200%", "글로벌 AI 검색 유입 독점", 끝의 "다음 대화 시 업데이트 규칙"
- `nowlink2.txt`에만: 5절(개발자·직원·카톡 수정 기록 루프, `.nowlink/rules.json`), 6절(객관식 역질문), 7절(PM 관제탑, Work Token), 8절(UI 빌더, SQL 템플릿, 이카운트 양방향)
- 정본은 `nowlink2.txt`를 이어 쓴 것이 아니라 다시 쓴 본문이다(같은 줄 3줄, 절 번호도 다름)

`C:\Users\USER\nowlink`는 새로 만든 저장소가 아니라 `mindmap-viewer`를 기록째 복제해 분리한 MOYI 상용 저장소다(저장 기록 1,899개). `C:\Users\USER\nowlink-ops`는 같은 원격의 두 번째 작업 폴더이고 2026-10-19에서 멈춰 있다. 두 곳 모두 `.nowlink/` 폴더는 없다.

## 7. 정본 13개 절의 실제 구현 현황

"있음"은 그 일을 하는 코드·파일을 실제로 찾은 경우만이다. 대부분 파일 머리말 주석과 이름으로 판단했고 실행해 보지는 않았다.

| 절 | 내용 | 상태 | 있는 것 | 없는 것 |
|---|---|---|---|---|
| 1 | AI 추천 유입(GEO/AEO) | 일부 | 공개 첫 화면 `nowlink\public\index.html`(`nowlink-api-production.up.railway.app` 응답 200 확인), `nowlink\src\mcp-server.js` | 해결 사례 페이지, 전환 측정. `nowlink.kr`은 인증서 이름 불일치로 열리지 않음 |
| 2-① | 엑셀+카톡으로 업무 구조 자동 생성 | 일부 | `nowlink\routes\company-os-generator.js`(구조만 만드는 단계), ERP `pages\demo\tenant-studio.js` | 자동 역설계 코드 |
| 2-② | 한 데이터, 부서별 화면 | 일부 | ERP `lib\userAccess.js`, `lib\workManuals.js`, `nowlink\src\nowlink\tenant-guard.js` | 역할별 자동 화면 변환(미검증) |
| 2-③ | 이익 방어·승인 카드 | 일부 | ERP `pages\mgmt\approvals.js`, `lib\profitReport*.js`, `nowlink\src\nowlink\automation\policy.js` | "확신도 98%" 기준, 방어한 손실액 지표 |
| 2-④ | 파일 흐름 추적 | 일부 | ERP `pages\work\drive.js`, `pages\api\work\drive-egress.js` | 반출 "차단"(실물은 기록만 함) |
| 2-⑤ | 매뉴얼 자동 생성 | 일부 | ERP `lib\workManuals.js`, `scripts\sync-orbit-manuals.js`, `data\work-manuals\` | 실시간 갱신(실물은 주 1회 동기화) |
| 2-⑥ | 눌러야 넘어가는 가이드 영상 | 일부 | ERP `docs\WORKFLOW_VIDEO_GUIDES.md`, `config\workflow-guides.json`, 화면 기록 `components\ReplayRecorder.js` | 조작형(실물은 일반 영상 + 목차) |
| 2-⑦ | 기술 레이더 | 일부(레이더는 있음) | `nenova-pm\github-radar\radar.js`, ERP `pages\pm\radar.js` | 무중단 자동 적용(실물은 채택에 사장님 승인) |
| 3 | 여러 AI 모델 조합 | 일부 | `nowlink\src\llm-gateway.js`, 모델별 연결 3종 | 정해진 조합 순서, 사내 경량 모델 |
| 4 | 다른 업종 확장 | 없음(문서 언급만) | `nowlink\docs\NOWLINK_PRODUCT_PLAN.md` 한 줄 | 업종별 틀·은어 사전 |
| 5 | 개발자 수정 기록 → 규칙 | 없음(비슷한 것만) | `~/.claude/persona/rules.json`, `nenova-pm\owner-rules.js` | 정본에 적힌 파일 3개와 `.nowlink/implicit-dev-rules.json` 전부 |
| 6 | 과거 기록 소급 수집 | 일부(원재료만) | `WORK_MEMORY.md`, ERP `lib\fullDevelopmentHistory.cjs` | 규칙·학습 자료로 바꾸는 코드 |
| 7 | 직원 수정·카톡 패턴 자산화 | 일부 | ERP `lib\pasteManualMappingOverride.js`, `lib\naturalLanguageProductMatching.js`, `pages\api\kakao\*` | 그 이름의 수집·승격 흐름 |
| 8 | 객관식 역질문 | 일부 | ERP `lib\chat\disambiguation.js`(챗봇 안에서만) | "6대 공통 질문 축", 답의 영구 반영 |
| 9 | 자체 진화 경기장 | 일부 | `nowlink\src\nowlink\automation\shadow.js`·`trust.js`(개별 자동화 절차 대상, 자동 승인은 사람이 켜야 함) | 새 버전을 채점해 본 서버에 올리는 구조 |
| 10 | PM 관제탑 | 일부(PM 루프는 있음) | `nenova-pm\pm.js`, ERP `pages\pm.js`·`pages\api\pm\*` | 네노바 내부용뿐. 역질문 배정, 야간 경기장 관리 |
| 11 | 파이썬·PyPy 기반 | 없음 | 보조 스크립트뿐 | PyPy·FastAPI·Unsloth. 정본 머리말이 이후 "PyPy 폐기"라고 밝힘 |
| 12 | UI 빌더·SQL 틀·이카운트 | 일부(이카운트만) | ERP `lib\ecount.js`, `pages\api\ecount\*` | 끌어다 놓는 UI 빌더. 이카운트 연동은 NOWLINK가 아니라 네노바 ERP 안에 있음 |
| 13 | 숙련도·확장 제안·규칙 외부화 | 일부(약함) | `nowlink\routes\workforce-optimizer.js`(본문 미검증), ERP `docs\contracts\*.json` | 숙련도 표, 확장 제안 카드 |

정본 안의 근거 없는 표현(전부 "가설"로 다룬다): "확신도 98% 이상"(2절), "AGI"(2·8절), "100% 보존"(6절), "무중단 패치"(2절), "완벽 동기화"(12절), "최상위 AI 사령탑"(10절). 다른 파일에만 있는 것: "200%", "90% 이상 구조가 동일", "1분 만에", "휴먼 에러 제로화", "99.8%".

## 8. 미검증

- Codex·Cursor가 "작업 전에 정본을 읽는다"는 문장을 실제로 따르는지(Claude Code의 `@` 불러오기만 자동)
- PC PM 조사관이 저장소 폴더에서 작업할 때 그 저장소의 `CLAUDE.md`를 읽는지
- 기억 색인(`MEMORY.md`, 40KB)이 전부 주입되는지 잘리는지
- `OrbitPersonaVerifyDaily` 2026-11-12 실행이 비정상 종료 코드로 끝난 원인
- `nowlink.txt`의 "GitHub PR #24 병합"(로컬에서는 #23까지만 확인)
- ERP 저장소 전체 검색 일부가 시간 제한으로 끊겨, 7절의 "없는 것" 중 2-③·12·13은 완전하지 않음
- `mindmap-viewer`, `nenovakakao` 등 다른 저장소는 보지 않음
