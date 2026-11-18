# 사장님 상용 솔루션 마스터 목표 & 현실적 가능·불가능 정본

> **작성일**: 2026-11-18  
> **정본 범위**: `nenova-pm/product-vision/` · `nowlink/docs/` · `mindmap-viewer/docs/` · `nenova-erp-ui/docs/` · `~/.claude/` 과거 작업·대화 기록 전수 통합  
> **관련 UI**: 네노바웹 [/my-work?tab=arch](/my-work?tab=arch) (`components/pm/ArchFlowChart.js` · `data-testid="arch-vision-feasibility"`) · 데스크톱앱 `v1.3.40` 「흐름도」  
> **보안·원칙**: 자격증명·계좌번호·개인정보 미포함 · 미검증 항목 명시 · `ECOUNT` 조회 전용 · `Tier 1` ERP 원장 무단 쓰기 금지

---

## Part 1. 사장님 상용 솔루션 마스터 목표 체계

### 1.1 핵심 한 줄 비전과 이중 고객 구조 (`product-vision/PLAN.md`)
- **제품 한 줄 정의**: *"일하는 모습이 그대로 기록되고, 그 기록이 내 능력 증명과 자동화가 되는 게임형 가상 사무실."*
- **이중 고객 분리 원칙 (지침 2)**:
  - **회사 (유료 구독 고객)**: 사업 흐름 9단계 관제(발주→입고→분배→현장출고→견적→전달→입금→해외송금→이익) · 승인형 자동화 · 라이브 매뉴얼 · 팀 집계를 구독 구매.
  - **직원 (무료 소유 고객)**: 업무 프로필 · 3D 캐릭터 · 업종 커뮤니티는 **무료이며 본인 소유(퇴사/이직 시 지참 가능)**. 이직한 회사에서 자연스럽게 도입을 권하는 영업 고리 형성.
  - **1차 타깃**: 직원 5~50명 규모 중소 수입·유통·무역 기업(네노바 = 화훼 수입·유통 1호 레퍼런스).
- **운영 지침 7원칙**: ① 관문 통과 전 다음 단계 착수 금지 ② 회사/직원 고객 분리 ③ 거래 대상은 원본 데이터가 아닌 검증된 절차·자동화 레시피만 ④ 익명은 회사 뒷담이 아닌 회사 식별 차단 업종 동료 라운지 ⑤ 전 기능 멀티테넌트(`workspace_id`) 전제 ⑥ 수집 데이터는 급여·인사평가에 사용하지 않음을 제품·동의서에 명문화 ⑦ 모든 수치에 측정 근거 병기.

### 1.2 5대 플랫폼 역할 매핑 (`PLAN.md §2`)
| 역할 | 정체성 | 현재 확보 씨앗 | 상용화 잔여 요건 | 배치 단계 |
|---|---|---|---|---|
| **1. 업종 동료 익명 라운지** | 회사 식별이 시스템적으로 차단된 직무별 동료 커뮤니티 | `/pm` 게시판(`agent-board`), `tech-radar` | 실명/익명 계정 분리, 회사명·단가 마스킹, 모더레이션 | **P2** |
| **2. 실명 능력 레퍼런스 (링크드인형)** | 자칭이 아닌 Orbit 관찰·검증 기반 직원 소유 경력 증명 | `mind view map`, 캐릭터/스킬, 신입 루틴 | 공개 프로필 페이지, 본인 제공 승인, 퇴사 이관 체계, 어뷰징 탐지 | **P2** |
| **3. 검증 절차 공개 (GitHub형)** | 실제 업무 수행 기록에서 추출한 SOP 절차서 공개 | 라이브 매뉴얼(60건/10명), `solution-miner`, `97 SKILL.md` | 민감정보 자동 마스킹, 포크/버전 관리 | **P2~P3** |
| **4. 레시피 거래소** | 원본 데이터 제외, 검증된 절차서·실행 레시피만 거래 | 골 파이프라인(`exec-path`), 분석 장기보관소 | 타사 환경 재생 패키징, 정산·법무 검토 | **P3** |
| **5. 글로벌 AI 번역 라운지** | 아바타 오두막에서 업종·직무 동료와 실시간 AI 번역 협업 | `talkhub`(MOYI 채팅) 인프라, 3D PM 오두막 4개 | 주제방/1:1 매칭, 국내 데이터 거주(국외엔 번역 대화·레시피만) | **P2** |

### 1.3 단계별 상용 관문(Gate P0~P3) 및 상품 티어(`NOWLINK`)

#### 4단계 순차 관문 (`PLAN.md §2`)
| 단계 | 핵심 내용 | 통과 관문 기준 (측정 근거) | 현재 상태 (2026-11-18 기준) |
|---|---|---|---|
| **P0 · 사내 완성** | `/pm` · 보상 루프 · 라이브 매뉴얼 · 9단계 파이프라인 사내 정착 | **직원 70% 이상 주 2회 이상 자발 접속, 4주 연속** (`/api/pm/visits`) | 측정 3주차: W45 **27%** · W46 **0%** · W47 **55%** (미달성, 진행 중) |
| **P1 · 파트너 멀티테넌트** | `nowlink` 테넌트·동의·승인 게이트 기반 외부 2~3개사 유료 입주 | **유료 2개사 3개월 연속 유지(해지 0) + 보안 사고 0건** | 기반 구축 중 (`tenant-guard` 968/998, 서명 설치기·과금 미완) |
| **P2 · 글로벌 커뮤니티** | 업종 라운지 + 실명 프로필 공개 + AI 번역 브레인스토밍 | 예: 외부 비고객 직원 100명 + 주간 라운지 30세션 (P1 말 확정) | 라운지 PoC(`g10`) 사장님 승인 대기 |
| **P3 · 레시피 거래소** | 검증 SOP·자동화 레시피 마켓 개설 (법무 검토 선행) | 예: 유료 레시피 거래 10건 + 분쟁 0건 (P2 말 확정) | 미착수 (후순위) |

#### 상용 패키지 3티어 + Add-on (`nowlink/docs/NOWLINK_PRODUCT_PLAN.md`, `unified-device-work-solution-2026-11-18.md`)
| 티어 | 포함 기능 | 가격 모델(가정/제안값) | 현재 준비도 · 잔여 |
|---|---|---|---|
| **① 나우링크 Watch** | `MOYI FDE` 설치, 본인 대시보드(`/my-work`), 동의자 뷰, `G0~G3` 스냅샷 자동화, AI 질문 코치 | 회사 기본 5만/월 + PC당 1.9만/월 *(미검증 가정)* | 코치·자동화 실행계층(`jest 226/226`) 구현; 서명 설치기·셀프 동의 UI·원가 실측 미완 |
| **② 나우링크 Build** | ① + 표준 ERP 템플릿(견적·입고/도착원가·차수보드) + 데스크톱앱 + `WebDeviceWorkQueue` 승인 반영 | 기본 15만/월 + PC당 4.9만/월 + 구축비 *(미검증 가정)* | 네노바웹·`mapping.json` 구조화 완료; 타사 매핑 GUI·실환경 E2E 0건 |
| **③ 나우링크 Team** | ② + `MOYI` 메신저(`talkhub`) 승인 카드·업무카드 + 카톡 브릿지 + RACI 핸드오프 | 기본 20만/월 + PC당 6.9만/월(앱 무제한) *(미검증 가정)* | `talkhub` 앱/MCP 존재; SSO·승인 콜백 왕복 실증 미완 |
| **+ Device Hub Add-on** | Edge Box(또는 Windows Host ADB) + Android 11~14 공용폰 1~3대 + 30~40fps `WAITING_HUMAN` | 제안 2.9만/기기/월 *(미검증 가정)* | 5-Surface 마스터 설계 완료; 카나리 1대 72h 실증 미착수 |

> **업종 치환 전략 (`mapping.json` · `ArchFlowChart.js`)**: 화훼 도매(국가·농장 / 박스·단·송이 / 주간 차수)를 `mapping.json` 설정 교체만으로 **식자재·청과**(원산지·공급사 / 박스·팩·EA), **직수입 도매**(수출사·BL / 케이스·병·kg), **의약·화장품**(제조사·로트 / 카톤·이너·개)에 이식.

### 1.4 기술 아키텍처 핵심 6대 기둥 (2026-11-18 기준)
1. **3계층 데이터 분리 (`ArchFlowChart.js`)**: Tier 1 공유 MSSQL ERP 원장(`Order*`·`Shipment*`·`Warehouse*`·`Estimate`, `dnSpy` 일치 필수) / Tier 2 웹 전용 `Web*` 스키마(`assertWebSchemaContract`, GET DDL 금지) / Tier 3 런타임 JSON(`data/runtime/*.json`, `.tmp → renameSync` 원자 교체).
2. **4대 자가발전 루프 (`LOOPS`)**: ① 데이터 디테일 자가발전(`adoption-ledger`) ② 실시간 로그 관제·자가치유 ③ 연속 파이프라인 압축(인보이스→입고→원가→공유) ④ 왕복 우회동작(A→B→A) 흡수(분배 입력 시 미등록 주문 Upsert).
3. **Hermes 에이전트 오케스트레이터 (`nenova-pm/hermes-manager.js`)**: `Claude ↔ Codex` 쿼터 폴백, `Session Rescue` JSONL 인계, `Trajectory Compressor`(Head/Tail 보존), `97/97` 학습카드 → `SKILL.md` 자동 합성(`73ms`), `Phase-Lease` 20분 정체 회수.
4. **Rust 고효율 핫패스 + JS Fallback (`hermes-core.exe` · `nenova-device-sidecar.exe`)**: 상주 사이드카·대용량 스풀 압축·대량 SHA-256 해싱·`pHash` 프레임 필터만 단일 정적 Rust 바이너리로 전환하고, 일반 웹 UI·SQL API는 `JS/TS` 유지.
5. **5-Surface 멀티 디바이스 작업화 (`docs/plans/unified-device-work-solution-2026-11-18.md`)**: 현장 수집(`Phone Harness`/`Nenova Kakao`) → 허브/Rust 사이드카 → `Hermes` 매칭 → `WebDeviceWorkQueue` 승인 게이트 → ERP 원장 반영.
6. **네노바 데스크톱앱 동시 연결 원칙 (2026-11-18 지정)**: 모든 네노바웹 신규 기능은 `components/Layout.js` 카탈로그 · `desktop/menu.json` · 홈 바로가기(`desktop/shell/shell.js` `v1.3.40`)까지 연결해 앱 안에서 즉시 탐색·실행.

### 1.5 현재 달성 상태 & 정직한 측정 지표 (`goals.json` `g01~g16`)
| 구분 | 목표 ID / 영역 | 현재 수치 · 실측 근거 | 미검증 / 남은 갭 |
|---|---|---|---|
| **사내 정착 게이트** | `g01` `/pm` 접속 측정 (`gate-p0`) | 3주 데이터 축적 (`W45 27% · W46 0% · W47 55%`), 진행 `85%` | 4주 연속 `70%` 미달성 |
| **보상·매뉴얼·문서(기존)** | `g02~g10` (`PLAN.md §6`) | `g02` 10%(반자동 4구간 점검표), `g03` 0%, `g04~g09` 정체(`0%`), `g10` 라운지 승인대기 | 서버 `pm-grow-state` 실측·마스터 산출물 미작성 |
| **Hermes 오케스트레이션** | `g11` (`hermes-manager.js`) | **완료(100%)** — `97/97 SKILL.md` `73ms` 생성, 워커 로그 **91.1%**·조사관 로그 최대 **32.8%** 압축, 폴백 전환 자가시험 통과 | 실제 `quota-hold` 중 `codex.exe` 장기 조사 완결 미검증 |
| **Rust 네이티브 핫패스** | `g12` (`hermes-core.exe`) | **완료(100%)** — 단일 정적 바이너리 **389.5 KB**, `cargo test 7/7`, `vision-spool.log`(27.52MB) **83.70ms**(네이티브 **58.43ms**, `3.04~4.36배` 가속), JS Fallback 100% 일치 | `nenova-device-sidecar.exe` 실빌드·10,000건 이상 파일 배치 운영 적용 미착수 |
| **웹 아키텍처 & 데스크톱** | `g13` (`ArchFlowChart` · `suite-sim` · `Desktop v1.3.40`) | **완료(100%)** — PR #1832·#1835·#1837·#1839·#1840 머지, Electron `smoke 72/72` 통과 | 운영 배포 후 실PC 설치·라이브 토큰 화면 검증 미검증 |
| **모바일·카톡 Dual-Path** | `g14` (`Phone Harness` + `Device Hub`) | **진행(20%)** — 5-Surface 마스터 설계서 · Tier 2 `WebDevice*` 스키마 확정 | 공용폰 1대 72h 카나리·`WebDevice*` MSSQL 마이그레이션 미착수(승인 필요) |
| **상용 패키지 (`NOWLINK`)** | `g15` (`nowlink`) | **진행(40%)** — 테넌트 가드 **968/998** 라우트, 교차접근 테스트 **60/60**, 자동화 실행계층 **226/226** | 코드서명 인증서(Trusted Signing/OV), 클린 PC 설치, 과금/DPA, `app.nowlink.kr` DNS, 라이브 `approve-run` 미완 (`AGENT_GAP_AUDIT` 평균 `2.2/5` → 실행 보강 중) |
| **정본 목표·가능/불가능 매트릭스** | `g16` (본 문서 & `ArchFlowChart.js`) | 전수 발굴 완료 · 정본 문서 & 아키텍처 기준표 구축 및 검증 중 | PR 머지 후 운영 `/my-work?tab=arch` 실브라우저 확인 |

---

## Part 2. 작업·대화 데이터 전수 발굴 — 「현실적 가능 vs 조건부 가능 vs 불가능·절대 금지」 판정표

> 과거 Claude·Codex·Antigravity 대화, `nenova-erp-ui`, `mindmap-viewer`, `nowlink`, `nenova-pm` 전역 기록에서 실제 장애·실측·결정을 전수 수집해 3단계로 판정했습니다.

### 2.1 현실적으로 즉시 · 자동 가능한 것 (Auto / Immediate)
| 영역 | 작업 · 기능 | 판정 근거 & 실측 수치 | 안전 가드 |
|---|---|---|---|
| **웹 ERP · 엑셀 읽기/모의 검증** | `excel.check` (G0), 네노바웹 DOM/UIA 관찰, `shadow.js` 모의 실행·기대값 대조 | Chrome UIA **4,750/5,210개** 요소 명칭 식별(`orbit-app-readability-uia-hittest.md`), `expectations.js` **75/108 시트** 산술 앵커·ECOUNT 22열 100%, `NOWLINK_AUTO_APPROVE=on` 모의 통과 | 모의 서버 `127.0.0.1` 격리, 원본 파일 SHA-256 불변(`originals.untouched`), `LIVE_WRITE_BLOCKED` 유지 |
| **업무방 메신저 Dual-Path 수집 & 로컬 코치** | PC `nenovakakao` + Android `Phone Harness` 병렬 수신 및 로컬 AI 질문 특징 추출 | `dedup_key` SHA-256 `ON CONFLICT DO UPDATE`로 텍스트·고해상도 사진 무중복 병합(`unified-device-work-solution`), `coach-features.js` 로컬 특징 추출 | `APPROVED_ROOM_WHITELIST` 9개 업무방 한정, 모바일 발송 원천 차단, 비동의 대화 원문 미저장 |
| **Rust 핫패스 압축·해싱 + Hermes 폴백** | 수십 MB 로그 압축·대량 해싱, `Claude↔Codex` 한도 폴백, `SKILL.md` 합성 | `hermes-core.exe`(389.5KB) `3.04~4.36배` 가속 + JS Fallback 내장, 워커 로그 **91.1%** 압축, `97/97 SKILL.md` `73ms` 합성 | `HERMES_DISABLE_RUST=1` 무중단 JS Fallback, 프로바이더 장애 시 JSONL 세션 구조 |
| **웹 전용 `Web*` & 런타임 JSON 스테이징** | 도착원가 리비전·불량 검토·개인 작업기록·PM 관제 피드 저장 | `Tier 2 Web*`(`assertWebSchemaContract`) + `Tier 3 data/runtime/*.json`(`.tmp → renameSync`) 분리 운영 검증 | Tier 1 공유 원장 무변경, GET 경로 런타임 DDL 금지 |
| **하나은행 간편조회 & 바로빌 읽기 API & 유출 감사** | 계좌 빠른조회(`quickService.do`), 바로빌 상태/세금계산서 조회, Drive 유출 이력 원웨이 기록 | 간편조회 보안모듈 게이트 없음(24개월 한도·등록 계좌 한정), `barobill-smoke.mjs` 연결 확인, `egress-monitor` 차단 없이 이력 적재 | 계좌번호·비밀번호 코드 저장 금지(`maskNumber`), `BAROBILL_ALLOW_WRITE` 기본 차단, 유출 뷰 관리자 한정 |
| **Electron ASAR 외부 브릿지 & 안전 초안 전달** | `app.asar` 외부 사이드카 통신, 아웃바운드 WSS 역터널, 웹 `[data-device-draft]` 초안 주입 | `127.0.0.1` + 32B Bearer + `icacls` ACL + 포트포워딩 불필요 WSS 릴레이 설계(`session-03`) | `lockAccount()` 즉시 터널 차단, 저장/확정 버튼 클릭 금지(초안 입력만) |
| **사장님 본인 전용 카톡 보고 (`나에게 보내기`)** | PC 잠금·부재와 무관한 24시간 내 카톡 요약 보고 (`kakao-report-mcp`) | REST API `SELF_MEMO` / `OWNER_QUEUE` 외 수신자 코드 레벨 거부, `dryRun: true` 기본값(`test.js 9/9` 통과) | 1,200자 상한, 타인/고객 오발송 원천 차단, OAuth 1회 설정 후 동작 |
| **산출물 Drive 보관 후 작업트리 정리** | 완료 PR의 `worktree`·임시 캐시 삭제, 문서/가이드 영상 Drive 이관 후 로컬 정리 | `shared-rules.md` PC 최소 저장 원칙 (`cmd /c rmdir` junction 해제 선행) | 활성 Git/빌드 작업은 로컬에서 완결 후 정리(Drive 동기화 폴더 직접 빌드 금지) |

### 2.2 조건부 가능한 것 (Conditional — 사람 승인 · 보조단말 · 공식 계약 · 선행조건 필수)
| 영역 | 작업 · 기능 | 선결 조건 · 제약 원인 | 현실적 우회 · 운영 해법 |
|---|---|---|---|
| **Tier 1 공유 ERP 원장 쓰기** | 주문·분배·입고·견적 확정 반영 (`Order*`, `Shipment*`, `Estimate`) | `nenova.exe`와 동일 MSSQL DB 공유 — 부분확정·음수재고·고스트마스터 충돌 위험(`verify:week`, `dnSpy`) | `WebDeviceWorkQueue` 스테이징 → `ApprovedBy <> ProposedBy` 승인 → `ExpectedSnapshotJson` 대조 → `409` 잠금 → `ReceiptJson` 독립 재조회 |
| **데스크톱 `nenova.exe` 제어 (G5)** | `nenova.exe` (DevExpress WinForms) 화면 자동 클릭·입력 | UIA 클릭 히트테스트 **0/9** (그리드/칸 전부 무명 Pane) · 실행 후 자동 되돌리기 불가(`TERMS_AUTOMATION_NOTE.md`) | 원본 해상도 캡처 + VLM/OmniParser 앵커 판독 + **매 실행 사람 100% 승인**, 가능하면 네노바웹 API(`G1`)로 대체 |
| **모바일 보안화면 · 인증 · 캡차 통과** | 앱 로그인, 금융 가상키패드, `FLAG_SECURE` 화면, 잠금 PIN, 위챗 슬라이더/QR | OS 보안 정책 및 안티봇 차단으로 자동 조작·캡처 불가(흑색 화면 반환) | 에이전트가 즉시 Lease 반납 → **`Device Hub` 30~40fps `WAITING_HUMAN`** 알림 → 담당자 웹 10초 수동 해제 → 재개 |
| **Windows Docker(WSL2) 폰 제어 & OCR** | Docker 컨테이너 안에서 Android USB 연결 및 위챗 단가표 이미지 판독 | WSL2 Docker는 Linux `/dev/bus/usb` 직접 패스스루 불가; `phone-harness ocr.py`는 macOS Apple Vision 전용 | **Windows Host `adb` (`host.docker.internal:5037`)** 또는 리눅스 Mini-PC Edge Box + Windows 로컬 **RapidOCR / 멀티모달 VLM** |
| **법인 계좌 전체 이력 & 세금계산서 발급** | 하나은행 전 기간 조회, 신한 오픈 API, 바로빌 전자세금계산서 실제 발급 | 하나은행 로그인은 CDP/자동화 브라우저에서 보안모듈 4종 미설치 차단; 신한 API(`PR #1033`)는 계약/IP 화이트리스트 필요(주거래=하나은행); 바로빌 쓰기는 공동인증서(-31100)·선불포인트·`BAROBILL_USERID` 필요 | 하나은행 전용 브라우저 세션에 **사장님 1회 OTP/인증서 로그인** 후 세션 연장 루프; 바로빌은 인증서 등록·명시 플래그 활성화 후에만 |
| **상용 `MOYI FDE` 무경고 설치** | 고객사 PC SmartScreen·제3백신(V3/알약) 오탐 없이 설치 | 코드서명 인증서 결제 필요(Azure Trusted Signing 월 ~$9.99 [사업 3년↑] / OV 연 $200~500); 제3백신·은행 보안SW는 예외 등록 공개 API 없음 | 인증서 도입 후 `install.ps1`의 `needsManualExclusion` 진단 보고를 바탕으로 해당 PC만 IT 관리자 수동 예외 등록 (`DAEMON_SURVIVAL_DESIGN.md`) |
| **비도메인 PC Chrome 확장 & 스토어 배포** | Chrome 활동 수집, MOYI iOS/Android/Web 배포 | 비AD PC는 사설 `ExtensionInstallForcelist` 무시; iOS 문구 내 Android 언급 금지·Apple 로그인 필수; Play 개인계정 **12명×14일** 비공개 테스트; `react-native-web` `inverted` 거울 반전 | **UIA Document URL 판별(`uia-recorder.ps1`)**로 대체 또는 웹스토어 비공개 수동 설치; `useInverted = Platform.OS !== 'web'` 분기 및 OTA(`eas update`) 활용 |
| **Max 구독 야간 무과금 해독 & 외부 발송** | `$0` CLI 비전 백로그 해독, 카톡/MOYI 고객사 알림 전송 | OAuth 토큰 만료(`/login`) 및 주간 한도 도달 시 중단 위험; 외부 발송은 오발송·에코 루프 위험 | `quota-hold` + `Hermes` 폴백 + `pHash`/OCR 트리아지; 카톡 Outbound는 검증된 **PC 단일 마스터** + `send_limits.json` + `--dry-run` |
| **이카운트 이관 검증 단발 테스트** | 이관 저장 계약 확인을 위한 `TEST-MOYI-` 샘플 1건 입력 (`2026-10-21` 예외 규칙) | 회계 원장 오염 위험 — 사전 삭제 경로 검증 없이 절대 불가 | 소액·당일 1건만 입력 후 즉시 삭제 검증(회계반영·국세청·은행전송 금지, 삭제 불가 시 즉시 보고) |

### 2.3 현실적으로 불가능 · 기술 차단 · 절대 금지인 것 (Impossible / Blocked / Strictly Prohibited)
| 분류 | 불가능 · 금지 대상 | 기술 · 법적 · 구조적 사유 & 출처 | 대체 허용 경로 |
|---|---|---|---|
| **절대 금지 · 재무/회계** | **은행 자동 이체 · 송금 · 결제 실행** | 무승인 금전 유출 및 사고 책임 불가 (`NOWLINK_PRODUCT_PLAN.md`, `TERMS_AUTOMATION_NOTE.md`, `Device Hub` 킬스위치) | 조회·대사·초안 생성만 수행, 실제 이체·결제는 사람이 은행 앱/웹에서 직접 실행 |
| **절대 금지 · 회계원장** | **이카운트(ECOUNT) 실데이터 입력·수정·저장·삭제** | 회계 전표·세금계산서·채권 원장 오염 위험 (`feedback-ecount-readonly-absolute.md`, 2중 스크레이퍼 차단) | 조회 필터(F8)·엑셀 내보내기 → 네노바웹 업로드 후 비교만 허용 |
| **절대 금지 · 보안/컴플라이언스** | **캡차(CAPTCHA)·봇방지·은행 보안모듈·`FLAG_SECURE`·PIN 우회 & 백신 탐지 회피** | 서비스 약관·법규 위반 + ISMS/PIA 탈락 + 백신 악성코드 분류("제품 자살", `nenova-solution-architecture.md`) | `WAITING_HUMAN` 사람 직접 입력 · 공식 코드서명 인증서 + IT 관리자 수동 예외 |
| **절대 금지 · 프라이버시/법규** | **비동의 개인 1:1방/가족방·개인 웹 수집, "감시/추적/모니터링" 노출, 익명→실명 역방향 식별** | 통신비밀·근로기준법·개인정보보호법 리스크 (`PLAN.md`, `nenova-privacy-gate.md`, `workflowReview.test.js`) | `APPROVED_ROOM_WHITELIST` 업무방 한정, 로컬 추출, 직원 소유권·급여평가 무관 명문화 |
| **절대 금지 · 데이터/원장 무결성** | **무승인 Tier 1 ERP 직접 쓰기 · `ShipmentDetail.isDeleted` 쿼리 · `autoStockAdd` 주입 · `OrderYear` 누락** | SQL 500 에러, 전년도 차수 데이터 혼입, 재고 부풀림 전파(`stock-work-via-md-autostockadd-incident.md`) | `WebDeviceWorkQueue` 스테이징 + `OrderYear+OrderWeek+CustKey+ProdKey` + `verify:week` |
| **OS/플랫폼 한계 · Windows** | **Windows 단독 iOS 화면 미러링 (`phone-harness ios.py` / WDA)** | macOS 15+(Sequoia) & iOS 18+ Xcode/macOS 호스트 필수 — Windows PC 실행 불가 (`session-01`) | 공용 단말 표준을 **Android 11~14** 보급형으로 통일 |
| **OS/플랫폼 한계 · Windows/Chrome** | **카톡 PC UIA 직접 DOM 읽기 · 비도메인 Chrome 확장 강제설치 · Electron ASAR 내부 Node 실행** | 카톡 UIA 요소 4개뿐; Chrome 비도메인 `ExtensionInstallForcelist` 무시; Fuses `onlyLoadAppFromAsar:true` & CSP 차단 | `Phone Harness` + `Ctrl+S`/서랍; UIA Document URL 수집; 외부 Rust 사이드카 + `main.cjs` WSS 역터널 |
| **외부 API/자격 한계** | **ECOUNT OAPI 판매현황 Pull · 금결원 오픈뱅킹 도매업 단독 가입** | ECOUNT OAPI 판매 `Get` endpoint 미존재(입력 전용); 금결원 약관 별첨1에 도매업(KSIC 46xxx) 미해당 | ECOUNT 화면 엑셀/Playwright read-only; 금결원 대신 하나은행 UI/간편조회·신한 개별 계약·바로빌 API |
| **인프라/빌드 한계** | **Google Drive 무료계정 캡처 직접 업로드 · `nenovaweb` Turbopack 빌드 · Drive 동기화 폴더 내 활성 Git 빌드** | Drive 403 폭주 → Railway 768MB OOM(502); Turbopack hydration 전멸; Drive 파일 락/성능 저하 | Railway 스풀+로컬 CLI 워커; `next build --webpack` 고정; 로컬 `worktree` 빌드 후 Drive 이관·worktree 삭제 |

### 2.4 [특별 기록] 과거 불가능·오진 → 2026-11-18 해결 전환 및 사실 교정 이력

#### A. 과거엔 불가능/공백이었으나 오늘(2026-11-18) 아키텍처로 해결 전환된 4대 난제
1. **모바일 위챗·18시 이후·카톡 사진 서랍(12장 제한)·PC 잠금 공백**: PC `nenovakakao` 단독 환경에서는 수집 불가능했던 구간을 **`Phone Harness` + `Device Hub`(Android 11~14 Read-Only + `uiautomator dump` + 즉시 `adb pull`) + `dedup_key` Dual-Path 병합**으로 해결 설계 완료.
2. **상주 사이드카 무거움(80MB+) & 대용량 로그 GC/CPU 병목**: Node/Python 번들의 메모리·속도 한계를 **Rust 단일 정적 바이너리(`hermes-core.exe` 389.5KB 실측 `3.04~4.36배` 가속 / `nenova-device-sidecar.exe` 유휴 <10MB 설계) + JS Fallback**으로 해결.
3. **단일 AI 구독 주간 한도 정지(`quota-hold`) & 세션 중단 재작업**: `claude.exe` 한도 소진 시 전체 조사·해독이 멈추던 문제를 **`Hermes`(`Claude↔Codex` 폴백 + JSONL `Session Rescue` + 91.1% `Trajectory Compressor` + `97 SKILL.md`)**로 해결.
4. **모바일↔데스크톱 단절 & 사내 네트워크 포트포워딩 불가**: 방화벽 내부 PC/창고 폰을 웹 ERP에 붙이지 못하던 문제를 **아웃바운드 WSS 역터널 + 해시 무변경 홈 카드 + `[data-device-draft]` 무저장 초안 주입**으로 해결.

#### B. 과거 "불가능/사망"으로 오진되었다가 실측으로 정정된 이력 (재발 방지 교훈)
- **데몬 원격 실행 '좀비 워커' 오진 (2026-09-10)**: 실행 0건 원인이 워커 사망이 아니라 **hostname 대소문자 큐 분열(`NEONVA` vs `neonva`) + `events.timestamp` TEXT 컬럼의 UTC/KST 혼용 정렬 오류**였음을 규명(`orbit-hostname-case-queue-split.md`).
- **직원 데이터 12일 0건 '데몬 다운' 오진 (2026-10-21)**: 데몬 재등록 시 발급된 **새 `user_id`를 기존 파이프라인이 조회하지 못한 ID 분열**이었음을 규명(`work-data-completeness-gate.md`).
- **오너 PC 앵커 0건 '추출 불가' 오진**: `excel.activity`만 확인하고 실제 **642/650개 앵커가 담긴 `excel.sheet`를 누락**한 관측 실수였음을 정정.
- **법인 주거래은행 오판 (2026-11-03)**: 이카운트 상대은행 표기만 보고 신한/농협으로 오인했던 것을 **하나은행 기업뱅킹(`biz.kebhana.com`)**으로 정정하고 `quickService.do` 간편조회 및 전체 이력 경로 확보(`hana-bank-biz-inquiry.md`).
