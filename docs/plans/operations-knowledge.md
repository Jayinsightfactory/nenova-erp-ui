# 주의·이슈 및 업무처리 지침 설계

## 1. 목적과 범위

새 일반 페이지 `/operations-knowledge`에서 반복 업무의 상황, 사례, 계절 이슈,
인수인계와 체크리스트 지침을 팀이 함께 조회·관리한다. 메뉴 이름은
`주의·이슈 및 업무처리 지침`으로 고정하고 `components/Layout.js`의 `업무 매뉴얼`
그룹에 한 번만 등록한다.

이 기능은 **Nenovaweb 전용 파일 저장 기능**이다. MSSQL, `nenova.exe`, 주문,
출고, 입고, 재고, 견적, 매출 원장을 읽거나 쓰지 않는다. 새 dnSpy writer 증거는
필요하지 않으며 기존 ERP 보존 계약만 검사한다. `data/runtime/`의 기존 배포 보존
방식과 ignore 정책을 그대로 사용한다.

과도한 범위를 피하기 위해 승인 흐름, 담당자 할당, 알림, 영구 삭제, 문서 버전
복원, 외부 공유 링크는 만들지 않는다.

## 2. 기존 인수인계 보존

- `checklist.handoffs`는 원본 저장소로 계속 유지한다. 복사, 형식 변경, 자동
  마이그레이션을 하지 않는다.
- 새 화면의 `인수인계` 분류에서 원본 내용을 별도 읽기 전용 영역으로 보여준다.
  기존 `HandoffTool`에서는 지금처럼 원본을 수정할 수 있다.
- 운영 원본이 revision 0의 빈 목록이면 새 화면도 빈 원본 구역을 보여줄 뿐, 예시
  자료나 마이그레이션 성공 문구를 만들지 않는다.
- 원본의 `OPEN`, `IN_PROGRESS`, `DONE`을 새 상태로 추정하지 않는다. 새 API는
  원본 항목에 `readOnly: true`, `status: null`, `statusLabel: "기존 자료 · 상태 미분류"`
  를 붙이고 원래 값은 `legacyStatus`로 따로 반환한다. 따라서 원본 항목이
  `CURRENT` 필터나 현행 건수에 포함되지 않는다.
- 새 기능의 저장 키는 `knowledge.guidance`다. `/api/import/tools/state`는 이 키의
  GET과 PUT을 명시적으로 거부하고, 모든 신규 쓰기는 전용 API의 명령 검증을
  거친다.

## 3. 저장 구조와 데이터 계약

`knowledge.guidance` 값은 다음 구조다.

```text
{
  schemaVersion: 1,
  items: KnowledgeItem[],
  audit: AuditEvent[]             // 최신 500건, 서버만 추가
}
```

### KnowledgeItem

| 필드 | 계약 |
|---|---|
| `id` | 서버가 만든 UUID |
| `title` | 필수, 1~160자 |
| `category` | `SITUATION`, `CASE`, `SEASON`, `HANDOFF`, `CHECKLIST` |
| `status` | `CHECK`(확인 필요), `CURRENT`(현행), `RETIRED`(폐기·과거) |
| `priority` | `NORMAL`, `IMPORTANT` |
| `tags` | `countries`, `flowers`, `farms`, `stages` 각각 임의 텍스트 배열. 배열당 20개, 값당 80자, trim 후 중복 제거 |
| `situation` | 필수, 1~4,000자 |
| `action`, `caution`, `checklist` | 각각 0~4,000자 |
| `contact` | 0~300자 |
| `reviewDate` | 실제 `YYYY-MM-DD` 또는 `null` |
| `comments` | 추가 전용 댓글, 항목당 최대 100개 |
| `attachments` | 비공개 첨부 메타데이터, 항목당 최대 20개 |
| `createdAt`, `createdBy`, `updatedAt`, `updatedBy` | 인증 계정과 서버 시각으로만 생성 |

댓글은 `{id, body, createdAt, author}`이며 본문은 1~2,000자다. 댓글 수정·삭제는
이번 범위에 포함하지 않는다. 첨부 메타데이터는
`{id, originalName, mediaType, size, kind, createdAt, author}`이고 실제 서버 경로나
저장 파일명은 응답하지 않는다.

`AuditEvent`는
`{revision, action, itemId, changedFields, commentId?, attachmentId?, at, actor}` 형태다.
`changedFields`는 허용된 필드 경로 이름만 담고 본문 원문은 복제하지 않는다. `action`은
`CREATE_ITEM`, `UPDATE_ITEM`, `ADD_COMMENT`, `ADD_ATTACHMENT` 중 하나다. 항목을
없애는 동작은 없고 폐기는 `UPDATE_ITEM`으로 상태를 `RETIRED`로 바꾼다. audit,
ID, 작성자와 시각은 요청 본문 값을 사용하지 않는다.

최대 항목 수는 300개다. 일반 저장은 기존 store의 5 MiB value/8 MiB record 제한과
revision/file-lock/history 원자성을 그대로 사용한다.

## 4. 모듈과 API

### 백엔드 담당

- `lib/operationsKnowledgeSchema.js`: enum, 크기 제한, 엄격한 plain-object 검증,
  클라이언트가 보낼 수 있는 수정 필드 정규화
- `lib/operationsKnowledgeStore.js`: 기본값, 전용 명령 적용, 서버 작성자/audit,
  기존 handoff 읽기 전용 projection, 첨부 파일 경로와 메타데이터 조회
- `lib/operationsKnowledgeApi.js`: same-origin, HTTP 오류/응답과 API handler 경계
- `lib/operationsKnowledgeAttachments.js`: 확장자/MIME/signature, Office ZIP과
  압축 해제 크기 제한 검증
- `lib/importTeamStore.js`: `knowledge.guidance` 키 허용 및 위 schema validator 호출
- `pages/api/import/tools/state.js`: `knowledge.guidance` 직접 접근 명시 거부
- `pages/api/operations-knowledge/index.js`: 목록과 JSON 명령 API
- `pages/api/operations-knowledge/attachments.js`: 인증 첨부 업로드·다운로드
- `scripts/ensure-pnl-upload-nginx.mjs`: 기존 관리 구간에 첨부 endpoint의 12 MiB
  proxy allowance 추가(앱 파일 제한은 계속 10 MiB)
- `__tests__/operationsKnowledge*.test.js`: schema/store/API/첨부 보안 회귀

### UI 담당

- `pages/operations-knowledge.js`: 내용만 반환하는 일반 페이지. `Layout`을 직접
  import하지 않는다.
- `styles/OperationsKnowledge.module.css`: 1920 × 1080, 확대 100% 우선 레이아웃
- `components/Layout.js`: `업무 매뉴얼` 그룹 메뉴 1건
- `__tests__/operationsKnowledgeUi.test.js`: 메뉴, 필터, 읽기 전용 원본, 삭제 부재,
  단일 shell 계약

### `GET /api/operations-knowledge`

활성 인증 계정만 호출한다. 응답은 다음과 같다.

```text
{
  success: true,
  revision,
  items,
  audit,
  legacyHandoffs: {
    sourceKey: "checklist.handoffs",
    sourceRevision,
    items: [{ ...원본 필드, category: "HANDOFF", readOnly: true,
              status: null, statusLabel, legacyStatus, legacyActor }]
  }
}
```

### `POST /api/operations-knowledge`

JSON 최대 1 MiB이며 `expectedRevision`은 모든 명령에 필수다.

- `CREATE_ITEM`: `{action, expectedRevision, item: MutableItem}`
- `UPDATE_ITEM`: `{action, expectedRevision, itemId, item: MutableItem}`
- `ADD_COMMENT`: `{action, expectedRevision, itemId, body}`

수정 성공은 최신 `revision`, `items`, `audit`을 반환한다. 현재 revision과 다르면
덮어쓰지 않고 `409`를 반환한다. 없는 항목은 `404`, 형식 오류는 `400`, 크기 초과는
`413`이다. POST 외의 쓰기 메서드와 `DELETE`는 `405`다.

### `POST /api/operations-knowledge/attachments`

multipart 필드 `expectedRevision`, `itemId`, `file` 한 개를 받는다. 파일은 최대
10 MiB, 항목당 20개다. 허용 형식은 JPEG, PNG, WebP, PDF, DOCX, XLSX, CSV와
plain text다. MIME과 확장자 조합뿐 아니라 이미지/PDF의 magic bytes도 확인한다.
DOCX/XLSX는 JSZip으로 실제 Office ZIP 구조와 예상 문서 entry를 확인하고
`vbaProject.bin`이 있는 매크로 문서는 거부한다. CSV/plain text는 NUL byte가 없는
UTF-8 텍스트만 받는다. SVG, HTML과 실행 파일도 거부한다.

파일은 public 아래에 두지 않고
`data/runtime/operations-knowledge/attachments/<UUID>`에 확장자 없는 서버 ID로
저장한다. 원본 이름은 표시·다운로드 헤더용 메타데이터일 뿐 경로로 사용하지
않는다. 임시 파일을 같은 디렉터리에 만들고 성공 시 rename한다. 메타데이터 CAS가
실패하면 이번 요청이 만든 파일을 정리한다. 업로드 성공은
`ADD_ATTACHMENT` audit과 최신 revision을 함께 반환한다.

### `GET /api/operations-knowledge/attachments?id=<attachmentId>`

활성 인증 계정과 현재 record의 첨부 ID로만 파일을 찾는다. 경로, 파일명, 임의
상대경로를 요청으로 받지 않는다. 이미지는 `inline`, 나머지는 `attachment`로
전송하며 `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`와
안전한 RFC 5987 `Content-Disposition`을 설정한다. 없는 ID나 record에 연결되지
않은 파일은 `404`다.

## 5. 인증·동시성·출처 경계

- 모든 endpoint는 `withAuth` 뒤에서 실행하고 `req.user.accountActive === false`를
  `403`으로 거부한다. 권한 등급 구분 없이 기존 활성 계정은 같은 읽기·쓰기 범위를
  갖는다.
- POST와 첨부 업로드는 `Sec-Fetch-Site: cross-site`를 거부하고, `Origin`이 없거나
  정규화한 `x-forwarded-proto` + `x-forwarded-host`(없으면 실제 protocol + `Host`)
  와 정확히 일치하지 않으면 `403 ORIGIN_MISMATCH`다. 배열·쉼표 헤더는 첫 값만
  정규화한다.
- 작성자 ID/이름, UUID, 시각, audit, 첨부 저장 경로는 모두 서버가 만든다. 동일
  이름의 요청 필드는 무시하지 말고 형식 오류로 거부해 계약 위반을 드러낸다.
- `expectedRevision`이 없는 저장과 오래된 저장은 실패한다. lock 충돌과 stale
  revision은 모두 사용자가 재조회할 수 있는 `409`이고 기존 값을 보존한다.
- API 응답은 `private, no-store`이며 내부 오류나 서버 경로를 노출하지 않는다.

## 6. 화면 계약

- 첫 화면에 검색, 분류 탭 5개, 상태·중요도·국가·꽃·농장·단계 필터, 새 지침
  버튼, 저장 오류와 revision 충돌 안내가 보인다.
- 필터 선택지는 저장된 임의 태그에서 파생한다. 검색 대상은 제목과 네 본문,
  연락처, 태그다. 기본 목록에는 `CHECK`와 `CURRENT`를 보여주고 `RETIRED`는 사용자가
  상태 필터로 선택할 수 있다.
- `SEASON`은 사용자가 고르는 지침 분류일 뿐이다. 날짜나 차수에서 현재 계절을
  자동 추론하거나 항목을 자동 활성화하지 않는다.
- 항목 상세/편집에는 상황, 처리 방법, 주의사항, 체크리스트, 연락처, 검토일,
  댓글 이력과 첨부 목록을 모두 보여준다. 폐기는 영구 삭제가 아니라 상태 변경임을
  버튼 문구로 명확히 한다.
- 기존 handoff는 `HANDOFF` 탭의 별도 `기존 인수인계 · 읽기 전용` 구역에 표시한다.
  새 상태 badge를 붙이지 않는다.
- 초안이 열린 동안 서버 revision이 바뀌면 저장 버튼을 막고 초안을 유지한 채 최신
  자료 재조회/비교를 안내한다.
- 1920 × 1080에서 주요 필터와 작업 버튼, 상태, 오류가 첫 화면에 접근 가능해야
  한다. 작은 화면에서는 필터와 상세가 세로로 접히고 목록/첨부는 필요한 영역만
  스크롤한다. 가로 잘림, sticky 가림, 모달 이탈, 버튼 상태, 실패 알림을 확인한다.
- 표준 button/input/select/textarea를 사용하고 Tab/Shift+Tab, Enter/Space, Escape,
  목록 방향키 이동과 명확한 focus 표시를 검증한다.

## 7. 수용 기준

1. 활성 계정은 같은 자료를 조회·저장할 수 있고 비활성/미인증 계정은 거부된다.
2. 생성·수정·댓글·첨부의 작성자는 요청 본문이 아닌 JWT 계정이며 구체 action,
   시각, 항목 ID가 audit에 남는다.
3. 두 클라이언트가 같은 revision을 저장하면 첫 요청만 성공하고 다음 요청은
   `409`; 기존 자료를 덮어쓰지 않는다.
4. 기존 `checklist.handoffs` byte-level 값과 revision은 새 화면 조회/저장 후에도
   바뀌지 않으며, 읽기 전용 원본은 새 `CURRENT`로 집계되지 않는다.
5. 영구 삭제 UI/API가 없고 `RETIRED` 자료와 첨부·댓글·audit은 계속 조회된다.
6. 첨부는 public URL이나 임의 경로로 접근할 수 없고 인증, ID 연결, 크기,
   MIME/확장자/signature·Office ZIP 구조, 다운로드 헤더 검사를 통과해야 한다.
7. 일반 URL은 메뉴/상단바 각 1개, `?popup=1`은 간소화 상단바 1개/왼쪽 메뉴
   0개이며 1920 × 1080 실제 브라우저 smoke에 가로 잘림·겹침이 없다.
8. 신규 코드에는 MSSQL import/query/transaction이 없고 ERP 관련 원장은 전부
   preserve다.

필수 검증은 `npm run test:operations-knowledge`, `npm run test:ui-layout`,
`npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`,
`npm run test:erp-manifest -- --changed-from origin/master`,
`npm run guard:erp-writes -- --changed-from origin/master`, `npm run build` 및
1920 × 1080 실브라우저 smoke다.
