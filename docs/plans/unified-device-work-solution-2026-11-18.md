# 네노바 멀티 디바이스 작업화 통합 솔루션 마스터 설계서 (5-Surface Suite)

- **작성일**: 2026-11-18
- **대상 범위**: `Phone Harness` · `Device Hub` · `Nenova Kakao` · `데스크톱앱(Electron)` · `네노바웹 ERP` & `NOWLINK/MOYI` 상용 패키지
- **기반 설계서**: 세션 1(`phone-harness`/`VKCOM/devicehub`), 세션 2(`nenovakakao` 이중화), 세션 3(Electron 로컬 디바이스 브릿지), 세션 4(네노바웹 스키마·상용 패키지) 통합

---

## 1. 5-Surface 통합 작업화 아키텍처 개요

현장의 모바일 단말(위챗·창고 카메라·SMS/푸시)과 PC 카카오톡의 비정형 업무 데이터를 **절대 Tier 1 ERP 원장에 직접 쓰지 않고**, 중앙 스테이징 큐(`WebDeviceWorkQueue`)와 사람 검수·승인 게이트를 거쳐 안전하게 전산 원장에 반영하는 5계층(5-Surface) 폐루프 구조다.

```text
[Surface 1: 현장 · 메신저 수집면]
  • Phone Harness (Android 11~14 공용폰: 위챗 해외농장방 · 창고 촬영폰 · 알림폰, Read-Only)
  • Nenova Kakao (PC 카톡: 영업방 · 수입방 · 수입불량방 · 현장 추가취소방)
        │
        ▼  (USB/Wi-Fi ADB · Dual-Path dedup_key 병합)
[Surface 2: 로컬 브릿지 & 기기 허브]
  • Device Hub (VKCOM/devicehub: 30~40fps minicap/minitouch · Lease 독점 잠금 · remoteConnectUrl)
  • 데스크톱앱 사이드카 (nenova-device-sidecar.exe + 아웃바운드 WSS 역터널 · [data-device-draft] 전달)
        │
        ▼  (정규화 이벤트 · 이미지/라벨 Pull)
[Surface 3: 지능형 오케스트레이터 (Hermes)]
  • hermes-manager.js + RapidOCR/VLM + shadow.js 기대값 대조 + 4대 자가발전 루프
  • CustKey / ProdKey / OutUnit(박스·단·송이) 매칭 → DRAFT 초안 생성
        │
        ▼  (Tier 3 실시간 JSON + Tier 2 MSSQL 스테이징)
[Surface 4: 네노바웹 관제 · 검수 · 승인 UI (/my-work)]
  • Tier 3: data/runtime/device-hub-status.json (실시간 단말 상태 · WAITING_HUMAN 개입 링크)
  • Tier 2: WebDeviceNode · WebDeviceLease · WebDeviceWorkQueue (DRAFT → APPROVED)
        │
        ▼  (ApprovedBy <> ProposedBy & ExpectedSnapshotJson 검증 통과 시에만 실행)
[Surface 5: 공유 MSSQL ERP 원장 (Tier 1 · 시스템 오브 레코드)]
  • OrderMaster / OrderDetail · WebSalesDefectDeduction → Estimate · Warehouse*
```

### Surface별 역할 및 신뢰 경계

| Surface | 핵심 주체 | 통신 및 인증 | 핵심 책임 |
|---|---|---|---|
| **1. 수집면** | `Phone Harness` + `Nenova Kakao` | USB/Wi-Fi ADB, Windows UIA | 비정형 텍스트·사진·라벨 원문 확보(모바일은 읽기 전용) |
| **2. 허브/브릿지** | `Device Hub` + `데스크톱 사이드카` | `remoteConnectUrl`, `127.0.0.1` + 32B Bearer, 아웃바운드 WSS | Lease 독점 잠금, 30~40fps 원격 개입, 제로 포트포워딩 릴레이 |
| **3. 오케스트레이션** | `Hermes` (`hermes-manager.js`) | Service Token, `shadow.js` | 품목/거래처/3단위 환산, 기대값 검증, `SKILL.md` 학습 |
| **4. 웹 관제·승인** | `네노바웹` (`/my-work`, `/sales/defect-deductions`) | `withAuth` JWT, `RowVersionNo` | 기기 원격 개입, 초안 비교·수정·승인, 감사 이력 기록 |
| **5. ERP 원장** | `MSSQL` (`Order*`, `Shipment*`, `Estimate`) | `BEGIN TRAN` + `UPDLOCK, HOLDLOCK` | `safeNextKey()` 채번, 409 충돌 방어, 사후 재조회 영수증 |

---

## 2. 부류 1~4 핵심 기술 결정 요약

### 부류 1 · Phone Harness & Device Hub (`VKCOM/devicehub` + `phone-harness`)
- **역할 분담**: `VKCOM/devicehub`(MongoDB + ZeroMQ + `minicap`/`minitouch`)가 기기 풀·배터리·30~40fps 웹 미러링·독점 Lease(`POST /api/v1/devices/{serial}/use`)·`remoteConnectUrl`을 담당하고, `phone-harness`가 `ANDROID_SERIAL=<remoteConnectUrl>`로 접속해 `uiautomator dump` 및 `screencap`/`adb pull`을 수행한다.
- **Windows 환경 표준화**: macOS 전용 `ocr.py`/`iOS Mirroring` 대신 **Android 11~14 보급형 공용폰**으로 표준화한다. Windows Docker(WSL2)의 USB 패스스루 제약은 ① Windows 호스트 `adb` + `host.docker.internal:5037` 또는 ② 사무실 소형 리눅스 Edge Box로 해결하며, 트리가 비어 있는 위챗 단가표·박스 라벨 이미지는 **로컬 RapidOCR / 멀티모달 VLM**으로 보완한다.
- **Human-in-the-Loop (`WAITING_HUMAN`)**: `FLAG_SECURE`, 보안키패드, 잠금화면, 위챗 슬라이더/QR 감지 시 에이전트가 즉시 Lease를 반납하고 알림을 전송한다. 담당자가 웹 브라우저에서 30~40fps 화면으로 10초 내 직접 해제 후 Release하면 에이전트가 재개한다.

### 부류 2 · Nenova Kakao & 메신저 이중화 (`nenovakakao` + `mindmap-viewer`)
- **Dual-Path 수집 + Single-Master 발송**: 수집(Inbound)은 PC `nenovakakao`와 모바일 공기계 `Phone Harness`가 Active-Active로 이중화해 PC 잠금·창 가림·18시 사진 서랍(12장 제한) 병목을 해소하고, 발송(Outbound)은 `send_limits.json`·`verify_open_room` 가드가 검증된 **PC 단일 마스터**만 유지한다.
- **결정론적 중복 제거 (`dedup_key`)**: PC와 모바일의 동일 메시지 중복 적재를 막기 위해 `kakao_messages`에 아래 계약 키와 유니크 인덱스(`uq_kakao_messages_dedup_key`)를 도입한다.
  - `dedup_key = sha256(norm_room | norm_sender | minute_bucket(KST) | body_hash | occurrence_index)`
  - `ON CONFLICT (dedup_key) DO UPDATE` 및 ±1분 Soft Dedup으로 PC가 먼저 수집한 텍스트 행에 모바일이 즉시 확보한 고해상도 원본 사진(`media_urls`)만 무중복 병합한다.
- **업무 직결 3대 흐름**:
  1. **수입방·위챗 발주/취소 원문**: `/incoming/kakao-summary` DB 구조화 피드 + 차수·품목군 대조(Read-Only).
  2. **불량/파손 사진 + 원문**: 검토 대기열(`PENDING_REVIEW`) 적재 → 작성자 카톡 승인 또는 웹 검토 후 `WebSalesDefectDeduction(DRAFT)` 저장.
  3. **09:00 일일 보고(`send_report.py`)**: 모바일 브릿지 요약 줄 추가 시에도 `--dry-run` 및 발송 전 승인 게이트(`KAKAO_REPORT_REQUIRE_APPROVAL`) 준수.

### 부류 3 · 데스크톱앱 로컬 디바이스 브릿지 (`Electron` + 선택형 사이드카)
- **ASAR/Fuses 준수 아키텍처**: `onlyLoadAppFromAsar: true` 및 `runAsNode: false` 보안 제약 때문에 `adb.exe`와 `scrcpy`는 `app.asar` 외부의 **선택형 사이드카(`nenova-device-sidecar.exe`)**로 분리한다. 일반 사무직 PC에는 배포하지 않아 설치 용량과 시작 속도에 영향이 0이다.
- **제로 포트포워딩 아웃바운드 역터널**: 사이드카가 USB(`host:track-devices`) 및 동일 사내 Wi-Fi(`_adb-tls-connect._tcp` mDNS + ECDSA 챌린지) 단말을 자동 감지하면, `main.cjs`(`device-bridge-host.cjs`)가 `127.0.0.1` 루프백 + 32B Bearer 토큰 + `icacls` ACL로 통신한 뒤 `wss://nenovaweb.com/api/device-hub/tunnel` 아웃바운드 역터널로 중계한다. `lockAccount()` 시 터널을 즉시 절단한다.
- **해시 무변경 홈 UI & 안전 초안 전달**: 가이드 영상 해시 정책(`shell.js:434`)을 지키기 위해 `shell.css`·`index.html` 수정 없이 `#pmLivePanel` 하단에 기기 상태 카드를 동적 마운트한다. 현장 촬영본·위챗 텍스트는 `?draftId=` URL 핸드오프 또는 활성 탭 `[data-device-draft]` 초안 슬롯에 **입력까지만** 주입하며 저장 버튼은 절대 누르지 않는다.

### 부류 4 · 네노바웹 스키마 & 실제 품목 E2E 흐름 (`Tier 2 Web*` + `Tier 3 JSON`)
- **Tier 2 신규 MSSQL 스키마 (`dbo.WebDevice*`, 사전 마이그레이션 필수 · GET DDL 금지)**:

| 테이블 | 핵심 키 · 제약 | 주요 역할 |
|---|---|---|
| `dbo.WebDeviceNode` | `DeviceNodeKey` PK, `UQ(WorkspaceId, DeviceId)` | 단말 신원, `AllowedAppsJson`, `ForbiddenTextJson`, `ReadOnlyEnforced=1` |
| `dbo.WebDeviceLease` | `LeaseKey` PK, `UX_WebDeviceLease_ActiveDevice` | 기기당 `ACTIVE` Lease 1건만 허용(TTL 120~300초 · Force Kick 지원) |
| `dbo.WebDeviceWorkQueue` | `QueueKey` PK, `UQ(WorkspaceId, IdempotencyKey)` | `DRAFT → REVIEW_REQUIRED → APPROVED → APPLIED` 스테이징(`FAILED_UNKNOWN` 동결) |

- **Tier 3 런타임 피드**: `data/runtime/device-hub-status.json` (`workFeatureData.js` `.tmp → renameSync` 원자 교체, 2MB 상한)으로 MSSQL 폴링 부하 없이 `/my-work` 및 데스크톱 홈에 실시간 상태를 공급한다.

#### 실제 품목 기반 E2E 데이터 궤적 (2대 대표 시나리오)
1. **위챗 추가 발주 (`콜롬비아 장미 프리덤 50cm`)**
   - **수집·잠금**: 위챗 공용폰(`dev-ph-wechat-01`)에서 `"아이엠 미우 46-01차 프리덤 50cm 5박스 추가"` 수신 → `WebDeviceLease` 획득 후 `IdempotencyKey` 부여.
   - **매칭·모의검증**: `Hermes`가 `CustKey=305(아이엠(미우))` · `ProdKey=1042(OutUnit='단', BunchOf1Box=20)` 환산(`Box=5, Bunch=100, Steam=2500, OutQuantity=100`) 후 `shadow.js`로 기존 `46-01차` 주문(40단) 스냅샷(`ExpectedSnapshotJson`) 검증.
   - **승인·원장 반영**: `WebDeviceWorkQueue(DRAFT)` → 담당자 승인(`ApprovedBy <> ProposedBy`) → `OrderDetail` 100단 누적(`140단`) + `ReceiptJson` 독립 재조회 확인(`APPLIED`).
2. **창고 현장 불량 클레임 (`네덜란드 수국 매지컬 그린`)**
   - **사진 Pull·OCR**: 창고 촬영폰(`dev-wh-cam-02`)에서 박스 라벨 `"MAGICAL GREEN / 30 STEMS / I.M"` + `"15송이 파손"` 촬영본 `adb pull` → `ProdKey=2218(OutUnit='송이')`, `ShipmentKey=7071` 출고분 대조.
   - **2단계 스테이징·차감**: `WebDeviceWorkQueue(REVIEW_REQUIRED)` → 1차 승인 시 `WebSalesDefectDeduction(DRAFT, SourceUnit='스팀(대)', Quantity=15)` 적재 → 수입부 원가·전산등록 확정 시 `Estimate` 음수(`-15`) 차감.

---

## 3. 절대 안전 가드 & `NOWLINK / MOYI` 상용 패키지 4단계 로드맵

### 3.1 4대 절대 안전 가드 (Non-Negotiables)
1. **1대 카나리(Canary) 원칙**: 신규 단말·채널 워크플로우는 반드시 테스트 서브폰 1대에 먼저 연결해 48~72시간 검증 후 확대한다.
2. **읽기 전용 하네스 & 3중 제어 잠금**: 모바일 `Phone Harness`는 허용 패키지 화이트리스트, 고위험 텍스트 킬스위치(`송금/이체/결제/출금/전송/보내기/삭제/Pay/Transfer`), 독점 Lease(`UX_WebDeviceLease_ActiveDevice`)로 발송·결제를 원천 차단한다.
3. **발송 · 원장 반영 사람 승인 필수**: 카톡 Outbound는 검증된 PC `nenovakakao`만 수행하며, ERP 원장 반영은 `ApprovedBy <> ProposedBy`, `ExpectedSnapshotJson` 대조, `FAILED_UNKNOWN` 재전송 차단을 통과한 건만 실행한다.
4. **개인방 수집 금지**: `APPROVED_ROOM_WHITELIST`에 등록된 지정 업무방(영업방·수입방·수입불량방 등) 외 개인 1:1방·가족방은 목록 스캔 단계에서 즉시 스킵한다.

### 3.2 `NOWLINK / MOYI` 상용 패키지 구성 (업종 이식 모델)
- **3단 모듈 + Device Add-on**:
  - `나우링크 Watch`: `MOYI FDE` 기반 PC 수집·대시보드 및 읽기/스냅샷형 자동화.
  - `나우링크 Build`: 코어 웹 ERP 템플릿(견적·입고·원가·차수보드) + 데스크톱 업무앱 + `WebDeviceWorkQueue` 승인형 원장 반영.
  - `나우링크 Team`: `MOYI` 메신저(`talkhub`) 승인 카드 + `카톡/메신저` 이중화 브릿지 + RACI 핸드오프.
  - `+ Device Hub Add-on`: 사전 세팅 Edge Box(또는 Windows ADB 브릿지) + 보급형 Android 1~3대 + 30~40fps 원격 개입(`WAITING_HUMAN`).
- **업종 치환(`mapping.json`)**: 화훼(`국가·농장 / 박스·단·송이 / 주간 차수`) 모델을 식자재·청과(`원산지·공급처 / 박스·팩·EA`), 직수입 도매(`수출사·BL / 케이스·병·kg`), 의약·화장품(`제조사·로트 / 카톤·이너·개`)으로 코드 변경 없이 이식한다.
- **표준 온보딩 7단계**: 워크스페이스·`nowlink_consents` 개설 → `mapping.json` 3회차 불일치 0 검증 → 서명 데스크톱 앱 배포 → Edge Box/공용폰 연결 → 카나리 1대 48~72시간 관제 → 승인 인박스·`WAITING_HUMAN` 10분 실습 → `Hermes` `SKILL.md` 폐루프 가동.

### 3.3 4단계 도입 로드맵

| 단계 | 핵심 목표 | 주요 산출물 · 실행 내용 | 완료 게이트 |
|---|---|---|---|
| **Phase 1**<br>읽기 · 관제 파일럿 | 원장 쓰기 0건으로 기기 풀 가시화 및 원격 개입 확립 | `WebDeviceNode/Lease` 마이그레이션, `device-hub-status.json` 연동, 카나리 1대 연결, `/my-work`·데스크톱 카드 표시 | Lease 충돌 방지 · Force Kick 100%, `WAITING_HUMAN` 30fps 원격 해제, 72시간 무장애 |
| **Phase 2**<br>초안 생성 · 모의검증 | 비정형 수집물을 `DRAFT` 큐로 구조화 및 기대값 대조 | `WebDeviceWorkQueue` 구축, `dedup_key` 병합, `Hermes`+OCR/VLM 매칭, `shadow.js` 대조 및 검수 인박스 시범 가동 | `OrderDetail` 3단위 환산 불일치 0, `IdempotencyKey` 중복 적재 0, 소요시간 실측 |
| **Phase 3**<br>승인형 원장 반영 · 폐루프 | 사람 승인 건만 ERP 원장 원자 반영 및 `SKILL.md` 학습 | `APPROVED → APPLIED` 어댑터(`safeNextKey`, `409` 방어, `ReceiptJson`), `WebSalesDefectDeduction` 연계, `Hermes` 학습 순환 | 승인자 분리·409 방어 100%, 실전 20건+ `nenova.exe` 합계 일치, 재조회 영수증 검증 |
| **Phase 4**<br>상용 패키지(`NOWLINK/MOYI`) | `workspace_id` 테넌트 격리 및 업종별 패키지 출시 | `Watch / Build / Team + Device Add-on` 모듈 패키징, 업종별 `mapping.json` 3종, 코드서명 설치기·Edge Box 킷 | 테넌트 교차 노출 0건, 10분 내 온보딩, `mapping.json` 교체만으로 타 업종 E2E 구동 |

---

## 4. 미검증 위험 항목 (후속 구현·배포 시 실측 필수)
- Windows 호스트 `adb` 브릿지 vs 리눅스 Mini-PC Edge Box 간 72시간 이상 USB 재연결 안정성 및 `minicap` 다중 스트림 CPU/대역폭 부하(**미검증**).
- 저조도·구겨진 창고 박스 라벨 및 위챗 단가표 이미지에 대한 Windows 로컬 RapidOCR + 멀티모달 VLM 정확도 및 월간 API 실원가(**미검증**).
- `NOWLINK/MOYI` 외부 출시 선결 항목(코드서명 OV/EV 인증서, `MOYI-FDE-Setup.exe` Inno 빌드, `talkhub` 승인 왕복, 과금/DPA)(**미검증/미구현**).
