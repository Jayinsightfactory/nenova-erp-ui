# PC 전역 규칙 충돌 6건 — 고치는 방법 제안 (2026-11-12)

> **제안만 한다. 이 문서를 만든 작업은 PC 전역 파일을 하나도 고치지 않았다(읽기만 했다).**
> 대상은 실측 기록([`RULE_FILE_INVENTORY_2026-11-12.md`](RULE_FILE_INVENTORY_2026-11-12.md)) 4절의 10~15번이다.
> 각 항목은 "어느 파일 몇째 줄 → 지금 문장 → 바꿀 문장" 순서로 적었다. 줄 번호는 2026-11-12 읽은 시점 기준이라, 붙여 넣기 전에 **지금 문장이 그대로 있는지** 먼저 확인한다.
> `~`는 `C:\Users\USER`다. 기억 파일 폴더는 `~\.claude\projects\C--Users-USER\memory\`다.

| # | 주제 | 고칠 파일 수 | 사장님 결정이 필요한가 |
|---|---|---|---|
| 10 | 임시 보관(stash) 복원 방법 | 2 | 아니오(더 안전한 쪽으로 통일) |
| 11 | 반영 기본값 | 1 (승인 대기 후보) | 아니오(이미 정해짐 — 후보를 반려) |
| 12 | 이카운트 예외 | 1 | 아니오(이미 정해진 예외를 한쪽에 마저 적기) |
| 13 | PM 한도 숫자 | 2 | **예** — 3건이 맞는지 999건이 맞는지 |
| 14 | 사장님 프로파일이 일부만 들어감 | 1 | **예** — 길이를 늘릴지(매 세션 첫 지시가 길어짐) |
| 15 | 같은 규칙이 3~5곳 | 여러 개 | 아니오(담당 파일만 정하면 됨) |

---

## 10. 임시 보관(stash) 복원 방법이 세 곳에서 다르다

따를 쪽: **`apply`만 쓴다(`pop` 금지).** 임시 보관함은 메인 작업 폴더와 모든 작업 폴더가 함께 쓰므로, `pop`은 다른 세션이 넣어 둔 것을 꺼내 버릴 수 있다.

**(가) `~\.claude\projects\C--Users-USER\memory\git-concurrent-session-safety.md` 16째 줄**

지금:
```
4. rebase가 "You have unstaged changes"로 막히면 `git stash push -- <다른세션의특정파일경로>`(경로 지정 필수, bare `git stash` 금지 — 내 것과 섞임) → rebase → `git stash pop`으로 정확히 복원.
```
바꿀 문장:
```
4. rebase가 "You have unstaged changes"로 막히면 `git stash push -m <태그> -- <다른세션의특정파일경로>`(태그·경로 지정 필수, bare `git stash` 금지 — 내 것과 섞임) → `git stash list --format='%H %gs'`로 내 항목의 해시를 적어 둠 → rebase → `git stash apply <해시>`로 복원(`pop` 금지 — 보관함은 모든 작업 폴더가 함께 쓴다) → 복원 확인 뒤 태그로 다시 찾아 `git stash drop`.
```

**(나) `~\.claude\persona\rules.json` 71째 줄** (`git-concurrent` 규칙의 `say`)

지금:
```
   "say": "같은 저장소를 다른 세션이 동시에 만지는 중이면 stash push --file 로 격리 후 rebase. force push 금지.",
```
바꿀 문장:
```
   "say": "같은 저장소를 다른 세션이 동시에 만지는 중이면 git stash push -m <태그> -- <파일경로> 로 격리 후 rebase, 복원은 apply 만(pop 금지). bare git stash 금지. force push 금지.",
```
주의: `rules.json`은 사람 승인으로만 바뀌는 파일이다. 직접 고치지 말고 `persona\bin\review.js`의 승인 절차로 넣는다. (`stash push --file`이라는 옵션은 git에 없다 — 경로는 `--` 뒤에 적는다.)

`~\.codex\AGENTS.md` 15째 줄("stash는 `git stash push -m <태그>` 후 `apply`만")은 이미 맞으므로 그대로 둔다.

---

## 11. 반영 기본값 — 승인 대기 후보가 지금 기준과 반대다

따를 쪽: **자동 검사를 통과하면 묻지 않고 반영한다**(`~\.codex\AGENTS.md` 16째 줄, 사장님 지시 "머지는 기본으로 항상 진행", 저장소 정본 4절). 예외는 DB 스키마 변경·마이그레이션이 든 수정안뿐이다.

**`~\.claude\persona\data\belief-candidates.md` 27째 줄** (아직 승인되지 않은 후보)

지금:
```
## 커밋·푸시·병합·배포는 명시 지시가 없으면 하지 않는다
```
할 일: **이 후보를 승인하지 않고 반려한다.** 근거 7건은 "특정 작업에서 그 작업 범위의 금지선으로 준 지시"(예: 2026-08-10 MOYI Drive 출시 준비)이고 저장소 전체의 기본값이 아니다. 반려 사유로 붙여 넣을 문장:
```
반려(2026-11-12): 근거가 개별 작업의 금지선이며 기본값이 아니다. 기본값은 "자동 검사 통과 시 묻지 않고 반영, DB 스키마 변경·마이그레이션만 사람 선행"(~/.codex/AGENTS.md, nenova-erp-ui docs/canon/CANON.md 4절).
```
같은 내용이 `belief-candidates.json`에도 있다. 두 파일은 `persona\bin\distill.js`가 다시 만들므로, 손으로 지우지 말고 `review.js`의 반려 절차를 쓴다(반려 명령의 정확한 옵션은 미검증 — `node review.js --help`로 확인).

---

## 12. 이카운트 예외가 한쪽에만 적혀 있다

따를 쪽: **기본은 조회 전용, 단 2026-10-21 사장님 결정 예외 1건**(기억 파일 `feedback-ecount-readonly-absolute.md` 20째 줄에 조건까지 적혀 있음).

**`~\.codex\AGENTS.md` 18째 줄**

지금:
```
- ECOUNT(이카운트)는 **조회 전용** — 입력·수정·저장·삭제 절대 금지. 자격증명·계좌번호·개인정보는 출력·저장 금지.
```
바꿀 문장:
```
- ECOUNT(이카운트)는 **조회 전용** — 입력·수정·저장·삭제 금지. 자격증명·계좌번호·개인정보는 출력·저장 금지. 예외는 하나뿐(2026-10-21 사장님 결정): ECOUNT 이관 작업에서 저장 화면의 계약을 확보하려고 'TEST-MOYI-날짜' 표식 샘플을 입력한 뒤 즉시 삭제하는 것. 조건(입력 전 삭제 경로 확인, 소액·당일, 회계반영·마감·국세청/은행 전송 금지, 화면당 1건, 삭제 확인 후 다음)은 `~/.claude/projects/C--Users-USER/memory/feedback-ecount-readonly-absolute.md`를 따른다. 그 밖의 쓰기는 전부 금지.
```
약점: Codex가 예외 문장을 넓게 읽을 위험이 있다. 그래서 "예외는 하나뿐", "그 밖의 쓰기는 전부 금지"를 문장 안에 넣었다.

---

## 13. PM 한도 숫자 — 기록과 실제 설정이 다르다 (사장님 결정 필요)

| 항목 | 기억 파일에 적힌 값 | 실제 값(2026-11-12 읽음) |
|---|---|---|
| 자율 작업 하루 한도 | 3건 (`pm-autowork-mode.md` 12째 줄, `MEMORY.md` 161째 줄 "하루3건") | `C:\Users\USER\nenova-pm\pm-config.json` 4째 줄 `"maxPerDay": 999` |
| 조사관에 넣는 규칙 수 | 최대 6개 (`nenova-pm-loop.md` 38째 줄) | `C:\Users\USER\nenova-pm\owner-rules.js` 38째 줄 `max = 5` |

어느 쪽이 사장님이 정한 값인지 기록으로는 확인하지 못했다(미검증). **실제 설정을 기록에 맞춰 낮추는 것은 PM의 동작을 바꾸므로 사장님이 정한다.** 두 경우의 붙여 넣을 내용:

**(가) 실제 값(999건 · 5개)이 맞다면 — 기록만 고친다**

`pm-autowork-mode.md` 12째 줄에서 `maxPerDay=3(자율분 별도 셈)` → `maxPerDay=999(사실상 한도 없음, 2026-11-12 실제 설정 확인)`
`MEMORY.md` 161째 줄에서 `하루3건` → `하루 한도 999(사실상 없음)`
`nenova-pm-loop.md` 38째 줄에서 `규칙 최대6개 주입` → `규칙 최대5개 주입`

**(나) 기록 값(3건)이 맞다면 — 설정을 고친다**

`C:\Users\USER\nenova-pm\pm-config.json` 4째 줄:
```
    "maxPerDay": 3,
```
규칙 수는 5개와 6개의 차이가 작아 기록 쪽(위 (가)의 셋째 줄)만 고치기를 권한다.

---

## 14. 사장님 프로파일이 앞부분만 들어간다 (사장님 결정 필요)

지금: `~\.claude\hooks\prompt-guard.js` 80째 줄이 `PERSONA.md`의 **앞 3,000자만** 세션 첫 지시에 붙인다. `PERSONA.md`는 전체 9,474자이고 절 순서가 "작업 성향 → 기타 → nenova → UIUX → 배포인프라 → Orbit → MOYI → 문서보고 → 카톡 → 상시 규칙(요약)"이라, UIUX 중간부터 뒤(배포·Orbit·MOYI·문서보고·카톡·상시 규칙)는 들어가지 않는다. 갱신일도 2026-10-01에서 멈춰 있다.

**(가) 길이만 늘리는 방법 — `prompt-guard.js` 80째 줄**

지금:
```
      personaHeader = '\n■ 사용자 프로파일(누적 학습)\n' + p.slice(0, 3000);
```
바꿀 문장:
```
      personaHeader = '\n■ 사용자 프로파일(누적 학습)\n' + p.slice(0, 10000);
```
약점: 모든 세션의 첫 지시가 약 6,500자 길어진다(매 세션 한 번).

**(나) 길이는 그대로 두고 순서를 바꾸는 방법(권장)** — `PERSONA.md`에서 `## 상시 규칙(요약)` 절(64째 줄부터)을 `## 작업 성향(측정치)` 바로 다음으로 옮긴다. 모든 영역에 걸리는 요약이 항상 들어가고 길이는 늘지 않는다. 단 `PERSONA.md`는 `persona\bin\distill.js`가 다시 만드는 파일이라, 손으로 옮기면 다음 생성 때 되돌아간다 — 생성 스크립트의 절 순서를 바꿔야 한다(스크립트의 해당 위치는 읽지 않았다, 미검증).

**낡은 것 고치기** — 프로파일 다시 만들기는 [`BACKLOG.md`](BACKLOG.md) A절 "2·3단계가 멈춰 있다"와 같은 일이다. 거기서 다룬다.

---

## 15. 같은 규칙이 3~5곳에 문구만 다르게 있다

방법: 규칙마다 **담당 파일 한 곳**을 정하고, 나머지에는 본문 대신 "담당 파일을 본다"는 한 줄만 남긴다. 한 곳만 고치면 되게 하려는 것이다.

| 규칙 | 담당 파일(본문을 두는 곳) | 지금 같은 내용이 있는 다른 곳(2026-11-12 검색) |
|---|---|---|
| 실행본 만들기는 webpack 고정 | 저장소 루트 `CLAUDE.md` "배포 주의" | `~\.claude\persona\rules.json` 84~87째 줄, 기억 파일 `nenovaweb-turbopack-hydration-outage.md`·`nenovaweb-ops-control-tower.md`·`raum-pnl-menu.md`, 저장소 `AGENTS.md` "Codex/Claude 공용 보충" |
| 출고상세·입고상세에 `isDeleted` 없음 | 저장소 `docs/DB_STRUCTURE.md` | `rules.json` 57째 줄, 기억 파일 `distribution-excel-authoritative.md`·`nenova-exe-cancel-gate-ghost-master.md`·`ordermaster-manager-must-be-userid.md`·`moyi-feature-master-plan.md` |
| 보고는 쉬운 말로 | `~\.claude\persona\rules.json` 8~11째 줄(매 지시에 자동으로 붙음) | 기억 파일(파일명 미확인), 각 세션 지시문 |
| 여러 PC에 영향 주는 명령은 1대 먼저 | `~\.codex\AGENTS.md` 19째 줄 | `rules.json` 268째 줄, 기억 파일(파일명 미확인) |
| `git reset --hard` 금지 | `~\.codex\AGENTS.md` 15째 줄 | `rules.json` 101째 줄(다른 맥락: Orbit 동기화 스크립트), 기억 파일 `feedback-no-reset-hard.md`·`gold-pipeline-status.md`·`mindmap-viewer-code-sync-wipes-local.md` |

다른 곳에 남길 한 줄(붙여 넣기용, 괄호 안만 바꿈):
```
↪ 이 규칙의 본문은 (담당 파일 경로)에 있다. 여기 문장과 다르면 담당 파일이 맞다.
```
주의 둘:
- `rules.json`의 규칙은 지시에 자동으로 붙는 장치라서 지우면 안 된다. 본문은 두되 `evidence`(근거) 칸에 담당 파일 경로를 적는 정도로 한다(승인 절차 경유).
- 기억 파일은 "그때 무슨 일이 있었나"를 적은 기록이다. 사건 설명은 두고, 규칙처럼 쓰인 문장에만 위 한 줄을 붙인다.

이 표의 "다른 곳"은 낱말 검색으로 찾은 것이라 빠진 파일이 있을 수 있다(미검증). "쉬운 말 보고"와 "1대 먼저"의 기억 파일 이름은 확인하지 못했다.

---

## 가장 큰 약점

이 제안은 **문장을 맞추는 일**이다. 문장을 맞춰도, 고친 뒤 다시 어긋나는 것을 막는 장치는 PC 쪽에 없다(저장소 쪽은 `npm run test:canon`이 있다). 13번처럼 "기록과 실제 설정이 다른" 경우는 기억 파일을 사람이 고치지 않는 한 또 생긴다.
