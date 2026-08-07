# MOYI Drive 권한·보안 설계

상태: 정책 초안. 법률·인증 적합성 판정이 아니라 구현과 검증 기준이다.

## 1. 권한 모델

RBAC로 기본 역할을 부여하고 tenant/workspace/folder/file ACL로 범위를 제한한다. 최종 판정은 API가 수행한다.

```text
explicit deny
  > file ACL
  > folder ACL / inheritance stop
  > workspace policy
  > organization/role policy
  > tenant default deny
```

클라이언트가 버튼을 숨기는 것은 UX일 뿐 보안 통제가 아니다.

### 역할

- tenant_admin: 업체 설정, 정책, 조직 관리
- org_admin: 조직과 부서 Drive 관리
- business_owner: 담당 업무와 승인
- import_team: 수입/입고 업무 범위
- sales_team: 영업/거래처 업무 범위
- employee: 본인·공유·부서 정책 범위
- external_guest: 명시적으로 공유된 자원만

관리 권한과 restricted 파일 열람 권한은 분리한다.

### 동작별 권한

| 권한 | tenant admin | org admin | 업무담당 | 수입/영업 | 직원 | 외부 |
|---|---:|---:|---:|---:|---:|---:|
| view/preview | 정책 범위 | 조직 범위 | 업무 범위 | 부서 범위 | 본인·공유 | 공유만 |
| upload | 허용 | 허용 | 허용 | 허용 | 허용 폴더 | 기본 금지 |
| edit metadata | 정책 범위 | 조직 범위 | 업무 범위 | 담당 범위 | 본인 초안 | 금지 |
| move | 허용 | 조직 범위 | 업무 범위 | 제한 | 기본 금지 | 금지 |
| download | 분류정책 적용 | 분류정책 적용 | 분류정책 적용 | 명시 허용 | 명시 허용 | 별도 허용 |
| delete/restore | 정책 범위 | 조직 범위 | 업무 범위 | 제한 | 본인 초안 | 금지 |
| share internal | 허용 | 조직 범위 | 업무 범위 | 제한 | 정책 허용 시 | 금지 |
| share external | 이중 정책 | 승인 필요 | 요청 가능 | 요청 가능 | 기본 금지 | 금지 |
| change ACL | 허용 | 조직 범위 | 소유 범위 | 금지 | 금지 | 금지 |
| approve | 지정 정책 | 지정 범위 | 지정 업무 | 선택 | 금지 | 금지 |

## 2. 계정 변화

- 퇴사: membership 비활성화, 모든 session/device 철회, 개인 소유 파일을 tenant 지정 보관자에게 이전, 기존 감사 이력 유지.
- 부서 이동: 과거 업무 접근은 정책에 따라 유지·철회하고 새 부서 권한을 별도 부여. 폴더 소유권을 자동 이동하지 않음.
- 역할 변경: 다음 API 요청부터 재평가. 장기 access token에 전체 권한을 고정하지 않음.
- 기간제 권한: 시작·만료시각 필수, 만료 후 캐시와 share token을 철회.

## 3. 파일 접근 판정

1. session, device, MFA 상태 확인
2. active tenant와 resource tenant 일치 확인
3. membership과 계정 상태 확인
4. 파일 상태·격리·만료 확인
5. explicit deny 확인
6. file/folder/workspace ACL 계산
7. role/org/business policy 계산
8. 분류등급별 preview/download/share 통제
9. 필요 시 step-up MFA 또는 승인 확인
10. 감사 이벤트 기록 후 짧은 signed URL 또는 proxy stream 발급

signed URL은 보유자에게 유효기간 동안 권한을 주므로 짧은 TTL, 단일 object/action, HTTPS, 로그 마스킹이 필요하다([Google signed URLs](https://docs.cloud.google.com/storage/docs/access-control/signed-urls), [Azure SAS](https://learn.microsoft.com/azure/storage/blobs/storage-blob-user-delegation-sas-create-dotnet)).

## 4. 업로드 방어

OWASP File Upload 지침을 최소 기준으로 적용한다.

- 업무상 필요한 확장자 allowlist
- 사용자 Content-Type 비신뢰
- 확장자, MIME sniffing, magic bytes 교차검증
- 원본명은 표시용이며 storage key는 서버 생성
- 파일·요청·tenant별 용량 제한
- archive entry 수, 중첩 깊이, 압축률, 예상 해제크기 제한
- 비공개 저장소와 webroot 밖 staging
- 악성코드 검사와 필요 시 CDR
- parser를 격리 worker에서 실행
- 업로드 CSRF 방어와 API rate limit
- scan 전 미리보기·다운로드·공유 차단

근거: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## 5. 정보보호와 DLP

기본 등급은 `public`, `internal`, `confidential`, `restricted`, `personal_data`다.

- confidential 이상은 외부공유 기본 차단
- restricted/personal_data 원본 다운로드는 승인 또는 신뢰 기기 요구
- 다운로드 문서에 tenant, 사용자, 시각, 추적 ID 워터마크
- 대량 조회·다운로드 속도와 총량 제한
- 새 국가/IP/기기, 비정상 시간, 퇴사 전 대량 접근 탐지
- 공개 악성코드 서비스에 민감 파일 원문 전송 금지
- 데이터 분류 결과와 rule/model version을 감사 기록

## 6. 암호화와 키

- 전송 중 TLS, 저장 시 객체 저장소 암호화
- credential과 signing key는 secret manager 또는 KMS에 저장
- tenant별 envelope key는 고급 단계에서 선택 지원
- key rotation, revoke, usage audit 정의
- application log와 URL에 signed token, session URI, 개인정보를 남기지 않음

## 7. 감사로그 위변조 방지

- append-only 기록
- monotonic sequence와 이전 이벤트 hash를 연결
- 운영자 UPDATE/DELETE 금지
- 별도 보존 계층 또는 WORM 복제
- actor, tenant, session, device, action, resource, result, correlation ID 기록
- 보안로그와 업무 감사로그의 목적·보존기간 분리

Azure Blob immutable storage는 time-based retention과 legal hold로 WORM을 제공한다([Microsoft 공식 문서](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)). 유사 capability는 저장소 adapter의 선택 기능으로 모델링한다.

## 8. 백업·복구·보존

- DB metadata와 object storage를 일관된 recovery point로 복구하는 runbook 필요
- 초기 제안: metadata RPO 1시간 이하, RTO 4시간 이하. 이는 미확정이며 업무 영향 분석 후 승인한다.
- 월 1회 restore drill과 파일 hash 대조
- trash, retention, legal hold, backup retention을 별도 개념으로 관리
- 영구삭제는 원본·버전·preview·검색문서·cache 삭제를 추적

Google Cloud lifecycle은 TTL, noncurrent version, retention/hold를 지원한다([공식 문서](https://docs.cloud.google.com/storage/docs/lifecycle)). 공급자 독립 정책을 MOYI가 정의하고 adapter가 지원 가능 범위를 보고해야 한다.

## 9. 표준 통제 매핑

| 설계 영역 | OWASP ASVS | NIST SP 800-53 Rev.5 | ISO/IEC 27001 관점 |
|---|---|---|---|
| 인증·세션 | V2/V3 | IA, AC | identity/access control |
| ACL·tenant 격리 | V4 | AC | access restriction |
| 입력·업로드 | V5/V12 | SI, SC | secure processing |
| 암호화 | V6/V9 | SC, MP | cryptography |
| 개인정보 | V8 | PT, MP | information classification |
| 감사·탐지 | V7 | AU, SI | logging/monitoring |
| 백업·복구 | V8/V14 | CP | continuity |
| API | V13 | AC, SC, SI | secure development |

ISO 27001 인증 여부를 문서만으로 주장하지 않는다. 실제 scope, 위험평가, 운영 증거와 독립 심사가 필요하다.

## 10. 보안 테스트

- tenant/resource ID를 바꾼 IDOR 차단
- 검색·최근·휴지통·공유에서 교차 tenant 미노출
- explicit deny와 상속 중지 우선순위
- 역할·부서 변경 직후 권한 철회
- preview 허용/download 금지 조합
- 만료·철회된 share/signed URL 거부
- refresh token 재사용과 분실 device 철회
- double extension, spoofed MIME, polyglot, zip bomb, parser exploit 격리
- 같은 idempotency key의 다른 hash 충돌
- 대량 다운로드 rate limit과 경보
- audit log tamper 탐지
- backup restore 후 DB metadata와 object hash 일치
