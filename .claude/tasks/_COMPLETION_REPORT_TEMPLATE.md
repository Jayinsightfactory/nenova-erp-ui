# 작업 완료 보고 — {작업명}

> Cursor(지휘탑)가 매 작업 종료 시 작성. 파일명: `docs/work-reports/YYYY-MM-DD_{slug}.md`

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | YYYY-MM-DD HH:mm |
| 사용자 요청 | (한 줄) |
| 브랜치 | master / … |
| 커밋 | (없음 / `abc1234` — 메시지) |
| 배포 | (미배포 / nenovaweb ping 200 / GH Actions #id) |

---

## AI 구성 (어떻게 나눴는지)

| 담당 | 역할 | 위임 파일 / 프롬프트 |
|------|------|----------------------|
| **Cursor** | 지휘탑 — 요청 분석, 역할 분담, `claude -p` 실행, 테스트·diff·commit/push | — |
| **Claude Code** | (예: UI·다파일 구현, API, 테스트) | `.claude/tasks/{slug}-claude.txt` |
| **Codex** | (예: SQL·집계·알고리즘 설계·2차 검토) | `.claude/tasks/codex-{slug}.md` |
| **Cursor 직접** | (예: git push, gh run watch, ping) | — |

**분담 기준 (해당 시만 기재)**

- Claude: 10+ 파일, `.claude/agents/`, UI+API 통합 구현
- Codex: SQL/집계 공식, 성능, 3회+ 디버깅 실패, exe↔web 데이터 정합 설계
- Cursor만: git/gh/배포/smoke, 1~3파일 즉시 수정

---

## 작업 흐름 (어떻게 완료했는지)

1. **분석** — …
2. **위임** — Claude: `claude -p < .claude/tasks/…` / Codex: 프롬프트 작성(필요 시 Codex 앱 붙여넣기)
3. **검증** — `npm run …`, `npm run build`, `git diff --stat`
4. **마무리** — (커밋/push/배포 여부)

---

## 변경 요약

| 파일 | 내용 |
|------|------|
| `path/to/file` | … |

---

## 검증 결과

```
(테스트/build/ping 출력 요약)
```

---

## 사용자 확인 포인트

- (화면에서 볼 것, 운영 DB에서 실행할 명령 등)

---

## 미완 / 다음

- …
