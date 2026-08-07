# MOYI Drive 구현 로드맵

상태: 단계·비용·위험 초안. 구현 승인 전 문서화 단계다.

## 저장소 선택 원칙

MOYI DB에는 metadata와 권한만 저장하고 원본은 private S3-compatible object storage에 둔다. `StorageAdapter`가 multipart/resumable, signed URL, versioning, retention, legal hold capability를 보고하게 하여 벤더 종속을 피한다.

| 후보 | 장점 | 제약/운영 부담 | 초기 판정 |
|---|---|---|---|
| Railway Bucket | 현재 Railway와 가까운 private S3-compatible 저장소, presigned URL 가능 | 최신 서비스이므로 실제 SLA·버전·보존 capability 확인 필요 | MVP 우선 후보 |
| AWS S3 | multipart, versioning, lifecycle, Object Lock와 풍부한 운영 기능 | 별도 계정/IAM/KMS/egress/비용 관리 | 보안·외부고객 확장 후보 |
| Google Cloud Storage | resumable upload, signed URL, lifecycle/retention | GCP IAM·리전·비용 운영 추가 | 모바일 불안정 네트워크 후보 |
| Azure Blob | user delegation SAS, immutability, Entra 통합 | Azure 운영 역량과 계정 필요 | 기업 SSO/WORM 후보 |
| Cafe24 웹 파일/FTP | 현재 운영과 가깝고 단순 | public webroot 위험, API·ACL·resumable 부족, 백업 보존 짧음 | Drive 원본 저장소 비권장 |
| SQL Server VARBINARY | 트랜잭션 단순성 | DB·백업 비대화, object lifecycle·CDN·resumable 부적합 | 작은 staging 외 비권장 |

Railway는 Bucket을 private S3-compatible object storage로 설명한다([Railway Buckets](https://docs.railway.com/storage-buckets)). Railway Volume은 service-attached filesystem이고 백업·용량·복원 범위가 Drive 요구와 다르다([Volumes](https://docs.railway.com/volumes/reference), [Backups](https://docs.railway.com/volumes/backups)). Cafe24 웹호스팅 자동 백업은 일반적으로 최근 7일과 전체/계정 단위 복원 중심이므로 장기 파일 보존 원장을 대체하지 않는다([Cafe24 백업/복원](https://help.cafe24.com/docs/web-hosting/web-hosting/web-hosting-backup-restore-migration/)).

## Phase 0 — 계약·위험·프로토타입 검증

### 범위

- 제품 경계와 데이터 분류 확정
- tenant, file, version, ACL, audit 논리 모델
- StorageAdapter와 Connector 계약
- 저장소 2개 이상의 기술 spike
- threat model, 개인정보 흐름, 비용 산정
- MOYI 앱과 NenovaWeb의 로그인·사용자·tenant·session 구조 read-only 조사
- Excel/Word/PDF/image diff engine의 안전성·정확도 spike

### 선행조건

- MOYI Core 소유 저장소와 책임자
- 예상 사용자·파일 수·평균/최대 크기
- 법적 보존과 외부 공유 방침

### 테스트·롤백

- 문서와 spike만 수행, 운영 데이터 없음
- provider 교체 가능성, hash 검증, signed URL TTL 검증
- 실패 시 구현하지 않고 요구사항·provider 결정으로 되돌림
- 실제 계정·파일·운영 DB를 쓰지 않고 source/document/API contract만 검증

### 비용/위험

- 낮은 인프라 비용, 중간 설계 비용
- 요구가 불명확한 상태에서 스키마를 확정하는 위험

## Phase 1 — MOYI Drive MVP

### 범위

- Tenant/Membership 기본 연동
- workspace/folder/file/version
- private upload/download
- 내 업로드, 최근 파일, 미분류함
- 기본 RBAC와 append-only audit
- 휴지통과 복구

### 제외

- 외부 공유, OCR 자동확정, WORM, ERP 쓰기

### 테스트

- tenant isolation, IDOR, upload validation
- 동일 idempotency key, 파일 hash, 버전
- 모바일 중단·재시도
- backup/restore drill

### 롤백

- feature flag로 UI/API 비활성
- 신규 파일 업로드 중단 후 읽기 전용 제공
- metadata DB와 object manifest로 복원

## Phase 2 — Nenova 연동

### 범위

- MOYI/Nenova 계정 명시적 연결
- Nenova ConnectorInstallation
- `OrderYear + OrderWeek` 필수 external link
- NenovaWeb 업무 화면 관련 파일 패널
- 앱 업로드와 웹 metadata/권한 변경 동기화
- 기존 보고서 push를 공통 transfer job으로 감쌈

### 위험

- 전년도 동일 차수 혼입
- ERP 표시명 변경과 orphan link
- 기존 Nenova 인증과 MOYI membership 불일치

### 테스트

- 2025/2026 동일 OrderWeek fixture
- ERP 원장 불변 side-effect 검사
- 앱/웹/NenovaWeb 권한 결과 동일성
- Connector 장애 시 MOYI Drive 독립 동작

### 롤백

- Connector feature flag 비활성
- 기존 Nenova 화면과 보고서 경로 유지
- external link만 숨기고 파일 원본 유지

## Phase 3 — OCR·자동분류·운영

### 범위

- OCR, 문서유형과 업무 metadata 후보
- 직원 확인·재분류·대량 처리
- preview와 tenant-scoped 검색 인덱스
- 실패함, 격리함, 관리자 대시보드
- Daemon 지연·실패·권한위반 알림

### 위험

- OCR 오분류, 개인정보 외부 전송, 처리 비용
- 검색 인덱스 권한 누출

### 테스트

- confidence threshold와 사람 확인
- 민감정보 redaction, provider 전송 정책
- 검색 결과의 API 재권한검사
- 재처리 idempotency와 DLQ

### 롤백

- 자동분류를 후보 전용으로 강등
- OCR provider 중지 후 수동 분류 유지
- 검색 인덱스를 재생성 가능한 파생 데이터로 취급

## Phase 4 — 고급보안·외부고객화

### 범위

- 외부 공유 승인, 워터마크, 만료·다운로드 제한
- SSO/MFA/device policy
- retention/legal hold/WORM
- DLP와 비정상 접근 탐지
- white-label, tenant onboarding, 비-Nenova Connector 검증

### 위험·비용

- 보안 운영 인력, SIEM/AV/OCR/KMS 비용
- 고객별 리전·보존·법적 요구 차이
- break-glass와 지원 접근 오남용

### 테스트

- 역할/ACL 전체 매트릭스
- 외부 링크 만료·철회·회수
- 법적 보존 삭제 차단
- 두 tenant와 두 connector의 완전 격리
- 침해사고 tabletop과 복구 훈련

### 롤백

- tenant별 고급 기능 비활성
- 외부 공유 전면 중단
- 기존 내부 Drive 읽기·업로드 기능 유지

## 먼저 구현하지 말아야 할 범위

- 파일 업로드 후 ERP 자동 등록: 잘못된 분류가 원장을 훼손할 수 있음.
- 공개 bucket과 영구 다운로드 URL: 권한 철회와 감사가 불가능함.
- OCR 결과 자동 확정: 오류 근거와 책임자 확인이 없음.
- `WebMoyiFile`을 공통 Drive 원장으로 확대: tenant/ACL/version/retention이 없음.
- DB `VARBINARY(MAX)` 대규모 저장: 백업과 성능 비용을 파일 서비스에 결합함.
- 다중 provider 동시 운영: MVP 운영 복잡도를 불필요하게 높임. adapter 검증만 두 provider로 수행.
- Nenova 명칭 일괄 제거: 기존 운영 인스턴스를 깨뜨릴 수 있음. 공통 Core와 선택형 Connector를 먼저 분리.

## 다음 구현 세션 작업 단위

1. `StorageAdapter` 인터페이스와 Railway/AWS capability spike
2. tenant/file/version/audit migration 초안과 tenant isolation test harness
3. upload session + complete + scan state API
4. RBAC/ACL policy evaluator와 매트릭스 테스트
5. MOYI 앱 resumable upload prototype
6. Nenova external link mapper와 교차연도 fixture
7. NenovaWeb 관련 파일 패널 read-only prototype
8. format별 content diff worker와 masking policy spike
9. identity broker/account-link proof-of-concept

## 구현 전 read-only 검증 게이트

다음 증거가 모두 확보되기 전 Drive 구현과 권한 적용을 시작하지 않는다.

1. MOYI 앱 저장소 또는 공식 인증/API 계약에서 사용자·회사·조직·session 식별자를 확인한다.
2. NenovaWeb `UserInfo.UserID`, JWT claim, 비활성 처리, logout 동작을 source test로 고정한다.
3. 두 계정이 공유된다는 증거가 없으면 별도 identity link 모델을 기본으로 한다.
4. 두 tenant fixture로 file/folder/search/hash dedupe가 교차되지 않음을 계약 테스트로 증명한다.
5. `OrderYear + OrderWeek`가 없는 Nenova external link를 validation error로 거부한다.
6. metadata-only 변경이 content version을 만들지 않는지 확인한다.
7. 지원 형식별 diff fixture와 민감값 masking snapshot을 검토한다.
8. preview/download deny와 audit event가 동일 policy evaluator를 통과하는지 확인한다.
9. 계정 연결 해제 후 token·cache·권한 수렴을 시뮬레이션한다.
10. 모든 흐름에서 OrderDetail, ShipmentDetail, ProductStock, Estimate, WebProfitReport가 보존됨을 확인한다.
