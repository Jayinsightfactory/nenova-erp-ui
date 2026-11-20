// components/work/CeoCommandHub.js
// 사장님 전용 통합 지휘실 UI (/work/command-hub).
// 한 페이지에서 PM 업무·결재, 6대 에이전트 현황, 연속 디벨롭 펄스, 가브리엘 원가 경보, 4대 목적별 전체 화면 지도를 확인한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import WorkflowGuide from '../WorkflowGuide';
import PurposeFlowTrace from './PurposeFlowTrace';
import {
  buildCommandHubModel,
  filterPmActionLedger,
} from '../../lib/ceoCommandHub';
import styles from '../../styles/CeoCommandHub.module.css';

const LEDGER_TABS = [
  { id: 'approval', label: '사장님 결재 대기' },
  { id: 'active', label: '에이전트 진행·검증중' },
  { id: 'done', label: '최근 머지·완료' },
  { id: 'all', label: '전체' },
];

const BUILD_STAGE_FILTERS = [
  { id: 'ALL', label: '전체 큐' },
  { id: 'LIVE', label: '실전가동 LIVE' },
  { id: 'PILOT', label: '파일럿 PILOT' },
  { id: 'READY', label: '즉시구현 READY' },
  { id: 'DISCOVERED', label: '신규발굴 DISCOVERED' },
];

function formatKstTime(iso) {
  const ts = Date.parse(iso || '');
  if (!Number.isFinite(ts)) return '-';
  const kst = new Date(ts + 9 * 3600 * 1000);
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const hh = String(kst.getUTCHours()).padStart(2, '0');
  const mm = String(kst.getUTCMinutes()).padStart(2, '0');
  const ss = String(kst.getUTCSeconds()).padStart(2, '0');
  return `${m}-${d} ${hh}:${mm}:${ss} KST`;
}

function badgeClassByStatus(statusCode) {
  if (statusCode === 'live' || statusCode === 'LIVE' || statusCode === 'ok') return styles.badgeLive;
  if (statusCode === 'active' || statusCode === 'PILOT' || statusCode === 'info') return styles.badgeActive;
  if (statusCode === 'attention' || statusCode === 'READY' || statusCode === 'warn') return styles.badgeWarn;
  if (statusCode === 'stale' || statusCode === 'offline' || statusCode === 'err') return styles.badgeErr;
  if (statusCode === 'spec' || statusCode === 'DISCOVERED') return styles.badgeSpec;
  return styles.badge;
}

async function fetchJsonSafe(url, signal) {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body;
}

export default function CeoCommandHub({
  userId = '',
  initialSyncedAt = '',
  initialPmOffice = null,
  initialStaffRequests = [],
  initialAdoptionLedger = null,
  initialTechRadar = null,
  initialDeviceHub = null,
  initialSelfTune = null,
  initialOwnerTwin = null,
}) {
  const [pmOffice, setPmOffice] = useState(initialPmOffice);
  const [staffRequests, setStaffRequests] = useState(
    Array.isArray(initialStaffRequests) ? initialStaffRequests : []
  );
  const [adoptionLedger, setAdoptionLedger] = useState(initialAdoptionLedger);
  const [techRadar, setTechRadar] = useState(initialTechRadar);
  const [deviceHub, setDeviceHub] = useState(initialDeviceHub);
  const [selfTune, setSelfTune] = useState(initialSelfTune);
  const [ownerTwinData, setOwnerTwinData] = useState(initialOwnerTwin);

  const [lastSyncedAt, setLastSyncedAt] = useState(initialSyncedAt || '');
  const [refreshing, setRefreshing] = useState(false);
  const [syncWarning, setSyncWarning] = useState('');

  const [activeLoopStep, setActiveLoopStep] = useState('alignment-audit');
  const [pillarFilter, setPillarFilter] = useState('ALL');
  const [copiedTwinProposal, setCopiedTwinProposal] = useState(null);
  const [twinCopyNotice, setTwinCopyNotice] = useState('');

  const [ledgerTab, setLedgerTab] = useState('all');
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [buildStageFilter, setBuildStageFilter] = useState('ALL');
  const [copiedBrief, setCopiedBrief] = useState(null);
  const [copyNotice, setCopyNotice] = useState('');

  const ledgerTabRefs = useRef([]);
  const briefTriggerRef = useRef(null);
  const twinBriefTriggerRef = useRef(null);

  const model = useMemo(
    () =>
      buildCommandHubModel({
        pmOffice,
        staffRequests,
        adoptionLedger,
        techRadar,
        deviceHub,
        selfTune,
        ownerTwin: ownerTwinData,
      }),
    [pmOffice, staffRequests, adoptionLedger, techRadar, deviceHub, selfTune, ownerTwinData]
  );

  // 초기에 결재 대기가 있으면 기본 탭을 결재 대기로 자연스럽게 맞춘다(사용자가 탭을 누르기 전 기준)
  const userTouchedTabRef = useRef(false);
  const effectiveLedgerTab = useMemo(() => {
    if (userTouchedTabRef.current) return ledgerTab;
    const approvalCount = model.ledger.filter((r) => r.bucket === 'approval').length;
    return approvalCount > 0 ? 'approval' : 'all';
  }, [ledgerTab, model.ledger]);

  const ledgerCounts = useMemo(() => {
    const counts = { approval: 0, active: 0, done: 0, all: model.ledger.length };
    for (const row of model.ledger) {
      if (counts[row.bucket] !== undefined) counts[row.bucket] += 1;
    }
    return counts;
  }, [model.ledger]);

  const filteredLedger = useMemo(
    () => filterPmActionLedger(model.ledger, effectiveLedgerTab, ledgerQuery),
    [model.ledger, effectiveLedgerTab, ledgerQuery]
  );

  const filteredBuildQueue = useMemo(() => {
    if (buildStageFilter === 'ALL') return model.pulse.buildQueue;
    return model.pulse.buildQueue.filter((item) => item.status === buildStageFilter);
  }, [model.pulse.buildQueue, buildStageFilter]);

  const loadLive = useCallback(async ({ signal } = {}) => {
    setRefreshing(true);
    setSyncWarning('');
    const results = await Promise.allSettled([
      fetchJsonSafe('/api/pm/office', signal),
      fetchJsonSafe('/api/pm/staff-requests', signal),
      fetchJsonSafe('/api/my-work/feature?name=adoption-ledger', signal),
      fetchJsonSafe('/api/my-work/feature?name=tech-radar', signal),
      fetchJsonSafe('/api/my-work/feature?name=device-hub-status', signal),
      fetchJsonSafe('/api/my-work/feature?name=self-tune-report', signal),
      fetchJsonSafe('/api/my-work/feature?name=owner-twin', signal),
    ]);

    if (signal?.aborted) return;

    const [pmRes, reqRes, ledgerRes, radarRes, deviceRes, tuneRes, twinRes] = results;
    let failedCount = 0;

    if (pmRes.status === 'fulfilled') setPmOffice(pmRes.value);
    else failedCount += 1;

    if (reqRes.status === 'fulfilled') {
      setStaffRequests(Array.isArray(reqRes.value.requests) ? reqRes.value.requests : []);
    } else failedCount += 1;

    if (ledgerRes.status === 'fulfilled' && ledgerRes.value.data) {
      setAdoptionLedger(ledgerRes.value.data);
    }
    if (radarRes.status === 'fulfilled' && radarRes.value.data) {
      setTechRadar(radarRes.value.data);
    }
    if (deviceRes.status === 'fulfilled' && deviceRes.value.data) {
      setDeviceHub(deviceRes.value.data);
    }
    if (tuneRes.status === 'fulfilled' && tuneRes.value.data) {
      setSelfTune(tuneRes.value.data);
    }
    if (twinRes.status === 'fulfilled' && twinRes.value.data) {
      setOwnerTwinData(twinRes.value.data);
    }

    if (failedCount >= 2) {
      setSyncWarning('실시간 PM 피드 일부를 다시 읽지 못했습니다. 직전 스냅샷을 유지합니다.');
    }
    setLastSyncedAt(new Date().toISOString());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLive({ signal: controller.signal });
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        void loadLive({ signal: controller.signal });
      }
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [loadLive]);

  useEffect(() => {
    if (!copiedBrief && !copiedTwinProposal) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (copiedTwinProposal) {
          setTwinCopyNotice('');
          setCopiedTwinProposal(null);
          twinBriefTriggerRef.current?.focus();
        }
        if (copiedBrief) {
          setCopyNotice('');
          setCopiedBrief(null);
          briefTriggerRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copiedBrief, copiedTwinProposal]);

  const handleSelectLoopStep = (step) => {
    if (!step?.id) return;
    setActiveLoopStep(step.id);
    if (step.targetId && typeof document !== 'undefined') {
      const el = document.getElementById(step.targetId);
      if (el) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    }
  };

  const handleCopyTwinProposal = async (proposal, event) => {
    twinBriefTriggerRef.current = event?.currentTarget || null;
    setCopiedTwinProposal(proposal);
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(proposal.agentBriefText);
        copied = true;
      }
    } catch {
      copied = false;
    }
    setTwinCopyNotice(
      copied
        ? `[${proposal.code} · ${proposal.goalId}] 작업 지시서를 클립보드에 복사했습니다.`
        : `[${proposal.code} · ${proposal.goalId}] 작업 지시서를 아래 상자에 열었습니다.`
    );
  };

  const handleSelectLedgerTab = (tabId) => {
    userTouchedTabRef.current = true;
    setLedgerTab(tabId);
  };

  const handleTabKeyDown = (event, idx) => {
    const count = LEDGER_TABS.length;
    let nextIdx = null;
    if (event.key === 'ArrowRight') nextIdx = (idx + 1) % count;
    else if (event.key === 'ArrowLeft') nextIdx = (idx - 1 + count) % count;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = count - 1;
    if (nextIdx == null) return;
    event.preventDefault();
    const target = LEDGER_TABS[nextIdx];
    handleSelectLedgerTab(target.id);
    ledgerTabRefs.current[nextIdx]?.focus();
  };

  const handleChecklistJump = (step) => {
    if (step.ledgerFilter) {
      userTouchedTabRef.current = true;
      setLedgerTab(step.ledgerFilter);
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById(step.targetId);
      if (el) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    }
  };

  const handleCopyBrief = async (item, event) => {
    briefTriggerRef.current = event?.currentTarget || null;
    setCopiedBrief(item);
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(item.agentBriefText);
        copied = true;
      }
    } catch {
      copied = false;
    }
    setCopyNotice(
      copied
        ? `[${item.code}] 구현 지시서를 클립보드에 복사했습니다.`
        : `[${item.code}] 구현 지시서를 아래 상자에 열었습니다.`
    );
  };

  const { pulse, agents, checklist, directory, ownerTwin } = model;
  const { metrics } = pulse;

  const visiblePillars = useMemo(() => {
    if (pillarFilter === 'ALL') return ownerTwin.pillars;
    return ownerTwin.pillars.filter((p) => p.id === pillarFilter);
  }, [ownerTwin.pillars, pillarFilter]);

  return (
    <main className={styles.hub} data-testid="ceo-command-hub">
      {/* 1. 최상단: 핵심 목적 & 상시 3중 병렬 AGI 루프 트레이스 도면 + 연속 디벨롭 맥박 스트립 */}
      <section className={styles.headerPanel} aria-label="사장님 통합 지휘실 요약">
        <div className={styles.headerTop}>
          <div className={styles.titleArea}>
            <div className={styles.eyebrow}>
              NENOVA COMMAND HUB · {userId || 'nenovaSS3'} 전용 · 읽기 전용 관제
            </div>
            <h1 className={styles.hubTitle} data-desktop-chrome>
              사장님 통합 지휘실 (내 목표 · 작업 정합성 · Owner AGI · 에이전트)
            </h1>
            <p className={styles.hubSubtitle}>
              사장님 목표(g01~g19) 동기화, 에이전트 작업 목표정합성 감사, 나를 학습한 AGI 진화와 PM 결재·6대 에이전트·가브리엘 원가 경보를 한 화면에서 지휘합니다.
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={`${styles.syncText} ${styles.tnum}`} data-testid="hub-sync-time">
              기준 시각 {formatKstTime(lastSyncedAt || pulse.generatedAt)}
            </span>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void loadLive()}
              disabled={refreshing}
              data-testid="hub-refresh-btn"
            >
              {refreshing ? '새로고침 중…' : '실시간 새로고침'}
            </button>
            <Link href="/pm" className={styles.linkBtn}>
              PM 사무실 열기
            </Link>
            <Link href="/my-work?tab=radar" className={styles.linkBtn}>
              도입 레이더 열기
            </Link>
          </div>
        </div>

        {/* 최상단 목적 콜아웃 & 상시 3중 병렬 AGI 5단계 실시간 트레이스 모션 도면 */}
        <div className={styles.traceWrap}>
          <PurposeFlowTrace
            testId="ceo-agi-loop-trace"
            title="상시 3중 병렬 AGI 루프 실시간 트레이스 도면 (01 → 05)"
            purpose={ownerTwin.purpose}
            steps={ownerTwin.traceSteps}
            activeId={activeLoopStep}
            onSelectStep={handleSelectLoopStep}
            busLabel="목표 동기화 · 정합 감사 · 재학습 순환"
            initialWidth={1280}
          />
        </div>

        {/* 4대 핵심 정량 진척 KPI 스트립 */}
        <div className={styles.kpiStrip} data-testid="hub-kpi-strip">
          <div className={styles.kpiCell}>
            <div className={styles.kpiLabel}>최근 완결 기능 · PR</div>
            <div className={styles.kpiValueRow}>
              <strong className={`${styles.kpiValue} ${styles.tnum}`}>
                {metrics.recentCompletedCount}건
              </strong>
              <span className={styles.badgeLive}>연속 배포중</span>
            </div>
            <div className={styles.kpiMeta}>
              최근 PR·PM 완료 내역 실시간 병합
            </div>
            <button
              type="button"
              className={styles.kpiActionBtn}
              onClick={() => handleChecklistJump({ targetId: 'hub-dev-timeline' })}
            >
              디벨롭 타임라인 보기 →
            </button>
          </div>

          <div className={styles.kpiCell}>
            <div className={styles.kpiLabel}>PM 진행 · 검증 과제</div>
            <div className={styles.kpiValueRow}>
              <strong className={`${styles.kpiValue} ${styles.tnum}`}>
                {metrics.activePmTaskCount}건
              </strong>
              <span className={styles.badgeActive}>조사·검증중</span>
            </div>
            <div className={styles.kpiMeta}>
              6대 에이전트가 현재 처리 중인 열린 과제
            </div>
            <button
              type="button"
              className={styles.kpiActionBtn}
              onClick={() =>
                handleChecklistJump({ targetId: 'hub-pm-ledger', ledgerFilter: 'active' })
              }
            >
              진행 과제 보기 →
            </button>
          </div>

          <div className={styles.kpiCell}>
            <div className={styles.kpiLabel}>사장님 결재 · 확인 대기</div>
            <div className={styles.kpiValueRow}>
              <strong
                className={`${styles.kpiValue} ${styles.tnum} ${
                  metrics.ownerApprovalCount > 0 ? styles.kpiValueWarn : styles.kpiValueOk
                }`}
              >
                {metrics.ownerApprovalCount}건
              </strong>
              <span className={metrics.ownerApprovalCount > 0 ? styles.badgeWarn : styles.badgeLive}>
                {metrics.ownerApprovalCount > 0 ? '확인 필요' : '대기 0건'}
              </span>
            </div>
            <div className={styles.kpiMeta}>
              PM 확인 {metrics.unresolvedCount}건 · 기술 결재 {metrics.radarApprovalCount}건 포함
            </div>
            <button
              type="button"
              className={styles.kpiActionBtn}
              onClick={() =>
                handleChecklistJump({ targetId: 'hub-pm-ledger', ledgerFilter: 'approval' })
              }
            >
              결재 대기만 보기 →
            </button>
          </div>

          <div className={styles.kpiCell}>
            <div className={styles.kpiLabel}>가브리엘 10대 레버 주간 기대이익</div>
            <div className={styles.kpiValueRow}>
              <strong className={`${styles.kpiValue} ${styles.kpiValueOk} ${styles.tnum}`}>
                {metrics.weeklyProfitPotentialLabel}
              </strong>
              <span className={styles.badge}>
                총이익률 {metrics.marginShiftLabel}
              </span>
            </div>
            <div className={`${styles.kpiMeta} ${styles.tnum}`}>
              연속구현 큐: LIVE {metrics.buildPipelineCounts.LIVE} · PILOT {metrics.buildPipelineCounts.PILOT} · READY {metrics.buildPipelineCounts.READY} · 발굴 {metrics.buildPipelineCounts.DISCOVERED}
            </div>
            <Link href="/import/gabriel-agi" className={styles.kpiActionBtn}>
              가브리엘 AGI 열기 →
            </Link>
          </div>
        </div>

        {/* 아침 1분 점검 코스 가이드 */}
        <div className={styles.checklistBar} role="navigation" aria-label="아침 1분 점검 코스">
          {checklist.map((step) => (
            <button
              key={step.id}
              type="button"
              className={styles.checklistStep}
              onClick={() => handleChecklistJump(step)}
              data-testid={`checklist-${step.id}`}
            >
              <span className={styles.checklistTitle}>{step.title}</span>
              <span className={styles.checklistDesc}>{step.desc}</span>
            </button>
          ))}
        </div>

        {syncWarning && (
          <div className={styles.noticeBanner} role="status">
            {syncWarning}
          </div>
        )}

        <div className={styles.guideWrap}>
          <WorkflowGuide workflowId="ceo-command-hub" initialRole="사장님" />
        </div>
      </section>

      {/* 1.5. 핵심 신설 섹션: 내 목표 × 작업 정합도 × 나를 학습한 AGI (Owner Digital Twin) 3중 상시 관제 보드 */}
      <section
        className={styles.panel}
        id="hub-owner-twin-board"
        data-testid="ceo-owner-twin-board"
        aria-labelledby="owner-twin-heading"
      >
        <div className={styles.panelHeader}>
          <div>
            <h2 id="owner-twin-heading" className={styles.sectionTitle}>
              내 목표 × 작업 정합도 × 나를 학습한 AGI (Owner Digital Twin)
            </h2>
            <p className={styles.sectionSub}>
              사장님 목표(g01~g19) 달성률, 현행 에이전트 작업의 1:1 목표 정합성 감사, 6대 의사결정 DNA와 선제 실행 제안 Top 5를 상시 동기화합니다.
            </p>
          </div>
          <div className={styles.twinHeaderBadges}>
            <span className={ownerTwin.hasLiveTwin ? styles.badgeLive : styles.badgeActive}>
              {ownerTwin.dataModeLabel}
            </span>
            <span className={`${styles.badge} ${styles.tnum}`}>
              목표 {ownerTwin.summary.totalGoalCount}개 · 정합률 {ownerTwin.summary.alignmentRatePct}%
            </span>
          </div>
        </div>

        {/* 3중 관제 요약 스트립 */}
        <div className={styles.twinSummaryStrip}>
          <div className={styles.twinSummaryCell}>
            <span className={styles.twinSummaryLabel}>전사 목표 평균 달성률</span>
            <div className={styles.twinSummaryRow}>
              <strong className={`${styles.twinSummaryVal} ${styles.tnum}`}>
                {ownerTwin.summary.overallGoalProgress}%
              </strong>
              <span className={`${styles.badgeActive} ${styles.tnum}`}>
                완료 {ownerTwin.summary.doneGoalCount}/{ownerTwin.summary.totalGoalCount}
              </span>
            </div>
            <span className={`${styles.twinSummaryMeta} ${styles.tnum}`}>
              4대 전략 축 · 승인 대기 {ownerTwin.summary.approvalGoalCount}건
            </span>
          </div>

          <div className={styles.twinSummaryCell}>
            <span className={styles.twinSummaryLabel}>전사 작업 목표 정합률</span>
            <div className={styles.twinSummaryRow}>
              <strong
                className={`${styles.twinSummaryVal} ${styles.tnum} ${
                  ownerTwin.summary.driftCount === 0 ? styles.kpiValueOk : styles.kpiValueWarn
                }`}
              >
                {ownerTwin.summary.alignmentRatePct}%
              </strong>
              <span className={ownerTwin.summary.driftCount === 0 ? styles.badgeLive : styles.badgeWarn}>
                Drift {ownerTwin.summary.driftCount}건
              </span>
            </div>
            <span className={`${styles.twinSummaryMeta} ${styles.tnum}`}>
              감사 대상 {ownerTwin.alignmentAudit.totalAuditedCount}건 · 공백 경보 {ownerTwin.summary.gapAlertCount}건
            </span>
          </div>

          <div className={styles.twinSummaryCell}>
            <span className={styles.twinSummaryLabel}>Owner AGI 학습 성숙도</span>
            <div className={styles.twinSummaryRow}>
              <strong className={`${styles.twinSummaryVal} ${styles.tnum}`}>
                {ownerTwin.summary.maturityScore}점
              </strong>
              <span className={`${styles.badgeLive} ${styles.tnum}`}>
                학습 신호 {ownerTwin.summary.learnedSignalsCount}건
              </span>
            </div>
            <span className={styles.twinSummaryMeta}>
              6대 의사결정 DNA · 전역 지침 §8 상시 축적
            </span>
          </div>

          <div className={styles.twinSummaryCell}>
            <span className={styles.twinSummaryLabel}>선제 실행 제안 기대 효과</span>
            <div className={styles.twinSummaryRow}>
              <strong className={`${styles.twinSummaryValOk} ${styles.tnum}`}>
                {ownerTwin.summary.fixedCostSavingsLabel}
              </strong>
            </div>
            <span className={`${styles.twinSummaryMeta} ${styles.tnum}`}>
              ROI·안전 최우선 Top {ownerTwin.summary.proactiveCount} 원클릭 발주
            </span>
          </div>
        </div>

        {/* 1단: [축 1 · 내 목표 & 실시간 달성률] + [축 2 · 목표 정합성 감사] */}
        <div className={styles.twinTopGrid}>
          {/* 축 1: Goal Ledger */}
          <div className={styles.twinAxisBox} id="owner-twin-goal-ledger" data-testid="owner-twin-goal-ledger">
            <div className={styles.twinAxisHead}>
              <div>
                <div className={styles.twinAxisEyebrow}>축 1 · GOAL LEDGER</div>
                <h3 className={styles.twinAxisTitle}>내 목표 &amp; 4대 전략 축 실시간 달성률</h3>
              </div>
              <span className={`${styles.badge} ${styles.tnum}`}>
                g01~g{ownerTwin.summary.totalGoalCount}
              </span>
            </div>

            <div className={styles.stageFilterRow} role="group" aria-label="전략 축 필터">
              <button
                type="button"
                aria-pressed={pillarFilter === 'ALL'}
                className={styles.stageBtn}
                onClick={() => setPillarFilter('ALL')}
                data-testid="pillar-filter-ALL"
              >
                전체 4대 축 ({ownerTwin.summary.totalGoalCount})
              </button>
              {ownerTwin.pillars.map((pillar) => (
                <button
                  key={pillar.id}
                  type="button"
                  aria-pressed={pillarFilter === pillar.id}
                  className={styles.stageBtn}
                  onClick={() => setPillarFilter(pillar.id)}
                  data-testid={`pillar-filter-${pillar.id}`}
                >
                  {pillar.orderLabel} ({pillar.avgProgress}%)
                </button>
              ))}
            </div>

            <div
              className={
                pillarFilter === 'ALL' ? styles.pillarGrid : styles.pillarGridSingle
              }
            >
              {visiblePillars.map((pillar) => (
                <article key={pillar.id} className={styles.pillarCard} data-testid={`pillar-card-${pillar.id}`}>
                  <div className={styles.pillarTop}>
                    <div>
                      <div className={styles.pillarOrder}>{pillar.orderLabel}</div>
                      <h4 className={styles.pillarTitle}>{pillar.title}</h4>
                    </div>
                    <strong className={`${styles.pillarPct} ${styles.tnum}`}>
                      {pillar.avgProgress}%
                    </strong>
                  </div>
                  <div className={styles.progressTrack} aria-hidden="true">
                    <div
                      className={
                        pillar.avgProgress >= 75
                          ? styles.progressFillOk
                          : pillar.avgProgress >= 35
                            ? styles.progressFillInfo
                            : styles.progressFillWarn
                      }
                      style={{ width: `${pillar.avgProgress}%` }}
                    />
                  </div>
                  <ul className={styles.goalList}>
                    {pillar.goals.map((goal) => (
                      <li key={goal.id} className={styles.goalRow}>
                        <div className={styles.goalRowTop}>
                          <span className={`${styles.goalCode} ${styles.tnum}`}>{goal.id}</span>
                          <span className={styles.goalTitle}>{goal.title}</span>
                          <span className={badgeClassByStatus(goal.tone)}>{goal.stateLabel}</span>
                        </div>
                        <div className={styles.goalRowBottom}>
                          <div className={styles.goalMiniBarWrap}>
                            <div className={styles.progressTrackSm} aria-hidden="true">
                              <div
                                className={
                                  goal.progress >= 80
                                    ? styles.progressFillOk
                                    : goal.progress >= 30
                                      ? styles.progressFillInfo
                                      : styles.progressFillWarn
                                }
                                style={{ width: `${goal.progress}%` }}
                              />
                            </div>
                            <span className={`${styles.goalPctText} ${styles.tnum}`}>{goal.progress}%</span>
                          </div>
                          <span className={styles.goalLinkedTag}>{goal.recentLinked}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>

          {/* 축 2: Goal Alignment Audit */}
          <div className={styles.twinAxisBox} id="owner-twin-alignment-audit" data-testid="owner-twin-alignment-audit">
            <div className={styles.twinAxisHead}>
              <div>
                <div className={styles.twinAxisEyebrow}>축 2 · GOAL ALIGNMENT AUDIT</div>
                <h3 className={styles.twinAxisTitle}>목표에 맞게 작업되고 있는가? (1:1 매핑 감사)</h3>
              </div>
              <span
                className={
                  ownerTwin.alignmentAudit.driftCount === 0 ? styles.badgeLive : styles.badgeWarn
                }
              >
                정합률 {ownerTwin.alignmentAudit.alignmentRatePct}% · Drift {ownerTwin.alignmentAudit.driftCount}건
              </span>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.ledgerTable} data-testid="owner-twin-alignment-table">
                <thead>
                  <tr>
                    <th style={{ width: 138 }}>작업 · 에이전트</th>
                    <th>진행 내용</th>
                    <th style={{ width: 184 }}>전진 목표 (g01~g19)</th>
                    <th style={{ width: 90 }}>판정</th>
                  </tr>
                </thead>
                <tbody>
                  {ownerTwin.alignmentAudit.mappings.map((row) => (
                    <tr key={row.workId}>
                      <td>
                        <div className={styles.ledgerTrack}>{row.workSource}</div>
                      </td>
                      <td>
                        <div className={styles.alignmentWorkTitle}>{row.workTitle}</div>
                      </td>
                      <td>
                        <div className={styles.alignmentGoalLine}>
                          <span className={`${styles.goalCode} ${styles.tnum}`}>{row.goalId}</span>
                          <span className={styles.alignmentGoalName}>{row.pillarLabel}</span>
                        </div>
                        <div className={styles.alignmentGoalDesc}>{row.goalTitle}</div>
                      </td>
                      <td>
                        <span className={row.aligned ? styles.badgeLive : styles.badgeWarn}>
                          {row.aligned ? row.statusLabel : '이탈 점검'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 손길이 더 필요한 목표 공백 경보 */}
            <div className={styles.gapAlertSection} data-testid="owner-twin-gap-alerts">
              <div className={styles.gapAlertHeader}>
                <h4 className={styles.subBlockTitle}>손길이 더 필요한 목표 공백 경보</h4>
                <span className={`${styles.badgeWarn} ${styles.tnum}`}>
                  우선 보강 {ownerTwin.alignmentAudit.gapAlerts.length}건
                </span>
              </div>
              <div className={styles.gapAlertList}>
                {ownerTwin.alignmentAudit.gapAlerts.map((gap) => (
                  <article
                    key={gap.id}
                    className={
                      gap.severity === 'high' ? styles.gapAlertRowHigh : styles.gapAlertRow
                    }
                  >
                    <div className={styles.gapAlertBody}>
                      <div className={styles.gapAlertMeta}>
                        <span className={`${styles.goalCode} ${styles.tnum}`}>{gap.goalId}</span>
                        <strong className={styles.gapAlertTitle}>{gap.title}</strong>
                      </div>
                      <div className={styles.gapAlertDetail}>{gap.detail}</div>
                    </div>
                    <span className={styles.badge}>{gap.nextAction}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 2단: [축 3 · 나를 학습한 AGI 진화 현황 (6대 의사결정 DNA + 선제 실행 제안 Top 5)] */}
        <div className={styles.twinBottomGrid} id="owner-twin-persona" data-testid="owner-twin-persona">
          {/* 좌측: 6대 의사결정 DNA 원칙 카드 */}
          <div className={styles.twinAxisBox}>
            <div className={styles.twinAxisHead}>
              <div>
                <div className={styles.twinAxisEyebrow}>축 3 · OWNER PERSONA DIGITAL TWIN</div>
                <h3 className={styles.twinAxisTitle}>나를 학습한 AGI · 6대 의사결정 DNA 원칙</h3>
              </div>
              <span className={`${styles.badgeLive} ${styles.tnum}`}>
                성숙도 {ownerTwin.persona.maturityScore}/100
              </span>
            </div>

            <div className={styles.maturityBarRow}>
              <span className={styles.maturityLabel}>사장님 판단 DNA 학습 진도</span>
              <div className={styles.progressTrack} aria-hidden="true">
                <div
                  className={styles.progressFillOk}
                  style={{ width: `${ownerTwin.persona.maturityScore}%` }}
                />
              </div>
              <span className={`${styles.maturityVal} ${styles.tnum}`}>
                {ownerTwin.persona.maturityScore}% ({ownerTwin.persona.learnedSignalsCount}신호)
              </span>
            </div>

            <div className={styles.dnaGrid} data-testid="owner-twin-dna-grid">
              {ownerTwin.persona.principles.map((dna) => (
                <article key={dna.id} className={styles.dnaCard} data-testid={`dna-card-${dna.id}`}>
                  <div className={styles.dnaCardTop}>
                    <span className={`${styles.dnaCode} ${styles.tnum}`}>{dna.id}</span>
                    <strong className={styles.dnaTitle}>{dna.title}</strong>
                    <span className={`${styles.dnaSignal} ${styles.tnum}`}>학습 {dna.signals}건</span>
                  </div>
                  <p className={styles.dnaRule}>{dna.rule}</p>
                  <div className={styles.dnaEvidence}>근거: {dna.evidence}</div>
                </article>
              ))}
            </div>
          </div>

          {/* 우측: 나를 학습한 AGI의 선제 실행 제안 Top 5 */}
          <div className={styles.twinAxisBox} id="owner-twin-proposals" data-testid="owner-twin-proposals">
            <div className={styles.twinAxisHead}>
              <div>
                <div className={styles.twinAxisEyebrow}>PROACTIVE EXECUTION · TOP 5</div>
                <h3 className={styles.twinAxisTitle}>나를 학습한 AGI의 선제 실행 제안 Top 5</h3>
              </div>
              <span className={`${styles.badgeActive} ${styles.tnum}`}>
                원클릭 지시서 발주
              </span>
            </div>

            {copiedTwinProposal && (
              <div className={styles.briefDrawer} role="region" aria-label="선제 실행 작업 지시서">
                <div className={styles.briefDrawerHead}>
                  <strong>
                    [{copiedTwinProposal.code} · {copiedTwinProposal.goalId}] 작업 지시서 원문
                  </strong>
                  <button
                    type="button"
                    className={styles.btnSm}
                    onClick={() => {
                      setTwinCopyNotice('');
                      setCopiedTwinProposal(null);
                      twinBriefTriggerRef.current?.focus();
                    }}
                  >
                    닫기 (Esc)
                  </button>
                </div>
                {twinCopyNotice && (
                  <div
                    className={styles.copyNotice}
                    role="status"
                    data-testid="twin-copy-notice"
                    style={{ marginBottom: 8 }}
                  >
                    {twinCopyNotice}
                  </div>
                )}
                <pre className={styles.briefPre}>{copiedTwinProposal.agentBriefText}</pre>
              </div>
            )}

            <div className={styles.proposalList}>
              {ownerTwin.proactiveProposals.map((proposal) => (
                <article
                  key={proposal.id}
                  className={styles.proposalRow}
                  data-testid={`twin-proposal-${proposal.code}`}
                >
                  <div className={styles.proposalTop}>
                    <div className={styles.proposalTitleWrap}>
                      <span className={`${styles.agentNo} ${styles.tnum}`}>{proposal.code}</span>
                      <span className={`${styles.goalCode} ${styles.tnum}`}>{proposal.goalId}</span>
                      <strong className={styles.proposalTitle}>{proposal.title}</strong>
                    </div>
                    <span className={styles.badgeWarn}>{proposal.urgency}</span>
                  </div>
                  <div className={`${styles.proposalImpact} ${styles.tnum}`}>
                    기대 효과: {proposal.expectedImpact}
                  </div>
                  <div className={styles.proposalRationale}>
                    판단 근거: {proposal.rationale}
                  </div>
                  <div className={styles.proposalFoot}>
                    <span className={styles.deptText}>연결 목표: {proposal.goalTitle}</span>
                    <div className={styles.agentLinks}>
                      <button
                        type="button"
                        className={styles.btnPrimarySm}
                        onClick={(e) => void handleCopyTwinProposal(proposal, e)}
                        data-testid={`copy-twin-proposal-${proposal.code}`}
                      >
                        이 작업 지시서 복사
                      </button>
                      <Link href={proposal.route} className={styles.linkBtnSm}>
                        {proposal.routeLabel}
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 2. 중단 좌우 스플릿 (56% : 44%) */}
      <div className={styles.splitGrid}>
        {/* 좌측 56%: 6대 에이전트 현황판 + PM 업무·결재 원장 */}
        <div className={styles.columnStack} id="hub-agents-and-pulse">
          <section className={styles.panel} aria-labelledby="agents-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="agents-heading" className={styles.sectionTitle}>
                  6대 에이전트 실시간 작업 현황판
                </h2>
                <p className={styles.sectionSub}>
                  각 에이전트가 무엇을 보고 일하고 있는지, 지금 막힌 지점은 없는지 즉시 확인합니다.
                </p>
              </div>
              <span className={styles.badge}>총 {agents.length}개 전담 라인</span>
            </div>

            <div className={styles.agentGrid} data-testid="hub-agent-roster">
              {agents.map((agent) => (
                <article
                  key={agent.id}
                  className={styles.agentRowCard}
                  data-testid={`agent-card-${agent.id}`}
                >
                  <div className={styles.agentTop}>
                    <div className={styles.agentNameBlock}>
                      <div className={styles.agentName}>
                        <span className={`${styles.agentNo} ${styles.tnum}`}>{agent.rankNo}</span>
                        {agent.name}
                      </div>
                      <div className={styles.agentCode}>{agent.codeName}</div>
                    </div>
                    <span className={badgeClassByStatus(agent.statusCode)}>
                      {agent.statusLabel}
                    </span>
                  </div>

                  <div className={styles.agentOwner}>{agent.ownerArea}</div>
                  <div className={`${styles.agentMetric} ${styles.tnum}`}>{agent.headlineMetric}</div>
                  <div className={styles.agentSummary}>{agent.recentSummary}</div>

                  <div className={styles.agentFoot}>
                    <div className={`${styles.agentStats} ${styles.tnum}`}>
                      {agent.subStats.map((st) => (
                        <span key={st.label} className={styles.agentStatItem}>
                          {st.label} <strong>{st.value}</strong>
                        </span>
                      ))}
                    </div>
                    <div className={styles.agentLinks}>
                      <Link href={agent.primaryRoute} className={styles.linkBtnSm}>
                        {agent.primaryLabel}
                      </Link>
                      {agent.secondaryRoute && (
                        <Link href={agent.secondaryRoute} className={styles.linkBtnSm}>
                          {agent.secondaryLabel}
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel} id="hub-pm-ledger" aria-labelledby="ledger-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="ledger-heading" className={styles.sectionTitle}>
                  PM 업무 · 사장님 결재 대기 원장
                </h2>
                <p className={styles.sectionSub}>
                  /pm에 따로 들어가지 않아도 결재 대기, 조사·검증중 과제, 직원 요청, 레이더 채택 건을 한 표로 봅니다.
                </p>
              </div>
              <Link href="/pm" className={styles.linkBtnSm}>
                PM 전체 화면 →
              </Link>
            </div>

            <div className={styles.filterToolbar}>
              <div className={styles.tabList} role="tablist" aria-label="PM 원장 상태 필터">
                {LEDGER_TABS.map((tab, idx) => {
                  const selected = effectiveLedgerTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      ref={(el) => {
                        ledgerTabRefs.current[idx] = el;
                      }}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      className={`${styles.tabBtn} ${styles.tnum}`}
                      onClick={() => handleSelectLedgerTab(tab.id)}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                      data-testid={`ledger-tab-${tab.id}`}
                    >
                      {tab.label} ({ledgerCounts[tab.id] || 0})
                    </button>
                  );
                })}
              </div>

              <input
                type="search"
                className={styles.searchInput}
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
                placeholder="안건명 · 담당자 · PR 검색"
                aria-label="PM 원장 안건 검색"
                data-testid="ledger-search-input"
              />
            </div>

            {filteredLedger.length === 0 ? (
              <div className={styles.emptyBox}>
                선택한 조건({LEDGER_TABS.find((t) => t.id === effectiveLedgerTab)?.label})에 해당하는 PM 안건이 없습니다.
              </div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.ledgerTable} data-testid="hub-pm-ledger-table">
                  <thead>
                    <tr>
                      <th style={{ width: 126 }}>상태 · 출처</th>
                      <th>업무 / 안건명 · 핵심 요약</th>
                      <th style={{ width: 170 }}>담당 / 트랙</th>
                      <th style={{ width: 118 }}>바로열기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLedger.slice(0, 24).map((row) => (
                      <tr key={row.id}>
                        <td>
                          <div>
                            <span className={badgeClassByStatus(row.tone)}>
                              {row.statusLabel}
                            </span>
                          </div>
                          <div className={`${styles.ledgerTrack} ${styles.tnum}`} style={{ marginTop: 4 }}>
                            {row.sourceLabel}
                            {row.days != null ? ` · ${row.days}일째` : ''}
                          </div>
                        </td>
                        <td>
                          <div className={styles.ledgerTitle}>{row.title}</div>
                          <div className={styles.ledgerSummary}>{row.questionOrSummary}</div>
                        </td>
                        <td>
                          <div className={styles.ledgerTrack}>{row.ownerOrTrack}</div>
                          {row.prNumber && row.prUrl && (
                            <div style={{ marginTop: 4 }}>
                              <a
                                href={row.prUrl}
                                target="_blank"
                                rel="noreferrer"
                                className={styles.linkBtnSm}
                              >
                                {row.prNumber} ↗
                              </a>
                            </div>
                          )}
                        </td>
                        <td>
                          <Link href={row.route} className={styles.linkBtnSm}>
                            {row.routeLabel}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* 우측 44%: 연속 디벨롭 타임라인 + 연속 구현 대기 큐 + 가브리엘 원가 경보 Top 3 */}
        <div className={styles.columnStack}>
          <section className={styles.panel} id="hub-dev-timeline" aria-labelledby="timeline-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="timeline-heading" className={styles.sectionTitle}>
                  실시간 연속 디벨롭 타임라인
                </h2>
                <p className={styles.sectionSub}>
                  최근 반영된 PR·기능 개선과 PM 오늘 완료 작업을 시간순으로 확인합니다.
                </p>
              </div>
              <Link href="/dev/history" className={styles.linkBtnSm}>
                전체 커밋 이력 →
              </Link>
            </div>

            <ul className={styles.timelineList} data-testid="hub-dev-timeline">
              {pulse.timeline.map((item) => (
                <li key={item.id} className={styles.timelineItem}>
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineMeta}>
                      <span className={`${styles.timelineDate} ${styles.tnum}`}>
                        {item.dateLabel}
                      </span>
                      <span className={badgeClassByStatus(item.source === 'live-pm' ? 'live' : 'active')}>
                        {item.badge}
                      </span>
                    </div>
                    <div className={styles.timelineTitle}>{item.title}</div>
                    <div className={styles.timelineSummary}>{item.summary}</div>
                  </div>
                  <Link href={item.route} className={styles.linkBtnSm}>
                    {item.routeLabel}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.panel} id="hub-build-queue" aria-labelledby="queue-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="queue-heading" className={styles.sectionTitle}>
                  다음 연속 구현 대기 큐
                </h2>
                <p className={styles.sectionSub}>
                  실전가동(LIVE) · 파일럿(PILOT) · 즉시구현(READY) · 신규발굴(DISCOVERED) 진척과 작업지시서
                </p>
              </div>
              <span className={`${styles.badge} ${styles.tnum}`}>
                총 {pulse.buildQueue.length}종
              </span>
            </div>

            <div className={styles.stageFilterRow} role="group" aria-label="구현 단계 필터">
              {BUILD_STAGE_FILTERS.map((sf) => (
                <button
                  key={sf.id}
                  type="button"
                  aria-pressed={buildStageFilter === sf.id}
                  className={styles.stageBtn}
                  onClick={() => setBuildStageFilter(sf.id)}
                  data-testid={`build-stage-${sf.id}`}
                >
                  {sf.label}
                </button>
              ))}
            </div>

            {copiedBrief && (
              <div className={styles.briefDrawer} role="region" aria-label="선택된 구현 지시서">
                <div className={styles.briefDrawerHead}>
                  <strong>
                    [{copiedBrief.code}] 구현 지시서 원문
                  </strong>
                  <button
                    type="button"
                    className={styles.btnSm}
                    onClick={() => {
                      setCopyNotice('');
                      setCopiedBrief(null);
                      briefTriggerRef.current?.focus();
                    }}
                  >
                    닫기 (Esc)
                  </button>
                </div>
                {copyNotice && (
                  <div className={styles.copyNotice} role="status" data-testid="hub-copy-notice" style={{ marginBottom: 10 }}>
                    {copyNotice}
                  </div>
                )}
                <pre className={styles.briefPre}>{copiedBrief.agentBriefText}</pre>
              </div>
            )}

            <div className={styles.buildQueueList} data-testid="hub-build-queue-list">
              {filteredBuildQueue.slice(0, 7).map((item) => (
                <article key={item.id} className={styles.buildQueueRow}>
                  <div className={styles.buildQueueTop}>
                    <div className={styles.buildQueueTitle}>
                      <span className={`${styles.agentNo} ${styles.tnum}`}>{item.code}</span>
                      {item.title}
                    </div>
                    <span className={badgeClassByStatus(item.status)}>
                      {item.status} · {item.statusLabel}
                    </span>
                  </div>
                  <div className={styles.buildQueueImpact}>{item.expectedImpact}</div>
                  <div className={styles.buildQueueActions}>
                    <span className={styles.deptText}>
                      대상 부서: {item.departmentLabels.join(', ')}
                    </span>
                    <div className={styles.agentLinks}>
                      <button
                        type="button"
                        className={styles.btnSm}
                        onClick={(e) => void handleCopyBrief(item, e)}
                        data-testid={`copy-brief-${item.code}`}
                      >
                        구현 지시서 복사
                      </button>
                      <Link href={item.primaryRoute} className={styles.linkBtnSm}>
                        열기
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel} id="hub-gabriel-alerts" aria-labelledby="gabriel-heading">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="gabriel-heading" className={styles.sectionTitle}>
                  가브리엘 원가 · 이익 경보 Top 3
                </h2>
                <p className={styles.sectionSub}>
                  {model.gabrielScope?.orderYear || '2026'}년 {model.gabrielScope?.orderWeek || '46-01'}차 기준 즉시 이익 방어 대상
                </p>
              </div>
              <Link href="/import/gabriel-agi" className={styles.linkBtnSm}>
                10대 레버 전체 →
              </Link>
            </div>

            <div className={styles.alertList} data-testid="hub-gabriel-alert-list">
              {pulse.gabrielTopAlerts.map((alert) => (
                <article key={alert.id} className={styles.alertRow}>
                  <div className={styles.alertBody}>
                    <div className={styles.alertCode}>{alert.code}</div>
                    <div className={styles.alertTitle}>{alert.title}</div>
                    <div className={styles.alertDetail}>{alert.detail}</div>
                  </div>
                  <div className={styles.alertRight}>
                    <span className={`${styles.alertImpact} ${styles.tnum}`}>
                      {alert.impactLabel}
                    </span>
                    <Link href={alert.route} className={styles.linkBtnSm}>
                      {alert.routeLabel}
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* 3. 하단: 전체 화면 한눈 지도 (4대 목적별 바로가기 디렉터리) */}
      <section className={styles.panel} id="hub-directory" aria-labelledby="directory-heading">
        <div className={styles.panelHeader}>
          <div>
            <h2 id="directory-heading" className={styles.sectionTitle}>
              전체 화면 한눈 지도 (4대 목적별 바로가기 디렉터리)
            </h2>
            <p className={styles.sectionSub}>
              페이지가 많아 헷갈릴 때 “지금 무엇을 보려는지” 4가지 목적 중 하나만 고르면 바로 맞는 화면이 열립니다.
            </p>
          </div>
          <span className={`${styles.badge} ${styles.tnum}`}>
            4대 목적 · {directory.reduce((sum, g) => sum + g.items.length, 0)}개 핵심 화면
          </span>
        </div>

        <div className={styles.directoryGrid} data-testid="hub-page-directory">
          {directory.map((group) => (
            <section key={group.id} className={styles.directoryCol} aria-label={group.title}>
              <div className={styles.directoryColHead}>
                <div className={styles.directoryStep}>{group.stepLabel}</div>
                <h3 className={styles.directoryTitle}>{group.title}</h3>
                <p className={styles.directoryWhen}>{group.whenToUse}</p>
              </div>
              <ul className={styles.directoryList}>
                {group.items.map((item) => (
                  <li key={item.href} className={styles.directoryItem}>
                    <div className={styles.directoryItemTop}>
                      <span className={styles.directoryItemTitle}>{item.title}</span>
                      <span className={styles.badge}>{item.badge}</span>
                    </div>
                    <div className={styles.directoryItemDesc}>{item.oneLineDesc}</div>
                    <div className={styles.directoryItemFoot}>
                      <span className={styles.directoryWhenTag}>{item.whenText}</span>
                      <Link href={item.href} className={styles.linkBtnSm}>
                        열기
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </main>
  );
}
