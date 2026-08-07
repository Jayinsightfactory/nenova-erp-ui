# MOYI Drive 애플리케이션·Identity 구조조사

상태: read-only 구조조사. 확인된 사실과 미확인 사항을 분리한다.

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

- 이메일·이름 자동 일치로 계정을 연결하지 않는다.
- 연결코드 또는 관리 승인으로 두 계정 소유권을 증명한다.
- `identity_link`는 파일 소유권이 아니라 접근 자격의 연결이다.
- MOYI tenant membership이 비활성화되면 link가 active여도 Drive 접근을 거부한다.
- 연결 해제 시 Nenova ERP 데이터나 MOYI 파일을 삭제하지 않는다.

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

## 9. 구현 승인 전 금지

- MOYI/Nenova 계정 자동 병합
- `UserInfo.UserID`를 전역 MOYI User ID로 사용
- 운영 사용자·tenant 대상 권한 migration
- Drive 업로드·ACL·signed URL 운영 적용
- ERP 문서 링크를 `OrderWeek`만으로 생성
- 실제 파일 원문을 diff 실험 서비스에 전송
- 운영 DB INSERT/UPDATE/DELETE
