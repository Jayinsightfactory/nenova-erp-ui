// components/pm/TechRadarWorkbench.js
// 도입 · 기술 레이더 Anti-AI Slop 하이브리드 워크벤치:
// 1px 구조선 · tabular-nums · 4분면 극좌표 레이더 + 2x2 매트릭스 + 고밀도 원장 + 우측 실설계 파이프라인 도입 시뮬레이터.
// 가드 준수: components/pm/ui.js 키트만 사용(raw button 금지) · #hex 색 금지(var(--pm-*) / rgb만) · 금지어/이모지 0건.
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, EmptyState, LinkButton, PmUiStyles, SelectCard, Tabs, ToggleChip } from './ui';
import {
  RADAR_QUADRANTS,
  RADAR_RINGS,
  MATRIX_ZONES,
  normalizeRadarCatalog,
  computePolarCoordinates,
  computeMatrixCoordinates,
  simulateRadarItem,
  buildWorkbenchSummary,
} from '../../lib/pmTechRadarSim';

const RING_LABELS = Object.fromEntries(RADAR_RINGS.map((r) => [r.id, r]));
const QUAD_LABELS = Object.fromEntries(RADAR_QUADRANTS.map((q) => [q.id, q]));

const fmtStars = (n) => {
  const num = Number(n) || 0;
  if (!num) return '-';
  return num >= 1000 ? `${(num / 1000).toFixed(num >= 10000 ? 0 : 1)}k` : String(num);
};

const ringColorVar = (ring) => {
  if (ring === 'adopt') return 'var(--trw-ok)';
  if (ring === 'trial') return 'var(--trw-accent)';
  if (ring === 'assess') return 'var(--trw-warn)';
  return 'var(--trw-muted)';
};

export default function TechRadarWorkbench({
  ledger = null,
  techRadar = null,
  isAdmin = false,
  mode = 'dark',
  standaloneUiStyles = false,
  onOpenSuiteSim = null,
  title = '도입 · 기술 레이더 & 실설계 도입 시뮬레이터',
  subtitle = '4분면 극좌표 레이더 · 2×2 임팩트×준비도 매트릭스 · 고밀도 원장과 nenovakakao 6대 실설계 노드 도입 전/후 시뮬레이션',
}) {
  const [view, setView] = useState('polar');
  const [quadFilter, setQuadFilter] = useState('');
  const [ringFilter, setRingFilter] = useState('');
  const [query, setQuery] = useState('');
  const [showAllPoints, setShowAllPoints] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const [simMode, setSimMode] = useState('simulated'); // 'baseline' | 'simulated'
  const [playing, setPlaying] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

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

  const allItems = useMemo(
    () => normalizeRadarCatalog({ ledger, techRadar, adminMode: Boolean(isAdmin) }),
    [ledger, techRadar, isAdmin]
  );

  const summary = useMemo(
    () => buildWorkbenchSummary(allItems, Boolean(isAdmin)),
    [allItems, isAdmin]
  );

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

  // 선택된 항목 유지 (없으면 첫 번째 결정대기/상위 항목 자동 선택)
  const selectedItem = useMemo(() => {
    if (!filteredItems.length) return allItems[0] || null;
    const found = filteredItems.find((x) => x.name === selectedName);
    return found || filteredItems[0];
  }, [filteredItems, allItems, selectedName]);

  // 극좌표/매트릭스 포인트 밀도 제어 (32건 초과 시 기본 상위 32건 + 선택 항목 포함, 토글로 전체 확장 가능)
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

  const sim = useMemo(() => simulateRadarItem(selectedItem), [selectedItem]);

  // 단계별 패킷 시뮬레이션 자동 재생
  useEffect(() => {
    if (!playing || reducedMotion || !sim.steps.length) return undefined;
    const timer = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % sim.steps.length);
    }, 1600);
    return () => clearInterval(timer);
  }, [playing, reducedMotion, sim.steps.length, sim.itemName]);

  const safeStepIdx = sim.steps.length ? stepIdx % sim.steps.length : 0;
  const activeSimStep = sim.steps[safeStepIdx] || null;

  const selectItem = (item, startSim = false) => {
    if (!item) return;
    setSelectedName(item.name);
    setStepIdx(0);
    if (startSim) {
      setSimMode('simulated');
      if (!reducedMotion) setPlaying(true);
    }
  };

  const clearFilters = () => {
    setQuadFilter('');
    setRingFilter('');
    setQuery('');
  };

  const renderSimulatorMetricBar = (m) => {
    const maxVal = Math.max(m.beforeVal, m.afterVal, 1);
    const beforePct = Math.max(4, Math.round((m.beforeVal / maxVal) * 100));
    const afterPct = Math.max(4, Math.round((m.afterVal / maxVal) * 100));
    return (
      <div key={m.label} className="trw-metric-row">
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

  return (
    <section
      className={standaloneUiStyles ? 'pm trw-root' : 'trw-root'}
      data-wb-mode={mode}
      data-testid="tech-radar-workbench"
    >
      {standaloneUiStyles && <PmUiStyles />}

      {/* 1. 상단 1px 헤어라인 요약 스트립 */}
      <header className="trw-topbar">
        <div className="trw-title-wrap">
          <div className="trw-eyebrow">ENGINEERING RADAR WORKBENCH · NENOVAKAKAO × ORBIT × NENOVAWEB</div>
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

      {/* 2. 관리자(사장님) 결정 대기 바 */}
      {isAdmin && summary.approvalQueue.length > 0 && (
        <div className="trw-approval-bar" aria-label="관리자 결정 대기 항목">
          <span className="trw-approval-head">결정 대기 실측 ({summary.approvalQueue.length}건)</span>
          <div className="trw-approval-list">
            {summary.approvalQueue.map((item) => {
              const active = selectedItem?.name === item.name;
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
      )}

      {/* 3. 뷰 전환 탭 & 4분면·링·검색 필터 */}
      <div className="trw-toolbar">
        <Tabs
          label="기술 레이더 보기 방식"
          value={view}
          onChange={setView}
          className="trw-view-tabs"
          items={[
            ['polar', '4분면 극좌표 레이더'],
            ['matrix', '2×2 임팩트 매트릭스'],
            ['ledger', `전체 채택·발굴 원장 (${filteredItems.length})`],
          ]}
        />

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
            {(quadFilter || ringFilter || query) && (
              <LinkButton onClick={clearFilters}>초기화</LinkButton>
            )}
          </div>
        </div>
      </div>

      {!allItems.length ? (
        <EmptyState title="표시할 기술 레이더 항목이 없습니다">
          데이터가 업로드되면 4분면 레이더와 파이프라인 도입 시뮬레이터가 자동으로 활성화됩니다.
        </EmptyState>
      ) : (
        /* 4. 메인 스플릿 워크벤치: 좌측 시각화/원장 + 우측 Evidence & 실설계 도입 시뮬레이터 */
        <div className="trw-split">
          <div className="trw-left">
            {view === 'polar' && (
              <div className="trw-viz-panel">
                <div className="trw-viz-head">
                  <div>
                    <b>4분면 × 4동심원 극좌표 레이더</b>
                    <span>번호 Blip을 클릭하면 우측 실설계 시뮬레이터와 즉시 동기화됩니다.</span>
                  </div>
                  <div className="trw-viz-meta">
                    <span className="trw-count-note">표시 {polarPoints.length} / {filteredItems.length}건</span>
                    {filteredItems.length > 32 && (
                      <ToggleChip on={showAllPoints} onClick={() => setShowAllPoints((v) => !v)}>
                        {showAllPoints ? '핵심 32건만' : `전체 ${filteredItems.length}건 표시`}
                      </ToggleChip>
                    )}
                  </div>
                </div>

                <div className="trw-svg-wrap">
                  <svg className="trw-svg" viewBox="0 0 640 640" role="img" aria-label="4분면 극좌표 기술 레이더">
                    {/* 배경 & 동심원 */}
                    <circle cx="320" cy="320" r="254" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
                    <circle cx="320" cy="320" r="211" fill="none" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="3 4" />
                    <circle cx="320" cy="320" r="148" fill="none" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="3 4" />
                    <circle cx="320" cy="320" r="79" fill="none" stroke="var(--trw-accent)" strokeWidth="1" strokeOpacity="0.45" />

                    {/* 4분면 십자축 */}
                    <line x1="320" y1="36" x2="320" y2="604" stroke="var(--trw-line)" strokeWidth="1" />
                    <line x1="36" y1="320" x2="604" y2="320" stroke="var(--trw-line)" strokeWidth="1" />

                    {/* 링 라벨 */}
                    <text x="326" y="256" fill="var(--trw-muted)" fontSize="10" fontWeight="700">ADOPT</text>
                    <text x="326" y="188" fill="var(--trw-muted)" fontSize="10" fontWeight="700">TRIAL</text>
                    <text x="326" y="124" fill="var(--trw-muted)" fontSize="10" fontWeight="700">ASSESS</text>
                    <text x="326" y="78" fill="var(--trw-muted)" fontSize="10" fontWeight="700">HOLD</text>

                    {/* 4분면 코너 라벨 */}
                    <text x="24" y="28" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q2 고성능 런타임·Rust</text>
                    <text x="616" y="28" textAnchor="end" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q1 에이전트·오케스트레이션</text>
                    <text x="24" y="624" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q3 카톡·디바이스 브릿지</text>
                    <text x="616" y="624" textAnchor="end" fill="var(--trw-ink)" fontSize="12" fontWeight="700">Q4 UI·시각화·문서검증</text>

                    {/* Blips */}
                    {polarPoints.map((pt) => {
                      const active = selectedItem?.name === pt.name;
                      const color = ringColorVar(pt.ring);
                      return (
                        <g
                          key={pt.name}
                          transform={`translate(${pt.x}, ${pt.y})`}
                          className={`trw-blip ${active ? 'is-active' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${pt.blipNo}번 ${pt.name} (${RING_LABELS[pt.ring]?.code || pt.ring})`}
                          aria-pressed={active}
                          onClick={() => selectItem(pt.item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectItem(pt.item);
                            }
                          }}
                        >
                          <title>{`${pt.blipNo}. ${pt.name} · ${RING_LABELS[pt.ring]?.label} · ${pt.item.score10}/10`}</title>
                          {active && <circle r="16" fill="none" stroke={color} strokeWidth="2" />}
                          <circle
                            r={active ? 11.5 : 9.5}
                            fill={active ? color : 'var(--trw-surface)'}
                            stroke={color}
                            strokeWidth={active ? 2 : 1.5}
                          />
                          <text
                            textAnchor="middle"
                            dy="3.5"
                            fontSize="9.5"
                            fontWeight="700"
                            fill={active ? 'var(--trw-surface)' : 'var(--trw-ink)'}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {pt.blipNo}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* 번호 인덱스 */}
                <div className="trw-blip-index" aria-label="레이더 번호 색인">
                  {polarPoints.map((pt) => (
                    <ToggleChip
                      key={pt.name}
                      on={selectedItem?.name === pt.name}
                      onClick={() => selectItem(pt.item)}
                    >
                      <span className="trw-idx-no">{pt.blipNo}</span>
                      <span className="trw-idx-name">{pt.name.split('/').pop()}</span>
                      <span className="trw-idx-ring">{RING_LABELS[pt.ring]?.code}</span>
                    </ToggleChip>
                  ))}
                </div>
              </div>
            )}

            {view === 'matrix' && (
              <div className="trw-viz-panel">
                <div className="trw-viz-head">
                  <div>
                    <b>2×2 임팩트 × 운영 준비도 매트릭스</b>
                    <span>X축 운영·원장 안전성 및 실측 준비도(0~100) · Y축 처리속도·업무 단축 임팩트(0~100)</span>
                  </div>
                  <div className="trw-viz-meta">
                    <span className="trw-count-note">표시 {matrixPoints.length} / {filteredItems.length}건</span>
                    {filteredItems.length > 32 && (
                      <ToggleChip on={showAllPoints} onClick={() => setShowAllPoints((v) => !v)}>
                        {showAllPoints ? '핵심 32건만' : `전체 ${filteredItems.length}건 표시`}
                      </ToggleChip>
                    )}
                  </div>
                </div>

                <div className="trw-svg-wrap">
                  <svg className="trw-svg" viewBox="0 0 640 420" role="img" aria-label="2x2 임팩트 준비도 매트릭스">
                    {/* 플롯 프레임: L=58, R=616 (W=558), T=32, B=366 (H=334) */}
                    <rect x="58" y="32" width="558" height="334" fill="var(--trw-surface-2)" stroke="var(--trw-line)" strokeWidth="1" />
                    {/* 25/50/75 그리드 */}
                    <line x1="197.5" y1="32" x2="197.5" y2="366" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
                    <line x1="337" y1="32" x2="337" y2="366" stroke="var(--trw-line)" strokeWidth="1.2" />
                    <line x1="476.5" y1="32" x2="476.5" y2="366" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
                    <line x1="58" y1="115.5" x2="616" y2="115.5" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />
                    <line x1="58" y1="199" x2="616" y2="199" stroke="var(--trw-line)" strokeWidth="1.2" />
                    <line x1="58" y1="282.5" x2="616" y2="282.5" stroke="var(--trw-line)" strokeWidth="1" strokeDasharray="2 4" strokeOpacity="0.6" />

                    {/* 사분면 라벨 */}
                    <text x="68" y="50" fill="var(--trw-warn)" fontSize="11" fontWeight="700">{MATRIX_ZONES[1].label}</text>
                    <text x="606" y="50" textAnchor="end" fill="var(--trw-ok)" fontSize="11" fontWeight="700">{MATRIX_ZONES[0].label}</text>
                    <text x="68" y="354" fill="var(--trw-muted)" fontSize="11" fontWeight="700">{MATRIX_ZONES[3].label}</text>
                    <text x="606" y="354" textAnchor="end" fill="var(--trw-accent)" fontSize="11" fontWeight="700">{MATRIX_ZONES[2].label}</text>

                    {/* 축 눈금 */}
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

                    {/* Blips */}
                    {matrixPoints.map((pt) => {
                      const cx = 58 + (pt.readiness / 100) * 558;
                      const cy = 366 - (pt.impact / 100) * 334;
                      const active = selectedItem?.name === pt.name;
                      const color = ringColorVar(pt.ring);
                      return (
                        <g
                          key={pt.name}
                          transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}
                          className={`trw-blip ${active ? 'is-active' : ''}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${pt.blipNo}번 ${pt.name} 준비도 ${pt.readiness} 임팩트 ${pt.impact}`}
                          aria-pressed={active}
                          onClick={() => selectItem(pt.item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectItem(pt.item);
                            }
                          }}
                        >
                          <title>{`${pt.blipNo}. ${pt.name} · 준비도 ${pt.readiness} · 임팩트 ${pt.impact} · ${pt.zoneLabel}`}</title>
                          {active && <circle r="15" fill="none" stroke={color} strokeWidth="2" />}
                          <circle
                            r={active ? 11 : 9}
                            fill={active ? color : 'var(--trw-surface)'}
                            stroke={color}
                            strokeWidth={active ? 2 : 1.5}
                          />
                          <text
                            textAnchor="middle"
                            dy="3.5"
                            fontSize="9.5"
                            fontWeight="700"
                            fill={active ? 'var(--trw-surface)' : 'var(--trw-ink)'}
                            style={{ fontVariantNumeric: 'tabular-nums' }}
                          >
                            {pt.blipNo}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div className="trw-blip-index" aria-label="매트릭스 번호 색인">
                  {matrixPoints.map((pt) => (
                    <ToggleChip
                      key={pt.name}
                      on={selectedItem?.name === pt.name}
                      onClick={() => selectItem(pt.item)}
                    >
                      <span className="trw-idx-no">{pt.blipNo}</span>
                      <span className="trw-idx-name">{pt.name.split('/').pop()}</span>
                      <span className="trw-idx-ring">{pt.readiness}/{pt.impact}</span>
                    </ToggleChip>
                  ))}
                </div>
              </div>
            )}

            {view === 'ledger' && (
              <div className="trw-ledger-wrap">
                <table className="trw-table">
                  <thead>
                    <tr>
                      <th>#</th>
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
                      const active = selectedItem?.name === item.name;
                      return (
                        <tr key={item.name} className={active ? 'is-active' : ''}>
                          <td className="trw-num">{item.blipNo}</td>
                          <td>
                            <div className="trw-repo-cell">
                              <b>{item.name}</b>
                              {item.language && <span className="trw-lang">{item.language}</span>}
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
            )}
          </div>

          {/* 우측 스플릿 패널: Evidence & 실설계 도입 시뮬레이터 */}
          <aside className="trw-right" data-testid="radar-architecture-simulator" aria-label="Evidence 및 실설계 도입 시뮬레이터">
            {/* A. 선택된 기술 근거 헤더 */}
            <div className="trw-sim-header">
              <div className="trw-sim-head-top">
                <div className="trw-sim-badges">
                  <Badge className="trw-num-badge">#{selectedItem?.blipNo || 1}</Badge>
                  <Badge>{QUAD_LABELS[selectedItem?.quadrant]?.label || 'Q1'}</Badge>
                  <Badge>{RING_LABELS[selectedItem?.ring]?.label || 'TRIAL'}</Badge>
                  {selectedItem?.needsApproval && <Badge className="trw-mini-warn">결정대기</Badge>}
                </div>
                <span className="trw-score-readout">
                  {selectedItem?.score10 || '-'}/10{selectedItem?.stars ? ` · ★ ${fmtStars(selectedItem.stars)}` : ''}
                </span>
              </div>

              <h3>
                {selectedItem?.url ? (
                  <a href={selectedItem.url} target="_blank" rel="noopener noreferrer">{selectedItem.name}</a>
                ) : (
                  selectedItem?.name || sim.itemName
                )}
              </h3>

              <p className="trw-sim-desc">
                {selectedItem?.easy || selectedItem?.summary || sim.subtitle}
              </p>

              {(selectedItem?.pilotResult?.summary || selectedItem?.why || selectedItem?.use) && (
                <div className="trw-evidence-box">
                  {selectedItem?.pilotResult?.summary && (
                    <div><b>파일럿 실측</b> <span>{selectedItem.pilotResult.summary}</span></div>
                  )}
                  {selectedItem?.why && (
                    <div><b>도입 근거</b> <span>{selectedItem.why}</span></div>
                  )}
                  {selectedItem?.use && (
                    <div><b>적용 지점</b> <span>{selectedItem.use}</span></div>
                  )}
                </div>
              )}
            </div>

            {/* B. 시뮬레이터 제어 바 */}
            <div className="trw-sim-controls">
              <div className="trw-sim-mode-group">
                <ToggleChip
                  on={simMode === 'baseline'}
                  onClick={() => setSimMode('baseline')}
                >
                  도입 전(Baseline) 비교
                </ToggleChip>
                <ToggleChip
                  on={simMode === 'simulated'}
                  onClick={() => setSimMode('simulated')}
                >
                  도입 후(Simulated) 가동
                </ToggleChip>
              </div>

              <div className="trw-sim-play-group">
                <Button
                  size="sm"
                  variant={playing ? 'primary' : 'secondary'}
                  disabled={reducedMotion}
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? '일시정지' : '단계별 패킷 시뮬레이션 재생'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPlaying(false);
                    setStepIdx((prev) => (sim.steps.length ? (prev + 1) % sim.steps.length : 0));
                  }}
                >
                  다음 단계
                </Button>
                <span className="trw-step-counter">
                  STEP 0{safeStepIdx + 1} / 0{Math.max(1, sim.steps.length)}
                </span>
              </div>
            </div>

            {/* C. 6대 실설계 표면 노드 토폴로지 */}
            <div className="trw-section">
              <div className="trw-sec-head">
                <b>nenovakakao · Orbit · 네노바웹 6대 실설계 연결 표면</b>
                <span>{simMode === 'baseline' ? '도입 전 기준 동작' : '도입 후 시뮬레이션 경로'}</span>
              </div>

              <div className="trw-nodes-grid">
                {sim.nodeDetails.map((node) => {
                  const isStepFocus = activeSimStep?.nodeId === node.id;
                  return (
                    <div
                      key={node.id}
                      className={`trw-node-card ${node.active ? 'is-active' : 'is-passive'} ${node.isPrimary ? 'is-primary' : ''} ${isStepFocus ? 'is-step-focus' : ''}`}
                    >
                      <div className="trw-node-top">
                        <span className="trw-node-code">{node.code}</span>
                        <span className="trw-node-state">{isStepFocus ? '패킷 통과' : node.statusLabel}</span>
                      </div>
                      <div className="trw-node-name">{node.shortName}</div>
                      <code className="trw-node-artifact">{node.artifact}</code>
                      <p className="trw-node-desc">
                        {simMode === 'baseline' ? node.roleBefore : node.roleAfter}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* D. 단계별 패킷 흐름 */}
            <div className="trw-section">
              <div className="trw-sec-head">
                <b>단계별 데이터 패킷 경로</b>
                <span>{sim.scenarioTitle}</span>
              </div>
              <ol className="trw-steps-list">
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
            </div>

            {/* E. 정량 Before/After 비교 막대 */}
            <div className="trw-section">
              <div className="trw-sec-head">
                <b>Before / After 정량 비교 지표</b>
                <span>모든 수치는 tabular-nums 고정폭 정렬 및 실측/설계기준 출처 명시</span>
              </div>
              <div className="trw-metrics-list">
                {sim.metrics.map(renderSimulatorMetricBar)}
              </div>
            </div>

            {/* F. 안전선 · 가드레일 검증 체크리스트 */}
            <div className="trw-section">
              <div className="trw-sec-head">
                <b>운영 · 원장 안전선 검증 체크리스트</b>
                <span>PR 50 5분 배포 &amp; Tier 1 쓰기 방어</span>
              </div>
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
            </div>
          </aside>
        </div>
      )}

      <style jsx>{`
        .trw-root {
          --trw-bg: var(--pm-bg, rgb(14, 16, 22));
          --trw-surface: var(--pm-surface, rgb(20, 24, 32));
          --trw-surface-2: var(--pm-surface2, rgb(27, 32, 43));
          --trw-ink: var(--pm-ink, rgb(231, 234, 240));
          --trw-muted: var(--pm-muted, rgb(148, 160, 178));
          --trw-line: var(--pm-line, rgb(41, 49, 64));
          --trw-accent: var(--pm-accent, rgb(88, 166, 255));
          --trw-accent-ink: var(--pm-accent-ink, rgb(255, 255, 255));
          --trw-ok: var(--pm-ok, rgb(46, 160, 67));
          --trw-ok-bg: var(--pm-ok-bg, rgba(46, 160, 67, 0.14));
          --trw-ok-ink: var(--pm-ok-ink, rgb(110, 231, 183));
          --trw-warn: var(--pm-idle, rgb(210, 153, 34));
          --trw-warn-bg: var(--pm-idle-bg, rgba(210, 153, 34, 0.16));
          --trw-warn-ink: var(--pm-idle-ink, rgb(251, 191, 36));
          --trw-err: var(--pm-err, rgb(248, 81, 73));
          --trw-link: var(--pm-link, rgb(121, 192, 255));
          --pm-bg: var(--trw-bg);
          --pm-surface: var(--trw-surface);
          --pm-surface2: var(--trw-surface-2);
          --pm-ink: var(--trw-ink);
          --pm-muted: var(--trw-muted);
          --pm-line: var(--trw-line);
          --pm-accent: var(--trw-accent);
          --pm-accent-ink: var(--trw-accent-ink);
          --pm-ok: var(--trw-ok);
          --pm-idle: var(--trw-warn);
          --pm-err: var(--trw-err);
          --pm-link: var(--trw-link);
          --pmk-primary: var(--trw-accent);
          --pmk-primary-hover: var(--trw-accent);
          --pmk-primary-down: var(--trw-accent);
          --pmk-primary-ink: var(--trw-accent-ink);
          --pmk-sec-bg: var(--trw-surface);
          --pmk-sec-hover: var(--trw-surface-2);
          --pmk-sec-ink: var(--trw-ink);
          --pmk-sec-border: var(--trw-line);
          --pmk-chip-bg: var(--trw-surface-2);
          --pmk-chip-ink: var(--trw-ink);
          --pmk-on-bg: var(--trw-accent);
          --pmk-on-ink: var(--trw-accent-ink);
          --pmk-ink: var(--trw-ink);
          --pmk-link: var(--trw-link);
          --pmk-tab-ink: var(--trw-muted);
          --pmk-tab-on: var(--trw-accent);
          --pmk-focus: var(--trw-accent);
          --pmk-shadow: none;
          --pmk-radius: 6px;
          color: var(--trw-ink);
          font-size: 13px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .trw-root[data-wb-mode="clear"] {
          --trw-bg: var(--pm-bg, rgb(243, 245, 248));
          --trw-surface: var(--pm-surface, rgb(255, 255, 255));
          --trw-surface-2: var(--pm-surface2, rgb(241, 244, 249));
          --trw-ink: var(--pm-ink, rgb(27, 36, 51));
          --trw-muted: var(--pm-muted, rgb(91, 102, 120));
          --trw-line: var(--pm-line, rgb(217, 222, 232));
          --trw-accent: var(--pm-accent, rgb(36, 86, 200));
          --trw-accent-ink: var(--pm-accent-ink, rgb(255, 255, 255));
          --trw-ok: var(--pm-ok, rgb(31, 138, 76));
          --trw-ok-bg: var(--pm-ok-bg, rgb(227, 244, 234));
          --trw-ok-ink: var(--pm-ok-ink, rgb(20, 83, 45));
          --trw-warn: var(--pm-idle, rgb(183, 121, 31));
          --trw-warn-bg: var(--pm-idle-bg, rgb(253, 240, 200));
          --trw-warn-ink: var(--pm-idle-ink, rgb(92, 67, 0));
          --trw-err: var(--pm-err, rgb(200, 54, 44));
          --trw-link: var(--pm-link, rgb(36, 86, 200));
        }

        .trw-topbar {
          display: flex;
          justify-content: space-between;
          align-items: stretch;
          gap: 14px;
          flex-wrap: wrap;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: 8px;
          padding: 14px 16px;
        }
        .trw-title-wrap {
          flex: 1 1 480px;
          min-width: 0;
        }
        .trw-eyebrow {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--trw-muted);
          margin-bottom: 4px;
        }
        .trw-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .trw-title-row h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: var(--trw-ink);
          letter-spacing: -0.01em;
        }
        .trw-subtitle {
          margin: 5px 0 0;
          font-size: 12.5px;
          color: var(--trw-muted);
          line-height: 1.45;
        }

        .trw-kpi-strip {
          display: flex;
          align-items: stretch;
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          overflow: hidden;
          background: var(--trw-surface-2);
          align-self: center;
        }
        .trw-kpi-cell {
          padding: 8px 14px;
          border-right: 1px solid var(--trw-line);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
          min-width: 82px;
        }
        .trw-kpi-cell:last-child {
          border-right: 0;
        }
        .trw-kpi-cell.is-highlight {
          background: var(--trw-warn-bg);
        }
        .trw-kpi-label {
          font-size: 10.5px;
          font-weight: 700;
          color: var(--trw-muted);
          white-space: nowrap;
        }
        .trw-kpi-val {
          font-size: 18px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1.15;
          color: var(--trw-ink);
        }
        .trw-kpi-val.is-ok { color: var(--trw-ok); }
        .trw-kpi-val.is-accent { color: var(--trw-accent); }
        .trw-kpi-val.is-warn { color: var(--trw-warn); }

        .trw-approval-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-left: 3px solid var(--trw-warn);
          border-radius: 6px;
          padding: 8px 12px;
        }
        .trw-approval-head {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--trw-warn);
          white-space: nowrap;
        }
        .trw-approval-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .trw-approval-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 3px 6px 3px 9px;
        }
        .trw-approval-item.is-active {
          border-color: var(--trw-accent);
        }
        .trw-approval-name {
          font-size: 12px;
          font-weight: 600;
          color: var(--trw-ink);
        }
        .trw-approval-score {
          font-size: 11.5px;
          color: var(--trw-muted);
          font-variant-numeric: tabular-nums;
        }

        .trw-toolbar {
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: 8px;
          padding: 8px 14px 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .trw-toolbar :global(.trw-view-tabs) {
          border-bottom: 1px solid var(--trw-line);
        }
        .trw-filters {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px 16px;
        }
        .trw-filter-group {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 3px;
        }
        .trw-filter-label {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--trw-muted);
          margin-right: 4px;
        }
        .trw-search-group {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }
        .trw-search {
          background: var(--trw-surface-2);
          color: var(--trw-ink);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 5px 10px;
          font: inherit;
          font-size: 12.5px;
          min-width: 210px;
        }

        .trw-split {
          display: grid;
          grid-template-columns: minmax(0, 1.08fr) minmax(380px, 0.92fr);
          gap: 14px;
          align-items: start;
        }
        .trw-left,
        .trw-right {
          min-width: 0;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: 8px;
        }
        .trw-viz-panel {
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trw-viz-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 8px;
        }
        .trw-viz-head b {
          display: block;
          font-size: 13.5px;
          color: var(--trw-ink);
        }
        .trw-viz-head span {
          font-size: 11.5px;
          color: var(--trw-muted);
        }
        .trw-viz-meta {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .trw-count-note {
          font-size: 11.5px;
          font-variant-numeric: tabular-nums;
          color: var(--trw-muted);
        }
        .trw-svg-wrap {
          width: 100%;
          overflow: hidden;
        }
        .trw-svg {
          width: 100%;
          height: auto;
          display: block;
          max-height: 560px;
        }
        .trw-blip {
          cursor: pointer;
        }
        .trw-blip:focus-visible {
          outline: none;
        }
        .trw-blip-index {
          display: flex;
          flex-wrap: wrap;
          gap: 3px;
          border-top: 1px solid var(--trw-line);
          padding-top: 8px;
          max-height: 175px;
          overflow: auto;
        }
        .trw-idx-no {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          margin-right: 4px;
        }
        .trw-idx-name {
          margin-right: 5px;
        }
        .trw-idx-ring {
          font-size: 10px;
          opacity: 0.78;
          font-variant-numeric: tabular-nums;
        }

        .trw-ledger-wrap {
          overflow-x: auto;
          max-height: 760px;
          overflow-y: auto;
        }
        .trw-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        .trw-table th,
        .trw-table td {
          border-bottom: 1px solid var(--trw-line);
          padding: 7px 9px;
          text-align: left;
          vertical-align: top;
        }
        .trw-table th {
          position: sticky;
          top: 0;
          background: var(--trw-surface-2);
          color: var(--trw-muted);
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
          z-index: 1;
        }
        .trw-table tr.is-active {
          background: color-mix(in srgb, var(--trw-accent) 9%, var(--trw-surface));
        }
        .trw-table tr.is-active td:first-child {
          box-shadow: inset 3px 0 0 var(--trw-accent);
        }
        .trw-num {
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          font-weight: 700;
        }
        .trw-repo-cell {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 5px;
        }
        .trw-lang {
          font-size: 10.5px;
          color: var(--trw-muted);
          border: 1px solid var(--trw-line);
          border-radius: 4px;
          padding: 0 5px;
        }
        .trw-ring-pill {
          display: inline-block;
          font-size: 10.5px;
          font-weight: 700;
          border: 1px solid;
          border-radius: 4px;
          padding: 1px 6px;
          white-space: nowrap;
        }
        .trw-summary-cell {
          color: var(--trw-muted);
          line-height: 1.4;
          min-width: 220px;
        }

        .trw-right {
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .trw-sim-header {
          border-bottom: 1px solid var(--trw-line);
          padding-bottom: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .trw-sim-head-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .trw-sim-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .trw-sim-header :global(.badge) {
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
        .trw-score-readout {
          font-size: 12.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--trw-accent);
        }
        .trw-sim-header h3 {
          margin: 0;
          font-size: 16px;
          color: var(--trw-ink);
        }
        .trw-sim-header h3 a {
          color: var(--trw-link);
          text-decoration: none;
        }
        .trw-sim-header h3 a:hover {
          text-decoration: underline;
        }
        .trw-sim-desc {
          margin: 0;
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--trw-muted);
        }
        .trw-evidence-box {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          line-height: 1.45;
        }
        .trw-evidence-box b {
          color: var(--trw-accent);
          margin-right: 6px;
          font-size: 11.5px;
        }

        .trw-sim-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 8px 10px;
        }
        .trw-sim-mode-group,
        .trw-sim-play-group {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
        }
        .trw-step-counter {
          font-size: 11.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--trw-muted);
        }

        .trw-section {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .trw-sec-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }
        .trw-sec-head b {
          font-size: 12.5px;
          color: var(--trw-ink);
        }
        .trw-sec-head span {
          font-size: 11px;
          color: var(--trw-muted);
        }

        .trw-nodes-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .trw-node-card {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 8px 9px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .trw-node-card.is-passive {
          opacity: 0.72;
        }
        .trw-node-card.is-active {
          border-color: var(--trw-accent);
        }
        .trw-node-card.is-primary {
          border-left: 3px solid var(--trw-ok);
        }
        .trw-node-card.is-step-focus {
          box-shadow: inset 0 0 0 1px var(--trw-accent);
          background: color-mix(in srgb, var(--trw-accent) 10%, var(--trw-surface-2));
        }
        .trw-node-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
        }
        .trw-node-code {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--trw-accent);
        }
        .trw-node-state {
          color: var(--trw-muted);
          font-weight: 600;
        }
        .trw-node-name {
          font-size: 12px;
          font-weight: 700;
          color: var(--trw-ink);
        }
        .trw-node-artifact {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10.5px;
          color: var(--trw-link);
          overflow-wrap: anywhere;
        }
        .trw-node-desc {
          margin: 2px 0 0;
          font-size: 11px;
          line-height: 1.4;
          color: var(--trw-muted);
        }

        .trw-steps-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .trw-steps-list :global(.trw-step-hit) {
          display: flex;
          flex-direction: column;
          gap: 3px;
          width: 100%;
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 7px 10px;
        }
        .trw-steps-list li.is-current :global(.trw-step-hit) {
          border-color: var(--trw-accent);
          border-left-width: 3px;
        }
        .trw-step-row-top {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
        }
        .trw-step-no {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          color: var(--trw-accent);
        }
        .trw-step-row-top code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10.5px;
          color: var(--trw-muted);
        }
        .trw-step-packet {
          font-size: 11.5px;
          color: var(--trw-ink);
          line-height: 1.4;
        }
        .trw-step-note {
          font-size: 11px;
          line-height: 1.4;
        }
        .trw-step-note.is-before { color: var(--trw-warn); }
        .trw-step-note.is-after { color: var(--trw-ok); }

        .trw-metrics-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .trw-metric-row {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .trw-metric-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .trw-metric-label {
          font-size: 12px;
          font-weight: 700;
          color: var(--trw-ink);
        }
        .trw-metric-badges {
          display: flex;
          gap: 4px;
        }
        .trw-metric-row :global(.trw-src-tag),
        .trw-metric-row :global(.trw-delta-tag) {
          font-size: 10px;
          border-radius: 4px;
          padding: 1px 6px;
          border: 1px solid var(--trw-line);
          background: var(--trw-surface);
          color: var(--trw-muted);
        }
        .trw-metric-row :global(.trw-delta-tag) {
          color: var(--trw-ok);
          border-color: var(--trw-ok);
          font-variant-numeric: tabular-nums;
        }
        .trw-metric-bars {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .trw-bar-line {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
        }
        .trw-bar-tag {
          font-size: 10.5px;
          color: var(--trw-muted);
        }
        .trw-bar-track {
          height: 6px;
          background: var(--trw-surface);
          border: 1px solid var(--trw-line);
          border-radius: 3px;
          overflow: hidden;
        }
        .trw-bar-fill {
          display: block;
          height: 100%;
          transition: width 0.25s ease;
        }
        .trw-bar-fill.is-before { background: var(--trw-muted); }
        .trw-bar-fill.is-after { background: var(--trw-ok); }
        .trw-bar-val {
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          color: var(--trw-muted);
          white-space: nowrap;
        }
        .trw-bar-val.is-after {
          color: var(--trw-ok);
          font-weight: 700;
        }

        .trw-safety-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        .trw-safety-list li {
          background: var(--trw-surface-2);
          border: 1px solid var(--trw-line);
          border-radius: 6px;
          padding: 7px 9px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 11px;
          color: var(--trw-muted);
          line-height: 1.4;
        }
        .trw-safety-top {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--trw-ink);
        }

        @media (prefers-reduced-motion: reduce) {
          .trw-bar-fill {
            transition: none;
          }
        }
        @media (max-width: 1120px) {
          .trw-split {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 640px) {
          .trw-nodes-grid,
          .trw-safety-list {
            grid-template-columns: 1fr;
          }
          .trw-search-group {
            margin-left: 0;
            width: 100%;
          }
          .trw-search {
            flex: 1;
            min-width: 0;
          }
        }
      `}</style>
    </section>
  );
}
