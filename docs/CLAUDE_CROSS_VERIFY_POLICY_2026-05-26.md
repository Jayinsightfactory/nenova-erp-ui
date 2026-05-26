# Claude Cross Verification Policy - 2026-05-26

## User Request
- After Codex finishes a work item, cross-check the completed work with Claude.
- The goal is to catch regressions, DB/ERP conflicts, and mismatches before considering the work fully closed.

## Required Post-Work Flow
1. Run local verification first.
   - Inspect diff.
   - Run `next build`.
   - Confirm the relevant behavior in code or browser when feasible.
2. Commit and push.
3. Confirm production deployment with:
   - `https://nenovaweb.com/api/dev/git-log?limit=1`
4. Prepare a Claude cross-check prompt.
   - Include the user request.
   - Include changed files and commit hash.
   - Include the intended behavior.
   - Include high-risk areas to review.
   - Explicitly instruct Claude to do read-only review unless the user approves writes.
5. Run Claude review when a Claude browser/session is available.
   - No live ERP data input.
   - No save/submit/delete actions.
   - Read-only page inspection and code review only unless explicitly approved.
6. Record Claude findings.
   - If Claude finds a real issue, fix it and repeat build/deploy verification.
   - If no issue, record "Claude cross-check: no blocking issue found".

## Claude Prompt Template

```text
Nenova ERP UI 교차검증 요청.

절대 운영 사이트에서 데이터 입력/저장/삭제/확정/전송 버튼을 누르지 말 것.
읽기 전용 코드 리뷰와 화면 구조 확인만 수행.

사용자 요청:
[요청 내용]

커밋:
[커밋 해시와 제목]

변경 파일:
[파일 목록]

의도한 동작:
[기대 동작]

검증할 위험:
- 기존 잘 되던 흐름이 깨졌는가?
- nenova.exe/ERP DB 구조와 충돌 가능성이 있는가?
- 출력/엑셀/분배/견적 금액처럼 후속 업무에 영향이 있는가?
- UI만 바꾼 것인지, DB write가 포함되는지 명확한가?
- 예외 케이스에서 잘못된 fallback이 생기는가?

결과는 아래 형식으로 답변:
1. 차단 이슈
2. 의심 이슈
3. 문제 없는 부분
4. 추가 확인 필요
```

## Current Note
- This policy is added as a standing workflow instruction for future Codex work.
- If Claude login/session is not available in the current browser, Codex should still provide the prompt so the user can paste it into Claude.
