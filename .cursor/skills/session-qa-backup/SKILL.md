---
name: session-qa-backup
description: >-
  Backs up each Cursor session as dated Q&A markdown under docs/work-sessions,
  including the user's questions and the agent's answers. Use at session end,
  context reset, 작업내역 저장, 백업, 컨텍스트초기화, or after a meaningful Nenova task.
---

# 세션 Q&A 백업

## 언제

- 사용자가 백업 / 컨텍스트 초기화 / 작업내역 저장 / 세션 종료를 말할 때
- 배포·버그수정처럼 의미가 있는 작업이 끝났을 때 (사용자가 안 시켜도)

## 어디에

프로젝트 루트 기준:

- 세션 파일: `docs/work-sessions/YYYY-MM-DD_{slug}.md`
- 목록: `docs/work-sessions/INDEX.md` (최신이 위)
- 같은 날 같은 주제이면 기존 세션 파일에 Q를 이어 붙인다. 주제가 바뀌면 새 slug.

개인 복사본이 필요하면 동일 내용을
`C:\Users\USER\.cursor\skills\session-qa-backup\sessions\` 에도 둘 수 있다. 정본은 저장소 `docs/work-sessions`이다.

## 파일에 넣을 것

1. 표: 세션 ID, 기간, 화면, 원장 부작용, 배포/PR, 다음 채팅 힌트
2. **이어받을 때 고정된 결정** (3~8줄)
3. `### N. 시각 — 짧은 제목` 아래에 **Q.** 사용자 문장 요약, **A.** 실제로 한 일/결론, **결과.** PR·파일
4. 미완 / 다음 세션 후보
5. 커밋하지 말 파일(tmp, probe)이 있으면 명시

## 하지 말 것

- 대화 JSONL 통째 붙여넣기
- API 키, JWT, DB 비밀번호
- 스택 트레이스 전문
- `docs/NENOVA_CONTROL_TOWER.md` 등 무관한 미추적 파일을 이 커밋에 섞기

## 컨텍스트 초기화 후 사용자에게

채팅에는 (1) 세션 파일 경로 (2) 다음 창에 붙여 넣을 한 줄만 남긴다:

```
docs/work-sessions/INDEX.md 와 가장 최근 세션 md를 읽고 이어서. 과거 대화는 그 파일 기준.
```
