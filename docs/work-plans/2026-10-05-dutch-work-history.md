# 네덜란드 물량 작업 저장·ERP 업로드 검토 설계

## 목표와 경계

- 사용자가 원본 물량표, 수량, 단가, 수동 ERP 매칭을 편집한 뒤 서버에 불변 작업본으로 저장하고 다시 불러온다.
- 상단의 `작업 완료·ERP 업로드 검토`는 현재 초안으로 기존 `dutch-volume-preview`를 새로 실행하고 검토 영역으로 이동한다. 실제 ERP 쓰기는 기존 검토 하단의 `확인한 전체 범위 ERP 적용`에서만 일어난다.
- `단가표 엑셀 저장`은 서버 작업 저장 및 ERP 적용과 독립된 내보내기로 유지한다.
- 저장 작업본은 브라우저 초안보다 오래 유지되지만, 단일 서버의 `data/runtime` 디스크에 의존한다. 호스트 디스크 유실까지 보장하는 백업 시스템은 이번 범위가 아니다.

## 사용자 흐름

1. LIVE 조회 또는 엑셀 업로드 후 수량·단가·매칭을 편집한다.
2. `작업 저장`에서 이름을 입력하고 현재 상태를 새 작업본으로 저장한다. 기존 저장본을 덮어쓰지 않는다.
3. `저장된 작업`은 로그인 사용자 본인의 전체 저장본을 최신순으로 표시한다. 항목에는 이름, 원본 파일명, 연도·차수, 저장자·저장시각, 행·시트 수를 표시한다.
4. 불러오기는 현재 편집 내용이 교체된다는 확인 후 실행한다. 저장된 연도·차수와 원본 workbook, entries, prices를 그대로 복원하며 현재 화면의 연도나 localStorage 초안으로 저장 범위를 바꾸지 않는다.
5. 복원 직후 이전 `preview`, `planToken`, 확인 체크, 적용 결과, 자동 매칭 cache를 폐기한다. 사용자는 `작업 완료·ERP 업로드 검토`로 현재 DB에 대해 새 검증을 받아야 한다.
6. 검토 표와 기존 확인 절차를 거쳐 기존 ERP 적용 버튼을 명시적으로 누른다. 클라이언트는 정확히 그 편집 상태를 적용 직전 작업본으로 먼저 저장하고, 저장 실패 시 ERP POST를 보내지 않는다. 저장 중에는 편집·중복 클릭을 잠근다.
7. 적용 결과·감사 이력은 기존 적용 작업 로그가 계속 소유한다. 적용 직전 작업본에는 planToken이나 결과 로그를 복사하지 않는다.

## 저장 스냅샷

저장 허용 필드는 다음뿐이다.

```text
id(server UUID), name,
sourceMode(LIVE|UPLOAD), fileName, orderYear, orderWeek,
sourceIdentity, workbook, entries, prices,
savedAt(server time), savedBy(server authenticated display name)
```

- `workbook`은 `xlsx-js-style`가 사용하는 JSON 안전 plain object를 그대로 보존한다. 실제 4002 원본은 약 248,386 bytes로 확인되었으므로 zip/base64 변환을 추가하지 않는다. 수식·스타일·병합·열 너비가 복원 및 별도 엑셀 내보내기에 남아야 한다.
- 수동 `custKey`/`prodKey`, 추가행, 명시 수량 0, 단가 0과 빈 단가를 구분해 보존한다. 자동 `matchCache`는 저장하지 않고 새 preview에서 재계산한다.
- `preview`, `planToken`, 확인 체크, `jobId`, ERP 적용 결과·로그는 저장 금지다. 서버 저장본이 과거 DB 검증을 현재 검증으로 가장해서는 안 된다.
- POST 본문과 저장 JSON은 UTF-8 900 KiB 이하, entries 5,000개 이하, workbook sheet 32개 이하로 제한한다. 초과 시 저장 성공처럼 표시하지 않고 `엑셀 저장 후 작업을 나누세요`를 안내한다.

## 서버 저장소와 API

새 모듈 `lib/dutchVolumeWorkStore.js`:

```js
resolveDutchWorkOwner(user)
saveDutchWorkSnapshot({ ownerId, savedBy, name, sourceMode, fileName,
  orderYear, orderWeek, sourceIdentity, workbook, entries, prices })
listDutchWorkSnapshots({ ownerId, cursor, limit })
getDutchWorkSnapshot({ ownerId, id })
```

- 루트는 `data/runtime/dutch-volume-work/<sha256(userId)>/`다. 경로에는 원문 userId를 쓰지 않는다.
- `req.user.userId`가 비어 있으면 저장·목록·조회 모두 거부한다. `savedBy`, `savedAt`, `id`는 서버가 만들며 클라이언트 값을 무시한다.
- 파일명은 서버가 생성한 UUID만으로 `<uuid>.json`을 만들고, 조회 id는 UUID 정규식으로 검증한 뒤 소유자 디렉터리 안에서만 찾는다. `catalogDraftStore`의 검증 없는 경로 결합을 복사하지 않는다.
- 동일 디렉터리 임시 파일을 create-only로 쓰고 flush한 뒤 원자적으로 게시한다. 최종 파일은 갱신·삭제하지 않으며 손상 파일과 임시 파일은 목록에서 제외한다.
- 목록은 payload를 싣지 않는 요약만 최신순으로 기본 20개(명시 limit 1~100) 반환하고 cursor로 다음 페이지를 읽는다. 관리자 공유나 타 사용자 조회 예외는 두지 않는다. 손상 파일은 제외하고 `corruptCount`로 개수를 알린다.
- 요약은 `id/name/fileName/sourceMode/orderYear/orderWeek/savedAt/savedBy/entryCount/sheetCount`이며 상세 스냅샷은 위 저장 허용 필드다. 내부 파일 envelope는 `{version:1,id,ownerId,savedAt,savedBy,data}`이고 클라이언트에 ownerId를 반환하지 않는다.

인증 API `pages/api/shipment/dutch-volume-work.js`:

```text
POST /api/shipment/dutch-volume-work
  body: { name, sourceMode, fileName, orderYear, orderWeek,
          sourceIdentity, workbook, entries, prices }
  -> 200 { success:true, snapshot:<summary> }

GET /api/shipment/dutch-volume-work?limit=20&cursor=...
  -> 200 { success:true, items:[summary], nextCursor, corruptCount }

GET /api/shipment/dutch-volume-work?id=<uuid>
  -> 200 { success:true, snapshot:<full snapshot> }
```

PUT/PATCH/DELETE는 405다. API와 클라이언트 양쪽에서 900 KiB를 검사하고 저장 중 버튼을 비활성화한다. 응답을 받지 못한 저장은 완료로 표시하지 않는다.

## UI 상태 복원 계약

- `acceptSavedSnapshot(work)` 같은 전용 경로를 사용한다. 기존 `acceptSource`는 localStorage를 읽으므로 그대로 사용하지 않는다.
- 복원 중 연도 `useEffect`의 LIVE 자동조회 및 업로드 scope 재읽기를 억제한다. 연도·차수를 저장값으로 먼저 고정하고 workbook/entries/prices를 한 묶음으로 설정한다.
- 복원 source base는 `saved:<uuid>`로 격리해 `dutchSourceIdentity`를 다시 만들고, 같은 파일명의 다른 localStorage 초안이 복원값을 덮지 못하게 한다.
- 복원 후 revision과 요청 세대를 증가시켜 진행 중이던 preview/load 응답도 폐기한다. `matchCache`, 선택 후보, 확인 체크, apply 결과와 jobId를 비운다.
- 저장 목록은 연도 필터 없이 본인 전체를 표시한다. 화면 기준은 1920x1080이며 저장 목록·주요 검토 버튼은 가로 잘림이나 sticky 가림 없이 접근 가능해야 한다.

## 부작용 행렬

| 사용자 동작 | 서버 작업 JSON | OrderDetail | ShipmentDetail/Date/Farm | Estimate·Stock·WebProfitReport | ERP 적용 계획/로그 |
|---|---|---|---|---|---|
| 작업 저장 | 새 불변 파일 생성 | 보존 | 보존 | 보존 | 생성·복사 금지 |
| 작업 목록/상세 조회 | 본인 파일 읽기 | 보존 | 보존 | 보존 | 조회 금지 |
| 저장본 복원 | 브라우저 상태만 교체 | 보존 | 보존 | 보존 | 과거 token/job 폐기 |
| 작업 완료·ERP 업로드 검토 | 보존 | 읽기/기존 preview 계약 | 읽기/기존 preview 계약 | 읽기/기존 진단 | 새 owner-bound plan만 발행 가능 |
| 최종 ERP 적용 전 보관 | 새 불변 파일 생성, 실패 시 적용 중단 | 보존 | 보존 | 보존 | token/result 저장 금지 |
| 최종 ERP 적용 | 적용 전 보관 성공 후 보존 | 기존 DUTCH_VOLUME_APPLY 계약 | 기존 DUTCH_VOLUME_APPLY 계약 | 기존대로 보존 | 기존 job/audit 사용 |
| 단가표 엑셀 저장 | 보존 | 보존 | 보존 | 보존 | 무관 |

## 기준 원장

| 기준 | 정규화/기본값 | 권위 | 소비자·검증 |
|---|---|---|---|
| owner | 문자열 `req.user.userId`가 trim 검사로 비어 있으면 거부하되, 저장·해시는 공백을 제거하지 않은 인증 원문 그대로 사용 | 인증 세션 | API, owner SHA-256 디렉터리, owner 격리 테스트 |
| id | 서버 `randomUUID()`, 조회는 UUID만 허용 | 서버 저장소 | 상세 GET, 경로탈출/타인조회 테스트 |
| savedAt/savedBy | 서버 ISO 시각 / userName 또는 userId | 서버 인증 | 목록 표시, 클라이언트 위조 무시 테스트 |
| scope | 저장된 4자리 year + exact subweek | 저장본 | 복원 상태, 새 preview payload, 현재 선택값 덮어쓰기 방지 테스트 |
| workbook | JSON 안전 원본, 최대 32 sheets | 저장 당시 원본 | 시트 렌더, 별도 Excel export의 수식·스타일 보존 테스트 |
| entries | 순서·id·수량·unit·수동 keys 보존, 최대 5,000 | 저장 당시 편집 | 복원 편집표, preview 입력; 0/빈값 fixture |
| prices | 문자열 key/value 그대로, 명시 0과 빈칸 구분 | 저장 당시 편집 | 복원 단가표, preview 입력, Excel export |
| payload | UTF-8 900 KiB 이하 | nginx 1 MiB 제약보다 낮은 앱 계약 | 클라이언트 사전검사, Next body limit, store 재검사 |
| freshness | 저장된 preview/token 불신 | 현재 DB와 기존 preview API | 복원 후 apply 비활성, fresh preview 테스트 |
| pre-apply archive | 확인된 현재 편집본을 ERP POST 직전에 새로 저장; 실패 시 POST 금지 | 클라이언트 적용 흐름 + 작업 API | 저장 중 편집/중복 클릭 차단, save-failure fixture |
| 목록 | owner 전체, 최신순, 20개 cursor page | 서버 파일 metadata | history panel, pagination/order 테스트 |

필수 경계 fixture는 정상 저장/복원, entries 5,000/5,001, sheets 32/33, 900 KiB 경계, 명시 0/false/빈 단가, 다른 연도 동일 차수, 위조 savedBy/savedAt/id, malformed UUID/경로탈출, 타 사용자 id, 손상·임시 파일 제외, 복원 후 token 무효, 저장 범위가 현재 연도 선택으로 교체되지 않음을 포함한다.

## 기존 ERP 계약 보존 근거와 완료 조건

- `FormShipmentDistribution.btnSave_Click`와 `ClassShipmentDate.UpdateCost`의 수량·날짜·금액 저장 순서는 기존 `dutch-volume-preview/apply`가 계속 소유한다. 이번 저장소는 MSSQL에 연결하지 않는다.
- 메인 작업의 최신 read-only 표본은 2026/40-01/533/2231에서 ViewOrder/ViewShipment 각 1건, DateQty 100, Farm 0, fixed=true, Amount 190,909, Vat 19,091이며, 전년도 동일 차수와 확정 매출 합계는 계속 보존 대상이다.
- 저장·복원만으로 apply가 활성화되지 않고, fresh preview 뒤 기존 acknowledgement와 final apply가 필요해야 한다.
- 저장한 원본을 복원해 별도 Excel 내보내기 했을 때 수식·스타일·병합과 편집 수량·단가가 유지되어야 한다.
- API/store/UI 회귀, `npm run test:erp-contract`, dnSpy evidence, manifest/write guard, Dutch SQL test, pivot test, build, 1920x1080 실브라우저 smoke를 통과해야 한다.

## 알려진 제약

- 지정 워크트리에는 `docs/CODEX_SUBTASK_ORCHESTRATION.md`가 없었다. 메인 작업이 전달한 `APPROVAL_FREE_CHILD / ARCHITECT / P0_LOCAL` 범위로 진행했으며, 이 누락은 기능 설계를 막지 않지만 저장소 문서 동기화가 필요하다.
- 저장본 삭제·공유·관리자 조회·보존기간 자동정리·호스트 외부 백업은 이번 범위가 아니다.
