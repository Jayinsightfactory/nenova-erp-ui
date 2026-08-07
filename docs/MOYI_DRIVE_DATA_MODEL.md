# MOYI Drive 데이터 모델

상태: 논리 모델 초안. 실제 DDL이 아니며 운영 DB에 적용하지 않는다.

## 1. 불변 원칙

1. tenant 소유 자원은 모두 `tenant_id`를 가진다.
2. API가 받은 tenant 값을 신뢰하지 않고 인증 주체의 membership과 비교한다.
3. 파일 원본은 private object storage, 업무·권한·검색 메타데이터는 MOYI DB에 둔다.
4. object key에 업체명, 이메일, 파일명, ERP 키를 넣지 않는다.
5. ERP 원장은 복제하지 않고 `external_link`로 연결한다.
6. 파일과 버전은 분리하며 기존 버전을 덮어쓰지 않는다.

## 2. 핵심 엔터티

| 엔터티 | 핵심 필드 | 제약 |
|---|---|---|
| `tenant` | id, name, status, policy_set_id | 전역 불투명 ID |
| `workspace` | id, tenant_id, type, name, owner_org_id | tenant 내부 유니크 이름 |
| `folder` | id, tenant_id, workspace_id, parent_id, name, inherit_acl | 순환 금지 |
| `file` | id, tenant_id, workspace_id, folder_id, current_version_id, state, classification | 원본명과 storage key 분리 |
| `file_version` | id, file_id, previous_version_id, storage_key, size_bytes, sha256, mime_detected, scan_state, content_change_state, is_confirmed, restorable | append-only |
| `version_change` | id, file_version_id, detector, detector_version, change_type, summary, diff_state | 시스템 감지 결과, append-only |
| `version_change_item` | id, version_change_id, part_type, locator, before_value, after_value, masked | 셀·문단·페이지 등 세부 diff |
| `version_reason` | id, file_version_id, reason, entered_by, entered_at | 사용자 입력 사유, 감지 결과와 분리 |
| `diff_snapshot` | id, from_version_id, to_version_id, storage_key, sha256, format, state | 불변 보존 |
| `file_category` | id, tenant_id, code, label, schema_version | tenant 확장 가능 |
| `file_metadata` | file_id, namespace, schema_version, json_value | 검증된 JSON |
| `tag` | id, tenant_id, normalized_name | tenant 범위 유니크 |
| `file_tag` | file_id, tag_id | 다대다 |
| `external_link` | id, tenant_id, file_id, connector_installation_id, entity_type, external_key, attributes | 외부 원장 참조 |
| `share` | id, file/folder, subject_type/id, permissions, expires_at | 내부 공유 |
| `share_link` | id, resource, token_hash, permissions, expires_at, max_downloads | 원문 토큰 미저장 |
| `retention_policy` | id, tenant_id, duration, trash_duration, legal_hold_rules | 정책 버전 관리 |
| `audit_log` | id, tenant_id, actor, action, resource, result, occurred_at, prev_hash/hash | append-only |
| `upload_session` | id, tenant_id, target_folder, object_key, state, offset/parts, expires_at | resumable |
| `preview_artifact` | id, file_version_id, type, storage_key, state | 원본과 별도 |

권장 storage key:

```text
tenants/{opaqueTenantId}/files/{opaqueFileId}/versions/{opaqueVersionId}
```

## 3. 파일 상태

```text
draft → uploading → uploaded → scanning → classifying → review_required → available
                         ↘ failed       ↘ quarantined
available → trashed → restored
available/trashed → retention_pending → deleted
```

- `available` 전에는 일반 다운로드와 공유를 금지한다.
- `quarantined`는 보안 관리자만 제한적으로 조사한다.
- `deleted`는 메타데이터 tombstone과 삭제 증거만 보존한다.
- legal hold 중에는 영구삭제를 거부한다.

## 4. 버전·중복·해시

- 새 콘텐츠는 항상 새 `file_version`이다.
- 클라이언트의 SHA-256을 힌트로 사용하되 서버 또는 저장소가 최종 검증한다.
- 동일 tenant·동일 hash는 중복 후보를 표시하지만 자동으로 파일 권한을 합치지 않는다.
- 다른 tenant의 해시 존재 여부를 응답하지 않는다.
- idempotency key 재사용은 동일 payload면 기존 결과, 다른 payload면 409를 반환한다.
- object storage의 같은 key 덮어쓰기를 허용하지 않는다. AWS와 Google 모두 같은 object key 업로드가 기존 객체를 교체할 수 있으므로 애플리케이션이 version ID 기반 새 key를 발급해야 한다([AWS presigned upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html), [Google object uploads](https://docs.cloud.google.com/storage/docs/uploads)).

### 4.1 내용 변경 판정

`content_change_state`는 다음 값 중 하나다.

- `CONTENT_CHANGED`: 본문·셀·문단·페이지·이미지·첨부가 변경됨
- `CONTENT_UNCHANGED`: 원본 바이너리와 정규화된 내용이 동일함
- `METADATA_ONLY`: 제목·파일명·폴더·권한 등 metadata만 변경됨
- `BINARY_CHANGED_DIFF_UNSUPPORTED`: 해시는 달라졌지만 의미 diff 미지원
- `DIFF_FAILED`: 지원 형식이나 안전한 diff 생성에 실패
- `PENDING_ANALYSIS`: 검사 대기

파일명, 제목, 폴더 이동, 태그, 분류, 권한 변경은 새 콘텐츠 버전을 만들지 않고 별도의 metadata audit event로 기록한다. 정책상 metadata snapshot이 필요하면 `file_metadata_revision`을 사용하되 `file_version`과 혼동하지 않는다.

| 형식 | 최소 감지 범위 | 저장할 요약 |
|---|---|---|
| Excel | sheet 생성·삭제·이름변경, cell/range 값·수식·서식 변경 | sheet, range, 변경 개수, 마스킹된 before/after |
| Word | 문단·표·header/footer·첨부 추가/삭제/수정 | locator, change type, 마스킹된 문장 요약 |
| PDF | 페이지 추가·삭제·순서, 추출 텍스트·이미지 hash 변경 | page 번호, text/image change 여부 |
| 이미지 | binary/perceptual hash, byte size, width/height, orientation | 이전·현재 규격과 hash 결과 |
| 기타 | SHA-256와 크기 비교 | 의미 diff 불가 표시 |

민감값은 원문 diff에 중복 저장하지 않는다. `version_change_item.masked=true`와 정책 기반 요약을 저장하고, 원본 비교는 권한 있는 요청에서 불변 버전을 다시 읽어 계산한다.

### 4.2 버전 계보와 복원

- `previous_version_id`로 직전 버전을 연결하고 분기 업로드가 필요하면 별도 `version_parent` 관계를 둔다.
- 확정 버전은 `is_confirmed=true`, 확정자·시각은 audit event로 남긴다.
- `restorable`은 원본 존재, 악성코드 상태, 보존정책, 키 접근 가능성을 모두 충족할 때만 true다.
- 복원은 과거 object를 덮어쓰지 않고 과거 내용을 복제한 새 버전을 만든다.
- 원본 버전, diff snapshot, 감사로그는 일반 사용자 삭제 대상이 아니다.

### 4.3 예시

```json
{
  "fromVersion": "ver_10",
  "toVersion": "ver_11",
  "contentChangeState": "CONTENT_CHANGED",
  "userReason": "수입부 확인 수량 반영",
  "detected": {
    "type": "SPREADSHEET_CELL_CHANGED",
    "summary": "입고현황 시트 3개 셀 변경",
    "items": [
      { "locator": "입고현황!F12:F14", "before": "MASKED", "after": "MASKED", "masked": true }
    ]
  }
}
```

제목만 바꾸는 경우 `METADATA_ONLY` audit event를 생성하고 `file_version`은 `ver_11` 그대로 유지한다.

## 5. 메타데이터

### 공통 namespace

```json
{
  "documentType": "invoice|shipment-report|photo|spreadsheet|other",
  "businessStatus": "draft|confirmed|cancelled|unknown",
  "responsibleUserId": "usr_...",
  "capturedAt": "ISO-8601",
  "classificationConfidence": 0.92,
  "classificationSource": "user|ocr|connector"
}
```

### Nenova Connector namespace

```json
{
  "schema": "connector.nenova-erp/v1",
  "orderYear": "2026",
  "orderWeek": "29-02",
  "customerKey": 100,
  "productKey": 200,
  "farmKey": 300,
  "documentType": "weekly-profit-report"
}
```

`OrderYear + OrderWeek`는 차수 문서 링크에서 함께 필수다. `CustKey`, `ProdKey`, `FarmKey`는 표시명이 아니라 외부 식별자이며 MOYI Core 쿼리 컬럼으로 승격하지 않는다.

## 6. 원본과 ERP 링크 분리

```text
file ──< file_version
  └──< external_link >── connector_installation ── Nenova ERP entity
```

- 파일 삭제가 ERP 원장 삭제를 유발하지 않는다.
- ERP 행 삭제·변경이 파일 원본을 자동 삭제하지 않는다.
- 외부 링크 해석 실패는 `orphaned` 진단 상태로 표시한다.
- ERP 읽기 결과를 파일 metadata에 영구 복제하지 않고 필요한 표시값은 TTL cache로 취급한다.

## 7. 검색 모델

- 검색 문서는 `tenant_id`, `file_id`, 허용된 scope token을 포함한다.
- 본문 OCR 결과는 별도 암호화 필드와 분류등급을 가진다.
- 검색 인덱스 필터 후 API가 ACL을 재검증한다.
- ERP 업무 필터는 connector-specific metadata query로 변환한다.
- cursor pagination과 안정 정렬키 `(updated_at, file_id)`를 사용한다.

## 8. 동기화 모델

`change_event(sequence, tenant_id, resource_type, resource_id, action, version, occurred_at)`를 앱·웹 동기화 cursor의 원천으로 둔다.

- 앱은 마지막 sequence 이후 변경을 요청한다.
- 권한 변경과 삭제는 높은 우선순위로 반영한다.
- offline 명령은 `expectedVersion`과 idempotency key를 가진다.
- 충돌 시 서버가 자동 병합하지 않고 최신 metadata와 차이를 반환한다.
- Google Cloud의 resumable upload는 실패 후 이어 보내기를 지원하고 session URI 자체가 credential 역할을 하므로 HTTPS와 안전한 로컬 저장이 필요하다([공식 문서](https://docs.cloud.google.com/storage/docs/resumable-uploads)).
