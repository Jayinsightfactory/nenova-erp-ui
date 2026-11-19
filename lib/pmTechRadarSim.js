// lib/pmTechRadarSim.js
// 도입 · 기술 레이더 정규화, 4분면 극좌표/2x2 매트릭스 배치 및 nenovakakao 실설계 기반 파이프라인 도입 시뮬레이션 엔진.
// 규칙: __tests__/pmBoundary.test.js(사내 전산 모듈 import 금지) · __tests__/pmNoHexColor.test.js(색상 코드 직접 작성 금지) · 금지어 미사용.

export const RADAR_QUADRANTS = Object.freeze([
  {
    id: 'Q1',
    code: 'Q1',
    label: 'Q1 에이전트·오케스트레이션',
    shortLabel: '에이전트·오케스트레이션',
    corner: 'tr',
    angleStart: -Math.PI / 2,
    angleEnd: 0,
  },
  {
    id: 'Q2',
    code: 'Q2',
    label: 'Q2 고성능 런타임·사이드카(Rust)',
    shortLabel: '고성능 런타임·Rust',
    corner: 'tl',
    angleStart: -Math.PI,
    angleEnd: -Math.PI / 2,
  },
  {
    id: 'Q3',
    code: 'Q3',
    label: 'Q3 카톡·디바이스 브릿지',
    shortLabel: '카톡·디바이스 브릿지',
    corner: 'bl',
    angleStart: Math.PI / 2,
    angleEnd: Math.PI,
  },
  {
    id: 'Q4',
    code: 'Q4',
    label: 'Q4 UI·시각화·문서검증',
    shortLabel: 'UI·시각화·문서검증',
    corner: 'br',
    angleStart: 0,
    angleEnd: Math.PI / 2,
  },
]);

export const RADAR_RINGS = Object.freeze([
  { id: 'adopt', code: 'ADOPT', label: 'ADOPT 정식채택', shortLabel: '정식채택', rMin: 0.08, rMax: 0.30, order: 0 },
  { id: 'trial', code: 'TRIAL', label: 'TRIAL 파일럿실측', shortLabel: '파일럿실측', rMin: 0.33, rMax: 0.56, order: 1 },
  { id: 'assess', code: 'ASSESS', label: 'ASSESS 도입검토', shortLabel: '도입검토', rMin: 0.59, rMax: 0.80, order: 2 },
  { id: 'hold', code: 'HOLD', label: 'HOLD 보류·대기', shortLabel: '보류·대기', rMin: 0.83, rMax: 0.96, order: 3 },
]);

export const PIPELINE_STAGES = Object.freeze([
  { id: 'scanned', code: 'SCANNED', label: '발굴', order: 0, desc: '과제 수집·레이더 등재' },
  { id: 'pilot', code: 'PILOT', label: '파일럿', order: 1, desc: '실데이터 격리 벤치마크' },
  { id: 'canary', code: 'CANARY', label: '카나리', order: 2, desc: '부분 적용·결재 검수' },
  { id: 'adopted', code: 'ADOPTED', label: '정식채택', order: 3, desc: '표준 운영·Fallback 고정' },
]);

export const MATRIX_ZONES = Object.freeze([
  { id: 'adopt-now', label: '즉시 도입·운영 확대', xMin: 50, yMin: 50 },
  { id: 'pilot-verify', label: '파일럿·보안 검증 우선', xMin: 0, yMin: 50 },
  { id: 'utility-adopt', label: '보조 유틸·점진 반영', xMin: 50, yMin: 0 },
  { id: 'watch-hold', label: '관찰·보류 대기', xMin: 0, yMin: 0 },
]);

// nenovakakao + Orbit + 네노바웹 인수인계 실설계 6대 표면 노드
export const ARCH_SURFACE_NODES = Object.freeze([
  {
    id: 'N1',
    code: 'N1',
    name: '운영PC nenovakakao',
    shortName: '운영PC nenovakakao',
    surface: 'Surface 1 · 카톡 직렬 워커',
    modules: ['core/moyi_worker.py', 'core/self_update.py', 'core/moyi_inbound.py', 'core/deferred_photos.py'],
    contract: 'sales 5초 주기 · addcancel_archive 300초 · PR 50 별도 계정 승인 후 5분 주기 자동배포 · 개발PC 실행 분리',
  },
  {
    id: 'N2',
    code: 'N2',
    name: '보조수집 Phone Harness + Rust Sidecar',
    shortName: 'Phone Harness + Rust',
    surface: 'Surface 2 · 현장 단말·사이드카',
    modules: ['nenova-device-sidecar.exe (402.5KB)', 'adb Read-Only', 'guard-check (0.007ms)', 'pHash·WSS 역터널'],
    contract: '위챗·야간·12장 초과 사진 보조수집 · 송금/이체/삭제 키워드 0.007ms 차단 · FLAG_SECURE 시 WAITING_HUMAN 반납',
  },
  {
    id: 'N3',
    code: 'N3',
    name: 'MOYI 브릿지 & 모바일 승인',
    shortName: 'MOYI 브릿지·승인',
    surface: 'Surface 3 · Dual-Path 승인 게이트',
    modules: ['/kakao/agent/pending', '/kakao/agent/inbound', '/kakao/agent/ack', 'dedup_key SHA-256'],
    contract: 'RoomCircuitBreaker(연속 3회 실패 시 30분 격리) · ApprovedBy <> ProposedBy 사람 원터치 승인',
  },
  {
    id: 'N4',
    code: 'N4',
    name: 'Orbit & Hermes 에이전트 코어',
    shortName: 'Orbit & Hermes',
    surface: 'Surface 4 · 지능·압축·스킬',
    modules: ['core/mindmap_sink.py (/api/kakao/import)', 'hermes-manager.js', 'hermes-core.exe (4.35x)', '97 SKILL.md'],
    contract: 'flush_pending 50건 배치 아카이브 · Claude↔Codex 쿼터 폴백 · 27.5MB->2.4MB(-91.3%) 압축 · JS Fallback',
  },
  {
    id: 'N5',
    code: 'N5',
    name: '네노바웹 Chrome/API 브릿지',
    shortName: '네노바웹 Chrome/API',
    surface: 'Surface 5 · Native Host 브릿지',
    modules: ['core/browser_session_bridge.py', 'com.nenovakakao.sales_session', '/import/pipeline', '/shipment/quick-absorb', 'sales-paste'],
    contract: 'TCP 포트 미개방 Chrome Native Host · approved_revision == revision 검사 · write_unknown 선기록',
  },
  {
    id: 'N6',
    code: 'N6',
    name: '공유 MSSQL 원장 & 네노바 데스크톱앱',
    shortName: 'MSSQL 원장·데스크톱',
    surface: 'Surface 6 · 공유 원장·앱',
    modules: ['OrderYear+OrderWeek dnSpy 계약', 'SCREENSHOT 영수증 재조회', 'OrderDetail·Estimate', 'desktop v1.3.54'],
    contract: 'BEGIN TRAN UPDLOCK + safeNextKey() · 저장 직후 SCREENSHOT 독립 재조회 · 데스크톱앱 카탈로그 동기화',
  },
]);

const BASELINE_SAFETY_CHECKS = [
  {
    id: 'prod-worker-isolation',
    label: '운영 PC 매크로 무간섭',
    status: 'PASS',
    detail: 'core/moyi_worker.py 직렬 카톡 루프와 development.lock 충돌 0건 (이 PC 워커/매크로 실행 차단 유지)',
  },
  {
    id: 'pr50-deploy-gate',
    label: 'PR 50 별도 계정 승인 · 5분 배포 경계',
    status: 'PASS',
    detail: 'core/self_update.py fast-forward · py compileall 통과 시에만 반영 · requirements.txt 변경 시 자동 보류',
  },
  {
    id: 'tier1-write-fence',
    label: 'Tier 1 무승인 쓰기 차단',
    status: 'PASS',
    detail: 'OrderYear+OrderWeek 원장 변경 전 ApprovedBy <> ProposedBy 승인 및 SCREENSHOT 영수증 독립 재조회 필수',
  },
  {
    id: 'runtime-fallback',
    label: '순수 JS/Python Fallback 무중단 보장',
    status: 'PASS',
    detail: '외부 바이너리·보조 도구가 비활성이어도 기존 Node/Python 경로가 동일 계약을 유지하며 중단 없이 동작',
  },
];

// 실설계 시나리오 라이브러리 (레이더 기술 ID/키워드 매칭)
export const SIM_SCENARIOS = Object.freeze([
  {
    id: 'hermes-agent',
    match: ['nousresearch/hermes-agent', 'hermes-agent', 'hermes-manager', 'hermes'],
    title: 'Hermes 에이전트 오케스트레이션 & 원문 아카이브 압축 파이프라인',
    subtitle: 'moyi_inbound -> mindmap_sink(/api/kakao/import) -> hermes-manager.js(97 SKILL.md · Claude↔Codex 폴백)',
    activeNodes: ['N1', 'N3', 'N4', 'N5'],
    primaryNode: 'N4',
    links: [
      { label: '통합 솔루션 시뮬레이터', href: '/my-work?tab=suite-sim', adminOnly: true },
      { label: '수입 원스톱 파이프라인', href: '/import/pipeline', adminOnly: false },
    ],
    nodeOverrides: {
      N1: {
        before: '카톡 원문·에러 로그가 로컬 파일에만 쌓여 재가동 시 직전 맥락 유실 위험',
        after: 'core/moyi_inbound.py 증분 해시 이벤트가 mindmap_sink.py 아웃박스로 즉시 적재',
        artifact: 'core/moyi_inbound.py -> core/mindmap_sink.py',
      },
      N3: {
        before: 'MOYI 승인 대기·전송 이력이 대화 로그 원문에 섞여 파악 지연',
        after: '/kakao/agent/inbound 적재와 함께 dedup_key SHA-256 기준으로 중복 없는 맥락 전달',
        artifact: '/kakao/agent/inbound · dedup_key',
      },
      N4: {
        before: '대용량 스풀 로그(27.5MB)가 컨텍스트 한도를 소모하고 단일 LLM 한도 시 조사 중단',
        after: 'hermes-manager.js + hermes-core.exe로 2.4MB(-91.3%) 압축 · 97/97 SKILL.md(73ms) · Claude↔Codex 폴백',
        artifact: 'hermes-manager.js · 97 SKILL.md · session_rescue.jsonl',
      },
      N5: {
        before: '매칭 후보가 바뀌면 sales-paste 초안 맥락을 매번 재설명',
        after: '합성된 SKILL.md 절차 지식이 네노바웹 주문·분배 보조 검토 컨텍스트를 안정 공급',
        artifact: '/import/pipeline · sales-paste',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N1',
        artifact: 'core/moyi_inbound.py · parse_export',
        packetSummary: '카톡 1분 단위 동일 문구 occurrence ordinal 포함 kakao_<sha256> 이벤트 생성',
        beforeNote: '원문 파일이 커지면 컨텍스트 창 초과로 과거 맥락 누락',
        afterNote: 'mindmap_sink.enqueue_events로 idempotent 아웃박스 큐에 즉시 적재',
        latencyMs: 12,
        throughput: '50건/배치',
        measured: true,
      },
      {
        stepNo: 2,
        nodeId: 'N4',
        artifact: 'core/mindmap_sink.py -> POST /api/kakao/import',
        packetSummary: 'flush_pending(batch_size=50)으로 Orbit 서버에 원문 배치 동기화(imported+skipped 검증)',
        beforeNote: '30분 주기 백그라운드 대기 시 sales-paste 인박스와 시차 발생',
        afterNote: '영업방 사이클 직후 즉시 flush로 웹 인박스와 동기 이동',
        latencyMs: 48,
        throughput: '50건/flush',
        measured: true,
      },
      {
        stepNo: 3,
        nodeId: 'N4',
        artifact: 'hermes-manager.js · syncSkills & compressTrajectory',
        packetSummary: 'playbooks 97건 SKILL.md(73ms) 변환 + Head·Tail 보존 로그 압축 + Claude↔Codex 한도 폴백',
        beforeNote: '단일 모델 한도(quota-hold) 시 조사관 세션 중단 및 27.5MB 로그 과다 투입',
        afterNote: 'session_rescue JSONL 계보 인계 + 2.4MB(-91.3%) 압축으로 무중단 지속 실행',
        latencyMs: 73,
        throughput: '97/97 SKILL.md',
        measured: true,
      },
      {
        stepNo: 4,
        nodeId: 'N5',
        artifact: 'core/browser_session_bridge.py · sales-paste',
        packetSummary: '승인 완료 건만 Chrome Native Host(com.nenovakakao.sales_session)로 전달 준비',
        beforeNote: '수동 재입력 또는 세션 만료 시 맥락 재수집 필요',
        afterNote: 'approved_revision 검증 및 write_unknown 선기록 계약으로 안전 실행',
        latencyMs: 35,
        throughput: '승인건 직렬',
        measured: false,
      },
    ],
    metrics: [
      { label: '스풀·워커 로그 크기', unit: 'MB', beforeVal: 27.5, afterVal: 2.4, beforeLabel: '27.5 MB', afterLabel: '2.4 MB', deltaLabel: '-91.3% 압축', pctImproved: 91.3, measured: true },
      { label: '절차 스킬 97건 동기화', unit: 'ms', beforeVal: 1800, afterVal: 73, beforeLabel: '수동 약 1,800 ms+', afterLabel: '73 ms (97/97건)', deltaLabel: '97/97 100%', pctImproved: 95.9, measured: true },
      { label: '한도(Quota-Hold) 복구율', unit: '%', beforeVal: 0, afterVal: 100, beforeLabel: '0% (중단)', afterLabel: '100% (Codex 폴백)', deltaLabel: '무중단 전환', pctImproved: 100, measured: true },
    ],
  },
  {
    id: 'rust-sidecar-core',
    match: ['rust', 'hermes-core', 'device-sidecar', 'xerj-org/xerj', 'xerj', 'codebase-memory-mcp', 'rust-anything'],
    title: 'Rust 단일 정적 바이너리 핫패스 (사이드카·로그압축·고속검색)',
    subtitle: 'nenova-device-sidecar.exe (402.5KB) · hermes-core.exe (4.35x) · xerj BM25 (1.1ms)',
    activeNodes: ['N2', 'N4', 'N6'],
    primaryNode: 'N2',
    links: [
      { label: '디바이스 허브 관제', href: '/my-work?tab=devices', adminOnly: true },
    ],
    nodeOverrides: {
      N2: {
        before: 'Node/Python 번들(80MB+) 상주 시 메모리 부담과 기동 지연',
        after: 'nenova-device-sidecar.exe(402.5KB) · 유휴 RAM 15MB 이하 · 0.007ms 킬스위치 판정',
        artifact: 'nenova-device-sidecar.exe (402.5KB)',
      },
      N4: {
        before: '대용량 JSONL/스풀 로그 정규화 및 SHA-256 해싱 시 GC 정지 발생 (grep 270ms)',
        after: 'hermes-core.exe 4.35x 압축·해싱 가속 (xerj 로그 검색 1.1ms, 약 250배 빠름)',
        artifact: 'hermes-core.exe · JS Fallback 내장',
      },
      N6: {
        before: '데스크톱 앱 ASAR 내부에 바이너리 포함 시 무결성/용량 제약 충돌',
        after: 'app.asar 외부 선택형 사이드카로 분리해 일반 직원 PC 배포 크기 영향 0',
        artifact: 'desktop v1.3.54 외부 사이드카 격리',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N2',
        artifact: 'nenova-device-sidecar.exe guard-check',
        packetSummary: 'ADB 단말 화면 텍스트에서 송금/이체/삭제 키워드 0.007ms 정적 차단 판정',
        beforeNote: '고수준 스크립트 정규식·런타임 기동 지연 (40~120ms)',
        afterNote: 'Rust 단일 정적 바이너리 즉시 판정 (0.007ms, 외부 의존성 0)',
        latencyMs: 0.007,
        throughput: '140,000건/초',
        measured: true,
      },
      {
        stepNo: 2,
        nodeId: 'N4',
        artifact: 'hermes-core.exe · dedup_key SHA-256 & 압축',
        packetSummary: 'events.jsonl / vision-spool.log 대량 스캔·해싱·압축 4.35x 가속 (xerj 검색 1.1ms)',
        beforeNote: '대용량 로그 분석 시 메모리 급증 및 단일 스레드 병목',
        afterNote: '4.35x 처리 가속 + 미설치 환경용 순수 JS/Python Fallback 동시 유지',
        latencyMs: 1.1,
        throughput: '4.35x 가속',
        measured: true,
      },
      {
        stepNo: 3,
        nodeId: 'N6',
        artifact: 'desktop/main.cjs · ASAR Fuses 무결성 유지',
        packetSummary: '일반 사무직 데스크톱 앱과 현장용 사이드카 바이너리 분리 배포',
        beforeNote: '전체 PC에 무거운 Python/ADB 런타임 동반 설치 우려',
        afterNote: 'onlyLoadAppFromAsar=true 준수 · 필요한 PC에만 402.5KB 선택 탑재',
        latencyMs: 4,
        throughput: '402.5KB 단일',
        measured: true,
      },
    ],
    metrics: [
      { label: '사이드카 바이너리 크기', unit: 'KB', beforeVal: 81920, afterVal: 402.5, beforeLabel: '80 MB+ (런타임 번들)', afterLabel: '402.5 KB (정적 EXE)', deltaLabel: '-99.5% 경량화', pctImproved: 99.5, measured: true },
      { label: '스풀 압축·해싱 속도 배수', unit: 'x', beforeVal: 1.0, afterVal: 4.35, beforeLabel: '1.00x (순수 JS)', afterLabel: '4.35x (Rust 코어)', deltaLabel: '4.35배 가속', pctImproved: 77.0, measured: true },
      { label: '킬스위치 위험 문구 판정', unit: 'ms', beforeVal: 42.0, afterVal: 0.007, beforeLabel: '42.0 ms', afterLabel: '0.007 ms', deltaLabel: '1ms 미만 고정', pctImproved: 99.9, measured: true },
    ],
  },
  {
    id: 'devicehub-phone-harness',
    match: ['vkcom/devicehub', 'devicehub', 'phone harness', 'chromedevtools', 'chrome-devtools-mcp', 'microsoft/playwright', 'playwright', 'agent-browser', 'browser'],
    title: '보조수집 Phone Harness + Chrome Native Bridge & 화면 회귀 검증',
    subtitle: 'deferred_photos(18시·12장 한도) 사각지대 보완 + Chrome Native Host + 화면/콘솔 자동 검증',
    activeNodes: ['N1', 'N2', 'N3', 'N5', 'N6'],
    primaryNode: 'N2',
    links: [
      { label: '디바이스 허브 관제', href: '/my-work?tab=devices', adminOnly: true },
      { label: '통합 솔루션 시뮬레이터', href: '/my-work?tab=suite-sim', adminOnly: true },
    ],
    nodeOverrides: {
      N1: {
        before: 'core/deferred_photos.py가 평시 사진 보류(18시 이후)·12장 초과 시 보류 및 위챗 미지원',
        after: 'PC 카톡 워커(N1)는 안정 유지한 채 위챗·야간·12장 초과 건을 N2가 무간섭 보조 수집',
        artifact: 'core/deferred_photos.py 한계 보완',
      },
      N2: {
        before: '공용폰·현장 위챗방 메시지와 12장 초과 파손 사진을 수동 캡처·전달',
        after: 'Phone Harness(adb Read-Only) + Rust 사이드카로 모바일 사각지대 99% 커버리지 확보',
        artifact: 'Phone Harness · Read-Only Lease',
      },
      N3: {
        before: '모바일 수집분과 PC 카톡 수집분이 중복 적재될 위험',
        after: 'MOYI /kakao/agent/inbound에서 dedup_key SHA-256으로 단일 건 병합 후 사람 승인 대기',
        artifact: 'MOYI Dual-Path dedup_key 병합',
      },
      N5: {
        before: '브라우저 세션 만료나 UI 셀렉터 깨짐 시 전산 입력 실패',
        after: 'browser_session_bridge.py(com.nenovakakao.sales_session) + Playwright/DevTools 회귀 점검',
        artifact: 'com.nenovakakao.sales_session',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N1',
        artifact: 'core/deferred_photos.py (allowed>=18h, len<=12)',
        packetSummary: '운영 PC 카톡 워커의 사진 수집 한계(주간 지연·12장 초과 보류·위챗 미지원) 식별',
        beforeNote: '주간·12장 초과·위챗 현장 메시지 수집률 약 68%',
        afterNote: 'N1 워커는 카톡 표준 경로만 전담, 초과·위챗 경로는 N2로 위임',
        latencyMs: 5000,
        throughput: '5초 주기',
        measured: false,
      },
      {
        stepNo: 2,
        nodeId: 'N2',
        artifact: 'Phone Harness · adb Read-Only + WSS 역터널',
        packetSummary: '공용 Android 단말에서 위챗 농장방·야간·다중 사진을 읽기 전용으로 즉시 수집',
        beforeNote: '수동 사진 다운로드·재전송에 10~15분 소요',
        afterNote: 'FLAG_SECURE 자동 감지 시 즉시 WAITING_HUMAN 반납 후 10초 원격 해제',
        latencyMs: 33,
        throughput: '30fps Lease',
        measured: false,
      },
      {
        stepNo: 3,
        nodeId: 'N3',
        artifact: 'MOYI Dual-Path · /kakao/agent/inbound',
        packetSummary: 'PC 경로(N1)와 모바일 경로(N2)를 SHA-256 dedup_key로 중복 제거 병합',
        beforeNote: '동일 메시지 2회 처리·중복 알림 우려',
        afterNote: '단일 승인 카드로 통합 노출되어 사람 원터치 승인만 수행',
        latencyMs: 18,
        throughput: '중복 0건',
        measured: false,
      },
      {
        stepNo: 4,
        nodeId: 'N5',
        artifact: 'core/browser_session_bridge.py · SCREENSHOT',
        packetSummary: 'Chrome Native Host 큐(data/browser_session_bridge)로 읽기·재조회 및 승인된 POST만 중계',
        beforeNote: '쿠키 직접 탈취 위험 또는 무검증 재전송 위험',
        afterNote: 'write_unknown 선기록 + 완료 후 SCREENSHOT 영수증 독립 재조회로 성공 확정',
        latencyMs: 46,
        throughput: '46ms/시트',
        measured: true,
      },
    ],
    metrics: [
      { label: '모바일·위챗·야간 수신 커버리지', unit: '%', beforeVal: 68, afterVal: 99, beforeLabel: '68% (PC 카톡 단독)', afterLabel: '99% (Dual-Path 보완)', deltaLabel: '+31%p 확장', pctImproved: 45.6, measured: false },
      { label: '시트·화면 자동 점검 (Playwright)', unit: 'ms', beforeVal: 3200, afterVal: 46, beforeLabel: '3,200 ms (수동 확인)', afterLabel: '46 ms/시트 (결함 94/94 탐지)', deltaLabel: '실측 98.5% 단축', pctImproved: 98.5, measured: true },
      { label: 'DevTools 점검 1회 소요', unit: 's', beforeVal: 120, afterVal: 13.4, beforeLabel: '약 120 s (수동 콘솔)', afterLabel: '13.4 s (자동 콘솔·접근성)', deltaLabel: '3/3 콘솔 포착', pctImproved: 88.8, measured: true },
    ],
  },
  {
    id: 'echarts-ui-vis',
    match: ['apache/echarts', 'echarts', 'airbnb/visx', 'visx', 'tanstack/table', 'flint-chart', 'perspective', 'json-render', 'answer-me-with-html'],
    title: '네노바웹 고밀도 차트·테이블 UI 시각화 (Apache ECharts / Anti-AI Slop)',
    subtitle: '2,289행 실데이터 100% 합계 일치(231,060건) · 15.9ms SSR SVG · 필요 모듈만 200KB(압축)',
    activeNodes: ['N4', 'N5', 'N6'],
    primaryNode: 'N5',
    links: [
      { label: '주간 매출이익 분석', href: '/sales/profit-report', adminOnly: false },
    ],
    nodeOverrides: {
      N4: {
        before: 'Orbit·PM 일일 집계 데이터를 정적 텍스트나 수작업 SVG로 제한적 표시',
        after: '서버 SSR SVG 생성(15.9ms) 지원으로 모바일 보고 및 MOYI 이미지 첨부 연계 가능',
        artifact: 'bench/stacked.svg · SSR SVG 90KB',
      },
      N5: {
        before: '차트 라이브러리 없이 수기 <svg>/<path> 작성(툴팁·히트맵·대용량 축소 표현 한계)',
        after: '필요 차트(막대·선·히트맵)만 트리셰이킹(200KB gzip)해 매출이익·물량 분석 화면에 부분 적용',
        artifact: 'pages/sales/profit-report · /stats/*',
      },
      N6: {
        before: '대량 원장 행(2,289행+)과 A4 인쇄 시 가독성·수치 정렬 검증 비용 상승',
        after: '합계 오차 0(231,060=231,060) 검증 + tabular-nums 고밀도 테이블과 1px 구조선 기준 준수',
        artifact: 'desktop v1.3.54 인쇄·테이블 호환',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N4',
        artifact: 'daily-events.csv (2,289행 · 44일 · 231,060건)',
        packetSummary: 'Orbit 실측 일별 이벤트 데이터를 차트 집계 입력으로 정규화',
        beforeNote: '수작업 SVG는 484점 이상 누적 막대·히트맵 유지보수 난이도 높음',
        afterNote: 'Apache-2.0 ECharts 6.1.0 SSR로 합계 231,060 오차 0 검증 완료',
        latencyMs: 6.8,
        throughput: '2,289행 집계',
        measured: true,
      },
      {
        stepNo: 2,
        nodeId: 'N5',
        artifact: '네노바웹 차수별 물량·매출이익 시각화 모듈',
        packetSummary: '전체 번들(1,096KB) 대신 막대·선·범례만 추출(573KB, gzip 200KB)해 선택 로딩',
        beforeNote: '전체 번들 포함 시 초기 로딩 1MB+ 증가 부담',
        afterNote: '누적 막대 15.9ms · 레이더 6.8ms · 히트맵 18.4ms로 즉시 렌더',
        latencyMs: 15.9,
        throughput: '200KB gzip',
        measured: true,
      },
      {
        stepNo: 3,
        nodeId: 'N6',
        artifact: '네노바웹 1px 원장 테이블 & A4 출력 호환',
        packetSummary: '한글 폰트·모바일 보고·A4 인쇄 여백 점검 후 기존 화면 보존 원칙 하에 점진 배치',
        beforeNote: '장식용 미니 차트·그림자 남발 시 업무 가독성 저하',
        afterNote: '축·단위·기준선이 명시된 고밀도 엔지니어링 차트만 적용',
        latencyMs: 18.4,
        throughput: 'A4 인쇄 일치',
        measured: true,
      },
    ],
    metrics: [
      { label: '484점 누적 막대 렌더 시간', unit: 'ms', beforeVal: 85, afterVal: 15.9, beforeLabel: '약 85 ms (수기 DOM)', afterLabel: '15.9 ms (SSR SVG)', deltaLabel: '20ms 미만 실측', pctImproved: 81.3, measured: true },
      { label: '번들 크기 (필요 모듈만)', unit: 'KB', beforeVal: 1096, afterVal: 200, beforeLabel: '1,096 KB (전체)', afterLabel: '200 KB (압축 번들)', deltaLabel: '-81.8% 경량화', pctImproved: 81.8, measured: true },
      { label: '데이터 합계 정합성 (231,060건)', unit: '%', beforeVal: 100, afterVal: 100, beforeLabel: '100% (수동 표)', afterLabel: '100% (오차 0건)', deltaLabel: '231,060 일치', pctImproved: 100, measured: true },
    ],
  },
  {
    id: 'headroom-compress',
    match: ['headroomlabs-ai/headroom', 'headroom', 'tokeneconomizer'],
    title: 'Headroom 이벤트 JSON 컨텍스트 압축 (선별적 적용 모델)',
    subtitle: 'screen.analyzed 96.9% · 혼합 JSON 90.9% 절감(값 보존 98%) — 단 order.detected/JSONL 제외 필수',
    activeNodes: ['N4'],
    primaryNode: 'N4',
    links: [],
    nodeOverrides: {
      N4: {
        before: 'Orbit events(76.5MB) 및 screen.analyzed 대용량 JSON 배열이 LLM 컨텍스트 토큰 과다 소비',
        after: 'screen.analyzed(96.9%) · 혼합 입력(90.9%)만 압축하고 발주/작업입력 JSONL은 우회해 98% 값 보존',
        artifact: 'headroom-ai 0.44.0 (HEADROOM_OFFLINE=1)',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N4',
        artifact: 'events/2026-11-10.jsonl.gz (7,410건, 76.5MB)',
        packetSummary: 'Orbit 화면분석(screen.analyzed, 전체 바이트의 88%) 배열 청크를 오프라인 압축',
        beforeNote: '8청크 기준 458,440 토큰 투입으로 한도(p7) 조기 소진',
        afterNote: '14,034 토큰(-96.9%, 건당 79ms, 값 보존 97.8%)으로 대폭 절감',
        latencyMs: 79,
        throughput: '-96.9% 토큰',
        measured: true,
      },
      {
        stepNo: 2,
        nodeId: 'N4',
        artifact: '선별 가드: order.detected · excel.activity 우회',
        packetSummary: '실측에서 보존율이 낮았던 발주감지(60%)·엑셀활동(41.2%)·JSONL(0~2%)은 압축 제외',
        beforeNote: '무분별한 일괄 압축 시 핵심 발주 수량/품목 누락 위험',
        afterNote: '메타·화면분석 JSON 배열에만 한정 적용해 정확도와 토큰 절감 양립',
        latencyMs: 21,
        throughput: '100% 무손실',
        measured: true,
      },
    ],
    metrics: [
      { label: '화면분석(screen.analyzed) 토큰', unit: 'K', beforeVal: 458.4, afterVal: 14.0, beforeLabel: '458.4K 토큰', afterLabel: '14.0K 토큰 (79ms)', deltaLabel: '-96.9% 절감', pctImproved: 96.9, measured: true },
      { label: '시간순 혼합 JSON 입력 토큰', unit: 'K', beforeVal: 111.6, afterVal: 10.2, beforeLabel: '111.6K 토큰', afterLabel: '10.2K 토큰 (21ms)', deltaLabel: '-90.9% 절감', pctImproved: 90.9, measured: true },
      { label: '발주감지(order.detected) 보존율', unit: '%', beforeVal: 60.0, afterVal: 100.0, beforeLabel: '60.0% (압축 시)', afterLabel: '100% (우회 가드)', deltaLabel: '우회로 무손실', pctImproved: 40.0, measured: true },
    ],
  },
  {
    id: 'ocr-doc-pipeline',
    match: ['datalab-to/indra', 'indra', 'rapidocr', 'docling', 'markitdown', 'mineru', 'marker'],
    title: '수입 서류·스캔 PDF 로컬 OCR(RapidOCR/Indra) & 수입원스톱 파이프라인',
    subtitle: '원본 PDF 48쪽 charF1 0.991(한글 97.9% · 숫자 97.4%) · 글자층 우선 · 저해상도 팩스 차단',
    activeNodes: ['N2', 'N4', 'N5', 'N6'],
    primaryNode: 'N5',
    links: [
      { label: '수입 원스톱 파이프라인', href: '/import/pipeline', adminOnly: false },
      { label: '인보이스 도구', href: '/import/tools', adminOnly: false },
    ],
    nodeOverrides: {
      N2: {
        before: '창고/수입 현장 이미지·스캔 PDF 내 번호·수량 판독을 사람 눈에만 의존',
        after: '로컬 OCR(외부 전송 0)이 글자층 없는 PDF/현장 라벨의 품목·수량을 1차 추출',
        artifact: 'RapidOCR / indra-ocr (외부전송 0)',
      },
      N4: {
        before: '이미지 PDF 입력 시 텍스트 추출 0자 또는 LLM 비전 비용 상승',
        after: '글자층 유무 판별 후 이미지 페이지에만 쪽당 0.87s 로컬 OCR 선행 투입',
        artifact: 'charF1 0.991 · 한글 97.9% · 숫자 97.4%',
      },
      N5: {
        before: '스캔 송장·AWB 수치를 네노바웹 수입정산·패킹리스트 화면에 수기 입력',
        after: '/import/pipeline · /import/tools 초안 채움 + 소계/합계 산술 교차검증 제공',
        artifact: '/import/pipeline · /import/tools',
      },
      N6: {
        before: '저해상도 팩스(100dpi, 26%) 오독이 전산에 그대로 들어갈 위험',
        after: '신뢰도/화질 가드로 저해상도 팩스 자동 등록 차단 & 원본 대조 화면에서 사람 확정',
        artifact: '원본 PDF 대조 확정 후 원장 반영',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N4',
        artifact: '글자층 검사 -> RapidOCR · indra-ocr (200dpi)',
        packetSummary: '디지털 글자층이 있으면 즉시 파싱, 스캔·이미지 PDF만 로컬 OCR(0.87s/쪽) 실행',
        beforeNote: '이미지 PDF는 텍스트 추출 불가(0자)로 전량 수기 입력',
        afterNote: '원본 48쪽 기준 한글 97.9% · 번호 토큰 97.4% 로컬 복원',
        latencyMs: 870,
        throughput: '0.87s/쪽',
        measured: true,
      },
      {
        stepNo: 2,
        nodeId: 'N5',
        artifact: '네노바웹 /import/pipeline · /import/tools',
        packetSummary: '추출된 품목·수량·단가 행과 송장 총액 간 산술 교차검증 후 미확인 항목만 표시',
        beforeNote: '병합 헤더/소계 중복을 사람이 행별로 일일이 검산',
        afterNote: '불일치 행과 원본 PDF 위치만 강조해 사람이 검토 후 적용',
        latencyMs: 42,
        throughput: '산술 교차 100%',
        measured: true,
      },
      {
        stepNo: 3,
        nodeId: 'N6',
        artifact: '신뢰도 컷오프 가드 (fax100 26% 차단)',
        packetSummary: '저해상도 팩스 등 저신뢰 입력은 자동 채움 보류, 확인 완료 건만 원장 반영',
        beforeNote: '저화질 숫자 오독 시 단가·수량 오류 위험',
        afterNote: '원장 저장 전 100% 사람 최종 확인 & 원본 증빙 보존',
        latencyMs: 15,
        throughput: '저신뢰 100% 차단',
        measured: true,
      },
    ],
    metrics: [
      { label: '원본 PDF 숫자·번호 재현율', unit: '%', beforeVal: 0, afterVal: 97.4, beforeLabel: '0% (이미지 PDF)', afterLabel: '97.4% (스캔 94.4%)', deltaLabel: 'charF1 0.991', pctImproved: 97.4, measured: true },
      { label: '스캔 PDF 처리 속도(쪽당)', unit: 's', beforeVal: 15.0, afterVal: 0.87, beforeLabel: '15.0 s/쪽 (docling)', afterLabel: '0.87 s/쪽 (indra)', deltaLabel: '17배 고속', pctImproved: 94.2, measured: true },
      { label: '한글 서류 인식 재현율', unit: '%', beforeVal: 69.7, afterVal: 97.9, beforeLabel: '69.7% (markitdown)', afterLabel: '97.9% (indra)', deltaLabel: '+28.2%p 정확도', pctImproved: 28.2, measured: true },
    ],
  },
  {
    id: 'gabriel-import-profit-agi',
    match: ['gabriel', '가브리엘', 'gabriel-agi', 'import-profit', '원가', '이익', 'awb', 'lista', 'fob'],
    title: '가브리엘(Gabriel) 수입·원가·이익 추론 AGI 시뮬레이터',
    subtitle: 'N1 카톡 수입방/인보이스 -> N4 Orbit & 가브리엘 원가·이익 AGI -> N5 /import/gabriel-agi · /import/pipeline -> N6 도착원가 조기확정 & 매출총이익 방어',
    activeNodes: ['N1', 'N4', 'N5', 'N6'],
    primaryNode: 'N4',
    links: [
      { label: '가브리엘 원가·이익 AGI 열기', href: '/import/gabriel-agi', adminOnly: false },
      { label: '수입 원스톱 파이프라인 열기', href: '/import/pipeline', adminOnly: false },
    ],
    nodeOverrides: {
      N1: {
        before: '카톡 수입방 인보이스·운임 메모·클레임(lista)이 대화 흐름에 섞여 차수 정산 후 누락 발견',
        after: 'N1 카톡 수입방/인보이스 수신 즉시 농장·AWB·차수·클레임 텍스트를 구조화 이벤트로 적재',
        artifact: 'N1 카톡 수입방/인보이스 수신',
      },
      N4: {
        before: 'AWB 중량구간 단차·박스입수량·농장 FOB 환율 차익·마진 침식을 경험과 수기 엑셀로 사후 역산',
        after: 'N4 Orbit & 가브리엘 원가·이익 AGI 추론: AWB 중량구간·박스입수량·농장FOB환율 차익·마진침식·불량크레딧 역산',
        artifact: 'N4 Orbit & 가브리엘 원가·이익 AGI',
      },
      N5: {
        before: '도착원가 계산과 이익 시뮬레이션 화면이 분절되어 발주·분배 시점 단가 방어 연동 미흡',
        after: 'N5 네노바웹 /import/pipeline · /import/gabriel-agi 에서 농장별 손익분기·단가 경보 즉시 표시',
        artifact: '/import/pipeline · /import/gabriel-agi',
      },
      N6: {
        before: '관세·물류 실비 확정 지연으로 매출총이익 훼손 품목을 출고 완료 후에야 사후 확인',
        after: 'N6 원장 도착원가 조기확정 & 매출총이익 방어 (ApprovedBy 승인 후 원장 안전 반영)',
        artifact: 'N6 원장 도착원가 조기확정 & 이익방어',
      },
    },
    steps: [
      {
        stepNo: 1,
        nodeId: 'N1',
        artifact: 'N1 카톡 수입방/인보이스 수신',
        packetSummary: '농장 인보이스·AWB 중량·박스수·불량 클레임(lista) 문구를 차수(OrderYear+OrderWeek) 기준으로 수신·정규화',
        beforeNote: '정산 마감 전까지 농장 FOB 환율 변동과 클레임 크레딧 대상이 흩어져 있음',
        afterNote: '수신 즉시 AWB·농장별칭·품종 단가 기준선을 자동 추출해 추론 큐로 전달',
        latencyMs: 24,
        throughput: '차수 즉시 식별',
        measured: false,
      },
      {
        stepNo: 2,
        nodeId: 'N4',
        artifact: 'N4 Orbit & 가브리엘 원가·이익 AGI 추론',
        packetSummary: 'AWB 중량구간 · 박스입수량 · 농장FOB환율 차익 · 마진침식 · 불량크레딧 역산 및 반사실 단가 브레이크포인트 산출',
        beforeNote: '수기 엑셀 역산 시 일부 농장 운임구간 손실과 크레딧 미청구가 누락됨',
        afterNote: '전 농장·전 품종 원가구조 병목과 이익 증대 레버를 입고 전 자동 역산',
        latencyMs: 185,
        throughput: '전 농장 반사실 시뮬',
        measured: false,
      },
      {
        stepNo: 3,
        nodeId: 'N5',
        artifact: 'N5 네노바웹 /import/pipeline · /import/gabriel-agi',
        packetSummary: '/import/gabriel-agi 및 /import/pipeline 화면에 원가 누수 경보·대안 단가·클레임 환수 초안 게시',
        beforeNote: '수입부 담당자가 별도 계산기·매출이익표·카톡방을 오가며 수작업 대조',
        afterNote: '단일 콘솔에서 마진 역전 품목·AWB 중량구간 최적화안 원클릭 검토',
        latencyMs: 38,
        throughput: '/import/gabriel-agi',
        measured: false,
      },
      {
        stepNo: 4,
        nodeId: 'N6',
        artifact: 'N6 원장 도착원가 조기확정 & 매출총이익 방어',
        packetSummary: '승인 완료 건만 도착원가 기준선 및 매출총이익 방어 경보에 반영(무승인 MSSQL 쓰기 차단)',
        beforeNote: '도착원가 확정 지연으로 역마진 분배·판매가 출고 후 발견됨',
        afterNote: '출고·분배 전 도착원가 조기확정으로 매출총이익 사전 방어 완료',
        latencyMs: 62,
        throughput: '매출총이익 방어',
        measured: false,
      },
    ],
    metrics: [
      { label: '차수별 원가 누수·마진 역전 사전 포착률', unit: '%', beforeVal: 38.0, afterVal: 96.5, beforeLabel: '38.0% (정산 후 확인)', afterLabel: '96.5% (입고 전 포착)', deltaLabel: '+58.5%p 향상', pctImproved: 60.6, measured: false },
      { label: '인보이스 -> 도착원가 확정 리드타임', unit: 'h', beforeVal: 18.0, afterVal: 0.4, beforeLabel: '18.0 h (수기 역산)', afterLabel: '0.4 h (24분 조기확정)', deltaLabel: '-97.8% 단축', pctImproved: 97.8, measured: false },
      { label: '농장 단가·운임 반사실 시뮬 커버리지', unit: '%', beforeVal: 22.0, afterVal: 100.0, beforeLabel: '22.0% (주요 품목만)', afterLabel: '100.0% (전 차수·전 농장)', deltaLabel: '전량 임계점 계산', pctImproved: 78.0, measured: false },
    ],
  },
]);

// 시안 A·B·C·동시비교 공용 시나리오 프리셋 칩
export const SIM_PRESETS = Object.freeze([
  {
    id: 'gabriel-import-profit-agi',
    scenarioId: 'gabriel-import-profit-agi',
    label: '가브리엘 원가·이익 AGI',
    badge: '수입 AGI',
    matchTerms: ['gabriel', '가브리엘', 'gabriel-agi', 'import-profit', 'lista'],
    fallbackItem: {
      id: 'gabriel-import-profit-agi',
      name: '네노바 · 가브리엘 원가·이익 AGI',
      displayName: '가브리엘 수입·원가·이익 추론 AGI',
      quadrant: 'Q1',
      ring: 'trial',
      score10: 9.5,
      stars: 0,
      language: 'Next.js · Python',
      systems: ['네노바웹', 'Orbit', 'AI 자동화'],
      summary: 'AWB 중량구간·박스입수량·농장 FOB 환율 차익·마진 침식·불량 크레딧 역산 기반 수입 원가·이익 추론 AGI',
      why: '수입부 업무 효율 극대화 및 원가구조 누수 사전 포착으로 매출총이익 방어',
      use: '/import/gabriel-agi · /import/pipeline · /import/tools',
    },
  },
  {
    id: 'devicehub-phone-harness',
    scenarioId: 'devicehub-phone-harness',
    label: 'nenovakakao PR #50 + Phone Harness',
    badge: '수집·브릿지',
    matchTerms: ['devicehub', 'playwright', 'chrome-devtools', 'phone'],
    fallbackItem: {
      id: 'devicehub-phone-harness',
      name: 'vkcom/DeviceHub · Phone Harness',
      displayName: 'nenovakakao PR #50 + Phone Harness',
      quadrant: 'Q3',
      ring: 'trial',
      score10: 8.5,
      stars: 0,
      language: 'Python · ADB',
      systems: ['MOYI', '네노바웹'],
      summary: '위챗·야간·12장 초과 사진 보조수집 + Chrome Native Bridge + PR 50 자동배포',
      why: 'deferred_photos 사각지대 보완 및 MOYI Dual-Path dedup_key 병합',
      use: '/my-work?tab=devices · /import/pipeline',
    },
  },
  {
    id: 'rust-sidecar-core',
    scenarioId: 'rust-sidecar-core',
    label: 'Rust 사이드카·로그압축',
    badge: '402.5KB',
    matchTerms: ['xerj-org/xerj', 'xerj', 'rust', 'hermes-core', 'device-sidecar'],
    fallbackItem: {
      id: 'rust-sidecar-core',
      name: 'nenova-device-sidecar.exe · hermes-core.exe',
      displayName: 'Rust 단일 정적 바이너리 사이드카·압축 코어',
      quadrant: 'Q2',
      ring: 'trial',
      score10: 8.5,
      stars: 0,
      language: 'Rust',
      systems: ['Orbit', 'AI 자동화'],
      summary: '402.5KB 정적 사이드카 · 0.007ms 킬스위치 판정 · 4.35x 스풀 압축 · xerj 1.1ms 검색',
      why: 'Node/Python 런타임 번들(80MB+) 대신 유휴 RAM 15MB 이하 정적 바이너리 적용',
      use: 'desktop v1.3.54 외부 사이드카 · Orbit 로그 코어',
    },
  },
  {
    id: 'hermes-agent',
    scenarioId: 'hermes-agent',
    label: 'Hermes 폴백·97스킬',
    badge: '91.3% 압축',
    matchTerms: ['nousresearch/hermes-agent', 'hermes-agent', 'hermes'],
    fallbackItem: {
      id: 'hermes-agent',
      name: 'NousResearch/hermes-agent',
      displayName: 'Hermes 에이전트 · 97 SKILL.md · 쿼터 폴백',
      quadrant: 'Q1',
      ring: 'adopt',
      score10: 9,
      stars: 0,
      language: 'Python · Node',
      systems: ['Orbit', 'AI 자동화'],
      summary: '97/97 SKILL.md(73ms) · 27.5MB->2.4MB(-91.3%) 압축 · Claude↔Codex 무중단 폴백',
      why: 'moyi_inbound -> mindmap_sink -> hermes-manager.js 무중단 파이프라인 실측 완료',
      use: 'Orbit 에이전트 코어 · sales-paste 컨텍스트 공급',
    },
  },
  {
    id: 'echarts-ui-vis',
    scenarioId: 'echarts-ui-vis',
    label: 'ECharts/Visx 시각화',
    badge: '15.9ms SSR',
    matchTerms: ['apache/echarts', 'echarts', 'visx', 'tanstack', 'flint-chart'],
    fallbackItem: {
      id: 'echarts-ui-vis',
      name: 'apache/echarts',
      displayName: 'Apache ECharts · Visx 고밀도 시각화',
      quadrant: 'Q4',
      ring: 'trial',
      score10: 8,
      stars: 0,
      language: 'TypeScript',
      systems: ['네노바웹'],
      summary: '2,289행 100% 합계 일치(231,060건) · 15.9ms SSR SVG · 필요 모듈 200KB gzip',
      why: 'Anti-AI Slop 기준 준수 고밀도 차트·원장 테이블 시각화 실측 완료',
      use: '/sales/profit-report · /stats/*',
    },
  },
  {
    id: 'ocr-doc-pipeline',
    scenarioId: 'ocr-doc-pipeline',
    label: 'RapidOCR 수입원스톱',
    badge: '0.87s/쪽',
    matchTerms: ['datalab-to/indra', 'indra', 'rapidocr', 'docling', 'markitdown', 'marker', 'mineru'],
    fallbackItem: {
      id: 'ocr-doc-pipeline',
      name: 'RapidOCR · datalab-to/indra',
      displayName: 'RapidOCR · 로컬 PDF OCR 수입원스톱',
      quadrant: 'Q4',
      ring: 'trial',
      score10: 8,
      stars: 0,
      language: 'Python · ONNX',
      systems: ['네노바웹', 'Orbit'],
      summary: '외부전송 0 로컬 OCR · 한글 97.9% · 숫자 97.4% · 저해상도 팩스 차단 & 산술 교차검증',
      why: '스캔 인보이스·패킹리스트 초안 채움 및 원본 대조 산술 검증',
      use: '/import/pipeline · /import/tools',
    },
  },
]);

function hash32(text) {
  let h = 2166136261;
  const s = String(text || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitRand(seedStr, salt = 0) {
  const h = hash32(`${seedStr}#${salt}`);
  return (h % 100000) / 100000;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function classifyQuadrant(item) {
  const lang = normKey(item.language);
  const sys = (item.systems || []).map(normKey).join(' ');
  const text = normKey([item.name, item.title, item.area, item.summary, item.desc, (item.topics || []).join(' '), item.source].join(' '));

  if (
    lang === 'rust' ||
    /\b(rust|hermes-core|device-sidecar|sidecar|xerj|bm25|binary|memory-mcp|tokio)\b/.test(text)
  ) {
    return 'Q2';
  }
  if (
    sys.includes('moyi') ||
    /\b(devicehub|phone harness|kakao|카톡|wechat|위챗|adb|scrcpy|playwright|chrome-devtools|browser|bridge|moyi)\b/.test(text)
  ) {
    return 'Q3';
  }
  if (
    sys.includes('네노바웹') ||
    /\b(echarts|visx|tanstack|chart|table|ocr|indra|docling|markitdown|mineru|marker|pdf|html|ui|flint|perspective)\b/.test(text)
  ) {
    return 'Q4';
  }
  return 'Q1';
}

export function inferRing(item) {
  if (item.ring && RADAR_RINGS.some((r) => r.id === item.ring)) return item.ring;
  const verdict = normKey(item.verdict);
  const action = normKey(item.action);
  const pilotVerdict = normKey(item.pilotResult?.verdict);

  if (item.inUse || verdict.includes('적용완료') || verdict.includes('채택완료')) return 'adopt';
  if (action === 'ignore' || verdict.includes('보류') || pilotVerdict.includes('보류')) return 'hold';
  if (item.pilotResult || action === '바로 시험' || action === 'trial' || item.status === 'trial') return 'trial';
  if (action === '참고') return 'hold';
  return 'assess';
}

function computeScoreValue(item) {
  if (Number.isFinite(Number(item.score))) return clamp(Number(item.score), 1, 10);
  if (Number.isFinite(Number(item.fitScore))) return clamp(Number(item.fitScore), 1, 10);
  if (Number.isFinite(Number(item.pilotResult?.score))) return clamp(Number(item.pilotResult.score), 1, 10);
  if (Number.isFinite(Number(item.fit))) return clamp(Number(item.fit) * 2, 1, 10);
  return 6;
}

function isApprovalPending(item) {
  if (item.inUse) return false;
  const verdict = normKey(item.verdict);
  if (verdict.includes('적용완료') || verdict.includes('채택완료') || verdict.includes('보류')) return false;
  if (item.ring === 'adopt') return false;
  if (item.pilotResult && computeScoreValue(item) >= 6) return true;
  if (item.ring === 'trial' && (item.action === '바로 시험' || item.fit >= 4)) return true;
  return false;
}

// adoption-ledger + tech-radar 데이터를 UI·시뮬레이터 공용 스키마로 정규화
export function normalizeRadarCatalog({ ledger = null, techRadar = null, adminMode = false } = {}) {
  const map = new Map();

  const upsert = (rawKey, patch) => {
    const key = normKey(rawKey);
    if (!key) return;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { key, ...patch });
      return;
    }
    map.set(key, {
      ...prev,
      ...patch,
      systems: Array.from(new Set([...(prev.systems || []), ...(patch.systems || [])])),
      topics: Array.from(new Set([...(prev.topics || []), ...(patch.topics || [])])),
      terms: patch.terms?.length ? patch.terms : prev.terms || [],
      pilotResult: patch.pilotResult || prev.pilotResult || null,
      ledgerSources: Array.from(new Set([...(prev.ledgerSources || []), ...(patch.ledgerSources || [])])),
    });
  };

  // 1) tech-radar 라운드 병합 (최신 라운드 우선)
  const rounds = Array.isArray(techRadar?.rounds) ? techRadar.rounds : [];
  rounds.forEach((r, roundIdx) => {
    (r.items || []).forEach((x) => {
      if (!x || !x.name) return;
      const existing = map.get(normKey(x.name));
      if (existing && existing.fromTechRadar) return; // 최신 회차 평가 유지
      upsert(x.name, {
        id: x.name,
        name: x.name,
        displayName: x.name,
        url: x.url || '',
        stars: Number(x.stars) || 0,
        starsPerDay: x.starsPerDay ?? null,
        language: x.language || '',
        desc: x.desc || '',
        summary: x.summary || '',
        easy: x.easy || '',
        why: x.why || '',
        analogy: x.analogy || '',
        use: x.use || '',
        terms: Array.isArray(x.terms) ? x.terms : [],
        topics: Array.isArray(x.topics) ? x.topics : [],
        systems: Array.isArray(x.systems) ? x.systems : [],
        difficulty: x.difficulty || '',
        score: Number.isFinite(Number(x.score)) ? Number(x.score) : null,
        action: x.action || '',
        actionLlm: x.actionLlm || '',
        track: x.track || 'interest',
        sourceLabel: x.sourceLabel || '',
        inUse: Boolean(x.inUse),
        resurfaced: x.resurfaced || '',
        pilotResult: x.pilotResult || null,
        roundId: r.id || '',
        isNewRound: roundIdx === 0 && rounds.length > 1,
        fromTechRadar: true,
        ledgerSources: ['tech-radar'],
      });
    });
  });

  // 2) 관리자 모드에서만 adoption-ledger 병합 (직원 화면에 관리자 장부 내부 정보 비노출)
  if (adminMode && ledger && typeof ledger === 'object') {
    const radarObj = ledger.radar && typeof ledger.radar === 'object' ? ledger.radar : {};
    for (const ringDef of RADAR_RINGS) {
      const list = Array.isArray(radarObj[ringDef.id]) ? radarObj[ringDef.id] : [];
      list.forEach((entry, idx) => {
        const title = typeof entry === 'string' ? entry : entry?.title || entry?.name || '';
        if (!title) return;
        upsert(title, {
          id: `ledger-${ringDef.id}-${idx}`,
          name: title,
          displayName: title,
          ring: ringDef.id,
          summary: typeof entry === 'object' ? entry.summary || title : `${ringDef.label} 장부 등록 항목`,
          use: typeof entry === 'object' ? entry.use || '' : `사장님 도입 장부(${ringDef.shortLabel}) 운용 기준 항목`,
          track: 'interest',
          systems: ['AI 자동화'],
          score: ringDef.id === 'adopt' ? 9 : ringDef.id === 'trial' ? 8 : ringDef.id === 'assess' ? 6 : 4,
          inUse: ringDef.id === 'adopt',
          fromLedger: true,
          ledgerSources: ['adoption-ledger:radar'],
        });
      });
    }

    const experiments = Array.isArray(ledger.experiments) ? ledger.experiments : [];
    experiments.forEach((exp) => {
      if (!exp || !exp.name) return;
      upsert(exp.id || exp.name, {
        id: exp.id || exp.name,
        name: exp.name,
        displayName: exp.name,
        url: exp.pr || '',
        ring: exp.status === 'invalidated' ? 'hold' : exp.ring || 'trial',
        summary: `실험 ${exp.id || ''}: ${exp.metric || ''}`.trim(),
        why: exp.note || exp.target || '',
        use: exp.target || '',
        status: exp.status || 'trial',
        track: 'interest',
        systems: ['Orbit', 'AI 자동화'],
        score: exp.status === 'invalidated' ? 5 : 8,
        fromLedger: true,
        ledgerSources: ['adoption-ledger:experiment'],
      });
    });

    const candidates = Array.isArray(ledger.candidates) ? ledger.candidates : [];
    candidates.forEach((cand) => {
      const title = cand?.title || cand?.name;
      if (!title) return;
      const existing = map.get(normKey(title));
      upsert(title, {
        id: existing?.id || title,
        name: existing?.name || title,
        displayName: existing?.displayName || title,
        url: existing?.url || cand.url || '',
        summary: existing?.summary || cand.summary || '',
        why: cand.why || existing?.why || '',
        use: existing?.use || cand.why || '',
        fit: cand.fit,
        fitScore: cand.fitScore,
        problem: cand.problem || '',
        area: cand.area || '',
        verdict: cand.verdict || existing?.verdict || '',
        action: existing?.action || cand.action || '',
        ring: cand.verdict === '적용완료' ? 'adopt' : cand.action === 'ignore' ? 'hold' : existing?.ring,
        inUse: Boolean(existing?.inUse || cand.verdict === '적용완료'),
        score: existing?.score ?? computeScoreValue(cand),
        track: existing?.track || 'interest',
        systems: existing?.systems?.length ? existing.systems : ['AI 자동화'],
        fromLedger: true,
        ledgerSources: ['adoption-ledger:candidate'],
      });
    });
  }

  // 최종 정규화 + 좌표 입력용 파생 속성 계산
  const items = Array.from(map.values()).map((raw, idx) => {
    const ring = inferRing(raw);
    const quadrant = classifyQuadrant(raw);
    const score10 = computeScoreValue(raw);
    const needsApproval = adminMode && isApprovalPending({ ...raw, ring });
    return {
      ...raw,
      idx,
      ring,
      quadrant,
      score10,
      needsApproval,
    };
  });

  // 정렬: 결정대기(파일럿 실측 보유 우선) -> ADOPT -> TRIAL -> ASSESS -> HOLD, 그 안에서는 점수 내림차순
  const ringRank = Object.fromEntries(RADAR_RINGS.map((r) => [r.id, r.order]));
  items.sort((a, b) => {
    if (a.needsApproval !== b.needsApproval) return a.needsApproval ? -1 : 1;
    if (a.needsApproval && b.needsApproval) {
      const ap = Boolean(a.pilotResult);
      const bp = Boolean(b.pilotResult);
      if (ap !== bp) return ap ? -1 : 1;
    }
    const ra = ringRank[a.ring] ?? 9;
    const rb = ringRank[b.ring] ?? 9;
    if (ra !== rb) return ra - rb;
    if (b.score10 !== a.score10) return b.score10 - a.score10;
    return String(a.name).localeCompare(String(b.name), 'ko');
  });

  return items.map((item, i) => ({ ...item, blipNo: i + 1 }));
}

// 4분면 x 4동심원 결정론적 극좌표 계산 + 동일 슬라이스 내 충돌 완화
export function computePolarCoordinates(items, { center = 320, maxRadius = 264 } = {}) {
  const qMap = Object.fromEntries(RADAR_QUADRANTS.map((q) => [q.id, q]));
  const rMap = Object.fromEntries(RADAR_RINGS.map((r) => [r.id, r]));
  const padAngle = 0.12; // 축 선분과 겹침 방지 여백

  const placed = (items || []).map((item) => {
    const q = qMap[item.quadrant] || qMap.Q1;
    const r = rMap[item.ring] || rMap.assess;
    const uA = unitRand(item.name || item.id, 1);
    const uR = unitRand(item.name || item.id, 2);
    const aMin = q.angleStart + padAngle;
    const aMax = q.angleEnd - padAngle;
    const theta = aMin + uA * (aMax - aMin);
    const rNorm = r.rMin + uR * (r.rMax - r.rMin);
    const radius = rNorm * maxRadius;
    return {
      item,
      quadrant: q,
      ring: r,
      theta,
      radius,
      x: center + radius * Math.cos(theta),
      y: center + radius * Math.sin(theta),
    };
  });

  // 동일 (quadrant, ring) 슬라이스 내 결정론적 반발 보정 (축·링 경계 밖으로 나가지 않음)
  const minSep = 20;
  for (let pass = 0; pass < 16; pass += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        if (a.quadrant.id !== b.quadrant.id || a.ring.id !== b.ring.id) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= minSep) continue;
        const push = (minSep - Math.max(0.5, dist)) * 0.45;
        const ux = dist > 0.1 ? dx / dist : Math.cos(a.theta + 0.5);
        const uy = dist > 0.1 ? dy / dist : Math.sin(a.theta + 0.5);
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;

        for (const p of [a, b]) {
          const rx = p.x - center;
          const ry = p.y - center;
          let ang = Math.atan2(ry, rx);
          // Q2/Q3 경계(±PI) 넘김 보정 후 각도 클램프
          if (p.quadrant.id === 'Q2' && ang > 0) ang -= Math.PI * 2;
          if (p.quadrant.id === 'Q3' && ang < 0) ang += Math.PI * 2;
          const aMin = p.quadrant.angleStart + padAngle;
          const aMax = p.quadrant.angleEnd - padAngle;
          ang = clamp(ang, aMin, aMax);
          const rad = clamp(Math.hypot(rx, ry), p.ring.rMin * maxRadius, p.ring.rMax * maxRadius);
          p.theta = ang;
          p.radius = rad;
          p.x = center + rad * Math.cos(ang);
          p.y = center + rad * Math.sin(ang);
        }
      }
    }
  }

  return placed.map((p) => ({
    id: p.item.id,
    name: p.item.name,
    blipNo: p.item.blipNo,
    quadrant: p.quadrant.id,
    ring: p.ring.id,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    radius: Math.round(p.radius * 10) / 10,
    theta: Math.round(p.theta * 1000) / 1000,
    item: p.item,
  }));
}

// 2x2 임팩트 x 준비도 매트릭스 좌표 계산 (X: 0~100 준비도·원장안전성, Y: 0~100 속도·시간단축 임팩트)
export function computeMatrixCoordinates(items) {
  return (items || []).map((item) => {
    const ringBaseX = { adopt: 84, trial: 66, assess: 42, hold: 22 }[item.ring] ?? 45;
    const pilotBonus = item.pilotResult ? 12 : 0;
    const inUseBonus = item.inUse ? 8 : 0;
    const diffPenalty = item.difficulty === '어려움' ? -10 : item.difficulty === '쉬움' ? 6 : 0;
    const jitterX = (unitRand(item.name || item.id, 3) - 0.5) * 10;
    const readiness = Math.round(clamp(ringBaseX + pilotBonus + inUseBonus + diffPenalty + jitterX, 6, 96));

    const scoreBaseY = (item.score10 || 6) * 9.2;
    const pilotScoreBonus = Number.isFinite(Number(item.pilotResult?.score)) ? (Number(item.pilotResult.score) - 5) * 3.5 : 0;
    const actionBonus = item.action === '바로 시험' ? 8 : item.action === '참고' ? -10 : 0;
    const jitterY = (unitRand(item.name || item.id, 4) - 0.5) * 8;
    const impact = Math.round(clamp(scoreBaseY + pilotScoreBonus + actionBonus + jitterY, 8, 96));

    const zone =
      readiness >= 50 && impact >= 50
        ? MATRIX_ZONES[0]
        : readiness < 50 && impact >= 50
          ? MATRIX_ZONES[1]
          : readiness >= 50 && impact < 50
            ? MATRIX_ZONES[2]
            : MATRIX_ZONES[3];

    return {
      id: item.id,
      name: item.name,
      blipNo: item.blipNo,
      readiness,
      impact,
      zoneId: zone.id,
      zoneLabel: zone.label,
      ring: item.ring,
      quadrant: item.quadrant,
      item,
    };
  });
}

export function classifyPipelineStage(item) {
  if (!item) return 'scanned';
  if (item.ring === 'adopt' || item.inUse) return 'adopted';
  if (item.needsApproval || (item.ring === 'trial' && item.pilotResult)) return 'canary';
  if (item.ring === 'trial' || item.pilotResult) return 'pilot';
  return 'scanned';
}

function findMatchingScenario(item, scenarioIdOverride = '') {
  if (scenarioIdOverride) {
    const forced = SIM_SCENARIOS.find((s) => s.id === scenarioIdOverride);
    if (forced) return { scenario: forced, matchType: 'exact-scenario' };
  }
  const haystack = normKey([item?.name, item?.title, item?.id, item?.summary, (item?.systems || []).join(' ')].join(' '));
  for (const sc of SIM_SCENARIOS) {
    if (sc.match.some((m) => haystack.includes(m))) return { scenario: sc, matchType: 'exact-scenario' };
  }
  const byQuadrant = {
    Q1: SIM_SCENARIOS.find((s) => s.id === 'hermes-agent') || SIM_SCENARIOS[0],
    Q2: SIM_SCENARIOS.find((s) => s.id === 'rust-sidecar-core') || SIM_SCENARIOS[1],
    Q3: SIM_SCENARIOS.find((s) => s.id === 'devicehub-phone-harness') || SIM_SCENARIOS[2],
    Q4: SIM_SCENARIOS.find((s) => s.id === 'echarts-ui-vis') || SIM_SCENARIOS[3],
  };
  return { scenario: byQuadrant[item?.quadrant] || SIM_SCENARIOS[0], matchType: 'quadrant-mapped' };
}

export function resolvePresetTarget(presetId, items = []) {
  const preset = SIM_PRESETS.find((p) => p.id === presetId) || null;
  if (!preset) return { preset: null, item: null, scenarioId: '' };
  const matched = (items || []).find((x) => {
    const hay = normKey([x.name, x.id, x.summary, x.why].join(' '));
    return preset.matchTerms.some((term) => hay.includes(term));
  });
  return {
    preset,
    item: matched || preset.fallbackItem,
    scenarioId: preset.scenarioId,
    isCatalogItem: Boolean(matched),
  };
}

// 선택 기술 기준 nenovakakao 실설계 6노드 도입 전/후 시뮬레이션 모델 생성
export function simulateRadarItem(item, options = {}) {
  const safeItem = item || { id: 'default', name: 'NousResearch/hermes-agent', quadrant: 'Q1', ring: 'trial', score10: 9 };
  const { scenario, matchType } = findMatchingScenario(safeItem, options?.scenarioId || '');
  const activeSet = new Set(scenario.activeNodes);

  const steps = scenario.steps.map((st) => {
    const node = ARCH_SURFACE_NODES.find((n) => n.id === st.nodeId) || ARCH_SURFACE_NODES[0];
    return {
      ...st,
      nodeName: node.name,
      latencyMs: st.latencyMs ?? 25,
      throughput: st.throughput || '표준 직렬',
      measured: Boolean(st.measured),
    };
  });

  const nodeDetails = ARCH_SURFACE_NODES.map((node) => {
    const ov = scenario.nodeOverrides?.[node.id] || null;
    const active = activeSet.has(node.id);
    const stepForNode = steps.find((st) => st.nodeId === node.id) || null;
    return {
      id: node.id,
      code: node.code,
      name: node.name,
      shortName: node.shortName,
      surface: node.surface,
      modules: node.modules,
      active,
      isPrimary: scenario.primaryNode === node.id,
      artifact: ov?.artifact || node.modules[0],
      roleBefore: ov?.before || '기존 표준 직렬/원장 경로 그대로 유지 (무변경)',
      roleAfter: ov?.after || node.contract,
      statusLabel: scenario.primaryNode === node.id ? '핵심 도입점' : active ? '연계 노선' : '무변경 보존',
      latencyLabel: stepForNode ? `${stepForNode.latencyMs}ms` : active ? '연계' : '보존',
      throughputLabel: stepForNode?.throughput || (active ? '가동' : '기존 유지'),
    };
  });

  return {
    itemName: safeItem.name || safeItem.title || scenario.title,
    scenarioId: scenario.id,
    scenarioTitle: matchType === 'exact-scenario' ? scenario.title : `${safeItem.name} -> ${scenario.title}`,
    subtitle: scenario.subtitle,
    matchType,
    primaryNode: scenario.primaryNode,
    activeNodes: scenario.activeNodes,
    pipelineStage: classifyPipelineStage(safeItem),
    links: Array.isArray(scenario.links) ? scenario.links : [],
    nodeDetails,
    steps,
    metrics: scenario.metrics,
    safetyChecks: BASELINE_SAFETY_CHECKS,
    pilotSummary: safeItem.pilotResult?.summary || safeItem.why || safeItem.use || '',
    pilotScore: safeItem.pilotResult?.score ?? safeItem.score10 ?? null,
    pilotReportPath: safeItem.pilotResult?.reportPath || '',
  };
}

export function buildWorkbenchSummary(items = [], isAdmin = false) {
  const counts = { adopt: 0, trial: 0, assess: 0, hold: 0, approval: 0, total: items.length };
  const stageCounts = { scanned: 0, pilot: 0, canary: 0, adopted: 0 };
  let pilotMeasuredCount = 0;
  let scoreSum = 0;

  for (const x of items) {
    if (counts[x.ring] !== undefined) counts[x.ring] += 1;
    if (x.needsApproval) counts.approval += 1;
    const st = classifyPipelineStage(x);
    if (stageCounts[st] !== undefined) stageCounts[st] += 1;
    if (x.pilotResult) pilotMeasuredCount += 1;
    scoreSum += Number(x.score10) || 0;
  }

  const total = Math.max(1, items.length);
  const pilotMeasuredPct = items.length ? Math.round((pilotMeasuredCount / total) * 100) : 0;
  const avgScore = items.length ? Math.round((scoreSum / total) * 10) / 10 : 0;
  const approvalQueue = isAdmin ? items.filter((x) => x.needsApproval).slice(0, 8) : [];

  return {
    counts,
    stageCounts,
    pilotMeasuredCount,
    pilotMeasuredPct,
    avgScore,
    approvalQueue,
  };
}
