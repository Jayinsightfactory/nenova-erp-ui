# 개발 목적 이야기 설계

## 1. 문제와 목표

기존 `전체 개발 이력`과 `개발 여정`은 안전한 원본 기록을 빠짐없이 찾는 데에는 적합하지만,
사용자가 궁금한 다음 질문에는 답하지 못한다.

- 무엇을 해결하려고 만들었는가
- 실제로 어떤 버튼·설정·작업 흐름이 생겼는가
- 최초 구현 뒤 어떤 문제를 고치고 안전장치를 더했는가

따라서 새 기본 화면은 커밋 제목을 번역하거나 날짜별 건수를 강조하지 않고, 사람이 근거를 읽고
작성한 **목적 이야기**를 중심으로 보여준다. 원본 날짜별 기록은 삭제하지 않고 접힌 근거 또는 별도
`원본 날짜별 기록` 보기로 보존한다.

2026-10-08 snapshot 기준 원천은 코드 변경 4,877건과 작업 요약 302건, 합계 5,179건이며
50건 페이지로 104페이지다. 이 수치는 snapshot이 갱신되면 달라지므로 코드와 테스트는 값을
고정하지 않고 `records.length + summaries.length`를 기준으로 삼는다. 현재 자동 작업 종류 분류의
절반 이상은 `other`이므로 기존 분류나 일반 단어를 목적의 근거로 재사용해서는 안 된다.

## 2. 비목표와 안전선

- 커밋 제목을 자연스러운 문장으로 바꾼 것을 목적 설명이라고 부르지 않는다.
- `feat`, `fix`, `test`, `refactor`, `추가`, `수정` 같은 일반 단어만으로 특정 업무 목적을
  확인했다고 표시하지 않는다.
- 연결된 기록 수를 기능 수, 요청 수, 성과, 작업 시간 또는 배포 횟수로 해석하지 않는다.
- 세션 Q&A 본문, 비공개 대화, 작성자 개인정보, diff, 로컬 절대 경로, 민감한 파일 경로를
  catalog·snapshot·API·화면에 복사하지 않는다.
- 문서 제목과 안전한 요약을 근거로 활용할 수 있지만, 원문 질문·답변이나 고객·품목·주문 데이터는
  웹 응답에 포함하지 않는다.
- 이 기능은 정적 웹 metadata 조회다. Git·shell·MSSQL을 런타임에서 실행하지 않고 ERP 원장을
  읽거나 쓰지 않는다.

## 3. 근거 계층과 책임

의미와 전체 기록 배정을 분리한다.

1. `config/development-purpose-stories.json`은 사람이 검토한 목적·사용자 가치·실제 변화 설명만
   가진다. 이 파일이 의미의 유일한 출처다.
2. `data/generated/full-development-history.json`은 안전하게 정리된 전체 commit/summary 원장이다.
3. `lib/developmentPurposeStories.cjs`는 catalog의 명시적 근거와 규칙으로 모든 record에 정확히
   하나의 primary bucket을 배정한다. 의미를 새로 작성하지 않는다.
4. `/api/dev/development-stories`는 정적 결과만 인증된 사용자에게 반환한다.
5. UI는 catalog 문장과 배정 상태를 표시한다. 검토되지 않은 기록을 이야기 속에 숨기지 않는다.

목적 근거의 우선순위는 계약·PRD·구현 계획·안전한 세션 제목/요약·정확한 commit evidence다.
작업 세션은 로컬에서 읽고 판단할 수 있지만 웹으로 내보내는 것은 저자가 다시 쓴 `summary`뿐이다.
`ref`, match rule, 문서 경로는 서버 검증용이며 API 응답에서 제거한다.

## 4. 작성 catalog 계약

top-level 계약은 다음과 같다.

```json
{
  "schemaVersion": 1,
  "catalogVersion": "2026-10-08.1",
  "stories": []
}
```

각 story는 다음 필드를 가진다.

```json
{
  "id": "weekday-estimate-workspace",
  "title": "사람이 이해하는 한국어 제목",
  "purpose": "왜 이 흐름을 만들었는지",
  "userValue": "사용자가 무엇을 더 안전하고 쉽게 할 수 있게 되었는지",
  "scopeNote": "확인한 범위와 아직 확인하지 못한 범위",
  "confidence": "verified",
  "purposeEvidence": [
    {
      "kind": "document",
      "ref": "docs/plans/example.md",
      "summary": "원문을 복제하지 않은 안전한 근거 요약"
    }
  ],
  "changes": [
    {
      "title": "실제로 만든 흐름",
      "description": "근거에서 확인한 버튼·설정·후속 보완을 쉬운 말로 설명",
      "evidenceHashes": ["40-character-full-hash"],
      "evidenceRefs": ["docs/contracts/example.json"]
    }
  ],
  "rules": {
    "pathPrefixes": ["pages/example/"],
    "subjectTerms": ["domain-specific phrase"],
    "sourceIds": ["erp"],
    "excludeTerms": ["unrelated phrase"],
    "priority": 100
  }
}
```

`confidence` 의미는 다음과 같다.

- `verified`: 목적과 변화가 계약·계획·정확한 구현 근거에서 직접 확인됐다.
- `supported`: 목적은 복수 근거로 지지되지만 일부 세부 동작은 현재 기록만으로 완전히 확인되지 않았다.
- `partial`: 큰 방향만 확인됐고 버튼·설정 또는 후속 흐름 일부는 `확인 필요`로 남는다.

`changes`는 최초 구현, 기능 확장, 사용성 보완, 오류 수정, 안전장치 추가를 한 형식으로 담는다.
자동 분류 코드가 이를 임의로 `기능`이나 `후속 수정`으로 바꾸지 않는다. 실제 버튼명·설정명은
현재 코드, 계약 또는 명시 문서에서 동일한 의미가 확인된 경우에만 쓴다. 근거가 부족하면
`버튼명 확인 필요`, `실제 저장 연결 여부 확인 필요`처럼 모르는 부분을 그대로 적는다.

## 5. 전 기록 배정 계약

canonical record id는 commit은 `commit:<full-hash>`, summary는 `summary:<sourceId>:<id>`다.
모든 record는 정확히 하나의 `primaryStoryId`를 갖거나 가상 bucket `review-pending`에 들어간다.
연관 목적을 보조로 표시해야 할 때 `secondaryStoryIds`를 둘 수 있지만 전체 coverage와 story 건수에는
포함하지 않는다.

배정 순서는 다음과 같다.

1. `changes[].evidenceHashes` 또는 commit형 `purposeEvidence.ref`의 정확한 hash
2. source 범위 안에서 domain path와 domain subject가 함께 일치하는 규칙
3. 충분히 좁고 story 전용임이 검토된 path prefix
4. 충분히 구체적인 domain subject term
5. 위 근거가 없거나 복수 story가 같은 우선순위로 충돌하면 `review-pending`

규칙의 배열 안에서는 하나 이상 일치하면 되고, 비어 있지 않은 규칙 차원끼리는 AND로 평가한다.
예를 들어 path와 subject가 모두 있으면 둘 다 맞아야 한다. `excludeTerms`가 맞으면 후보에서 제외한다.
`sourceIds`는 범위 제한일 뿐 positive evidence가 아니므로 source만 있는 규칙은 catalog 오류다.
저장소 공통 파일, package 파일, 광범위한 `docs/`, `scripts/`, `components/`, `lib/` root도 단독
positive rule로 허용하지 않는다. priority는 유효한 복수 후보의 순서를 정할 뿐, 약한 규칙을 강한
근거로 승격시키지 않는다.

같은 최고 specificity와 priority를 가진 후보가 둘 이상이면 임의 선택하지 않고 `ambiguous`로
검토 대기에 보낸다. 후보가 없으면 `unmatched`, exact evidence가 사라졌으면 catalog 검사를 실패시킨다.

생성 결과의 핵심 형태는 다음과 같다.

```json
{
  "catalogVersion": "2026-10-08.1",
  "coverage": {
    "totalRecords": 5179,
    "assignedRecords": 0,
    "reviewPending": 5179,
    "ambiguous": 0,
    "unmatched": 5179
  },
  "stories": [],
  "assignments": {},
  "reviewQueue": []
}
```

위 숫자는 shape 예시일 뿐 실제 값은 항상 snapshot에서 계산한다. `assigned + reviewPending`은
반드시 `totalRecords`와 같아야 한다. 검토 대기 0건이 아니면 화면과 문서에서 “전체 목적을 이해했다”
또는 “104페이지를 모두 이야기로 정리했다”고 표현하지 않는다.

## 6. 목적 이야기 API

새 API는 `GET /api/dev/development-stories`이며 `withAuth`, `Cache-Control: private, no-store`,
`Allow: GET`을 유지한다.

### `mode=overview`

다음을 반환한다.

- `generatedAt`, `catalogVersion`, 안전한 coverage 설명
- `coverage`: 전체, 이야기 연결, 검토 대기, ambiguous, unmatched
- story별 `id`, `title`, `purpose`, `userValue`, `scopeNote`, `confidence`
- story에 실제 배정된 record에서 계산한 `sourceIds`
- story별 최초/마지막 연결 기록의 KST 날짜와 record 종류별 count
- 안전하게 작성된 `changes[].title`, `changes[].description`
- 각 변화의 근거 개수와 근거 종류. 내부 `ref`, rule, path는 반환하지 않는다.

story의 시작/종료일은 배정된 실제 record timestamp에서만 계산한다. 문서 파일명이나 제목에서 날짜를
추정하지 않는다. 연결 record가 없으면 `날짜 확인 필요`와 `연결 기록 0건`을 명시한다.

### `mode=records`

`storyId`, `page`, `limit`, `order`와 기존 안전 필터를 받는다. `storyId=review-pending`도 지원한다.
`limit`는 최대 50이며, 알 수 없는 story id와 mode는 400으로 거부한다. 응답 record는 날짜, 안전한
원본 제목, 종류, source, 짧은 확인번호, 배정 종류와 검토 상태만 포함한다. 문서 본문, Q&A, diff,
`paths`, catalog의 `evidenceRefs`와 match rule은 반환하지 않는다.
기존 snapshot `id`는 전체 합집합 대조를 위해 유지하고, 배정 감사용 `canonicalId`를 별도로 반환한다.

overview와 records 모두 정적 snapshot과 catalog만 읽는다. 요청값으로 파일을 열거나 Git·shell·DB를
실행하지 않는다. catalog 문장은 React text node로만 렌더하고 `dangerouslySetInnerHTML`을 쓰지 않는다.

## 7. 화면 계약

`/dev/history?view=journey`의 첫 화면은 `목적별 이야기`다. 이미 배포된 날짜 시각화는
`원본 날짜별 기록` 전환 버튼으로 그대로 보존한다. 기존 `전체 개발 이력`, `메뉴별 기능`,
`기존 작업 히스토리`도 변경하지 않고 새 사이드바 메뉴를 만들지 않는다.

화면 순서는 다음과 같다.

1. 제목: `무엇을 만들었고, 어떻게 다듬었는지`
2. coverage: `전체 N건 / 목적 이야기 연결 M건 / 검토 대기 P건`
3. 설명: 연결 기록 수는 기능·요청·성과 수가 아니며 검토 대기는 의미를 추정하지 않은 기록이라는 안내
4. KST 최초 연결일 순의 연·월 chapter
5. chapter 안의 purpose story 카드
6. 마지막 `아직 목적을 확인 중인 기록` chapter

story는 최초 연결 월에 한 번만 배치하며 여러 달의 반복 수정을 별도 story로 복제하지 않는다.
카드에는 전체 활동 기간을 함께 표시하고 다음 순서로 읽힌다.

- `왜 만들었나`: `purpose`
- `사용자가 할 수 있게 된 것`: `userValue`
- `만들고 다듬은 흐름`: catalog의 `changes`를 근거 날짜순으로 표시
- `확인 범위`: confidence와 `scopeNote`
- `근거 기록 N건`: 접힌 목록, 50건 페이지, 오래된 순

change 날짜는 연결된 `evidenceHashes`의 실제 timestamp로만 계산한다. document evidence만 있으면 날짜를
억지로 만들지 않고 `날짜 확인 필요`로 표시한다. raw record는 기본 story 본문에 나열하지 않는다.
story를 펼칠 때만 한 페이지를 요청하며, 화면에 동시에 mount하는 근거 카드는 최대 50건이다.
`review-pending`도 같은 pagination으로 모든 기록에 접근할 수 있어야 한다.

목적 검색, source, confidence와 검토 상태 필터를 제공한다. 필터 결과에도 coverage 분모와 분자를 함께
보여 주어 일부 결과를 전체처럼 보이게 하지 않는다. 안내 캐릭터와 그래픽은 code-native SVG로 유지하고
실제 성과를 상징하거나 순위를 암시하지 않는다.

일반 페이지 shell은 `_app.js`만 소유한다. 1920×1080 CSS px/100%에서 우선 검증하되 고정 높이 내부
세로 스크롤을 만들지 않고 문서 전체 스크롤을 쓴다. 좁은 화면에서도 목적, 변화, 검토 상태와 근거 열기
버튼이 잘리지 않아야 한다. 버튼·필터·accordion·pagination은 Tab/Shift+Tab, Enter/Space,
Escape, 방향키와 명확한 focus 표시를 지원하고 닫을 때 호출 버튼으로 초점을 돌린다.

## 8. 전체 감사와 테스트

테스트는 첫날이나 일부 story만 표본 검사하지 않고 현재 snapshot 전체를 순회한다.

### catalog 검사

- schema/catalog version, story id 유일성, 필수 한국어 설명과 confidence enum
- full hash 형식과 snapshot 내 존재, document ref의 저장소 내부 allowlist 및 파일 존재
- 허용 source id, 음수가 아닌 priority, 비어 있는 source-only rule 차단
- 일반 prefix·일반 subject만 가진 catch-all rule 차단
- ref·hash가 다른 story의 exact evidence와 충돌하면 실패
- secret, 이메일, 절대 경로, URL credential 등 금지 pattern 검사

자동 검사는 참조 존재와 형식을 확인할 수 있을 뿐 설명의 의미적 진실을 보장하지 못한다. 따라서 각
`purpose`, `userValue`, `change`는 사람이 해당 evidence를 열어 확인하는 review checklist를 가진다.
특히 버튼·설정 이름은 근거에서 실제 문구 또는 동일 동작을 확인하지 못하면 `확인 필요`로 남긴다.

### 배정·coverage 검사

- snapshot의 모든 canonical id가 assignment 또는 review queue에 정확히 한 번 존재
- `assigned + reviewPending = records + summaries`
- 모든 story page와 review-pending page를 끝까지 합친 id union이 snapshot id set과 정확히 일치
- primary 중복 0, 빠진 record 0, secondary가 primary count에 섞이지 않음
- 입력 순서를 섞어도 같은 배정·정렬 결과
- exact > combined > narrow path/subject 우선순위와 exclude 동작
- 같은 점수 충돌은 ambiguous, 무관한 기록은 unmatched
- `fix/test/refactor/feat` 및 공통 root만으로 특정 story에 들어가지 않는 adversarial fixture
- KST 월·연도 경계와 story 최초/마지막 날짜 정렬
- 50건 미만, 50건 초과, 100건 초과 story 및 review queue의 pagination union
- summary는 제목·날짜만 유지하고 원문 body가 직렬화되지 않음

### API·UI·회귀 검사

- 인증 GET 전용, private/no-store, mode/story/page/limit allowlist, 잘못된 id 거부
- 응답에 `evidenceRefs`, rules, 문서 path, private body, 작성자, diff, secret가 없음
- child process, Git, DB import와 SQL 문자열 없음
- overview story counts와 records API 전체 page union 일치
- 목적 이야기 기본 표시와 `원본 날짜별 기록` 전환, 기존 journey/full/menu/legacy 회귀
- 로딩·오류·빈 결과·재시도·stale request 취소, 펼침/닫힘 초점 복귀
- 1920×1080/100%와 좁은 viewport에서 겹침·가로 잘림·sticky 가림·중첩 세로 스크롤 없음
- `npm run test:ui-layout`, 목적 이야기 테스트, 기존 개발 이력 테스트, ERP manifest/write guard와 build

## 9. 완료 판정

다음이 모두 충족돼야 완료다.

- 사용자는 commit 번역이 아니라 근거가 작성된 목적·사용자 가치·실제 변화·후속 보완 흐름을 읽는다.
- 실제 버튼과 설정을 확인할 수 있고, 확인하지 못한 세부는 명시적으로 모른다고 표시된다.
- 여러 날짜의 반복 수정은 같은 목적 story 안에서 시간순으로 이어진다.
- 전체 104페이지 상당 record가 story 또는 검토 대기 중 정확히 한 곳에서 접근 가능하다.
- 검토 대기 수와 이유가 항상 보이며, 자동 연결률을 의미 이해율이나 성과로 과장하지 않는다.
- 기존 raw evidence 화면과 ERP 원장 무변경 계약이 보존된다.
