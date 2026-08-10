# MOYI Drive 애플리케이션·Identity 구조조사

상태: read-only 구조조사. 확인된 사실과 미확인 사항을 분리한다.

## 2026-08-10 Drive 원장 PR read-only 확인

MOYI backend Draft PR 19(`e9f86d6`)와 그 위 PR 21(`bf8ee45`)에서 `/drive/v2` 계약을 확인했다.

- 실제 존재: `POST /folders`, `PUT /folders/{folder_id}/acl`, `GET /folders/{folder_id}/items`, `POST /folders/{folder_id}/naverworks/manifest`.
- 실제 item 응답: `id`, `file_id`, `name`, `source_kind`, `sha256`, `source_deleted`, `sync_state`.
- 실제 권한: active workspace membership, staging 관리자 제한, 상속 중지, 만료 ACL 제외, explicit deny 우선.
- MOYI 업로드는 `source_kind=moyi_upload`, NAVER WORKS 관찰 자료는 `source_kind=naverworks_drive`로 공통 원장에 기록된다.
- 아직 없음: 폴더 트리 조회, ACL 조회, sync job/checkpoint/attempt 조회, 관리자용 다운로드 감사 조회, 파일 버전 조회, `UserInfo.UserID` 매핑 API.
- NAVER WORKS manifest API는 connector가 관찰한 메타데이터를 staging에 기록할 뿐 실제 NAVER WORKS 인증·다운로드 connector가 아니다.

Nenova 웹은 위 PR이 운영에 반영되고 `MOYI_DRIVE_LEDGER_READY=true`, `MOYI_DRIVE_ROOT_FOLDER_ID`가 설정된 경우에만 기존 HttpOnly `moyiNenovaToken`을 서버에서 사용해 지정 폴더의 item 목록을 읽는다. 브라우저가 workspace/tenant를 지정할 수 없고 token은 응답하지 않는다. PR 미배포, token 없음, 폴더 미설정은 빈 실제 목록과 구체적인 `연결 대기` 사유로 표시하며 sample 자료를 만들지 않는다. ACL 저장은 조회·감사·연결 범위 계약이 완성될 때까지 503으로 차단한다.

## 1. 조사 범위와 제한

조사 대상은 현재 `nenova-erp-ui` worktree의 source, 문서, 계약이다. MOYI 앱·MOYI Core 저장소, 운영 DB, 실제 사용자 계정, token 원문에는 접근하지 않았다. 따라서 MOYI 앱 내부 인증·tenant·session 구현은 확인할 수 없다.

## 2. 확인된 NenovaWeb 구조

| 항목 | 확인 결과 | 근거 |
|---|---|---|
| 로그인 원장 | MSSQL `UserInfo`의 `UserID`, `Password`, `Authority`, `DeptName`, `isDeleted` | `pages/api/auth/login.js` |
| 비활성 계정 | `isDeleted`이면 로그인 거부 | `pages/api/auth/login.js` |
| 인증 token | 자체 JWT, 8시간 만료 | `lib/auth.js` |
| token 전달 | HttpOnly `nenovaToken` cookie 또는 Bearer | `lib/auth.js` |
| cookie | production Secure, SameSite=Strict, 8시간 | `pages/api/auth/login.js` |
| logout | cookie 만료 | `pages/api/auth/logout.js` |
| 서버 session/device 원장 | source에서 확인되지 않음 | 미확인/부재 후보 |
| JWT claim | userId, userName, authority, deptName | `lib/auth.js` |
| tenant claim | JWT에 없음 | 확인됨 |
| 모바일 웹 | PC와 같은 `/api/auth/login`, `/api/auth/me` 사용 | `pages/m/login.js` |

암호 검증 방식, 강제 로그아웃, refresh token, MFA, SSO, device 관리, token denylist는 현재 조사 범위에서 확인되지 않았다. 구현 전에 별도 보안 검토가 필요하다.

## 3. 확인된 MOYI 연결 구조

| 항목 | 확인 결과 | 근거 |
|---|---|---|
| 연결 시작 | MOYI에서 발급한 연결코드를 NenovaWeb이 exchange endpoint로 전달 | `pages/integrations/moyi.js`, `pages/api/moyi/exchange.js` |
| 연결 token | 응답 `access_token`을 별도 HttpOnly `moyiNenovaToken` cookie에 저장 | `pages/api/moyi/exchange.js` |
| token 수명 | cookie Max-Age 1년 | 같은 파일 |
| upstream | `/integrations/nenovaweb/*` | `pages/api/moyi/*` |
| MOYI member 식별자 | 응답의 `user_id`, name, dept, role을 화면에서 사용 | `pages/integrations/moyi.js` |
| Nenova 사용자와의 1:1 mapping | source에서 확인되지 않음 | 미확인 |
| MOYI tenant/company ID | 응답/저장 구조가 이 저장소에는 없음 | 미확인 |
| MOYI 앱 logout/비활성 | MOYI 앱 source가 없어 확인 불가 | 미확인 |

Nenova JWT와 MOYI token이 별도 cookie인 사실만 확인된다. 계정이 실제로 공유되거나 동일 사용자를 가리킨다고 결론 내릴 근거는 없다.

### 3.1 기존 ‘MOYI 보고 연동’ read-only 조사 결과

| NenovaWeb endpoint | upstream / payload | 확인된 인증·권한 | 설계 판정 |
|---|---|---|---|
| `POST /api/moyi/exchange` | `/integrations/nenovaweb/exchange`, `{code}` | 응답 token을 HttpOnly `moyiNenovaToken` cookie로 저장. 로컬 `withAuth` 없음 | 연결 bootstrap 후보. 사용자 identity proof로 간주 금지 |
| `GET /api/moyi/members` | `/integrations/nenovaweb/members` | MOYI cookie를 Bearer로 proxy. `user_id/name/dept/role` 반환 | MOYI 후보 목록이며 `UserInfo.UserID` 매핑 근거는 아님 |
| `PUT /api/moyi/recipients` | `/integrations/nenovaweb/recipients`, `{user_ids}` | MOYI cookie를 Bearer로 proxy. 로컬 `withAuth` 없음 | 보고 수신자 설정과 Drive ACL을 분리 |
| `DELETE /api/moyi/connection` | `/integrations/nenovaweb/connection` | MOYI cookie를 Bearer로 proxy | unlink 동작·token 철회·응답 cookie 삭제를 통합시험해야 함 |
| `GET/POST /api/moyi/report-push` | `/integrations/nenovaweb/inbound`, `file_id/filename/mime/tags/content_base64` | Nenova `withAuth`; upstream은 서버 간 token | 기존 보고 전송 기반으로 재사용 가능. 현재 payload에는 사용자 mapping 없음 |

`report-push`는 `OrderYear`와 `OrderWeek`를 별도 저장·조회하며 전송 파일의 멱등키와 SHA-256을 기록한다. 다만 현재 구현만으로는 MOYI 수신 파일이 어떤 `UserInfo.UserID` 또는 MOYI 사용자에게 귀속되는지 확인할 수 없다. 또한 `/api/moyi/exchange|members|recipients|connection`에는 로컬 Nenova 인증 guard가 확인되지 않았으므로, tenant·사용자·Drive 권한 API로 재사용하기 전에 인증과 CSRF/권한 경계를 별도로 고정해야 한다.

### 3.2 보고 연동 사용자 매칭 흐름

1. Connector가 tenant 범위의 활성 `UserInfo.UserID`를 읽기 전용 후보로 수집한다.
2. MOYI의 사용자 후보와 비교하되 ID·이름·부서는 점수/충돌 표시용으로만 사용한다.
3. 관리자 또는 본인 확인이 `pending` link를 승인한다. 동명이인, 부서 불일치, 퇴사·비활성 계정은 자동 승인하지 않는다.
4. 보고 전송 시 `tenantId`, `connectorInstallationId`, `identityLinkId`, `orderYear`, `orderWeek`, 업무 scope를 signed exchange의 검증된 context에서 만든다. 클라이언트 입력을 신뢰하지 않는다.
5. MOYI는 연결된 `moyiUserId`, active membership, scope를 확인한 뒤 최소 read model만 노출한다.
6. 성공·미매칭·충돌·거절·연결해제를 `AuditEvent`로 기록한다.

## 4. 필요한 Identity Broker 모델

```text
MOYI Identity
  └─ tenant membership
       └─ identity_link
            ├─ provider = nenovaweb
            ├─ external_tenant_id
            ├─ external_user_id = UserInfo.UserID
            ├─ state = pending|active|suspended|revoked
            ├─ proof_method / proof_at
            └─ linked_by / approved_by
```

필수 논리 필드는 `tenant_id`, `company_id`, `connector_installation_id`, `nenova_user_id`, `moyi_user_id`, `status`, `source`, `linked_by`, `linked_at`, `unlinked_at`, `approved_by`, `approved_at`, `last_verified_at`이다. 변경 이력은 행 덮어쓰기만 하지 않고 별도 불변 audit event로 남긴다. `(tenant_id, connector_installation_id, nenova_user_id)`와 `(tenant_id, moyi_user_id, provider)`의 활성 link는 각각 유일해야 한다.

- 이메일·이름 자동 일치로 계정을 연결하지 않는다.
- 연결코드 또는 관리 승인으로 두 계정 소유권을 증명한다.
- `identity_link`는 파일 소유권이 아니라 접근 자격의 연결이다.
- MOYI tenant membership이 비활성화되면 link가 active여도 Drive 접근을 거부한다.
- 연결 해제 시 Nenova ERP 데이터나 MOYI 파일을 삭제하지 않는다.

### 4.1 원천과 reverse provisioning/read model

| 영역 | 원천 | MOYI에 허용되는 복제/조회 | 금지 |
|---|---|---|---|
| ERP 사용자·담당자·업무권한 | Nenova `UserInfo`와 Connector | external key, 표시명, 부서, 활성 상태, 허용 업무 scope의 최소 projection | 비밀번호·Nenova JWT·전체 UserInfo 복제 |
| 앱 역할·Drive ACL | MOYI Core | tenant membership, role, ACL, 정책 판정 결과 | Nenova Authority를 Drive ACL로 직접 치환 |
| 보고/업무 링크 | Nenova Connector | `OrderYear+OrderWeek` 및 필요한 업무키, report/file reference | MOYI의 ERP 원장 직접 접근·수정 |

Reverse provisioning은 Connector API 또는 제한된 outbox가 `UserActivated/UserDeactivated/DepartmentChanged/BusinessScopeChanged` projection을 전달하는 방식으로 한다. MOYI는 이를 ERP 원장으로 취급하지 않고 link 재검증 신호로 사용한다. 비활성·연결해제 시 새 세션과 signed URL 발급을 즉시 차단하고 refresh token, connector cache, offline entitlement를 철회한다. 이미 내려간 암호화 cache에는 짧은 유예와 원격 삭제 명령을 적용하며 유예 시간은 tenant 정책으로 기록한다.

### 4.2 token 교환 계약

- Nenova JWT 또는 비밀번호를 MOYI로 전달하지 않는다.
- 서버 간 단기 token 또는 서명된 assertion은 `iss`, `aud`, `exp`, `jti`, `tenant_id`, `connector_installation_id`, `scope`, `identity_link_id`를 검증한다.
- replay 방지를 위해 `jti`를 1회 사용하고, audience가 Drive API와 report inbound 사이에서 혼용되지 않게 한다.
- 사용자에게 반환하는 read model은 connector가 확인한 업무권한과 MOYI 정책의 교집합으로 제한한다.

### 4.3 충돌·승인 정책

| 상황 | 처리 |
|---|---|
| 동일 UserID, 같은 tenant, 단일 활성 후보 | `pending` 후보 생성 후 관리자/본인 확인 |
| 동명이인 또는 복수 후보 | 자동 확정 금지, 관리자 conflict queue |
| 부서/회사 불일치 | deny 및 근거 표시, 양쪽 원장 확인 |
| Nenova 비활성·퇴사 | link suspend, 세션/cache/file entitlement 철회 |
| 이미 다른 MOYI 사용자와 active link | 신규 연결 deny, 이중 승인으로 기존 link 해제 후 재연결 |
| 연결 해제 후 재연결 | 새 proof와 승인 필수, 과거 ACL 자동 복원 금지 |

### 4.4 tenant·보안·최소화 매트릭스

| 요청 | 필수 context | 반환 가능 | 거부 조건 |
|---|---|---|---|
| 직원 보고 조회 | tenant, active link, report scope, year+week | 허용 보고의 요약/참조 | tenant/link/scope 불일치 |
| ERP 업무 조회 | tenant, nenovaUserId, business scope, year+week | Connector 최소 read model | 직접 DB 요청, 연도 누락 |
| Drive preview | tenant, MOYI ACL, classification | 단기 preview URL | Nenova Authority만 존재 |
| Drive download | tenant, download ACL, DLP 정책 | 짧은 만료 URL+audit | 외부공유/민감도 정책 위반 |
| 관리자 matching | tenant admin, connector scope | 마스킹된 후보/충돌 사유 | 타 tenant 후보 또는 비밀번호/token 요청 |

## 5. API와 권한 계산 위치

권장 구조는 MOYI 앱과 NenovaWeb 모두 공통 Drive API를 호출하는 것이다. 앱 전용 BFF는 device upload, push notification, offline sync DTO 변환만 담당하고 권한 결정을 복제하지 않는다.

```text
MOYI App ─┐
          ├─ BFF(optional) ─ MOYI Drive API ─ Policy Evaluator
NenovaWeb ┘                         └─ Audit Event
```

- tenant/workspace/folder/file ACL 계산은 MOYI Core API에서 수행한다.
- NenovaWeb은 `UserInfo.UserID`를 직접 Drive ACL subject로 사용하지 않고 identity link를 통해 MOYI membership으로 변환한다.
- 미리보기와 다운로드는 각각 별도 권한 검사와 audit event를 요구한다.
- 앱 전용 API가 있어도 storage key, ACL 계산, signed URL 발급을 독자 수행하지 않는다.

## 6. ERP 연결키와 불변식

Nenova external link는 최소 다음 값을 가진다.

```json
{
  "connectorType": "nenova-erp",
  "externalTenantId": "opaque-nenova-installation-id",
  "entityType": "shipment|order|estimate|report",
  "orderYear": "2026",
  "orderWeek": "29-02",
  "custKey": 100,
  "prodKey": 200
}
```

- 차수 관련 링크는 `OrderYear + OrderWeek`가 함께 없으면 생성 거부한다.
- 필요 업무는 `CustKey + ProdKey`를 더해 `OrderYear + OrderWeek + CustKey + ProdKey`로 식별한다.
- MOYI는 ERP 행을 복제하거나 파일 삭제를 ERP 삭제로 전파하지 않는다.
- 농장 후보 scope 같은 Nenova 특수 규칙은 Connector 내부에만 둔다.

## 7. 미확인 사항과 확보해야 할 증거

| 미확인 | 필요한 증거 |
|---|---|
| MOYI 앱 로그인 방식 | 앱 source 또는 공식 auth sequence |
| MOYI user/tenant/org ID | API schema와 DB migration |
| access/refresh token 수명·철회 | auth contract와 session table |
| 앱 logout/비활성 계정 처리 | 테스트와 server handler |
| 앱 파일 ACL 계산 위치 | Drive API/Policy source |
| 앱 offline cache 삭제 | device sync contract |
| 연결코드가 사용자/회사 중 무엇을 연결하는지 | exchange API 공식 계약 |
| `moyiNenovaToken` 철회 여부 | upstream revoke/denylist 동작 테스트 |

이 증거가 확보되기 전 “공유 로그인”, “SSO 완료”, “tenant 격리 완료”로 표시하지 않는다.

## 8. read-only 검증 계획

1. MOYI 앱/Core 담당 저장소에서 auth·tenant·Drive schema를 읽기 전용 점검한다.
2. 샘플 또는 비운영 tenant에서 login→link→revoke sequence의 상태 코드만 검증한다.
3. token 원문은 출력하지 않고 claim 이름·issuer·audience·expiry 존재 여부만 기록한다.
4. 두 tenant/두 user fixture로 목록·검색·preview·download를 교차 호출한다.
5. 계정 연결 해제 후 신규 signed URL 차단과 cache revoke event를 확인한다.
6. 2025/2026 동일 차수 external link가 분리되는지 검증한다.
7. 모든 검증은 ERP SELECT 또는 mock으로 제한하고 원장 쓰기를 수행하지 않는다.
8. 기존 다섯 MOYI endpoint의 method, payload, cookie/Bearer, 로컬 auth guard를 source test로 고정한다.
9. report inbound schema에 사용자/tenant context가 실제 지원되는지 MOYI Core 계약에서 확인한다.
10. `UserInfo.UserID` 후보 생성은 비운영 fixture로만 수행하고 동명이인·부서 충돌·비활성 사례를 포함한다.

## 9. 단계적 rollout

1. **Discovery**: MOYI Core auth/tenant 계약, report inbound schema, token revoke를 읽기 전용 확인한다.
2. **Shadow matching**: fixture 또는 비운영 tenant에서 후보·충돌만 생성하고 권한을 부여하지 않는다.
3. **Approval pilot**: 제한된 내부 tenant에서 수동 승인, 최소 보고 read model, unlink 철회를 검증한다.
4. **Drive enforcement**: 공통 Policy Evaluator와 audit가 통과한 요청에만 preview/download를 허용한다.
5. **Connector rollout**: outbox 재처리·비활성 계정 revoke·cross-tenant 침투 테스트 후 tenant별 opt-in한다.

## 10. 구현 승인 전 금지

- MOYI/Nenova 계정 자동 병합
- `UserInfo.UserID`를 전역 MOYI User ID로 사용
- 운영 사용자·tenant 대상 권한 migration
- Drive 업로드·ACL·signed URL 운영 적용
- ERP 문서 링크를 `OrderWeek`만으로 생성
- 실제 파일 원문을 diff 실험 서비스에 전송
- 운영 DB INSERT/UPDATE/DELETE
