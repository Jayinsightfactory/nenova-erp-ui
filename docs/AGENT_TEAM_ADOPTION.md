# 10k+ 스타 프로젝트에서 네노바/Claude 에 적용 가능한 항목

**작성**: 2026-04-29  
**목적**: GitHub 1만 스타 이상의 multi-agent / agent-team / Claude 워크플로우 프로젝트들의 패턴 중, 네노바 ERP 또는 Claude Code 사용 환경에 직접 적용 시 **업무 효율 / 관리** 측면에서 효과가 있을 만한 것 정리.

이미 채택해서 `.claude/agents/` 에 반영한 항목과, 추가로 검토할 만한 후보를 분리해 표시.

---

## ✅ Tier 1 — 이미 채택 (오늘 적용 완료)

### A1. Orchestrator + Specialist 패턴
**출처**: vijaythecoder/awesome-claude-agents (25k⭐), MetaGPT (67k⭐)  
**채택**: `.claude/agents/nenova-orchestrator.md` + 9 specialist  
**효과**: 다도메인 작업(예: 운송원가 + 매핑 + 모바일 UI) 시 작업 분해 자동화. 메인 컨텍스트가 specialist 결과 요약만 받아 컨텍스트 폭주 방지.

### A2. "오케스트레이터는 직접 구현 X, 위임만" 룰
**출처**: vijaythecoder tech-lead-orchestrator  
**채택**: `nenova-orchestrator.md` 의 절대 룰  
**효과**: 오케스트레이터가 어설프게 구현하다 specialist 룰(OutUnit CASE WHEN 등) 위반하는 사고 방지. opus 모델로 분류만 하고 코드는 sonnet specialist 가 처리 → 비용/품질 균형.

### A3. 도구 할당 철학 (Read-only / Researcher / Writer)
**출처**: VoltAgent (100+ 에이전트)  
**채택**: 각 specialist 의 `tools:` 필드 차등 부여  
**효과**: code-reviewer 는 Edit 없음 → "리뷰가 아니라 직접 수정" 사고 방지. deploy-verifier 는 Bash + WebFetch 만 → DB 직접 조회 같은 위험 행위 차단.

### A4. 모델 라우팅 (opus / sonnet / haiku)
**출처**: Shipyard, claude-code-ultimate-guide  
**채택**: 오케스트레이터=opus, 대부분=sonnet, deploy-verifier=haiku  
**효과**: 이미 네노바 챗봇이 haiku 1차 → sonnet 재시도 하이브리드 사용 중. 동일 사상을 에이전트 팀에도 확장. 일간 비용 추정 30-50% 절감 가능.

### A5. 응답 4단 포맷 (Task Analysis → Assignments → Order → Instructions)
**출처**: tech-lead-orchestrator  
**채택**: `nenova-orchestrator.md` 강제 포맷  
**효과**: 사용자가 어디까지 진행됐는지 한눈에. "다음 세션 이어받기" 메모리 작성도 이 포맷 기반으로 자동 도출.

### A6. 도메인별 우선 참조 문서 (DB_STRUCTURE.md / FREIGHT_PIPELINE.md / feedback_*.md)
**출처**: VoltAgent CLAUDE.md 컨벤션  
**채택**: 각 specialist 가 시작 시 강제로 읽음  
**효과**: 매 작업마다 같은 함정(`OrderKey` ← 없음, 영문 카테고리 등) 재발 방지. 9개월간 누적된 트러블 회고 9건이 자동으로 컨텍스트에 들어감.

### A7. 회귀 안전망 (stable-13-14 / dangling/* 태그 비교)
**출처**: 네노바 자체 + git-best-practices  
**채택**: `rollback-strategist.md` 의 절대 룰  
**효과**: 이미 사용 중인 패턴을 에이전트로 정형화. "새 로직으로 더 좋게" 의 충동을 시스템적으로 차단.

### A8. fixture 강제 검증 (238/238)
**출처**: 네노바 자체 + 일반 TDD  
**채택**: freight-pipeline-engineer 가 fixture 미실행 = 커밋 차단  
**효과**: `lib/freightCalc.js` 회귀가 매출 데이터 신뢰성 직결 → 자동 게이트.

---

## 🟡 Tier 2 — 추가 검토 (다음 세션 후보)

### B1. PreCompact / PostCompact 훅으로 메모리 자동 보존
**출처**: claude-code-ultimate-guide, Shipyard  
**무엇**: 세션이 컴팩트 (자동 요약) 되기 직전에 hook 실행 → 중요 사실을 별도 파일로 추출  
**적용**: `.claude/settings.json` 의 `hooks.PreCompact` 에 명령 등록  
**예상 효과**: session-historian 을 사람이 호출하는 대신 자동 호출. "작업내역 저장후" 라고 매번 안 말해도 됨.

```json
{
  "hooks": {
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node scripts/auto-save-session.js"
      }]
    }]
  }
}
```

### B2. Stop 훅으로 푸시 안 한 변경 알림
**출처**: claude-code best practices  
**무엇**: Claude 가 응답 끝낼 때 git status 검사해서 미커밋/미푸시 변경 있으면 시스템 메시지로 알림  
**적용**: `.claude/settings.json` 의 `hooks.Stop`  
**예상 효과**: "어 푸시 안 했네" 가 매번 발생. 자동 알림으로 빠짐 방지.

### B3. PostToolUse 훅 — Edit 후 prettier/eslint 자동
**출처**: 거의 모든 production 사례  
**무엇**: Write/Edit 직후 prettier --write 자동 실행  
**적용**:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_response.filePath' | { read -r f; npx prettier --write \"$f\" 2>/dev/null || true; }"
      }]
    }]
  }
}
```
**예상 효과**: 코드 스타일 일관성. 네노바는 현재 prettier 설정 없음 → 도입 검토 가치 있음.

### B4. PreToolUse 훅 — Bash 위험 명령 차단
**출처**: AutoGen 보안 가이드, Anthropic 공식  
**무엇**: `git push --force` / `rm -rf` / DB DROP 등 차단  
**적용**: `if` 필드로 `Bash(git push --force:*)` 매칭 시 deny  
**예상 효과**: 이미 sandbox 가 master 직접 푸시 차단. force push / DROP 는 추가 보호.

### B5. Slash Command 화 (`/freight-verify`, `/mapping-check`)
**출처**: hesreallyhim/awesome-claude-code  
**무엇**: 자주 쓰는 검증 시퀀스를 슬래시 커맨드로 묶음  
**적용**: `.claude/commands/freight-verify.md` 생성  
**예시**:
```
---
description: 운송원가 검증 풀세트 실행
---
1. node __tests__/freightCalc.test.js
2. node scripts/verify-1702-mel.mjs
3. node scripts/verify-1801-ecuador.mjs
4. 결과를 표로 정리
```
**예상 효과**: 매번 풀어 쓰는 검증 워크플로를 한 줄로. 신규 동료 온보딩에도 도움.

### B6. CLAUDE.md 갱신 (현재 .claude/CLAUDE.md 가 있음 — 활용도 강화)
**출처**: VoltAgent CLAUDE.md, Anthropic 공식 가이드  
**무엇**: 프로젝트 진입 시 자동으로 로드되는 컨텍스트 문서. 네노바는 이미 있지만 에이전트 팀과 동기화 필요.  
**적용**: 기존 `.claude/CLAUDE.md` 에 "에이전트 팀이 활성화되어 있음 — 자세한 내용은 `.claude/agents/README.md` 참조" 한 줄 추가  
**예상 효과**: Claude 가 처음 진입할 때 에이전트 팀 존재 자동 인지.

### B7. MCP 서버 — DB 직결 (mssql-mcp)
**출처**: modelcontextprotocol/servers (15k⭐)  
**무엇**: MSSQL MCP 서버 등록 → Claude 가 직접 SELECT (parameterized) 가능  
**적용**: `.mcp.json` 에 mssql 서버 추가  
**예상 효과**: 매번 `node scripts/probe-*.js` 작성 안 해도 됨. **단**: 운영 DB 직결은 위험 → readonly 슬레이브 또는 검증된 권한만.

### B8. 에이전트 평가 (skill-creator 식)
**출처**: anthropic-skills:skill-creator  
**무엇**: 각 specialist 에 대해 "이런 입력에 어떻게 응답하는지" 평가 케이스 작성  
**적용**: `.claude/agents/evals/<name>.md`  
**예상 효과**: 에이전트 description 변경 시 회귀 자동 감지. 신규 에이전트 도입 전 정량 검증.

### B9. PR 자동 리뷰 봇
**출처**: 일반 GitHub Actions 패턴  
**무엇**: GitHub Actions 가 PR 열릴 때 code-reviewer 에이전트 자동 호출 → 리뷰 코멘트  
**적용**: `.github/workflows/claude-review.yml`  
**예상 효과**: 사람 리뷰어 부담 감소. 단, 네노바는 master 직접 푸시 워크플로라 PR 거의 없음 → 우선순위 낮음.

### B10. Status line 커스터마이징
**출처**: claude-code 공식  
**무엇**: 화면 하단 status line 에 현재 git 브랜치 / 마지막 fixture 결과 / 비용 표시  
**적용**: `.claude/settings.json` 의 `statusLine`  
**예상 효과**: "지금 master 인지 worktree 인지" 한눈에. 네노바는 worktree 작업 사례 있음 (2026-04-22) → 효과 있음.

```json
{
  "statusLine": {
    "type": "command",
    "command": "echo \"$(git rev-parse --abbrev-ref HEAD) | $(git rev-parse --short HEAD) | $(date +%H:%M)\""
  }
}
```

---

## 🔵 Tier 3 — 도입 신중 (효과 < 비용)

### C1. CrewAI / AutoGen 식 멀티 에이전트 대화
**출처**: CrewAI (22k⭐), AutoGen (32k⭐)  
**무엇**: 에이전트끼리 자유롭게 대화하며 합의 도달  
**왜 신중**: 토큰 비용 폭주. 네노바 작업은 대부분 "한 사람이 한 도메인 처리" → 시퀀셜 위임으로 충분. Claude Code 공식 권장도 "subagents > Agent Teams (대부분 작업)".

### C2. MetaGPT 식 "AI 소프트웨어 회사" 시뮬레이션
**출처**: MetaGPT (67k⭐)  
**무엇**: PM/아키텍트/엔지니어/QA 풀스택 시뮬  
**왜 신중**: 네노바는 이미 운영 중인 ERP. 처음부터 설계하는 게 아니라 점진적 개선. PM 역할은 사용자 본인이 함.

### C3. Background agent fleet (`claude --bg`)
**출처**: claude-code 최신 기능  
**무엇**: 백그라운드 에이전트가 돌면서 모니터링 (CI 실패 / production 알람)  
**왜 신중**: 비용 누적. 네노바는 GitHub Actions / pm2 / `/m/admin/status` 가 이미 모니터링. 굳이 LLM 백그라운드 안 돌려도 됨.

### C4. Vector DB / RAG 도입 (LangGraph 36k⭐)
**출처**: LangGraph, LlamaIndex  
**무엇**: 코드/문서 임베딩 → 의미 기반 검색  
**왜 신중**: 네노바 코드베이스는 grep + Glob 으로 충분히 빠름. RAG 인프라(임베딩 모델, 벡터 DB) 운영 비용이 효과 대비 큼.

### C5. Voice mode 활성화
**출처**: claude-code voice (실험적)  
**무엇**: 음성 입력으로 명령  
**왜 신중**: 코딩에는 비효율. 모바일에서는 유용할 수 있으나 네노바는 데스크톱 작업 위주.

---

## 🚀 즉시 실행 가능한 후속 작업 (Top 3)

우선순위로 추천:

1. **B1 (PreCompact 훅) + B2 (Stop 훅)** — 메모리 자동화
   - 효과: "작업내역 저장" 명시 호출 안 해도 자동 보존
   - 비용: 30분 작성 + 테스트
   - 적용 위치: `.claude/settings.json`

2. **B5 (Slash Commands)** — `/freight-verify` / `/db-check` / `/deploy-verify`
   - 효과: 자주 하는 풀세트 검증 한 줄로
   - 비용: 1시간 (5-7개 커맨드)
   - 적용 위치: `.claude/commands/*.md`

3. **B6 (CLAUDE.md 갱신)** — 에이전트 팀 존재 명시
   - 효과: Claude 가 자동으로 `nenova-orchestrator` 우선 호출
   - 비용: 5분
   - 적용 위치: `.claude/CLAUDE.md`

---

## 측정 지표 (전후 비교)

에이전트 팀 도입 효과 측정:

| 지표 | 도입 전 (추정) | 도입 후 목표 |
|---|---|---|
| 회귀 발생 빈도 | 1-2회/주 | 0-1회/주 |
| OrderMasterKey 오타 | 6주간 3건 | 0건 |
| 영문 카테고리 매칭 실패 | 1건/세션 | 0건 |
| fixture 미검증 커밋 | 가끔 | 0건 |
| "작업내역 저장" 누락 | 가끔 | 0건 (B1 자동화 후) |
| 일간 LLM 비용 | 베이스라인 | -30~50% (haiku 라우팅) |
| 컨텍스트 압축 트리거 | 1-2회/세션 | 0-1회/세션 |

---

## 참고 자료

| 출처 | 스타 | 핵심 채택 항목 |
|---|---|---|
| [vijaythecoder/awesome-claude-agents](https://github.com/vijaythecoder/awesome-claude-agents) | 25k+ | Orchestrator + Specialist (A1, A2, A5) |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | 다수 | 도구 할당 철학 (A3), CLAUDE.md 컨벤션 (B6) |
| [0xfurai/claude-code-subagents](https://github.com/0xfurai/claude-code-subagents) | 다수 | DB/API/Test 도메인 전문가 (네노바 specialist 설계 참조) |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 큐레이션 | Slash command 패턴 (B5) |
| [MetaGPT](https://github.com/geekan/MetaGPT) | 67.4k | 역할 기반 멀티에이전트 (참고만) |
| [Microsoft AutoGen](https://github.com/microsoft/autogen) | 32k+ | Agent 보안 / 위험 명령 차단 (B4) |
| [CrewAI](https://github.com/crewAIInc/crewAI) | 22k+ | 역할 기반 협업 (참고만, C1) |
| [Anthropic Claude Code Docs](https://code.claude.com/docs/en/sub-agents) | 공식 | frontmatter 표준, 모델 라우팅 |
| [LangGraph](https://github.com/langchain-ai/langgraph) | 36k+ | 워크플로우 그래프 (네노바엔 과함, C4) |
| [Shipyard multi-agent guide](https://shipyard.build/blog/claude-code-multi-agent/) | 블로그 | 3단 파이프라인 (PM-Spec → Architect → Implementer-Tester) |

---

## 부록: 도입 단계 체크리스트

### Phase 1 (오늘 완료) ✅
- [x] `.claude/agents/` 디렉토리 + 10 에이전트 작성
- [x] orchestrator + 9 specialist + README
- [x] 각 에이전트 frontmatter / tools / model 차등 할당

### Phase 2 (권장 — 다음 1주)
- [ ] B6 — `.claude/CLAUDE.md` 에 에이전트 팀 존재 한 줄 추가
- [ ] B5 — `/freight-verify` / `/db-check` / `/session-save` 슬래시 커맨드 작성
- [ ] B10 — status line 커스터마이즈 (브랜치/커밋/시간)

### Phase 3 (선택 — 효과 본 후)
- [ ] B1 — PreCompact 훅으로 session-historian 자동 호출
- [ ] B2 — Stop 훅으로 미푸시 알림
- [ ] B3 — Edit 후 prettier 자동 (prettier 설정 도입 후)
- [ ] B7 — MSSQL MCP 서버 readonly 등록

### Phase 4 (장기 — 효과 큰 경우만)
- [ ] B8 — 에이전트 평가 시스템 (skill-creator 식)
- [ ] B9 — PR 리뷰 자동화 (PR 워크플로 도입 후)
