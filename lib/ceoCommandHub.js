// lib/ceoCommandHub.js
// 사장님 전용 통합 지휘실(/work/command-hub) 순수 도메인 집계 · 정규화 모듈.
// DB · React · 파일 I/O 의존 없음 (서버/클라이언트/단위테스트 공용).
// 원장 무쓰기 · 읽기 전용 원칙, 사내 비노출어 및 장식 이모지 0건 준수.

import {
  CONTINUOUS_BUILD_PIPELINE,
  BUILD_PIPELINE_STAGES,
  normalizeRadarCatalog,
  buildWorkbenchSummary,
} from './pmTechRadarSim';
import { runGabrielAgiAudit } from './gabrielProfitAgi';
import { pmUnresolved } from './pmUnresolved';
import { normalizePlaybooks, playbookSummary, kstDateTime } from './pmPlaybooks';

export const CEO_FONT_STACK =
  "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif";

export const MORNING_CHECKLIST = Object.freeze([
  Object.freeze({
    stepNo: 1,
    id: 'step-approval',
    title: '1. 사장님 결재 대기 확인',
    desc: '승인 대기 PM 안건과 기술 파일럿 채택 건을 한 번에 점검합니다.',
    targetId: 'hub-pm-ledger',
    ledgerFilter: 'approval',
  }),
  Object.freeze({
    stepNo: 2,
    id: 'step-agents-pulse',
    title: '2. 6대 에이전트 · 디벨롭 진척 확인',
    desc: '각 에이전트가 지금 보고 있는 일과 최근 배포·연속 구현 진도를 봅니다.',
    targetId: 'hub-agents-and-pulse',
    ledgerFilter: null,
  }),
  Object.freeze({
    stepNo: 3,
    id: 'step-gabriel-alerts',
    title: '3. 가브리엘 원가·이익 경보 확인',
    desc: '마진 침식·AWB 혼적·미회수 크레딧 상위 3대 경보와 기대 이익을 확인합니다.',
    targetId: 'hub-gabriel-alerts',
    ledgerFilter: null,
  }),
]);

export const DEFAULT_DEVELOPMENT_MILESTONES = Object.freeze([
  Object.freeze({
    id: 'ms-pr-1887',
    dateLabel: '2026-11-19',
    badge: 'PR #1887',
    title: '솔루션 시뮬레이션 · 직교 SVG 버스 · 공용폰 3열 OCR & 한글 고딕 교정',
    summary: '직교 버스·마스터-디테일 캡처 뷰어와 Windows 한글 고딕 가독성 기준(Desktop 1.3.62)을 반영했습니다.',
    route: '/my-work?tab=suite-sim',
    routeLabel: '솔루션 시뮬레이션',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1886',
    dateLabel: '2026-11-19',
    badge: 'PR #1886',
    title: '출고내역서 FSO 거래처 플로르아름 검색 지원',
    summary: '출고내역서 거래처 선택·검색에서 FSO를 플로르아름으로 바로 조회할 수 있습니다.',
    route: '/shipment/statement',
    routeLabel: '출고내역서',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1885',
    dateLabel: '2026-11-19',
    badge: 'PR #1885',
    title: '주차별 매출이익 보고서 · 중국 배/비행기 분해 조회',
    summary: '중국 해상(배)·항공(비행기) 운송별 원가·이익을 원장 무변경 읽기 전용으로 분해 조회합니다.',
    route: '/sales/profit-report',
    routeLabel: '매출이익 보고서',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1880',
    dateLabel: '2026-11-19',
    badge: 'PR #1880',
    title: '불량차감 클레임용 · 견적용 수량 분리 저장',
    summary: '원본 클레임 수량(Quantity)을 보존하면서 견적 반영용 수량(EstimateQuantity)을 분리 관리합니다.',
    route: '/sales/defect-deductions',
    routeLabel: '불량차감 원장',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1879',
    dateLabel: '2026-11-19',
    badge: 'PR #1879',
    title: 'PM 진행·오류 관제(/pm) 에디토리얼 정화 & 가이드',
    summary: '기본 일반 관제 모드로 1초 내 오류·지연을 판별하고 1920/1280/390 화면과 가이드 영상을 검증했습니다.',
    route: '/pm',
    routeLabel: 'PM 오류관제',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1878',
    dateLabel: '2026-11-19',
    badge: 'PR #1878',
    title: '도입 레이더 · 아키텍처 흐름도 4종 개편',
    summary: '4분면 극좌표 레이더, 2×2 매트릭스, 카본 콘솔, 연속 구현 파이프라인을 한 화면으로 연결했습니다.',
    route: '/my-work?tab=radar',
    routeLabel: '도입 레이더',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1877',
    dateLabel: '2026-11-19',
    badge: 'PR #1877',
    title: '통합 솔루션 시뮬레이션 · 상용 시연 스튜디오 연결',
    summary: '카톡 수집부터 MOYI 승인, 전산 반영까지 실작업 캡처 바운딩박스와 업종별 시연을 연결했습니다.',
    route: '/my-work?tab=suite-sim',
    routeLabel: '솔루션 시뮬레이션',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1871',
    dateLabel: '2026-11-19',
    badge: 'PR #1871',
    title: '가브리엘 원가·이익 최적화 AGI (전사 10대 레버)',
    summary: 'L1~L10 원가·이익 레버 분해, 환율 스트레스, 시안 A·B·C·ALL 동시 비교를 실전 배치했습니다.',
    route: '/import/gabriel-agi',
    routeLabel: '가브리엘 AGI',
    source: 'release',
  }),
  Object.freeze({
    id: 'ms-pr-1840',
    dateLabel: '2026-11-18',
    badge: 'PR #1840',
    title: '디바이스 허브(Phone Harness) & Rust 402.5KB 사이드카',
    summary: '공용 단말 Read-Only 보조수집과 0.007ms 킬스위치, 4.35x 로그 압축 코어를 통합했습니다.',
    route: '/my-work?tab=devices',
    routeLabel: '디바이스 허브',
    source: 'release',
  }),
]);

export const CEO_PAGE_DIRECTORY = Object.freeze([
  Object.freeze({
    id: 'dir-daily-command',
    stepLabel: '목적 1',
    title: '일일 지휘 · 결재 관제',
    whenToUse: '매일 아침 08:30 · PM 안건과 회사 전체 이상 유무를 1분 안에 볼 때',
    items: Object.freeze([
      Object.freeze({
        href: '/work/command-hub',
        title: '사장님 통합 지휘실',
        oneLineDesc: 'PM 안건, 6대 에이전트 현황, 연속 디벨롭, 원가 경보를 한 페이지에서 봅니다.',
        whenText: '출근 직후 · 수시 확인',
        badge: '현재 화면',
      }),
      Object.freeze({
        href: '/pm',
        title: 'PM 진행·오류 관제',
        oneLineDesc: '직원별 실시간 업무 단계, 재발 학습 카드, 직원 요청 게시판을 처리합니다.',
        whenText: '오류·정체 상세 조치 시',
        badge: '실시간',
      }),
      Object.freeze({
        href: '/ops',
        title: '운영 관제탑',
        oneLineDesc: '발주부터 이익까지 9단계 전사 흐름과 전산 일치율을 한눈에 봅니다.',
        whenText: '전사 병목 점검 시',
        badge: '9단계',
      }),
      Object.freeze({
        href: '/mgmt/approvals',
        title: '결재선 · 승인 요청함',
        oneLineDesc: '송금 결재선과 관리자 최종 승인 대기 건을 검토하고 처리합니다.',
        whenText: '송금·결재 승인 시',
        badge: '결재',
      }),
      Object.freeze({
        href: '/mgmt',
        title: '경영관리 홈',
        oneLineDesc: '여신한도, 채권 aging, 차수 마감 체크리스트, 거래처 이익을 봅니다.',
        whenText: '주간·월간 마감 시',
        badge: '경영',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-profit-ops',
    stepLabel: '목적 2',
    title: '돈 버는 원가 · 실무 원스톱',
    whenToUse: '선적 전후 마진 방어, 인보이스 검산, 출고·불량 정산을 확인할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/import/gabriel-agi',
        title: '가브리엘 원가·이익 최적화 AGI',
        oneLineDesc: '전사 10대 원가·이익 레버와 환율 충격 시뮬레이션, 방어 단가를 계산합니다.',
        whenText: '목·금 발주 / 원가 점검 시',
        badge: '10대 레버',
      }),
      Object.freeze({
        href: '/import/pipeline',
        title: '수입 원스톱 파이프라인',
        oneLineDesc: '인보이스 파싱부터 입고 검수, 도착원가 확정, 카톡 공유까지 순서대로 진행합니다.',
        whenText: '수입 차수 처리 전체',
        badge: '원스톱',
      }),
      Object.freeze({
        href: '/import/tools',
        title: '수입부 업무도구 · 원본 대조',
        oneLineDesc: 'PDF 원본과 추출 금액·품목·농장을 나란히 대조하고 원가표를 받습니다.',
        whenText: '인보이스 이상 확인 시',
        badge: '원본대조',
      }),
      Object.freeze({
        href: '/shipment/quick-absorb',
        title: '빠른 분배 · 미등록주문 통합입력',
        oneLineDesc: '카톡 추가 주문과 잔여 재고를 한 화면에서 연결해 즉시 분배합니다.',
        whenText: '당일 추가·잔량 배정 시',
        badge: '출고분배',
      }),
      Object.freeze({
        href: '/sales/profit-report',
        title: '주차별 매출이익 보고서',
        oneLineDesc: '차수별 확정 매출·도착원가·중국 배/비행기 기준 이익률을 검증합니다.',
        whenText: '차수 이익 최종 확정 시',
        badge: '매출이익',
      }),
      Object.freeze({
        href: '/sales/defect-deductions',
        title: '영업수입불량차감',
        oneLineDesc: '국내 불량 클레임 수량·견적 수량을 구분해 관리하고 농장 크레딧으로 잇습니다.',
        whenText: '불량 차감 · 크레딧 청구 시',
        badge: '클레임',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-radar-arch',
    stepLabel: '목적 3',
    title: '기술 레이더 · 도면 · 시뮬레이션',
    whenToUse: '에이전트가 무엇을 개발 중인지, 새 기술 파일럿·설계도를 검수할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/my-work?tab=radar',
        title: '도입 레이더 (기술 파일럿·채택)',
        oneLineDesc: '발굴 기술 파일럿 실측 점수, 채택 결재 대기 안건, 연속 구현 큐를 관리합니다.',
        whenText: '신규 기술 채택 결정 시',
        badge: '파일럿',
      }),
      Object.freeze({
        href: '/my-work?tab=arch',
        title: '아키텍처 흐름도',
        oneLineDesc: '운영PC, Phone Harness, MOYI, Orbit/Hermes, Rust 핫패스 6대 표면 도면입니다.',
        whenText: '전체 구조·데이터 계보 확인',
        badge: '설계도',
      }),
      Object.freeze({
        href: '/my-work?tab=suite-sim',
        title: '통합 솔루션 시뮬레이션',
        oneLineDesc: '메신저 수집부터 승인 게이트, 전산 반영까지 실캡처 바운딩박스로 시연합니다.',
        whenText: '자동화 동작 검증 시',
        badge: '모션시뮬',
      }),
      Object.freeze({
        href: '/my-work?tab=devices',
        title: '디바이스 허브 관제',
        oneLineDesc: '402.5KB Rust 사이드카 기반 공용폰 Read-Only 연결과 0.007ms 킬스위치를 봅니다.',
        whenText: '공용폰·현장 단말 점검 시',
        badge: 'Rust 402KB',
      }),
      Object.freeze({
        href: '/dev/history',
        title: '전체 개발 히스토리',
        oneLineDesc: '네노바ERP·Orbit·nenovakakao 저장소의 실제 커밋과 메뉴별 개선 이력을 조회합니다.',
        whenText: '날짜별 상세 코드 이력 조회',
        badge: '커밋이력',
      }),
    ]),
  }),
  Object.freeze({
    id: 'dir-manuals-commercial',
    stepLabel: '목적 4',
    title: '부서 매뉴얼 · 상용 판매 시연',
    whenToUse: '직원 업무 표준화 상태를 점검하거나 외부 고객에게 NOWLINK를 시연할 때',
    items: Object.freeze([
      Object.freeze({
        href: '/work/manuals',
        title: '부서별 업무 매뉴얼',
        oneLineDesc: '부서·담당자별 실전 절차서, 라이브 파이프라인, 신입 루틴과 강의 영상을 봅니다.',
        whenText: '부서 업무 표준 점검 · 교육',
        badge: '매뉴얼',
      }),
      Object.freeze({
        href: '/admin/orbit-report',
        title: '직원 업무 심화 리포트',
        oneLineDesc: 'Orbit 실관측 데이터 기반 부서·직원별 반복 작업과 개선 우선순위를 봅니다.',
        whenText: '업무 구조 심층 분석 시',
        badge: '심화리포트',
      }),
      Object.freeze({
        href: '/demo/commercial-suite',
        title: '상용 솔루션 시연 스튜디오',
        oneLineDesc: '외부 시연용 가상 데이터로 NOWLINK 업종별 도입 효과와 요금제를 시연합니다.',
        whenText: '외부 미팅 · 영업 시연 시',
        badge: 'NOWLINK',
      }),
      Object.freeze({
        href: '/integrations/moyi',
        title: 'MOYI 보고 연동',
        oneLineDesc: 'MOYI 메신저 보고 수신자와 연결코드를 관리합니다.',
        whenText: '보고 수신 대상 변경 시',
        badge: '메신저',
      }),
      Object.freeze({
        href: '/integrations/moyi-drive',
        title: 'MOYI Drive 관리',
        oneLineDesc: '업무 드라이브와 메신저 업로드 파일의 연결 상태를 점검합니다.',
        whenText: '파일 보관·연결 점검 시',
        badge: '드라이브',
      }),
    ]),
  }),
]);

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);

function formatKrwCompact(krw) {
  const n = Math.round(Number(krw) || 0);
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  if (abs >= 10000) {
    const man = Math.round((abs / 10000) * 10) / 10;
    return `${sign}${man.toLocaleString('ko-KR')}만원`;
  }
  return `${sign}${abs.toLocaleString('ko-KR')}원`;
}

function normalizePrLink(prValue) {
  const raw = str(prValue);
  if (!raw) return { prNumber: '', prUrl: '' };
  const numMatch = raw.match(/#?(\d{2,6})/);
  const prNumber = numMatch ? `#${numMatch[1]}` : raw.slice(0, 20);
  const prUrl = /^https:\/\/github\.com\//.test(raw)
    ? raw
    : numMatch
      ? `https://github.com/Jayinsightfactory/nenova-erp-ui/pull/${numMatch[1]}`
      : '';
  return { prNumber, prUrl };
}

function classifyTaskBucket(task) {
  const state = str(task?.state);
  const decision = str(task?.decision);
  if (/done|merged|resolved|closed|완료/i.test(state)) return 'done';
  if (/approv|escalat|승인|needs-human/i.test(`${state} ${decision}`) || num(task?.days) >= 3) {
    return 'approval';
  }
  return 'active';
}

function classifyStaffReqBucket(req) {
  const st = str(req?.status);
  if (st === 'deployed' || st === 'pr' || st === 'answered' || st === 'rejected') return 'done';
  if (st === 'needs-human') return 'approval';
  return 'active';
}

function formatDateBadge(iso, fallback = '최근') {
  const raw = str(iso);
  if (!raw) return fallback;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw.slice(0, 10) || fallback;
  const kst = new Date(parsed + 9 * 3600 * 1000);
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}`;
}

function safeGabrielAudit(gabrielAudit) {
  if (gabrielAudit && gabrielAudit.summary && Array.isArray(gabrielAudit.levers)) {
    return gabrielAudit;
  }
  try {
    return runGabrielAgiAudit();
  } catch {
    return {
      scope: { orderYear: '2026', orderWeek: '46-01', countryName: '전사' },
      summary: {
        totalPotentialProfitKRW: 0,
        annualizedProfitKRW: 0,
        unhedgedMarginPct: 0,
        simulatedMarginPct: 0,
        marginDeltaPctPt: 0,
        costLeakAlertCount: 0,
        marginErosionAlertCount: 0,
        awbTierReadyCount: 0,
        unrecoveredClaimCount: 0,
        potentialCreditUSD: 0,
        potentialCreditKRW: 0,
      },
      levers: [],
      claims: [],
      awbs: [],
    };
  }
}

export function buildPmActionLedger({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
} = {}) {
  const rows = [];
  const data = pmOffice?.data || {};
  const tasks = arr(data.tasks);
  const unresolvedList = pmUnresolved(tasks);
  const unresolvedById = new Map(unresolvedList.map((u) => [u.id, u]));

  tasks.forEach((task, idx) => {
    if (!task || typeof task !== 'object') return;
    const key = str(task.key) || `pm-task-${idx + 1}`;
    const bucket = classifyTaskBucket(task);
    const derived = unresolvedById.get(key);
    const stateText = str(task.state) || (bucket === 'done' ? 'done' : 'investigating');
    const title = derived?.title || str(task.title) || str(task.msg) || key;
    const summary = derived?.todo || str(task.decision) || str(task.msg) || 'PM 에이전트 점검 항목';
    const { prNumber, prUrl } = normalizePrLink(task.pr || '');
    const days = Number.isFinite(Number(task.days)) ? Number(task.days) : null;

    rows.push({
      id: `task-${key}-${idx}`,
      sourceType: 'pm-task',
      sourceLabel: 'PM 원장',
      bucket,
      statusCode: stateText,
      statusLabel:
        bucket === 'approval'
          ? '결재·확인 대기'
          : bucket === 'done'
            ? '완료'
            : /verif|검증/i.test(stateText)
              ? '검증중'
              : '조사·진행중',
      tone: bucket === 'approval' ? 'warn' : bucket === 'done' ? 'ok' : 'info',
      title,
      ownerOrTrack: [str(task.owner) || 'PM 조사관', key].filter(Boolean).join(' · '),
      questionOrSummary: summary,
      prNumber,
      prUrl,
      route: '/pm',
      routeLabel: 'PM 관제 열기',
      days,
      updatedAt: str(task.updatedAt) || str(pmOffice?.serverNow) || '',
    });
  });

  arr(staffRequests).forEach((req, idx) => {
    if (!req || typeof req !== 'object') return;
    const bucket = classifyStaffReqBucket(req);
    const status = str(req.status) || 'received';
    const statusMap = {
      received: '접수됨',
      triaged: '분류됨',
      working: '에이전트 처리중',
      pr: 'PR 생성 완료',
      deployed: '배포 완료',
      answered: '답변 완료',
      'needs-human': '사장님 확인 필요',
      rejected: '반려',
    };
    const { prNumber, prUrl } = normalizePrLink(req.pr);
    const targetRoute = str(req.route).startsWith('/') ? str(req.route) : '/pm?requests=list';

    rows.push({
      id: `req-${str(req.id) || idx}`,
      sourceType: 'staff-request',
      sourceLabel: '직원 요청',
      bucket,
      statusCode: status,
      statusLabel: statusMap[status] || status,
      tone: bucket === 'approval' ? 'warn' : bucket === 'done' ? 'ok' : 'info',
      title: str(req.title) || '제목 없는 요청',
      ownerOrTrack: [str(req.byName) || str(req.by) || '직원', str(req.category) || '요청'].join(' · '),
      questionOrSummary: str(req.answer) || str(req.body) || 'PM 루프 자동 분류·처리 대상',
      prNumber,
      prUrl,
      route: targetRoute,
      routeLabel: '요청 상세',
      days: null,
      updatedAt: str(req.updatedAt) || str(req.at) || '',
    });
  });

  const radarItems = normalizeRadarCatalog({
    ledger: adoptionLedger,
    techRadar,
    adminMode: true,
  });
  radarItems
    .filter((item) => item.needsApproval)
    .slice(0, 12)
    .forEach((item, idx) => {
      const pilot = item.pilotResult;
      const pilotNote = pilot
        ? `파일럿 ${pilot.verdict || '검증'} (${pilot.score ?? item.score10}점) · ${str(pilot.summary)}`
        : str(item.why) || str(item.summary) || '도입 여부 결재 대기';
      rows.push({
        id: `radar-${str(item.id) || idx}`,
        sourceType: 'tech-radar',
        sourceLabel: '기술 레이더',
        bucket: 'approval',
        statusCode: 'needs-approval',
        statusLabel: '도입 결재 대기',
        tone: 'warn',
        title: `${item.name} 채택 결재`,
        ownerOrTrack: `Tech Scout · ${item.quadrant} · ${item.ring.toUpperCase()}`,
        questionOrSummary: pilotNote,
        prNumber: '',
        prUrl: '',
        route: '/my-work?tab=radar',
        routeLabel: '레이더 결재',
        days: null,
        updatedAt: str(pilot?.testedAt) || str(techRadar?.generatedAt) || '',
      });
    });

  const bucketRank = { approval: 0, active: 1, done: 2 };
  return rows.sort((a, b) => {
    const ba = bucketRank[a.bucket] ?? 9;
    const bb = bucketRank[b.bucket] ?? 9;
    if (ba !== bb) return ba - bb;
    const da = a.days ?? 0;
    const db = b.days ?? 0;
    if (db !== da) return db - da;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

export function filterPmActionLedger(items = [], filter = 'all', query = '') {
  const f = str(filter).toLowerCase() || 'all';
  const q = str(query).toLowerCase();

  return arr(items).filter((row) => {
    if (f !== 'all' && row.bucket !== f) return false;
    if (!q) return true;
    const hay = [
      row.title,
      row.ownerOrTrack,
      row.questionOrSummary,
      row.statusLabel,
      row.sourceLabel,
      row.prNumber,
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function buildDevelopmentPulse({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
  buildPipeline = CONTINUOUS_BUILD_PIPELINE,
  recentCommits = [],
  gabrielAudit = null,
} = {}) {
  const audit = safeGabrielAudit(gabrielAudit);
  const data = pmOffice?.data || {};
  const tasks = arr(data.tasks);
  const doneToday = arr(data?.pmDetail?.doneToday);
  const radarItems = normalizeRadarCatalog({
    ledger: adoptionLedger,
    techRadar,
    adminMode: true,
  });
  const radarSummary = buildWorkbenchSummary(radarItems, true);
  const unresolved = pmUnresolved(tasks);

  const stageCounts = { LIVE: 0, PILOT: 0, READY: 0, DISCOVERED: 0 };
  for (const item of arr(buildPipeline)) {
    if (stageCounts[item.status] !== undefined) stageCounts[item.status] += 1;
  }

  const timeline = [];
  const seenIds = new Set();
  const pushItem = (entry) => {
    if (!entry || !entry.title || seenIds.has(entry.id)) return;
    seenIds.add(entry.id);
    timeline.push(entry);
  };

  // 1) 오늘 PM 에이전트가 방금 처리한 항목
  doneToday.slice(0, 5).forEach((d, idx) => {
    const text = str(d?.text);
    if (!text) return;
    const atLabel = kstDateTime(d.at) || formatDateBadge(d.at, '오늘');
    pushItem({
      id: `pm-done-${idx}-${text.slice(0, 16)}`,
      dateLabel: atLabel,
      badge: 'PM 완료',
      title: text,
      summary: 'PM 루프가 오늘 자동 처리·검증한 항목입니다.',
      route: '/pm',
      routeLabel: 'PM 관제',
      source: 'live-pm',
    });
  });

  // 2) 배포·PR 올라온 직원 요청
  arr(staffRequests)
    .filter((r) => ['deployed', 'pr', 'answered'].includes(str(r?.status)))
    .slice(0, 4)
    .forEach((r, idx) => {
      const { prNumber } = normalizePrLink(r.pr);
      pushItem({
        id: `req-done-${r.id || idx}`,
        dateLabel: formatDateBadge(r.updatedAt || r.at, '최근'),
        badge: prNumber || (r.status === 'deployed' ? '배포됨' : '요청 처리'),
        title: str(r.title) || '직원 요청 처리 완료',
        summary: str(r.answer) || `${str(r.byName || '직원')} 요청이 반영되었습니다.`,
        route: str(r.route).startsWith('/') ? str(r.route) : '/pm?requests=list',
        routeLabel: '확인하기',
        source: 'staff-request',
      });
    });

  // 3) 외부에서 주입된 최신 커밋/이력
  arr(recentCommits)
    .slice(0, 4)
    .forEach((c, idx) => {
      pushItem({
        id: `commit-${c.hash || idx}`,
        dateLabel: formatDateBadge(c.date || c.committedAt, '최근'),
        badge: c.badge || '커밋',
        title: str(c.subject || c.title),
        summary: str(c.summary) || '코드 변경이 저장소에 병합되었습니다.',
        route: str(c.route) || '/dev/history',
        routeLabel: '이력 보기',
        source: 'git',
      });
    });

  // 4) 정본 최신 주요 마일스톤 (PR #1885 ~ #1840)
  for (const ms of DEFAULT_DEVELOPMENT_MILESTONES) {
    pushItem(ms);
  }

  const activePmTaskCount = tasks.filter((t) => !/done|merged|resolved|완료/i.test(str(t?.state))).length +
    arr(staffRequests).filter((r) => ['received', 'triaged', 'working'].includes(str(r?.status))).length;

  const ledgerRows = buildPmActionLedger({ pmOffice, staffRequests, adoptionLedger, techRadar });
  const ownerApprovalCount = ledgerRows.filter((row) => row.bucket === 'approval').length;

  const recentCompletedCount =
    DEFAULT_DEVELOPMENT_MILESTONES.length +
    doneToday.length +
    arr(staffRequests).filter((r) => ['deployed', 'pr'].includes(str(r?.status))).length;

  const stageOrder = { LIVE: 0, PILOT: 1, READY: 2, DISCOVERED: 3 };
  const buildQueue = arr(buildPipeline)
    .slice()
    .sort((a, b) => (stageOrder[a.status] ?? 9) - (stageOrder[b.status] ?? 9) || (a.priorityRank ?? 99) - (b.priorityRank ?? 99))
    .map((item) => ({
      id: item.id,
      code: item.code,
      title: item.title,
      status: item.status,
      statusLabel: item.statusLabel || BUILD_PIPELINE_STAGES.find((s) => s.id === item.status)?.label || item.status,
      expectedImpact: item.expectedImpact,
      departmentLabels: arr(item.departmentLabels),
      primaryRoute: arr(item.targetRoutes)[0] || '/my-work?tab=radar',
      targetRoutes: arr(item.targetRoutes),
      agentBriefText: item.agentBriefText || '',
    }));

  const gabrielTopAlerts = [
    {
      id: 'alert-margin-erosion',
      code: 'L3 · 마진 침식 방어',
      title: `목표 마진 미달 ${audit.summary.marginErosionAlertCount}품목 즉시 방어 단가 점검`,
      detail: `환율·백상 요율(460원/kg) 변동 반영 시 총이익률 ${audit.summary.unhedgedMarginPct}% → ${audit.summary.simulatedMarginPct}%`,
      impactLabel: formatKrwCompact(
        audit.levers.find((l) => l.code === 'L3')?.profitGainKRW || Math.round(audit.summary.totalPotentialProfitKRW * 0.25)
      ),
      route: '/import/gabriel-agi',
      routeLabel: '가브리엘 단가 방어',
    },
    {
      id: 'alert-awb-zero-unit',
      code: 'L1 · AWB 혼적 · 제로유닛',
      title: `AWB 계단 근접 ${audit.summary.awbTierReadyCount}건 · 입수량 제로유닛 295품목 정비`,
      detail: 'CW>GW 부피중량 편차 혼적 및 SteamOf1Box=0(13,815주문행) 원가 왜곡 차단 대상',
      impactLabel: formatKrwCompact(
        audit.levers.find((l) => l.code === 'L1')?.profitGainKRW || Math.round(audit.summary.totalPotentialProfitKRW * 0.2)
      ),
      route: '/import/freight-calc',
      routeLabel: 'AWB 계산기',
    },
    {
      id: 'alert-fx-credit',
      code: 'L4 · L6 · 송금 · 크레딧',
      title: `미회수 불량 크레딧 ${audit.summary.unrecoveredClaimCount}건 ($${audit.summary.potentialCreditUSD}) · 결제일 미등록 49농장`,
      detail: '15일·25일 외화 송금 전 Claim 상계 게이트 및 분할 환전 스케줄 점검 필요',
      impactLabel: formatKrwCompact(
        (audit.levers.find((l) => l.code === 'L4')?.profitGainKRW || 0) +
          (audit.levers.find((l) => l.code === 'L6')?.profitGainKRW || 0)
      ),
      route: '/sales/defect-deductions',
      routeLabel: '불량차감 · 송금',
    },
  ];

  return {
    generatedAt: str(pmOffice?.serverNow) || new Date().toISOString(),
    metrics: {
      recentCompletedCount,
      activePmTaskCount,
      ownerApprovalCount,
      unresolvedCount: unresolved.length,
      radarApprovalCount: radarSummary.counts.approval,
      buildPipelineCounts: {
        ...stageCounts,
        total: arr(buildPipeline).length,
      },
      weeklyProfitPotentialKRW: audit.summary.totalPotentialProfitKRW,
      weeklyProfitPotentialLabel: `${formatKrwCompact(audit.summary.totalPotentialProfitKRW)}/주`,
      annualizedProfitKRW: audit.summary.annualizedProfitKRW,
      marginShiftLabel: `${audit.summary.unhedgedMarginPct}% → ${audit.summary.simulatedMarginPct}%`,
    },
    timeline: timeline.slice(0, 12),
    buildQueue,
    gabrielTopAlerts,
  };
}

export function buildAgentRosterStatus({
  pmOffice = null,
  staffRequests = [],
  adoptionLedger = null,
  techRadar = null,
  deviceHub = null,
  selfTune = null,
  gabrielAudit = null,
} = {}) {
  const audit = safeGabrielAudit(gabrielAudit);
  const data = pmOffice?.data || {};
  const agents = arr(data.agents);
  const staff = arr(data.staff);
  const tasks = arr(data.tasks);
  const pmAgent = agents.find((a) => a.id === 'pm') || agents[0] || null;
  const ageSec = pmOffice?.ageSec == null ? null : Number(pmOffice.ageSec);
  const pmConnected = ageSec != null && ageSec <= 300 && pmAgent != null;
  const pmWorking = pmConnected && pmAgent.status === 'working';
  const unresolved = pmUnresolved(tasks);
  const openTasks = tasks.filter((t) => !/done|merged|resolved|완료/i.test(str(t?.state)));
  const verifyingTasks = openTasks.filter((t) => /verif|검증/i.test(str(t?.state)));
  const pbSummary = playbookSummary(normalizePlaybooks(data.playbooks));
  const doneTodayCount = arr(data?.pmDetail?.doneToday).length;
  const pendingStaffReqs = arr(staffRequests).filter((r) => !['deployed', 'answered', 'rejected'].includes(str(r?.status)));

  // 2) 운영 PC 카톡 브릿지 워커 신호
  const kakaoTask = tasks.find((t) => /kakao/i.test(str(t?.key)));
  const kakaoNeedsAttention = kakaoTask && !/done|merged/i.test(str(kakaoTask.state));

  // 4) 기술 발굴 · 파일럿 Scout
  const radarItems = normalizeRadarCatalog({ ledger: adoptionLedger, techRadar, adminMode: true });
  const radarSummary = buildWorkbenchSummary(radarItems, true);
  const radarPendingNames = radarSummary.approvalQueue.slice(0, 2).map((x) => x.name);

  // 5) 업무 해독 · 매뉴얼 Orbit
  const decodeIssue = tasks.find((t) => t.key === 'staff-decode-fresh' && !/done/i.test(str(t.state)));
  const activeStaffCount = staff.filter((s) => s.status === 'working').length;
  const workLogCount = arr(data.workLog).length;

  // 6) 멀티디바이스 · Rust 핫패스
  const hasLiveDeviceSnapshot = Boolean(deviceHub && Array.isArray(deviceHub.devices));
  const devices = hasLiveDeviceSnapshot ? deviceHub.devices : [];
  const waitingHumanCount = devices.filter((d) => d.waitingHuman || d.leaseStatus === 'WAITING_HUMAN').length;
  const binarySizeKB = num(deviceHub?.binarySizeKB, 402.5);

  return [
    {
      id: 'pm-hermes',
      rankNo: '01',
      name: 'PM 총괄 · 조사관 에이전트',
      codeName: 'nenova-pm · Hermes Claude↔Codex',
      statusCode: !pmAgent || ageSec == null ? 'offline' : pmWorking ? 'live' : pmConnected ? 'active' : 'stale',
      statusLabel: !pmAgent || ageSec == null ? '수신 대기' : pmWorking ? '실시간 작업중' : pmConnected ? '정상 대기' : '갱신 지연',
      ownerArea: '전 직원 업무·오류 조율, 재발 학습 카드, Claude↔Codex 한도 자동 폴백',
      headlineMetric: `열린 과제 ${openTasks.length}건 · 확인 대기 ${unresolved.length}건 · 검증 ${verifyingTasks.length}건`,
      recentSummary:
        str(data?.pmDetail?.now) ||
        str(pmAgent?.activity) ||
        `오늘 완료 ${doneTodayCount}건 · 미처리 직원 요청 ${pendingStaffReqs.length}건`,
      subStats: [
        { label: '확인 대기', value: `${unresolved.length}건` },
        { label: '학습 카드', value: pbSummary ? `${pbSummary.learned}건` : `${doneTodayCount}건/오늘` },
        { label: '직원 요청', value: `${pendingStaffReqs.length}건` },
      ],
      primaryRoute: '/pm',
      primaryLabel: 'PM 관제 열기',
      secondaryRoute: '/pm?requests=list',
      secondaryLabel: '요청함',
    },
    {
      id: 'nenovakakao-worker',
      rankNo: '02',
      name: '운영 PC 카톡 브릿지 워커',
      codeName: 'nenovakakao moyi-worker · PR #50',
      statusCode: kakaoNeedsAttention ? 'attention' : 'active',
      statusLabel: kakaoNeedsAttention ? '일일보고 점검' : '분리 운영 기준',
      ownerArea: '영업방 5s · 추가취소 300s · 불량 · 수입발주 · 17시 보고 · 5분 자동배포',
      headlineMetric: '영업방 5초 · 추가취소 300초 · 5분 자동배포',
      recentSummary: kakaoNeedsAttention
        ? str(kakaoTask.msg) || '카톡 일일 보고 상태 확인 필요'
        : '개발 PC와 분리된 별도 운영 PC에서 PR #50 별도 계정 승인 후 5분 주기 자동 반영 중입니다.',
      subStats: [
        { label: '영업방 주기', value: '5초' },
        { label: '추가취소', value: '300초' },
        { label: '배포 체계', value: 'PR #50 (5분)' },
      ],
      primaryRoute: '/orders/sales-paste',
      primaryLabel: '카톡 주문확인',
      secondaryRoute: '/orders/kakao-audit',
      secondaryLabel: '변경 검증',
    },
    {
      id: 'gabriel-agi',
      rankNo: '03',
      name: '수입 · 원가 · 이익 추론 에이전트',
      codeName: '가브리엘 Profit AGI · 10대 레버',
      statusCode: audit.summary.costLeakAlertCount > 0 ? 'live' : 'active',
      statusLabel: '실시간 추론',
      ownerArea: '전사 10대 원가·이익 레버(L1~L10) · 환율 스트레스 · 4부서 방어 단가 산출',
      headlineMetric: `기대 이익 ${formatKrwCompact(audit.summary.totalPotentialProfitKRW)}/주 · 경보 ${audit.summary.costLeakAlertCount}건`,
      recentSummary: `상위 경보: 마진침식 ${audit.summary.marginErosionAlertCount}품목 · AWB 계단 근접 ${audit.summary.awbTierReadyCount}건 · 미회수 크레딧 $${audit.summary.potentialCreditUSD}`,
      subStats: [
        { label: '마진침식', value: `${audit.summary.marginErosionAlertCount}품목` },
        { label: 'AWB 혼적', value: `${audit.summary.awbTierReadyCount}건` },
        { label: '크레딧', value: `$${audit.summary.potentialCreditUSD}` },
      ],
      primaryRoute: '/import/gabriel-agi',
      primaryLabel: '가브리엘 AGI',
      secondaryRoute: '/import/pipeline',
      secondaryLabel: '원스톱',
    },
    {
      id: 'tech-radar-pilot',
      rankNo: '04',
      name: '기술 발굴 · 실측 파일럿 에이전트',
      codeName: 'Tech Radar Scout & Pilot',
      statusCode: radarSummary.counts.approval > 0 ? 'attention' : 'active',
      statusLabel: radarSummary.counts.approval > 0 ? `결재 대기 ${radarSummary.counts.approval}건` : '탐색 정상',
      ownerArea: 'GitHub 신규 기술 탐색(월·목) · 격리 파일럿 벤치마크 · 채택 안건 상정',
      headlineMetric: `누적 ${radarSummary.counts.total}건 · 파일럿 실측 ${radarSummary.pilotMeasuredCount}건 · 채택 ${radarSummary.counts.adopt}건`,
      recentSummary: radarPendingNames.length
        ? `채택 결재 대기: ${radarPendingNames.join(', ')}${selfTune?.summary ? ` · 자가점검 ${selfTune.summary}` : ''}`
        : 'apache/echarts · headroom 등 실측 보고서 기반 채택 결재 대기 안건을 관리합니다.',
      subStats: [
        { label: '누적 기술', value: `${radarSummary.counts.total}건` },
        { label: '파일럿 실측', value: `${radarSummary.pilotMeasuredCount}건` },
        { label: '결재 대기', value: `${radarSummary.counts.approval}건` },
      ],
      primaryRoute: '/my-work?tab=radar',
      primaryLabel: '도입 레이더',
      secondaryRoute: '/pm/radar',
      secondaryLabel: '레이더 보드',
    },
    {
      id: 'orbit-manuals',
      rankNo: '05',
      name: '업무 해독 · 매뉴얼 진화 에이전트',
      codeName: 'Orbit · Manuals Insights',
      statusCode: decodeIssue ? 'attention' : 'active',
      statusLabel: decodeIssue ? '해독 지연 확인' : '매뉴얼 동기화',
      ownerArea: '부서별 업무 흐름 해독 · 라이브 파이프라인 · 신입 루틴 사각지대 보완',
      headlineMetric: `직원 ${staff.length || 11}명 계보 · 활성 ${activeStaffCount}명 · 로그 ${workLogCount}건`,
      recentSummary: decodeIssue
        ? str(decodeIssue.msg) || '일부 PC 화면 해독 지연 점검 중'
        : '전산 저장 기록과 실제 화면 흐름을 맞춰 부서별 매뉴얼 및 신입 루틴을 자동 보완합니다.',
      subStats: [
        { label: '등록 직원', value: `${staff.length || 11}명` },
        { label: '작업중', value: `${activeStaffCount}명` },
        { label: '매뉴얼 상태', value: decodeIssue ? '점검필요' : '정상' },
      ],
      primaryRoute: '/work/manuals',
      primaryLabel: '매뉴얼 열기',
      secondaryRoute: '/admin/orbit-report',
      secondaryLabel: '심화리포트',
    },
    {
      id: 'device-rust-sidecar',
      rankNo: '06',
      name: '멀티디바이스 · Rust 핫패스 사이드카',
      codeName: 'Phone Harness · hermes-core.exe',
      statusCode: waitingHumanCount > 0 ? 'attention' : hasLiveDeviceSnapshot ? 'live' : 'spec',
      statusLabel: waitingHumanCount > 0 ? `원격 해제 대기 ${waitingHumanCount}대` : hasLiveDeviceSnapshot ? '단말 연결됨' : '기준 스펙',
      ownerArea: '402.5KB 정적 사이드카 · 0.007ms 송금/삭제 킬스위치 · 4.35x 로그 압축',
      headlineMetric: `${binarySizeKB}KB 바이너리 · 0.007ms 차단 · 4.35x 압축`,
      recentSummary: hasLiveDeviceSnapshot
        ? `연결 단말 ${devices.length}대 · WAITING_HUMAN ${waitingHumanCount}대 (Read-Only 가드 활성)`
        : '단말 실시간 업로드 전 기준 스펙 표시 — 위챗·야간·12장 초과 사진 보조수집 및 JS Fallback 유지',
      subStats: [
        { label: '바이너리', value: `${binarySizeKB}KB` },
        { label: '킬스위치', value: '0.007ms' },
        { label: '로그 압축', value: '4.35x (-91.3%)' },
      ],
      primaryRoute: '/my-work?tab=devices',
      primaryLabel: '디바이스 허브',
      secondaryRoute: '/my-work?tab=suite-sim',
      secondaryLabel: '시뮬레이션',
    },
  ];
}

export function buildCommandHubModel(inputs = {}) {
  const gabrielAudit = safeGabrielAudit(inputs.gabrielAudit);
  const pulse = buildDevelopmentPulse({ ...inputs, gabrielAudit });
  const agents = buildAgentRosterStatus({ ...inputs, gabrielAudit });
  const ledger = buildPmActionLedger(inputs);

  return {
    pulse,
    agents,
    ledger,
    checklist: MORNING_CHECKLIST,
    directory: CEO_PAGE_DIRECTORY,
    gabrielScope: gabrielAudit.scope,
  };
}
