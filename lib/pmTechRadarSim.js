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

// 부서별 관점 필터 및 실행 화면 매핑 (전사 · 4대 실무 부서)
export const RADAR_DEPARTMENTS = Object.freeze([
  { id: 'all', label: '전사 전체', shortLabel: '전사 전체', route: '/pm/radar', routeLabel: '전사 기술 레이더' },
  { id: 'import', label: '수입부', shortLabel: '수입부', route: '/import/cost-agi', routeLabel: '수입 원가·이익 AGI' },
  { id: 'sales', label: '영업부', shortLabel: '영업부', route: '/orders/sales-paste', routeLabel: '카톡 주문·판매입력' },
  { id: 'warehouse', label: '출고·창고팀', shortLabel: '출고·창고', route: '/warehouse', routeLabel: '창고 입고·검품' },
  { id: 'finance', label: '경영지원·정산부', shortLabel: '경영지원·정산', route: '/sales/profit-report', routeLabel: '주간 매출이익 분석' },
]);

// A·B·C 동시모드 연속 구현 파이프라인 4단계 상태
export const BUILD_PIPELINE_STAGES = Object.freeze([
  { id: 'LIVE', code: 'LIVE', label: '실전가동', shortLabel: 'LIVE 실전가동', order: 0, desc: '운영 화면 연결 · 실사용 가동 중' },
  { id: 'PILOT', code: 'PILOT', label: '파일럿검증', shortLabel: 'PILOT 파일럿검증', order: 1, desc: '실데이터 격리 벤치마크 · 수치 검증 중' },
  { id: 'READY', code: 'READY', label: '즉시구현가능', shortLabel: 'READY 즉시구현', order: 2, desc: '원천 데이터·판정식 확정 · 바로 구현 착수' },
  { id: 'DISCOVERED', code: 'DISCOVERED', label: '신규발굴', shortLabel: 'DISCOVERED 신규발굴', order: 3, desc: '추가 발굴 고수익 · 고효율 확장 후보' },
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
    primaryDepartments: ['sales', 'import'],
    executiveBrief: {
      situation: '영업방·추가취소방 카톡 대화와 27.5MB까지 불어나는 에이전트 작업 로그가 로컬 파일에 섞여 있어, 장애·한도 도달 시 직전 주문 맥락이 끊기고 담당자가 대화를 다시 뒤져야 했습니다.',
      outcome: '카톡 원문 해시 적재(50건/배치) + 로그 91.3% 압축(2.4MB) + 97건 업무 절차 스킬(73ms) 동기화 + Claude↔Codex 무중단 전환으로 한도 상황에서도 주문·분배 맥락을 100% 보존합니다.',
    },
    dataOrigins: {
      emailDoc: '수입 인보이스 첨부 텍스트 · 에이전트 세션 궤적(session_rescue.jsonl)',
      staffInput: '영업방·추가취소방 카톡 원문 · playbooks 97건 사내 업무 절차서',
      partnerData: '거래처별 주문·취소·증감 메시지 패턴 · 농장 별칭 사전',
      thresholdRule: '동일 문구 1분 ordinal SHA-256(dedup_key) · Head+Tail 압축(-91.3%) · 승인 리비전 일치 검증',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '연계', beforeTask: '카톡 수입방 인보이스·운임 메모가 대화에 묻혀 재확인 반복', afterTask: '증분 이벤트 아카이브로 선적·운임 지시가 절차 스킬과 함께 즉시 요약됨', roleChange: '수입방 인보이스·운임 메모를 절차 스킬로 즉시 요약해 재확인 제거', dataBasis: '수입방 원문 + 97 SKILL.md', route: '/import/pipeline', routeLabel: '수입 원스톱 파이프라인' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '핵심', beforeTask: '30분 주기 백그라운드 대기 시 sales-paste 인박스와 잦은 시차 발생', afterTask: '영업방 사이클 직후 50건 배치 즉시 동기화로 추가·취소 누락 차단', roleChange: '카톡 주문·추가취소 원문이 50건 단위로 sales-paste 인박스에 즉시 연결', dataBasis: '영업방·추가취소방 카톡 원문', route: '/orders/sales-paste', routeLabel: '카톡 주문·판매입력' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '연계', beforeTask: '당일 급증·취소 변동 사유를 영업 카톡에서 별도 문의', afterTask: '승인 완료 변동건만 분배·빠른흡수 보조 맥락으로 선전달', roleChange: '당일 출고 변동·취소 메모가 누락 없이 분배 보조 맥락으로 전달', dataBasis: '승인된 주문 변동 이벤트', route: '/shipment/quick-absorb', routeLabel: '빠른 분배 흡수' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '연계', beforeTask: '모델 한도 중단 시 사후 작업 이력 검증 근거가 흩어짐', afterTask: 'ApprovedBy 승인 건만 반영하고 감사 이력을 91.3% 압축 보관', roleChange: 'ApprovedBy 승인 건만 반영되고 무단 원장 쓰기 0건으로 이력 보관', dataBasis: 'session_rescue · 승인 감사 로그', route: '/mgmt/audit-view', routeLabel: '관리자 감사 뷰' },
    ],
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
    primaryDepartments: ['warehouse', 'finance'],
    executiveBrief: {
      situation: '직원·현장 PC에 80MB+ Node/Python 런타임을 설치하거나 수십 MB 로그를 검색할 때 270ms~초 단위의 멈춤과 메모리 급증이 발생해 현장 단말 안전판정이 느려졌습니다.',
      outcome: '402.5KB 단일 Rust 바이너리로 위험 문구 차단 0.007ms, 로그 검색 1.1ms(250배 가속), 스풀 압축 4.35배 가속을 달성하고, 미설치 PC는 순수 JS/Python Fallback으로 무중단 동작합니다.',
    },
    dataOrigins: {
      emailDoc: '현장 로그(events.jsonl · vision-spool.log) · 데스크톱 릴리스 매니페스트',
      staffInput: 'ADB 현장 단말 화면 텍스트 · 원격 진단 질의 키워드',
      partnerData: '위챗/메신저 내 송금·이체·삭제 등 고위험 문자열 패턴',
      thresholdRule: '송금/이체/삭제 키워드 0.007ms 즉시 킬스위치 · 유휴 RAM 15MB 상한 · ASAR 외부 격리',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '연계', beforeTask: '위챗 농장 대화 다량 이미지 중복 제거 시 PC 부하 발생', afterTask: 'Rust pHash·압축 코어(4.35x)로 농장 이미지 정리 지연 해소', roleChange: '야간·위챗 농장 다량 이미지 중복 제거 속도 4.35배 가속', dataBasis: '위챗 현장 이미지 pHash', route: '/my-work?tab=devices', routeLabel: '디바이스 허브 관제' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '참조', beforeTask: '사내 배포 패키지에 대형 런타임 동반 시 업데이트 지연 우려', afterTask: 'app.asar 외부 선택형 사이드카 분리로 일반 PC 배포 크기 영향 0', roleChange: '일반 사무직 데스크톱 앱 배포 용량·부팅 속도 영향 0 유지', dataBasis: 'desktop ASAR 무결성 Fuses', route: '/orders/sales-paste', routeLabel: '카톡 주문·판매입력' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '핵심', beforeTask: '현장 단말 조작 중 민감 화면·삭제 버튼 오터치 위험 상존', afterTask: '0.007ms 킬스위치 & FLAG_SECURE 즉시 반납으로 현장 안전선 고정', roleChange: '현장 단말 보조수집 중 보안화면(FLAG_SECURE)·위험 조작 0.007ms 차단', dataBasis: 'ADB 화면 텍스트 스트림', route: '/my-work?tab=devices', routeLabel: '디바이스 허브 관제' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '핵심', beforeTask: '송금·이체 관련 화면 진입 차단 여부의 실행 속도 확인 어려움', afterTask: '정적 바이너리가 송금·이체 키워드를 1ms 미만 고정 차단 후 보고', roleChange: '송금·이체·삭제 화면 진입 원천 차단으로 금융 안전선 확보', dataBasis: '위험 키워드 정책 사전', route: '/mgmt/approvals', routeLabel: '관리자 결재함' },
    ],
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
    primaryDepartments: ['import', 'sales'],
    executiveBrief: {
      situation: '기존 PC 카톡 수집기는 18시 이후·12장 초과 사진 보류 및 위챗 미지원 사각지대가 있어, 현장 파손 사진과 야간 농장 연락 약 32%를 담당자가 폰으로 직접 캡처해 전달해야 했습니다.',
      outcome: '공용 Android 단말 Read-Only 보조수집 + MOYI Dual-Path 중복 제거 + Playwright 화면 자동 점검(46ms/시트)으로 야간·위챗 포함 수신율을 99%까지 끌어올립니다.',
    },
    dataOrigins: {
      emailDoc: '포워더·거래처 클레임 증빙 사진(12장 초과) · UI 화면 회귀 스냅샷',
      staffInput: '현장 담당자 공용폰 위챗/카톡 캡처 · 영업팀 판매입력 확정 클릭',
      partnerData: '해외 농장 위챗 품질·선적 통지 · 국내 거래처 야간 긴급 발주/불량 사진',
      thresholdRule: 'PC 18시/12장 한도 초과분 N2 분기 · dedup_key SHA-256 중복 0건 병합 · SCREENSHOT 재조회',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '핵심', beforeTask: '위챗 농장방 선적 변경·품질 사진이 PC 카톡에 안 잡혀 수동 전달', afterTask: 'Phone Harness가 위챗방 사진·텍스트를 Read-Only로 즉시 수집', roleChange: '위챗 농장방 선적 변경·품질 사진이 누락 없이 MOYI 승인 큐로 수신', dataBasis: '위챗 농장방 + 공용폰 ADB', route: '/my-work?tab=devices', routeLabel: '디바이스 허브 관제' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '핵심', beforeTask: '18시 이후·12장 초과 불량 사진이 누락되어 차감·재입력 지연', afterTask: 'Dual-Path SHA-256 병합으로 중복 없이 불량차감·판매입력에 연결', roleChange: '야간 불량 사진과 12장 초과 클레임 증빙이 지연 없이 원장에 연결', dataBasis: '카톡/위챗 불량 사진 + dedup_key', route: '/sales/defect-deductions', routeLabel: '불량차감 원장' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '연계', beforeTask: '검품 중 대량 촬영한 파손 사진을 차수별로 다시 분류 전송', afterTask: '입고 검수 사진이 12장 초과 한도 없이 차수·품목 증빙으로 적재', roleChange: '검품 중 촬영한 대량 파손 사진을 재전송 없이 차수 증빙으로 즉시 수합', dataBasis: '창고 공용폰 검품 사진', route: '/incoming', routeLabel: '입고 관리' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '연계', beforeTask: '브라우저 세션 만료 시 이중 기표나 입력 실패 사후 확인', afterTask: 'write_unknown 선기록 + SCREENSHOT 영수증 독립 재조회로 무결성 보장', roleChange: 'Chrome Native Host 승인 중계 및 영수증 재조회로 이중 기표 방지', dataBasis: 'SCREENSHOT 영수증 재조회', route: '/sales/farm-quality', routeLabel: '농장 품질·클레임' },
    ],
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
    primaryDepartments: ['sales', 'finance'],
    executiveBrief: {
      situation: '2,289행이 넘는 주간 매출·물량·원가 데이터를 수작업 SVG나 텍스트 표로만 보면 합계 검증이 어렵고, 장식용 미니 차트는 A4 출력과 의사결정을 오히려 방해했습니다.',
      outcome: '2,289행(231,060건) 합계 오차 0 검증을 통과한 경량 차트(200KB gzip, 15.9ms 렌더)와 tabular-nums 1px 원장으로 보고서와 화면의 숫자를 100% 일치시킵니다.',
    },
    dataOrigins: {
      emailDoc: '차수별 매출이익 정산 엑셀(XLSX) · A4 인쇄 PDF 스냅샷',
      staffInput: '주차(OrderYear+OrderWeek) 조회 조건 · 영업/수입 팀별 실적 점검 입력',
      partnerData: '거래처별 출고·매출·반품 수량 및 농장별 입고 물량 집계',
      thresholdRule: '합계 정합성 오차 0건(231,060=231,060) · Anti-AI Slop 1px 헤어라인 · tabular-nums 고정폭',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '연계', beforeTask: '국가별·차수별 입고 물량과 원가 비중 추이를 엑셀 피벗에 의존', afterTask: '누적 막대·히트맵 SSR SVG로 입고 물량·원가 비중 즉시 비교', roleChange: '국가별·차수별 입고 박스 및 원가 비중 추이를 한 화면에서 대조', dataBasis: '국가별 입고 집계 + 도착원가', route: '/incoming/boxes', routeLabel: '차수별 국가 입고 박스' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '핵심', beforeTask: '거래처별 매출 대비 실제 공헌이익과 단가 하락폭을 행별로 찾아 계산', afterTask: '고밀도 원장·차트로 거래처별 마진 분포와 하위 거래처 즉시 식별', roleChange: '거래처별 매출·공헌이익과 단가 변동을 고정폭 수치 테이블로 즉시 비교', dataBasis: '거래처별 매출·클레임·단가', route: '/sales/profit-customer-margin', routeLabel: '거래처별 마진 분석' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '연계', beforeTask: '요일별 입출재잔 및 부족 품종 분포를 긴 표에서 눈으로 탐색', afterTask: '15.9ms 경량 차트와 1px 밀도 표로 체화·부족 품종 즉시 포착', roleChange: '요일·품목별 입출재잔 및 부족 수량 분포를 히트맵·막대로 15ms 내 시각화', dataBasis: '일별 입출고·재고 스냅샷', route: '/stats/volume-board', routeLabel: '물량 현황 보드' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '핵심', beforeTask: '화면 그래프 합계와 정산 엑셀 합계가 달라 매번 수동 검산 필요', afterTask: '2,289행(231,060건) 오차 0건 검증과 A4 인쇄 여백 일치 보장', roleChange: '주간 매출이익 보고서와 엑셀 수치가 오차 0으로 일치해 검산 부담 해소', dataBasis: 'daily-events · 매출이익 원장', route: '/sales/profit-report', routeLabel: '주간 매출이익 보고서' },
    ],
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
    primaryDepartments: ['finance', 'sales'],
    executiveBrief: {
      situation: '하루 76.5MB에 달하는 PC 화면분석 로그(screen.analyzed)를 AI 분석에 그대로 넣으면 토큰 한도가 순식간에 소진되어 정작 중요한 발주·업무 판단이 멈췄습니다.',
      outcome: '반복적인 화면 메타 배열만 96.9% 압축(458K→14K 토큰)하고, 숫자 정확도가 생명인 발주(order.detected)·엑셀 활동 로그는 100% 무압축 우회 가드로 보호합니다.',
    },
    dataOrigins: {
      emailDoc: '일일 Orbit 이벤트 스풀(events/*.jsonl.gz, 76.5MB) · 압축 보존율 실측 로그',
      staffInput: '화면 작업 이벤트(screen.analyzed) · 수기 발주/엑셀 활동 로그',
      partnerData: '거래처 발주 품목·수량 감지 패킷(order.detected)',
      thresholdRule: 'screen.analyzed 96.9% 압축 허용 · order.detected(60%) 및 excel.activity(41.2%) 100% 우회',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '연계', beforeTask: '대용량 작업 로그와 인보이스 대조 컨텍스트가 섞여 한도 소진', afterTask: '화면 메타만 압축해 인보이스·단가 검토 컨텍스트 창 확보', roleChange: '수입 서류·단가 대조 시 핵심 인보이스 컨텍스트가 잘리지 않도록 보호', dataBasis: 'Orbit 이벤트 JSON + 인보이스', route: '/import/tools', routeLabel: '인보이스 도구' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '핵심', beforeTask: '발주 감지 JSON을 일괄 압축할 경우 주문 수량 손실 위험(보존 60%)', afterTask: 'order.detected 우회 가드로 발주 수량·품목 100% 무손실 유지', roleChange: '카톡·엑셀 발주 수량(order.detected) 압축 제외 가드로 1송이도 무손실', dataBasis: 'order.detected 원문 패킷', route: '/orders/sales-paste', routeLabel: '카톡 주문·판매입력' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '연계', beforeTask: '장시간 재고·출고 패턴 요약 시 컨텍스트 용량 제한으로 분할 실행', afterTask: '혼합 JSON 90.9% 절감으로 하루치 작업 흐름을 단일 패스로 요약', roleChange: '작업 흐름 요약 비용을 90.9% 줄여 장시간 재고·출고 패턴 분석 가동', dataBasis: '일일 작업 스풀 로그', route: '/work/manuals', routeLabel: '업무 매뉴얼' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '핵심', beforeTask: '대량 JSON 입력으로 인한 일일 AI 분석 토큰 비용·한도 조기 소진', afterTask: 'screen.analyzed 96.9% 절감(79ms)으로 분석 비용과 중단 위험 동시 감축', roleChange: '일일 AI 분석 토큰 소비 및 한도 소진 리스크를 90% 이상 감축', dataBasis: '일일 토큰 사용량 실측 로그', route: '/my-work?tab=radar', routeLabel: '도입 레이더 관제' },
    ],
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
    primaryDepartments: ['import', 'warehouse'],
    executiveBrief: {
      situation: '해외 농장 인보이스와 포워더 패킹리스트가 이미지·스캔 PDF로 오면 텍스트를 0자도 추출하지 못해 담당자가 수백 행의 품목·수량·금액을 손으로 옮겨 적고 검산해야 했습니다.',
      outcome: '외부 유출 0인 로컬 OCR(쪽당 0.87s, 숫자 97.4%·한글 97.9%)이 초안을 채우고 소계·총액 산술 불일치 행만 강조하며, 저해상도 팩스(100dpi)는 자동 등록을 차단합니다.',
    },
    dataOrigins: {
      emailDoc: '해외 농장 Invoice/Packing PDF · 항공사 AWB 스캔본 · 저해상도 팩스',
      staffInput: '수입부 소계/합계 검산 확인 · 농장별 품목 매칭 선택',
      partnerData: '농장별 인보이스 서식(단가·송이·박스 입수량) · 포워더 중량/운임 명세',
      thresholdRule: '디지털 글자층 우선 -> 스캔본만 로컬 OCR(0.87s/쪽) · 팩스 100dpi(26%) 차단 · 총액=행합 100% 대조',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '핵심', beforeTask: '스캔 PDF 품목·수량·금액 수백 행을 수기 입력하고 행별 검산', afterTask: '로컬 OCR 초안 채움 + 소계/총액 불일치 행만 검토 후 적용', roleChange: '수기 입력·검산 작업을 불일치 하이라이트 검토로 전환해 인보이스 처리 가속', dataBasis: '농장 스캔 Invoice/Packing PDF', route: '/import/tools', routeLabel: '인보이스 도구' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '연계', beforeTask: '입고 확정 서류 정리가 늦어져 영업부 공급단가·물량 배정 대기', afterTask: '선적 직후 패킹 품목·입수량이 확정되어 영업 배정 대기 단축', roleChange: '입고 예정 품목·입수량이 선적 직후 확정되어 영업 배정 대기 시간 단축', dataBasis: '수입원스톱 확정 패킹 행', route: '/import/pipeline', routeLabel: '수입 원스톱 파이프라인' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '핵심', beforeTask: '패킹리스트 박스·입수량과 실제 입고 검수 기준이 엇갈려 재확인', afterTask: '원본 PDF 대조 확정된 박스·단수 기준선이 입고 검수에 사전 동기화', roleChange: '패킹리스트 박스 수와 입고 검수표 기준선 사전 동기화로 현장 오차 감소', dataBasis: 'AWB·패킹리스트 박스 입수', route: '/incoming', routeLabel: '입고 관리' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '연계', beforeTask: '저화질 팩스·수기 오타로 관세·매입 정산 사후 정정 발생', afterTask: '저해상도 팩스(26%) 자동 차단 & 원본 PDF 위치 증빙 보존', roleChange: '원본 PDF 위치와 추출 금액이 나란히 보존되어 통관·회계 증빙 확보', dataBasis: '원본 PDF 페이지 좌표 증빙', route: '/sales/customs-clearance', routeLabel: '관세·통관 대사' },
    ],
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
    id: 'import-cost-profit-agi',
    match: ['cost-agi', '원가·이익 AGI', 'import-profit', '원가', '이익', 'awb', 'lista', 'fob'],
    title: '수입·원가·이익 추론 AGI 시뮬레이터',
    subtitle: 'N1 카톡 수입방/인보이스 -> N4 Orbit & 수입 원가·이익 AGI -> N5 /import/cost-agi · /import/pipeline -> N6 도착원가 조기확정 & 매출총이익 방어',
    activeNodes: ['N1', 'N4', 'N5', 'N6'],
    primaryNode: 'N4',
    primaryDepartments: ['import', 'sales', 'finance'],
    executiveBrief: {
      situation: '농장 FOB 단가 상승, AWB 중량 계단(+300kg/+500kg 직전 미달), 박스 입수 미달, 미청구 불량 크레딧, 환율 급등이 겹쳐도 차수 정산이 끝난 뒤에야 적자 품목을 발견하는 구조였습니다.',
      outcome: '선적·입고 전 단계에서 5대 이익 레버(AWB 혼적·농장 교차소싱·목표마진 단가방어·불량 크레딧 회수·조기 원가확정)를 시뮬레이션해 역마진 품목과 방어 단가를 출고 전에 즉시 제시합니다.',
    },
    dataOrigins: {
      emailDoc: '금요일 Proforma/CI PDF · 포워더 AWB 중량/운임표 · 관세사 통관·면세(E1) 내역',
      staffInput: '수입부 원가시트·환율 가정 · 영업방/추가취소방 발주 수요 · 창고 불량 사진',
      partnerData: '해외 농장 FOB 단가/박스입수량/Credit 승인 · 국내 거래처 공급단가/클레임 이력',
      thresholdRule: '실질원가÷(1-목표마진 23%)=방어단가 · CW>GW AWB 구간 돌파 판정 · 미회수 Credit Note 경보',
    },
    departmentMatrix: [
      { deptId: 'import', deptName: '수입부', impactLevel: '핵심', beforeTask: 'AWB 중량구간 단차와 농장 FOB 인상을 정산 마감 후 엑셀로 사후 역산', afterTask: '선적 전 AWB 계단 잔여 kg 및 농장 교차 소싱 차익을 즉시 시뮬레이션', roleChange: '선적 전 AWB 중량 계단 잔여 kg 및 농장별 FOB 차익 계산으로 발주·혼적 조정', dataBasis: 'Proforma/CI + AWB + 농장 FOB', route: '/import/cost-agi', routeLabel: '수입 원가·이익 AGI' },
      { deptId: 'sales', deptName: '영업부', impactLevel: '핵심', beforeTask: '도착원가 급등을 모른 채 기존 단가로 분배·출고해 역마진 발생', afterTask: '목표 마진 미달 품목의 권장 방어단가를 빠른 분배 화면에 사전 전달', roleChange: '목표 마진 미달 품목의 권장 방어단가를 분배·견적 전에 사전 반영', dataBasis: '예상 도착원가 + 목표 마진율', route: '/shipment/quick-absorb', routeLabel: '빠른 분배 단가 확인' },
      { deptId: 'warehouse', deptName: '출고·창고팀', impactLevel: '연계', beforeTask: '박스당 입수량(Units/Box) 미달·파손을 창고 메모로만 남기고 원가 미연계', afterTask: '입수 부족·검품 불량 수량이 농장 Credit Note 회수 근거로 즉시 연결', roleChange: '박스 채움률 미달 및 검품 불량 수량을 농장 클레임 환수 근거로 즉시 연결', dataBasis: '입고 실입수량 + 불량 검품', route: '/warehouse', routeLabel: '창고 입고·검품' },
      { deptId: 'finance', deptName: '경영지원·정산부', impactLevel: '핵심', beforeTask: '도착원가 확정(18h+) 지연 및 미회수 농장 크레딧 사후 누락', afterTask: '도착원가 0.4h 조기확정 & 미회수 Credit Note 우선순위 원장 관리', roleChange: '도착원가 조기 확정(18h→0.4h)과 미회수 Credit Note 원장 안전 회수', dataBasis: '환율·관세(E1)·클레임 원장', route: '/sales/profit-report', routeLabel: '주간 매출이익 분석' },
    ],
    links: [
      { label: '수입 원가·이익 AGI 열기', href: '/import/cost-agi', adminOnly: false },
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
        after: 'N4 Orbit & 수입 원가·이익 AGI 추론: AWB 중량구간·박스입수량·농장FOB환율 차익·마진침식·불량크레딧 역산',
        artifact: 'N4 Orbit & 수입 원가·이익 AGI',
      },
      N5: {
        before: '도착원가 계산과 이익 시뮬레이션 화면이 분절되어 발주·분배 시점 단가 방어 연동 미흡',
        after: 'N5 네노바웹 /import/pipeline · /import/cost-agi 에서 농장별 손익분기·단가 경보 즉시 표시',
        artifact: '/import/pipeline · /import/cost-agi',
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
        artifact: 'N4 Orbit & 수입 원가·이익 AGI 추론',
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
        artifact: 'N5 네노바웹 /import/pipeline · /import/cost-agi',
        packetSummary: '/import/cost-agi 및 /import/pipeline 화면에 원가 누수 경보·대안 단가·클레임 환수 초안 게시',
        beforeNote: '수입부 담당자가 별도 계산기·매출이익표·카톡방을 오가며 수작업 대조',
        afterNote: '단일 콘솔에서 마진 역전 품목·AWB 중량구간 최적화안 원클릭 검토',
        latencyMs: 38,
        throughput: '/import/cost-agi',
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
    id: 'import-cost-profit-agi',
    scenarioId: 'import-cost-profit-agi',
    label: '수입 원가·이익 AGI',
    badge: '수입 AGI',
    matchTerms: ['cost-agi', '원가·이익 AGI', 'import-profit', 'lista'],
    fallbackItem: {
      id: 'import-cost-profit-agi',
      name: '네노바 · 수입 원가·이익 AGI',
      displayName: '수입 원가·이익 추론 AGI',
      quadrant: 'Q1',
      ring: 'trial',
      score10: 9.5,
      stars: 0,
      language: 'Next.js · Python',
      systems: ['네노바웹', 'Orbit', 'AI 자동화'],
      summary: 'AWB 중량구간·박스입수량·농장 FOB 환율 차익·마진 침식·불량 크레딧 역산 기반 수입 원가·이익 추론 AGI',
      why: '수입부 업무 효율 극대화 및 원가구조 누수 사전 포착으로 매출총이익 방어',
      use: '/import/cost-agi · /import/pipeline · /import/tools',
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

const DEPT_LABEL_MAP = Object.freeze({
  all: '전사 전체',
  import: '수입부',
  sales: '영업부',
  warehouse: '출고·창고팀',
  finance: '경영지원·정산부',
});

export function normalizeDeptFilter(dept) {
  const s = normKey(dept);
  if (!s || s === 'all' || s.includes('전사')) return 'all';
  if (s === 'import' || s.includes('수입')) return 'import';
  if (s === 'sales' || s.includes('영업')) return 'sales';
  if (s === 'warehouse' || s.includes('출고') || s.includes('창고')) return 'warehouse';
  if (s === 'finance' || s.includes('경영') || s.includes('정산')) return 'finance';
  return 'all';
}

function buildAgentBriefText(raw) {
  const deptText = (raw.departmentLabels || []).join(', ');
  const routesText = (raw.targetRoutes || []).join(', ');
  return [
    `[구현 지시서 · ${raw.code}] ${raw.title}`,
    `- 현재 단계: ${raw.status} (${raw.statusLabel}) | 시뮬레이션 기준 시나리오: ${raw.linkedScenarioId}`,
    `- 대상 부서 및 연결 화면: ${deptText} (${routesText})`,
    `- 기대 이익·단축 효과: ${raw.expectedImpact}`,
    `- 원천 데이터 기준(이메일·담당자·거래처): ${raw.dataBasisSummary}`,
    `- 판정 기준식: ${raw.dataOrigins?.thresholdRule || ''}`,
    '- 완료·검증 규칙: origin/master 기반 새 worktree 생성 -> 원장 무쓰기/ApprovedBy 승인 가드 준수 -> 단위/SSR 테스트 + npm run test:pm + next build --webpack 통과 -> WORK_MEMORY.md 5줄 인계 후 PR squash 머지.',
  ].join('\n');
}

const RAW_CONTINUOUS_BUILD_PIPELINE = [
  {
    id: 'build-cost-agi-10-levers-abc',
    code: 'BLD-01',
    title: '원가·이익 10대 레버 워크벤치 & 시안 A·B·C 실시간 시뮬레이터',
    status: 'LIVE',
    statusLabel: '실전가동',
    priorityRank: 1,
    departments: ['import', 'sales', 'warehouse', 'finance'],
    departmentLabels: ['전사', '수입부', '영업부', '출고·창고팀', '경영지원·정산부'],
    expectedImpact: '인보이스->도착원가 확정 18.0h -> 0.4h(-97.8%), 마진 역전 사전 포착률 38.0% -> 96.5%, AWB/FOB/크레딧·환율 스트레스 실시간 시뮬',
    dataBasisSummary: '이메일(Proforma/CI/AWB) + 담당자(수입원가·영업단가·창고검품) + 거래처(농장FOB·국내단가·클레임)',
    dataOrigins: {
      emailDoc: '금요일 Proforma/CI PDF · 포워더 AWB 중량/운임표 · 관세사 통관 내역',
      staffInput: '수입부 원가시트·환율 가정 · 영업부 분배단가 · 창고 불량 검품 입력',
      partnerData: '해외 농장 FOB 단가/박스입수/Credit 승인 · 국내 거래처 공급단가/클레임',
      thresholdRule: '실질원가÷(1-목표마진)=방어단가 · CW>GW 혼적 계단 돌파 · 미회수 Credit 경보',
    },
    situation: '차수별 원가 누수·마진 역전·AWB 운임 계단 미달을 정산 마감 후 사후 엑셀로만 확인해 선제 대응 타이밍을 놓치고 있었습니다.',
    outcome: '전사 4대 부서가 동일한 원가·이익 시뮬레이션 화면(뷰 A/B/C & 동시 비교)을 보며 출고 전 방어 단가와 혼적 조정을 완료합니다.',
    linkedScenarioId: 'import-cost-profit-agi',
    targetRoutes: ['/import/cost-agi', '/pm/radar', '/my-work?tab=radar'],
  },
  {
    id: 'build-hermes-97-skills-bridge',
    code: 'BLD-02',
    title: 'Hermes 97스킬·로그 91.3% 압축 & PR 50 무중단 카톡 브릿지',
    status: 'LIVE',
    statusLabel: '실전가동',
    priorityRank: 2,
    departments: ['import', 'sales', 'warehouse', 'finance'],
    departmentLabels: ['전사', '수입부', '영업부', '출고·창고팀', '경영지원·정산부'],
    expectedImpact: '스풀 로그 27.5MB -> 2.4MB(-91.3%), 97/97 SKILL.md 73ms 동기화, Claude↔Codex 한도 폴백 복구율 100%',
    dataBasisSummary: '이메일(세션 궤적 아카이브) + 담당자(영업방/추가취소방 카톡·97 플레이북) + 거래처(주문·취소·증감 발주)',
    dataOrigins: {
      emailDoc: '수입 인보이스 첨부 텍스트 · session_rescue.jsonl 복구 계보',
      staffInput: '영업방·추가취소방 카톡 원문 · playbooks 97건 사내 절차서',
      partnerData: '거래처별 주문·취소·증감 메시지 패턴 · 농장 별칭 사전',
      thresholdRule: '1분 ordinal SHA-256(dedup_key) · Head+Tail 91.3% 압축 · 승인 리비전 일치 검증',
    },
    situation: '영업방·수입방 카톡 원문과 대용량 에이전트 로그가 흩어져 모델 한도 시 작업 맥락이 끊기곤 했습니다.',
    outcome: '50건 배치 즉시 아카이브와 91.3% 로그 압축, 무중단 폴백으로 카톡 주문·수입 보조 흐름을 24시간 안정 유지합니다.',
    linkedScenarioId: 'hermes-agent',
    targetRoutes: ['/orders/sales-paste', '/import/pipeline', '/my-work?tab=suite-sim'],
  },
  {
    id: 'build-ocr-arithmetic-guard',
    code: 'BLD-03',
    title: '스캔 인보이스·AWB 로컬 OCR(0.87s/쪽) 산술 교차검증 & 저신뢰 팩스 가드',
    status: 'PILOT',
    statusLabel: '파일럿검증',
    priorityRank: 3,
    departments: ['import', 'warehouse', 'finance'],
    departmentLabels: ['수입부', '출고·창고팀', '경영지원·정산부'],
    expectedImpact: '원본 PDF 숫자 재현율 97.4%(한글 97.9%), 쪽당 15.0s -> 0.87s(17배), 저해상도 팩스 100% 차단',
    dataBasisSummary: '이메일(농장 스캔 Invoice/Packing PDF·AWB) + 담당자(소계/합계 검산 확정) + 거래처(농장 서식)',
    dataOrigins: {
      emailDoc: '해외 농장 스캔 Invoice/Packing PDF · 항공사 AWB 스캔본 · 저해상도 팩스',
      staffInput: '수입부 행별 소계/총액 검산 확인 · 농장별 품목 매칭 선택',
      partnerData: '농장별 단가·송이·박스 입수량 서식 · 포워더 중량/운임 명세',
      thresholdRule: '글자층 우선 -> 스캔본만 로컬 OCR(0.87s/쪽) · 팩스 100dpi 차단 · 총액=행합 검증',
    },
    situation: '스캔 PDF 인보이스·패킹리스트가 도착할 때마다 수백 개 행을 수기 입력하고 총액을 다시 검산해야 했습니다.',
    outcome: '외부 전송 0인 로컬 OCR이 초안을 채우고 불일치 행만 강조하며 저화질 팩스를 차단해 검산 공수를 대폭 줄입니다.',
    linkedScenarioId: 'ocr-doc-pipeline',
    targetRoutes: ['/import/tools', '/import/pipeline', '/incoming'],
  },
  {
    id: 'build-phone-harness-rust-guard',
    code: 'BLD-04',
    title: '공용폰 위챗·야간·12장초과 보조수집(Phone Harness) + Rust 0.007ms 안전가드',
    status: 'PILOT',
    statusLabel: '파일럿검증',
    priorityRank: 4,
    departments: ['import', 'sales', 'warehouse'],
    departmentLabels: ['수입부', '영업부', '출고·창고팀'],
    expectedImpact: '야간·위챗·다량 사진 수신율 68% -> 99%(+31%p), 송금/삭제 키워드 0.007ms 차단, 화면점검 46ms/시트',
    dataBasisSummary: '이메일(12장 초과 클레임 증빙) + 담당자(공용폰 위챗/카톡 캡처) + 거래처(야간 발주·농장 위챗)',
    dataOrigins: {
      emailDoc: '12장 초과 파손 증빙 사진 묶음 · Playwright 화면 회귀 스냅샷',
      staffInput: '현장 공용 Android 단말 위챗/카톡 캡처 · 창고 검수 입력',
      partnerData: '해외 농장 위챗 선적/품질 통지 · 국내 거래처 야간 긴급 발주/불량 사진',
      thresholdRule: 'PC 18시/12장 한도 초과분 N2 분기 · dedup_key 병합 · 송금/이체/삭제 0.007ms 차단',
    },
    situation: '18시 이후·12장 초과 사진과 위챗 농장방 연락 약 32%가 PC 수집 사각지대에 남아 수동 재전송에 의존했습니다.',
    outcome: '공용 단말 Read-Only 보조수집과 Rust 0.007ms 킬스위치로 안전선 안에서 야간·위챗·대량 증빙을 99% 수신합니다.',
    linkedScenarioId: 'devicehub-phone-harness',
    targetRoutes: ['/my-work?tab=devices', '/sales/defect-deductions', '/incoming'],
  },
  {
    id: 'build-zero-unit-295-skus',
    code: 'BLD-05',
    title: '제로유닛 295품목(13,815주문행) Bunch/SteamOf1Box 자동 역산·보정 워크벤치',
    status: 'READY',
    statusLabel: '즉시구현가능',
    priorityRank: 5,
    departments: ['import', 'warehouse'],
    departmentLabels: ['수입부', '출고·창고팀'],
    expectedImpact: '제로유닛 295품목(13,815주문행) 입수량 누락·0원 단가 왜곡 일괄 해소, 차수 정산 대조 공수 -65%',
    dataBasisSummary: '이메일(농장 인보이스 단·송이 표기) + 담당자(수입부 품목마스터 SteamOf1Box) + 거래처(주문행 단위 환산)',
    dataOrigins: {
      emailDoc: '농장 Invoice/Packing PDF의 Stems/Box · Bunch/Box · Packing Unit 표기',
      staffInput: '수입부 품목마스터 SteamOf1Box 보정 · 창고 실입고 단/송이 검수',
      partnerData: '과거 13,815주문행 출고 단위 패턴 · 농장·국가별 표준 박스 입수량 규칙',
      thresholdRule: 'Bunch=0 또는 SteamOf1Box=0 인 295품목 역산(총송이÷박스수) -> 담당자 승인 후 보정 제안',
    },
    situation: '품목 마스터의 Bunch/SteamOf1Box 입수량이 0으로 비어 있는 295품목(13,815주문행)에서 도착원가·판매단가가 0원 또는 배수로 왜곡됩니다.',
    outcome: '인보이스 총 송이수·박스수·창고 실입수를 교차 역산해 295품목 보정 초안을 일괄 제시하고 승인 건만 안전 반영합니다.',
    linkedScenarioId: 'import-cost-profit-agi',
    targetRoutes: ['/import/tools', '/master/products', '/warehouse'],
  },
  {
    id: 'build-defect-232-spanish-credit',
    code: 'BLD-06',
    title: '미확정 불량차감(232건) 해외농장 스페인어 Credit Note & 사진패키지 자동 생성기',
    status: 'READY',
    statusLabel: '즉시구현가능',
    priorityRank: 6,
    departments: ['import', 'sales', 'finance'],
    departmentLabels: ['수입부', '영업부', '경영지원·정산부'],
    expectedImpact: '미확정 불량차감 232건 증빙 패키지 생성 45분 -> 2분, 농장 크레딧 실제 회수율 +35%p 향상',
    dataBasisSummary: '이메일(농장 클레임 회신) + 담당자(영업·창고 불량차감 232건·사진) + 거래처(국내 클레임·농장 Credit)',
    dataOrigins: {
      emailDoc: '해외농장 스페인어/영문 클레임 회신 메일 · 원본 인보이스/AWB 번호 매핑',
      staffInput: '영업부 미확정 불량차감 원장(232건) · 창고/Phone Harness 검품 파손 사진',
      partnerData: '국내 거래처 반품·차감 사유 · 에콰도르/콜롬비아 농장 Credit Note 승인 기준',
      thresholdRule: '미확정 232건 농장별 자동 묶음(파손사진+FOB손실+스페인어 클레임 서한) -> 수입부 확인 후 발송',
    },
    situation: '국내 거래처 불량차감(232건)은 발생했는데 해외 농장용 스페인어 설명서와 파손 사진 패키징이 번거로워 크레딧 청구가 미뤄지고 있습니다.',
    outcome: '차감 건별 사진·AWB·FOB 손실액을 묶어 농장별 스페인어 Credit Note PDF와 이메일 초안을 2분 만에 생성합니다.',
    linkedScenarioId: 'devicehub-phone-harness',
    targetRoutes: ['/sales/defect-deductions', '/incoming-price/credit-history', '/sales/farm-quality'],
  },
  {
    id: 'build-friday-proforma-defense-board',
    code: 'BLD-07',
    title: '금요일 Proforma 가원가 선산출 → 영업부 방어단가 즉시 브리핑 보드',
    status: 'READY',
    statusLabel: '즉시구현가능',
    priorityRank: 7,
    departments: ['import', 'sales'],
    departmentLabels: ['수입부', '영업부'],
    expectedImpact: '금요일 선적 직후 가원가 확보 리드타임 18h -> 0.4h, 차수 역마진 출고 사전 차단(목표마진 23% 방어)',
    dataBasisSummary: '이메일(금요일 Proforma Invoice PDF) + 담당자(수입 예상운임·영업 분배단가) + 거래처(농장FOB·견적)',
    dataOrigins: {
      emailDoc: '금요일 오후 접수 해외농장 Proforma Invoice PDF · 포워더 예정 운임 단가표',
      staffInput: '수입부 주간 기준환율·관세율 · 영업부 거래처별 주간 판매·분배 단가',
      partnerData: '농장 주간 FOB 단가 인상/할인 변동 · 국내 거래처 수용 단가 상한선',
      thresholdRule: '가원가÷(1-목표마진 23%)=권장 방어단가 산출 -> 기존 단가 하회 시 영업부 경보 게시',
    },
    situation: '금요일에 농장 Proforma 인보이스가 와도 정식 도착원가 정산 전까지 영업부가 원가 상승폭을 몰라 기존 단가 그대로 판매·배정하는 누수가 생깁니다.',
    outcome: '금요일 Proforma 도착 즉시 가원가와 품목별 권장 방어단가를 계산해 영업부 빠른 분배·견적 화면에 바로 띄워줍니다.',
    linkedScenarioId: 'import-cost-profit-agi',
    targetRoutes: ['/import/cost-agi', '/shipment/quick-absorb', '/estimate'],
  },
  {
    id: 'build-china-apta-e1-146-skus',
    code: 'BLD-08',
    title: '중국 APTA E1 협정세율(21.4% vs 25.0%, 146품목) 원산지증명 누락 자동 대사기',
    status: 'READY',
    statusLabel: '즉시구현가능',
    priorityRank: 8,
    departments: ['import', 'finance'],
    departmentLabels: ['수입부', '경영지원·정산부'],
    expectedImpact: '중국 146품목 관세율 오적용(25.0% -> E1 21.4%, -3.6%p) 선제 차단, 차수별 관세 과오납·누락 즉시 적발',
    dataBasisSummary: '이메일(APTA Form E 원산지증명·수입신고필증) + 담당자(수입 E1 체크·정산 관세 대사) + 거래처(중국 수출상)',
    dataOrigins: {
      emailDoc: '관세사 수입신고필증 PDF · 중국 수출상 APTA Form E 원산지증명 스캔본',
      staffInput: '수입부 중국 146품목 E1 적용 확인 · 정산부 차수 관세 대사표 입력',
      partnerData: '중국 농장/수출상별 Form E 정상 발급 이력 · 품목 HS코드 세율 매핑',
      thresholdRule: '중국 146품목 신고세율 25.0% 감지 시 E1(21.4%) Form E 첨부 누락 경보 & 소급환급 후보 분류',
    },
    situation: '중국 수입 146품목은 APTA E1 협정세율(21.4%) 대상인데 원산지증명서(Form E) 첨부·적용이 빠지면 기본세율(25.0%)로 3.6%p 추가 납부하게 됩니다.',
    outcome: '수입신고필증과 Form E 스캔본을 자동 대조해 25.0%로 신고된 품목과 미제출 농장을 통관·정산 전에 즉시 적발합니다.',
    linkedScenarioId: 'ocr-doc-pipeline',
    targetRoutes: ['/sales/customs-clearance', '/import/finance', '/sales/profit-report'],
  },
  {
    id: 'build-warehouse-d3-d5-aging',
    code: 'BLD-09',
    title: '창고 입고 D+3/D+5 미분배 체화재고 선도저하 경보 & 영업 우선소진 배정기',
    status: 'DISCOVERED',
    statusLabel: '신규발굴',
    priorityRank: 9,
    departments: ['warehouse', 'sales'],
    departmentLabels: ['출고·창고팀', '영업부'],
    expectedImpact: '입고 후 D+3/D+5 미분배 체화재고 폐기 손실 -40%, 선도 저하 전 영업부 긴급 소진 리드타임 1일 단축',
    dataBasisSummary: '이메일(입항·검역 통과일 통지) + 담당자(창고 실재고 검품·영업 추가소진) + 거래처(단기소진 수요처)',
    dataOrigins: {
      emailDoc: '항공 입항·통관 완료 시각 및 검역 반출 통지 메일',
      staffInput: '창고 입고일별 실재고·상태 등급 입력 · 영업부 긴급 소진 배정 확정',
      partnerData: '단기 대량 소화 거래처 선호 품종 · 과거 특판 소진 응답률',
      thresholdRule: '입고 경과일 D+3 주의 / D+5 선도 위험 임계치 초과 미분배 재고 영업부 우선소진 상단 고정',
    },
    situation: '창고에 입고된 뒤 3~5일이 지난 미분배 재고가 뒤늦게 발견되면 선도 저하로 원가 이하 처분이나 폐기 손실로 이어집니다.',
    outcome: '입고 경과일(D+3/D+5) 기준 체화 품목과 실재고 수량을 창고·영업 화면에 동시 경보해 선도 유지 구간 내 우선 소진시킵니다.',
    linkedScenarioId: 'echarts-ui-vis',
    targetRoutes: ['/warehouse', '/shipment/stock-status', '/shipment/quick-absorb'],
  },
  {
    id: 'build-customer-net-contribution-rank',
    code: 'BLD-10',
    title: '거래처별 실질 공헌이익(순단가-클레임률-미수회전일) 성적표 & 희소품목 분배 가중치',
    status: 'DISCOVERED',
    statusLabel: '신규발굴',
    priorityRank: 10,
    departments: ['sales', 'finance'],
    departmentLabels: ['영업부', '경영지원·정산부'],
    expectedImpact: '외형 매출 대비 실질 공헌이익 하위 거래처 즉시 식별, 희소 물량 배정 시 차수 총이익률 +2.1%p 개선',
    dataBasisSummary: '이메일(세금계산서·이카운트 입금 대사) + 담당자(영업 물량배분·정산 미수집계) + 거래처(실단가·불량률·회전일)',
    dataOrigins: {
      emailDoc: '이카운트 미수금·입금 내역 · 전자세금계산서 발행 이력',
      staffInput: '영업부 거래처별 희소품목 분배 배정 · 정산부 주간/월간 이익 원장',
      partnerData: '거래처별 실납품 순단가 · 불량클레임 차감비율 · 평균 회수일수(DSO)',
      thresholdRule: '실질공헌이익=(순매출-도착원가-클레임차감-미수자금비용) 점수화 -> 희소품목 분배 우선 가중치 제시',
    },
    situation: '매출 규모만 크고 반품 클레임이 잦거나 미수금 회전이 느린 거래처에 희소 수입 품목이 배정되어 회사 전체 이익률이 낮아지는 문제가 있습니다.',
    outcome: '순단가·클레임률·미수회전일을 결합한 실질 공헌이익 성적표를 제공해 영업부가 고수익 거래처 중심으로 물량을 배분할 수 있습니다.',
    linkedScenarioId: 'echarts-ui-vis',
    targetRoutes: ['/sales/profit-customer-margin', '/mgmt/customer-profit', '/ecount/receivables'],
  },
  {
    id: 'build-fx-remittance-49-farms',
    code: 'BLD-11',
    title: '외화 송금 스케줄러(미등록 49개 농장 결제일) & 환율 편차 방어 시뮬레이터',
    status: 'DISCOVERED',
    statusLabel: '신규발굴',
    priorityRank: 11,
    departments: ['import', 'finance'],
    departmentLabels: ['수입부', '경영지원·정산부'],
    expectedImpact: '결제일 미등록 49개 해외농장 송금 만기 일괄 정비, 환율 급등 구간 분할 송금으로 환차손 연간 -15% 방어',
    dataBasisSummary: '이메일(농장 미수명세서 SOA·송금확인서) + 담당자(수입 결제조건·정산 자금집행) + 거래처(49개 농장 Term)',
    dataOrigins: {
      emailDoc: '해외농장 월간 미수명세서(Statement of Account) · 은행 외화송금 확인서 PDF',
      staffInput: '수입부 농장별 결제일(Net 14/30) 등록 · 정산부 주간 환율 기준선 설정',
      partnerData: '결제일 미등록 49개 농장 인보이스 발행일 · Credit 차감 반영 순송금액',
      thresholdRule: '송금 만기 D-7 경보 + 고시환율 20일 이동평균 대비 +15원 초과 시 분할송금 시뮬 제시',
    },
    situation: '해외 농장 중 49곳의 결제일(Credit Term)이 체계적으로 등록되지 않아 송금 시점이 몰리거나 환율 급등일에 일괄 송금해 환차손이 누적됩니다.',
    outcome: '49개 농장 결제일을 표준화하고 환율 편차 구간별 분할 송금 스케줄을 시뮬레이션해 외화 자금 집행 효율을 높입니다.',
    linkedScenarioId: 'import-cost-profit-agi',
    targetRoutes: ['/finance/exchange', '/import/finance', '/mgmt/ar-aging'],
  },
];

export const CONTINUOUS_BUILD_PIPELINE = Object.freeze(
  RAW_CONTINUOUS_BUILD_PIPELINE.map((item) =>
    Object.freeze({
      ...item,
      departments: Object.freeze([...item.departments]),
      departmentLabels: Object.freeze([...item.departmentLabels]),
      targetRoutes: Object.freeze([...item.targetRoutes]),
      dataOrigins: Object.freeze({ ...item.dataOrigins }),
      agentBriefText: buildAgentBriefText(item),
    })
  )
);

export function deriveNextBuildItems({ dept = 'all', stage = 'all', query = '' } = {}) {
  const normalizedDept = normalizeDeptFilter(dept);
  const normalizedStage = String(stage || 'all').trim().toUpperCase();
  const q = normKey(query);

  return CONTINUOUS_BUILD_PIPELINE.filter((item) => {
    if (normalizedDept !== 'all' && !item.departments.includes(normalizedDept)) return false;
    if (normalizedStage && normalizedStage !== 'ALL' && item.status !== normalizedStage) return false;
    if (q) {
      const hay = normKey(
        [
          item.code,
          item.title,
          item.status,
          item.statusLabel,
          item.expectedImpact,
          item.dataBasisSummary,
          item.departmentLabels.join(' '),
          item.targetRoutes.join(' '),
        ].join(' ')
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function summarizeBuildPipeline(buildItems = CONTINUOUS_BUILD_PIPELINE) {
  const byStage = { LIVE: 0, PILOT: 0, READY: 0, DISCOVERED: 0 };
  const byDept = { import: 0, sales: 0, warehouse: 0, finance: 0 };
  for (const item of buildItems || []) {
    if (byStage[item.status] !== undefined) byStage[item.status] += 1;
    for (const d of item.departments || []) {
      if (byDept[d] !== undefined) byDept[d] += 1;
    }
  }
  return {
    total: (buildItems || []).length,
    byStage,
    byDept,
    readyCount: byStage.READY,
    discoveredCount: byStage.DISCOVERED,
  };
}

export function getItemDepartments(item) {
  if (!item) return ['import', 'sales'];
  const { scenario } = findMatchingScenario(item, '');
  return Array.isArray(scenario?.primaryDepartments) ? scenario.primaryDepartments : ['import'];
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

// 선택 기술 기준 nenovakakao 실설계 6노드 도입 전/후 + 부서·원천 데이터 계보 시뮬레이션 모델 생성
export function simulateRadarItem(item, options = {}) {
  const buildItem = options?.buildItemId
    ? CONTINUOUS_BUILD_PIPELINE.find((b) => b.id === options.buildItemId) || null
    : null;
  const safeItem =
    item ||
    (buildItem
      ? {
          id: buildItem.id,
          name: buildItem.title,
          quadrant: 'Q1',
          ring: buildItem.status === 'LIVE' ? 'adopt' : 'trial',
          score10: 9,
        }
      : { id: 'default', name: 'NousResearch/hermes-agent', quadrant: 'Q1', ring: 'trial', score10: 9 });
  const effectiveScenarioId = options?.scenarioId || buildItem?.linkedScenarioId || '';
  const { scenario, matchType } = findMatchingScenario(safeItem, effectiveScenarioId);
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

  const baseExecutiveBrief = scenario.executiveBrief || {
    situation: `${safeItem.name || scenario.title} 도입 전 수작업 대조와 분산된 원장 확인으로 지연이 발생합니다.`,
    outcome: `${scenario.title} 파이프라인 적용으로 데이터 정합성과 부서별 실행 속도가 개선됩니다.`,
  };
  const executiveBrief = buildItem
    ? {
        situation: `[${buildItem.code} · ${buildItem.statusLabel}] ${buildItem.situation || baseExecutiveBrief.situation}`,
        outcome: `${buildItem.expectedImpact} (${buildItem.outcome || baseExecutiveBrief.outcome})`,
      }
    : baseExecutiveBrief;

  const dataOrigins = buildItem?.dataOrigins
    ? { ...buildItem.dataOrigins }
    : { ...(scenario.dataOrigins || {}) };

  const primaryDepartments = buildItem?.departments?.length
    ? buildItem.departments
    : Array.isArray(scenario.primaryDepartments)
      ? scenario.primaryDepartments
      : ['import'];

  const departmentMatrix = (scenario.departmentMatrix || []).map((row, idx) => {
    const isBuildTarget = Boolean(buildItem && buildItem.departments.includes(row.deptId));
    const deptRoute = isBuildTarget && buildItem.targetRoutes?.[idx] ? buildItem.targetRoutes[idx] : row.route;
    return {
      ...row,
      deptName: row.deptName || DEPT_LABEL_MAP[row.deptId] || row.deptId,
      impactLevel: isBuildTarget ? '핵심' : row.impactLevel,
      roleChange: isBuildTarget
        ? `[${buildItem.code}] ${buildItem.expectedImpact.split(',')[0]} — ${row.roleChange}`
        : row.roleChange,
      route: deptRoute || row.route,
    };
  });

  return {
    itemName: buildItem ? `${buildItem.code} · ${buildItem.title}` : safeItem.name || safeItem.title || scenario.title,
    scenarioId: scenario.id,
    scenarioTitle: buildItem
      ? `[연속구현 ${buildItem.code}] ${buildItem.title}`
      : matchType === 'exact-scenario'
        ? scenario.title
        : `${safeItem.name} -> ${scenario.title}`,
    subtitle: buildItem ? `${buildItem.statusLabel} · ${scenario.subtitle}` : scenario.subtitle,
    matchType,
    primaryNode: scenario.primaryNode,
    activeNodes: scenario.activeNodes,
    primaryDepartments,
    executiveBrief,
    dataOrigins,
    departmentMatrix,
    linkedBuildItem: buildItem,
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
