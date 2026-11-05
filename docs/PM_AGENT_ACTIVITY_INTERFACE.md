# PM 로봇 활동 표시 인터페이스 (2026-11-04)

사장님 지시: PM 사무실 장면에서 PM(로봇)도 다른 에이전트처럼 "해야 할 일·진행 상황"이 보여야 한다.
3D 장면(components/pm3d)은 별도 에이전트가 작업 중이므로 **여기서는 데이터 필드와 2D(목록 보기·팝오버)만** 구현했다.
3D 작업자는 아래 필드만 읽으면 된다(새 API 불필요).

## 데이터 (GET /api/pm/office → data)

- `agents[]` 중 `id === 'pm'` 항목: 기존과 동일하게 `status`(working/idle), `activity`(지금 하는 일 1줄), `lastAt`.
  사장님 PC `nenova-pm/pm.js` 가 루프마다 `~/.orbit/pm-status.json` 에 `now`(현재 단계 1줄)를 기록하고,
  `office-feed.js` 가 이를 pm 에이전트의 `activity` 로 올린다. → 3D 는 이 값을 PM 로봇 말풍선/칩에 그대로 쓰면 됨.
- `pmDetail` (신규, 없을 수 있음 — 구버전 피드 호환 필수):
  ```json
  {
    "now": "제품목표 g03 진행율 갱신 중",
    "doneToday": [{ "at": "ISO", "text": "radar-pilot 착수: X" }],
    "queueCount": 5,
    "approvals": 2
  }
  ```
- `workLog[]` 에 PM 행이 섞인다: `{ at, name: "PM", dept: "PM", label: "한 일 1줄" }` — 작업 로그 패널에서 부서 필터 "PM" 으로 조회.
- `vision` (제품 목표 보드 데이터) — `pages/pm.js` 의 `VisionPanel` 참고.

## 2D 구현(이 PR)

- 목록 보기 PM 자리 클릭 또는 상단 "🤖 PM 일지" 버튼 → `PmPopover`(지금/오늘 한 일/대기 큐/승인 대기/제품 목표 보드 연결).
- 3D 연결 시 권장: PM 로봇 클릭 → 같은 `PmPopover` 를 띄우도록 `onOpenPm` 콜백을 Scene3D props 에 추가(데이터 재사용, 중복 구현 금지).

## 원천 기록(사장님 PC, git 아님)

- `~/.orbit/pm-status.json` 의 `now` 필드: pm.js 가 단계마다 갱신.
- `~/.orbit/pm-agent-log.jsonl`: pm.js/pm-vision.js 가 한 일 1줄씩 append → office-feed 가 `pmDetail.doneToday` 와 `workLog` PM 행으로 올림.
