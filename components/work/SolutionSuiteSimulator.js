// components/work/SolutionSuiteSimulator.js
// MOYI × 네노바 통합 솔루션 라이브 실행 시뮬레이터 (/my-work?tab=suite-sim, 관리자 전용).
// Phone Harness · Device Hub · 데스크톱 Rust 사이드카 · Nenova Kakao · Hermes · MOYI 앱 · 네노바웹 ERP 원장 연동 실연.
import { useEffect, useMemo, useRef, useState } from 'react';

const FONT_SANS = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";

const NODES = [
  {
    id: 'phone_kakao',
    no: '01',
    short: '01 Phone Harness · 카톡 수집',
    surface: 'Surface 1 · 현장 수집',
    x: 16,
    y: 14,
    w: 290,
    h: 110,
    cx: 161,
    cy: 69,
  },
  {
    id: 'device_hub',
    no: '02',
    short: '02 Device Hub · 30fps Lease',
    surface: 'Surface 2 · 기기 관제',
    x: 345,
    y: 14,
    w: 290,
    h: 110,
    cx: 490,
    cy: 69,
  },
  {
    id: 'rust_sidecar',
    no: '03',
    short: '03 Rust 사이드카 · hermes-core',
    surface: 'Surface 2 · WSS/압축',
    x: 674,
    y: 14,
    w: 290,
    h: 110,
    cx: 819,
    cy: 69,
  },
  {
    id: 'hermes_ai',
    no: '04',
    short: '04 Hermes AI · 3단위 환산',
    surface: 'Surface 3 · 지능 매칭',
    x: 16,
    y: 216,
    w: 290,
    h: 110,
    cx: 161,
    cy: 271,
  },
  {
    id: 'moyi_gate',
    no: '05',
    short: '05 MOYI 앱 · 승인 게이트',
    surface: 'Surface 4 · 2FA 승인',
    x: 345,
    y: 216,
    w: 290,
    h: 110,
    cx: 490,
    cy: 271,
  },
  {
    id: 'erp_ledger',
    no: '06',
    short: '06 네노바웹 · MSSQL 원장',
    surface: 'Surface 5 · 공유 원장',
    x: 674,
    y: 216,
    w: 290,
    h: 110,
    cx: 819,
    cy: 271,
  },
];

// 6개 노드를 잇는 직교(90도) 파이프라인 경로 — 중앙 버스 트랙(y=144)과 하단 배지 레인(y=166..196)을 물리적으로 완전 분리
const EDGE_PATHS = [
  'M 306 69 L 339 69',
  'M 635 69 L 668 69',
  'M 819 124 L 819 134 Q 819 144 809 144 L 171 144 Q 161 144 161 154 L 161 210',
  'M 306 271 L 339 271',
  'M 635 271 L 668 271',
];

const ROUTE_ENDPOINTS = [
  { id: 'worker', label: 'core/moyi_worker.py', role: '수집·직렬 락', steps: [0] },
  { id: 'sidecar', label: 'nenova-device-sidecar.exe', role: 'WSS 역터널·pHash', steps: [1, 2] },
  { id: 'nowlink', label: 'api.nowlink.kr', role: 'Hermes 매칭·MOYI 2FA', steps: [3, 4] },
  { id: 'nenovaweb', label: 'nenovaweb', role: 'MSSQL UPDLOCK 원장', steps: [5] },
];

const SCENARIOS = [
  {
    id: 'wechat_order',
    badge: '시나리오 1 · 수입 발주 자동화',
    title: '위챗·카톡 수입 추가발주 → 프리덤 장미 100단 자동 환산 → MOYI 앱 승인 → OrderDetail 반영',
    preferredDept: '수입부',
    preferredNames: ['김원빈', '김지니', '아드리아나', '설연주'],
    manualMinutes: 18.5,
    autoSeconds: 14,
    savedPct: 98.7,
    gaugeHeadline: '수작업 18.5분 → 자동화+MOYI 승인 14초 · 98.7% 단축',
    phoneHeader: '공용폰 #01 · 위챗 수입단톡방 (Read-Only)',
    phoneTitle: '콜롬비아 ELITE 농장방',
    phoneSub: '오후 16:30 · 신규 발주 메시지 수신',
    phoneLines: [
      { tag: 'SENDER', prefix: '', token: 'ELITE_FARM_COL', suffix: ' (수입단톡방)', scanLabel: '위챗 발주방 식별' },
      { tag: 'MSG', prefix: 'ROSE FREEDOM 50CM ', token: '+5 BOX ADD', suffix: ' (46-01차)', scanLabel: '수량 +5 BOX 추출' },
      { tag: 'OCR', prefix: 'ProdKey=1042 · BunchOf1Box=20 · ', token: 'OutQuantity=100단', suffix: '', scanLabel: '3단위 환산 완료' },
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
        stepMs: 1800,
        chip: 'dedup_key 해시 생성',
        sourceInput: '위챗 수입단톡방 "ROSE FREEDOM 50CM +5 BOX ADD (46-01차)"',
        moduleEndpoint: 'core/moyi_worker.py · nenovaweb/api/kakao/import',
        guardLabel: 'Read-Only + SHA-256 중복 차단',
        action: 'Phone Harness가 위챗·카톡 수입단톡방의 추가발주 원문을 읽기 전용으로 수집합니다.',
        telemetry: [
          '[01 PHONE-HARNESS] channel=wechat_read_only · room="콜롬비아 농장방" (deferred_photos 18시·12장 한도 보완)',
          '[01 MOYI-WORKER] core/moyi_worker.py 직렬 락 · sales 5s · addcancel_archive 300s · 운영PC 전담',
          '[01 KAKAO-BRIDGE] dedup_key = sha256("suip-room|elite|1630|rose-freedom-5box|0") · outbound_block=TRUE',
        ],
      },
      {
        nodeIndex: 1,
        elapsedSec: 3.4,
        stepMs: 1600,
        chip: '30fps Lease 잠금',
        sourceInput: 'uiautomator XML node[id="chat_msg_882"] + 30fps 화면 스트림',
        moduleEndpoint: 'api.nowlink.kr/device-hub · WebDeviceLease',
        guardLabel: 'TTL 180s Lease · 고위험 키워드 0건',
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
        stepMs: 1800,
        chip: 'Rust WSS + 압축',
        sourceInput: '정지 프레임 84.2% 제거된 활성 채팅 버퍼 + RapidOCR 좌표',
        moduleEndpoint: 'nenova-device-sidecar.exe · hermes-core.exe',
        guardLabel: 'WSS 역터널 · pHash 압축 84.2%',
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
        stepMs: 3400,
        chip: 'ProdKey=1042 3단위 환산',
        sourceInput: 'OCR 토큰 "+5 BOX" · Product 마스터 (ProdKey=1042, BunchOf1Box=20)',
        moduleEndpoint: 'api.nowlink.kr/hermes · WebDeviceWorkQueue(DRAFT)',
        guardLabel: 'DRAFT 격리 · 본 원장 직접 쓰기 차단',
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
        stepMs: 2800,
        chip: 'ApprovedBy 2FA 게이트',
        sourceInput: 'MOYI 관리자 승인 카드 (IdempotencyKey="w4601-1042-5box")',
        moduleEndpoint: 'api.nowlink.kr/moyi · ApprovedBy 2FA 게이트',
        guardLabel: 'ApprovedBy ≠ ProposedBy 승인 대기',
        action: 'MOYI 모바일 앱 대화방에 승인 카드가 도착해 ApprovedBy ≠ ProposedBy 2차 승인을 대기합니다.',
        telemetry: [
          '[05 MOYI-GATE] push approval card -> room="MOYI 관리자 승인방"',
          '[05 POLICY] ApprovedBy <> ProposedBy check ("nenovaSS3" !== "phone-harness-01")',
          '[05 WAITING] 오른쪽 MOYI 승인 카드의 MOYI 승인 실행 버튼으로 즉시 커밋 가능',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 14.0,
        stepMs: 2600,
        chip: 'BEGIN TRAN UPDLOCK',
        sourceInput: '승인 완료 토큰(ApprovedBy=nenovaSS3) + 4-Key 주문 식별자',
        moduleEndpoint: 'nenovaweb · MSSQL OrderDetail UPDLOCK',
        guardLabel: 'BEGIN TRAN UPDLOCK + safeNextKey()',
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
    title: '창고 현장폰 파손 촬영 → Device Hub·Rust 사이드카 역터널 → OCR 품목 판독(수국 15송이) → MOYI 클레임 승인 → 견적 차감',
    preferredDept: '영업지원',
    preferredNames: ['설연주', '강명훈', '김원빈'],
    manualMinutes: 14.0,
    autoSeconds: 16,
    savedPct: 98.1,
    gaugeHeadline: '수작업 14.0분 → 자동화+MOYI 승인 16초 · 98.1% 단축',
    phoneHeader: '창고 현장폰 #02 · Wi-Fi ADB 카메라',
    phoneTitle: '입고 검수 촬영 · 2번 냉장고',
    phoneSub: '오후 14:12 · 네덜란드 수국 줄기 파손',
    phoneLines: [
      { tag: 'PHOTO', prefix: '', token: 'IMG_4601_HYDRANGEA_DMG.jpg', suffix: ' (3.1MB → 180KB)', scanLabel: '현장 촬영본 확보' },
      { tag: 'LABEL', prefix: 'NL HYDRANGEA MAGICAL GREEN · ', token: '15 STEMS', suffix: '', scanLabel: '박스 라벨 판독' },
      { tag: 'OCR', prefix: 'ProdKey=2218 · OutUnit=송이 · ', token: 'DefectQty=15송이', suffix: '', scanLabel: '파손 15송이 추출' },
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
        stepMs: 2100,
        chip: '창고 사진 adb pull',
        sourceInput: 'IMG_4601_HYDRANGEA_DMG.jpg (3.1MB -> 180KB WebP 경량화)',
        moduleEndpoint: 'core/moyi_worker.py · adb pull Read-Only',
        guardLabel: 'Read-Only + sha256 미디어 해시',
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
        stepMs: 2400,
        chip: 'Device Hub 30fps',
        sourceInput: 'warehouse-cam-02 30fps 프리뷰 및 검수 Lease(120s)',
        moduleEndpoint: 'api.nowlink.kr/device-hub · WebDeviceLease',
        guardLabel: 'TTL 120s Lease · Read-Only 검수 슬롯',
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
        stepMs: 2500,
        chip: 'WSS 역터널 + RapidOCR',
        sourceInput: '포트포워딩 없는 아웃바운드 WSS 역터널 + 박스 라벨 OCR',
        moduleEndpoint: 'nenova-device-sidecar.exe · hermes-core.exe',
        guardLabel: 'WSS 역터널 · 중복 촬영 차단',
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
        stepMs: 3200,
        chip: '수국 15송이 판독',
        sourceInput: 'OCR "15 STEMS" · Product 마스터(ProdKey=2218, OutUnit=송이)',
        moduleEndpoint: 'api.nowlink.kr/hermes · WebSalesDefectDeduction(DRAFT)',
        guardLabel: 'DRAFT 초안 · Estimate 직접 쓰기 차단',
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
        stepMs: 2900,
        chip: 'MOYI 클레임 승인',
        sourceInput: '파손 실사 + 판독 수량 15송이 클레임 승인 카드',
        moduleEndpoint: 'api.nowlink.kr/moyi · ApprovedBy 2FA 게이트',
        guardLabel: 'ApprovedBy ≠ ProposedBy 승인 대기',
        action: 'MOYI 앱에 파손 사진·판독 수량(15송이) 승인 카드가 도착해 담당자의 최종 승인을 기다립니다.',
        telemetry: [
          '[05 MOYI-GATE] claim approval card -> ProdKey=2218, OutQuantity=15(송이)',
          '[05 POLICY] ApprovedBy <> ProposedBy ("nenovaSS3" !== "warehouse-cam-02")',
          '[05 WAITING] MOYI 승인 실행 클릭 시 견적 차감 트랜잭션 실행',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 16.0,
        stepMs: 2900,
        chip: '견적 음수 차감 완료',
        sourceInput: '승인 완료 토큰(ApprovedBy=nenovaSS3) + WebSalesDefectDeduction',
        moduleEndpoint: 'nenovaweb · MSSQL Estimate UPDLOCK 차감',
        guardLabel: 'BEGIN TRAN UPDLOCK + 음수 차감 커밋',
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
    title: '공용폰 보안키패드(FLAG_SECURE) 감지 → 에이전트 Lease 즉시 반납 → MOYI 앱 알림 → Device Hub 30fps 웹 10초 해제 → 에이전트 재개',
    preferredDept: '경영지원',
    preferredNames: ['강명훈', '설연주', '김원빈'],
    manualMinutes: 6.5,
    autoSeconds: 10,
    savedPct: 97.4,
    gaugeHeadline: '수작업 대기 6.5분 → 30fps 웹 10초 해제 · 97.4% 단축',
    phoneHeader: '공용폰 #03 · FLAG_SECURE 보안 경계',
    phoneTitle: '은행·인증 보안키패드 감지',
    phoneSub: '에이전트 Lease 반납 → 사람 10초 원격 해제',
    phoneLines: [
      { tag: 'FLAG', prefix: 'Window ', token: 'FLAG_SECURE=true', suffix: ' (보안키패드 보호)', scanLabel: '보안키패드 감지' },
      { tag: 'LEASE', prefix: '', token: 'WAITING_HUMAN', suffix: ' · Agent Lease 즉시 반납 완료', scanLabel: '자동입력 즉시 정지' },
      { tag: 'RESUME', prefix: '웹 30fps 10초 해제 확인 → ', token: '에이전트 안전 재개', suffix: '', scanLabel: '10초 해제 후 재개' },
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
        stepMs: 1200,
        chip: 'FLAG_SECURE 감지',
        sourceInput: 'Android WindowManager FLAG_SECURE != 0 ("SecureKeypadDialog")',
        moduleEndpoint: 'core/moyi_worker.py · Zero-Touch Guard',
        guardLabel: '캡처 마스킹 · 자격증명 무접촉 차단',
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
        stepMs: 800,
        chip: 'Lease 즉시 반납',
        sourceInput: 'WebDeviceLease("L-SEC-03") 즉시 해제 이벤트',
        moduleEndpoint: 'api.nowlink.kr/device-hub · WAITING_HUMAN 전이',
        guardLabel: '에이전트 터치·ADB 입력 즉시 비활성화',
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
        stepMs: 1100,
        chip: '사이드카 입력 차단',
        sourceInput: '하드웨어 입력 잠금 신호 + 인증 운영자 전용 30fps 미러',
        moduleEndpoint: 'nenova-device-sidecar.exe · ABORT_AUTOMATION',
        guardLabel: 'WSS 미러 유지 · 자격증명 로그 0바이트',
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
        stepMs: 1300,
        chip: '세션 JSONL 보존',
        sourceInput: '중단 직전 작업 문맥 checkpoint="order_check_step_4"',
        moduleEndpoint: 'api.nowlink.kr/hermes · Session Rescue JSONL',
        guardLabel: '문맥 무손실 스냅샷 · 재할당 대기',
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
        stepMs: 2800,
        chip: 'MOYI 알림 · 10초 해제',
        sourceInput: '관리자 30fps 웹 콘솔 10초 직접 해제 요청',
        moduleEndpoint: 'api.nowlink.kr/moyi · 10초 사람 개입 게이트',
        guardLabel: 'ApprovedBy 사람 해제 승인 대기',
        action: 'MOYI 앱 알림을 받은 관리자가 Device Hub 30fps 웹 화면에서 10초 만에 보안키패드를 직접 해제합니다.',
        telemetry: [
          '[05 MOYI-GATE] alert pushed -> "공용폰 #03 보안키패드 10초 원격 해제"',
          '[05 HUMAN-OP] operator unlocked keypad via Device Hub 30fps console (10s)',
          '[05 WAITING] MOYI 승인 실행 클릭 시 에이전트 Lease 재할당',
        ],
      },
      {
        nodeIndex: 5,
        elapsedSec: 10.0,
        stepMs: 2800,
        chip: '에이전트 안전 재개',
        sourceInput: 'FLAG_SECURE=false 확인 + Session Rescue JSONL 복원',
        moduleEndpoint: 'nenovaweb · WebDeviceLease ACTIVE 복귀',
        guardLabel: 'BEGIN TRAN UPDLOCK · Lease 재개 완료',
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
    subtitle: 'PHONE HARNESS + KAKAO BRIDGE -> DEVICE HUB + RUST SIDECAR -> HERMES AI -> MOYI APP -> ERP SQL LEDGER',
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
    title: 'Device Hub 30fps 다중 폰 콘솔 & Phone Harness 정밀 OCR 스캔',
    subtitle: '다중 공용폰 실시간 관제 · 접근성 트리(uiautomator) · pHash 중복 프레임 차단',
    callouts: [
      '01. 30fps 콘솔: 여러 대의 공용폰·창고 현장폰 상태를 한 화면에서 확인하고 FLAG_SECURE 발생 시 10초 원격 개입',
      '02. 정밀 OCR 스캔: 화면 위 텍스트와 박스 라벨 영역을 바운딩박스로 판독해 수동 타이핑 제거',
      '03. 저부하 아키텍처: 정지 프레임 84%를 Rust pHash 필터로 사전 차단해 네트워크 대역폭·토큰 비용 절감',
    ],
  },
  {
    id: 'sync',
    src: '/images/solution-sim/moyi-approval-erp-sync.jpg',
    badge: '도면 3 · MOYI 승인 원장 동기화',
    title: 'MOYI 모바일 승인 게이트 & 3계층 SQL 원장 동기화',
    subtitle: 'MOYI 승인 카드 -> 보안 실드(ApprovedBy <> ProposedBy) -> ORDER / SHIPMENT / COST 3계층 MSSQL 원장',
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

export default function SolutionSuiteSimulator({ orbit = '', orbitQs = '', onSelectTab = null }) {
  const [scenarioId, setScenarioId] = useState('wechat_order');
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState('1x');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [approvedMap, setApprovedMap] = useState({});
  const [viewportTab, setViewportTab] = useState('trace');
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
  const [selectedCaptureId, setSelectedCaptureId] = useState('');
  const [hoveredBoxNo, setHoveredBoxNo] = useState(null);
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

  // 텔레메트리 콘솔 타이프라이터
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
    setSelectedCaptureId('');
    setHoveredBoxNo(null);
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
  const activeRecordsWithBoxes = useMemo(
    () => recordsState.records.filter((r) => extractBoxes(r).length > 0),
    [recordsState.records]
  );
  const captureItems = useMemo(() => {
    const out = [];
    const seen = new Set();
    activeRecordsWithBoxes.forEach((rec) => {
      if (!rec?.id || seen.has(rec.id)) return;
      seen.add(rec.id);
      out.push({
        id: rec.id,
        kind: 'ai',
        kindLabel: '영역 해독',
        ts: rec.timestamp,
        title: rec.screen || rec.app || '화면 기록',
        sub: rec.done || rec.activity || rec.app || '',
        boxes: extractBoxes(rec),
      });
    });
    thumbsState.items.forEach((t) => {
      if (!t?.id || seen.has(t.id)) return;
      seen.add(t.id);
      out.push({
        id: t.id,
        kind: 'live',
        kindLabel: '실시간 캡처',
        ts: t.timestamp,
        title: t.screen || t.activity || t.app || '실시간 캡처',
        sub: [t.app, t.activity].filter(Boolean).join(' · '),
        boxes: [],
      });
    });
    return out;
  }, [activeRecordsWithBoxes, thumbsState.items]);
  const selectedCapture = useMemo(
    () => captureItems.find((c) => c.id === selectedCaptureId) || captureItems[0] || null,
    [captureItems, selectedCaptureId]
  );
  const visibleTelemetry = fullTelemetryText.slice(0, typedLen);
  const totalElapsedMs = Math.round(activeStep.elapsedSec * 1000);
  const progressPct = Math.round(((stepIndex + 1) / scenario.steps.length) * 100);
  const ledgerStatusTone = isApproved || stepIndex === 5 ? 'ok' : stepIndex === 4 ? 'warn' : 'active';
  const ledgerStatusLabel = isApproved || stepIndex === 5 ? '원장 커밋 완료' : stepIndex === 4 ? '2FA 승인 대기' : 'Read-Only 검증중';

  return (
    <div className="sim-studio" data-testid="solution-suite-simulator">
      <div className="sim-shell">
        {/* 1. 상단 워크벤치 헤더 + 1px 헤어라인 컨트롤 & 지표 바 */}
        <header className="sim-topbar">
          <div className="sim-title-block">
            <div className="sim-eyebrow">MOYI × NENOVA · SOLUTION EXECUTION WORKBENCH</div>
            <div className="sim-title-row">
              <h2>통합 솔루션 라이브 실행 시뮬레이터</h2>
              <span className={`sim-status-tag is-${ledgerStatusTone}`}>{ledgerStatusLabel}</span>
            </div>
            <p className="sim-subtitle">
              Phone Harness · Device Hub · Rust 사이드카 · nenovakakao 실설계(moyi-worker 직렬 락 · mindmap_sink · browser_session_bridge · PR 50 5분 자동배포) · Hermes AI · 네노바웹 MSSQL 원장 6단계 실연
            </p>
          </div>

          <div className="sim-header-links">
            <a
              className="sim-hairline-link is-primary"
              href="/my-work?tab=radar"
              onClick={(e) => {
                if (onSelectTab) {
                  e.preventDefault();
                  onSelectTab('radar');
                }
              }}
            >
              도입·기술 레이더 (/my-work?tab=radar)
            </a>
            <a
              className="sim-hairline-link"
              href="/api/my-work/feature?name=suite-blueprint-html"
              target="_blank"
              rel="noreferrer"
            >
              Archify 전체화면 / SVG·PNG 내보내기
            </a>
            {orbit && (
              <a className="sim-hairline-link" href={`${orbit}/my-work.html${orbitQs}`} target="_blank" rel="noreferrer">
                Orbit 원본 작업 데이터
              </a>
            )}
          </div>
        </header>

        <section className="sim-controls-panel" aria-label="시뮬레이션 제어, 고정폭 지표 및 시나리오 선택">
          <div className="sim-control-strip">
            <div className="sim-btn-group" role="group" aria-label="재생 제어">
              <button
                type="button"
                className={`sim-btn ${playing ? 'is-ok' : 'is-primary'}`}
                aria-pressed={playing}
                onClick={() => { hasInteractedRef.current = true; setPlaying((p) => !p); }}
              >
                {playing ? '일시정지' : '재생'}
              </button>
              <button
                type="button"
                className="sim-btn"
                disabled={stepIndex <= 0}
                onClick={() => { setPlaying(false); jumpToStep(stepIndex - 1); }}
              >
                이전
              </button>
              <button
                type="button"
                className="sim-btn"
                disabled={stepIndex >= scenario.steps.length - 1}
                onClick={() => { setPlaying(false); jumpToStep(stepIndex + 1); }}
              >
                다음
              </button>
              <button
                type="button"
                className={`sim-btn ${speed === '1.8x' ? 'is-primary' : ''}`}
                aria-pressed={speed === '1.8x'}
                onClick={() => setSpeed((s) => (s === '1x' ? '1.8x' : '1x'))}
                title="재생 속도 전환"
              >
                속도 {speed}
              </button>
              <button type="button" className="sim-btn" onClick={handleReset}>
                초기화
              </button>
            </div>

            <div className="sim-metrics-strip" aria-live="polite">
              <div className="sim-metric-cell">
                <span className="sim-metric-label">단계 진행률</span>
                <div className="sim-metric-val">
                  <strong className="sim-mono-num">Step 0{stepIndex + 1}/0{scenario.steps.length}</strong>
                  <span className="sim-metric-sub">{NODES[stepIndex]?.short}</span>
                </div>
                <div className="sim-progress-track" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={6}>
                  <span className={`sim-progress-fill is-${ledgerStatusTone}`} style={{ width: `${progressPct}%` }} />
                </div>
              </div>

              <div className="sim-metric-cell">
                <span className="sim-metric-label">처리 지연 (누적 / 실측 비교)</span>
                <div className="sim-metric-val">
                  <strong className="sim-mono-num">{totalElapsedMs.toLocaleString()}ms</strong>
                  <span className="sim-metric-sub">({activeStep.elapsedSec.toFixed(1)}초 / {scenario.autoSeconds}초 · {scenario.savedPct}% 단축)</span>
                </div>
                <div className="sim-metric-caption">{scenario.gaugeHeadline}</div>
              </div>

              <div className="sim-metric-cell">
                <span className="sim-metric-label">중복제거 · 검증 상태</span>
                <div className="sim-metric-val">
                  <strong className={`sim-mono-num is-text-${ledgerStatusTone}`}>{ledgerStatusLabel}</strong>
                </div>
                <div className="sim-metric-caption sim-mono">dedup_key SHA-256 · {activeStep.guardLabel}</div>
              </div>
            </div>
          </div>

          <div className="sim-scenario-tabs" role="tablist" aria-label="실전 시나리오 선택">
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

        {/* 2. 메인 좌우 스플릿 (60% : 40%) */}
        <section className="sim-main-split" aria-label="파이프라인 도면 뷰포트 및 단계별 패킷 원장 인스펙터">
          {/* 좌측 60%: 정밀 엔지니어링 파이프라인 시퀀스 & 도면 뷰포트 */}
          <div className="sim-left-pane">
            <div className="sim-pane-head">
              <div className="sim-viewport-tabs" role="tablist" aria-label="도면 뷰포트 전환">
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportTab === 'trace'}
                  className={`sim-vtab ${viewportTab === 'trace' ? 'is-on' : ''}`}
                  onClick={() => setViewportTab('trace')}
                >
                  실시간 아키텍처 트레이스 도면
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportTab === 'archify'}
                  className={`sim-vtab ${viewportTab === 'archify' ? 'is-on' : ''}`}
                  onClick={() => setViewportTab('archify')}
                >
                  Archify 인터랙티브 도면
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewportTab === 'blueprints'}
                  className={`sim-vtab ${viewportTab === 'blueprints' ? 'is-on' : ''}`}
                  onClick={() => setViewportTab('blueprints')}
                >
                  3D 시스템 블루프린트
                </button>
              </div>

              <div className="sim-pane-meta">
                <span className={`sim-mode-pill ${playing ? 'is-live' : ''}`}>
                  {playing ? `AUTO ${speed}` : 'MANUAL'}
                </span>
                <span className="sim-mono-num sim-step-ms">{activeStep.stepMs.toLocaleString()}ms</span>
              </div>
            </div>

            {viewportTab === 'trace' && (
              <div className="sim-trace-body">
                <div className="sim-svg-frame">
                  <svg
                    className="sim-svg"
                    viewBox="0 0 980 340"
                    role="img"
                    aria-label="6단계 통합 솔루션 아키텍처 트레이스 도면"
                  >
                    <defs>
                      <pattern id="simGrid" width="24" height="24" patternUnits="userSpaceOnUse">
                        <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#f1f5f9" strokeWidth="1" />
                      </pattern>
                      <marker id="simArrowIdle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 1 1 L 9 5 L 1 9 z" fill="#475569" />
                      </marker>
                      <marker id="simArrowActive" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 1 1 L 9 5 L 1 9 z" fill="#1d4ed8" />
                      </marker>
                      <marker id="simArrowDone" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                        <path d="M 1 1 L 9 5 L 1 9 z" fill="#047857" />
                      </marker>
                    </defs>

                    <rect x="0" y="0" width="980" height="340" fill="#ffffff" />
                    <rect x="0" y="0" width="980" height="340" fill="url(#simGrid)" />

                    {/* 연결 경로 및 정밀 패킷 마커 (중앙 버스 트랙 y=144) */}
                    {EDGE_PATHS.map((d, edgeIdx) => {
                      const completed = stepIndex > edgeIdx;
                      const activeEdge = stepIndex === edgeIdx + 1 || (stepIndex === edgeIdx && playing);
                      const pathId = `sim-edge-${edgeIdx}`;
                      const strokeColor = activeEdge ? '#1d4ed8' : completed ? '#047857' : '#64748b';
                      const markerId = activeEdge ? 'url(#simArrowActive)' : completed ? 'url(#simArrowDone)' : 'url(#simArrowIdle)';
                      return (
                        <g key={pathId}>
                          <path d={d} fill="none" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                          <path
                            id={pathId}
                            d={d}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={activeEdge || completed ? '2.5' : '1.75'}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            markerEnd={markerId}
                            className={activeEdge ? 'sim-edge-flow' : ''}
                          />
                          {!reducedMotion && (activeEdge || completed) && (
                            <circle
                              r={activeEdge ? 4.5 : 3.5}
                              fill={activeEdge ? '#1d4ed8' : '#047857'}
                              stroke="#ffffff"
                              strokeWidth="1.5"
                            >
                              <animateMotion dur={speed === '1.8x' ? '0.85s' : '1.4s'} repeatCount="indefinite">
                                <mpath href={`#${pathId}`} />
                              </animateMotion>
                            </circle>
                          )}
                        </g>
                      );
                    })}

                    {/* 중앙 엔지니어링 버스 배지 — 버스 선(y=144) 아래 독립 레인(y=166..196) + 최상위 SVG DOM 레이어 */}
                    <g className="sim-bus-badge">
                      <rect x="305" y="166" width="370" height="30" rx="4" fill="#ffffff" stroke="#cbd5e1" strokeWidth="1.2" />
                      <text
                        x="490"
                        y="185.5"
                        textAnchor="middle"
                        fill="#0f172a"
                        fontSize="13"
                        fontWeight="700"
                        fontFamily={FONT_SANS}
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        WSS 역터널 · HERMES AI 3단위 정규화 버스
                      </text>
                    </g>

                    {/* 6개 인터랙티브 노드 (활성 보더 두께 + 3색 의미 팔레트 + 선명한 고딕 폰트) */}
                    {NODES.map((node, idx) => {
                      const isActive = idx === stepIndex;
                      const isPendingGate = idx === 4 && isActive && !isApproved;
                      const isDone = idx < stepIndex || (idx === 5 && isApproved);
                      const stepInfo = scenario.steps[idx];
                      const stateLabel = isPendingGate ? '승인 대기' : isActive ? '실행 중' : isDone ? '완료' : '대기';

                      const borderStroke = isPendingGate
                        ? '#b45309'
                        : isActive
                          ? '#1d4ed8'
                          : isDone
                            ? '#047857'
                            : '#cbd5e1';
                      const borderWidth = isActive ? '2.5' : isDone ? '1.5' : '1';
                      const nodeFill = isPendingGate
                        ? '#fffbeb'
                        : isActive
                          ? '#eff6ff'
                          : '#ffffff';
                      const tagFill = isPendingGate
                        ? '#fffbeb'
                        : isActive
                          ? '#eff6ff'
                          : isDone
                            ? '#ecfdf5'
                            : '#f1f5f9';
                      const tagStroke = isPendingGate
                        ? '#b45309'
                        : isActive
                          ? '#1d4ed8'
                          : isDone
                            ? '#047857'
                            : '#cbd5e1';
                      const tagInk = isPendingGate
                        ? '#b45309'
                        : isActive
                          ? '#1d4ed8'
                          : isDone
                            ? '#047857'
                            : '#334155';

                      return (
                        <g
                          key={node.id}
                          className={`sim-node-g ${isActive ? 'is-active' : ''}`}
                          style={{ cursor: 'pointer' }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${node.short} 단계로 이동`}
                          aria-pressed={isActive}
                          onClick={() => { setPlaying(false); jumpToStep(idx); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setPlaying(false);
                              jumpToStep(idx);
                            }
                          }}
                        >
                          <rect
                            x={node.x}
                            y={node.y}
                            width={node.w}
                            height={node.h}
                            rx="4"
                            fill={nodeFill}
                            stroke={borderStroke}
                            strokeWidth={borderWidth}
                          />
                          <rect x={node.x} y={node.y} width="4" height={node.h} rx="1" fill={tagInk} />

                          <text
                            x={node.x + 14}
                            y={node.y + 24}
                            fill="#334155"
                            fontSize="12.5"
                            fontWeight="600"
                            fontFamily={FONT_SANS}
                          >
                            {node.surface}
                          </text>

                          <rect
                            x={node.x + node.w - 84}
                            y={node.y + 9}
                            width="72"
                            height="22"
                            rx="3"
                            fill={tagFill}
                            stroke={tagStroke}
                            strokeWidth="1"
                          />
                          <text
                            x={node.x + node.w - 48}
                            y={node.y + 24}
                            textAnchor="middle"
                            fill={tagInk}
                            fontSize="12"
                            fontWeight="700"
                            fontFamily={FONT_SANS}
                          >
                            {stateLabel}
                          </text>

                          <text
                            x={node.x + 14}
                            y={node.y + 56}
                            fill="#0f172a"
                            fontSize="14.5"
                            fontWeight="700"
                            fontFamily={FONT_SANS}
                          >
                            {node.short}
                          </text>

                          <rect x={node.x + 12} y={node.y + 72} width={node.w - 24} height="28" rx="3" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1" />
                          <text
                            x={node.x + 20}
                            y={node.y + 90.5}
                            fill={isActive ? tagInk : '#1e293b'}
                            fontSize="12.5"
                            fontWeight="600"
                            fontFamily={FONT_SANS}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {stepInfo?.chip || ''}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* 핵심 계약 토큰 & nenovakakao 실설계 경계 */}
                <div className="sim-contract-strip" aria-label="패킷 핵심 계약 토큰">
                  <span><code>dedup_key</code> 무중복 해시</span>
                  <span><code>ProdKey=1042</code> 마스터 매칭</span>
                  <span><code>OutQuantity=100</code> 3단위 환산</span>
                  <span><code>ApprovedBy</code> 2FA 승인 게이트</span>
                  <span><code>BEGIN TRAN UPDLOCK</code> 원장 잠금</span>
                </div>

                <div className="sim-contract-strip" aria-label="nenovakakao 실설계 운영 계약">
                  <span><code>moyi-worker</code> 직렬 락 (<code>core/moyi_worker.py</code> · 운영PC 전담)</span>
                  <span><code>mindmap_sink</code> <code>/api/kakao/import</code> (50건 배치)</span>
                  <span><code>browser_session_bridge</code> <code>com.nenovakakao.sales_session</code></span>
                  <span><code>PR 50</code> <code>core/self_update.py</code> 별도 승인 · 5분 자동배포</span>
                </div>

                {/* 라이브 텔레메트리 트레이스 */}
                <div className="sim-console" aria-live="polite">
                  <div className="sim-console-head">
                    <b>EXECUTION TRACE · STEP 0{stepIndex + 1}</b>
                    <span>{activeStep.action}</span>
                  </div>
                  <pre className="sim-console-body">{visibleTelemetry}</pre>
                </div>
              </div>
            )}

            {viewportTab === 'archify' && (
              <div className="sim-archify-wrap">
                <div className="sim-archify-bar">
                  <span>Archify 검증 설계도 (<code>data/moyi-full-suite-blueprint.html</code>) · Light 엔지니어링 테마</span>
                  <a
                    className="sim-hairline-link"
                    href="/api/my-work/feature?name=suite-blueprint-html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    전체화면 열기
                  </a>
                </div>
                <iframe
                  title="통합 솔루션 인터랙티브 설계도"
                  src="/api/my-work/feature?name=suite-blueprint-html&theme=light"
                  className="sim-archify-iframe"
                />
              </div>
            )}

            {viewportTab === 'blueprints' && (
              <div className="sim-bp-ledger" aria-label="3D 시스템 블루프린트 도면 목록">
                {BLUEPRINT_GALLERY.map((bp) => (
                  <article key={bp.id} className="sim-bp-row">
                    <div
                      className="sim-bp-thumb"
                      role="button"
                      tabIndex={0}
                      aria-label={`${bp.title} 크게 보기`}
                      onClick={() => setLightbox(bp)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLightbox(bp); } }}
                    >
                      <img src={bp.src} alt={bp.title} loading="lazy" />
                      <span className="sim-bp-zoom">확대</span>
                    </div>
                    <div className="sim-bp-spec">
                      <div className="sim-bp-head">
                        <span className="sim-bp-badge">{bp.badge}</span>
                        <h4>{bp.title}</h4>
                      </div>
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

            {/* 좌측 60% 하단: 5열 엔지니어링 실행 로그 원장 (좌·우 높이 균형) */}
            <div className="sim-timeline-section" aria-label="전체 스텝 엔지니어링 실행 로그 테이블">
              <div className="sim-timeline-head">
                <div>
                  <b>엔지니어링 실행 로그 원장</b>
                  <span>행을 클릭하거나 Enter/방향키로 해당 스텝으로 이동합니다.</span>
                </div>
                <span className="sim-mono-num">총 {scenario.steps.length}단계 · 누적 {scenario.autoSeconds}초 ({(scenario.autoSeconds * 1000).toLocaleString()}ms)</span>
              </div>

              <div className="sim-table-wrap">
                <table className="sim-exec-table">
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>표면 노드</th>
                      <th>실행 모듈·계약</th>
                      <th>소요시간</th>
                      <th>안전 가드 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenario.steps.map((st, idx) => {
                      const node = NODES[idx];
                      const isActive = idx === stepIndex;
                      const isPendingGate = idx === 4 && isActive && !isApproved;
                      const isDone = idx < stepIndex || (idx === 5 && isApproved);
                      const rowTone = isPendingGate ? 'warn' : isActive ? 'active' : isDone ? 'ok' : 'muted';
                      const rowStatus = isPendingGate ? '승인 대기' : isActive ? '실행 중' : isDone ? '완료' : '대기';
                      return (
                        <tr
                          key={node.id}
                          tabIndex={0}
                          aria-selected={isActive}
                          className={`sim-exec-row ${isActive ? 'is-active' : ''}`}
                          onClick={() => { setPlaying(false); jumpToStep(idx); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setPlaying(false);
                              jumpToStep(idx);
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setPlaying(false);
                              jumpToStep(Math.min(scenario.steps.length - 1, idx + 1));
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setPlaying(false);
                              jumpToStep(Math.max(0, idx - 1));
                            }
                          }}
                        >
                          <td className="sim-mono-num sim-col-step">0{idx + 1}</td>
                          <td>
                            <div className="sim-node-cell">
                              <strong>{node.short}</strong>
                              <span>{node.surface}</span>
                            </div>
                          </td>
                          <td>
                            <div className="sim-mod-cell">
                              <code>{st.moduleEndpoint}</code>
                              <span>{st.chip}</span>
                            </div>
                          </td>
                          <td className="sim-mono-num sim-col-time">
                            {st.stepMs.toLocaleString()}ms <span>(누적 {st.elapsedSec.toFixed(1)}s)</span>
                          </td>
                          <td>
                            <div className="sim-guard-cell">
                              <span className={`sim-mono-pill is-${rowTone}`}>{rowStatus}</span>
                              <span>{st.guardLabel}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 우측 40%: 단계별 패킷 원장 · 공용폰 스냅샷 · MOYI 승인 게이트 · 4-Invariant 원장 안전 가드 */}
          <aside className="sim-right-pane" aria-label="단계별 패킷 원장 및 4-Invariant 원장 안전 가드">
            <div className="sim-inspector-block">
              <div className="sim-inspector-head">
                <b>단계별 패킷 원장 인스펙터</b>
                <span className="sim-mono-num">STEP 0{stepIndex + 1} · {activeStep.stepMs.toLocaleString()}ms</span>
              </div>

              {/* 4개 핵심 런타임 홉 */}
              <div className="sim-route-hops" aria-label="실행 모듈 엔드포인트 경로">
                {ROUTE_ENDPOINTS.map((hop) => {
                  const isHopActive = hop.steps.includes(stepIndex);
                  return (
                    <div key={hop.id} className={`sim-hop ${isHopActive ? 'is-active' : ''}`}>
                      <code>{hop.label}</code>
                      <span>{hop.role}</span>
                    </div>
                  );
                })}
              </div>

              <dl className="sim-kv-ledger">
                <div className="sim-kv-row">
                  <dt>원천 입력</dt>
                  <dd>{activeStep.sourceInput}</dd>
                </div>
                <div className="sim-kv-row">
                  <dt>실행 모듈·엔드포인트</dt>
                  <dd><code>{activeStep.moduleEndpoint}</code></dd>
                </div>
                <div className="sim-kv-row">
                  <dt>안전 가드</dt>
                  <dd><span className={`sim-guard-pill is-${ledgerStatusTone}`}>{activeStep.guardLabel}</span></dd>
                </div>
              </dl>

              {/* 공용폰 수집 표면 미리보기 — 3열 DOM Grid 인라인 하이라이트 + 우측 거터 주석 (절대좌표 겹침 0건) */}
              <div className="sim-surface-preview" aria-label="현장 수집 디바이스 스냅샷">
                <div className="sim-surface-bar">
                  <b>{scenario.phoneHeader}</b>
                  <span className={`sim-mono-pill ${stepIndex <= 2 ? 'is-active' : ''}`}>
                    {stepIndex <= 2 ? 'SCANNING · 30fps' : scenario.id === 'human_lease' && stepIndex < 4 ? 'WAITING_HUMAN' : 'SYNCED · 30fps'}
                  </span>
                </div>
                <div className="sim-surface-meta">
                  <span>{scenario.phoneTitle}</span>
                  <span>{scenario.phoneSub}</span>
                </div>
                <div className="sim-surface-lines">
                  {scenario.phoneLines.map((line, i) => {
                    const isLit = stepIndex >= i;
                    const isScanning = stepIndex <= 2 && stepIndex >= i;
                    return (
                      <div key={i} className={`sim-line-row ${isLit ? 'is-lit' : ''} ${isScanning ? 'is-scanning' : ''}`}>
                        <span className="sim-line-tag">{line.tag}</span>
                        <span className="sim-line-text">
                          {line.prefix}
                          <mark className={`sim-ocr-token ${isScanning ? 'is-scanning' : isLit ? 'is-lit' : ''}`}>
                            {line.token}
                          </mark>
                          {line.suffix}
                        </span>
                        <span className={`sim-line-gutter ${isScanning ? 'is-scanning' : isLit ? 'is-lit' : ''}`}>
                          <span className="sim-gutter-leader" aria-hidden="true" />
                          <span className="sim-gutter-badge">{line.scanLabel}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* MOYI 승인 게이트 & 원장 영수증 */}
              <div className="sim-gate-ledger" aria-label="MOYI 2FA 승인 게이트">
                <div className="sim-surface-bar">
                  <b>{scenario.moyiCard.room}</b>
                  <span className={`sim-mono-pill is-${isApproved || stepIndex === 5 ? 'ok' : stepIndex === 4 ? 'warn' : 'muted'}`}>
                    {isApproved || stepIndex === 5 ? '원장 커밋 완료' : stepIndex === 4 ? '승인 대기' : 'DRAFT 준비'}
                  </span>
                </div>

                {stepIndex < 4 && !isApproved ? (
                  <p className="sim-gate-standby">
                    현재 Step 0{stepIndex + 1} 실행 중입니다. Step 05(MOYI 승인 게이트)에서 <code>ApprovedBy ≠ ProposedBy</code> 검증 후 원장 커밋을 실행할 수 있습니다.
                  </p>
                ) : (
                  <div className="sim-gate-card">
                    <div className="sim-gate-title">{scenario.moyiCard.title}</div>
                    <div className="sim-gate-meta">
                      <div><b>대상 품목/기기</b><span>{scenario.moyiCard.item}</span></div>
                      <div><b>환산/조치 내역</b><span>{scenario.moyiCard.qtySummary}</span></div>
                      <div><b>보안 게이트</b><code>{scenario.moyiCard.meta}</code></div>
                    </div>

                    {stepIndex === 4 && !isApproved && (
                      <button type="button" className="sim-approve-btn" onClick={handleApprove}>
                        MOYI 승인 실행
                      </button>
                    )}

                    {(stepIndex === 5 || isApproved) && (
                      <div className="sim-receipt-box" role="status">
                        <div className="sim-receipt-top">
                          <b>{scenario.moyiCard.receiptTitle}</b>
                          <code>{scenario.moyiCard.txId}</code>
                        </div>
                        <div className="sim-receipt-body">{scenario.moyiCard.receiptBody}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 원장 안전 가드 체크표 */}
            <div className="sim-inspector-block">
              <div className="sim-inspector-head">
                <b>원장 안전 가드 체크표</b>
                <span className="sim-mono-sub">4-Invariant Gate</span>
              </div>
              <table className="sim-guard-table">
                <thead>
                  <tr>
                    <th>가드 항목</th>
                    <th>검증 기준</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Read-Only 수집 경계</td>
                    <td><code>outbound_block=TRUE</code> · 고위험 키워드 0건</td>
                    <td><span className="sim-mono-pill is-ok">PASS</span></td>
                  </tr>
                  <tr>
                    <td>이중 승인 (2FA)</td>
                    <td><code>ApprovedBy ≠ ProposedBy</code></td>
                    <td>
                      <span className={`sim-mono-pill ${isApproved || stepIndex === 5 ? 'is-ok' : stepIndex === 4 ? 'is-warn' : 'is-active'}`}>
                        {isApproved || stepIndex === 5 ? '승인 완료' : stepIndex === 4 ? '승인 대기' : '게이트 준비'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>MSSQL 원자적 잠금</td>
                    <td><code>BEGIN TRAN UPDLOCK</code> · 4-Key 복합키</td>
                    <td>
                      <span className={`sim-mono-pill ${isApproved || stepIndex === 5 ? 'is-ok' : 'is-muted'}`}>
                        {isApproved || stepIndex === 5 ? '커밋 완료' : '대기 잠금'}
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td>중복 차단 · Fallback</td>
                    <td><code>dedup_key</code> SHA-256 · JS/Python Fallback</td>
                    <td><span className="sim-mono-pill is-ok">VERIFIED</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </aside>
        </section>

        {/* 3. 하단 전체 폭(100%) 마스터-디테일 실제 작업 캡처 & 실측 대조 워크벤치 */}
        <section className="sim-capture-workbench" aria-label="실제 작업 캡처 및 실측 대조">
          <div className="sim-capture-head">
            <div className="sim-capture-title-group">
              <b>실제 작업 캡처 &amp; 실측 대조</b>
              <span className={`sim-mono-pill ${thumbsState.mode === 'live' ? 'is-ok' : 'is-warn'}`}>
                {thumbsState.mode === 'live' ? `실제 캡처 ${captureItems.length}건` : '저장소 실측 폴백'}
              </span>
            </div>

            <div className="sim-staff-row">
              <label htmlFor="sim-staff-select">대상 직원</label>
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
              <span className="sim-mono-sub">
                {selectedPerson?.uid ? `uid=${selectedPerson.uid}` : '오프라인 기준'}
              </span>
            </div>
          </div>

          {selectedPerson && (
            <div className="sim-person-bar">
              <b>{selectedPerson.name}</b>
              <span className="sim-dept-tag">{selectedPerson.dept || '전사'}</span>
              <span className="sim-person-summary">{selectedPerson.roleSummary || '실제 업무 흐름 관찰 기반 자동화 대상'}</span>
            </div>
          )}

          {thumbsState.loading ? (
            <div className="sim-capture-loading">캡처 화면 및 인식 좌표 불러오는 중…</div>
          ) : captureItems.length > 0 && selectedCapture ? (
            <div className="sim-capture-split">
              {/* 좌측 62%: 대형 고해상도 캡처 스테이지 — 이미지 위엔 번호 배지(1,2,3)와 테두리만 표시 */}
              <div className="sim-capture-stage">
                <div className="sim-stage-bar">
                  <div className="sim-stage-title-wrap">
                    <span className={`sim-mono-pill ${selectedCapture.kind === 'ai' ? 'is-active' : 'is-muted'}`}>
                      {selectedCapture.kindLabel}
                    </span>
                    <span className="sim-mono-num sim-stage-ts">{fmtTs(selectedCapture.ts)}</span>
                    <b className="sim-stage-title">{selectedCapture.title}</b>
                  </div>
                  <button
                    type="button"
                    className="sim-btn"
                    onClick={() => setShotModal({ id: selectedCapture.id, title: selectedCapture.title, boxes: selectedCapture.boxes, ts: selectedCapture.ts })}
                  >
                    원본 크게 보기
                  </button>
                </div>

                <div className="sim-stage-frame">
                  <div className="sim-stage-inner">
                    <img
                      src={`/api/work/orbit-thumbs?img=${encodeURIComponent(selectedCapture.id)}`}
                      alt={selectedCapture.title || '실제 캡처'}
                    />
                    {selectedCapture.boxes.map((b, k) => {
                      const [x0, y0, x1, y1] = b.box;
                      const focused = hoveredBoxNo === b.no;
                      const badgeTop = y0 < 25 ? '2px' : '-11px';
                      const badgeLeft = x0 < 25 ? '2px' : '-11px';
                      return (
                        <span
                          key={k}
                          className={`sim-ai-bbox ${focused ? 'is-focused' : ''}`}
                          style={{
                            left: `${x0 / 10}%`,
                            top: `${y0 / 10}%`,
                            width: `${Math.max(1, (x1 - x0) / 10)}%`,
                            height: `${Math.max(1, (y1 - y0) / 10)}%`,
                          }}
                          title={`${b.no}. ${b.label}`}
                          aria-label={`${b.no}번 영역: ${b.label}`}
                        >
                          <span className="sim-ai-no" style={{ top: badgeTop, left: badgeLeft }}>{b.no}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 우측 38%: 번호별 단계 해설 + 가로 행 캡처 목록 */}
              <div className="sim-capture-sidebar">
                <div className="sim-legend-box">
                  <div className="sim-legend-head">
                    <b>선택 화면 단계·영역 해설</b>
                    <span className="sim-mono-sub">
                      {selectedCapture.boxes.length > 0 ? `${selectedCapture.boxes.length}개 판독 영역` : '캡처 상세 정보'}
                    </span>
                  </div>
                  {selectedCapture.boxes.length > 0 ? (
                    <ol className="sim-box-legend">
                      {selectedCapture.boxes.map((b, k) => (
                        <li
                          key={k}
                          className={hoveredBoxNo === b.no ? 'is-focused' : ''}
                          onMouseEnter={() => setHoveredBoxNo(b.no)}
                          onMouseLeave={() => setHoveredBoxNo(null)}
                        >
                          <span className="sim-legend-no">{b.no}</span>
                          <span className="sim-legend-text">{b.label}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="sim-legend-empty">
                      <div className="sim-legend-screen">{selectedCapture.title}</div>
                      {selectedCapture.sub && <p>{selectedCapture.sub}</p>}
                    </div>
                  )}
                </div>

                <div className="sim-caplist-box">
                  <div className="sim-legend-head">
                    <b>스토리보드 · 실시간 캡처 목록</b>
                    <span className="sim-mono-num">{captureItems.length}건</span>
                  </div>
                  <div className="sim-caplist" role="listbox" aria-label="실제 작업 캡처 목록">
                    {captureItems.map((item) => {
                      const activeCap = item.id === selectedCapture.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={activeCap}
                          className={`sim-cap-row ${activeCap ? 'is-active' : ''}`}
                          onClick={() => {
                            setSelectedCaptureId(item.id);
                            setHoveredBoxNo(null);
                          }}
                        >
                          <img
                            loading="lazy"
                            src={`/api/work/orbit-thumbs?img=${encodeURIComponent(item.id)}`}
                            alt={item.title}
                          />
                          <div className="sim-cap-info">
                            <div className="sim-cap-meta">
                              <span className="sim-mono-num">{fmtTs(item.ts)}</span>
                              <span className={`sim-cap-kind ${item.kind === 'ai' ? 'is-ai' : ''}`}>{item.kindLabel}</span>
                              {item.boxes.length > 0 && <span className="sim-cap-cnt">영역 {item.boxes.length}</span>}
                            </div>
                            <strong className="sim-cap-title">{item.title}</strong>
                            {item.sub && item.sub !== item.title && <span className="sim-cap-sub">{item.sub}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="sim-fallback-note">
              <b>캡처 이미지 0건 / 로컬 실측 폴백</b>
              <span>{thumbsState.error || 'Orbit 서버 토큰 미설정 또는 최근 7일 해독 캡처 0건'}</span>
              <p>
                운영 환경에서는 이 영역에 실제 화면 캡처와 <code>steps[].box</code> 천분율 좌표 바운딩박스가 표시됩니다.
              </p>
            </div>
          )}

          {activeSimulation.item && (
            <div className="sim-compare-ledger">
              <div className="sim-compare-header">
                <b>실측 작업시간 대조 · {activeSimulation.item.title}</b>
                <span className="sim-mono-num">
                  수작업 {simBefore.totalMinutes ?? '—'}분 → 자동화 {simAfter.totalMinutes ?? '—'}분
                  {activeSimulation.item.savingPerWeekMin != null
                    ? ` (주간 ${(Number(activeSimulation.item.savingPerWeekMin) / 60).toFixed(1)}h / ${activeSimulation.item.savingPerWeekMin}분 단축)`
                    : ''}
                </span>
              </div>
              <div className="sim-compare-grid">
                <div className="sim-compare-col">
                  <div className="sim-compare-sub">기존 수작업 ({simBefore.totalMinutes ?? '—'}분)</div>
                  <ol>
                    {beforeSteps.map((st, idx) => (
                      <li key={idx}>
                        {st.action} <small className="sim-mono-num">({st.app} · {st.minutes}분)</small>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="sim-compare-col is-after">
                  <div className="sim-compare-sub">자동화 + MOYI ({simAfter.totalMinutes ?? '—'}분)</div>
                  <ol>
                    {afterSteps.map((st, idx) => (
                      <li key={idx}>
                        {st.action} <small className="sim-mono-num">({st.minutes}분{st.auto ? ' · 자동' : ''})</small>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

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

      {/* 실작업 캡처 확대 모달 — 번호 배지만 이미지에 올리고 해설은 하단 리스트로 분리 */}
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
            <div className="sim-stage-frame is-large">
              <div className="sim-stage-inner">
                <img src={`/api/work/orbit-thumbs?img=${encodeURIComponent(shotModal.id)}`} alt={shotModal.title || '캡처'} />
                {arr(shotModal.boxes).map((b, k) => {
                  const [x0, y0, x1, y1] = b.box;
                  const badgeTop = y0 < 25 ? '2px' : '-11px';
                  const badgeLeft = x0 < 25 ? '2px' : '-11px';
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
                      title={`${b.no}. ${b.label}`}
                    >
                      <span className="sim-ai-no" style={{ top: badgeTop, left: badgeLeft }}>{b.no}</span>
                    </span>
                  );
                })}
              </div>
            </div>
            {arr(shotModal.boxes).length > 0 && (
              <ol className="sim-box-legend is-modal">
                {arr(shotModal.boxes).map((b, k) => (
                  <li key={k}>
                    <span className="sim-legend-no">{b.no}</span>
                    <span className="sim-legend-text">{b.label}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .sim-studio {
          width: 100%;
          min-height: 100%;
          background: #f8fafc;
          color: #0f172a;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-variant-numeric: tabular-nums;
          box-sizing: border-box;
          padding: 16px 20px 44px;
        }
        .sim-shell {
          max-width: 1540px;
          margin: 0 auto;
          background: #ffffff;
          border: 1px solid #cbd5e1;
        }
        .sim-mono-num,
        .sim-mono {
          font-variant-numeric: tabular-nums;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
        }

        /* 1. 상단 헤더 & 1px 컨트롤/지표 바 */
        .sim-topbar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
          padding: 14px 18px;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }
        .sim-title-block {
          flex: 1 1 560px;
          min-width: 0;
        }
        .sim-eyebrow {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #334155;
          margin-bottom: 4px;
        }
        .sim-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 5px;
        }
        .sim-title-row h2 {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        .sim-status-tag {
          font-size: 12.5px;
          font-weight: 700;
          padding: 2px 9px;
          border-radius: 3px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #334155;
        }
        .sim-status-tag.is-active {
          color: #1d4ed8;
          background: #eff6ff;
          border-color: #bfdbfe;
        }
        .sim-status-tag.is-ok {
          color: #047857;
          background: #ecfdf5;
          border-color: #a7f3d0;
        }
        .sim-status-tag.is-warn {
          color: #b45309;
          background: #fffbeb;
          border-color: #fde68a;
        }
        .sim-subtitle {
          margin: 0;
          font-size: 13.5px;
          color: #334155;
          line-height: 1.55;
        }
        .sim-header-links {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .sim-hairline-link {
          display: inline-flex;
          align-items: center;
          padding: 7px 11px;
          font-size: 13px;
          font-weight: 600;
          color: #0f172a;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          text-decoration: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .sim-hairline-link:hover {
          border-color: #1d4ed8;
          background: #f8fafc;
        }
        .sim-hairline-link.is-primary {
          color: #1d4ed8;
          border-color: #1d4ed8;
          background: #eff6ff;
        }

        .sim-controls-panel {
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
        }
        .sim-control-strip {
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          flex-wrap: wrap;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-btn-group {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 16px;
          border-right: 1px solid #e2e8f0;
          flex-wrap: wrap;
        }
        .sim-btn {
          background: #ffffff;
          color: #0f172a;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          padding: 6px 12px;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: border-color 0.15s, background 0.15s;
        }
        .sim-btn:hover:not(:disabled) {
          border-color: #1d4ed8;
          background: #f8fafc;
        }
        .sim-btn:focus-visible,
        .sim-sc-tab:focus-visible,
        .sim-vtab:focus-visible,
        .sim-exec-row:focus-visible,
        .sim-approve-btn:focus-visible,
        .sim-cap-row:focus-visible {
          outline: 2px solid #1d4ed8;
          outline-offset: -2px;
        }
        .sim-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .sim-btn.is-primary {
          background: #eff6ff;
          border-color: #1d4ed8;
          color: #1d4ed8;
        }
        .sim-btn.is-ok {
          background: #ecfdf5;
          border-color: #047857;
          color: #047857;
        }

        .sim-metrics-strip {
          flex: 1 1 640px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .sim-metric-cell {
          padding: 9px 14px;
          border-left: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .sim-metric-cell:first-child {
          border-left: 0;
        }
        .sim-metric-label {
          font-size: 12px;
          font-weight: 700;
          color: #334155;
          letter-spacing: 0.02em;
        }
        .sim-metric-val {
          display: flex;
          align-items: baseline;
          gap: 6px;
          flex-wrap: wrap;
        }
        .sim-metric-val strong {
          font-size: 15px;
          color: #0f172a;
        }
        .sim-metric-val strong.is-text-active { color: #1d4ed8; }
        .sim-metric-val strong.is-text-ok { color: #047857; }
        .sim-metric-val strong.is-text-warn { color: #b45309; }
        .sim-metric-sub {
          font-size: 12.5px;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sim-metric-caption {
          font-size: 12.5px;
          color: #334155;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sim-progress-track {
          height: 4px;
          background: #e2e8f0;
          overflow: hidden;
          margin-top: 2px;
        }
        .sim-progress-fill {
          display: block;
          height: 100%;
          background: #1d4ed8;
          transition: width 0.25s ease;
        }
        .sim-progress-fill.is-ok { background: #047857; }
        .sim-progress-fill.is-warn { background: #b45309; }

        .sim-scenario-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          background: #f8fafc;
        }
        .sim-sc-tab {
          text-align: left;
          background: transparent;
          border: 0;
          border-right: 1px solid #e2e8f0;
          border-bottom: 2px solid transparent;
          padding: 10px 14px;
          color: #334155;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font: inherit;
        }
        .sim-sc-tab:last-child {
          border-right: 0;
        }
        .sim-sc-tab:hover {
          background: #ffffff;
          color: #0f172a;
        }
        .sim-sc-tab.is-on {
          background: #ffffff;
          border-bottom-color: #1d4ed8;
          color: #0f172a;
        }
        .sim-sc-badge {
          font-size: 12.5px;
          font-weight: 700;
          color: #1d4ed8;
        }
        .sim-sc-title {
          font-size: 13.5px;
          line-height: 1.45;
          font-weight: 600;
          color: #0f172a;
        }

        /* 2. 상단 메인 좌우 스플릿 (60% : 40%) — 좌우 높이 균형 */
        .sim-main-split {
          display: grid;
          grid-template-columns: minmax(0, 1.48fr) minmax(0, 1fr);
          border-bottom: 1px solid #cbd5e1;
          align-items: stretch;
        }
        .sim-left-pane {
          min-width: 0;
          border-right: 1px solid #e2e8f0;
          background: #ffffff;
          display: flex;
          flex-direction: column;
        }
        .sim-pane-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          padding-right: 12px;
        }
        .sim-viewport-tabs {
          display: flex;
          flex-wrap: wrap;
        }
        .sim-vtab {
          background: transparent;
          border: 0;
          border-right: 1px solid #e2e8f0;
          border-bottom: 2px solid transparent;
          padding: 10px 14px;
          font: inherit;
          font-size: 13.5px;
          font-weight: 600;
          color: #334155;
          cursor: pointer;
        }
        .sim-vtab:hover {
          color: #0f172a;
          background: #ffffff;
        }
        .sim-vtab.is-on {
          background: #ffffff;
          color: #1d4ed8;
          border-bottom-color: #1d4ed8;
          font-weight: 700;
        }
        .sim-pane-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
        }
        .sim-mode-pill {
          font-size: 12.5px;
          font-weight: 700;
          padding: 2px 8px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #1e293b;
          border-radius: 3px;
        }
        .sim-mode-pill.is-live {
          color: #047857;
          border-color: #a7f3d0;
          background: #ecfdf5;
        }
        .sim-step-ms {
          font-size: 13px;
          color: #1e293b;
          font-weight: 700;
        }

        .sim-trace-body {
          display: flex;
          flex-direction: column;
        }
        .sim-svg-frame {
          padding: 12px;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-svg {
          width: 100%;
          height: auto;
          display: block;
          border: 1px solid #e2e8f0;
        }
        .sim-edge-flow {
          stroke-dasharray: 6 4;
          animation: sim-edge-dash 1s linear infinite;
        }
        .sim-contract-strip {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 14px;
          padding: 9px 14px;
          border-bottom: 1px solid #e2e8f0;
          background: #ffffff;
          font-size: 13px;
          color: #1e293b;
        }
        .sim-contract-strip code {
          color: #0f172a;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          padding: 2px 7px;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 700;
          margin-right: 4px;
        }
        .sim-console {
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-console-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 8px 14px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 13px;
          background: #f1f5f9;
        }
        .sim-console-head b {
          color: #1d4ed8;
          font-weight: 700;
        }
        .sim-console-head span {
          color: #0f172a;
          font-weight: 600;
        }
        .sim-console-body {
          margin: 0;
          padding: 10px 14px;
          min-height: 74px;
          font-family: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-variant-numeric: tabular-nums;
          font-size: 13px;
          line-height: 1.65;
          color: #0f172a;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }

        .sim-archify-wrap {
          display: flex;
          flex-direction: column;
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-archify-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 13px;
          color: #334155;
        }
        .sim-archify-bar code {
          font-family: inherit;
          font-weight: 700;
          color: #0f172a;
        }
        .sim-archify-iframe {
          position: static !important;
          inset: auto !important;
          width: 100%;
          height: 540px !important;
          border: 0;
          display: block;
          background: #ffffff;
        }

        .sim-bp-ledger {
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-bp-row {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          gap: 14px;
          padding: 14px;
          border-bottom: 1px solid #e2e8f0;
          align-items: start;
        }
        .sim-bp-row:last-child {
          border-bottom: 0;
        }
        .sim-bp-thumb {
          position: relative;
          border: 1px solid #cbd5e1;
          cursor: zoom-in;
          background: #f8fafc;
        }
        .sim-bp-thumb img {
          width: 100%;
          display: block;
          aspect-ratio: 16 / 10;
          object-fit: cover;
        }
        .sim-bp-zoom {
          position: absolute;
          right: 6px;
          bottom: 6px;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          color: #0f172a;
          font-size: 12.5px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 3px;
        }
        .sim-bp-spec {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sim-bp-head {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-bp-badge {
          font-size: 12.5px;
          font-weight: 700;
          color: #1d4ed8;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 3px;
          padding: 2px 8px;
        }
        .sim-bp-spec h4 {
          margin: 0;
          font-size: 14.5px;
          color: #0f172a;
        }
        .sim-bp-sub {
          margin: 0;
          font-size: 12.5px;
          color: #334155;
          font-family: inherit;
        }
        .sim-bp-spec ul {
          margin: 2px 0 0;
          padding-left: 18px;
          font-size: 13.5px;
          color: #1e293b;
          line-height: 1.5;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        /* 좌측 하단: 5열 엔지니어링 실행 로그 원장 */
        .sim-timeline-section {
          background: #ffffff;
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
        }
        .sim-timeline-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 9px 14px;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 13px;
        }
        .sim-timeline-head b {
          color: #0f172a;
          font-size: 14px;
          margin-right: 10px;
        }
        .sim-timeline-head span {
          color: #334155;
        }
        .sim-table-wrap {
          width: 100%;
          overflow-x: auto;
        }
        .sim-exec-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13.5px;
        }
        .sim-exec-table th,
        .sim-exec-table td {
          padding: 6.5px 9px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: middle;
        }
        .sim-exec-table tr:last-child td {
          border-bottom: 0;
        }
        .sim-exec-table th {
          background: #ffffff;
          color: #334155;
          font-size: 12.5px;
          font-weight: 700;
          border-bottom: 1px solid #cbd5e1;
          white-space: nowrap;
        }
        .sim-exec-row {
          cursor: pointer;
          transition: background 0.12s;
        }
        .sim-exec-row:hover {
          background: #f8fafc;
        }
        .sim-exec-row.is-active {
          background: #eff6ff;
        }
        .sim-exec-row.is-active td:first-child {
          border-left-color: #1d4ed8;
        }
        .sim-col-step {
          font-weight: 700;
          color: #0f172a;
          width: 44px;
          border-left: 3px solid transparent;
          white-space: nowrap;
        }
        .sim-node-cell,
        .sim-mod-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sim-node-cell strong {
          color: #0f172a;
          font-size: 13px;
          word-break: keep-all;
        }
        .sim-node-cell span,
        .sim-mod-cell span {
          color: #334155;
          font-size: 12.5px;
        }
        .sim-mod-cell code {
          font-family: inherit;
          font-size: 12.5px;
          color: #1d4ed8;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .sim-col-time {
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
        }
        .sim-col-time span {
          font-weight: 500;
          color: #334155;
          font-size: 12.5px;
        }
        .sim-guard-cell {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 13px;
          color: #1e293b;
        }

        /* 우측 40%: 원장형 인스펙터 시트 */
        .sim-right-pane {
          min-width: 0;
          background: #ffffff;
          display: flex;
          flex-direction: column;
        }
        .sim-inspector-block {
          padding: 12px 14px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .sim-inspector-block:last-child {
          border-bottom: 0;
        }
        .sim-inspector-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 14px;
          color: #0f172a;
        }
        .sim-mono-sub {
          font-size: 12.5px;
          color: #334155;
          font-family: inherit;
          font-weight: 600;
        }

        .sim-route-hops {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border: 1px solid #e2e8f0;
        }
        .sim-hop {
          padding: 7px 9px;
          border-right: 1px solid #e2e8f0;
          border-bottom: 1px solid #e2e8f0;
          background: #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sim-hop:nth-child(2n) {
          border-right: 0;
        }
        .sim-hop:nth-last-child(-n+2) {
          border-bottom: 0;
        }
        .sim-hop code {
          font-family: inherit;
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          overflow-wrap: anywhere;
        }
        .sim-hop span {
          font-size: 12.5px;
          color: #334155;
        }
        .sim-hop.is-active {
          background: #eff6ff;
          border-left: 3px solid #1d4ed8;
        }
        .sim-hop.is-active code {
          color: #1d4ed8;
        }

        .sim-kv-ledger {
          margin: 0;
          border: 1px solid #e2e8f0;
        }
        .sim-kv-row {
          display: grid;
          grid-template-columns: 162px minmax(0, 1fr);
          border-bottom: 1px solid #e2e8f0;
          font-size: 13.5px;
        }
        .sim-kv-row:last-child {
          border-bottom: 0;
        }
        .sim-kv-row dt {
          padding: 8px 10px;
          background: #f8fafc;
          color: #1e293b;
          font-weight: 700;
          border-right: 1px solid #e2e8f0;
          word-break: keep-all;
          white-space: nowrap;
        }
        .sim-kv-row dd {
          margin: 0;
          padding: 8px 10px;
          color: #0f172a;
          overflow-wrap: anywhere;
          line-height: 1.45;
        }
        .sim-kv-row code {
          font-family: inherit;
          font-size: 13px;
          color: #1d4ed8;
          font-weight: 700;
        }

        .sim-guard-pill,
        .sim-mono-pill {
          display: inline-block;
          font-size: 12.5px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 3px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #1e293b;
          font-family: inherit;
          white-space: nowrap;
        }
        .sim-guard-pill.is-active,
        .sim-mono-pill.is-active {
          color: #1d4ed8;
          background: #eff6ff;
          border-color: #bfdbfe;
        }
        .sim-guard-pill.is-ok,
        .sim-mono-pill.is-ok {
          color: #047857;
          background: #ecfdf5;
          border-color: #a7f3d0;
        }
        .sim-guard-pill.is-warn,
        .sim-mono-pill.is-warn {
          color: #b45309;
          background: #fffbeb;
          border-color: #fde68a;
        }

        .sim-surface-preview,
        .sim-gate-ledger {
          border: 1px solid #cbd5e1;
          background: #ffffff;
        }
        .sim-surface-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 8px 11px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          font-size: 13.5px;
        }
        .sim-surface-meta {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          padding: 6px 11px;
          border-bottom: 1px solid #e2e8f0;
          font-size: 12.5px;
          color: #334155;
        }
        .sim-surface-meta span:first-child {
          font-weight: 700;
          color: #0f172a;
        }
        .sim-surface-lines {
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .sim-line-row {
          display: grid;
          grid-template-columns: 74px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          padding: 7px 9px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 13px;
          line-height: 1.5;
          color: #334155;
        }
        .sim-line-row.is-lit {
          border-color: #1d4ed8;
          background: #ffffff;
          color: #0f172a;
        }
        .sim-line-tag {
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          color: #1d4ed8;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 3px;
          padding: 2px 6px;
          text-align: center;
          white-space: nowrap;
        }
        .sim-line-text {
          min-width: 0;
          overflow-wrap: anywhere;
          color: #0f172a;
        }
        .sim-ocr-token {
          display: inline-block;
          max-width: 100%;
          overflow-wrap: anywhere;
          padding: 1px 6px;
          margin: 1px 0;
          border-radius: 3px;
          border: 1px solid #cbd5e1;
          background: #f1f5f9;
          color: #0f172a;
          font-weight: 700;
        }
        .sim-ocr-token.is-lit {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1e293b;
        }
        .sim-ocr-token.is-scanning {
          border: 1.5px dashed #1d4ed8;
          background: #eff6ff;
          color: #1d4ed8;
        }
        .sim-line-gutter {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .sim-gutter-leader {
          width: 14px;
          height: 0;
          border-top: 1.5px dashed #64748b;
        }
        .sim-line-gutter.is-scanning .sim-gutter-leader,
        .sim-line-gutter.is-lit .sim-gutter-leader {
          border-top-color: #1d4ed8;
        }
        .sim-gutter-badge {
          font-size: 12px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 3px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          color: #334155;
        }
        .sim-line-gutter.is-scanning .sim-gutter-badge,
        .sim-line-gutter.is-lit .sim-gutter-badge {
          border-color: #bfdbfe;
          background: #eff6ff;
          color: #1d4ed8;
        }

        .sim-gate-standby {
          margin: 0;
          padding: 11px;
          font-size: 13px;
          color: #334155;
          line-height: 1.55;
        }
        .sim-gate-standby code {
          font-family: inherit;
          font-weight: 700;
          color: #0f172a;
        }
        .sim-gate-card {
          padding: 11px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sim-gate-title {
          font-size: 14px;
          font-weight: 700;
          color: #0f172a;
        }
        .sim-gate-meta {
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 13px;
        }
        .sim-gate-meta div {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .sim-gate-meta b {
          color: #334155;
          min-width: 92px;
        }
        .sim-gate-meta code {
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 700;
          color: #1d4ed8;
        }
        .sim-approve-btn {
          background: #047857;
          color: #ffffff;
          border: 1px solid #047857;
          border-radius: 3px;
          padding: 8px 14px;
          font: inherit;
          font-weight: 700;
          font-size: 13.5px;
          cursor: pointer;
        }
        .sim-approve-btn:hover {
          background: #065f46;
        }
        .sim-receipt-box {
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          padding: 9px 11px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sim-receipt-top {
          display: flex;
          justify-content: space-between;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 13px;
          color: #047857;
        }
        .sim-receipt-body {
          font-family: inherit;
          font-size: 12.5px;
          color: #0f172a;
          overflow-wrap: anywhere;
        }

        .sim-guard-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          border: 1px solid #e2e8f0;
        }
        .sim-guard-table th,
        .sim-guard-table td {
          padding: 7px 9px;
          border-bottom: 1px solid #e2e8f0;
          text-align: left;
          vertical-align: middle;
        }
        .sim-guard-table th {
          background: #f8fafc;
          color: #334155;
          font-weight: 700;
          font-size: 12.5px;
        }
        .sim-guard-table tr:last-child td {
          border-bottom: 0;
        }
        .sim-guard-table code {
          font-family: inherit;
          font-weight: 700;
          font-size: 12.5px;
          color: #0f172a;
        }

        /* 3. 하단 전체 폭(100%) 마스터-디테일 실제 작업 캡처 & 실측 대조 워크벤치 */
        .sim-capture-workbench {
          padding: 16px 18px 20px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sim-capture-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .sim-capture-title-group {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sim-capture-title-group b {
          font-size: 16px;
          color: #0f172a;
        }
        .sim-staff-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 13.5px;
        }
        .sim-staff-row label {
          font-weight: 700;
          color: #1e293b;
        }
        .sim-staff-row select {
          background: #ffffff;
          color: #0f172a;
          border: 1px solid #cbd5e1;
          border-radius: 3px;
          padding: 5px 10px;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
        }
        .sim-person-bar {
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 13.5px;
          line-height: 1.5;
          color: #1e293b;
          padding: 9px 12px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }
        .sim-person-bar b {
          color: #0f172a;
          font-size: 14px;
        }
        .sim-dept-tag {
          font-size: 12.5px;
          font-weight: 700;
          color: #1d4ed8;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
          border-radius: 3px;
          padding: 1px 7px;
        }
        .sim-person-summary {
          color: #334155;
        }
        .sim-capture-loading {
          padding: 20px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #334155;
          font-size: 13.5px;
        }

        .sim-capture-split {
          display: grid;
          grid-template-columns: minmax(0, 62fr) minmax(0, 38fr);
          gap: 16px;
          align-items: start;
        }
        .sim-capture-stage {
          border: 1px solid #cbd5e1;
          background: #ffffff;
          min-width: 0;
        }
        .sim-stage-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 9px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
        }
        .sim-stage-title-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }
        .sim-stage-ts {
          font-size: 12.5px;
          font-weight: 700;
          color: #334155;
        }
        .sim-stage-title {
          font-size: 14px;
          color: #0f172a;
        }
        .sim-stage-frame {
          display: flex;
          justify-content: center;
          background: #f1f5f9;
          padding: 8px;
        }
        .sim-stage-inner {
          position: relative;
          display: inline-block;
          line-height: 0;
          max-width: 100%;
        }
        .sim-stage-inner img {
          display: block;
          max-width: 100%;
          width: auto;
          height: auto;
          max-height: 620px;
          background: #ffffff;
        }
        .sim-stage-frame.is-large .sim-stage-inner img {
          max-height: 70vh;
        }
        .sim-ai-bbox {
          position: absolute;
          border: 2px solid #1d4ed8;
          background: rgba(29, 78, 216, 0.06);
          pointer-events: none;
          box-sizing: border-box;
        }
        .sim-ai-bbox.is-focused {
          border-color: #b45309;
          border-width: 2.5px;
          background: rgba(180, 83, 9, 0.14);
          z-index: 3;
        }
        .sim-ai-no {
          position: absolute;
          min-width: 22px;
          height: 22px;
          padding: 0 5px;
          border-radius: 999px;
          background: #1d4ed8;
          color: #ffffff;
          border: 2px solid #ffffff;
          font-size: 12px;
          font-weight: 700;
          line-height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .sim-ai-bbox.is-focused .sim-ai-no {
          background: #b45309;
        }

        .sim-capture-sidebar {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }
        .sim-legend-box,
        .sim-caplist-box {
          border: 1px solid #cbd5e1;
          background: #ffffff;
        }
        .sim-legend-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          padding: 9px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          font-size: 13.5px;
          color: #0f172a;
        }
        .sim-box-legend {
          margin: 0;
          padding: 10px 12px;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sim-box-legend.is-modal {
          border: 1px solid #e2e8f0;
          background: #f8fafc;
        }
        .sim-box-legend li {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 6px 8px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 13.5px;
          line-height: 1.45;
          color: #0f172a;
        }
        .sim-box-legend li.is-focused {
          border-color: #b45309;
          background: #fffbeb;
        }
        .sim-legend-no {
          flex: 0 0 auto;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 3px;
          background: #1d4ed8;
          color: #ffffff;
          font-size: 12.5px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .sim-box-legend li.is-focused .sim-legend-no {
          background: #b45309;
        }
        .sim-legend-text {
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .sim-legend-empty {
          padding: 11px 12px;
          font-size: 13.5px;
          color: #1e293b;
        }
        .sim-legend-screen {
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .sim-legend-empty p {
          margin: 0;
          color: #334155;
          line-height: 1.5;
        }

        .sim-caplist {
          display: flex;
          flex-direction: column;
          max-height: 440px;
          overflow-y: auto;
        }
        .sim-cap-row {
          width: 100%;
          text-align: left;
          background: #ffffff;
          border: 0;
          border-bottom: 1px solid #e2e8f0;
          padding: 9px 10px;
          display: grid;
          grid-template-columns: 104px minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          cursor: pointer;
          font: inherit;
          color: #0f172a;
        }
        .sim-cap-row:last-child {
          border-bottom: 0;
        }
        .sim-cap-row:hover {
          background: #f8fafc;
        }
        .sim-cap-row.is-active {
          background: #eff6ff;
          border-left: 3px solid #1d4ed8;
        }
        .sim-cap-row img {
          width: 104px;
          height: 65px;
          object-fit: cover;
          display: block;
          border: 1px solid #cbd5e1;
          background: #f1f5f9;
        }
        .sim-cap-info {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .sim-cap-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 12px;
          color: #334155;
        }
        .sim-cap-kind {
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 3px;
          background: #f1f5f9;
          border: 1px solid #cbd5e1;
          color: #334155;
        }
        .sim-cap-kind.is-ai {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
        }
        .sim-cap-cnt {
          font-weight: 700;
          color: #047857;
        }
        .sim-cap-title {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.4;
          color: #0f172a;
          white-space: normal;
          word-break: keep-all;
          overflow-wrap: anywhere;
        }
        .sim-cap-sub {
          font-size: 12.5px;
          color: #334155;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .sim-fallback-note {
          padding: 11px 13px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          font-size: 13.5px;
          color: #334155;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sim-fallback-note b {
          color: #b45309;
        }
        .sim-fallback-note p {
          margin: 0;
        }
        .sim-fallback-note code {
          font-family: inherit;
          font-weight: 700;
          color: #0f172a;
        }

        .sim-compare-ledger {
          border: 1px solid #cbd5e1;
        }
        .sim-compare-header {
          padding: 9px 12px;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 13.5px;
        }
        .sim-compare-header span {
          color: #047857;
          font-weight: 700;
        }
        .sim-compare-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .sim-compare-col {
          padding: 10px 14px;
          border-right: 1px solid #e2e8f0;
          font-size: 13.5px;
          line-height: 1.55;
        }
        .sim-compare-col:last-child {
          border-right: 0;
        }
        .sim-compare-col.is-after {
          background: #f8fafc;
        }
        .sim-compare-sub {
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 5px;
        }
        .sim-compare-col.is-after .sim-compare-sub {
          color: #047857;
        }
        .sim-compare-col ol {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sim-compare-col small {
          color: #334155;
          font-size: 12.5px;
        }

        /* 모달 */
        .sim-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          z-index: 60;
        }
        .sim-modal-box {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          padding: 16px;
          width: min(1100px, 95vw);
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
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 8px;
        }
        .sim-modal-head h4 {
          margin: 4px 0 0;
          font-size: 16px;
          color: #0f172a;
        }
        .sim-modal-img {
          width: 100%;
          max-height: 70vh;
          object-fit: contain;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }
        .sim-modal-callouts {
          margin: 0;
          padding-left: 20px;
          font-size: 13.5px;
          color: #1e293b;
          line-height: 1.55;
        }
        .sim-dim {
          color: #334155;
          font-size: 13px;
        }

        @keyframes sim-edge-dash {
          from { stroke-dashoffset: 20; }
          to { stroke-dashoffset: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .sim-edge-flow {
            animation: none !important;
          }
          .sim-progress-fill,
          .sim-btn,
          .sim-hairline-link,
          .sim-exec-row {
            transition: none !important;
          }
        }

        @media (max-width: 1180px) {
          .sim-main-split,
          .sim-capture-split {
            grid-template-columns: 1fr;
          }
          .sim-left-pane {
            border-right: 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .sim-metrics-strip,
          .sim-scenario-tabs {
            grid-template-columns: 1fr;
          }
          .sim-metric-cell {
            border-left: 0;
            border-top: 1px solid #e2e8f0;
          }
          .sim-btn-group {
            border-right: 0;
            border-bottom: 1px solid #e2e8f0;
            width: 100%;
          }
        }
        @media (max-width: 720px) {
          .sim-bp-row,
          .sim-compare-grid,
          .sim-route-hops,
          .sim-kv-row,
          .sim-line-row {
            grid-template-columns: 1fr;
          }
          .sim-kv-row dt {
            border-right: 0;
            border-bottom: 1px solid #e2e8f0;
            white-space: normal;
          }
          .sim-gutter-leader {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
