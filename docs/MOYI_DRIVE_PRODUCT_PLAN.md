# MOYI Drive 제품 기획서

상태: 기획 초안

작성일: 2026-08-07

대상: MOYI Core, MOYI 앱/웹, NenovaWeb, Nenova ERP Connector

## 1. 문서 목적과 결정 상태

이 문서는 현재 Nenova 내부 업무를 유지하면서도 향후 다른 업체가 같은 MOYI 앱·웹·Drive를 사용할 수 있도록 제품 경계를 고정한다. 코드와 운영 DB는 이 문서 작업에서 변경하지 않는다.

### 확정 요구사항

- MOYI Core는 계정, 조직, 테넌트, 권한, Drive, 감사로그의 공통 원장이다.
- Nenova ERP는 선택형 Connector이며 MOYI Core가 `ViewOrder`, `OrderWeek`, `ProdKey`를 직접 알지 않는다.
- MOYI 앱과 웹은 같은 파일 상태와 API 권한 판정을 사용한다.
- 파일 원본과 ERP 업무 데이터는 복제하지 않고 안정적인 외부 참조로 연결한다.
- Nenova 문서 연결키에는 `OrderYear + OrderWeek`를 반드시 포함한다.
- Daemon/자동분류는 후보만 만들고 직원 확인 없이 업무 확정이나 ERP 쓰기를 수행하지 않는다.
- 파일 버전은 불변 원본뿐 아니라 시스템 감지 내용 diff, 사용자 입력 변경 사유, 이전 버전, 복원·확정 상태를 보존한다.
- NenovaWeb과 MOYI 앱은 별도 애플리케이션이며 계정 공유가 증명되기 전에는 identity link 방식으로 연결한다.

### 미확정 사항

- 초기 객체 저장소 사업자와 리전
- 파일별 최대 크기와 테넌트별 용량
- 기본 보존기간, RPO/RTO, 외부 공유 허용 범위
- OCR 공급자, 악성코드 검사 제품, 민감정보 자동분류 수준
- MOYI 계정과 기존 NenovaWeb 계정의 초기 연결 방식
- MOYI 앱의 실제 login, tenant/company, organization, session/device, account deactivation 계약

## 2. 제품 구조와 데이터 경계

```text
MOYI Core
├─ Identity / Session / Device
├─ Tenant / Organization / Membership
├─ Policy / RBAC / ACL
├─ Drive Metadata / Search / Audit
├─ Upload / Preview / Download Gateway
└─ Connector Platform
   └─ Nenova ERP Connector (선택형)

MOYI App / MOYI Web
└─ 동일 MOYI Core API와 정책 판정 사용

NenovaWeb
├─ 기존 ERP 업무 화면 유지
├─ 관련 파일 패널 제공
└─ Connector를 통해 MOYI 파일과 ERP 업무키 연결

nenova.exe / MSSQL
└─ 기존 ERP 원장. MOYI Drive가 복제·수정하지 않음
```

### 역할

| 제품 | 책임 | 금지 |
|---|---|---|
| MOYI Core | 파일, 버전, 권한, 공유, 감사, 검색, 보존 | Nenova 원장 직접 조회·수정 |
| MOYI 앱 | 촬영, 업로드, 임시함, 조회, 미리보기 | 클라이언트 단독 권한 판정 |
| MOYI 웹 | 대량 업로드, 분류, 검색, 관리 | ACL을 우회한 관리자 다운로드 |
| NenovaWeb | ERP 문맥에서 관련 파일 표시 | 파일 원본을 ERP 테이블에 저장 |
| Nenova Connector | ERP 업무키 매핑, 읽기 DTO, 승인된 명령 전달 | MOYI 공통 스키마에 Nenova 필드 강제 |

## 3. 직원 업로드·분류 UX

### 입력 채널

- 모바일 촬영, 사진 선택, PDF/Excel 업로드
- 웹 파일 선택, drag-and-drop, 클립보드 붙여넣기
- 커넥터 또는 자동화 업로드
- 불안정 네트워크용 resumable upload

### 상태 흐름

```text
draft → uploading → uploaded → scanning → classifying → review_required → available
                         ↘ failed       ↘ quarantined
```

1. 업로드 시작 전에 tenant/workspace/folder의 `upload` 권한을 검사한다.
2. 서버가 불투명한 object key와 upload session을 발급한다.
3. 완료 요청에서 크기, 해시, MIME, magic bytes를 검증한다.
4. 악성코드·압축폭탄 검사를 통과하기 전 다운로드와 공유를 차단한다.
5. OCR과 분류기가 문서유형, 연도, 차수, 거래처, 품목, 농장, 담당자 후보를 만든다.
6. 직원이 원문 근거와 confidence를 확인해 분류를 확정한다.
7. 분류 오류는 재분류하며 기존 값은 audit trail에 남긴다.

### 자동 폴더와 수동 이동

- 정책이 확정한 업무 폴더가 있으면 자동 배치한다.
- 직원이 명시적으로 선택한 폴더는 자동 분류보다 우선한다.
- 분류 변경이 곧 물리적 이동을 의미하지 않게 `category/metadata`와 `folder`를 분리한다.
- 대량 처리도 파일별 성공·실패를 반환하고 전체 성공으로 오인하지 않는다.

## 4. NenovaWeb Drive UI

### 공통 화면

- 좌측: workspace와 folder tree
- 상단: 통합 검색, 차수·업무·문서종류·담당자·상태 필터
- 본문: 최근 파일, 미분류함, 내 업로드, 공유됨, 휴지통
- 우측 패널: 미리보기, metadata, 태그, 권한, 버전, 감사 이력
- 업무 화면: 현재 ERP 업무키와 연결된 파일 패널

### 역할별 차이

| 사용자 | 기본 시작 화면 | 강조 기능 |
|---|---|---|
| 관리자 | 정책·격리·실패·감사 대시보드 | 권한, 보존, 사고 대응 |
| 조직관리자/팀장 | 부서 파일과 미분류함 | 분류 승인, 담당자 배정 |
| 수입부 | 입고·통관·농장 문서 | 연도/차수/농장 필터 |
| 영업부 | 거래처·견적·출고 문서 | 거래처/품목/차수 필터 |
| 일반직원 | 내 업로드와 공유 파일 | 빠른 업로드·재시도 |

### 성능 기준

- cursor pagination을 사용하고 offset 기반 대규모 탐색을 피한다.
- 100행 이상 목록은 가상 스크롤을 적용한다.
- metadata 검색은 tenant-scoped 검색 인덱스를 사용하되 API가 파일별 권한을 최종 재검증한다.
- 썸네일과 미리보기는 비동기로 생성하고 원본 다운로드 권한과 분리한다.

## 5. 동기화와 충돌

- MOYI Core의 file/version/permission 상태가 단일 원천이다.
- 앱·웹은 변경 이벤트 또는 cursor sync로 동일 상태를 받는다.
- 클라이언트 명령에는 `expectedVersion`을 포함하고 불일치 시 409를 반환한다.
- 재시도는 같은 idempotency key를 사용한다.
- 앱 오프라인 임시함은 로컬 암호화하고 사용자·tenant·device에 바인딩한다.
- 권한 철회, 계정 잠금, 기기 분실 시 다음 동기화에서 캐시를 폐기한다.

## 5.1 버전과 내용 diff

- 제목·파일명·폴더·권한만 바뀌면 `METADATA_ONLY`이며 콘텐츠 버전을 새로 만들지 않는다.
- 바이너리와 정규화 내용이 같으면 `CONTENT_UNCHANGED`로 기록한다.
- Excel 셀, Word 문단·표, PDF 페이지·텍스트·이미지, 이미지 hash·해상도의 실제 변경은 `CONTENT_CHANGED`와 형식별 요약을 저장한다.
- 지원하지 않는 형식은 hash 비교만 하고 `BINARY_CHANGED_DIFF_UNSUPPORTED`로 표시한다.
- 시스템 감지 결과와 사용자가 입력한 변경 사유는 별도 엔터티와 audit event로 보존한다.
- 상세 모델과 예시는 [MOYI Drive 데이터 모델](MOYI_DRIVE_DATA_MODEL.md), 계정 구조조사는 [애플리케이션·Identity 구조조사](MOYI_DRIVE_IDENTITY_APP_INVESTIGATION.md)를 따른다.

## 6. 운영과 감사

감사 대상은 업로드, 분류, metadata 변경, 이동, 새 버전, 미리보기, 다운로드, 공유, 권한 변경, 삭제, 복구, 보존 예외다. 감사와 보안 로그는 애플리케이션 로그와 분리한다. OWASP도 보안 이벤트의 일관된 애플리케이션 로그와 감사 trail을 권고한다([OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)).

관리자 대시보드에는 다음을 표시한다.

- 미분류·검사 실패·격리 파일
- 만료 예정 공유와 보존 파일
- 권한 위반 시도와 대량 다운로드
- Connector 동기화 지연과 dead-letter
- 파일별 접근·다운로드·공유 이력

## 7. 사고 대응

1. 공유 링크와 signed URL 신규 발급 중단
2. 사용자 session/device/connector credential 철회
3. 대상 파일과 관련 버전 격리
4. 감사 이벤트와 저장소 접근 로그 보존
5. tenant·사용자·영향 파일 범위 산정
6. 승인된 통지·회수·복구 절차 실행
7. 정책과 탐지 규칙 보완 후 사후 검토

NIST CSF 2.0의 GOVERN, IDENTIFY, PROTECT, DETECT, RESPOND, RECOVER 기능을 운영 체크리스트의 상위 구조로 사용한다([NIST CSF 2.0](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=957258)).

## 8. 근거와 적용 이유

- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html): allowlist, MIME 비신뢰, 파일명 재생성, 크기 제한, webroot 밖 저장, 악성코드 검사, CSRF 방어에 적용.
- [OWASP ASVS 안내](https://devguide.owasp.org/en/11-security-gap-analysis/01-guides/02-asvs/): Access Control, Cryptography, Data Protection, Files, API 검증 항목을 acceptance criteria로 사용.
- [NIST SP 800-53 Rev.5](https://doi.org/10.6028/NIST.SP.800-53r5): AC, AU, IA, MP, SC, CP, IR 통제군을 정책 추적표에 매핑.
- [AWS multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html): 부분 재시도와 pause/resume 설계 근거.
- [Google Cloud resumable uploads](https://docs.cloud.google.com/storage/docs/resumable-uploads): 불안정 네트워크 재개와 완료 시 무결성 검증 근거.
- [Azure user delegation SAS](https://learn.microsoft.com/azure/storage/blobs/storage-blob-user-delegation-sas-create-dotnet): 계정 키보다 사용자 위임형 단기 접근을 우선하는 근거.
