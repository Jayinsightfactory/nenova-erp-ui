// components/work/SolutionSuiteSimulator.js
// MOYI × 네노바 통합 솔루션 라이브 모션 시뮬레이터 (/my-work?tab=suite-sim, 관리자 전용).
// Phone Harness · Device Hub · 데스크톱 Rust 사이드카 · Nenova Kakao · Hermes · MOYI 앱 · 네노바웹 ERP 연동 실연.
import { useEffect, useMemo, useRef, useState } from 'react';

const NODES = [
  {
    id: 'phone_kakao',
    no: '01',
    short: '01 Phone Harness · 카톡 수집',
    surface: 'Surface 1 · 현장 수집',
    x: 26,
    y: 30,
    w: 272,
    h: 104,
    cx: 162,
    cy: 82,
    accent: '#38bdf8',
  },
  {
    id: 'device_hub',
    no: '02',
    short: '02 Device Hub · 30fps Lease',
    surface: 'Surface 2 · 기기 관제',
    x: 354,
    y: 30,
    w: 272,
    h: 104,
    cx: 490,
    cy: 82,
    accent: '#22d3ee',
  },
  {
    id: 'rust_sidecar',
    no: '03',
    short: '03 Rust 사이드카 · hermes-core',
    surface: 'Surface 2 · WSS/압축',
    x: 682,
    y: 30,
    w: 272,
    h: 104,
    cx: 818,
    cy: 82,
    accent: '#f59e0b',
  },
  {
    id: 'hermes_ai',
    no: '04',
    short: '04 Hermes AI · 3단위 환산',
    surface: 'Surface 3 · 지능 매칭',
    x: 26,
    y: 204,
    w: 272,
    h: 104,
    cx: 162,
    cy: 256,
    accent: '#a78bfa',
  },
  {
    id: 'moyi_gate',
    no: '05',
    short: '05 MOYI 앱 · 승인 게이트',
    surface: 'Surface 4 · 2FA 승인',
    x: 354,
    y: 204,
    w: 272,
    h: 104,
    cx: 490,
    cy: 256,
    accent: '#34d399',
  },
  {
    id: 'erp_ledger',
    no: '06',
    short: '06 네노바웹 · MSSQL 원장',
    surface: 'Surface 5 · 공유 원장',
    x: 682,
    y: 204,
    w: 272,
    h: 104,
    cx: 818,
    cy: 256,
    accent: '#60a5fa',
  },
];

// 6개 노드를 잇는 광섬유 SVG 경로(1→2→3 상단 행에서 중앙 S-트렁크를 타고 4→5→6 하단 행으로 연결)
const EDGE_PATHS = [
  'M 298 82 L 354 82',
  'M 626 82 L 682 82',
  'M 818 134 L 818 154 Q 818 169 803 169 L 177 169 Q 162 169 162 184 L 162 204',
  'M 298 256 L 354 256',
  'M 626 256 L 682 256',
];

const SCENARIOS = [
  {
    id: 'wechat_order',
    badge: '시나리오 1 · 수입 발주 자동화',
    title: '위챗·카톡 수입 추가발주 ➔ 프리덤 장미 100단 자동 환산 ➔ MOYI 앱 원터치 승인 ➔ OrderDetail 반영',
    preferredDept: '수입부',
    preferredNames: ['김원빈', '김지니', '아드리아나', '설연주'],
    manualMinutes: 18.5,
    autoSeconds: 14,
    savedPct: 98.7,
    gaugeHeadline: '수작업 18.5분 ➔ 자동화+MOYI 승인 14초 · 98.7% 단축',
    phoneHeader: '공용폰 #01 · 위챗 수입단톡방 (Read-Only)',
    phoneTitle: '콜롬비아 ELITE 농장방',
    phoneSub: '오후 16:30 · 신규 발주 메시지 수신',
    phoneLines: [
      { tag: 'SENDER', text: 'ELITE_FARM_COL (수입단톡방)' },
      { tag: 'MSG', text: 'ROSE FREEDOM 50CM +5 BOX ADD (46-01차)' },
      { tag: 'OCR', text: 'ProdKey=1042 · BunchOf1Box=20 · OutQuantity=100단' },
    ],
    scanBoxes: [
      { label: '위챗 원문 영역', top: '28%', left: '8%', width: '84%', height: '24%' },
      { label: '수량 +5 BOX 추출', top: '57%', left: '12%', width: '76%', height: '18%' },
    ],
    moyiCard: {
      room: 'MOYI 수입·발주 승인 게이트',
      title: '46-01차 추가발주 원장 반영 승인 요청',
      item: '콜롬비아 장미 프리덤 50cm (ProdKey=1042)',
      qtySummary: '5박스 × 20단 = OutQuantity=100단 (2,500송이)',
      meta: 'ProposedBy=phone-harness-01 · ApprovedBy=nenovaSS3 (대기)',
      receiptTitle: 'OrderDetail 원장 반영 영수증',
      receiptBody: 'OrderYear=2026 · OrderWeek=46-01 · ProdKey=1042 · Box=5 · Bunch=100 · Steam=2500 · OutUnit=단(100)',
      txId: '#TX-ORD-20261118-1042',
    },
    steps: [
      {
        nodeIndex: 0,
        elapsedSec: 1.8,
        chip: 'dedup_key 해시 생성',
        action: 'Phone Harness가 위챗·카톡 수입단톡방의 추가발주 원문을 읽기 전용으로 수집합니다.',
        telemetry: [
          '[01 PHONE-HARNESS] channel=wechat_read_only · room="콜롬비아 농장방"',
          '[01 KAKAO-BRIDGE] dedup_key = sha256("suip-room|elite|1630|rose-freedom-5box|0")',
          '[01 PAYLOAD] raw="ROSE FREEDOM 50CM +5 BOX ADD" · outbound_block=TRUE',
        ],
      },
      {
        nodeIndex: 1,
        elapsedSec: 3.4,
        chip: '30fps Lease 잠금',
        action: 'Device Hub가 공용폰 Lease를 180초 독점 할당하고 uiautomator + 30fps 프레임을 동기화합니다.',
        telemetry: [
          '[02 DEVICE-HUB] WebDeviceLease(leaseId="L-4601-01", ttl=180s, fps=30)',
          '[02 ACCESSIBILITY] uiautomator dump -> node[id="chat_msg_882"] bounds=[64,290,910,470]',
          '[02 GUARD] high_risk_keywords(송금/이체/삭제)=0 · READ_ONLY_VERIFIED',
        ],
      },
      {
        nodeIndex: 2,
        elapsedSec: 5.2,
        chip: 'Rust WSS + 압축',
        action: 'nenova-device-sidecar.exe가 WSS 역터널로 프레임을 중계하고 hermes-core.exe가 중복 프레임을 84% 압축합니다.',
        telemetry: [
          '[03 RUST-SIDECAR] nenova-device-sidecar.exe (3.8MB, idle RAM 7.4MB) · WSS tunnel UP',
          '[03 PHASH-FILTER] static frames dropped 84.2% · RapidOCR text="ROSE FREEDOM 50CM +5 BOX"',
          '[03 HERMES-CORE] sha256 dedup_key batch verified in 0.4ms',
        ],
      },
      {
        nodeIndex: 3,
        elapsedSec: 8.6,
        chip: 'ProdKey=1042 3단위 환산',
        action: 'Hermes AI가 품목 마스터(ProdKey=1042)의 BunchOf1Box=20을 적용해 OutQuantity=100단으로 자동 환산합니다.',
        telemetry: [
          '[04 HERMES-AI] match Product: ProdKey=1042, ProdName="ROSE FREEDOM 50CM", OutUnit="단"',
          '[04 UNIT-CONV] 5 Box × BunchOf1Box(20) = 100단 (OutQuantity=100) · SteamQuantity=2500',
          '[04 DRAFT-QUEUE] INSERT WebDeviceWorkQueue(Status="DRAFT", IdempotencyKey="w4601-1042-5box")',
        ],
      },
      {
        nodeIndex: 4,
        elapsedSec: 11.4,
        chip: 'ApprovedBy 2FA 게이트',
        action: 'MOYI 모바일 앱 대화방에 승인 카드가 도착해 ApprovedBy ≠ ProposedBy 2차 승인을 대기합니다.',
        telemetry: [
          '[05 MOYI-GATE] push approval card -> room="MOYI 관리자 승인방"',
          '[05 POLICY] ApprovedBy <> ProposedBy check ("nenovaSS3" !== "phone-harness-01")',
          '[05 WAITING] 오른쪽 MOYI 승인 카드의 [✓ MOYI 승인 실행] 버튼으로 즉시 커밋 가능',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 14.0,
        chip: 'BEGIN TRAN UPDLOCK',
        action: '승인 완료 즉시 safeNextKey()와 BEGIN TRAN UPDLOCK 트랜잭션으로 OrderDetail에 100단을 안전 반영합니다.',
        telemetry: [
          '[06 ERP-SQL] BEGIN TRAN UPDLOCK HOLDLOCK · safeNextKey("OrderDetail") -> 498120',
          '[06 ERP-SQL] INSERT OrderDetail(OrderYear=2026, OrderWeek="46-01", ProdKey=1042, OutQuantity=100)',
          '[06 COMMIT] WebDeviceWorkQueue=APPLIED · TxReceipt=#TX-ORD-20261118-1042 (14.0s total)',
        ],
      },
    ],
  },
  {
    id: 'warehouse_defect',
    badge: '시나리오 2 · 창고 파손 클레임',
    title: '창고 현장폰 파손 촬영 ➔ Device Hub·Rust 사이드카 역터널 ➔ OCR 품목 판독(수국 15송이) ➔ MOYI 클레임 승인 ➔ 견적 차감',
    preferredDept: '영업지원',
    preferredNames: ['설연주', '강명훈', '김원빈'],
    manualMinutes: 14.0,
    autoSeconds: 16,
    savedPct: 98.1,
    gaugeHeadline: '수작업 14.0분 ➔ 자동화+MOYI 승인 16초 · 98.1% 단축',
    phoneHeader: '창고 현장폰 #02 · Wi-Fi ADB 카메라',
    phoneTitle: '입고 검수 촬영 · 2번 냉장고',
    phoneSub: '오후 14:12 · 네덜란드 수국 줄기 파손',
    phoneLines: [
      { tag: 'PHOTO', text: 'IMG_4601_HYDRANGEA_DMG.jpg (3.1MB -> 180KB)' },
      { tag: 'LABEL', text: 'NL HYDRANGEA MAGICAL GREEN · 15 STEMS' },
      { tag: 'OCR', text: 'ProdKey=2218 · OutUnit=송이 · DefectQty=15송이' },
    ],
    scanBoxes: [
      { label: '박스 바코드/라벨', top: '26%', left: '10%', width: '80%', height: '22%' },
      { label: '파손 15송이 판독', top: '54%', left: '14%', width: '72%', height: '20%' },
    ],
    moyiCard: {
      room: 'MOYI 창고·클레임 승인 게이트',
      title: '불량 파손 클레임 견적 차감 승인 요청',
      item: '네덜란드 수국 매지컬 그린 (ProdKey=2218)',
      qtySummary: '파손 판독 15송이 (0.5박스) · 차감 단가 4,200원/송이',
      meta: 'ProposedBy=warehouse-cam-02 · ApprovedBy=nenovaSS3 (대기)',
      receiptTitle: 'WebSalesDefectDeduction & Estimate 차감 영수증',
      receiptBody: 'OrderYear=2026 · OrderWeek=46-01 · ProdKey=2218 · OutQuantity=-15(송이) · Status=APPROVED',
      txId: '#TX-DEF-20261118-2218',
    },
    steps: [
      {
        nodeIndex: 0,
        elapsedSec: 2.1,
        chip: '창고 사진 adb pull',
        action: '창고 현장폰 카메라로 수국 파손 박스를 촬영하면 Phone Harness가 즉시 메타·이미지를 확보합니다.',
        telemetry: [
          '[01 PHONE-HARNESS] adb pull /sdcard/DCIM/IMG_4601_HYDRANGEA_DMG.jpg',
          '[01 KAKAO-BRIDGE] dedup_key = sha256("wh-cam-02|hydrangea|15stems|4601")',
          '[01 PAYLOAD] media_urls=["/api/device-hub/media/4601-hydrangea.jpg"]',
        ],
      },
      {
        nodeIndex: 1,
        elapsedSec: 4.5,
        chip: 'Device Hub 30fps',
        action: 'Device Hub가 현장폰 촬영 프리뷰를 30fps로 중계하고 WebDeviceLease에 검수 세션을 기록합니다.',
        telemetry: [
          '[02 DEVICE-HUB] WebDeviceNode(node="warehouse-cam-02", state="ONLINE", fps=30)',
          '[02 LEASE] WebDeviceLease(leaseId="L-WH-4601", ttl=120s) active',
          '[02 PREVIEW] active draft slot [data-device-draft] ready',
        ],
      },
      {
        nodeIndex: 2,
        elapsedSec: 7.0,
        chip: 'WSS 역터널 + RapidOCR',
        action: 'Rust 사이드카(nenova-device-sidecar.exe)가 아웃바운드 WSS 역터널로 라벨 OCR을 무중단 전달합니다.',
        telemetry: [
          '[03 RUST-SIDECAR] wss://nenovaweb.com/api/device-hub/tunnel (no port-forwarding)',
          '[03 RAPID-OCR] box=[140,540,860,740] text="NL MAGICAL GREEN 15 STEMS DAMAGED" (98.4%)',
          '[03 HERMES-CORE] frame diff passed · duplicate photo suppressed',
        ],
      },
      {
        nodeIndex: 3,
        elapsedSec: 10.2,
        chip: '수국 15송이 판독',
        action: 'Hermes AI가 품목(ProdKey=2218, OutUnit=송이)과 파손 15송이를 매칭해 불량 검토 초안(DRAFT)을 생성합니다.',
        telemetry: [
          '[04 HERMES-AI] ProdKey=2218 ("HYDRANGEA MAGICAL GREEN") · OutUnit="송이" · SteamOf1Box=30',
          '[04 DEFECT-DRAFT] WebSalesDefectDeduction(Status="DRAFT", DefectQty=15, Box=0.5)',
          '[04 GUARD] direct Estimate write BLOCKED until ApprovedBy gate completes',
        ],
      },
      {
        nodeIndex: 4,
        elapsedSec: 13.1,
        chip: 'MOYI 클레임 승인',
        action: 'MOYI 앱에 파손 사진·판독 수량(15송이) 승인 카드가 도착해 담당자의 최종 승인을 기다립니다.',
        telemetry: [
          '[05 MOYI-GATE] claim approval card -> ProdKey=2218, OutQuantity=15(송이)',
          '[05 POLICY] ApprovedBy <> ProposedBy ("nenovaSS3" !== "warehouse-cam-02")',
          '[05 WAITING] [✓ MOYI 승인 실행] 클릭 시 견적 차감 트랜잭션 실행',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 16.0,
        chip: '견적 음수 차감 완료',
        action: 'BEGIN TRAN UPDLOCK 검증 후 WebSalesDefectDeduction 승인 및 Estimate 음수 차감을 커밋합니다.',
        telemetry: [
          '[06 ERP-SQL] BEGIN TRAN UPDLOCK · UPDATE WebSalesDefectDeduction SET Status="APPROVED"',
          '[06 ERP-SQL] INSERT Estimate(OrderYear=2026, OrderWeek="46-01", ProdKey=2218, OutQuantity=-15)',
          '[06 COMMIT] TxReceipt=#TX-DEF-20261118-2218 · 16.0s total (98.1% saved)',
        ],
      },
    ],
  },
  {
    id: 'human_lease',
    badge: '시나리오 3 · 보안키패드 인간개입',
    title: '공용폰 보안키패드(FLAG_SECURE) 감지 ➔ 에이전트 Lease 즉시 반납 ➔ MOYI 앱 알림 ➔ Device Hub 30fps 웹 10초 해제 ➔ 에이전트 재개',
    preferredDept: '경영지원',
    preferredNames: ['강명훈', '설연주', '김원빈'],
    manualMinutes: 6.5,
    autoSeconds: 10,
    savedPct: 97.4,
    gaugeHeadline: '수작업 대기 6.5분 ➔ 30fps 웹 10초 해제 · 97.4% 단축',
    phoneHeader: '공용폰 #03 · FLAG_SECURE 보안 경계',
    phoneTitle: '은행·인증 보안키패드 감지',
    phoneSub: '에이전트 Lease 반납 ➔ 사람 10초 원격 해제',
    phoneLines: [
      { tag: 'FLAG', text: 'Window FLAG_SECURE=true (보안키패드 보호)' },
      { tag: 'LEASE', text: 'WAITING_HUMAN · Agent Lease 즉시 반납 완료' },
      { tag: 'RESUME', text: '웹 30fps 10초 해제 확인 -> 에이전트 안전 재개' },
    ],
    scanBoxes: [
      { label: 'FLAG_SECURE 윈도우 감지', top: '24%', left: '8%', width: '84%', height: '26%' },
      { label: '보안키패드 차단 구역', top: '54%', left: '8%', width: '84%', height: '30%' },
    ],
    moyiCard: {
      room: 'MOYI 긴급 보안 개입 알림',
      title: '공용폰 보안키패드(FLAG_SECURE) 10초 해제 요청',
      item: 'DeviceNode #03 (WebDeviceLease -> WAITING_HUMAN)',
      qtySummary: '에이전트 입력 즉시 정지 · Device Hub 30fps 웹 콘솔 연결',
      meta: 'LeaseOwner=human:nenovaSS3 · ApprovedBy=nenovaSS3 (10s TTL)',
      receiptTitle: '보안 해제 및 에이전트 Lease 재개 영수증',
      receiptBody: 'FLAG_SECURE cleared -> WebDeviceLease reassigned -> Session Rescue JSONL resumed',
      txId: '#TX-SEC-20261118-0003',
    },
    steps: [
      {
        nodeIndex: 0,
        elapsedSec: 1.2,
        chip: 'FLAG_SECURE 감지',
        action: 'Phone Harness가 공용폰 화면의 보안키패드(FLAG_SECURE) 및 인증 오버레이 진입을 즉시 감지합니다.',
        telemetry: [
          '[01 PHONE-HARNESS] windowFlags & FLAG_SECURE != 0 · activity="SecureKeypadDialog"',
          '[01 SAFETY] screenshot masked · credential capture zero-touch guard triggered',
          '[01 EVENT] emit human_intervention_required(reason="FLAG_SECURE")',
        ],
      },
      {
        nodeIndex: 1,
        elapsedSec: 2.0,
        chip: 'Lease 즉시 반납',
        action: 'Device Hub가 에이전트의 독점 Lease를 즉시 반납하고 상태를 WAITING_HUMAN(30fps 웹 제어)으로 전환합니다.',
        telemetry: [
          '[02 DEVICE-HUB] WebDeviceLease.release(leaseId="L-SEC-03", reason="FLAG_SECURE")',
          '[02 STATE] status="WAITING_HUMAN" · remoteConnectUrl ready (30fps stream)',
          '[02 LOCK] agent touch/adb input disabled until human release',
        ],
      },
      {
        nodeIndex: 2,
        elapsedSec: 3.1,
        chip: '사이드카 입력 차단',
        action: 'Rust 사이드카가 자동화 입력 채널을 하드웨어 수준에서 잠그고, 웹 뷰어 스트림만 WSS 역터널로 유지합니다.',
        telemetry: [
          '[03 RUST-SIDECAR] ABORT_AUTOMATION · input_channel=LOCKED',
          '[03 WSS-TUNNEL] 30fps read-only mirror active for authenticated operator',
          '[03 HERMES-CORE] zero credential bytes logged (mask policy enforced)',
        ],
      },
      {
        nodeIndex: 3,
        elapsedSec: 4.4,
        chip: '세션 JSONL 보존',
        action: 'Hermes AI가 중단 직전 작업 문맥을 JSONL(Session Rescue)에 안전 보관해 재개 시 맥락 손실이 없습니다.',
        telemetry: [
          '[04 HERMES-AI] Session Rescue snapshot -> ~/.orbit/hermes-rescue/lease-03.jsonl',
          '[04 CONTEXT] checkpoint="order_check_step_4" preserved for instant resume',
          '[04 POLICY] ApprovedBy human unlock required before Lease re-grant',
        ],
      },
      {
        nodeIndex: 4,
        elapsedSec: 7.2,
        chip: 'MOYI 알림 · 10초 해제',
        action: 'MOYI 앱 알림을 받은 관리자가 Device Hub 30fps 웹 화면에서 10초 만에 보안키패드를 직접 해제합니다.',
        telemetry: [
          '[05 MOYI-GATE] alert pushed -> "공용폰 #03 보안키패드 10초 원격 해제"',
          '[05 HUMAN-OP] operator unlocked keypad via Device Hub 30fps console (10s)',
          '[05 WAITING] [✓ MOYI 승인 실행] 클릭 시 에이전트 Lease 재할당',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 10.0,
        chip: '에이전트 안전 재개',
        action: 'FLAG_SECURE 해제 확인 후 Device Hub가 Lease를 재발급하고 네노바웹 연동 작업을 이어서 완료합니다.',
        telemetry: [
          '[06 ERP-SQL] BEGIN TRAN UPDLOCK · UPDATE WebDeviceLease SET Status="ACTIVE", ApprovedBy="nenovaSS3"',
          '[06 RESUME] FLAG_SECURE=false confirmed -> Hermes Session Rescue restored',
          '[06 COMMIT] TxReceipt=#TX-SEC-20261118-0003 · 10.0s human handoff complete',
        ],
      },
    ],
  },
];

const BLUEPRINT_GALLERY = [
  {
    id: 'hero',
    src: '/images/solution-sim/moyi-suite-hero-blueprint.jpg',
    badge: '도면 1 · 5-Surface 통합',
    title: 'MOYI × 네노바 전체 5-Surface 통합 아키텍처',
    subtitle: 'PHONE HARNESS + KAKAO BRIDGE → DEVICE HUB + RUST SIDECAR → HERMES AI → MOYI APP → ERP SQL LEDGER',
    callouts: [
      '01. 현장 수집면: Android Phone Harness(Read-Only)와 Nenova Kakao Dual-Path(dedup_key)가 비정형 메시지·현장 사진을 무중단 수집',
      '02. 브릿지/허브: Device Hub 30fps Lease 잠금과 Rust 단일 바이너리(nenova-device-sidecar.exe)가 WSS 역터널로 안전 중계',
      '03. 지능·승인·원장: Hermes AI 3단위 환산(ProdKey/OutUnit) 후 MOYI 2FA 승인 게이트를 거쳐야만 BEGIN TRAN UPDLOCK 원장 커밋',
    ],
  },
  {
    id: 'hub',
    src: '/images/solution-sim/phone-harness-device-hub.jpg',
    badge: '도면 2 · Device Hub + OCR',
    title: 'Device Hub 30fps 다중 폰 콘솔 & Phone Harness 레이저 OCR 스캔',
    subtitle: '다중 공용폰 실시간 관제 · 시안 레이저 스캔 · 접근성 트리(uiautomator) · pHash 중복 프레임 차단',
    callouts: [
      '01. 30fps 콘솔: 여러 대의 공용폰·창고 현장폰 상태를 한 화면에서 확인하고 FLAG_SECURE 발생 시 10초 원격 개입',
      '02. 레이저 OCR 스캔: 화면 위 텍스트와 박스 라벨 영역을 시안색 바운딩박스로 판독해 수동 타이핑 제거',
      '03. 저부하 아키텍처: 정지 프레임 84%를 Rust pHash 필터로 사전 차단해 네트워크 대역폭·토큰 비용 절감',
    ],
  },
  {
    id: 'sync',
    src: '/images/solution-sim/moyi-approval-erp-sync.jpg',
    badge: '도면 3 · MOYI 승인 원장 동기화',
    title: 'MOYI 모바일 승인 게이트 & 3계층 SQL 원장 동기화',
    subtitle: 'MOYI 승인 카드 → 보안 실드(ApprovedBy <> ProposedBy) → ORDER / SHIPMENT / COST 3계층 MSSQL 원장',
    callouts: [
      '01. 원장 오염 차단: 에이전트는 WebDeviceWorkQueue DRAFT만 생성하고, 관리자(ApprovedBy) 승인 전에는 본 원장 쓰기 불가',
      '02. 3계층 정합성: OrderYear + OrderWeek + CustKey + ProdKey 복합키와 safeNextKey() UPDLOCK 채번으로 nenova.exe 100% 호환',
      '03. Idempotency 보장: 동일 요청 재시도 시 IdempotencyKey 검증으로 이중 발주·중복 차감을 원천 방지',
    ],
  },
];

// 로컬 개발 환경·오프라인에서도 빈 화면 없이 실제 저장소 기반 관찰 근거가 표시되도록 준비한 실측 폴백
const FALLBACK_EVIDENCE = {
  people: [
    {
      name: '김원빈',
      dept: '수입부',
      uid: '',
      roleSummary: '해외 농장 발주·인보이스 입고·도착원가 계산 및 카톡 단톡방 물량 확인',
      workflows: [
        { name: '콜롬비아/네덜란드 발주 확정판 대조', stage: ['발주', '입고'], frequency: '매일' },
        { name: '해외 송장 입고 등록 및 도착원가 배부', stage: ['입고', '원가'], frequency: '차수별' },
      ],
    },
    {
      name: '설연주',
      dept: '영업지원',
      uid: '',
      roleSummary: '거래처별 출고 분배·카톡 차수 변경 대조·견적서 및 클레임 차감 정리',
      workflows: [
        { name: '카톡 차수 변경·추가 대조 및 신규주문 반영', stage: ['발주', '분배'], frequency: '매일' },
        { name: '거래처별 출고 확인표 및 불량 차감 정리', stage: ['현장출고', '견적서'], frequency: '주 4회' },
      ],
    },
    {
      name: '강명훈',
      dept: '경영지원',
      uid: '',
      roleSummary: '차수별 서류 체크리스트 점검·종합견적 합계 검산·법인카드 매입 분류',
      workflows: [
        { name: '차수 종합견적 합계·차액 검산', stage: ['견적서', '이익'], frequency: '차수별' },
        { name: '서류 체크리스트 및 주간 정산 마감', stage: ['입금', '이익'], frequency: '매일' },
      ],
    },
  ],
  simulations: {
    people: [
      {
        name: '김원빈',
        items: [
          {
            title: '위챗·카톡 추가발주 3단위 환산 → 원장 반영',
            menu: '주문 > 신규주문등록',
            observed: '단톡방 메시지 확인 후 엑셀·전산을 오가며 박스/단/송이 환산 후 수동 입력',
            proposal: 'Phone Harness 수집 + Hermes 3단위 환산 + MOYI 원터치 승인 반영',
            before: {
              totalMinutes: 18.5,
              perWeek: 6,
              steps: [
                { who: '김원빈', app: 'WeChat/카톡', action: '수입방 추가발주 텍스트·사진 확인', minutes: 4.5, pain: '방 전환 중 메시지 누락 위험' },
                { who: '김원빈', app: 'Excel', action: '품목 코드 및 박스→단 환산 검산', minutes: 8.0, pain: '수기 단위 환산 실수 위험' },
                { who: '김원빈', app: 'nenova.exe', action: '거래처·차수·품목 검색 후 수동 저장', minutes: 6.0, pain: '화면 왕복 및 반복 입력' },
              ],
            },
            after: {
              totalMinutes: 0.23,
              steps: [
                { action: 'Phone Harness + Rust 사이드카 자동 수집·OCR', minutes: 0.08, auto: true },
                { action: 'Hermes AI 3단위 환산(ProdKey=1042, OutQuantity=100단)', minutes: 0.05, auto: true },
                { action: 'MOYI 앱 원터치 승인 → OrderDetail UPDLOCK 커밋', minutes: 0.1, auto: false },
              ],
            },
            savingPerWeekMin: 110,
          },
        ],
      },
      {
        name: '설연주',
        items: [
          {
            title: '현장 파손 사진 OCR 판독 → 클레임 견적 차감',
            menu: '출고 > 불량 차감 관리',
            observed: '현장 사진 확인 후 품목명 대조·파손 송이 수 계산·견적 차감 수작업 입력',
            proposal: 'Device Hub 현장폰 촬영본 역터널 + OCR 판독 + MOYI 승인 후 Estimate 차감',
            before: {
              totalMinutes: 14.0,
              perWeek: 5,
              steps: [
                { who: '설연주', app: '카카오톡', action: '창고 파손 사진·텍스트 확인 및 품목 대조', minutes: 5.0, pain: '사진 확대 판독 및 품목 혼동' },
                { who: '설연주', app: 'nenova.exe', action: '차수·거래처 견적 조회 후 차감 수량 입력', minutes: 9.0, pain: '이중 차감·단위 오기재 우려' },
              ],
            },
            after: {
              totalMinutes: 0.27,
              steps: [
                { action: '창고폰 촬영 → WSS 역터널 & RapidOCR 수국 15송이 판독', minutes: 0.12, auto: true },
                { action: 'WebSalesDefectDeduction DRAFT 생성 & MOYI 승인', minutes: 0.15, auto: false },
              ],
            },
            savingPerWeekMin: 68,
          },
        ],
      },
    ],
  },
};

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function fmtTs(t) {
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return String(t).slice(0, 16);
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function extractBoxes(record) {
  if (!record || typeof record !== 'object') return [];
  const list = [];
  if (Array.isArray(record.steps)) {
    record.steps.forEach((st, idx) => {
      if (Array.isArray(st?.box) && st.box.length >= 4) {
        list.push({
          box: st.box,
          label: st.label || st.name || st.action || `Step ${idx + 1}`,
          no: st.order || idx + 1,
        });
      }
    });
  }
  if (!list.length && Array.isArray(record.fields)) {
    record.fields.forEach((f, idx) => {
      if (Array.isArray(f?.box) && f.box.length >= 4) {
        list.push({
          box: f.box,
          label: f.name || f.value || `Field ${idx + 1}`,
          no: f.order || idx + 1,
        });
      }
    });
  }
  return list;
}

function pickInitialPerson(people, scenario) {
  if (!Array.isArray(people) || !people.length) return '';
  for (const name of scenario.preferredNames || []) {
    const found = people.find((p) => p.name === name && p.uid);
    if (found) return found.name;
  }
  const byDeptUid = people.find((p) => p.dept === scenario.preferredDept && p.uid);
  if (byDeptUid) return byDeptUid.name;
  for (const name of scenario.preferredNames || []) {
    const found = people.find((p) => p.name === name);
    if (found) return found.name;
  }
  return people[0].name || '';
}

export default function SolutionSuiteSimulator({ orbit = '', orbitQs = '' }) {
  const [scenarioId, setScenarioId] = useState('wechat_order');
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState('1x');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [approvedMap, setApprovedMap] = useState({});
  const [galleryTab, setGalleryTab] = useState('blueprints');
  const [lightbox, setLightbox] = useState(null);

  // 라이브 텔레메트리 타이프라이터 표시 길이 (초기 SSR 렌더는 전체 문장이 바로 보이도록 9999)
  const [typedLen, setTypedLen] = useState(9999);
  const hasInteractedRef = useRef(false);

  // 실제 네노바웹 API 연동 상태
  const [workflowsData, setWorkflowsData] = useState(null);
  const [simulationsData, setSimulationsData] = useState(null);
  const [proposalsData, setProposalsData] = useState(null);
  const [selectedPersonName, setSelectedPersonName] = useState('');
  const [thumbsState, setThumbsState] = useState({ loading: false, items: [], error: '', mode: 'idle' });
  const [recordsState, setRecordsState] = useState({ loading: false, records: [], error: '' });
  const [shotModal, setShotModal] = useState(null);

  const scenario = useMemo(
    () => SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0],
    [scenarioId]
  );
  const activeStep = scenario.steps[stepIndex] || scenario.steps[0];
  const isApproved = !!approvedMap[scenario.id];

  // prefers-reduced-motion 감지
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      setReducedMotion(!!mq.matches);
      if (mq.matches) setPlaying(false);
    };
    apply();
    if (mq.addEventListener) {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
    return undefined;
  }, []);

  // 자동 시뮬레이션 재생 타이머 (Interruptible)
  useEffect(() => {
    if (!playing || reducedMotion) return undefined;
    const intervalMs = speed === '1.8x' ? 1300 : 2350;
    const timer = setInterval(() => {
      hasInteractedRef.current = true;
      setStepIndex((prev) => (prev + 1) % scenario.steps.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [playing, speed, reducedMotion, scenario.id, scenario.steps.length]);

  // 텔레메트리 콘솔 타이프라이터 애니메이션
  const fullTelemetryText = useMemo(() => activeStep.telemetry.join('\n'), [activeStep]);
  useEffect(() => {
    if (!hasInteractedRef.current || reducedMotion) {
      setTypedLen(fullTelemetryText.length);
      return undefined;
    }
    setTypedLen(0);
    let cur = 0;
    const t = setInterval(() => {
      cur += 7;
      setTypedLen(cur);
      if (cur >= fullTelemetryText.length) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
  }, [fullTelemetryText, reducedMotion, scenarioId, stepIndex]);

  // 마운트 시 workflows + simulations (+ proposals 폴백) API 호출
  useEffect(() => {
    let alive = true;
    fetch('/api/my-work/feature?name=workflows', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.success && j.data?.people?.length) {
          setWorkflowsData(j.data);
        }
      })
      .catch(() => {});

    fetch('/api/my-work/feature?name=simulations', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.success && j.data?.people?.length) {
          setSimulationsData(j.data);
        }
      })
      .catch(() => {});

    fetch('/api/my-work/feature?name=proposals', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.success && j.data?.people?.length) {
          setProposalsData(j.data);
        }
      })
      .catch(() => {});

    return () => { alive = false; };
  }, []);

  const peopleList = useMemo(() => {
    if (workflowsData?.people?.length) return workflowsData.people;
    if (proposalsData?.people?.length) {
      return proposalsData.people.map((p) => ({
        name: p.name,
        dept: p.dept || '미분류',
        uid: '',
        roleSummary: `전산 기록 ${Number(p.erpTotal || 0).toLocaleString()}건 · 관찰 기반 기능 후보 ${arr(p.proposals?.rows).length}건`,
        workflows: arr(p.proposals?.rows).map((r) => ({ name: r.proposal || r.menu, stage: [r.menu || '업무'], frequency: '실측' })),
      }));
    }
    return FALLBACK_EVIDENCE.people;
  }, [workflowsData, proposalsData]);

  // 시나리오 전환 또는 데이터 로드 시 매칭 직원 자동 선택
  useEffect(() => {
    setSelectedPersonName((prev) => {
      if (prev && peopleList.some((p) => p.name === prev)) return prev;
      return pickInitialPerson(peopleList, scenario);
    });
  }, [peopleList, scenario]);

  const selectedPerson = useMemo(
    () => peopleList.find((p) => p.name === selectedPersonName) || peopleList[0],
    [peopleList, selectedPersonName]
  );

  // 선택 직원의 실제 Orbit 캡처 썸네일 + bounding box records 조회
  useEffect(() => {
    const uid = selectedPerson?.uid;
    if (!uid) {
      setThumbsState({ loading: false, items: [], error: '', mode: 'no-uid' });
      setRecordsState({ loading: false, records: [], error: '' });
      return undefined;
    }
    let alive = true;
    setThumbsState({ loading: true, items: [], error: '', mode: 'loading' });
    setRecordsState({ loading: true, records: [], error: '' });

    fetch(`/api/work/orbit-thumbs?user=${encodeURIComponent(uid)}&hours=168&limit=24`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const items = arr(j?.items);
        setThumbsState({
          loading: false,
          items,
          error: j?.success ? '' : (j?.error || 'Orbit 응답 없음'),
          mode: items.length ? 'live' : 'empty',
        });
      })
      .catch((e) => {
        if (alive) setThumbsState({ loading: false, items: [], error: e.message, mode: 'error' });
      });

    fetch(`/api/work/orbit-thumbs?user=${encodeURIComponent(uid)}&records=1&limit=12`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setRecordsState({
          loading: false,
          records: arr(j?.records),
          error: j?.success ? '' : (j?.error || ''),
        });
      })
      .catch((e) => {
        if (alive) setRecordsState({ loading: false, records: [], error: e.message });
      });

    return () => { alive = false; };
  }, [selectedPerson?.uid]);

  // Escape 키로 라이트박스·캡처 모달 닫기
  useEffect(() => {
    if (!lightbox && !shotModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setLightbox(null);
        setShotModal(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, shotModal]);

  const activeSimulation = useMemo(() => {
    const simSource = simulationsData?.people?.length ? simulationsData : FALLBACK_EVIDENCE.simulations;
    const allPeople = arr(simSource.people).filter((p) => arr(p.items).length);
    const matched = allPeople.find((p) => p.name === selectedPerson?.name) || allPeople[0];
    return {
      isLive: !!simulationsData?.people?.length,
      personName: matched?.name || selectedPerson?.name || '실무자',
      item: matched?.items?.[0] || null,
    };
  }, [simulationsData, selectedPerson?.name]);

  const jumpToStep = (nextIdx) => {
    hasInteractedRef.current = true;
    const clamped = Math.max(0, Math.min(scenario.steps.length - 1, nextIdx));
    setStepIndex(clamped);
  };

  const handleSelectScenario = (nextId) => {
    hasInteractedRef.current = true;
    setScenarioId(nextId);
    setStepIndex(0);
    const nextScenario = SCENARIOS.find((s) => s.id === nextId);
    if (nextScenario) {
      setSelectedPersonName(pickInitialPerson(peopleList, nextScenario));
    }
  };

  const handleReset = () => {
    hasInteractedRef.current = true;
    setStepIndex(0);
    setApprovedMap((prev) => ({ ...prev, [scenario.id]: false }));
  };

  const handleApprove = () => {
    hasInteractedRef.current = true;
    setApprovedMap((prev) => ({ ...prev, [scenario.id]: true }));
    setPlaying(false);
    setStepIndex(5);
  };

  const simBefore = activeSimulation.item?.before || {};
  const simAfter = activeSimulation.item?.after || {};
  const beforeSteps = arr(simBefore.steps);
  const afterSteps = arr(simAfter.steps);
  const activeRecordsWithBoxes = recordsState.records.filter((r) => extractBoxes(r).length > 0);
  const visibleTelemetry = fullTelemetryText.slice(0, typedLen);

  return (
    <div className="sim-studio" data-testid="solution-suite-simulator">
      {/* 1. 상단 컨트롤 바 & 누적 단축 시간 계기판 */}
      <header className="sim-topbar">
        <div className="sim-title-block">
          <div className="sim-eyebrow">MOYI × NENOVA · MULTI-SURFACE MOTION &amp; EVIDENCE STUDIO</div>
          <h2>통합 솔루션 라이브 모션 시뮬레이션</h2>
          <p className="sim-subtitle">
            MOYI 앱부터 Phone Harness · Device Hub · 데스크톱 Rust 사이드카 · Nenova Kakao · Hermes · 네노바웹 ERP 원장까지
            실제 직원 작업 캡처 데이터 위에서 6단계 흐름을 즉시 재생·검증합니다.
          </p>
        </div>

        <div className="sim-gauge-card" aria-live="polite">
          <div className="sim-gauge-label">실시간 누적 단축 시간 계기판</div>
          <div className="sim-gauge-headline">수작업 18.5분 ➔ 자동화+MOYI 승인 14초 · 98.7% 단축</div>
          <div className="sim-gauge-active">
            <span>
              선택 시나리오: <b>수작업 {scenario.manualMinutes}분</b> ➔ <b>{activeStep.elapsedSec}초</b> / {scenario.autoSeconds}초
            </span>
            <span className="sim-gauge-pct">{scenario.savedPct}% 시간 단축</span>
          </div>
          <div className="sim-gauge-bar" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={6}>
            <span className="sim-gauge-fill" style={{ width: `${Math.round(((stepIndex + 1) / 6) * 100)}%` }} />
          </div>
        </div>
      </header>

      {/* 재생 컨트롤 & 시나리오 선택 탭 */}
      <section className="sim-controls-panel" aria-label="시뮬레이션 재생 및 시나리오 선택">
        <div className="sim-playback-row">
          <div className="sim-btn-group">
            <button
              type="button"
              className={`sim-btn ${playing ? 'is-active' : 'is-primary'}`}
              onClick={() => { hasInteractedRef.current = true; setPlaying((p) => !p); }}
            >
              {playing ? '⏸ 일시정지' : '▶ 자동 시뮬레이션 재생'}
            </button>
            <button
              type="button"
              className="sim-btn"
              disabled={stepIndex <= 0}
              onClick={() => { setPlaying(false); jumpToStep(stepIndex - 1); }}
            >
              ◀ 이전 단계
            </button>
            <button
              type="button"
              className="sim-btn"
              disabled={stepIndex >= scenario.steps.length - 1}
              onClick={() => { setPlaying(false); jumpToStep(stepIndex + 1); }}
            >
              다음 단계 ▶
            </button>
            <button
              type="button"
              className={`sim-btn ${speed === '1.8x' ? 'is-accent' : ''}`}
              onClick={() => setSpeed((s) => (s === '1x' ? '1.8x' : '1x'))}
              title="재생 속도 전환"
            >
              속도 {speed}
            </button>
            <button type="button" className="sim-btn" onClick={handleReset}>
              ↺ 처음부터
            </button>
          </div>

          <div className="sim-step-status">
            <span className="sim-step-badge">STEP 0{stepIndex + 1} / 06</span>
            <span className="sim-step-name">{NODES[stepIndex]?.short}</span>
            <span className="sim-step-chip">{activeStep.chip}</span>
          </div>
        </div>

        <div className="sim-scenario-tabs" role="tablist" aria-label="3대 실전 시나리오">
          {SCENARIOS.map((sc) => {
            const on = sc.id === scenario.id;
            return (
              <button
                key={sc.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`sim-sc-tab ${on ? 'is-on' : ''}`}
                onClick={() => handleSelectScenario(sc.id)}
              >
                <span className="sim-sc-badge">{sc.badge}</span>
                <span className="sim-sc-title">{sc.title}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. 중앙 메인 영역: 6단계 모션그래픽 블루프린트 캔버스 + 인터랙티브 듀얼 디바이스 목업 */}
      <section className="sim-main-grid" aria-label="6단계 모션그래픽 아키텍처 및 실시간 디바이스 시뮬레이터">
        {/* 좌측: SVG 모션그래픽 도면 + 라이브 텔레메트리 콘솔 */}
        <div className="sim-canvas-card">
          <div className="sim-panel-head">
            <div>
              <span className="sim-kicker">6-STEP FIBER-OPTIC MOTION BLUEPRINT · INTERRUPTIBLE</span>
              <h3>실시간 데이터 패킷 경로 (노드 클릭 시 해당 단계로 즉시 점프)</h3>
            </div>
            <span className="sim-live-pill">
              <i className="sim-dot" /> {playing ? `AUTO ${speed}` : 'MANUAL STEP'}
            </span>
          </div>

          <div className="sim-svg-wrap">
            <svg
              className="sim-svg"
              viewBox="0 0 980 340"
              role="img"
              aria-label="6단계 통합 솔루션 모션그래픽 아키텍처 도면"
            >
              <defs>
                <pattern id="simGrid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1b2434" strokeWidth="1" />
                </pattern>
                <filter id="simGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <rect x="0" y="0" width="980" height="340" rx="12" fill="#0b1019" />
              <rect x="0" y="0" width="980" height="340" rx="12" fill="url(#simGrid)" />

              {/* 중앙 광섬유 트렁크 라벨 */}
              <rect x="372" y="157" width="236" height="24" rx="12" fill="#121a28" stroke="#263449" />
              <text x="490" y="173" textAnchor="middle" fill="#7dd3fc" fontSize="11" fontWeight="700">
                WSS 역터널 ➔ HERMES AI 3단위 매칭 버스
              </text>

              {/* 연결 광섬유 경로 및 패킷 애니메이션 */}
              {EDGE_PATHS.map((d, edgeIdx) => {
                const completed = stepIndex > edgeIdx;
                const activeEdge = stepIndex === edgeIdx + 1 || (stepIndex === edgeIdx && playing);
                const pathId = `sim-edge-${edgeIdx}`;
                return (
                  <g key={pathId}>
                    <path d={d} fill="none" stroke="#1e293b" strokeWidth="5" strokeLinecap="round" />
                    <path
                      id={pathId}
                      d={d}
                      fill="none"
                      stroke={completed || activeEdge ? '#22d3ee' : '#2c3a4f'}
                      strokeWidth={completed || activeEdge ? '3' : '2'}
                      strokeLinecap="round"
                      className={completed || activeEdge ? 'sim-fiber-flow' : ''}
                    />
                    {!reducedMotion && (activeEdge || completed) && (
                      <circle r={activeEdge ? 5.5 : 3.5} fill={activeEdge ? '#67e8f9' : '#34d399'} filter="url(#simGlow)">
                        <animateMotion dur={speed === '1.8x' ? '0.85s' : '1.4s'} repeatCount="indefinite">
                          <mpath href={`#${pathId}`} />
                        </animateMotion>
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* 6개 인터랙티브 아키텍처 노드 */}
              {NODES.map((node, idx) => {
                const isActive = idx === stepIndex;
                const isDone = idx < stepIndex || (idx === 5 && isApproved);
                const stepInfo = scenario.steps[idx];
                const stateLabel = isActive ? '실행 중' : isDone ? '완료' : '대기';
                return (
                  <g
                    key={node.id}
                    className={`sim-node-g ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                    style={{ transformOrigin: `${node.cx}px ${node.cy}px`, cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.short} 단계로 이동`}
                    aria-pressed={isActive}
                    onClick={() => jumpToStep(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        jumpToStep(idx);
                      }
                    }}
                  >
                    {isActive && (
                      <rect
                        x={node.x - 5}
                        y={node.y - 5}
                        width={node.w + 10}
                        height={node.h + 10}
                        rx="15"
                        fill="none"
                        stroke={node.accent}
                        strokeWidth="2"
                        className="sim-node-pulse"
                      />
                    )}
                    <rect
                      x={node.x}
                      y={node.y}
                      width={node.w}
                      height={node.h}
                      rx="11"
                      fill={isActive ? '#142033' : isDone ? '#101b28' : '#111824'}
                      stroke={isActive ? node.accent : isDone ? '#34d399' : '#263348'}
                      strokeWidth={isActive ? '2.2' : '1.4'}
                    />
                    {/* 상단 컬러 액센트 바 */}
                    <rect x={node.x + 12} y={node.y + 11} width="8" height="16" rx="4" fill={node.accent} />
                    <text x={node.x + 26} y={node.y + 23} fill="#94a3b8" fontSize="10.5" fontWeight="600">
                      {node.surface}
                    </text>

                    {/* 상태 뱃지 */}
                    <rect
                      x={node.x + node.w - 64}
                      y={node.y + 10}
                      width="52"
                      height="18"
                      rx="9"
                      fill={isActive ? '#0c4a6e' : isDone ? '#064e3b' : '#1e293b'}
                    />
                    <text
                      x={node.x + node.w - 38}
                      y={node.y + 22}
                      textAnchor="middle"
                      fill={isActive ? '#7dd3fc' : isDone ? '#6ee7b7' : '#94a3b8'}
                      fontSize="10"
                      fontWeight="700"
                    >
                      {stateLabel}
                    </text>

                    <text x={node.x + 14} y={node.y + 53} fill="#f1f5f9" fontSize="12.5" fontWeight="700">
                      {node.short}
                    </text>

                    <rect x={node.x + 14} y={node.y + 68} width={node.w - 28} height="24" rx="6" fill="#0b111c" stroke="#1e293b" />
                    <text x={node.x + 22} y={node.y + 84} fill={isActive ? '#67e8f9' : '#cbd5e1'} fontSize="11" fontFamily="monospace">
                      {stepInfo?.chip || ''}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* 6단계 핵심 페이로드 요약 인덱스 */}
          <div className="sim-payload-strip" aria-label="패킷 핵심 계약 토큰">
            <span><code>dedup_key</code> 무중복 해시</span>
            <span><code>ProdKey=1042</code> 마스터 매칭</span>
            <span><code>OutQuantity=100</code> 3단위 환산</span>
            <span><code>ApprovedBy</code> 2FA 승인 게이트</span>
            <span><code>BEGIN TRAN UPDLOCK</code> 원장 잠금</span>
          </div>

          {/* 라이브 텔레메트리 콘솔 */}
          <div className="sim-console" aria-live="polite">
            <div className="sim-console-head">
              <b>LIVE TELEMETRY CONSOLE · STEP 0{stepIndex + 1}</b>
              <span>{activeStep.action}</span>
            </div>
            <pre className="sim-console-body">{visibleTelemetry}</pre>
          </div>
        </div>

        {/* 우측: 실시간 연동 듀얼 디바이스 시뮬레이터 */}
        <div className="sim-devices-col">
          {/* 디바이스 1: Device Hub 30fps 공용폰 뷰 */}
          <article className="sim-device-card" aria-label="Device Hub 30fps 공용폰 뷰">
            <div className="sim-device-head">
              <b>{scenario.phoneHeader}</b>
              <span className={`sim-fps-pill ${stepIndex <= 2 ? 'is-scan' : ''}`}>
                {stepIndex <= 2 ? 'SCANNING · 30fps' : scenario.id === 'human_lease' && stepIndex < 4 ? 'WAITING_HUMAN' : 'SYNCED · 30fps'}
              </span>
            </div>

            <div className="sim-phone-screen">
              <div className="sim-phone-bar">
                <span>{scenario.phoneTitle}</span>
                <span>{scenario.phoneSub}</span>
              </div>

              <div className="sim-phone-body">
                {scenario.phoneLines.map((line, i) => (
                  <div key={i} className={`sim-phone-row ${stepIndex >= i ? 'is-lit' : ''}`}>
                    <span className="sim-phone-tag">{line.tag}</span>
                    <span>{line.text}</span>
                  </div>
                ))}

                {/* Step 1~3 OCR/접근성 트리 바운딩박스 */}
                {stepIndex <= 2 && scenario.scanBoxes.map((b, i) => (
                  <div
                    key={i}
                    className="sim-ocr-box"
                    style={{ top: b.top, left: b.left, width: b.width, height: b.height }}
                  >
                    <span>{b.label}</span>
                  </div>
                ))}

                {/* Step 1~3 레이저 스캔 빔 */}
                {stepIndex <= 2 && <div className="sim-scan-beam" aria-hidden="true" />}
              </div>
            </div>
          </article>

          {/* 디바이스 2: MOYI 모바일 앱 승인 카드 */}
          <article className="sim-device-card sim-moyi-card" aria-label="MOYI 모바일 앱 승인 카드">
            <div className="sim-device-head">
              <b>{scenario.moyiCard.room}</b>
              <span className={`sim-fps-pill ${stepIndex === 4 && !isApproved ? 'is-wait' : isApproved || stepIndex === 5 ? 'is-done' : ''}`}>
                {isApproved || stepIndex === 5 ? '원장 커밋 완료' : stepIndex === 4 ? '승인 대기' : 'DRAFT 준비 중'}
              </span>
            </div>

            <div className="sim-moyi-body">
              {stepIndex < 4 && !isApproved && (
                <div className="sim-moyi-standby">
                  <div className="sim-moyi-step-hint">현재 Step 0{stepIndex + 1} 진행 중</div>
                  <p>Step 05(MOYI 승인 게이트)에 도달하면 아래 대화방 승인 카드가 슬라이드 업 되어 직접 원장 커밋을 실행할 수 있습니다.</p>
                </div>
              )}

              {(stepIndex >= 4 || isApproved) && (
                <div className="sim-approval-sheet sim-card-slideup">
                  <div className="sim-approval-title">{scenario.moyiCard.title}</div>
                  <div className="sim-approval-kv">
                    <div><b>대상 품목/기기</b><span>{scenario.moyiCard.item}</span></div>
                    <div><b>환산/조치 내역</b><span>{scenario.moyiCard.qtySummary}</span></div>
                    <div><b>보안 게이트</b><code>{scenario.moyiCard.meta}</code></div>
                  </div>

                  {stepIndex === 4 && !isApproved && (
                    <button
                      type="button"
                      className="sim-approve-btn"
                      onClick={handleApprove}
                    >
                      [✓ MOYI 승인 실행]
                    </button>
                  )}

                  {(stepIndex === 5 || isApproved) && (
                    <div className="sim-receipt-box" role="status">
                      <div className="sim-receipt-top">
                        <b>✓ {scenario.moyiCard.receiptTitle}</b>
                        <code>{scenario.moyiCard.txId}</code>
                      </div>
                      <div className="sim-receipt-body">{scenario.moyiCard.receiptBody}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* 3. 실제 직원 작업 캡처 데이터 직결 섹션 */}
      <section className="sim-evidence-section" aria-label="실제 직원 작업 캡처 데이터 직결">
        <div className="sim-evidence-head">
          <div>
            <div className="sim-eyebrow">REAL WORK CAPTURE EVIDENCE STRIP · LIVE ERP &amp; ORBIT API</div>
            <h3>실제 직원 작업 캡처 데이터 직결 &amp; 수작업 ↔ 자동화 실측 대조</h3>
          </div>

          <div className="sim-person-picker">
            <label htmlFor="sim-staff-select">직원 전환</label>
            <select
              id="sim-staff-select"
              value={selectedPerson?.name || ''}
              onChange={(e) => setSelectedPersonName(e.target.value)}
            >
              {peopleList.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.dept || '소속'}{p.uid ? ' · 캡처연결' : ''})
                </option>
              ))}
            </select>
            <span className={`sim-source-badge ${thumbsState.mode === 'live' ? 'is-live' : ''}`}>
              {thumbsState.mode === 'live'
                ? `실제 캡처 ${thumbsState.items.length}건 연동`
                : '로컬/미연결 폴백 — 저장소 실측 근거 표시'}
            </span>
          </div>
        </div>

        {/* 선택된 직원의 역할·업무 요약 */}
        {selectedPerson && (
          <div className="sim-person-summary">
            <div>
              <b>{selectedPerson.name}</b> <span className="sim-dept-chip">{selectedPerson.dept || '전사'}</span>
              <span className="sim-role-text">{selectedPerson.roleSummary || '실제 업무 흐름 관찰 기반 자동화 대상'}</span>
            </div>
            <div className="sim-wf-chips">
              {arr(selectedPerson.workflows).slice(0, 4).map((w, idx) => (
                <span key={idx} className="sim-wf-chip">
                  {w.name}{w.frequency ? ` · ${w.frequency}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="sim-evidence-grid">
          {/* 좌측: 실제 캡처 썸네일 필름스트립 + 시안색 AI 바운딩박스 */}
          <div className="sim-evidence-panel">
            <div className="sim-panel-subhead">
              <b>실제 화면 캡처 썸네일 &amp; AI 바운딩박스 오버레이</b>
              <span>/api/work/orbit-thumbs (최근 7일 · {selectedPerson?.uid ? `uid=${selectedPerson.uid}` : 'uid 미연결'})</span>
            </div>

            {thumbsState.loading && <p className="sim-dim">캡처 화면 및 인식 좌표 불러오는 중…</p>}

            {!thumbsState.loading && activeRecordsWithBoxes.length > 0 && (
              <div className="sim-bbox-grid">
                {activeRecordsWithBoxes.slice(0, 4).map((rec) => {
                  const boxes = extractBoxes(rec);
                  return (
                    <div
                      key={rec.id}
                      className="sim-bbox-card"
                      onClick={() => setShotModal({ id: rec.id, title: rec.screen || rec.app, boxes, ts: rec.timestamp })}
                    >
                      <div className="sim-bbox-frame">
                        <img
                          loading="lazy"
                          src={`/api/work/orbit-thumbs?img=${encodeURIComponent(rec.id)}`}
                          alt={rec.screen || rec.app || '실제 캡처'}
                        />
                        {boxes.map((b, k) => {
                          const [x0, y0, x1, y1] = b.box;
                          return (
                            <span
                              key={k}
                              className="sim-ai-bbox"
                              style={{
                                left: `${x0 / 10}%`,
                                top: `${y0 / 10}%`,
                                width: `${Math.max(1, (x1 - x0) / 10)}%`,
                                height: `${Math.max(1, (y1 - y0) / 10)}%`,
                              }}
                              title={b.label}
                            >
                              <em>{b.no}. {String(b.label).slice(0, 14)}</em>
                            </span>
                          );
                        })}
                      </div>
                      <div className="sim-bbox-meta">
                        <span>{fmtTs(rec.timestamp)}</span>
                        <b>{rec.screen || rec.app || '화면 기록'}</b>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!thumbsState.loading && thumbsState.items.length > 0 && (
              <div className="sim-filmstrip" aria-label="실제 캡처 필름스트립">
                {thumbsState.items.map((t) => (
                  <figure
                    key={t.id}
                    className="sim-thumb-card"
                    onClick={() => setShotModal({ id: t.id, title: t.screen || t.app, boxes: [], ts: t.timestamp })}
                  >
                    <img
                      loading="lazy"
                      src={`/api/work/orbit-thumbs?img=${encodeURIComponent(t.id)}`}
                      alt={t.screen || t.app || '캡처 썸네일'}
                    />
                    <figcaption>
                      <span>{fmtTs(t.timestamp)}</span>
                      <b>{t.app}</b>
                      <small>{t.screen || t.activity}</small>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            {!thumbsState.loading && thumbsState.items.length === 0 && (
              <div className="sim-fallback-box">
                <div className="sim-fallback-head">
                  <b>캡처 이미지 0건 / 오프라인 폴백 안내</b>
                  <span>{thumbsState.error || 'Orbit 서버 토큰 미설정 또는 최근 7일 해독 캡처 0건'}</span>
                </div>
                <p>
                  운영 환경(nenovaSS3 로그인 + Orbit 연결)에서는 이 영역에 직원별 실제 화면 캡처 필름스트립과
                  <code>steps[].box</code> 천분율 좌표 기반 시안색 AI 바운딩박스가 자동 오버레이됩니다.
                  현재는 저장소의 실측 워크플로우·제안·시뮬레이션 근거로 대체 표시 중입니다.
                </p>
              </div>
            )}
          </div>

          {/* 우측: Before vs After 실측 비교 */}
          <div className="sim-evidence-panel">
            <div className="sim-panel-subhead">
              <b>Before (수작업) vs After (기능 적용 후) 실측 비교</b>
              <span>
                {activeSimulation.isLive ? '실측 simulations 데이터' : '저장소 기준 실측 폴백'} · {activeSimulation.personName}
              </span>
            </div>

            {activeSimulation.item ? (
              <div className="sim-compare-wrap">
                <div className="sim-compare-title">
                  <b>{activeSimulation.item.title}</b>
                  {activeSimulation.item.menu && <span>{activeSimulation.item.menu}</span>}
                </div>
                <div className="sim-compare-cols">
                  <div className="sim-compare-col is-before">
                    <div className="sim-compare-top">
                      <b>지금 (수작업)</b>
                      <span>{simBefore.totalMinutes ?? '—'}분 / 건</span>
                    </div>
                    <ol>
                      {beforeSteps.map((st, idx) => (
                        <li key={idx}>
                          <b>{st.action}</b> <small>({st.app} · {st.minutes}분)</small>
                          {st.pain && <div className="sim-pain-note">주의: {st.pain}</div>}
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="sim-compare-col is-after">
                    <div className="sim-compare-top">
                      <b>자동화 + MOYI 적용 후</b>
                      <span>{simAfter.totalMinutes ?? '—'}분 / 건</span>
                    </div>
                    <ol>
                      {afterSteps.map((st, idx) => (
                        <li key={idx}>
                          <b>{st.action}</b> <small>({st.minutes}분{st.auto ? ' · 자동' : ''})</small>
                        </li>
                      ))}
                    </ol>
                    {activeSimulation.item.savingPerWeekMin != null && (
                      <div className="sim-week-save">
                        주간 절감 실측: <b>약 {(Number(activeSimulation.item.savingPerWeekMin) / 60).toFixed(1)}시간</b> ({activeSimulation.item.savingPerWeekMin}분/주)
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="sim-dim">비교 가능한 시뮬레이션 항목이 없습니다.</p>
            )}
          </div>
        </div>
      </section>

      {/* 4. 하단 비주얼 도면 갤러리 & Archify 인터랙티브 전체 도면 탭 */}
      <section className="sim-gallery-section" aria-label="비주얼 도면 및 인터랙티브 설계도">
        <div className="sim-gallery-head">
          <div className="sim-gallery-tabs" role="tablist" aria-label="도면 보기 전환">
            <button
              type="button"
              role="tab"
              aria-selected={galleryTab === 'blueprints'}
              className={`sim-gtab ${galleryTab === 'blueprints' ? 'is-on' : ''}`}
              onClick={() => setGalleryTab('blueprints')}
            >
              3D 블루프린트 도면 3종
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={galleryTab === 'archify'}
              className={`sim-gtab ${galleryTab === 'archify' ? 'is-on' : ''}`}
              onClick={() => setGalleryTab('archify')}
            >
              Archify 인터랙티브 트레이스 설계도
            </button>
          </div>

          <div className="sim-gallery-actions">
            {orbit && (
              <a className="sim-ext-link" href={`${orbit}/my-work.html${orbitQs}`} target="_blank" rel="noreferrer">
                Orbit 원본 작업 데이터 ↗
              </a>
            )}
            <a
              className="sim-ext-link is-highlight"
              href="/api/my-work/feature?name=suite-blueprint-html"
              target="_blank"
              rel="noreferrer"
            >
              새 창에서 전체화면 / PNG·SVG·WebM 내보내기 ↗
            </a>
          </div>
        </div>

        {galleryTab === 'blueprints' && (
          <div className="sim-bp-grid">
            {BLUEPRINT_GALLERY.map((bp) => (
              <article key={bp.id} className="sim-bp-card">
                <div
                  className="sim-bp-img-wrap"
                  role="button"
                  tabIndex={0}
                  aria-label={`${bp.title} 크게 보기`}
                  onClick={() => setLightbox(bp)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(bp); } }}
                >
                  <img src={bp.src} alt={bp.title} loading="lazy" />
                  <span className="sim-bp-zoom">클릭하여 확대 보기 🔍</span>
                </div>
                <div className="sim-bp-content">
                  <span className="sim-bp-badge">{bp.badge}</span>
                  <h4>{bp.title}</h4>
                  <p className="sim-bp-sub">{bp.subtitle}</p>
                  <ul>
                    {bp.callouts.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        )}

        {galleryTab === 'archify' && (
          <div className="sim-archify-wrap">
            <iframe
              title="통합 솔루션 인터랙티브 설계도"
              src="/api/my-work/feature?name=suite-blueprint-html"
              className="sim-archify-iframe"
            />
          </div>
        )}
      </section>

      {/* 3D 블루프린트 라이트박스 모달 */}
      {lightbox && (
        <div className="sim-modal-backdrop" role="dialog" aria-modal="true" aria-label={lightbox.title} onClick={() => setLightbox(null)}>
          <div className="sim-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="sim-modal-head">
              <div>
                <span className="sim-bp-badge">{lightbox.badge}</span>
                <h4>{lightbox.title}</h4>
              </div>
              <button type="button" className="sim-btn" onClick={() => setLightbox(null)}>닫기 ×</button>
            </div>
            <img src={lightbox.src} alt={lightbox.title} className="sim-modal-img" />
            <ul className="sim-modal-callouts">
              {lightbox.callouts.map((c, idx) => <li key={idx}>{c}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* 실작업 캡처 확대 모달 */}
      {shotModal && (
        <div className="sim-modal-backdrop" role="dialog" aria-modal="true" aria-label={shotModal.title} onClick={() => setShotModal(null)}>
          <div className="sim-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="sim-modal-head">
              <div>
                <span className="sim-bp-badge">{fmtTs(shotModal.ts) || '실제 화면 캡처'}</span>
                <h4>{shotModal.title}</h4>
              </div>
              <button type="button" className="sim-btn" onClick={() => setShotModal(null)}>닫기 ×</button>
            </div>
            <div className="sim-bbox-frame is-large">
              <img src={`/api/work/orbit-thumbs?img=${encodeURIComponent(shotModal.id)}`} alt={shotModal.title || '캡처'} />
              {arr(shotModal.boxes).map((b, k) => {
                const [x0, y0, x1, y1] = b.box;
                return (
                  <span
                    key={k}
                    className="sim-ai-bbox"
                    style={{
                      left: `${x0 / 10}%`,
                      top: `${y0 / 10}%`,
                      width: `${Math.max(1, (x1 - x0) / 10)}%`,
                      height: `${Math.max(1, (y1 - y0) / 10)}%`,
                    }}
                  >
                    <em>{b.no}. {b.label}</em>
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .sim-studio {
          max-width: 1520px;
          margin: 0 auto;
          padding: 18px 22px 48px;
          color: #e7eaf0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .sim-topbar {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          gap: 16px;
          flex-wrap: wrap;
          background: linear-gradient(135deg, #101724 0%, #151e2f 100%);
          border: 1px solid #263449;
          border-radius: 14px;
          padding: 16px 20px;
        }
        .sim-title-block {
          flex: 1 1 520px;
          min-width: 0;
        }
        .sim-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.09em;
          color: #38bdf8;
          margin-bottom: 4px;
        }
        .sim-title-block h2 {
          margin: 0 0 6px;
          font-size: 20px;
          color: #f8fafc;
        }
        .sim-subtitle {
          margin: 0;
          font-size: 13px;
          color: #94a3b8;
          line-height: 1.5;
          max-width: 78ch;
        }
        .sim-gauge-card {
          flex: 0 1 450px;
          min-width: 280px;
          background: #0b1019;
          border: 1px solid #263449;
          border-left: 4px solid #34d399;
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          justify-content: center;
        }
        .sim-gauge-label {
          font-size: 11px;
          font-weight: 700;
          color: #94a3b8;
        }
        .sim-gauge-headline {
          font-size: 14px;
          font-weight: 700;
          color: #6ee7b7;
        }
        .sim-gauge-active {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: #cbd5e1;
        }
        .sim-gauge-pct {
          color: #38bdf8;
          font-weight: 700;
        }
        .sim-gauge-bar {
          height: 6px;
          border-radius: 999px;
          background: #1e293b;
          overflow: hidden;
        }
        .sim-gauge-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #38bdf8, #34d399);
          transition: width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .sim-controls-panel {
          background: #121824;
          border: 1px solid #263144;
          border-radius: 12px;
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sim-playback-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .sim-btn-group {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .sim-btn {
          background: #1a2333;
          color: #cbd5e1;
          border: 1px solid #2e3b52;
          border-radius: 8px;
          padding: 6px 12px;
          font: inherit;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.15s;
        }
        .sim-btn:hover:not(:disabled) {
          border-color: #38bdf8;
          color: #fff;
        }
        .sim-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .sim-btn.is-primary {
          background: #0c4a6e;
          border-color: #38bdf8;
          color: #f0f9ff;
        }
        .sim-btn.is-active {
          background: #064e3b;
          border-color: #34d399;
          color: #ecfdf5;
        }
        .sim-btn.is-accent {
          background: #312e81;
          border-color: #818cf8;
          color: #eef2ff;
        }
        .sim-step-status {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-step-badge {
          background: #0f172a;
          border: 1px solid #38bdf8;
          color: #38bdf8;
          border-radius: 999px;
          padding: 2px 10px;
          font-size: 11px;
          font-weight: 700;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .sim-step-name {
          font-weight: 700;
          font-size: 13px;
          color: #f8fafc;
        }
        .sim-step-chip {
          font-size: 11.5px;
          color: #94a3b8;
          background: #1a2232;
          border: 1px solid #2a364b;
          border-radius: 6px;
          padding: 2px 8px;
        }
        .sim-scenario-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .sim-sc-tab {
          text-align: left;
          background: #0e1420;
          border: 1px solid #263144;
          border-radius: 10px;
          padding: 10px 12px;
          color: #cbd5e1;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: border-color 0.2s, background 0.2s, transform 0.2s;
        }
        .sim-sc-tab:hover {
          border-color: #38bdf8;
        }
        .sim-sc-tab.is-on {
          background: #132238;
          border-color: #38bdf8;
          box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.35);
          color: #f8fafc;
        }
        .sim-sc-badge {
          font-size: 11px;
          font-weight: 700;
          color: #38bdf8;
        }
        .sim-sc-title {
          font-size: 12px;
          line-height: 1.45;
        }

        .sim-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.4fr) minmax(350px, 0.92fr);
          gap: 14px;
          align-items: start;
        }
        .sim-canvas-card {
          background: #121824;
          border: 1px solid #263144;
          border-radius: 12px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sim-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sim-kicker {
          display: block;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: #38bdf8;
          margin-bottom: 2px;
        }
        .sim-panel-head h3 {
          margin: 0;
          font-size: 15px;
          color: #f8fafc;
        }
        .sim-live-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: #6ee7b7;
          background: #064e3b;
          border: 1px solid #10b981;
          border-radius: 999px;
          padding: 2px 10px;
        }
        .sim-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #34d399;
          animation: sim-blink 1.2s ease-in-out infinite;
        }
        .sim-svg-wrap {
          border: 1px solid #243044;
          border-radius: 12px;
          overflow: hidden;
          background: #0b1019;
        }
        .sim-svg {
          width: 100%;
          height: auto;
          display: block;
        }
        .sim-fiber-flow {
          stroke-dasharray: 8 6;
          animation: sim-fiber 1.1s linear infinite;
        }
        .sim-node-g {
          transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .sim-node-g.is-active {
          transform: scale(1.03);
        }
        .sim-node-pulse {
          animation: sim-pulse 1.5s ease-out infinite;
        }
        .sim-payload-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11.5px;
          color: #94a3b8;
        }
        .sim-payload-strip span {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 6px;
          padding: 3px 8px;
        }
        .sim-payload-strip code {
          color: #38bdf8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-weight: 700;
          margin-right: 4px;
        }
        .sim-console {
          background: #090d14;
          border: 1px solid #243044;
          border-radius: 10px;
          overflow: hidden;
        }
        .sim-console-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 8px 12px;
          background: #101725;
          border-bottom: 1px solid #1f2a3d;
          font-size: 11.5px;
        }
        .sim-console-head b {
          color: #38bdf8;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .sim-console-head span {
          color: #cbd5e1;
        }
        .sim-console-body {
          margin: 0;
          padding: 10px 12px;
          min-height: 76px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11.5px;
          line-height: 1.55;
          color: #67e8f9;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .sim-devices-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sim-device-card {
          background: #121824;
          border: 1px solid #263144;
          border-radius: 12px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sim-device-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
        }
        .sim-fps-pill {
          font-size: 10.5px;
          font-weight: 700;
          border-radius: 999px;
          padding: 2px 9px;
          background: #1e293b;
          color: #94a3b8;
          border: 1px solid #334155;
        }
        .sim-fps-pill.is-scan {
          background: #083344;
          color: #67e8f9;
          border-color: #22d3ee;
        }
        .sim-fps-pill.is-wait {
          background: #422006;
          color: #fcd34d;
          border-color: #f59e0b;
        }
        .sim-fps-pill.is-done {
          background: #064e3b;
          color: #6ee7b7;
          border-color: #34d399;
        }
        .sim-phone-screen {
          background: #070b12;
          border: 2px solid #2a374f;
          border-radius: 14px;
          overflow: hidden;
        }
        .sim-phone-bar {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 7px 10px;
          background: #121b2b;
          border-bottom: 1px solid #223047;
          font-size: 11px;
          color: #94a3b8;
        }
        .sim-phone-bar span:first-child {
          font-weight: 700;
          color: #f1f5f9;
        }
        .sim-phone-body {
          position: relative;
          padding: 14px 12px;
          min-height: 146px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: hidden;
        }
        .sim-phone-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
          background: #0f1623;
          border: 1px solid #1e2b40;
          border-radius: 8px;
          padding: 7px 9px;
          font-size: 11.5px;
          color: #94a3b8;
          position: relative;
          z-index: 1;
        }
        .sim-phone-row.is-lit {
          border-color: #22d3ee;
          color: #f8fafc;
        }
        .sim-phone-tag {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10px;
          font-weight: 700;
          color: #22d3ee;
          background: rgba(34, 211, 238, 0.14);
          border-radius: 4px;
          padding: 1px 5px;
          flex: 0 0 auto;
        }
        .sim-ocr-box {
          position: absolute;
          border: 1.5px dashed #22d3ee;
          background: rgba(34, 211, 238, 0.08);
          border-radius: 6px;
          pointer-events: none;
          z-index: 2;
        }
        .sim-ocr-box span {
          position: absolute;
          top: -9px;
          right: 6px;
          background: #083344;
          color: #67e8f9;
          font-size: 9.5px;
          font-weight: 700;
          padding: 0 5px;
          border-radius: 4px;
        }
        .sim-scan-beam {
          position: absolute;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, transparent, #22d3ee, #a5f3fc, #22d3ee, transparent);
          box-shadow: 0 0 14px 3px rgba(34, 211, 238, 0.65);
          animation: sim-scan-beam 1.8s ease-in-out infinite;
          z-index: 3;
          pointer-events: none;
        }

        .sim-moyi-body {
          min-height: 148px;
          display: flex;
          flex-direction: column;
        }
        .sim-moyi-standby {
          background: #0c111b;
          border: 1px dashed #29364d;
          border-radius: 10px;
          padding: 14px;
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.55;
        }
        .sim-moyi-step-hint {
          font-weight: 700;
          color: #38bdf8;
          margin-bottom: 4px;
        }
        .sim-approval-sheet {
          background: #0d1624;
          border: 1px solid #2e4566;
          border-top: 3px solid #34d399;
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sim-card-slideup {
          animation: sim-slide-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .sim-approval-title {
          font-weight: 700;
          font-size: 13px;
          color: #f8fafc;
        }
        .sim-approval-kv {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 11.5px;
        }
        .sim-approval-kv div {
          display: flex;
          gap: 8px;
          align-items: baseline;
          flex-wrap: wrap;
        }
        .sim-approval-kv b {
          color: #94a3b8;
          min-width: 82px;
        }
        .sim-approval-kv code {
          color: #7dd3fc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
        }
        .sim-approve-btn {
          margin-top: 4px;
          background: linear-gradient(90deg, #059669, #10b981);
          color: #ffffff;
          border: 0;
          border-radius: 8px;
          padding: 9px 14px;
          font: inherit;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: transform 0.15s, filter 0.15s;
        }
        .sim-approve-btn:hover {
          filter: brightness(1.08);
          transform: translateY(-1px);
        }
        .sim-receipt-box {
          background: #062c22;
          border: 1px solid #10b981;
          border-radius: 8px;
          padding: 9px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sim-receipt-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 12px;
          color: #6ee7b7;
        }
        .sim-receipt-top code {
          font-size: 11px;
          color: #a7f3d0;
        }
        .sim-receipt-body {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          color: #d1fae5;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .sim-evidence-section, .sim-gallery-section {
          background: #121824;
          border: 1px solid #263144;
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sim-evidence-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 12px;
          flex-wrap: wrap;
        }
        .sim-evidence-head h3 {
          margin: 0;
          font-size: 16px;
          color: #f8fafc;
        }
        .sim-person-picker {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-person-picker label {
          font-size: 12px;
          color: #94a3b8;
          font-weight: 600;
        }
        .sim-person-picker select {
          background: #0b1019;
          color: #f1f5f9;
          border: 1px solid #2f3e56;
          border-radius: 7px;
          padding: 5px 10px;
          font: inherit;
          font-size: 12.5px;
        }
        .sim-source-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 999px;
          background: #272010;
          color: #fbbf24;
          border: 1px solid #92400e;
        }
        .sim-source-badge.is-live {
          background: #064e3b;
          color: #6ee7b7;
          border-color: #10b981;
        }
        .sim-person-summary {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .sim-dept-chip {
          background: #1a263a;
          color: #7dd3fc;
          border-radius: 999px;
          padding: 1px 8px;
          font-size: 11px;
          margin: 0 6px;
        }
        .sim-role-text {
          color: #94a3b8;
        }
        .sim-wf-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .sim-wf-chip {
          font-size: 11px;
          background: #161f30;
          border: 1px solid #29364e;
          border-radius: 6px;
          padding: 2px 8px;
          color: #cbd5e1;
        }
        .sim-evidence-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
          gap: 12px;
        }
        .sim-evidence-panel {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 10px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .sim-panel-subhead {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12px;
        }
        .sim-panel-subhead b {
          color: #f8fafc;
        }
        .sim-panel-subhead span {
          color: #94a3b8;
          font-size: 11px;
        }
        .sim-bbox-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .sim-bbox-card {
          border: 1px solid #29374f;
          border-radius: 8px;
          overflow: hidden;
          background: #080c14;
          cursor: pointer;
        }
        .sim-bbox-frame {
          position: relative;
          line-height: 0;
        }
        .sim-bbox-frame img {
          width: 100%;
          display: block;
          aspect-ratio: 16 / 10;
          object-fit: cover;
        }
        .sim-bbox-frame.is-large img {
          aspect-ratio: auto;
          max-height: 70vh;
          object-fit: contain;
        }
        .sim-ai-bbox {
          position: absolute;
          border: 2px solid #22d3ee;
          background: rgba(34, 211, 238, 0.14);
          border-radius: 3px;
          pointer-events: none;
        }
        .sim-ai-bbox em {
          position: absolute;
          top: -16px;
          left: 0;
          background: #083344;
          color: #67e8f9;
          font-style: normal;
          font-size: 10px;
          font-weight: 700;
          padding: 0 5px;
          border-radius: 3px;
          white-space: nowrap;
        }
        .sim-bbox-meta {
          padding: 6px 8px;
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 11px;
          color: #cbd5e1;
        }
        .sim-bbox-meta span {
          color: #38bdf8;
          white-space: nowrap;
        }
        .sim-bbox-meta b {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sim-filmstrip {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
        }
        .sim-thumb-card {
          flex: 0 0 164px;
          margin: 0;
          border: 1px solid #263348;
          border-radius: 8px;
          overflow: hidden;
          background: #080c14;
          cursor: pointer;
        }
        .sim-thumb-card img {
          width: 100%;
          display: block;
          aspect-ratio: 16 / 10;
          object-fit: cover;
        }
        .sim-thumb-card figcaption {
          padding: 5px 7px;
          display: flex;
          flex-direction: column;
          gap: 1px;
          font-size: 10.5px;
        }
        .sim-thumb-card figcaption span {
          color: #38bdf8;
        }
        .sim-thumb-card figcaption small {
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sim-fallback-box {
          background: #111827;
          border: 1px dashed #334155;
          border-radius: 8px;
          padding: 12px;
          font-size: 12px;
          line-height: 1.55;
          color: #94a3b8;
        }
        .sim-fallback-head {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 4px;
        }
        .sim-fallback-head b {
          color: #fbbf24;
        }
        .sim-fallback-box code {
          color: #67e8f9;
        }
        .sim-compare-wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sim-compare-title {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 12.5px;
        }
        .sim-compare-title span {
          color: #38bdf8;
          font-size: 11.5px;
        }
        .sim-compare-cols {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .sim-compare-col {
          background: #121824;
          border: 1px solid #263144;
          border-radius: 8px;
          padding: 10px;
          font-size: 12px;
        }
        .sim-compare-col.is-before {
          border-left: 3px solid #f87171;
        }
        .sim-compare-col.is-after {
          border-left: 3px solid #34d399;
        }
        .sim-compare-top {
          display: flex;
          justify-content: space-between;
          margin-bottom: 6px;
          font-size: 12px;
        }
        .sim-compare-col.is-before .sim-compare-top span {
          color: #fca5a5;
          font-weight: 700;
        }
        .sim-compare-col.is-after .sim-compare-top span {
          color: #6ee7b7;
          font-weight: 700;
        }
        .sim-compare-col ol {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .sim-compare-col small {
          color: #94a3b8;
        }
        .sim-pain-note {
          color: #fca5a5;
          font-size: 11px;
        }
        .sim-week-save {
          margin-top: 8px;
          padding-top: 6px;
          border-top: 1px dashed #283549;
          color: #6ee7b7;
          font-size: 12px;
        }

        .sim-gallery-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sim-gallery-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-gtab {
          background: #0d131f;
          color: #94a3b8;
          border: 1px solid #263348;
          border-radius: 8px;
          padding: 7px 14px;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }
        .sim-gtab.is-on {
          background: #13253e;
          border-color: #38bdf8;
          color: #f8fafc;
        }
        .sim-gallery-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-ext-link {
          font-size: 12px;
          font-weight: 600;
          color: #cbd5e1;
          border: 1px solid #2d3b52;
          border-radius: 8px;
          padding: 6px 11px;
          text-decoration: none;
          background: #151e2e;
        }
        .sim-ext-link.is-highlight {
          color: #7dd3fc;
          border-color: #0284c7;
          background: #0c263b;
        }
        .sim-bp-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }
        .sim-bp-card {
          background: #0d131f;
          border: 1px solid #222e42;
          border-radius: 10px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .sim-bp-img-wrap {
          position: relative;
          cursor: zoom-in;
          background: #070b12;
          border-bottom: 1px solid #222e42;
        }
        .sim-bp-img-wrap img {
          width: 100%;
          display: block;
          aspect-ratio: 16 / 10;
          object-fit: cover;
        }
        .sim-bp-zoom {
          position: absolute;
          right: 8px;
          bottom: 8px;
          background: rgba(11, 16, 25, 0.85);
          border: 1px solid #38bdf8;
          color: #e0f2fe;
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
        }
        .sim-bp-content {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sim-bp-badge {
          align-self: flex-start;
          font-size: 10.5px;
          font-weight: 700;
          color: #38bdf8;
          background: #0c2438;
          border: 1px solid #0369a1;
          border-radius: 999px;
          padding: 1px 8px;
        }
        .sim-bp-content h4 {
          margin: 0;
          font-size: 14px;
          color: #f8fafc;
        }
        .sim-bp-sub {
          margin: 0;
          font-size: 11px;
          color: #7dd3fc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        .sim-bp-content ul {
          margin: 4px 0 0;
          padding-left: 16px;
          font-size: 12px;
          color: #cbd5e1;
          line-height: 1.5;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sim-archify-wrap {
          border: 1px solid #243044;
          border-radius: 10px;
          overflow: hidden;
          background: #0b1019;
        }
        .sim-archify-iframe {
          position: static !important;
          inset: auto !important;
          width: 100%;
          height: 680px !important;
          border: 0;
          display: block;
          background: #0b1019;
        }

        .sim-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(5, 8, 15, 0.82);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          z-index: 60;
        }
        .sim-modal-box {
          background: #111827;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 16px;
          width: min(1120px, 95vw);
          max-height: 92vh;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sim-modal-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .sim-modal-head h4 {
          margin: 4px 0 0;
          font-size: 15px;
          color: #f8fafc;
        }
        .sim-modal-img {
          width: 100%;
          max-height: 70vh;
          object-fit: contain;
          border-radius: 8px;
          background: #070b12;
        }
        .sim-modal-callouts {
          margin: 0;
          padding-left: 18px;
          font-size: 12.5px;
          color: #cbd5e1;
          line-height: 1.55;
        }
        .sim-dim {
          color: #94a3b8;
          font-size: 12px;
        }

        @keyframes sim-fiber {
          from { stroke-dashoffset: 28; }
          to { stroke-dashoffset: 0; }
        }
        @keyframes sim-pulse {
          0% { opacity: 0.9; stroke-width: 2.5; }
          50% { opacity: 0.35; stroke-width: 4.5; }
          100% { opacity: 0.9; stroke-width: 2.5; }
        }
        @keyframes sim-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes sim-scan-beam {
          0% { top: 8%; }
          50% { top: 86%; }
          100% { top: 8%; }
        }
        @keyframes sim-slide-up {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .sim-dot,
          .sim-fiber-flow,
          .sim-node-pulse,
          .sim-scan-beam,
          .sim-card-slideup {
            animation: none !important;
          }
          .sim-node-g,
          .sim-gauge-fill,
          .sim-btn,
          .sim-sc-tab,
          .sim-approve-btn {
            transition: none !important;
          }
        }

        @media (max-width: 1180px) {
          .sim-main-grid,
          .sim-evidence-grid,
          .sim-bp-grid {
            grid-template-columns: 1fr;
          }
          .sim-scenario-tabs {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 720px) {
          .sim-compare-cols,
          .sim-bbox-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
