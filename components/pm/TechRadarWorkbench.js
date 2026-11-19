// components/pm/TechRadarWorkbench.js
// 도입 · 기술 레이더 시안 A·B·C + 3종 동시 비교(ALL) 라이브 시뮬레이터 워크벤치:
// - 시안 A (ThoughtWorks × Stripe / FT Data Desk): 44:56 비대칭 스플릿 · 극좌표 4분면(▲ 신규 / ● 기존 / 활성 파동링) · 결재바 · 1px 원장 · 하단 컴팩트 6노드 시뮬
// - 시안 B (Linear × Vercel Geist): 4칸 플랫 KPI 스트립 · 60% 2×2 임팩트×준비도 매트릭스 + 40% 슬라이드 인스펙터 시트
// - 시안 C (Palantir Foundry × Raycast Pro): 매트 카본 다크 콘솔 · 키보드 단축키(J/K, 1/2/3/4, B, Space) · 4단계 링 파이프라인 · 전술 패킷 트레이스 · 도메인별 마스터 원장
// - A·B·C 3종 동시 비교(ALL): 통합 마스터 컨트롤 바 + 동일 선택 기술·스텝으로 3개 시안 뷰포트 실시간 동시 구동
// 가드 준수: components/pm/ui.js 키트만 사용(raw button 금지) · hex 색 직접 작성 금지(rgb/rgba/CSS변수만) · 금지어 및 이모지 0건.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, EmptyState, LinkButton, PmUiStyles, SelectCard, Tabs, ToggleChip } from './ui';
import {
  RADAR_QUADRANTS,
  RADAR_RINGS,
  PIPELINE_STAGES,
  MATRIX_ZONES,
  RADAR_DEPARTMENTS,
  BUILD_PIPELINE_STAGES,
  SIM_PRESETS,
  CONTINUOUS_BUILD_PIPELINE,
  normalizeRadarCatalog,
  computePolarCoordinates,
  computeMatrixCoordinates,
  resolvePresetTarget,
  normalizeDeptFilter,
  getItemDepartments,
  deriveNextBuildItems,
  summarizeBuildPipeline,
  simulateRadarItem,
  buildWorkbenchSummary,
} from '../../lib/pmTechRadarSim';
import { RADAR_PLAN_MODES, getPlanTokenVars } from '../../lib/pmRadarPlanTokens';

const RING_LABELS = Object.fromEntries(RADAR_RINGS.map((r) => [r.id, r]));
const QUAD_LABELS = Object.fromEntries(RADAR_QUADRANTS.map((q) => [q.id, q]));
const DEPT_MAP = Object.fromEntries(RADAR_DEPARTMENTS.map((d) => [d.id, d]));

const fmtStars = (n) => {
  const num = Number(n) || 0;
  if (!num) return '-';
  return num >= 1000 ? `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k` : String(num);
};

const fmtBlipNo = (n) => String(Number(n) || 0).padStart(2, '0');

const clipText = (str, max = 30) => {
  const s = String(str || '').trim();
  if (!s) return '-';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const ringColorVar = (ring) => {
  if (ring === 'adopt') return 'var(--trw-ok)';
  if (ring === 'trial') return 'var(--trw-accent)';
  if (ring === 'assess') return 'var(--trw-warn)';
  return 'var(--trw-muted)';
};

const buildStatusToneClass = (status) => {
  if (status === 'LIVE') return 'trw-mini-ok';
  if (status === 'PILOT') return 'trw-mini-accent';
  if (status === 'READY') return 'trw-mini-warn';
  return '';
};

export default function TechRadarWorkbench({
  ledger = null,
  techRadar = null,
  isAdmin = false,
  mode = 'dark',
  standaloneUiStyles = false,
  onOpenSuiteSim = null,
  initialPlanMode = 'A',
  initialDepartment = 'all',
  title = '도입 · 기술 레이더 & 실설계 도입 시뮬레이터',
  subtitle = '시안 A(에디토리얼 레이더) · 시안 B(2×2 매트릭스·드로어) · 시안 C(카본 다크 콘솔) · 3종 동시 비교 및 부서·데이터 기준 · 연속 구현 파이프라인',
}) {
  const safeInitialPlan = ['A', 'B', 'C', 'ALL'].includes(initialPlanMode) ? initialPlanMode : 'A';
  const [planMode, setPlanMode] = useState(safeInitialPlan);
  const [deptFilter, setDeptFilter] = useState(() => normalizeDeptFilter(initialDepartment));
  const [buildStageFilter, setBuildStageFilter] = useState('all');
  const [quadFilter, setQuadFilter] = useState('');
  const [ringFilter, setRingFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showAllPoints, setShowAllPoints] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const [activePresetId, setActivePresetId] = useState('');
  const [activeBuildId, setActiveBuildId] = useState('');
  const [copiedBuildId, setCopiedBuildId] = useState('');
  const [previewBriefId, setPreviewBriefId] = useState('');
  const [simMode, setSimMode] = useState('simulated'); // 'baseline' | 'simulated'
  const [playing, setPlaying] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReducedMotion(Boolean(mq.matches));
      if (mq.matches) setPlaying(false);
    };
    sync();
    if (mq.addEventListener) {
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }
    return undefined;
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const allItems = useMemo(
    () => normalizeRadarCatalog({ ledger, techRadar, adminMode: Boolean(isAdmin) }),
    [ledger, techRadar, isAdmin]
  );

  const summary = useMemo(
    () => buildWorkbenchSummary(allItems, Boolean(isAdmin)),
    [allItems, isAdmin]
  );

  const itemDeptsMap = useMemo(() => {
    const m = new Map();
    for (const item of allItems) {
      m.set(item.name, getItemDepartments(item));
    }
    return m;
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => {
      if (quadFilter && item.quadrant !== quadFilter) return false;
      if (ringFilter && item.ring !== ringFilter) return false;
      if (q) {
        const hay = [
          item.name,
          item.summary,
          item.why,
          item.use,
          item.language,
          ...(item.systems || []),
          ...(item.topics || []),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, quadFilter, ringFilter, query]);

  const deptMatchedCatalogCount = useMemo(() => {
    if (deptFilter === 'all') return filteredItems.length;
    return filteredItems.filter((item) => (itemDeptsMap.get(item.name) || []).includes(deptFilter)).length;
  }, [filteredItems, deptFilter, itemDeptsMap]);

  const deptScopedBuildItems = useMemo(
    () => deriveNextBuildItems({ dept: deptFilter, stage: 'all', query }),
    [deptFilter, query]
  );

  const filteredBuildItems = useMemo(
    () => deriveNextBuildItems({ dept: deptFilter, stage: buildStageFilter, query }),
    [deptFilter, buildStageFilter, query]
  );

  const buildSummary = useMemo(
    () => summarizeBuildPipeline(deptScopedBuildItems),
    [deptScopedBuildItems]
  );

  const activeBuildItem = useMemo(
    () => (activeBuildId ? CONTINUOUS_BUILD_PIPELINE.find((b) => b.id === activeBuildId) || null : null),
    [activeBuildId]
  );

  const activePreset = useMemo(
    () => (activePresetId ? resolvePresetTarget(activePresetId, allItems) : null),
    [activePresetId, allItems]
  );

  const selectedItem = useMemo(() => {
    if (activeBuildItem) {
      const linkedPreset = resolvePresetTarget(activeBuildItem.linkedScenarioId, allItems);
      if (linkedPreset?.item) return linkedPreset.item;
    }
    if (activePreset?.item) return activePreset.item;
    if (!filteredItems.length) return allItems[0] || null;
    const found = filteredItems.find((x) => x.name === selectedName);
    return found || filteredItems[0];
  }, [activeBuildItem, activePreset, filteredItems, allItems, selectedName]);

  const plotItems = useMemo(() => {
    if (showAllPoints || filteredItems.length <= 32) return filteredItems;
    const slice = filteredItems.slice(0, 32);
    if (selectedItem && filteredItems.includes(selectedItem) && !slice.some((x) => x.name === selectedItem.name)) {
      return [...slice.slice(0, 31), selectedItem];
    }
    return slice;
  }, [filteredItems, showAllPoints, selectedItem]);

  const polarPoints = useMemo(() => computePolarCoordinates(plotItems), [plotItems]);
  const matrixPoints = useMemo(() => computeMatrixCoordinates(plotItems), [plotItems]);

  const sim = useMemo(
    () =>
      simulateRadarItem(selectedItem, {
        scenarioId: activeBuildItem?.linkedScenarioId || activePreset?.scenarioId || '',
        buildItemId: activeBuildId,
      }),
    [selectedItem, activePreset, activeBuildItem, activeBuildId]
  );

  useEffect(() => {
    if (!playing || reducedMotion || !sim.steps.length) return undefined;
    const timer = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % sim.steps.length);
    }, 1600);
    return () => clearInterval(timer);
  }, [playing, reducedMotion, sim.steps.length, sim.itemName, sim.scenarioId]);

  const safeStepIdx = sim.steps.length ? stepIdx % sim.steps.length : 0;
  const activeSimStep = sim.steps[safeStepIdx] || null;

  const selectItem = useCallback(
    (item, startSim = false) => {
      if (!item) return;
      setActiveBuildId('');
      setActivePresetId('');
      setSelectedName(item.name);
      setStepIdx(0);
      if (startSim) {
        setSimMode('simulated');
        if (!reducedMotion) setPlaying(true);
      }
    },
    [reducedMotion]
  );

  const selectPreset = useCallback(
    (preset, startSim = false) => {
      if (!preset) return;
      const resolved = resolvePresetTarget(preset.id, allItems);
      setActiveBuildId('');
      setActivePresetId(preset.id);
      if (resolved.item) setSelectedName(resolved.item.name);
      setStepIdx(0);
      if (startSim) {
        setSimMode('simulated');
        if (!reducedMotion) setPlaying(true);
      }
    },
    [allItems, reducedMotion]
  );

  const playBuildItemSimulation = useCallback(
    (buildItem) => {
      if (!buildItem) return;
      const resolved = resolvePresetTarget(buildItem.linkedScenarioId, allItems);
      setActivePresetId('');
      setActiveBuildId(buildItem.id);
      if (resolved.item) setSelectedName(resolved.item.name);
      setPlanMode('ALL');
      setSimMode('simulated');
      setStepIdx(0);
      if (!reducedMotion) setPlaying(true);
      if (typeof document !== 'undefined') {
        const targetEl = document.querySelector('[data-testid="radar-all-master-controls"]');
        if (targetEl && typeof targetEl.scrollIntoView === 'function') {
          targetEl.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
        }
      }
    },
    [allItems, reducedMotion]
  );

  const copyAgentBrief = useCallback((buildItem) => {
    if (!buildItem) return;
    const text = buildItem.agentBriefText || '';
    const markCopied = () => {
      setCopiedBuildId(buildItem.id);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedBuildId(''), 3000);
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(markCopied).catch(() => {
          setPreviewBriefId(buildItem.id);
          markCopied();
        });
        return;
      }
      if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } catch {
          // ignore execCommand failure in restricted environments
        }
        document.body.removeChild(ta);
      }
      markCopied();
    } catch {
      setPreviewBriefId(buildItem.id);
      markCopied();
    }
  }, []);

  const clearFilters = () => {
    setDeptFilter('all');
    setBuildStageFilter('all');
    setQuadFilter('');
    setRingFilter('');
    setQuery('');
  };

  // 키보드 단축키: J/K 행 이동 · 1/2/3/4 시안 전환 · B Before/After 토글 · Space 스텝 전진
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      const tag = (target?.tagName || '').toUpperCase();
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || target?.isContentEditable) return;

      const key = e.key;
      if (key === '1') {
        e.preventDefault();
        setPlanMode('A');
        return;
      }
      if (key === '2') {
        e.preventDefault();
        setPlanMode('B');
        return;
      }
      if (key === '3') {
        e.preventDefault();
        setPlanMode('C');
        return;
      }
      if (key === '4') {
        e.preventDefault();
        setPlanMode('ALL');
        return;
      }
      if (key === 'b' || key === 'B') {
        e.preventDefault();
        setSimMode((prev) => (prev === 'baseline' ? 'simulated' : 'baseline'));
        return;
      }
      if (key === 'j' || key === 'J' || key === 'k' || key === 'K') {
        if (!filteredItems.length) return;
        e.preventDefault();
        const curIdx = filteredItems.findIndex((x) => x.name === selectedItem?.name);
        const delta = key === 'j' || key === 'J' ? 1 : -1;
        const nextIdx = curIdx < 0 ? 0 : (curIdx + delta + filteredItems.length) % filteredItems.length;
        selectItem(filteredItems[nextIdx], false);
        return;
      }
      if (key === ' ' && tag !== 'BUTTON' && tag !== 'A') {
        e.preventDefault();
        setPlaying(false);
        setStepIdx((prev) => (sim.steps.length ? (prev + 1) % sim.steps.length : 0));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filteredItems, selectedItem, sim.steps.length, selectItem]);

  const activePlanInfo = useMemo(
    () => RADAR_PLAN_MODES.find((p) => p.id === planMode) || RADAR_PLAN_MODES[0],
    [planMode]
  );

  const activeDeptInfo = useMemo(
    () => DEPT_MAP[deptFilter] || RADAR_DEPARTMENTS[0],
    [deptFilter]
  );

  const rootStyle = useMemo(
    () => getPlanTokenVars(planMode, mode),
    [planMode, mode]
  );

  const visibleLinks = useMemo(
    () => (sim.links || []).filter((lnk) => !lnk.adminOnly || isAdmin),
    [sim.links, isAdmin]
  );

  // 공용: Before / After 정량 비교 막대 렌더러
  const renderMetricBar = (m, compact = false) => {
    const maxVal = Math.max(m.beforeVal, m.afterVal, 1);
    const beforePct = Math.max(4, Math.round((m.beforeVal / maxVal) * 100));
    const afterPct = Math.max(4, Math.round((m.afterVal / maxVal) * 100));
    return (
      <div key={m.label} className={`trw-metric-row ${compact ? 'is-compact' : ''}`}>
        <div className="trw-metric-head">
          <span className="trw-metric-label">{m.label}</span>
          <div className="trw-metric-badges">
            <Badge className="trw-src-tag">{m.measured ? '실측' : '설계기준'}</Badge>
            <Badge className="trw-delta-tag">{m.deltaLabel}</Badge>
          </div>
        </div>
        <div className="trw-metric-bars">
          <div className="trw-bar-line">
            <span className="trw-bar-tag">도입 전</span>
            <div className="trw-bar-track">
              <span className="trw-bar-fill is-before" style={{ width: `${beforePct}%` }} />
            </div>
            <span className="trw-bar-val">{m.beforeLabel}</span>
          </div>
          <div className="trw-bar-line">
            <span className="trw-bar-tag">도입 후</span>
            <div className="trw-bar-track">
              <span className="trw-bar-fill is-after" style={{ width: `${afterPct}%` }} />
            </div>
            <span className="trw-bar-val is-after">{m.afterLabel}</span>
          </div>
        </div>
      </div>
    );
  };

  // 공용: 관리자 결재 대기 안건 바 (isAdmin 전용)
  const renderApprovalBar = () => {
    if (!isAdmin || !summary.approvalQueue.length) return null;
    return (
      <div className="trw-approval-bar" aria-label="관리자 결정 대기 항목">
        <span className="trw-approval-head">결정 대기 실측 ({summary.approvalQueue.length}건)</span>
        <div className="trw-approval-list">
          {summary.approvalQueue.map((item) => {
            const active = selectedItem?.name === item.name && !activePresetId;
            return (
              <div key={item.name} className={`trw-approval-item ${active ? 'is-active' : ''}`}>
                <span className="trw-approval-name">{item.name}</span>
                <span className="trw-approval-score">{item.score10}/10</span>
                <Button
                  size="sm"
                  variant={active ? 'primary' : 'secondary'}
                  onClick={() => selectItem(item, true)}
                >
                  시뮬레이션 검수
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 공용: 시뮬레이션 재생·모드 제어 바
  const renderSimControls = ({ compact = false } = {}) => (
    <div className={`trw-sim-controls ${compact ? 'is-compact' : ''}`}>
      <div className="trw-sim-mode-group">
        <ToggleChip on={simMode === 'baseline'} onClick={() => setSimMode('baseline')}>
          도입 전(Baseline)
        </ToggleChip>
        <ToggleChip on={simMode === 'simulated'} onClick={() => setSimMode('simulated')}>
          도입 후(Simulated)
        </ToggleChip>
      </div>
      <div className="trw-sim-play-group">
        <Button
          size="sm"
          variant={playing ? 'primary' : 'secondary'}
          disabled={reducedMotion}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? '일시정지' : compact ? '자동 순환 재생' : '단계별 패킷 시뮬레이션 재생'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setPlaying(false);
            setStepIdx((prev) => (sim.steps.length ? (prev + 1) % sim.steps.length : 0));
          }}
        >
          {compact ? '단계 재생' : '다음 단계'}
        </Button>
        <span className="trw-step-counter">
          STEP 0{safeStepIdx + 1} / 0{Math.max(1, sim.steps.length)}
        </span>
      </div>
    </div>
  );

  // 공용: 시나리오 바로가기 링크 (/import/gabriel-agi, /import/pipeline 등)
  const renderScenarioLinks = () => {
    if (!visibleLinks.length) return null;
    return (
      <div className="trw-link-row">
        {visibleLinks.map((lnk) => (
          <a key={lnk.href} href={lnk.href} className="trw-ext-link">
            {lnk.label} ↗
          </a>
        ))}
      </div>
    );
  };

  // 공용: 안전 가드 체크표
  const renderSafetyChecks = () => (
    <ul className="trw-safety-list">
      {sim.safetyChecks.map((chk) => (
        <li key={chk.id}>
          <div className="trw-safety-top">
            <Badge className="trw-mini-ok">{chk.status}</Badge>
            <b>{chk.label}</b>
          </div>
          <span>{chk.detail}</span>
        </li>
      ))}
    </ul>
  );

  // 공용: 4분면 × 4동심원 극좌표 레이더 SVG (신규 ▲ / 기존 ● / 활성 Blip 파동링)
  const renderPolarSvg = ({ compact = false } = {}) => (
    <div className={`trw-svg-wrap ${compact ? 'is-compact' : ''}`}>
      <svg className={`trw-svg ${compact ? 'is-compact-polar' : ''}`} viewBox="0 0 640 640" role="img" aria-label="4분면 극좌표 기술 레이더">
        <circle cx="320" cy="320" r="254" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
        <circle cx="320" cy="320" r="211" fill="none" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx="320" cy="320" r="148" fill="none" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx="320" cy="320" r="79" fill="none" stroke="var(--trw-accent)" strokeWidth="1" strokeOpacity="0.55" />

        <line x1="320" y1="36" x2="320" y2="604" stroke="var(--trw-line)" strokeWidth="1" />
        <line x1="36" y1="320" x2="604" y2="320" stroke="var(--trw-line)" strokeWidth="1" />

        <text x="326" y="256" fill="var(--trw-muted)" fontSize="10" fontWeight="700">ADOPT</text>
        <text x="326" y="188" fill="var(--trw-muted)" fontSize="10" fontWeight="700">TRIAL</text>
        <text x="326" y="124" fill="var(--trw-muted)" fontSize="10" fontWeight="700">ASSESS</text>
        <text x="326" y="78" fill="var(--trw-muted)" fontSize="10" fontWeight="700">HOLD</text>

        <text x="24" y="28" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q2 고성능 런타임·Rust</text>
        <text x="616" y="28" textAnchor="end" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q1 에이전트·오케스트레이션</text>
        <text x="24" y="624" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q3 카톡·디바이스 브릿지</text>
        <text x="616" y="624" textAnchor="end" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q4 UI·시각화·문서검증</text>

        {polarPoints.map((pt) => {
          const active = selectedItem?.name === pt.name;
          const isNew = Boolean(pt.item?.isNewRound || pt.item?._new);
          const deptMatch = deptFilter === 'all' || (itemDeptsMap.get(pt.name) || []).includes(deptFilter);
          const color = ringColorVar(pt.ring);
          const labelNo = fmtBlipNo(pt.blipNo);
          return (
            <g
              key={pt.name}
              transform={`translate(${pt.x}, ${pt.y})`}
              className={`trw-blip ${active ? 'is-active' : ''}`}
              opacity={active || deptMatch ? 1 : 0.36}
              role="button"
              tabIndex={0}
              aria-label={`${labelNo}번 ${pt.name} (${RING_LABELS[pt.ring]?.code || pt.ring})`}
              aria-pressed={active}
              onClick={() => selectItem(pt.item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectItem(pt.item);
                }
              }}
            >
              <title>{`${labelNo}. ${pt.name} · ${RING_LABELS[pt.ring]?.label} · ${pt.item.score10}/10`}</title>
              {active && (
                <>
                  <circle r="16.5" fill="none" stroke={color} strokeWidth="2" />
                  {playing && !reducedMotion && (
                    <circle className="trw-blip-wave" r="22" fill="none" stroke={color} strokeWidth="1.2" strokeDasharray="3 3" />
                  )}
                </>
              )}
              {isNew ? (
                <polygon
                  points={active ? '0,-13.5 12.5,9.5 -12.5,9.5' : '0,-11.5 10.5,8 -10.5,8'}
                  fill={active ? color : 'var(--trw-surface)'}
                  stroke={color}
                  strokeWidth={active ? 2 : 1.5}
                />
              ) : (
                <circle
                  r={active ? 11.5 : 9.5}
                  fill={active ? color : 'var(--trw-surface)'}
                  stroke={color}
                  strokeWidth={active ? 2 : 1.5}
                />
              )}
              <text
                textAnchor="middle"
                dy={isNew ? '5.2' : '3.4'}
                fontSize="8.8"
                fontWeight="700"
                fill={active ? 'var(--trw-surface)' : 'var(--trw-ink)'}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {labelNo}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );

  // 공용: 2×2 임팩트 × 안전·준비도 산점도 매트릭스 SVG
  const renderMatrixSvg = ({ compact = false } = {}) => (
    <div className={`trw-svg-wrap ${compact ? 'is-compact' : ''}`}>
      <svg className={`trw-svg ${compact ? 'is-compact-matrix' : ''}`} viewBox="0 0 640 420" role="img" aria-label="2x2 임팩트 준비도 매트릭스">
        <rect x="58" y="32" width="558" height="334" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
        <line x1="197.5" y1="32" x2="197.5" y2="366" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
        <line x1="337" y1="32" x2="337" y2="366" stroke="var(--trw-line)" strokeWidth="1.2" />
        <line x1="476.5" y1="32" x2="476.5" y2="366" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
        <line x1="58" y1="115.5" x2="616" y2="115.5" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
        <line x1="58" y1="199" x2="616" y2="199" stroke="var(--trw-line)" strokeWidth="1.2" />
        <line x1="58" y1="282.5" x2="616" y2="282.5" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />

        <text x="68" y="50" fill="var(--trw-warn)" fontSize="11" fontWeight="700">{MATRIX_ZONES[1].label}</text>
        <text x="606" y="50" textAnchor="end" fill="var(--trw-ok)" fontSize="11" fontWeight="700">{MATRIX_ZONES[0].label}</text>
        <text x="68" y="354" fill="var(--trw-muted)" fontSize="11" fontWeight="700">{MATRIX_ZONES[3].label}</text>
        <text x="606" y="354" textAnchor="end" fill="var(--trw-accent)" fontSize="11" fontWeight="700">{MATRIX_ZONES[2].label}</text>

        <text x="58" y="384" textAnchor="middle" fill="var(--trw-muted)" fontSize="10">0</text>
        <text x="337" y="384" textAnchor="middle" fill="var(--trw-muted)" fontSize="10">50</text>
        <text x="616" y="384" textAnchor="middle" fill="var(--trw-muted)" fontSize="10">100</text>
        <text x="337" y="405" textAnchor="middle" fill="var(--trw-ink)" fontSize="11.5" fontWeight="700">
          운영·원장 안전성 및 실측 준비도 (0~100)
        </text>

        <text x="48" y="366" textAnchor="end" fill="var(--trw-muted)" fontSize="10">0</text>
        <text x="48" y="202" textAnchor="end" fill="var(--trw-muted)" fontSize="10">50</text>
        <text x="48" y="38" textAnchor="end" fill="var(--trw-muted)" fontSize="10">100</text>
        <text x="18" y="199" textAnchor="middle" transform="rotate(-90 18 199)" fill="var(--trw-ink)" fontSize="11.5" fontWeight="700">
          처리속도·업무시간 단축 임팩트
        </text>

        {matrixPoints.map((pt) => {
          const cx = 58 + (pt.readiness / 100) * 558;
          const cy = 366 - (pt.impact / 100) * 334;
          const active = selectedItem?.name === pt.name;
          const deptMatch = deptFilter === 'all' || (itemDeptsMap.get(pt.name) || []).includes(deptFilter);
          const color = ringColorVar(pt.ring);
          const labelNo = fmtBlipNo(pt.blipNo);
          return (
            <g
              key={pt.name}
              transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}
              className={`trw-blip ${active ? 'is-active' : ''}`}
              opacity={active || deptMatch ? 1 : 0.36}
              role="button"
              tabIndex={0}
              aria-label={`${labelNo}번 ${pt.name} 준비도 ${pt.readiness} 임팩트 ${pt.impact}`}
              aria-pressed={active}
              onClick={() => selectItem(pt.item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectItem(pt.item);
                }
              }}
            >
              <title>{`${labelNo}. ${pt.name} · 준비도 ${pt.readiness} · 임팩트 ${pt.impact} · ${pt.zoneLabel}`}</title>
              {active && <circle r="15.5" fill="none" stroke={color} strokeWidth="2" />}
              <circle
                r={active ? 11 : 9}
                fill={active ? color : 'var(--trw-surface)'}
                stroke={color}
                strokeWidth={active ? 2 : 1.5}
              />
              <text
                textAnchor="middle"
                dy="3.4"
                fontSize="8.8"
                fontWeight="700"
                fill={active ? 'var(--trw-surface)' : 'var(--trw-ink)'}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {labelNo}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );

  // 공용: 6대 실설계 노드 스트립
  const renderNodeCards = ({ compact = false } = {}) => (
    <div className={`trw-nodes-grid ${compact ? 'is-compact' : ''}`}>
      {sim.nodeDetails.map((node) => {
        const isStepFocus = activeSimStep?.nodeId === node.id;
        return (
          <div
            key={node.id}
            className={`trw-node-card ${node.active ? 'is-active' : 'is-passive'} ${node.isPrimary ? 'is-primary' : ''} ${isStepFocus ? 'is-step-focus' : ''}`}
          >
            <div className="trw-node-top">
              <span className="trw-node-code">{node.code}</span>
              <span className="trw-node-state">
                <i className={`trw-dot ${isStepFocus ? 'is-focus' : node.active ? 'is-on' : 'is-off'}`} aria-hidden="true" />
                {isStepFocus ? '패킷 통과' : node.statusLabel}
              </span>
            </div>
            <div className="trw-node-name">{node.shortName}</div>
            <code className="trw-node-artifact">{node.artifact}</code>
            {!compact && (
              <p className="trw-node-desc">
                {simMode === 'baseline' ? node.roleBefore : node.roleAfter}
              </p>
            )}
            <div className="trw-node-telemetry">
              <span>{node.latencyLabel}</span>
              <span>{node.throughputLabel}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  // 공용: 단계별 패킷 스텝 목록
  const renderStepsList = ({ compact = false } = {}) => (
    <ol className={`trw-steps-list ${compact ? 'is-compact' : ''}`}>
      {sim.steps.map((st, i) => {
        const isCur = i === safeStepIdx;
        return (
          <li key={st.stepNo} className={isCur ? 'is-current' : ''}>
            <SelectCard
              className="trw-step-hit"
              pressed={isCur}
              onClick={() => {
                setPlaying(false);
                setStepIdx(i);
              }}
            >
              <div className="trw-step-row-top">
                <span className="trw-step-no">0{st.stepNo}</span>
                <b>{st.nodeId} · {st.nodeName}</b>
                <code>{st.artifact}</code>
                <span className="trw-step-lat">
                  {st.latencyMs}ms · {st.throughput}
                </span>
              </div>
              <div className="trw-step-packet">{st.packetSummary}</div>
              <div className={`trw-step-note ${simMode === 'baseline' ? 'is-before' : 'is-after'}`}>
                {simMode === 'baseline' ? `도입 전: ${st.beforeNote}` : `도입 후: ${st.afterNote}`}
              </div>
            </SelectCard>
          </li>
        );
      })}
    </ol>
  );

  // 공용: 4단계 Ring Progression 파이프라인 (Plan C & ALL)
  const renderPipelineProgression = ({ compact = false } = {}) => (
    <div className={`trw-pipeline-box ${compact ? 'is-compact' : ''}`}>
      <div className="trw-sec-head">
        <b>4단계 도입 게이트 파이프라인</b>
        <span>현재 선택: {PIPELINE_STAGES.find((s) => s.id === sim.pipelineStage)?.label || '파일럿'}</span>
      </div>
      <div className="trw-pipeline-grid">
        {PIPELINE_STAGES.map((stg, idx) => {
          const isCur = sim.pipelineStage === stg.id;
          const cnt = summary.stageCounts[stg.id] ?? 0;
          return (
            <div key={stg.id} className={`trw-pipe-stage ${isCur ? 'is-current' : ''}`}>
              <div className="trw-pipe-head">
                <span className="trw-pipe-no">0{idx + 1}</span>
                <span className="trw-pipe-code">{stg.code}</span>
                <b className="trw-pipe-cnt">{cnt}건</b>
              </div>
              <div className="trw-pipe-label">{stg.label}</div>
              {!compact && <div className="trw-pipe-desc">{stg.desc}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );

  // 시안 A 라이브: 에디토리얼 4분면 레이더(44%) + 결재바·채택원장·컴팩트 6노드 시뮬레이터(56%)
  const renderPlanA = () => (
    <div className="trw-plan-a" data-testid="radar-plan-view-A">
      <div className="trw-panel trw-a-left">
        <div className="trw-viz-head">
          <div>
            <b>시안 A · 에디토리얼 4분면 극좌표 레이더</b>
            <span>신규 ▲ · 기존 ● · 활성 Blip 파동링 ({polarPoints.length}/{filteredItems.length}건)</span>
          </div>
          <div className="trw-viz-meta">
            {filteredItems.length > 32 && (
              <ToggleChip on={showAllPoints} onClick={() => setShowAllPoints((v) => !v)}>
                {showAllPoints ? '핵심 32건만' : `전체 ${filteredItems.length}건`}
              </ToggleChip>
            )}
          </div>
        </div>

        <div className="trw-legend-strip" aria-label="레이더 기호 범례">
          <span><b>▲</b> 신규 회차</span>
          <span><b>●</b> 기존 평가</span>
          <span><b>◎</b> 활성 시뮬레이션</span>
          <span className="trw-legend-ref">{activePlanInfo.reference}</span>
        </div>

        {renderPolarSvg()}

        <div className="trw-blip-index" aria-label="레이더 번호 색인">
          {polarPoints.map((pt) => (
            <ToggleChip
              key={pt.name}
              on={selectedItem?.name === pt.name && !activePresetId}
              onClick={() => selectItem(pt.item)}
            >
              <span className="trw-idx-no">{fmtBlipNo(pt.blipNo)}</span>
              <span className="trw-idx-name">{pt.name.split('/').pop()}</span>
              <span className="trw-idx-ring">{RING_LABELS[pt.ring]?.code}</span>
            </ToggleChip>
          ))}
        </div>
      </div>

      <aside className="trw-panel trw-a-right" data-testid="radar-architecture-simulator" aria-label="결재 대기 바 · 채택 원장 · 6노드 실시간 시뮬레이터">
        {renderApprovalBar()}

        <div className="trw-ledger-block">
          <div className="trw-viz-head">
            <div>
              <b>고밀도 채택 · 결정 원장 ({filteredItems.length}건)</b>
              <span>행 선택 시 좌측 극좌표 Blip 및 하단 6노드 패킷 경로와 즉시 연동됩니다.</span>
            </div>
            <span className="trw-count-note">tabular-nums</span>
          </div>
          <div className="trw-ledger-wrap is-plan-a">
            <table className="trw-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>기술 · 저장소</th>
                  <th>분면</th>
                  <th>단계</th>
                  <th>점수</th>
                  <th>실측 · 근거 요약</th>
                  <th>동작</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const active = selectedItem?.name === item.name && !activePresetId;
                  const deptMatch = deptFilter !== 'all' && (itemDeptsMap.get(item.name) || []).includes(deptFilter);
                  return (
                    <tr key={item.name} className={`${active ? 'is-active' : ''} ${deptMatch ? 'is-dept-match' : ''}`}>
                      <td className="trw-num">{fmtBlipNo(item.blipNo)}</td>
                      <td>
                        <div className="trw-repo-cell">
                          <b>{item.name}</b>
                          {deptMatch && <Badge className="trw-mini-accent">부서직결</Badge>}
                          {(item.isNewRound || item._new) && <Badge className="trw-mini-accent">▲ 신규</Badge>}
                          {item.inUse && <Badge className="trw-mini-ok">사용중</Badge>}
                          {item.needsApproval && <Badge className="trw-mini-warn">결정대기</Badge>}
                        </div>
                      </td>
                      <td>{QUAD_LABELS[item.quadrant]?.code || item.quadrant}</td>
                      <td>
                        <span className="trw-ring-pill" style={{ borderColor: ringColorVar(item.ring), color: ringColorVar(item.ring) }}>
                          {RING_LABELS[item.ring]?.code || item.ring}
                        </span>
                      </td>
                      <td className="trw-num">{item.score10}/10</td>
                      <td className="trw-summary-cell">
                        {item.pilotResult?.summary || item.summary || item.why || '-'}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant={active ? 'primary' : 'secondary'}
                          onClick={() => selectItem(item, true)}
                        >
                          시뮬레이션
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 하단 컴팩트 6노드 실시간 패킷 시뮬레이션 바 */}
        <div className="trw-a-simbar">
          <div className="trw-sim-header is-compact">
            <div className="trw-sim-head-top">
              <div className="trw-sim-badges">
                <Badge className="trw-num-badge">#{selectedItem?.blipNo ? fmtBlipNo(selectedItem.blipNo) : 'AGI'}</Badge>
                <Badge>{QUAD_LABELS[selectedItem?.quadrant]?.label || 'Q1'}</Badge>
                <Badge>{RING_LABELS[selectedItem?.ring]?.label || 'TRIAL'}</Badge>
              </div>
              <span className="trw-score-readout">
                {selectedItem?.score10 || '-'}/10{selectedItem?.stars ? ` · ★ ${fmtStars(selectedItem.stars)}` : ''}
              </span>
            </div>
            <h3>
              {selectedItem?.url ? (
                <a href={selectedItem.url} target="_blank" rel="noopener noreferrer">{sim.itemName}</a>
              ) : (
                sim.itemName
              )}
            </h3>
            <p className="trw-sim-desc">{sim.scenarioTitle}</p>
            {renderScenarioLinks()}
          </div>

          {renderSimControls({ compact: true })}

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>6노드 실시간 패킷 흐름</b>
              <span>{activeSimStep ? `${activeSimStep.nodeId} · ${activeSimStep.artifact}` : sim.subtitle}</span>
            </div>
            {renderNodeCards({ compact: false })}
          </div>

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>단계별 패킷 &amp; Before/After 정량 대조</b>
              <span>{simMode === 'baseline' ? '도입 전 기준' : '도입 후 시뮬'}</span>
            </div>
            {renderStepsList({ compact: true })}
            <div className="trw-metrics-grid-2">
              {sim.metrics.map((m) => renderMetricBar(m, true))}
            </div>
          </div>

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>운영 · 원장 안전선 검증 체크리스트</b>
              <span>PR 50 5분 배포 · Tier 1 쓰기 방어</span>
            </div>
            {renderSafetyChecks()}
          </div>
        </div>
      </aside>
    </div>
  );

  // 시안 B 라이브: 4칸 플랫 KPI 스트립 + 60% 2×2 매트릭스 + 40% 슬라이드 인스펙터 시트
  const renderPlanB = () => (
    <div className="trw-plan-b" data-testid="radar-plan-view-B">
      {/* 상단 1px 수직 구분선 4칸 플랫 KPI 스트립 */}
      <div className="trw-b-kpi-strip" aria-label="스위스 모노크롬 4칸 핵심 지표">
        <div className="trw-b-kpi-cell">
          <span>전체 평가 기술</span>
          <b>{summary.counts.total}<small>건</small></b>
          <em>Q1~Q4 분류 완료</em>
        </div>
        <div className="trw-b-kpi-cell">
          <span>정식채택 · 파일럿</span>
          <b>{summary.counts.adopt + summary.counts.trial}<small>건</small></b>
          <em>ADOPT {summary.counts.adopt} · TRIAL {summary.counts.trial}</em>
        </div>
        <div className="trw-b-kpi-cell">
          <span>파일럿 실측 비율</span>
          <b>{summary.pilotMeasuredPct}<small>%</small></b>
          <em>실측 검증 {summary.pilotMeasuredCount}건 확보</em>
        </div>
        <div className="trw-b-kpi-cell">
          <span>{isAdmin ? '평균 점수 · 결정대기' : '평균 적합 점수'}</span>
          <b>{summary.avgScore}<small>/10</small></b>
          <em>{isAdmin ? `결정 대기 ${summary.counts.approval}건` : `ASSESS ${summary.counts.assess}건`}</em>
        </div>
      </div>

      {renderApprovalBar()}

      {/* 중앙 60% 매트릭스 + 우측 40% 슬라이드 인스펙터 시트 */}
      <div className="trw-b-split">
        <div className="trw-panel trw-b-main">
          <div className="trw-viz-head">
            <div>
              <b>시안 B · 2×2 임팩트 × 안전·준비도 산점도 매트릭스</b>
              <span>X축 운영·원장 안전성(0~100) · Y축 속도·업무 단축 임팩트(0~100) · {activePlanInfo.reference}</span>
            </div>
            <div className="trw-viz-meta">
              <span className="trw-count-note">표시 {matrixPoints.length} / {filteredItems.length}건</span>
              {filteredItems.length > 32 && (
                <ToggleChip on={showAllPoints} onClick={() => setShowAllPoints((v) => !v)}>
                  {showAllPoints ? '핵심 32건만' : `전체 ${filteredItems.length}건`}
                </ToggleChip>
              )}
            </div>
          </div>

          {renderMatrixSvg()}

          <div className="trw-viz-head">
            <div>
              <b>하단 핵심 지표 대조 리스트</b>
              <span>행 클릭 시 우측 Evidence &amp; Simulation Inspector Sheet가 즉시 전환됩니다.</span>
            </div>
          </div>
          <div className="trw-ledger-wrap is-plan-b">
            <table className="trw-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>기술 · 저장소</th>
                  <th>안전성 X</th>
                  <th>임팩트 Y</th>
                  <th>배치 사분면</th>
                  <th>단계</th>
                </tr>
              </thead>
              <tbody>
                {matrixPoints.map((pt) => {
                  const active = selectedItem?.name === pt.name && !activePresetId;
                  const deptMatch = deptFilter !== 'all' && (itemDeptsMap.get(pt.name) || []).includes(deptFilter);
                  return (
                    <tr key={pt.name} className={`${active ? 'is-active' : ''} ${deptMatch ? 'is-dept-match' : ''}`}>
                      <td className="trw-num">{fmtBlipNo(pt.blipNo)}</td>
                      <td>
                        <div className="trw-repo-cell">
                          <LinkButton onClick={() => selectItem(pt.item, true)}>{pt.name}</LinkButton>
                          {deptMatch && <Badge className="trw-mini-accent">부서직결</Badge>}
                        </div>
                      </td>
                      <td className="trw-num">{pt.readiness}</td>
                      <td className="trw-num">{pt.impact}</td>
                      <td>{pt.zoneLabel}</td>
                      <td>
                        <span className="trw-ring-pill" style={{ borderColor: ringColorVar(pt.ring), color: ringColorVar(pt.ring) }}>
                          {RING_LABELS[pt.ring]?.code}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="trw-panel trw-b-drawer" data-testid="radar-architecture-simulator" aria-label="Evidence and Simulation Inspector Sheet">
          <div className="trw-drawer-eyebrow">EVIDENCE &amp; SIMULATION INSPECTOR SHEET</div>
          <div className="trw-sim-header">
            <div className="trw-sim-head-top">
              <div className="trw-sim-badges">
                <Badge className="trw-num-badge">#{selectedItem?.blipNo ? fmtBlipNo(selectedItem.blipNo) : 'AGI'}</Badge>
                <Badge>{QUAD_LABELS[selectedItem?.quadrant]?.code || 'Q1'}</Badge>
                <Badge>{RING_LABELS[selectedItem?.ring]?.code || 'TRIAL'}</Badge>
              </div>
              <span className="trw-score-readout">{selectedItem?.score10 || '-'}/10</span>
            </div>
            <h3>{sim.itemName}</h3>
            <p className="trw-sim-desc">{sim.scenarioTitle}</p>
            {renderScenarioLinks()}
          </div>

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>연결 모듈 &amp; 배포 표면</b>
              <span>{sim.activeNodes.join(' -> ')}</span>
            </div>
            <div className="trw-module-chips">
              {sim.nodeDetails
                .filter((n) => n.active)
                .flatMap((n) => [n.artifact, ...(n.modules || []).slice(0, 2)])
                .slice(0, 8)
                .map((mod) => (
                  <code key={mod} className="trw-mod-pill">{mod}</code>
                ))}
            </div>
          </div>

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>Before vs After 수평 비교 막대</b>
              <span>단위 명시 · tabular-nums</span>
            </div>
            <div className="trw-metrics-list">
              {sim.metrics.map((m) => renderMetricBar(m, false))}
            </div>
          </div>

          {renderSimControls()}

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>6대 표면 노드 &amp; 단계별 패킷 재생기</b>
              <span>{activeSimStep?.nodeId}</span>
            </div>
            {renderNodeCards({ compact: true })}
            {renderStepsList()}
          </div>

          <div className="trw-section">
            <div className="trw-sec-head">
              <b>안전 가드 체크표</b>
              <span>{sim.safetyChecks.length}/{sim.safetyChecks.length} PASS</span>
            </div>
            {renderSafetyChecks()}
          </div>
        </aside>
      </div>
    </div>
  );

  // 시안 C 라이브: 매트 카본 다크 콘솔 (단축키 + 4단계 파이프라인 + 벤치마크 표 + 6노드 전술 트레이스 + 도메인별 원장)
  const groupedByQuadrant = useMemo(
    () =>
      RADAR_QUADRANTS.map((q) => ({
        quadrant: q,
        items: filteredItems.filter((x) => x.quadrant === q.id),
      })).filter((g) => g.items.length > 0),
    [filteredItems]
  );

  const renderPlanC = () => (
    <div className="trw-plan-c" data-testid="radar-plan-view-C">
      {/* 최상단: 결재 대기 배너 + 키보드 단축키 인디케이터 */}
      <div className="trw-c-top">
        {renderApprovalBar()}
        <div className="trw-c-shortcuts" data-testid="radar-c-shortcuts" aria-label="키보드 단축키 안내">
          <span className="trw-c-sc-title">TACTICAL CARBON CONSOLE · {activePlanInfo.reference}</span>
          <div className="trw-c-kbd-group">
            <span><kbd>J</kbd><kbd>K</kbd> 행 이동</span>
            <span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd> 시안 전환</span>
            <span><kbd>B</kbd> Before/After</span>
            <span><kbd>Space</kbd> 스텝 전진</span>
          </div>
        </div>
      </div>

      {/* 상단 스플릿: 4단계 Ring Progression 파이프라인 + Before/After 정량 벤치마크 대조 테이블 */}
      <div className="trw-c-upper">
        <div className="trw-panel trw-c-pipe-panel">
          {renderPipelineProgression()}
          <div className="trw-c-target-meta">
            <div>
              <span className="trw-c-meta-lbl">선택 대상</span>
              <b>{sim.itemName}</b>
            </div>
            <div>
              <span className="trw-c-meta-lbl">시나리오</span>
              <span>{sim.scenarioTitle}</span>
            </div>
            {renderScenarioLinks()}
          </div>
        </div>

        <div className="trw-panel trw-c-bench-panel">
          <div className="trw-sec-head">
            <b>Before / After 정량 벤치마크 대조 테이블</b>
            <span>{simMode === 'baseline' ? 'BASELINE 강조' : 'SIMULATED 강조'}</span>
          </div>
          <div className="trw-ledger-wrap">
            <table className="trw-table is-carbon">
              <thead>
                <tr>
                  <th>지표명</th>
                  <th>단위</th>
                  <th>도입 전 (Before)</th>
                  <th>도입 후 (After)</th>
                  <th>개선폭</th>
                  <th>구분</th>
                </tr>
              </thead>
              <tbody>
                {sim.metrics.map((m) => (
                  <tr key={m.label}>
                    <td><b>{m.label}</b></td>
                    <td className="trw-num">{m.unit}</td>
                    <td className="trw-num">{m.beforeLabel}</td>
                    <td className="trw-num trw-c-after-val">{m.afterLabel}</td>
                    <td className="trw-num trw-c-delta-val">{m.deltaLabel}</td>
                    <td><Badge className="trw-src-tag">{m.measured ? '실측' : '설계기준'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 중단: 6대 실설계 노드 전술 패킷 트레이스 콘솔 */}
      <div className="trw-panel trw-c-console" data-testid="radar-architecture-simulator">
        <div className="trw-c-console-head">
          <div>
            <b>6대 실설계 노드 전술 패킷 트레이스 콘솔</b>
            <span>실시간 단계별 레이턴시(ms) · 처리율 · 안전 가드 검증</span>
          </div>
          {renderSimControls({ compact: true })}
        </div>

        <div className="trw-c-trace-grid">
          <div className="trw-c-trace-nodes">
            {renderNodeCards({ compact: false })}
          </div>
          <div className="trw-c-trace-stream">
            <div className="trw-sec-head">
              <b>패킷 트레이스 로그</b>
              <span>STEP 0{safeStepIdx + 1}/0{Math.max(1, sim.steps.length)}</span>
            </div>
            {renderStepsList()}
            <div className="trw-sec-head" style={{ marginTop: 8 }}>
              <b>안전 가드레일</b>
              <span>무단 쓰기 차단</span>
            </div>
            {renderSafetyChecks()}
          </div>
        </div>
      </div>

      {/* 하단: 도메인 그룹별 마스터 엔지니어링 원장 테이블 (인라인 단위 막대 포함) */}
      <div className="trw-panel trw-c-master">
        <div className="trw-viz-head">
          <div>
            <b>도메인(Q1~Q4) 그룹별 마스터 엔지니어링 원장 ({filteredItems.length}건)</b>
            <span>단축키 J / K 로 행 이동 · 점수 인라인 단위 막대 표시</span>
          </div>
          <span className="trw-count-note">GROUPED BY QUADRANT</span>
        </div>

        <div className="trw-c-groups">
          {groupedByQuadrant.map((grp) => (
            <div key={grp.quadrant.id} className="trw-c-group-block">
              <div className="trw-c-group-title">
                <span>{grp.quadrant.label}</span>
                <b>{grp.items.length}건</b>
              </div>
              <table className="trw-table is-carbon">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>기술 · 저장소</th>
                    <th>단계</th>
                    <th>게이트</th>
                    <th>점수 막대 (10점)</th>
                    <th>핵심 실측 · 근거</th>
                    <th>동작</th>
                  </tr>
                </thead>
                <tbody>
                  {grp.items.map((item) => {
                    const active = selectedItem?.name === item.name && !activePresetId;
                    const deptMatch = deptFilter !== 'all' && (itemDeptsMap.get(item.name) || []).includes(deptFilter);
                    const barPct = Math.round((Number(item.score10 || 0) / 10) * 100);
                    return (
                      <tr key={item.name} className={`${active ? 'is-active' : ''} ${deptMatch ? 'is-dept-match' : ''}`}>
                        <td className="trw-num">{fmtBlipNo(item.blipNo)}</td>
                        <td>
                          <div className="trw-repo-cell">
                            <b>{item.name}</b>
                            {deptMatch && <Badge className="trw-mini-accent">부서직결</Badge>}
                            {item.language && <span className="trw-lang">{item.language}</span>}
                            {item.needsApproval && <Badge className="trw-mini-warn">결정대기</Badge>}
                          </div>
                        </td>
                        <td>
                          <span className="trw-ring-pill" style={{ borderColor: ringColorVar(item.ring), color: ringColorVar(item.ring) }}>
                            {RING_LABELS[item.ring]?.code}
                          </span>
                        </td>
                        <td className="trw-num">{PIPELINE_STAGES.find((s) => s.id === (item.ring === 'adopt' || item.inUse ? 'adopted' : item.needsApproval ? 'canary' : item.pilotResult || item.ring === 'trial' ? 'pilot' : 'scanned'))?.label}</td>
                        <td>
                          <div className="trw-inline-score">
                            <div className="trw-inline-track">
                              <span className="trw-inline-fill" style={{ width: `${barPct}%` }} />
                            </div>
                            <span className="trw-num">{item.score10}/10</span>
                          </div>
                        </td>
                        <td className="trw-summary-cell">{item.pilotResult?.summary || item.summary || item.why || '-'}</td>
                        <td>
                          <Button
                            size="sm"
                            variant={active ? 'primary' : 'secondary'}
                            onClick={() => selectItem(item, true)}
                          >
                            트레이스
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // 보고자용 통합 브리핑 보드: 상황 · 시각 흐름 그림(SVG) · 데이터 기준 4원천 표 · 부서별 실행 업무표
  const renderExecutiveStoryBoard = ({ compact = false } = {}) => {
    const origins = sim.dataOrigins || {};
    const deptRows = Array.isArray(sim.departmentMatrix) ? sim.departmentMatrix : [];
    const topMetrics = (sim.metrics || []).slice(0, 2);

    return (
      <section
        className={`trw-panel trw-story-board ${compact ? 'is-compact' : ''}`}
        data-testid="radar-executive-story-board"
        aria-label="보고자용 상황·시각흐름·데이터 기준·부서별 업무 브리핑"
      >
        <div className="trw-story-head">
          <div>
            <div className="trw-all-eyebrow">EXECUTIVE BRIEFING · SITUATION, FLOW, DATA ORIGINS &amp; DEPARTMENT PLAYBOOK</div>
            <h3>상황 · 시각 흐름 그림 · 데이터 기준 4원천 · 부서별 실행 업무</h3>
          </div>
          <div className="trw-story-badges">
            <Badge className="trw-mini-accent">관점: {activeDeptInfo.label}</Badge>
            {sim.linkedBuildItem ? (
              <Badge className="trw-mini-warn">
                연속구현 {sim.linkedBuildItem.code} · {sim.linkedBuildItem.statusLabel}
              </Badge>
            ) : (
              <Badge>{sim.primaryNode} · {sim.scenarioId}</Badge>
            )}
          </div>
        </div>

        {/* 상황 및 적용 결과 스플릿 */}
        <div className="trw-story-situation-grid">
          <div className="trw-story-sit-cell">
            <span className="trw-sit-kicker">상황 · 지금 현장에서 생기는 병목 및 원가 누수</span>
            <p>{sim.executiveBrief?.situation || '-'}</p>
          </div>
          <div className="trw-story-sit-cell is-outcome">
            <span className="trw-sit-kicker is-ok">도입 결과 · 바뀌는 업무와 정량 개선 효과</span>
            <p>{sim.executiveBrief?.outcome || '-'}</p>
          </div>
        </div>

        {/* SVG 시각 흐름 그림: [원천 3대 입력] -> [판정 기준식 & 엔진] -> [4대 부서 실행] -> [원가·이익 결과] */}
        <div className="trw-flow-wrap" data-testid="radar-flow-diagram">
          <svg
            className="trw-flow-svg"
            viewBox="0 0 960 216"
            role="img"
            aria-label="이메일, 사내 담당자, 거래처 원천 데이터에서 판정 기준식과 4대 부서 실행 화면을 거쳐 원가절감 및 이익증대로 이어지는 흐름 그림"
          >
            <defs>
              <marker id="trw-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--trw-accent)" />
              </marker>
            </defs>

            {/* 단계 헤더 라벨 */}
            <text x="14" y="18" fill="var(--trw-muted)" fontSize="10" fontWeight="700">01 원천 데이터 입력 (어디서 왔는가)</text>
            <text x="266" y="18" fill="var(--trw-muted)" fontSize="10" fontWeight="700">02 판정 기준식 &amp; 레이더·AGI 엔진</text>
            <text x="514" y="18" fill="var(--trw-muted)" fontSize="10" fontWeight="700">03 4대 부서 실행 화면</text>
            <text x="762" y="18" fill="var(--trw-muted)" fontSize="10" fontWeight="700">04 원가절감 · 이익증대 결과</text>

            {/* Col 1: 3대 입력 원천 */}
            <g>
              <rect x="14" y="30" width="212" height="48" rx="4" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
              <text x="24" y="48" fill="var(--trw-accent)" fontSize="10.5" fontWeight="700">이메일 · 외부 첨부서류</text>
              <text x="24" y="66" fill="var(--trw-ink)" fontSize="10.5">{clipText(origins.emailDoc, 28)}</text>

              <rect x="14" y="88" width="212" height="48" rx="4" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
              <text x="24" y="106" fill="var(--trw-accent)" fontSize="10.5" fontWeight="700">사내 담당자 · 카톡 원문</text>
              <text x="24" y="124" fill="var(--trw-ink)" fontSize="10.5">{clipText(origins.staffInput, 28)}</text>

              <rect x="14" y="146" width="212" height="48" rx="4" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
              <text x="24" y="164" fill="var(--trw-accent)" fontSize="10.5" fontWeight="700">해외 농장 · 국내 거래처</text>
              <text x="24" y="182" fill="var(--trw-ink)" fontSize="10.5">{clipText(origins.partnerData, 28)}</text>
            </g>

            {/* Col 1 -> Col 2 연결선 */}
            <path d="M 226 54 L 246 54 L 246 108 L 264 108" fill="none" stroke="var(--trw-accent)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 226 112 L 264 112" fill="none" stroke="var(--trw-accent)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 226 170 L 246 170 L 246 116 L 264 116" fill="none" stroke="var(--trw-accent)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />

            {/* Col 2: 판정 기준식 & 엔진 */}
            <g>
              <rect x="266" y="30" width="208" height="164" rx="4" fill="var(--trw-surface)" stroke="var(--trw-accent)" strokeWidth="1.4" />
              <rect x="266" y="30" width="208" height="26" rx="4" fill="var(--trw-surface-2)" />
              <text x="276" y="47" fill="var(--trw-accent)" fontSize="10.5" fontWeight="700">
                판정 기준 · {sim.primaryNode} ({sim.activeNodes.join('→')})
              </text>
              <text x="276" y="76" fill="var(--trw-ink)" fontSize="11" fontWeight="700">
                {clipText(sim.itemName, 26)}
              </text>
              <text x="276" y="98" fill="var(--trw-muted)" fontSize="10">핵심 기준식:</text>
              <text x="276" y="114" fill="var(--trw-ink)" fontSize="10.5">
                {clipText(origins.thresholdRule, 26)}
              </text>
              <text x="276" y="131" fill="var(--trw-muted)" fontSize="10">
                {clipText(String(origins.thresholdRule || '').slice(26), 28)}
              </text>
              <line x1="276" y1="146" x2="464" y2="146" stroke="var(--trw-line)" strokeWidth="1" />
              <text x="276" y="164" fill="var(--trw-ok)" fontSize="10.5" fontWeight="700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {`STEP 0${safeStepIdx + 1}/0${Math.max(1, sim.steps.length)} · ${activeSimStep?.latencyMs ?? 0}ms`}
              </text>
              <text x="276" y="181" fill="var(--trw-muted)" fontSize="10">
                {clipText(activeSimStep?.artifact || sim.subtitle, 28)}
              </text>
            </g>

            {/* Col 2 -> Col 3 연결선 */}
            <path d="M 474 112 L 494 112 L 494 49 L 512 49" fill="none" stroke="var(--trw-accent)" strokeWidth="1.2" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 474 112 L 494 112 L 494 91 L 512 91" fill="none" stroke="var(--trw-accent)" strokeWidth="1.2" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 474 112 L 494 112 L 494 133 L 512 133" fill="none" stroke="var(--trw-accent)" strokeWidth="1.2" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 474 112 L 494 112 L 494 175 L 512 175" fill="none" stroke="var(--trw-accent)" strokeWidth="1.2" markerEnd="url(#trw-flow-arrow)" />

            {/* Col 3: 4대 부서 실행 화면 */}
            {deptRows.slice(0, 4).map((row, idx) => {
              const y = 30 + idx * 42;
              const isFocus = deptFilter === row.deptId || (deptFilter === 'all' && row.impactLevel === '핵심');
              return (
                <g key={row.deptId} opacity={deptFilter === 'all' || deptFilter === row.deptId ? 1 : 0.48}>
                  <rect
                    x="514"
                    y={y}
                    width="208"
                    height="36"
                    rx="4"
                    fill="var(--trw-surface-2)"
                    stroke={isFocus ? 'var(--trw-ok)' : 'var(--trw-line)'}
                    strokeWidth={isFocus ? '1.4' : '1'}
                  />
                  <text x="524" y={y + 15} fill={isFocus ? 'var(--trw-ok)' : 'var(--trw-ink)'} fontSize="10.5" fontWeight="700">
                    {`${row.deptName} · ${row.impactLevel}`}
                  </text>
                  <text x="524" y={y + 29} fill="var(--trw-muted)" fontSize="9.8">
                    {`${row.route} · ${clipText(row.routeLabel, 14)}`}
                  </text>
                </g>
              );
            })}

            {/* Col 3 -> Col 4 연결선 */}
            <path d="M 722 49 L 742 49 L 742 108 L 760 108" fill="none" stroke="var(--trw-ok)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 722 91 L 742 91 L 742 112 L 760 112" fill="none" stroke="var(--trw-ok)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 722 133 L 742 133 L 742 116 L 760 116" fill="none" stroke="var(--trw-ok)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />
            <path d="M 722 175 L 742 175 L 742 120 L 760 120" fill="none" stroke="var(--trw-ok)" strokeWidth="1.3" markerEnd="url(#trw-flow-arrow)" />

            {/* Col 4: 기대 효과 & 승인 가드 */}
            <g>
              <rect x="762" y="30" width="184" height="164" rx="4" fill="var(--trw-surface)" stroke="var(--trw-ok)" strokeWidth="1.4" />
              <rect x="762" y="30" width="184" height="26" rx="4" fill="var(--trw-ok-bg)" />
              <text x="772" y="47" fill="var(--trw-ok-ink)" fontSize="10.5" fontWeight="700">원가절감 · 이익증대 결과</text>
              {topMetrics.map((m, mIdx) => {
                const my = 76 + mIdx * 44;
                return (
                  <g key={m.label}>
                    <text x="772" y={my} fill="var(--trw-muted)" fontSize="9.8">{clipText(m.label, 22)}</text>
                    <text x="772" y={my + 16} fill="var(--trw-ok)" fontSize="11" fontWeight="700" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {clipText(`${m.beforeLabel} → ${m.afterLabel}`, 24)}
                    </text>
                  </g>
                );
              })}
              <line x1="772" y1="158" x2="936" y2="158" stroke="var(--trw-line)" strokeWidth="1" />
              <text x="772" y="177" fill="var(--trw-ink)" fontSize="10" fontWeight="700">
                ApprovedBy 승인 후 원장 반영
              </text>
            </g>
          </svg>
        </div>

        {/* 표 1 (데이터 기준 4원천) + 표 2 (부서별 실행 업무) */}
        <div className="trw-story-tables-grid">
          <div className="trw-story-table-box" data-testid="radar-data-origins-table">
            <div className="trw-sec-head">
              <b>표 1 · 데이터 기준 4원천 명세표 (이메일 · 담당자 · 거래처 · 판정식)</b>
              <span>기준 데이터 출처</span>
            </div>
            <table className="trw-table">
              <thead>
                <tr>
                  <th>원천 구분</th>
                  <th>수집 기준 데이터 (어디서 기준을 잡았는가)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="trw-num">1. 이메일 · 서류</td>
                  <td>{origins.emailDoc || '-'}</td>
                </tr>
                <tr>
                  <td className="trw-num">2. 사내 담당자</td>
                  <td>{origins.staffInput || '-'}</td>
                </tr>
                <tr>
                  <td className="trw-num">3. 거래처 · 농장</td>
                  <td>{origins.partnerData || '-'}</td>
                </tr>
                <tr>
                  <td className="trw-num">4. 판정 기준식</td>
                  <td className="trw-rule-cell">{origins.thresholdRule || '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="trw-story-table-box" data-testid="radar-department-matrix-table">
            <div className="trw-sec-head">
              <b>표 2 · 부서별 실행 업무표 (수입부 · 영업부 · 출고창고 · 경영정산)</b>
              <span>부서명 클릭 시 관점 필터 전환</span>
            </div>
            <table className="trw-table">
              <thead>
                <tr>
                  <th>부서</th>
                  <th>직결</th>
                  <th>실행 업무 변화 (도입 후 1줄) &amp; 기준</th>
                  <th>연결 화면</th>
                </tr>
              </thead>
              <tbody>
                {deptRows.map((row) => {
                  const isDeptFocus = deptFilter === row.deptId;
                  return (
                    <tr key={row.deptId} className={isDeptFocus ? 'is-dept-match is-active' : ''}>
                      <td className="trw-num">
                        <LinkButton onClick={() => setDeptFilter(isDeptFocus ? 'all' : row.deptId)}>
                          {row.deptName}
                        </LinkButton>
                      </td>
                      <td>
                        <Badge className={row.impactLevel === '핵심' ? 'trw-mini-ok' : 'trw-mini-accent'}>
                          {row.impactLevel}
                        </Badge>
                      </td>
                      <td>
                        <div className="trw-dept-role">{row.roleChange}</div>
                        <div className="trw-dept-basis">기준: {row.dataBasis}</div>
                      </td>
                      <td className="trw-num">
                        <a href={row.route} className="trw-inline-route">
                          {row.routeLabel} ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  };

  // 하단: A·B·C 동시모드 연속 구현 파이프라인 (Continuous AGI Build Factory)
  const renderContinuousBuildQueue = () => (
    <section
      className="trw-panel trw-build-factory"
      data-testid="radar-continuous-build-queue"
      aria-label="A·B·C 동시모드 연속 구현 파이프라인"
    >
      <div className="trw-build-head">
        <div>
          <div className="trw-all-eyebrow">CONTINUOUS AGI BUILD FACTORY · 4-STAGE AUTONOMOUS EXPANSION QUEUE</div>
          <h3>A·B·C 동시모드 연속 구현 파이프라인 (추가 발굴 · 즉시 구현 확장 큐)</h3>
          <p className="trw-sim-desc">
            기존 5대 레버 외에 현업 데이터에서 추가 발굴한 고효율·고수익 모듈 후보입니다. 각 과제를 A·B·C 3종 동시 시뮬레이션으로 미리 검증한 뒤 구현 지시서를 복사해 바로 개발을 이어갈 수 있습니다.
          </p>
        </div>
        <div className="trw-build-meta">
          <Badge className="trw-mini-accent">부서: {activeDeptInfo.label}</Badge>
          <span className="trw-count-note">
            표시 {filteredBuildItems.length} / 전체 {CONTINUOUS_BUILD_PIPELINE.length}건
          </span>
        </div>
      </div>

      {/* 4단계 칸반/원장 상태 스트립 + 필터 칩 */}
      <div className="trw-build-stage-filter">
        <span className="trw-filter-label">단계 필터</span>
        <ToggleChip on={buildStageFilter === 'all'} onClick={() => setBuildStageFilter('all')}>
          전체 ({deptScopedBuildItems.length})
        </ToggleChip>
        {BUILD_PIPELINE_STAGES.map((stg) => {
          const cnt = buildSummary.byStage[stg.id] || 0;
          return (
            <ToggleChip
              key={stg.id}
              on={buildStageFilter === stg.id}
              onClick={() => setBuildStageFilter(buildStageFilter === stg.id ? 'all' : stg.id)}
            >
              {stg.shortLabel} ({cnt})
            </ToggleChip>
          );
        })}
      </div>

      <div className="trw-build-stages-strip">
        {BUILD_PIPELINE_STAGES.map((stg) => {
          const stageItems = deptScopedBuildItems.filter((b) => b.status === stg.id);
          const isActiveStage = buildStageFilter === stg.id;
          return (
            <div key={stg.id} className={`trw-build-stage-col ${isActiveStage ? 'is-current' : ''}`}>
              <div className="trw-pipe-head">
                <span className="trw-pipe-no">0{stg.order + 1}</span>
                <span className="trw-pipe-code">{stg.code}</span>
                <b className="trw-pipe-cnt">{stageItems.length}건</b>
              </div>
              <div className="trw-pipe-label">{stg.label}</div>
              <div className="trw-pipe-desc">{stg.desc}</div>
              <div className="trw-stage-codes">
                {stageItems.map((it) => (
                  <code key={it.id} className="trw-mod-pill">{it.code}</code>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 고밀도 연속 구현 과제 테이블 */}
      <div className="trw-ledger-wrap is-build-queue">
        <table className="trw-table" data-testid="radar-build-queue-table">
          <thead>
            <tr>
              <th>코드 · 상태</th>
              <th>추가 구현 모듈 &amp; 대상 부서 · 화면</th>
              <th>기대 이익 · 단축 수치</th>
              <th>데이터 기준 (이메일 · 담당자 · 거래처)</th>
              <th>시뮬 재생 · 지시서 복사</th>
            </tr>
          </thead>
          <tbody>
            {filteredBuildItems.map((b) => {
              const isPlayingThis = activeBuildId === b.id;
              const isCopied = copiedBuildId === b.id;
              const isPreviewOpen = previewBriefId === b.id;
              return [
                <tr key={b.id} className={isPlayingThis ? 'is-active' : ''}>
                  <td className="trw-num">
                    <div className="trw-build-code-cell">
                      <b>{b.code}</b>
                      <Badge className={buildStatusToneClass(b.status)}>
                        {b.status} {b.statusLabel}
                      </Badge>
                    </div>
                  </td>
                  <td>
                    <div className="trw-build-title">{b.title}</div>
                    <div className="trw-build-tags">
                      {b.departmentLabels.map((lbl) => (
                        <Badge key={lbl}>{lbl}</Badge>
                      ))}
                      {b.targetRoutes.map((rt) => (
                        <code key={rt} className="trw-mod-pill">{rt}</code>
                      ))}
                    </div>
                  </td>
                  <td className="trw-impact-cell">{b.expectedImpact}</td>
                  <td className="trw-summary-cell">{b.dataBasisSummary}</td>
                  <td>
                    <div className="trw-build-actions">
                      <Button
                        size="sm"
                        variant={isPlayingThis ? 'primary' : 'secondary'}
                        onClick={() => playBuildItemSimulation(b)}
                      >
                        A·B·C 3종 동시 시뮬레이션으로 미리 재생
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => copyAgentBrief(b)}
                      >
                        이 기능 구현 지시서 복사
                      </Button>
                      <div className="trw-build-subactions">
                        {isCopied && <Badge className="trw-mini-ok">복사 완료</Badge>}
                        <LinkButton onClick={() => setPreviewBriefId(isPreviewOpen ? '' : b.id)}>
                          {isPreviewOpen ? '지시서 닫기' : '지시서 전문'}
                        </LinkButton>
                      </div>
                    </div>
                  </td>
                </tr>,
                isPreviewOpen ? (
                  <tr key={`${b.id}-preview`} className="trw-brief-row">
                    <td colSpan={5}>
                      <pre className="trw-brief-pre">{b.agentBriefText}</pre>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );

  // 시안 A·B·C 3종 동시 비교 시뮬레이션 (ALL)
  const compareLedgerRows = useMemo(() => {
    const base = filteredItems.slice(0, 6);
    if (selectedItem && filteredItems.includes(selectedItem) && !base.some((x) => x.name === selectedItem.name)) {
      return [...base.slice(0, 5), selectedItem];
    }
    return base;
  }, [filteredItems, selectedItem]);

  const renderPlanAll = () => (
    <div className="trw-plan-all" data-testid="radar-plan-view-ALL">
      {/* 통합 시뮬레이션 마스터 컨트롤 바 */}
      <div className="trw-all-master" data-testid="radar-all-master-controls">
        <div className="trw-all-master-info">
          <div className="trw-all-eyebrow">3-DESIGN SYNCHRONIZED SIMULATOR · ALL ABC LIVE</div>
          <div className="trw-all-target">
            <b>{sim.itemName}</b>
            <span>{sim.scenarioTitle}</span>
          </div>
          {renderScenarioLinks()}
        </div>

        <div className="trw-all-master-actions">
          <Button
            size="sm"
            variant={playing ? 'primary' : 'secondary'}
            disabled={reducedMotion}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? '전체 시안 일시정지' : '전체 시안 동시 재생'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setPlaying(false);
              setStepIdx((prev) => (sim.steps.length ? (prev + 1) % sim.steps.length : 0));
            }}
          >
            다음 스텝 동시 전진
          </Button>
          <ToggleChip on={simMode === 'baseline'} onClick={() => setSimMode('baseline')}>
            Before 기준선
          </ToggleChip>
          <ToggleChip on={simMode === 'simulated'} onClick={() => setSimMode('simulated')}>
            After 도입후
          </ToggleChip>
          <span className="trw-step-counter">
            STEP 0{safeStepIdx + 1} / 0{Math.max(1, sim.steps.length)} · {activeSimStep?.nodeId || 'N4'}
          </span>
        </div>
      </div>

      {/* 보고자용 상황 · 시각 흐름 그림 · 데이터 기준 4원천 · 부서별 업무 */}
      {renderExecutiveStoryBoard({ compact: false })}

      {/* 3개 시안 라이브 비교 뷰포트 그리드 */}
      <div className="trw-all-grid" data-testid="radar-architecture-simulator">
        {/* 뷰포트 A: 에디토리얼 레이더 */}
        <section
          className="trw-compare-card"
          data-testid="radar-compare-panel-A"
          style={getPlanTokenVars('A')}
          aria-label="시안 A 동시 비교 뷰포트"
        >
          <header className="trw-cmp-head">
            <div>
              <span className="trw-cmp-tag">PLAN A · LIGHT EDITORIAL</span>
              <h3>시안 A · 극좌표 레이더 + 요약 원장</h3>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setPlanMode('A')}>
              시안 A 확대
            </Button>
          </header>

          {renderPolarSvg({ compact: true })}

          <div className="trw-cmp-subhead">
            <b>요약 원장 동기화</b>
            <span>{selectedItem?.name || sim.itemName}</span>
          </div>
          <div className="trw-ledger-wrap is-compact">
            <table className="trw-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>기술명</th>
                  <th>단계</th>
                  <th>점수</th>
                </tr>
              </thead>
              <tbody>
                {compareLedgerRows.map((item) => {
                  const active = selectedItem?.name === item.name && !activePresetId && !activeBuildId;
                  const deptMatch = deptFilter !== 'all' && (itemDeptsMap.get(item.name) || []).includes(deptFilter);
                  return (
                    <tr key={item.name} className={`${active ? 'is-active' : ''} ${deptMatch ? 'is-dept-match' : ''}`}>
                      <td className="trw-num">{fmtBlipNo(item.blipNo)}</td>
                      <td>
                        <LinkButton onClick={() => selectItem(item, false)}>{item.name.split('/').pop()}</LinkButton>
                        {deptMatch && <Badge className="trw-mini-accent">직결</Badge>}
                      </td>
                      <td>
                        <span className="trw-ring-pill" style={{ borderColor: ringColorVar(item.ring), color: ringColorVar(item.ring) }}>
                          {RING_LABELS[item.ring]?.code}
                        </span>
                      </td>
                      <td className="trw-num">{item.score10}/10</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {activeSimStep && (
            <div className="trw-cmp-step-box">
              <b>{activeSimStep.nodeId} · {activeSimStep.artifact}</b>
              <p>{simMode === 'baseline' ? activeSimStep.beforeNote : activeSimStep.afterNote}</p>
            </div>
          )}
        </section>

        {/* 뷰포트 B: 2×2 매트릭스 + Before/After 막대 */}
        <section
          className="trw-compare-card"
          data-testid="radar-compare-panel-B"
          style={getPlanTokenVars('B')}
          aria-label="시안 B 동시 비교 뷰포트"
        >
          <header className="trw-cmp-head">
            <div>
              <span className="trw-cmp-tag">PLAN B · SWISS MONOCHROME</span>
              <h3>시안 B · 2×2 매트릭스 + Before/After</h3>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setPlanMode('B')}>
              시안 B 확대
            </Button>
          </header>

          {renderMatrixSvg({ compact: true })}

          <div className="trw-cmp-subhead">
            <b>Before / After 수평 비교 막대</b>
            <span>{simMode === 'baseline' ? '도입 전 기준' : '도입 후 효과'}</span>
          </div>
          <div className="trw-metrics-list">
            {sim.metrics.map((m) => renderMetricBar(m, true))}
          </div>
        </section>

        {/* 뷰포트 C: 매트 카본 전술 파이프라인 & 노드 트레이스 */}
        <section
          className="trw-compare-card is-carbon-card"
          data-testid="radar-compare-panel-C"
          style={getPlanTokenVars('C')}
          aria-label="시안 C 동시 비교 뷰포트"
        >
          <header className="trw-cmp-head">
            <div>
              <span className="trw-cmp-tag">PLAN C · MATTE CARBON DARK</span>
              <h3>시안 C · 카본 전술 파이프라인 &amp; 트레이스</h3>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setPlanMode('C')}>
              시안 C 확대
            </Button>
          </header>

          {renderPipelineProgression({ compact: true })}

          <div className="trw-cmp-subhead">
            <b>6노드 실시간 패킷 트레이스</b>
            <span>STEP 0{safeStepIdx + 1}/0{Math.max(1, sim.steps.length)}</span>
          </div>
          {renderNodeCards({ compact: true })}

          {activeSimStep && (
            <div className="trw-cmp-step-box">
              <b>{activeSimStep.nodeId} · {activeSimStep.latencyMs}ms · {activeSimStep.throughput}</b>
              <p>{activeSimStep.packetSummary}</p>
            </div>
          )}

          <div className="trw-cmp-safety-pills">
            {sim.safetyChecks.map((chk) => (
              <Badge key={chk.id} className="trw-mini-ok">{chk.status} · {chk.label}</Badge>
            ))}
          </div>
        </section>
      </div>

      {/* 하단: A·B·C 동시모드 연속 구현 파이프라인 */}
      {renderContinuousBuildQueue()}
    </div>
  );

  return (
    <section
      className={standaloneUiStyles ? 'pm trw-root' : 'trw-root'}
      style={rootStyle}
      data-wb-mode={mode}
      data-plan-mode={planMode}
      data-testid="tech-radar-workbench"
    >
      {standaloneUiStyles && <PmUiStyles />}

      {/* 1. 상단 1px 헤어라인 요약 & 시안 스위처 스트립 */}
      <header className="trw-topbar">
        <div className="trw-title-wrap">
          <div className="trw-eyebrow">
            ENGINEERING RADAR WORKBENCH · NENOVAKAKAO × ORBIT × NENOVAWEB · {activePlanInfo.code}
          </div>
          <div className="trw-title-row">
            <h2>{title}</h2>
            {onOpenSuiteSim && (
              <Button size="sm" variant="secondary" onClick={onOpenSuiteSim}>
                통합 솔루션 시뮬레이터 열기 ↗
              </Button>
            )}
          </div>
          <p className="trw-subtitle">{subtitle}</p>
        </div>

        <div className="trw-kpi-strip" aria-label="기술 레이더 단계별 건수">
          <div className="trw-kpi-cell">
            <span className="trw-kpi-label">채택 ADOPT</span>
            <b className="trw-kpi-val is-ok">{summary.counts.adopt}</b>
          </div>
          <div className="trw-kpi-cell">
            <span className="trw-kpi-label">파일럿 TRIAL</span>
            <b className="trw-kpi-val is-accent">{summary.counts.trial}</b>
          </div>
          <div className="trw-kpi-cell">
            <span className="trw-kpi-label">검토 ASSESS</span>
            <b className="trw-kpi-val is-warn">{summary.counts.assess}</b>
          </div>
          <div className="trw-kpi-cell">
            <span className="trw-kpi-label">보류 HOLD</span>
            <b className="trw-kpi-val">{summary.counts.hold}</b>
          </div>
          {isAdmin && (
            <div className="trw-kpi-cell is-highlight">
              <span className="trw-kpi-label">결정 대기</span>
              <b className="trw-kpi-val is-warn">{summary.counts.approval}</b>
            </div>
          )}
        </div>
      </header>

      {/* 2. 디자인 시안 A·B·C + 3종 동시 비교 스위처 & 핵심 시나리오 프리셋 칩 */}
      <div className="trw-toolbar">
        <div className="trw-plan-bar" data-testid="radar-plan-switcher">
          <Tabs
            label="디자인 시안 및 시뮬레이션 모드"
            value={planMode}
            onChange={setPlanMode}
            className="trw-view-tabs"
            items={RADAR_PLAN_MODES.map((p) => [p.id, p.label])}
          />
          <span className="trw-plan-note">{activePlanInfo.summary}</span>
        </div>

        <div className="trw-preset-bar" data-testid="radar-scenario-presets" aria-label="실설계 시나리오 빠른 프리셋">
          <span className="trw-filter-label">핵심 시나리오</span>
          {SIM_PRESETS.map((preset) => (
            <ToggleChip
              key={preset.id}
              on={activePresetId === preset.id || (!activePresetId && !activeBuildId && sim.scenarioId === preset.scenarioId)}
              onClick={() => selectPreset(preset, true)}
            >
              <span>{preset.label}</span>
              <span className="trw-preset-badge">{preset.badge}</span>
            </ToggleChip>
          ))}
        </div>

        <div className="trw-dept-bar" data-testid="radar-department-filter" aria-label="부서별 관점 필터">
          <span className="trw-filter-label">부서별 관점</span>
          <div className="trw-filter-group">
            {RADAR_DEPARTMENTS.map((dept) => (
              <ToggleChip
                key={dept.id}
                on={deptFilter === dept.id}
                onClick={() => setDeptFilter(dept.id)}
              >
                {dept.shortLabel}
              </ToggleChip>
            ))}
          </div>
          <span className="trw-dept-readout">
            직결 기술 {deptMatchedCatalogCount}건 · 연속구현 {filteredBuildItems.length}건
          </span>
          {deptFilter !== 'all' && (
            <LinkButton onClick={() => setDeptFilter('all')}>전사 보기</LinkButton>
          )}
        </div>

        <div className="trw-filters">
          <div className="trw-filter-group">
            <span className="trw-filter-label">분면</span>
            <ToggleChip on={!quadFilter} onClick={() => setQuadFilter('')}>전체</ToggleChip>
            {RADAR_QUADRANTS.map((q) => (
              <ToggleChip
                key={q.id}
                on={quadFilter === q.id}
                onClick={() => setQuadFilter(quadFilter === q.id ? '' : q.id)}
              >
                {q.code} {q.shortLabel}
              </ToggleChip>
            ))}
          </div>

          <div className="trw-filter-group">
            <span className="trw-filter-label">단계</span>
            <ToggleChip on={!ringFilter} onClick={() => setRingFilter('')}>전체</ToggleChip>
            {RADAR_RINGS.map((r) => (
              <ToggleChip
                key={r.id}
                on={ringFilter === r.id}
                onClick={() => setRingFilter(ringFilter === r.id ? '' : r.id)}
              >
                {r.code}
              </ToggleChip>
            ))}
          </div>

          <div className="trw-search-group">
            <input
              type="search"
              className="trw-search"
              aria-label="기술 또는 저장소 검색"
              placeholder="저장소·기술·키워드 검색…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(deptFilter !== 'all' || buildStageFilter !== 'all' || quadFilter || ringFilter || query) && (
              <LinkButton onClick={clearFilters}>초기화</LinkButton>
            )}
          </div>
        </div>
      </div>

      {/* 3. 본문: 시안 A / B / C / ALL 라이브 뷰 */}
      {!allItems.length && !activePresetId && !activeBuildId ? (
        <EmptyState
          title="표시할 기술 레이더 항목이 없습니다"
          action={
            <Button variant="primary" onClick={() => selectPreset(SIM_PRESETS[0], true)}>
              가브리엘 원가·이익 AGI 시뮬레이션 열기
            </Button>
          }
        >
          데이터가 업로드되면 4분면 레이더와 파이프라인 도입 시뮬레이터가 자동으로 활성화됩니다. 위 프리셋 칩으로 시뮬레이션을 먼저 실행할 수도 있습니다.
        </EmptyState>
      ) : (
        <>
          {planMode === 'A' && renderPlanA()}
          {planMode === 'B' && renderPlanB()}
          {planMode === 'C' && renderPlanC()}
          {planMode === 'ALL' && renderPlanAll()}
          {planMode !== 'ALL' && (
            <>
              {renderExecutiveStoryBoard({ compact: true })}
              {renderContinuousBuildQueue()}
            </>
          )}
        </>
      )}

      <style jsx>{`
        .trw-root {
          --trw-bg: var(--pm-bg, rgb(248, 250, 252));
          --trw-surface: var(--pm-surface, rgb(255, 255, 255));
          --trw-surface-2: var(--pm-surface2, rgb(241, 245, 249));
          --trw-ink: var(--pm-ink, rgb(15, 23, 42));
          --trw-muted: var(--pm-muted, rgb(71, 85, 105));
          --trw-line: var(--pm-line, rgb(226, 232, 240));
          --trw-accent: var(--pm-accent, rgb(29, 78, 216));
          --trw-accent-ink: var(--pm-accent-ink, rgb(255, 255, 255));
          --trw-ok: var(--pm-ok, rgb(21, 128, 61));
          --trw-ok-bg: var(--pm-ok-bg, rgb(220, 252, 231));
          --trw-ok-ink: var(--pm-ok-ink, rgb(20, 83, 45));
          --trw-warn: var(--pm-idle, rgb(180, 83, 9));
          --trw-warn-bg: var(--pm-idle-bg, rgb(254, 243, 199));
          --trw-warn-ink: var(--pm-idle-ink, rgb(120, 53, 15));
          --trw-err: var(--pm-err, rgb(185, 28, 28));
          --trw-link: var(--pm-link, rgb(29, 78, 216));
          --trw-radius: 6px;
          background: var(--trw-bg);
          color: var(--trw-ink);
          border: 1px solid var(--trw-line);
          padding: 12px;
          border-radius: var(--trw-radius);
          font-size: 13px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          box-shadow: none;
        }
        .trw-root[data-wb-mode="clear"][data-plan-mode="ALL"] {
          --trw-bg: var(--pm-bg, rgb(248, 250, 252));
          --trw-surface: var(--pm-surface, rgb(255, 255, 255));
          --trw-surface-2: var(--pm-surface2, rgb(241, 245, 249));
          --trw-ink: var(--pm-ink, rgb(15, 23, 42));
          --trw-muted: var(--pm-muted, rgb(71, 85, 105));
          --trw-line: var(--pm-line, rgb(226, 232, 240));
          --trw-accent: var(--pm-accent, rgb(29, 78, 216));
          --trw-accent-ink: var(--pm-accent-ink, rgb(255, 255, 255));
          --trw-ok: var(--pm-ok, rgb(21, 128, 61));
          --trw-ok-bg: var(--pm-ok-bg, rgb(220, 252, 231));
          --trw-ok-ink: var(--pm-ok-ink, rgb(20, 83, 45));
          --trw-warn: var(--pm-idle, rgb(180, 83, 9));
          --trw-warn-bg: var(--pm-idle-bg, rgb(254, 243, 199));
          --trw-warn-ink: var(--pm-idle-ink, rgb(120, 53, 15));
          --trw-err: var(--pm-err, rgb(185, 28, 28));
          --trw-link: var(--pm-link, rgb(29, 78, 216));
        }

        .trw-topbar,
        .trw-toolbar,
        .trw-panel {
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
        }
        .trw-topbar {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          gap: 12px;
          flex-wrap: wrap;
          padding: 12px 14px;
        }
        .trw-title-wrap { flex: 1 1 460px; min-width: 0; }
        .trw-eyebrow {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--trw-muted);
          margin-bottom: 3px;
        }
        .trw-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .trw-title-row h2 { margin: 0; border-bottom: 0; padding-bottom: 0; font-size: 18px; font-weight: 700; color: var(--trw-ink); letter-spacing: -0.01em; }
        .trw-subtitle { margin: 4px 0 0; font-size: 12px; color: var(--trw-muted); line-height: 1.45; }

        .trw-kpi-strip {
          display: flex;
          align-items: stretch;
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          overflow: hidden;
          background: var(--trw-surface-2);
          align-self: center;
        }
        .trw-kpi-cell {
          padding: 7px 12px;
          border-right: 1px solid var(--trw-line);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
          min-width: 76px;
        }
        .trw-kpi-cell:last-child { border-right: 0; }
        .trw-kpi-cell.is-highlight { background: var(--trw-warn-bg); }
        .trw-kpi-label { font-size: 10px; font-weight: 700; color: var(--trw-muted); white-space: nowrap; }
        .trw-kpi-val { font-size: 17px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; color: var(--trw-ink); }
        .trw-kpi-val.is-ok { color: var(--trw-ok); }
        .trw-kpi-val.is-accent { color: var(--trw-accent); }
        .trw-kpi-val.is-warn { color: var(--trw-warn); }

        .trw-toolbar {
          padding: 8px 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .trw-plan-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 4px;
        }
        .trw-plan-bar :global(.trw-view-tabs) { flex: 1 1 520px; }
        .trw-plan-note { font-size: 11.5px; color: var(--trw-muted); }

        .trw-preset-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--trw-line);
        }
        .trw-preset-badge {
          margin-left: 6px;
          font-size: 10px;
          opacity: 0.78;
          font-variant-numeric: tabular-nums;
        }

        .trw-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
        .trw-filter-group { display: flex; align-items: center; flex-wrap: wrap; gap: 3px; }
        .trw-filter-label { font-size: 11px; font-weight: 700; color: var(--trw-muted); margin-right: 4px; white-space: nowrap; }
        .trw-search-group { display: flex; align-items: center; gap: 8px; margin-left: auto; }
        .trw-search {
          background: var(--trw-surface-2);
          color: var(--trw-ink);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 4px 9px;
          font: inherit;
          font-size: 12px;
          min-width: 190px;
        }

        .trw-approval-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-left: 3px solid var(--trw-warn);
          border-radius: var(--trw-radius);
          padding: 7px 10px;
        }
        .trw-approval-head { font-size: 11.5px; font-weight: 700; color: var(--trw-warn); white-space: nowrap; }
        .trw-approval-list { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
        .trw-approval-item {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 2px 5px 2px 8px;
        }
        .trw-approval-item.is-active { border-color: var(--trw-accent); }
        .trw-approval-name { font-size: 11.5px; font-weight: 700; color: var(--trw-ink); }
        .trw-approval-score { font-size: 11px; color: var(--trw-muted); font-variant-numeric: tabular-nums; }

        /* 시안 A 레이아웃: 44% : 56% */
        .trw-plan-a {
          display: grid;
          grid-template-columns: minmax(0, 44fr) minmax(0, 56fr);
          gap: 12px;
          align-items: start;
        }
        .trw-a-left,
        .trw-a-right {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .trw-legend-strip {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          font-size: 11px;
          color: var(--trw-muted);
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 4px 9px;
        }
        .trw-legend-strip b { color: var(--trw-accent); margin-right: 2px; }
        .trw-legend-ref { margin-left: auto; font-weight: 600; }
        .trw-a-simbar {
          border-top: 2px solid var(--trw-line);
          padding-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trw-metrics-grid-2 {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 7px;
        }

        /* 시안 B 레이아웃: 4칸 플랫 KPI + 60% 매트릭스 + 40% 인스펙터 */
        .trw-plan-b { display: flex; flex-direction: column; gap: 10px; }
        .trw-b-kpi-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
        }
        .trw-b-kpi-cell {
          padding: 10px 14px;
          border-right: 1px solid var(--trw-line);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .trw-b-kpi-cell:last-child { border-right: 0; }
        .trw-b-kpi-cell span { font-size: 11px; font-weight: 700; color: var(--trw-muted); }
        .trw-b-kpi-cell b { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--trw-ink); line-height: 1.2; }
        .trw-b-kpi-cell small { font-size: 12px; font-weight: 400; color: var(--trw-muted); margin-left: 2px; }
        .trw-b-kpi-cell em { font-style: normal; font-size: 11px; color: var(--trw-muted); font-variant-numeric: tabular-nums; }
        .trw-b-split {
          display: grid;
          grid-template-columns: minmax(0, 60fr) minmax(320px, 40fr);
          gap: 12px;
          align-items: start;
        }
        .trw-b-main,
        .trw-b-drawer {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .trw-b-drawer {
          border-left: 2px solid var(--trw-accent);
        }
        .trw-drawer-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.09em;
          color: var(--trw-muted);
        }
        .trw-module-chips { display: flex; flex-wrap: wrap; gap: 4px; }
        .trw-mod-pill {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10.5px;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 3px;
          padding: 2px 6px;
          color: var(--trw-ink);
          overflow-wrap: anywhere;
        }

        /* 시안 C 레이아웃: 매트 카본 다크 콘솔 */
        .trw-plan-c { display: flex; flex-direction: column; gap: 10px; }
        .trw-c-top { display: flex; flex-direction: column; gap: 8px; }
        .trw-c-shortcuts {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 7px 12px;
        }
        .trw-c-sc-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--trw-muted); }
        .trw-c-kbd-group { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--trw-muted); }
        .trw-c-kbd-group kbd {
          display: inline-block;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 3px;
          padding: 1px 5px;
          margin-right: 3px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10.5px;
          color: var(--trw-ink);
        }
        .trw-c-upper {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
          align-items: stretch;
        }
        .trw-c-pipe-panel,
        .trw-c-bench-panel,
        .trw-c-console,
        .trw-c-master {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
        }
        .trw-c-target-meta {
          display: flex;
          flex-direction: column;
          gap: 5px;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 8px 10px;
          font-size: 12px;
        }
        .trw-c-meta-lbl { font-size: 10.5px; font-weight: 700; color: var(--trw-muted); margin-right: 8px; }
        .trw-c-after-val { color: var(--trw-ok); }
        .trw-c-delta-val { color: var(--trw-warn); }
        .trw-c-console-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 8px;
        }
        .trw-c-console-head b { display: block; font-size: 13.5px; color: var(--trw-ink); }
        .trw-c-console-head span { font-size: 11px; color: var(--trw-muted); }
        .trw-c-trace-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
          gap: 10px;
          align-items: start;
        }
        .trw-c-trace-stream { display: flex; flex-direction: column; gap: 7px; }
        .trw-c-groups { display: flex; flex-direction: column; gap: 10px; }
        .trw-c-group-block {
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          overflow: hidden;
        }
        .trw-c-group-title {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: var(--trw-surface-2);
          border-bottom: 1px solid var(--trw-line);
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--trw-ink);
        }
        .trw-c-group-title b { font-variant-numeric: tabular-nums; color: var(--trw-accent); }
        .trw-inline-score { display: flex; align-items: center; gap: 6px; min-width: 110px; }
        .trw-inline-track {
          flex: 1;
          height: 6px;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 2px;
          overflow: hidden;
        }
        .trw-inline-fill { display: block; height: 100%; background: var(--trw-ok); }

        /* 4단계 파이프라인 진행 바 */
        .trw-pipeline-box { display: flex; flex-direction: column; gap: 7px; }
        .trw-pipeline-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 6px;
        }
        .trw-pipe-stage {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 7px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .trw-pipe-stage.is-current {
          border-color: var(--trw-ok);
          border-top: 2px solid var(--trw-ok);
        }
        .trw-pipe-head { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--trw-muted); }
        .trw-pipe-no { font-weight: 700; color: var(--trw-accent); font-variant-numeric: tabular-nums; }
        .trw-pipe-code { font-weight: 700; }
        .trw-pipe-cnt { margin-left: auto; color: var(--trw-ink); font-variant-numeric: tabular-nums; }
        .trw-pipe-label { font-size: 12.5px; font-weight: 700; color: var(--trw-ink); }
        .trw-pipe-desc { font-size: 10.5px; color: var(--trw-muted); line-height: 1.35; }

        /* A·B·C 3종 동시 비교(ALL) */
        .trw-plan-all { display: flex; flex-direction: column; gap: 10px; }
        .trw-all-master {
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 10px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .trw-all-eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--trw-muted); }
        .trw-all-target { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-top: 2px; }
        .trw-all-target b { font-size: 14px; color: var(--trw-ink); }
        .trw-all-target span { font-size: 12px; color: var(--trw-muted); }
        .trw-all-master-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }

        .trw-all-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          align-items: stretch;
        }
        .trw-compare-card {
          background: var(--trw-bg);
          color: var(--trw-ink);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
        }
        .trw-cmp-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 8px 10px;
        }
        .trw-cmp-tag { font-size: 9.5px; font-weight: 700; letter-spacing: 0.08em; color: var(--trw-muted); display: block; }
        .trw-cmp-head h3 { margin: 2px 0 0; font-size: 13.5px; color: var(--trw-ink); }
        .trw-cmp-subhead {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 6px;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 4px;
        }
        .trw-cmp-subhead b { font-size: 12px; color: var(--trw-ink); }
        .trw-cmp-subhead span { font-size: 10.5px; color: var(--trw-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .trw-cmp-step-box {
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-left: 3px solid var(--trw-accent);
          border-radius: var(--trw-radius);
          padding: 7px 9px;
          font-size: 11px;
        }
        .trw-cmp-step-box b { display: block; color: var(--trw-ink); margin-bottom: 2px; }
        .trw-cmp-step-box p { margin: 0; color: var(--trw-muted); line-height: 1.4; }
        .trw-cmp-safety-pills { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; }

        /* 공용 내부 부품 */
        .trw-viz-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 7px;
        }
        .trw-viz-head b { display: block; font-size: 13px; color: var(--trw-ink); }
        .trw-viz-head span { font-size: 11px; color: var(--trw-muted); }
        .trw-viz-meta { display: flex; align-items: center; gap: 6px; }
        .trw-count-note { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--trw-muted); }

        .trw-svg-wrap { width: 100%; overflow: hidden; }
        .trw-svg { width: 100%; height: auto; display: block; max-height: 520px; }
        .trw-svg.is-compact-polar { max-height: 290px; }
        .trw-svg.is-compact-matrix { max-height: 250px; }
        .trw-blip { cursor: pointer; }
        .trw-blip:focus-visible { outline: none; }
        .trw-blip-wave { animation: trw-pulse 1.8s ease-out infinite; }
        @keyframes trw-pulse {
          0% { opacity: 0.9; stroke-width: 1.8; }
          100% { opacity: 0.15; stroke-width: 0.5; }
        }

        .trw-blip-index {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          border-top: 1px solid var(--trw-line);
          padding-top: 7px;
          max-height: 155px;
          overflow: auto;
        }
        .trw-idx-no { font-variant-numeric: tabular-nums; font-weight: 700; margin-right: 4px; }
        .trw-idx-name { margin-right: 4px; }
        .trw-idx-ring { font-size: 10px; opacity: 0.78; font-variant-numeric: tabular-nums; }

        .trw-ledger-wrap { overflow-x: auto; max-height: 360px; overflow-y: auto; }
        .trw-ledger-wrap.is-plan-a { max-height: 280px; }
        .trw-ledger-wrap.is-plan-b { max-height: 310px; }
        .trw-ledger-wrap.is-compact { max-height: 210px; }
        .trw-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .trw-table th,
        .trw-table td {
          border-bottom: 1px solid var(--trw-line);
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
        }
        .trw-table th {
          position: sticky;
          top: 0;
          background: var(--trw-surface-2);
          color: var(--trw-muted);
          font-size: 10.5px;
          font-weight: 700;
          white-space: nowrap;
          z-index: 1;
        }
        .trw-table tr.is-active {
          background: color-mix(in srgb, var(--trw-accent) 10%, var(--trw-surface));
        }
        .trw-table tr.is-active td:first-child { border-left: 3px solid var(--trw-accent); }
        .trw-num { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 700; }
        .trw-repo-cell { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
        .trw-lang { font-size: 10px; color: var(--trw-muted); border: 1px solid var(--trw-line); border-radius: 3px; padding: 0 4px; }
        .trw-ring-pill {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          border: 1px solid;
          border-radius: 3px;
          padding: 1px 5px;
          white-space: nowrap;
        }
        .trw-summary-cell { color: var(--trw-muted); line-height: 1.38; min-width: 190px; }

        .trw-sim-header { display: flex; flex-direction: column; gap: 5px; }
        .trw-sim-header.is-compact h3 { font-size: 14.5px; }
        .trw-sim-head-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
        .trw-sim-badges { display: flex; flex-wrap: wrap; gap: 4px; }
        .trw-root :global(.badge) {
          border: 1px solid var(--trw-line);
          background: var(--trw-surface-2);
          color: var(--trw-ink);
          border-radius: 4px;
          font-size: 10.5px;
          padding: 1px 6px;
        }
        .trw-root :global(.trw-mini-ok) {
          background: var(--trw-ok-bg) !important;
          color: var(--trw-ok-ink) !important;
          border-color: var(--trw-ok) !important;
        }
        .trw-root :global(.trw-mini-warn) {
          background: var(--trw-warn-bg) !important;
          color: var(--trw-warn-ink) !important;
          border-color: var(--trw-warn) !important;
        }
        .trw-root :global(.trw-mini-accent) {
          border-color: var(--trw-accent) !important;
          color: var(--trw-accent) !important;
        }
        .trw-score-readout { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--trw-accent); }
        .trw-sim-header h3 { margin: 0; font-size: 15px; color: var(--trw-ink); }
        .trw-sim-header h3 a { color: var(--trw-link); text-decoration: none; }
        .trw-sim-header h3 a:hover { text-decoration: underline; }
        .trw-sim-desc { margin: 0; font-size: 12px; line-height: 1.45; color: var(--trw-muted); }

        .trw-link-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
        .trw-ext-link {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          font-size: 11.5px;
          font-weight: 700;
          color: var(--trw-accent-ink);
          background: var(--trw-accent);
          border-radius: var(--trw-radius);
          text-decoration: none;
        }
        .trw-ext-link:hover { opacity: 0.92; }

        .trw-sim-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 7px 9px;
        }
        .trw-sim-mode-group,
        .trw-sim-play-group { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
        .trw-step-counter { font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--trw-muted); }

        .trw-section { display: flex; flex-direction: column; gap: 6px; }
        .trw-sec-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; flex-wrap: wrap; }
        .trw-sec-head b { font-size: 12px; color: var(--trw-ink); }
        .trw-sec-head span { font-size: 10.5px; color: var(--trw-muted); }

        .trw-nodes-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        .trw-node-card {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 7px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .trw-node-card.is-passive { opacity: 0.72; }
        .trw-node-card.is-active { border-color: var(--trw-accent); }
        .trw-node-card.is-primary { border-left: 3px solid var(--trw-ok); }
        .trw-node-card.is-step-focus {
          outline: 1px solid var(--trw-accent);
          outline-offset: -1px;
          background: color-mix(in srgb, var(--trw-accent) 11%, var(--trw-surface-2));
        }
        .trw-node-top { display: flex; justify-content: space-between; align-items: center; gap: 4px; font-size: 10px; }
        .trw-node-code { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--trw-accent); }
        .trw-node-state { display: inline-flex; align-items: center; gap: 4px; color: var(--trw-muted); font-weight: 600; }
        .trw-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; background: var(--trw-muted); }
        .trw-dot.is-on { background: var(--trw-ok); }
        .trw-dot.is-focus { background: var(--trw-warn); }
        .trw-node-name { font-size: 11.5px; font-weight: 700; color: var(--trw-ink); }
        .trw-node-artifact { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; color: var(--trw-link); overflow-wrap: anywhere; }
        .trw-node-desc { margin: 2px 0 0; font-size: 10.5px; line-height: 1.38; color: var(--trw-muted); }
        .trw-node-telemetry {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--trw-muted);
          font-variant-numeric: tabular-nums;
          border-top: 1px dashed var(--trw-line);
          margin-top: 2px;
          padding-top: 2px;
        }

        .trw-steps-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
        .trw-steps-list :global(.trw-step-hit) {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 100%;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 6px 9px;
        }
        .trw-steps-list li.is-current :global(.trw-step-hit) { border-color: var(--trw-accent); border-left-width: 3px; }
        .trw-step-row-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; }
        .trw-step-no { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--trw-accent); }
        .trw-step-row-top code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 10px; color: var(--trw-muted); }
        .trw-step-lat { margin-left: auto; font-size: 10px; color: var(--trw-ok); font-variant-numeric: tabular-nums; font-weight: 700; }
        .trw-step-packet { font-size: 11px; color: var(--trw-ink); line-height: 1.38; }
        .trw-step-note { font-size: 10.5px; line-height: 1.35; }
        .trw-step-note.is-before { color: var(--trw-warn); }
        .trw-step-note.is-after { color: var(--trw-ok); }

        .trw-metrics-list { display: flex; flex-direction: column; gap: 6px; }
        .trw-metric-row {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 7px 9px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .trw-metric-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
        .trw-metric-label { font-size: 11.5px; font-weight: 700; color: var(--trw-ink); }
        .trw-metric-badges { display: flex; gap: 4px; }
        .trw-metric-bars { display: flex; flex-direction: column; gap: 3px; }
        .trw-bar-line { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 7px; }
        .trw-bar-tag { font-size: 10px; color: var(--trw-muted); }
        .trw-bar-track { height: 6px; background: var(--trw-surface); border: 1px solid var(--trw-line); border-radius: 2px; overflow: hidden; }
        .trw-bar-fill { display: block; height: 100%; transition: width 0.25s ease; }
        .trw-bar-fill.is-before { background: var(--trw-muted); }
        .trw-bar-fill.is-after { background: var(--trw-ok); }
        .trw-bar-val { font-size: 10.5px; font-variant-numeric: tabular-nums; color: var(--trw-muted); white-space: nowrap; }
        .trw-bar-val.is-after { color: var(--trw-ok); font-weight: 700; }

        .trw-safety-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
        .trw-safety-list li {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 10.5px;
          color: var(--trw-muted);
          line-height: 1.38;
        }
        .trw-safety-top { display: flex; align-items: center; gap: 5px; color: var(--trw-ink); }

        /* 부서별 관점 필터 바 */
        .trw-dept-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid var(--trw-line);
        }
        .trw-dept-readout {
          margin-left: auto;
          font-size: 11px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--trw-muted);
        }
        .trw-table tr.is-dept-match {
          background: color-mix(in srgb, var(--trw-ok) 8%, var(--trw-surface));
        }

        /* 보고자용 상황 · 흐름 그림 · 데이터 기준 4원천 · 부서별 업무 보드 */
        .trw-story-board {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trw-story-head,
        .trw-build-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 8px;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 8px;
        }
        .trw-story-head h3,
        .trw-build-head h3 {
          margin: 2px 0 0;
          font-size: 15px;
          font-weight: 700;
          color: var(--trw-ink);
        }
        .trw-story-badges,
        .trw-build-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .trw-story-situation-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          background: var(--trw-surface-2);
          overflow: hidden;
        }
        .trw-story-sit-cell {
          padding: 9px 12px;
          border-right: 1px solid var(--trw-line);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .trw-story-sit-cell:last-child { border-right: 0; }
        .trw-story-sit-cell p {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--trw-ink);
        }
        .trw-sit-kicker {
          font-size: 10.5px;
          font-weight: 700;
          color: var(--trw-warn);
        }
        .trw-sit-kicker.is-ok { color: var(--trw-ok); }

        .trw-flow-wrap {
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          background: var(--trw-surface-2);
          padding: 8px;
          overflow-x: auto;
        }
        .trw-flow-svg {
          display: block;
          width: 100%;
          min-width: 720px;
          height: auto;
        }

        .trw-story-tables-grid {
          display: grid;
          grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
          gap: 10px;
          align-items: start;
        }
        .trw-story-table-box {
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          background: var(--trw-surface-2);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow-x: auto;
        }
        .trw-rule-cell {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          color: var(--trw-accent);
        }
        .trw-dept-role {
          font-size: 11.5px;
          color: var(--trw-ink);
          line-height: 1.42;
        }
        .trw-dept-basis {
          margin-top: 2px;
          font-size: 10.5px;
          color: var(--trw-muted);
        }
        .trw-inline-route {
          color: var(--trw-link);
          font-weight: 700;
          font-size: 11px;
          text-decoration: underline;
          text-underline-offset: 2px;
          white-space: nowrap;
        }

        /* 하단 A·B·C 동시모드 연속 구현 파이프라인 */
        .trw-build-factory {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trw-build-stage-filter {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 4px;
        }
        .trw-build-stages-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .trw-build-stage-col {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .trw-build-stage-col.is-current {
          border-color: var(--trw-accent);
          border-top: 2px solid var(--trw-accent);
        }
        .trw-stage-codes {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 2px;
        }
        .trw-ledger-wrap.is-build-queue { max-height: 540px; }
        .trw-build-code-cell {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
        }
        .trw-build-title {
          font-weight: 700;
          font-size: 12px;
          color: var(--trw-ink);
          line-height: 1.4;
        }
        .trw-build-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
        }
        .trw-impact-cell {
          font-size: 11.5px;
          color: var(--trw-ok);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          line-height: 1.42;
          min-width: 190px;
        }
        .trw-build-actions {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 5px;
          min-width: 215px;
        }
        .trw-build-subactions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .trw-brief-row td {
          background: var(--trw-surface-2);
        }
        .trw-brief-pre {
          margin: 0;
          padding: 8px 10px;
          border: 1px solid var(--trw-line);
          border-radius: var(--trw-radius);
          background: var(--trw-bg);
          color: var(--trw-ink);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: keep-all;
        }

        @media (prefers-reduced-motion: reduce) {
          .trw-bar-fill { transition: none; }
          .trw-blip-wave { animation: none; }
        }
        @media (max-width: 1360px) {
          .trw-all-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 1120px) {
          .trw-plan-a,
          .trw-b-split,
          .trw-c-upper,
          .trw-c-trace-grid,
          .trw-story-tables-grid,
          .trw-story-situation-grid {
            grid-template-columns: 1fr;
          }
          .trw-story-sit-cell { border-right: 0; border-bottom: 1px solid var(--trw-line); }
          .trw-story-sit-cell:last-child { border-bottom: 0; }
          .trw-b-kpi-strip,
          .trw-build-stages-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 640px) {
          .trw-nodes-grid,
          .trw-safety-list,
          .trw-pipeline-grid,
          .trw-b-kpi-strip,
          .trw-build-stages-strip {
            grid-template-columns: 1fr;
          }
          .trw-dept-readout { margin-left: 0; }
          .trw-search-group { margin-left: 0; width: 100%; }
          .trw-search { flex: 1; min-width: 0; }
        }
      `}</style>
    </section>
  );
}
