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
| `file_version` | id, file_id, storage_key, size_bytes, sha256, mime_detected, scan_state | append-only |
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
