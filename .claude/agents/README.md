# 네노바 ERP 에이전트 팀 (.claude/agents/)

**구성 일자**: 2026-04-29  
**기반**: GitHub 10k+ 스타 multi-agent 프레임워크 (vijaythecoder/awesome-claude-agents 25k⭐, VoltAgent/awesome-claude-code-subagents, MetaGPT 67k⭐, AutoGen 32k⭐, CrewAI 22k⭐) 의 **Orchestrator + Specialist** 패턴을 네노바 작업 패턴 (최근 6주 ~80 커밋) 에 매핑.

## 팀 구성도

```
                    nenova-orchestrator (opus)
                    "직접 구현 X, 위임만"
                              │
        ┌─────────┬───────────┼───────────┬─────────┐
        │         │           │           │         │
   db-schema-  freight-   paste-      chat-sql-  mobile-ui-
     guard    pipeline-   mapping-    agent-      builder
              engineer    curator     tuner
        │         │           │           │         │
        └─────────┴───────────┴───────────┴─────────┘
                              │
        ┌─────────┬───────────┼───────────┬─────────┐
        │         │           │           │         │
   deploy-    rollback-   session-    excel-cost-  code-
   verifier   strategist  historian   validator    reviewer
   (haiku)
                              │
                       db-migration-runner
```

## 에이전트 일람

### 🎯 Orchestrator (1)

| 이름 | 모델 | 역할 |
|---|---|---|
| **nenova-orchestrator** | opus | 작업 분류 → 적절한 specialist 위임. 직접 구현 X. 최대 2 specialist 병렬. |

### 🔧 Domain Specialists (6)

| 이름 | 모델 | 트리거 |
|---|---|---|
| **db-schema-guard** | sonnet | SQL / 컬럼명 / OutUnit / 전산 호환 / isDeleted·isFix |
| **freight-pipeline-engineer** | sonnet | freightCalc.js / 운송원가 / fixture 238/238 / 카테고리 / GW·CW |
| **paste-mapping-curator** | sonnet | 학습 매핑 / parseMappings / fallback 가드 / data/order-mappings.json |
| **chat-sql-agent-tuner** | sonnet | lib/chat/* / Text-to-SQL / haiku-sonnet 하이브리드 / 비용 |
| **mobile-ui-builder** | sonnet | pages/m/* / MobileShell / 48px 터치 / 버튼 선택형 |
| **db-migration-runner** | sonnet | ALTER TABLE / 마이그레이션 / 전산 호환 / 백업 |

### 🛡 Quality & Ops (4)

| 이름 | 모델 | 트리거 |
|---|---|---|
| **deploy-verifier** | haiku | 푸시 후 / GitHub Actions / /api/ping / /m/admin/status |
| **rollback-strategist** | sonnet | 회귀 / stable-13-14 비교 / dangling/* / git tag |
| **code-reviewer** | sonnet | 큰 변경 후 보안/품질 검토 (직접 수정 X) |
| **excel-cost-validator** | sonnet | 카카오톡 엑셀 vs DB 1:1 검증 |

### 📚 Memory (1)

| 이름 | 모델 | 트리거 |
|---|---|---|
| **session-historian** | sonnet | "작업내역 저장" / 세션 종료 / 메모리 인덱스 |

## 사용법

### 자동 호출 (description 기반)

각 에이전트의 `description` 이 트리거 조건. Claude Code 가 작업 내용 보고 자동으로 적절한 에이전트 호출.

예: 사용자가 "운송원가 단가가 이상해요" 라고 하면 → freight-pipeline-engineer 자동 호출.

### 명시 호출

```
@nenova-orchestrator 17-2 MEL 카네이션 단가 검증하고 freight 코드도 손봐줘

@db-schema-guard 이 SQL 검토해줘: SELECT * FROM OrderMaster WHERE ...
```

### Orchestrator 의 응답 포맷

복잡한 작업은 항상 4단:

```
## 작업 분석
- 도메인:
- 영향 범위:
- 주의사항:

## Specialist 위임
1. [ ] @db-schema-guard ...
2. [ ] @freight-pipeline-engineer ...

## 실행 순서
- 병렬: [1, 2]
- 순차: 3 → 4

## Main Agent 지시
1. ...
```

## 모델 라우팅 정책 (비용 ↔ 품질)

- **opus** (오케스트레이터만): 복잡한 분류/위임 결정
- **sonnet** (대부분 specialist): 일반 코딩
- **haiku** (deploy-verifier): 빠른 헬스체크 (curl/grep 위주)

이미 챗봇이 사용하는 haiku-4-5 1차 → sonnet-4-5 재시도 패턴과 일관.

## 도구 할당 철학

- **Read-only 검토자** (code-reviewer, deploy-verifier): Read, Grep, Glob, Bash
- **코드 작성자** (specialists): Read, Edit, Write, Grep, Glob, Bash
- **오케스트레이터**: Read, Grep, Glob, Bash (Edit 없음 — 위임만)
- **메모리 작성자** (session-historian): Read, Write, Edit, Glob, Bash

## 메모리 / 문서 의존성

각 에이전트가 시작 시 우선 참조:

| 에이전트 | 우선 참조 |
|---|---|
| db-schema-guard | `docs/DB_STRUCTURE.md` (트러블 9건) |
| freight-pipeline-engineer | `docs/FREIGHT_PIPELINE.md` |
| paste-mapping-curator | `feedback_mapping_fallback_guard.md` |
| chat-sql-agent-tuner | `lib/chat/router.js` 흐름 + `costTracker.js` |
| mobile-ui-builder | `components/m/MobileShell.js` 패턴 |
| rollback-strategist | `feedback_rollback_strategy.md` + `feedback_conversion_logic.md` |
| excel-cost-validator | `reference_cost_excel_location.md` |

## 절대 룰 (전 에이전트 공통)

1. **작업 디렉토리**: `C:\Users\cando\Downloads\nenova-erp-ui10\nenova-erp-ui\` (Downloads 밑!)
2. **푸시는 사용자 명시 요청 시만**: master 직접 푸시는 sandbox 가 차단
3. **fixture 우선**: `lib/freightCalc.js` 변경 시 238/238 검증 강제
4. **백업 우선**: DB 마이그레이션 / 매핑 정정 / 롤백 전 백업
5. **메모리 갱신**: 의미있는 작업 후 `session-historian` 호출
6. **stale 정정**: 메모리에서 오래된 사실 발견하면 정정 (혼동 유발)

## 추가/수정 절차

새 specialist 추가:
1. `.claude/agents/<name>.md` 작성 (frontmatter + system prompt)
2. `nenova-orchestrator.md` 의 위임 룰 표에 추가
3. 본 README 의 일람표 갱신
4. 커밋 메시지: `feat(agents): add <name> specialist`

## 참고 자료 (10k+ 스타 출처)

- [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) — 100+ 카테고리별 에이전트
- [vijaythecoder/awesome-claude-agents](https://github.com/vijaythecoder/awesome-claude-agents) — Orchestrator + Specialist 패턴
- [0xfurai/claude-code-subagents](https://github.com/0xfurai/claude-code-subagents) — DB/API/Test 도메인 전문가
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — Claude Code 마스터 큐레이션
- [MetaGPT](https://github.com/geekan/MetaGPT) — 67k⭐ "AI 소프트웨어 회사" 시뮬레이션
- [Microsoft AutoGen](https://github.com/microsoft/autogen) — 32k⭐ multi-agent conversational
- [CrewAI](https://github.com/crewAIInc/crewAI) — 22k⭐ 역할 기반 협업
- [Claude Code 공식 문서 — Subagents](https://code.claude.com/docs/en/sub-agents)
