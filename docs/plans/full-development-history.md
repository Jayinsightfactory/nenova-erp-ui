# 전체 개발 히스토리 확장 PRD

## 구현·검증 상태 (2026-10-08)

- 기본 전체 탭, 프로젝트/원본 저장소/레코드 종류/변경 성격/기간/검색/페이지 이동을 구현했다. 기존 메뉴별 기능과 레거시 탭은 유지한다.
- 외부 두 저장소는 기본 브랜치 manifest, ERP는 실제 빌드 HEAD를 출처로 삼는다. ERP HEAD를 무조건 병합된 master로 단정하지 않으며 `build-head`로 명시한다. 운영 배포에서는 병합된 master HEAD를 빌드한다.
- 외부 graph의 hash·head·root·전체 parent 연결·도달 개수를 검증한다. 현재 안전한 통합 원장은 4,840개 커밋, 별도 날짜형 문서 기록 294개다. 253개는 제목 확인, 41개는 INDEX 제목을 확인하지 못한 날짜형 문서이며 `제목 미확인`으로 분리한다. 이 수치는 이후 커밋·문서가 추가되면 증가한다.
- MindMap에 이식된 ERP App Router의 `nenova-erp-ui/src/app/(app)/**/page.tsx`도 현재 메뉴와 실제 route가 일치할 때 연결한다. 같은 커밋을 여러 프로젝트/메뉴에 연결해도 전체 고유 합계는 늘지 않는다.
- 아래 설계의 모든 역사 route alias 수동 catalog, patch-id 유사 변경 묶음, 사용자 요청 횟수 산정은 이번 구현 완료 범위가 아니다. 해당 기록은 전체 원장에서 제거하지 않고 미분류/프로젝트 공통으로 보존한다.
- 정적 snapshot 생성/조회만 수행하며 ERP/SQL 원장은 미접근이다. 코드 테스트 16건, 기존 메뉴 회귀 12건 및 필수 ERP 가드를 실행한다. 최종 배포·화면 검증 결과는 세션 기록에 남긴다.

## 1. 결정 요약

`/dev/history`의 기본 화면을 현재 Nenova ERP 메뉴에 연결된 일부 커밋 목록에서, **MindMap Viewer 최초 개발부터 현재 Nenova ERP까지 이어지는 검증 가능한 개발 원장**으로 확장한다.

핵심 결정은 다음과 같다.

1. 기본 `전체` 탭은 세 저장소의 검증된 기본 브랜치에 도달 가능한 모든 커밋을 보여준다. `first-parent`나 현재 메뉴 연결 여부로 커밋을 버리지 않는다.
2. 저장소와 프로젝트를 분리한다. 예를 들어 `mindmap-viewer` 저장소의 `nenova-erp-ui/**` 변경은 source repository는 MindMap Viewer이면서 project는 Nenova ERP일 수 있다.
3. 커밋은 `initial`, `research`, `plan`, `fix`, `feature`, `test-guard`, `ops-refactor`, `other`로 근거와 함께 분류한다. 애매한 항목은 추정하지 않고 `other`로 남긴다.
4. 메뉴 연결은 커밋 원장 위의 다대다 edge다. 한 커밋이 여러 메뉴에 연결돼도 전체 커밋 수는 늘지 않으며, 연결되지 않은 커밋도 `미분류`로 원장에 남는다.
5. 병합 커밋과 비병합 커밋을 분리해 표시한다. 둘을 모두 포함한 합계를 “수정 횟수”나 “작업 횟수”로 부르지 않는다.
6. Git 커밋과 업무 기록을 별도 record kind로 둔다. 허용된 날짜형 문서 제목은 타임라인 근거로 쓸 수 있지만 커밋 수와 합산하지 않고, 본문·대화 원문은 수집하지 않는다.
7. 웹에 포함되는 snapshot은 안전한 메타데이터만 담는다. author 신원, commit body, diff, 비밀 경로, 세션 본문, `WORK_MEMORY.md` 본문은 포함하지 않는다.

이 문서는 구현 계약 제안이다. 이 작업에서는 코드·생성 snapshot·API·UI를 변경하지 않는다.

## 2. 정정된 사용자 의도와 완료 기준

### 원하는 결과

- 최초 `mindmap-viewer` 개발부터 Nenova/MOYI 연계와 현재 `nenova-erp-ui`까지 한 화면에서 시간순으로 찾을 수 있다.
- `전체`, 프로젝트별 탭, 작업 성격, source stage, 메뉴·기능으로 좁힐 수 있다.
- 각 프로젝트의 기본 브랜치에 병합된 커밋은 메뉴에 연결되지 않아도 빠짐없이 보인다.
- 기능 추가와 이후 보정 규모를 구분하되, 근거 없는 사용자 요청 수·작업 횟수·작업 시간은 만들지 않는다.
- 자료의 출처, 기준 ref/head, 생성 시각, 포함·제외 범위와 stale 여부를 화면에서 확인할 수 있다.

### 비목표

- private session 대화 원문을 공유 저장소나 웹 snapshot으로 옮기지 않는다.
- 미병합 브랜치, 삭제된 로컬 작업, 다른 PC의 대화까지 “전체”라고 단정하지 않는다.
- 커밋 제목만으로 실제 업무 의미, 사용자 요청 수, 투입 시간, 개발자 성과를 추론하지 않는다.
- Git 읽기 기능을 ERP/MSSQL 조회나 쓰기와 연결하지 않는다.
- 운영 DB, `nenova.exe`, 배포, 병합 정책을 변경하지 않는다.

## 3. 현재 근거와 문제

현재 구현은 `scripts/generate-menu-development-history.cjs`에서 이 저장소의 `HEAD`에 대해 `git log --first-parent`를 실행하고, `components/Layout.js`의 현재 메뉴 및 `config/menu-development-history.json`의 일부 기능 경로와 일치하는 커밋만 `data/generated/menu-development-history.json`에 넣는다. 현재 생성 snapshot은 메뉴 85개, 메뉴 관련 고유 커밋 1,289건이다. 이는 전체 Git 원장이 아니라 **현재 ERP 메뉴로 분류된 first-parent 부분집합**이다.

그 결과 다음이 빠진다.

- 2026-02-27의 MindMap Viewer 최초 개발과 이후 Orbit/MOYI 작업
- 별도 `nenovakakao` 저장소의 카카오 수집·분류·연계 작업
- Nenova ERP 저장소에서 현재 메뉴 경로와 연결되지 않은 문서, 기반 코드, 테스트, 운영 가드, 삭제·이동 이력
- merge의 두 번째 부모로 들어왔지만 first-parent diff에 충분히 드러나지 않는 개별 커밋
- 삭제되거나 이름이 바뀐 과거 메뉴·기능 경로
- Git 커밋과 구별해야 하는 날짜형 업무 요약 문서

`mindmap-viewer`의 현재 README는 해당 저장소를 Orbit과 Nenova 관련 작업을 한곳에서 이어가는 기준 저장소로 설명하며, 현재 tree에 `nenova-erp-ui/`, `moyi/`, `WORKSPACE.md`, `WORK_MEMORY.md`가 존재한다. 이는 소스 저장소와 업무 프로젝트를 별도 축으로 모델링해야 한다는 근거다.

## 4. 검증된 source baseline

아래 수치는 2026-10-08 로컬 read-only Git probe 결과다. “커밋 레코드”이지 사용자 요청이나 독립 작업 횟수가 아니다.

| source repository | 검증 ref/head | root 또는 최초 확인 커밋 | main reachable | 비병합 | merge | 비고 |
|---|---|---|---:|---:|---:|---|
| `mindmap-viewer` | `main` / `bdd7f5e07d78` (2026-10-07) | `ef520b2f0499` (2026-02-27), `Initial commit: Claude Work MindMap Viewer` | 1,824 | 1,820 | 4 | all refs 1,849이나 미병합 ref는 정식 범위에서 제외 |
| `nenovakakao` | `main` / `0602a4075883` (2026-09-28) | `8cd6959bbc49` (2026-04-12), 카톡 수집·분류·시트 자동화 초기 코드 | 115 | 113 | 2 | all refs 262이나 미병합 ref는 정식 범위에서 제외 |
| `nenova-erp-ui` | `HEAD = origin/master` / `43466ea0ac64` (2026-10-08) | `b4c5da128ba4` (2026-04-01), ERP 초기 구현 | 2,901 | 2,225 | 676 | 로컬 `master` 포인터는 과거 상태이므로 사용하지 않음 |
| 합계 | 각 검증 기본 브랜치 | - | **4,840** | **4,158** | **682** | 세 source 간 동일 full hash 0건 |

`nenovaweb`은 현재 커밋 원장이 없는 것으로 확인됐으므로 0건 프로젝트로 합계에 넣지 않는다. UI에는 “연결 후보 · Git 원장 미확인” source metadata만 표시하고, 근거가 준비되기 전에는 커밋 수를 `0`이 아니라 `확인 불가`로 표시한다.

### 범위 문구

화면의 “전체”는 반드시 다음처럼 설명한다.

> 등록된 세 source repository에서 snapshot 생성 시점에 검증된 기본 브랜치로부터 도달 가능한 전체 커밋입니다. 미병합 브랜치, 로컬 미커밋 작업, private 대화 원문은 포함하지 않습니다.

## 5. 정보 구조와 기본 화면

### 5.1 탭

상단 프로젝트 탭 순서는 다음과 같다.

1. `전체` — 기본 선택. 세 source의 verified-main 커밋 4,840건을 중복 없이 조회한다.
2. `MindMap · Orbit`
3. `Nenova Kakao`
4. `Nenova ERP`
5. `연결 대기` — `nenovaweb`처럼 원장 미확인 source metadata만 표시한다.

탭의 project membership은 source repository 이름만으로 결정하지 않는다. `mindmap-viewer/nenova-erp-ui/**`처럼 명시된 path rule은 Nenova ERP에도 연결한다. 따라서 하나의 커밋은 여러 project에 연결될 수 있지만 `전체` 탭에서는 commit id 기준 한 번만 보인다.

### 5.2 레코드 종류와 필터

- record kind: `코드 변경(commit)` / `업무 기록(work-summary)`
- source stage: `기본 브랜치에 병합됨`이 기본값
- `미검증 브랜치`는 초기 버전에서 비활성 옵션으로 노출하고 “manifest 없음”을 설명한다. all-refs 숫자를 전체 합계에 섞지 않는다.
- work type: 최초 도입 / 검색·조사 / 기획·설계 / 기능 추가 / 수정·보정 / 테스트·가드 / 운영·구조 개선 / 미분류
- project, source repository, 기간, 메뉴, 기능, 키워드
- merge 포함 여부는 숨은 필터가 아니라 `전체 / 비병합 / merge`로 접근 가능해야 한다.

### 5.3 요약 카드

`전체` 탭은 최소한 다음을 별도 카드로 보여준다.

- 검증된 커밋 레코드: 4,840
- 비병합: 4,158
- merge: 682
- source별 기준 head 및 snapshot 생성 시각
- 메뉴 연결됨 / 프로젝트만 연결됨 / 미분류 커밋 수
- 업무 기록 문서 수와 날짜형 제목 수(커밋 합계와 분리)

“총 작업”, “요청 횟수”, “수정 N회” 같은 표현은 쓰지 않는다. 기능 카드의 `추가 후 변경 커밋`은 그 기능에 연결된 고유 commit 수임을 명시한다.

### 5.4 타임라인

- 기본 정렬은 `committedAt` 내림차순, 동률은 topology order와 hash로 안정 정렬한다.
- author date와 committer date를 둘 다 보존하되 화면의 기준 날짜는 committer date다.
- `최초 도입`은 subject나 가장 이른 날짜가 아니라 `git rev-list --max-parents=0 <verified-ref>`로 확인된 root에만 붙인다.
- 카드 기본 상태에는 날짜, sanitized subject/title, source, project, work type, merge 여부, 변경 파일 수, 연결된 메뉴 수를 표시한다.
- 펼침에는 allowlisted path, 분류 근거, 메뉴 연결 근거, source head를 표시한다. commit body와 diff는 표시하지 않는다.

1920×1080 CSS px, 브라우저 100%를 우선 검증한다. 페이지 자체의 자연스러운 세로 스크롤을 쓰고 타임라인에 작은 중첩 세로 스크롤을 만들지 않는다. 탭·필터·리스트·펼침은 Tab/Shift+Tab, 방향키, Enter/Space, Escape와 명확한 focus 표시를 제공한다.

## 6. 데이터 모델 계약 제안

새 snapshot은 기존 v1을 묵시적으로 바꾸지 말고 `schemaVersion: 2`의 별도 계약으로 만든다.

```json
{
  "schemaVersion": 2,
  "generatedAt": "2026-10-08T...Z",
  "coverage": {
    "stage": "verified-main",
    "definition": "default branch reachable commits",
    "excluded": ["unmerged-refs", "working-tree", "private-conversation-body"]
  },
  "sources": [],
  "projects": [],
  "menus": [],
  "records": [],
  "stats": {}
}
```

### 6.1 `sources[]`

```json
{
  "id": "nenova-erp-ui",
  "displayName": "Nenova ERP",
  "defaultRef": "origin/master",
  "resolvedHead": "43466ea0...",
  "rootHashes": ["b4c5da12..."],
  "generatedAt": "...",
  "sourceStatus": "live-git",
  "stale": false,
  "counts": { "reachable": 2901, "nonMerge": 2225, "merge": 676 }
}
```

- 외부 clone의 절대 경로와 remote URL은 snapshot에 넣지 않는다.
- `sourceStatus`는 `live-git`, `tracked-manifest`, `unavailable` 중 하나다.
- tracked manifest는 `resolvedHead`, `generatedAt`, 검증 ref와 count를 포함하고 현재 ref를 확인할 수 없으면 `stale: true`로 노출한다.

### 6.2 `projects[]`

```json
{
  "id": "nenova-erp",
  "displayName": "Nenova ERP",
  "membershipRulesVersion": 1,
  "sourceIds": ["nenova-erp-ui", "mindmap-viewer"]
}
```

source repository와 사용자에게 보이는 project는 독립 entity다. membership rule은 별도 reviewable config에 두며 rule id와 version을 edge에 남긴다.

### 6.3 `records[]` — commit

```json
{
  "id": "nenova-erp-ui:43466ea0...",
  "kind": "commit",
  "sourceId": "nenova-erp-ui",
  "hash": "43466ea0...",
  "parents": 2,
  "isMerge": true,
  "authorAt": "...",
  "committedAt": "...",
  "subject": "sanitized subject",
  "changedFileCount": 4,
  "visiblePaths": ["pages/example.js"],
  "redactedPathCount": 1,
  "primaryType": "fix",
  "typeEvidence": ["subject-prefix:fix"],
  "classificationConfidence": "exact",
  "projectEdges": [],
  "menuEdges": [],
  "patchId": null
}
```

- canonical id는 `${sourceId}:${fullHash}`다.
- 현재 검증 범위의 4,840 source commit은 full hash가 모두 달라 `전체` membership도 4,840이다.
- 향후 같은 Git object가 여러 source manifest에 있으면 `objectHash` cluster로 전체에 한 번 표시하되 project/source membership은 모두 유지한다.
- cherry-pick처럼 patch-id만 같은 변경은 별도 integration event이므로 합계에서 제거하지 않고 `equivalentPatchGroup`으로만 표시한다.
- merge commit에는 stable patch-id가 없을 수 있으며 강제로 만들지 않는다.

### 6.4 `records[]` — work-summary

```json
{
  "id": "mindmap-viewer:WORK_MEMORY:2026-06-12:...",
  "kind": "work-summary",
  "sourceId": "mindmap-viewer",
  "date": "2026-06-12",
  "title": "sanitized dated heading",
  "documentType": "work-memory",
  "sourcePathClass": "WORK_MEMORY.md",
  "projectEdges": []
}
```

초기 allowlist는 다음으로 제한한다.

- `mindmap-viewer`: `WORK_MEMORY.md`, `WORK-SUMMARY-*.txt`, `PROGRESS.md`의 날짜형 heading/title
- `nenova-erp-ui`: `docs/work-sessions/*.md`의 파일 날짜와 문서 title

허용하는 것은 날짜와 heading/title뿐이다. heading 아래 paragraph, 질문·답변, 인용문, code block, 사람 이름, 고객·거래처·품목 데이터는 수집하지 않는다. 각 문서 유형의 문서 수와 안전하게 추출된 제목 수는 표시할 수 있지만 이를 요청 수나 작업 수로 해석하지 않는다. 날짜 없는 heading은 timeline record로 만들지 않고 문서 유형 집계에만 남긴다.

### 6.5 `menuEdges[]`

```json
{
  "menuId": "route:/estimate",
  "featureId": "estimate-workflow",
  "ruleId": "erp-estimate-v2",
  "evidence": ["path-prefix:pages/api/estimate/"],
  "confidence": "exact"
}
```

- 한 commit에는 동일 menu/feature edge를 한 번만 둔다.
- route page, API, component, lib, test, contract, docs 근거를 versioned catalog로 연결한다.
- rename/copy는 old/new path를 모두 평가한다.
- 과거 route alias와 삭제된 기능은 `historicalMenus[]`에 보존하고 “현재 메뉴 아님”으로 표시한다.
- 현재 menu catalog에 없는 commit도 project edge가 있으면 `프로젝트 공통`, 그것도 없으면 `미분류`로 남긴다.
- manual override는 commit hash 또는 path rule 단위로만 허용하고 사유와 catalog version을 저장한다.

## 7. 작업 성격 분류 계약

분류는 단일 `primaryType`과 복수 `tags`로 구성한다. 우선순위는 root → 명시적 subject prefix → allowlisted path evidence → `other`다.

| primaryType | 인정 근거 예 | 화면 문구 |
|---|---|---|
| `initial` | verified ref의 root commit | 최초 도입 |
| `research` | `research:`, `investigate:`, `audit:`, `probe:` 또는 근거 문서 전용 변경 | 검색·조사 |
| `plan` | `plan:`, `prd:`, 명시적 plan/PRD 문서 전용 변경 | 기획·설계 |
| `fix` | `fix:`, `hotfix:`, `revert:` | 수정·보정 |
| `feature` | `feat:`, `add:`, `implement:` | 기능 추가 |
| `test-guard` | `test:`, guard/contract/test 전용 변경 | 테스트·가드 |
| `ops-refactor` | `refactor:`, `build:`, `ci:`, `chore:`, 배포/구조 전용 변경 | 운영·구조 개선 |
| `other` | 위 근거가 없거나 복합·모호 | 미분류 |

한글 제목의 “수정”, “추가”, “검색” 같은 일반 단어만으로 exact 분류하지 않는다. 제한된 사전 규칙을 쓸 경우 `heuristic` confidence와 매칭 근거를 노출한다. merge는 PR title을 commit body에서 꺼내지 않고 merge subject 자체와 parent metadata로만 분류한다.

“기능 보정 규모”는 다음 지표를 함께 보여준다.

- 최초 추가 anchor가 실제 `A`로 확인된 commit
- 해당 feature edge의 최초 추가 이후 고유 비병합 commit 수
- 그중 `fix` 분류 수
- merge 수(별도)
- 변경 파일 수와, 안전하게 계산 가능한 경우 additions/deletions(numstat; binary는 unknown)

anchor 추가를 확인하지 못하면 최초일과 “추가 후” 수치는 `확인 불가`다. 가장 오래된 관측 commit을 최초 추가로 간주하지 않는다.

## 8. 중복, 누락, 미분류 규칙

1. `전체` 커밋 합계는 project/menu edge 합계가 아니라 canonical commit record 수다.
2. project 탭의 합은 다중 membership 때문에 전체보다 클 수 있다. UI에 이 사실을 설명한다.
3. 같은 commit이 메뉴 여러 개를 변경하면 각 메뉴에는 한 번씩 연결하되 전체에는 한 번만 표시한다.
4. 동일 hash의 mirrored commit은 전체에서 한 번, source membership은 여러 개로 표시한다.
5. stable patch-id가 같은 cherry-pick은 별도 commit으로 유지하고 유사 변경 badge만 붙인다.
6. path rule에 안 맞는 commit도 버리지 않는다. source/project 수준의 `미분류`로 검색 가능해야 한다.
7. unmerged all-refs는 검증 manifest가 생길 때까지 정식 전체에서 제외한다. 현재 확인된 all-refs 수(예: MindMap 1,849, Kakao 262)는 진단 근거일 뿐 사용자 합계에 섞지 않는다.

## 9. 민감 정보 안전선

### 저장 가능한 필드

- full commit hash, parent count, author/committer timestamp
- 제어문자 제거·길이 제한·secret pattern masking을 거친 subject
- 변경 파일 전체 개수
- allowlisted repository-relative code/document category path
- 안전하게 추출한 날짜형 문서 heading/title 및 source path class
- 분류 및 연결 rule id/evidence

### 저장 금지 필드

- commit body, diff text, patch content
- author/committer 이름·이메일
- private session 질문·답변·대화 원문
- `WORK_MEMORY.md`, work-session, handoff 문서의 본문
- `.env*`, secret/key/certificate, credential, raw upload/data, screenshot 이름과 경로
- 로컬 절대 경로, remote URL, branch 안의 secret 값
- ERP 고객·거래처·품목·주문 데이터

path allowlist 밖의 파일은 이름을 snapshot에 넣지 않고 `redactedPathCount`와 category count만 저장한다. 예를 들어 `docs/work-sessions/**`는 개별 변경 path 대신 `work-session 문서 N개`로 표시한다. redaction은 UI 단계가 아니라 manifest 생성 단계에서 끝나야 한다.

API는 기존과 같이 인증된 사용자에게 GET만 허용하고 `Cache-Control: private, no-store`를 유지한다. 검색 query와 오류에도 원본 로컬 경로가 노출되지 않아야 한다.

## 10. 생성·갱신 구조

### current ERP

- CI/build가 검증된 master merge commit에서 실행됐는지 확인하고 그 commit을 source head로 기록한다.
- 임의의 오래된 로컬 `master` 이름을 신뢰하지 않고, build input ref와 resolved SHA를 명시한다.
- `git rev-list --parents <ref>`로 전체 reachable graph를 수집한다. `--first-parent`는 사용하지 않는다.

### 외부 source

- `mindmap-viewer`, `nenovakakao`는 별도의 read-only exporter가 안전 필드만 담은 tracked source manifest를 생성한다.
- application build는 개발자 PC의 외부 절대 경로를 직접 참조하지 않는다.
- external manifest에는 ref, resolved head, root, count, exportedAt, exporter schema와 redaction 결과를 넣는다.
- 외부 clone을 확인할 수 없는 build에서는 마지막 tracked manifest를 쓰되 `tracked-manifest`, 생성 시각, stale 상태를 화면에 표시한다. 조용히 최신이라고 간주하지 않는다.

### 제안 파일 경계

- `config/full-development-history.sources.json`: source/project/rule id, 민감 정보 없는 설정
- `config/full-development-history.catalog.json`: historical menu/feature/path rules
- `scripts/export-development-history-source.cjs`: 한 source를 안전 manifest로 export
- `lib/fullDevelopmentHistory.cjs`: parse, graph membership, classification, redaction, query 순수 함수
- `data/generated/full-development-history.json`: 웹이 읽는 통합 안전 snapshot
- `pages/api/dev/full-history.js`: 인증된 GET query
- `components/dev/FullDevelopmentHistory.js`: 새 UI

기존 v1 메뉴 snapshot/API는 v2 전환 검증이 끝날 때까지 유지한다.

## 11. API query 계약

`GET /api/dev/full-history`

지원 query:

- `project=all|mindmap-orbit|nenova-kakao|nenova-erp`
- `kind=all|commit|work-summary`
- `stage=verified-main` (초기 유일한 활성 값)
- `workType=...`
- `merge=all|non-merge|merge`
- `menu`, `feature`, `source`, `from`, `to`, `q`
- `sort=recent|oldest|topology`, `page`, `limit`

response는 현재 page 목록 외에 필터 전 전체 baseline, 필터 후 count, non-merge/merge subtotal, source coverage, redaction summary를 함께 반환한다. 검색은 subject/title과 safe path만 대상으로 하고 body/diff를 별도 색인하지 않는다.

## 12. 수용 기준

### 데이터 완전성

- 같은 source heads를 입력하면 verified-main commit record가 정확히 4,840개 생성된다.
- `nonMerge 4,158 + merge 682 = total 4,840` invariant가 통과한다.
- 세 source 간 exact hash 중복이 현재 0건임을 검증하되, 향후 중복 fixture에서는 전체 한 번·membership 복수 규칙이 통과한다.
- 각 verified-main commit은 `전체`에서 정확히 한 번 검색 가능하다.
- menu/project rule에 맞지 않는 commit도 `미분류`로 남아 누락되지 않는다.
- 다중 menu/project edge를 합쳐도 global count가 증가하지 않는다.
- root로 확인되지 않은 commit에 `initial`이 붙지 않는다.

### 안전성

- fixture의 secret, email, local absolute path, commit body, session 본문이 생성 snapshot에 0건이어야 한다.
- `WORK_MEMORY.md`와 work-session fixture는 날짜·sanitized title·document type만 남고 paragraph/question/answer는 남지 않는다.
- API 오류와 coverage note에 local clone 경로가 나타나지 않는다.
- unavailable/stale external manifest 상태가 명확히 보인다.

### UI·접근성

- 1920×1080/100%에서 탭, coverage, 주요 필터, 첫 타임라인 항목이 접근 가능하고 가로 잘림·sticky 가림·중첩 세로 스크롤이 없다.
- 작은 화면에서도 핵심 필터와 카드가 잘리거나 조작 불가능하지 않다.
- Tab/Shift+Tab, Enter/Space, Escape, 방향키 탭·목록 이동, focus 복귀를 검증한다.
- loading/error/empty/stale/unavailable/redacted 상태가 각각 구분된다.
- 메뉴 탭에서 한 commit의 다중 기능 연결을 펼쳐도 commit 카드가 중복 렌더링되지 않는다.

### 회귀

- 기존 커밋, diff, 미커밋 변경, 작업 플랜, 작업이력 탭의 동작을 보존한다.
- 기존 menu history API를 사용하는 동안 v1 response 계약을 깨지 않는다.
- Git history 조회는 build/export 시에만 실행하며 페이지 진입 때 shell command를 실행하지 않는다.
- ERP/MSSQL 및 `nenova.exe`에 대한 읽기·쓰기가 0건이어야 한다.

## 13. 구현 순서 제안

1. schema v2, source exporter, redaction/classification unit fixture를 먼저 만든다.
2. 세 verified-main manifest의 count/root/head invariant를 고정한다.
3. source repository → project membership과 historical menu catalog를 추가한다.
4. 안전한 work-summary heading extractor를 별도 단계로 추가한다.
5. query layer와 API를 만들고 전체/프로젝트/menu count의 중복 규칙을 검증한다.
6. 기존 `/dev/history`에 `전체 개발 이력` UI를 넣되 v1 메뉴 화면으로 되돌릴 수 있게 단계 전환한다.
7. 1920×1080/100% 및 작은 화면에서 실브라우저 smoke를 수행한다.
8. snapshot 생성 시점과 source head를 검토한 뒤에만 커밋/PR/배포 단계로 진행한다.

이 순서는 향후 구현자를 위한 제안이며 이 PRD 작업의 실행 범위는 아니다.

## 14. 검증 근거, 권한, 미확인 사항

### 사용 역할/권한

- 모델: GPT-5 기반 Codex, `ARCHITECT` 역할
- 권한: `APPROVAL_FREE_CHILD`, `P0_LOCAL`
- 수행: 지정된 두 외부 clone 및 대상 ERP worktree의 read-only Git/file inspection, 이 설계 문서 1개 작성
- 미수행: 승인창, network fetch, 운영 DB, secret/권한 변경, push, merge, 배포, 다른 작업공간 수정

### 직접 확인한 근거

- `lib/menuDevelopmentHistory.cjs`
- `scripts/generate-menu-development-history.cjs`
- `components/dev/MenuDevelopmentHistory.js`
- `pages/dev/history.js`
- `pages/api/dev/menu-history.js`
- `config/menu-development-history.json`
- `data/generated/menu-development-history.json`의 안전한 집계 metadata
- `mindmap-viewer`의 Git graph, root/head/count/tree, README의 작업 허브 설명
- `nenovakakao`의 Git graph, root/head/count/tree
- `nenova-erp-ui`의 HEAD/origin-master graph, root/head/count 및 현재 menu history 구현

### 미확인·후속 근거

- `docs/CODEX_SUBTASK_ORCHESTRATION.md`는 대상 worktree와 원 요청 worktree 모두에서 찾지 못해 읽지 못했다. 제공된 AGENTS 운영 지시와 부모 작업의 권한 경계를 적용했다.
- `nenovaweb`의 실제 Git 원장과 project membership은 확인되지 않았다.
- unmerged branches의 publish 여부·업무 가치·민감도는 검증하지 않았으므로 정식 범위에서 제외했다.
- 날짜형 업무 기록의 안전한 제목별 실제 record 수는 본문을 수집하지 않는 extractor가 구현되기 전까지 주장하지 않는다.
- 과거 메뉴 alias 전체, 삭제된 route, 각 커밋의 정확한 feature membership은 catalog 구축과 fixture 검토가 필요하다.
- external source manifest의 갱신 책임자·주기·CI 전달 방식은 구현 전 운영 결정이 필요하다.
