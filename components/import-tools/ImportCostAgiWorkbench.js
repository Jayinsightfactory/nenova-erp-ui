import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import WorkflowGuide from '../WorkflowGuide';
import { getCurrentWeek, stepWeek } from '../../lib/useWeekInput';
import { MENU_BACK_REQUEST_EVENT } from '../../lib/menuNavigationHistory';
import {
  DEFAULT_SIM_PARAMS,
  COST_AGI_DEPARTMENTS,
  COST_AGI_VIEW_MODES,
  PIPELINE_COUNTRIES,
  buildCostAgiExecutiveBriefing,
  countryLabel,
  normalizeCountryCode,
  normalizeSimParams,
  runCostAgiAudit,
} from '../../lib/importCostAgi';
import styles from '../../styles/ImportCostAgi.module.css';

const VALID_VIEWS = ['A', 'B', 'C', 'ALL'];

const PRESETS = Object.freeze([
  Object.freeze({
    id: 'baseline',
    label: '기본 실무',
    params: { ...DEFAULT_SIM_PARAMS },
  }),
  Object.freeze({
    id: 'fx-stress',
    label: '환율 +60원 스트레스',
    params: {
      fxDeltaKRW: 60,
      rebalancePct: 35,
      boxFillGainPct: 14,
      marginDefenseRatio: 100,
      targetMarginPct: 18,
      creditRecoveryEnabled: true,
      fxSplitSchedulePct: 80,
      agedStockClearRatio: 75,
      customerAllocRatio: 70,
      cutoffGuardEnabled: true,
      customsRateAuditEnabled: true,
    },
  }),
  Object.freeze({
    id: 'cost-agi-optimal',
    label: '최적 루프',
    params: {
      fxDeltaKRW: 0,
      rebalancePct: 50,
      boxFillGainPct: 20,
      marginDefenseRatio: 100,
      targetMarginPct: 20,
      creditRecoveryEnabled: true,
      fxSplitSchedulePct: 100,
      agedStockClearRatio: 100,
      customerAllocRatio: 100,
      cutoffGuardEnabled: true,
      customsRateAuditEnabled: true,
    },
  }),
  Object.freeze({
    id: 'zero',
    label: '미적용(0%) 비교',
    params: {
      fxDeltaKRW: 0,
      rebalancePct: 0,
      boxFillGainPct: 0,
      marginDefenseRatio: 0,
      targetMarginPct: 18,
      creditRecoveryEnabled: false,
      fxSplitSchedulePct: 0,
      agedStockClearRatio: 0,
      customerAllocRatio: 0,
      cutoffGuardEnabled: false,
      customsRateAuditEnabled: false,
    },
  }),
]);

const BUILD_STAGES = Object.freeze([
  Object.freeze({ id: 'ALL', label: '전체 모듈' }),
  Object.freeze({ id: 'LIVE', label: '실전가동 LIVE' }),
  Object.freeze({ id: 'BUILDING', label: '구현검증 BUILDING' }),
  Object.freeze({ id: 'SPEC_READY', label: '설계완료 SPEC_READY' }),
]);

function fmtKRW(v) {
  const n = Math.round(Number(v) || 0);
  return n.toLocaleString('ko-KR');
}

function fmtSignedKRW(v) {
  const n = Math.round(Number(v) || 0);
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}₩${Math.abs(n).toLocaleString('ko-KR')}`;
}

function fmtNum(v, d = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR', { maximumFractionDigits: d });
}

function withPopup(href, isPopup) {
  if (!isPopup || !href) return href;
  return `${href}${href.includes('?') ? '&' : '?'}popup=1`;
}

async function copyTextSafe(text, fallbackInputRef) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }
  try {
    if (fallbackInputRef?.current) {
      fallbackInputRef.current.focus();
      fallbackInputRef.current.select();
      if (typeof document.execCommand === 'function' && document.execCommand('copy')) {
        return true;
      }
    }
    if (typeof document !== 'undefined' && document.body && typeof document.execCommand === 'function') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      if (copied) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function fetchReadOnlyJson(url, signal) {
  const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
  return body || {};
}

function parseInitContext(initialViewMode) {
  const [yr, wk, seq] = getCurrentWeek().split('-');
  const defYear = yr || '2026';
  const defWeek = wk && seq ? `${wk}-${seq}` : '46-01';
  const fallbackView = VALID_VIEWS.includes(initialViewMode) ? initialViewMode : 'A';
  if (typeof window === 'undefined') {
    return { orderYear: defYear, orderWeek: defWeek, country: 'ALL', viewMode: fallbackView, isPopup: false };
  }
  const q = new URLSearchParams(window.location.search);
  const v = String(q.get('view') || fallbackView).toUpperCase();
  const validView = VALID_VIEWS.includes(v) ? v : 'A';
  const rawYear = String(q.get('year') || '').trim();
  const rawWeek = String(q.get('week') || '').trim();
  const orderYear = /^20\d{2}$/.test(rawYear) ? rawYear : defYear;
  const orderWeek = /^\d{1,2}-\d{1,2}$/.test(rawWeek)
    ? rawWeek.split('-').map((p) => p.padStart(2, '0')).join('-')
    : defWeek;
  const country = normalizeCountryCode(q.get('country') || 'ALL');
  const isPopup = q.get('popup') === '1';
  return { orderYear, orderWeek, country, viewMode: validView, isPopup };
}

function truncateText(text, maxChars = 22) {
  const s = String(text || '').trim();
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(1, maxChars - 1))}…`;
}

const TRACE_STEP_INTERVAL_MS = 2400;

const TRACE_CARD_POSITIONS = Object.freeze([
  Object.freeze({ x: 24, y: 22 }),
  Object.freeze({ x: 339, y: 22 }),
  Object.freeze({ x: 654, y: 22 }),
  Object.freeze({ x: 24, y: 236 }),
  Object.freeze({ x: 339, y: 236 }),
  Object.freeze({ x: 654, y: 236 }),
]);

const TRACE_WIRES = Object.freeze([
  Object.freeze({
    id: 'w-0-1',
    targetIdx: 1,
    d: 'M 306 82 L 339 82',
    startDot: { cx: 309, cy: 82 },
    endDot: { cx: 336, cy: 82 },
  }),
  Object.freeze({
    id: 'w-1-2',
    targetIdx: 2,
    d: 'M 621 82 L 654 82',
    startDot: { cx: 624, cy: 82 },
    endDot: { cx: 651, cy: 82 },
  }),
  Object.freeze({
    id: 'w-2-3-bus',
    targetIdx: 3,
    d: 'M 795 142 L 795 162 Q 795 170 787 170 L 173 170 Q 165 170 165 178 L 165 236',
    startDot: { cx: 795, cy: 145 },
    endDot: { cx: 165, cy: 233 },
  }),
  Object.freeze({
    id: 'w-3-4',
    targetIdx: 4,
    d: 'M 306 296 L 339 296',
    startDot: { cx: 309, cy: 296 },
    endDot: { cx: 336, cy: 296 },
  }),
  Object.freeze({
    id: 'w-4-5',
    targetIdx: 5,
    d: 'M 621 296 L 654 296',
    startDot: { cx: 624, cy: 296 },
    endDot: { cx: 651, cy: 296 },
  }),
]);

function buildLeverTraceStages(lever) {
  const nodes = lever?.visualDiagram?.nodes || [];
  const waterfall = lever?.visualDiagram?.waterfall || {};
  const basis = lever?.dataBasis || {};
  const tasks = lever?.departmentTasks || [];
  const primaryTask = tasks.find((t) => t.dept === lever.primaryDept) || tasks[0] || null;
  const secondarySummary = tasks
    .filter((t) => !primaryTask || t.dept !== primaryTask.dept)
    .map((t) => `${t.dept}(${t.role})`)
    .join(' · ');

  return [
    {
      stepNo: '01',
      id: 'source',
      surface: 'Stage 1 · 원천 수집',
      title: '01 원천 서류·데이터 포착',
      chip: truncateText(nodes[0]?.title || basis.emailSource || '원천 서류 수집', 22),
      ownerDept: lever.primaryDept,
      detailHeading: '이메일·첨부서류 및 사내 담당자 원천 포착',
      detailBody: `이메일·서류: ${basis.emailSource || '—'} / 사내 원천: ${basis.staffSource || '—'}`,
      detailMeta: `거래처·현장 원천: ${basis.counterpartySource || '—'}`,
    },
    {
      stepNo: '02',
      id: 'leak',
      surface: 'Stage 2 · 누수 탐지',
      title: '02 원가 누수 지점 탐지',
      chip: `무대응 노출 ₩${fmtKRW(waterfall.beforeKRW)}`,
      ownerDept: lever.primaryDept,
      detailHeading: '무대응 시 발생하는 현장 원가 누수 지점',
      detailBody: lever.story?.beforeScene || nodes[1]?.detail || '—',
      detailMeta: `${waterfall.beforeLabel || '무대응 손실 노출'}: ₩${fmtKRW(waterfall.beforeKRW)}`,
    },
    {
      stepNo: '03',
      id: 'criterion',
      surface: 'Stage 3 · 기준식 진단',
      title: '03 원가 기준식 진단',
      chip: truncateText(nodes[2]?.title || '기준식 판정', 22),
      ownerDept: '원가 판정 엔진',
      detailHeading: '판정 기준식 및 임계치 자동 진단',
      detailBody: basis.criterionRule || nodes[2]?.detail || '—',
      detailMeta: `임계 조건: ${nodes[2]?.detail || '—'}`,
    },
    {
      stepNo: '04',
      id: 'simulate',
      surface: 'Stage 4 · 반사실 모의',
      title: '04 반사실 이익 시뮬레이션',
      chip: truncateText(`회수율 ${waterfall.recoveryPct ?? 0}% · ${fmtSignedKRW(lever.profitGainKRW)}`, 23),
      ownerDept: '반사실 시뮬레이터',
      detailHeading: '현재 슬라이더·환율·국가 변수 기반 회수율 모의',
      detailBody: `적용 조건(${lever.driverText || '기본'}) 반영 시 무대응 노출 ₩${fmtKRW(waterfall.beforeKRW)} 중 +₩${fmtKRW(waterfall.recoveredKRW)} (${waterfall.recoveryPct ?? 0}%) 회수·방어 산출`,
      detailMeta: `${waterfall.afterLabel || '조치 후 잔여 노출'}: ₩${fmtKRW(waterfall.afterKRW)}`,
    },
    {
      stepNo: '05',
      id: 'dept',
      surface: 'Stage 5 · 부서 연계',
      title: '05 4대 부서 연계 실행',
      chip: truncateText(`${lever.primaryDept} 주관 · ${tasks.length}개 부서`, 22),
      ownerDept: tasks.map((t) => t.dept).join(' · '),
      detailHeading: `${lever.primaryDept} 주관 전사 4대 부서 실행 연계`,
      detailBody: primaryTask
        ? `[${primaryTask.dept} · ${primaryTask.role}] ${primaryTask.action} (실행 시점: ${primaryTask.timing})`
        : (nodes[3]?.detail || '—'),
      detailMeta: secondarySummary ? `협업 부서: ${secondarySummary}` : '원장 무쓰기 담당자 확인 실행',
    },
    {
      stepNo: '06',
      id: 'gain',
      surface: 'Stage 6 · 원장·회수',
      title: '06 원장 반영 & 순이익 회수',
      chip: truncateText(`차수 ${fmtSignedKRW(lever.profitGainKRW)}`, 22),
      ownerDept: '담당자 승인 게이트',
      detailHeading: '담당자 확인 승인 후 원장 반영 & 순이익 회수',
      detailBody: lever.story?.afterScene || '—',
      detailMeta: `차수 기대 순이익 ${fmtSignedKRW(lever.profitGainKRW)} · 52주 연간 환산 ${fmtSignedKRW(lever.annualizedGainKRW)} (원장 자동 수정 없음)`,
    },
  ];
}

function LeverDiagramSvg({ lever }) {
  const [activeStageIdx, setActiveStageIdx] = useState(4);
  const [autoPlay, setAutoPlay] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAutoPlay(false);
    }
  }, []);

  useEffect(() => {
    if (!autoPlay) return undefined;
    const timer = setInterval(() => {
      setActiveStageIdx((prev) => (prev + 1) % 6);
    }, TRACE_STEP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoPlay]);

  if (!lever?.visualDiagram) return null;
  const { waterfall = {} } = lever.visualDiagram;
  const stages = buildLeverTraceStages(lever);
  const safeIdx = Math.max(0, Math.min(stages.length - 1, activeStageIdx));
  const selectedStage = stages[safeIdx];

  const maxVal = Math.max(1, Number(waterfall.beforeKRW) || 0, Number(waterfall.recoveredKRW) || 0);
  const barTrackWidth = 480;
  const beforeW = Math.round(barTrackWidth * ((Number(waterfall.beforeKRW) || 0) / maxVal));
  const recW = (Number(waterfall.recoveredKRW) || 0) > 0
    ? Math.max(10, Math.round(barTrackWidth * ((Number(waterfall.recoveredKRW) || 0) / maxVal)))
    : 0;
  const afterW = Math.round(barTrackWidth * ((Number(waterfall.afterKRW) || 0) / maxVal));

  const gridPatternId = `cost-agi-trace-grid-${lever.code}`;
  const getStageState = (idx) => (idx < safeIdx ? 'done' : idx === safeIdx ? 'running' : 'pending');
  const stateLabel = (st) => (st === 'done' ? '완료' : st === 'running' ? '실행 중' : '대기');

  const handleSelectStage = (idx) => {
    setActiveStageIdx(idx);
    setAutoPlay(false);
  };

  return (
    <div className={styles.diagramBox} data-testid="cost-agi-lever-svg-diagram">
      <div className={styles.traceHeaderBar}>
        <div className={styles.traceHeaderLeft}>
          <span className={styles.traceTabTitle}>실시간 원가·이익 트레이스 도면</span>
          <span className={styles.traceLeverTag}>
            {lever.code} · {lever.title}
          </span>
        </div>

        <div className={styles.traceHeaderControls}>
          <div className={styles.traceLegend} aria-label="단계 상태 범례">
            <span className={`${styles.traceLegendItem} ${styles.traceLegendDone}`}>완료</span>
            <span className={`${styles.traceLegendItem} ${styles.traceLegendRun}`}>실행 중</span>
            <span className={`${styles.traceLegendItem} ${styles.traceLegendWait}`}>대기</span>
          </div>
          <button
            type="button"
            data-testid="cost-agi-trace-auto-toggle"
            aria-pressed={autoPlay}
            className={`${styles.traceAutoBtn} ${autoPlay ? styles.traceAutoBtnOn : ''}`}
            onClick={() => setAutoPlay((prev) => !prev)}
          >
            {autoPlay ? 'AUTO 1x 재생 중' : 'AUTO 1x 정지 · 재생'}
          </button>
          <span className={styles.traceTimingReadout}>
            {selectedStage.stepNo}/06 · 2,400ms
          </span>
        </div>
      </div>

      <div className={styles.traceCanvasWrap}>
        <svg
          className={styles.diagramSvg}
          viewBox="0 0 960 512"
          role="img"
          aria-label={`${lever.code} ${lever.title} 실시간 6단계 원가·이익 트레이스 도면 및 Before After 워터폴`}
        >
          <defs>
            <pattern id={gridPatternId} width="24" height="24" patternUnits="userSpaceOnUse">
              <path
                d="M 24 0 L 0 0 0 24"
                fill="none"
                stroke="var(--agi-trace-grid)"
                strokeWidth="1"
              />
            </pattern>
            {TRACE_CARD_POSITIONS.map((pos, idx) => (
              <clipPath key={idx} id={`cost-agi-card-clip-${lever.code}-${idx}`}>
                <rect x={pos.x} y={pos.y} width="282" height="120" rx="10" />
              </clipPath>
            ))}
          </defs>

          {/* Subtle Graph-Paper Blueprint Canvas */}
          <rect
            x="2"
            y="2"
            width="956"
            height="368"
            rx="8"
            fill="var(--agi-trace-canvas)"
            stroke="var(--agi-line-soft)"
            strokeWidth="1"
          />
          <rect
            x="2"
            y="2"
            width="956"
            height="368"
            rx="8"
            fill={`url(#${gridPatternId})`}
          />

          {/* Orthogonal Connectors & Return Bus Wires */}
          {TRACE_WIRES.map((wire) => {
            const wireState = wire.targetIdx < safeIdx
              ? 'done'
              : wire.targetIdx === safeIdx
                ? 'running'
                : 'pending';
            const dotFill = wireState === 'done'
              ? 'var(--agi-trace-done)'
              : wireState === 'running'
                ? 'var(--agi-trace-run)'
                : 'var(--agi-trace-wait-dot)';
            return (
              <g key={wire.id} data-wire-state={wireState}>
                {wireState === 'done' && (
                  <>
                    <path d={wire.d} fill="none" className={styles.traceWireDone} />
                    <path d={wire.d} fill="none" className={styles.tracePacketDone} />
                  </>
                )}
                {wireState === 'running' && (
                  <path d={wire.d} fill="none" className={styles.traceWireRunning} />
                )}
                {wireState === 'pending' && (
                  <path d={wire.d} fill="none" className={styles.traceWirePending} />
                )}
                <circle cx={wire.startDot.cx} cy={wire.startDot.cy} r={wireState === 'running' ? 4 : 3.2} fill={dotFill} />
                <circle cx={wire.endDot.cx} cy={wire.endDot.cy} r={wireState === 'running' ? 4 : 3.2} fill={dotFill} />
              </g>
            );
          })}

          {/* Independent Central Bus Label Lane (y=186..218, 16px clear below y=170 return wire, 18px clear above Row 2) */}
          <g>
            <rect
              x="220"
              y="186"
              width="520"
              height="32"
              rx="6"
              fill="var(--agi-surface)"
              stroke="var(--agi-line)"
              strokeWidth="1.2"
            />
            <text
              x="480"
              y="207"
              textAnchor="middle"
              fill="var(--agi-ink)"
              fontSize="12.5"
              fontWeight="700"
              style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
            >
              {lever.code} 직교 연계 버스 · 원가 기준식 판정 → 4대 부서 반사실 실행
            </text>
          </g>

          {/* 6 Interactive Trace Stage Cards */}
          {stages.map((stage, idx) => {
            const pos = TRACE_CARD_POSITIONS[idx];
            const st = getStageState(idx);
            const isRunning = st === 'running';
            const isDone = st === 'done';
            const cardFill = isRunning ? 'var(--agi-trace-run-surface)' : 'var(--agi-surface)';
            const borderStroke = isDone
              ? 'var(--agi-trace-done)'
              : isRunning
                ? 'var(--agi-trace-run)'
                : 'var(--agi-trace-wait-border)';
            const barFill = isDone
              ? 'var(--agi-trace-done)'
              : isRunning
                ? 'var(--agi-trace-run)'
                : 'var(--agi-trace-wait-border)';
            const badgeFill = isDone
              ? 'var(--agi-trace-done-bg)'
              : isRunning
                ? 'var(--agi-trace-run-badge-bg)'
                : 'var(--agi-surface-2)';
            const badgeTextFill = isDone
              ? 'var(--agi-trace-done-ink)'
              : isRunning
                ? 'var(--agi-trace-run)'
                : 'var(--agi-muted)';

            return (
              <g
                key={stage.id}
                className={styles.traceCardGroup}
                role="button"
                tabIndex={0}
                data-testid={`cost-agi-trace-node-${stage.stepNo}`}
                data-stage-state={st}
                aria-pressed={isRunning}
                aria-label={`${stage.title} (${stateLabel(st)}) 상세 보기`}
                onClick={() => handleSelectStage(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectStage(idx);
                  }
                }}
              >
                <rect
                  x={pos.x}
                  y={pos.y}
                  width="282"
                  height="120"
                  rx="10"
                  fill={cardFill}
                  stroke={borderStroke}
                  strokeWidth={isRunning ? '2.2' : '1.6'}
                />
                {/* Left 4px Rounded Status Accent Bar */}
                <g clipPath={`url(#cost-agi-card-clip-${lever.code}-${idx})`}>
                  <rect x={pos.x} y={pos.y} width="5" height="120" fill={barFill} />
                </g>

                {/* Top Row: Stage Surface + Status Pill */}
                <text
                  x={pos.x + 18}
                  y={pos.y + 28}
                  fill="var(--agi-muted)"
                  fontSize="12.5"
                  fontWeight="600"
                  style={{ fontFamily: 'var(--agi-font)' }}
                >
                  {stage.surface}
                </text>
                <rect
                  x={pos.x + 204}
                  y={pos.y + 12}
                  width="64"
                  height="24"
                  rx="5"
                  fill={badgeFill}
                  stroke={borderStroke}
                  strokeWidth="1"
                />
                <text
                  x={pos.x + 236}
                  y={pos.y + 29}
                  textAnchor="middle"
                  fill={badgeTextFill}
                  fontSize="12.5"
                  fontWeight="700"
                  style={{ fontFamily: 'var(--agi-font)' }}
                >
                  {stateLabel(st)}
                </text>

                {/* Middle Row: Step Number & Bold Title */}
                <text
                  x={pos.x + 18}
                  y={pos.y + 60}
                  fill="var(--agi-ink)"
                  fontSize="14.5"
                  fontWeight="800"
                  style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {stage.title}
                </text>

                {/* Bottom Row: Subtle Metric/Detail Chip */}
                <rect
                  x={pos.x + 16}
                  y={pos.y + 76}
                  width="250"
                  height="30"
                  rx="5"
                  fill="var(--agi-surface-2)"
                  stroke="var(--agi-line-soft)"
                  strokeWidth="1"
                />
                <text
                  x={pos.x + 26}
                  y={pos.y + 96}
                  fill={isRunning ? 'var(--agi-trace-run)' : 'var(--agi-ink)'}
                  fontSize="12.5"
                  fontWeight="600"
                  style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {stage.chip}
                </text>
              </g>
            );
          })}

          {/* Bottom Before/After Waterfall Panel */}
          <rect
            x="2"
            y="382"
            width="956"
            height="124"
            rx="8"
            fill="var(--agi-surface)"
            stroke="var(--agi-line)"
            strokeWidth="1"
          />
          <text
            x="20"
            y="406"
            fill="var(--agi-ink)"
            fontSize="13"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
          >
            Before / After 원가 누수 대비 {lever.code} 순이익 회수 워터폴 (회수·방어율 {waterfall.recoveryPct}%)
          </text>

          {/* Row 1: Before exposure */}
          <text
            x="20"
            y="434"
            fill="var(--agi-muted)"
            fontSize="12.5"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)' }}
          >
            {waterfall.beforeLabel || '무대응 손실 노출'}
          </text>
          <rect x="236" y="421" width={barTrackWidth} height="16" rx="3" fill="var(--agi-line-soft)" />
          <rect x="236" y="421" width={beforeW} height="16" rx="3" fill="var(--agi-err)" />
          <text
            x="940"
            y="434"
            textAnchor="end"
            fill="var(--agi-err)"
            fontSize="13"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
          >
            ₩{fmtKRW(waterfall.beforeKRW)} (100%)
          </text>

          {/* Row 2: Lever Gain */}
          <text
            x="20"
            y="462"
            fill="var(--agi-ink)"
            fontSize="12.5"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)' }}
          >
            {waterfall.recoveredLabel || `${lever.code} 회수`}
          </text>
          <rect x="236" y="449" width={barTrackWidth} height="16" rx="3" fill="var(--agi-line-soft)" />
          <rect x="236" y="449" width={recW} height="16" rx="3" fill="var(--agi-trace-done)" />
          <text
            x="940"
            y="462"
            textAnchor="end"
            fill="var(--agi-trace-done-ink)"
            fontSize="13"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
          >
            +₩{fmtKRW(waterfall.recoveredKRW)} ({waterfall.recoveryPct}%)
          </text>

          {/* Row 3: Residual exposure */}
          <text
            x="20"
            y="490"
            fill="var(--agi-muted)"
            fontSize="12.5"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)' }}
          >
            {waterfall.afterLabel || '조치 후 잔여 노출'}
          </text>
          <rect x="236" y="477" width={barTrackWidth} height="16" rx="3" fill="var(--agi-line-soft)" />
          <rect x="236" y="477" width={afterW} height="16" rx="3" fill="var(--agi-muted)" />
          <text
            x="940"
            y="490"
            textAnchor="end"
            fill="var(--agi-ink)"
            fontSize="13"
            fontWeight="700"
            style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
          >
            ₩{fmtKRW(waterfall.afterKRW)}
          </text>
        </svg>
      </div>

      {/* Selected Stage Interactive Source / Department Inspector */}
      <div className={styles.traceDetailBar} data-testid="cost-agi-trace-stage-detail">
        <div className={styles.traceDetailHead}>
          <div className={styles.traceDetailTitleRow}>
            <span className={styles.traceDetailStepBadge}>
              {selectedStage.stepNo} · {stateLabel(getStageState(safeIdx))}
            </span>
            <strong className={styles.traceDetailTitle}>{selectedStage.detailHeading}</strong>
            <span className={styles.traceDetailDept}>담당: {selectedStage.ownerDept}</span>
          </div>
          <div className={styles.traceStepPills} role="group" aria-label="트레이스 단계 바로 선택">
            {stages.map((st, idx) => (
              <button
                key={st.id}
                type="button"
                aria-pressed={idx === safeIdx}
                className={`${styles.traceStepPill} ${idx === safeIdx ? styles.traceStepPillActive : ''}`}
                onClick={() => handleSelectStage(idx)}
              >
                {st.stepNo}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.traceDetailBody}>{selectedStage.detailBody}</p>
        <div className={styles.traceDetailMeta}>{selectedStage.detailMeta}</div>
      </div>
    </div>
  );
}

function LeverStoryLineagePanel({
  levers,
  deptFilter,
  setDeptFilter,
  selectedLeverCode,
  setSelectedLeverCode,
  isPopup,
}) {
  const filteredLevers = useMemo(() => {
    if (deptFilter === 'ALL') return levers;
    return levers.filter((lv) => lv.primaryDept === deptFilter || (lv.departments || []).includes(deptFilter));
  }, [levers, deptFilter]);

  const activeLever = useMemo(() => {
    return filteredLevers.find((lv) => lv.code === selectedLeverCode)
      || levers.find((lv) => lv.code === selectedLeverCode)
      || filteredLevers[0]
      || levers[0]
      || null;
  }, [filteredLevers, levers, selectedLeverCode]);

  if (!activeLever) return null;

  return (
    <section className={styles.storySection} data-testid="cost-agi-lever-story-diagram" aria-label="전사 10대 레버 상황 그림 데이터출처 부서업무 브리핑">
      <div className={styles.storyToolbar}>
        <div>
          <h2>보고자 브리핑 · 전사 10대 레버(L1~L10) 상황 · 구조 도해 · 4원천 데이터 계보 · 부서별 업무</h2>
          <span className={styles.panelHint}>
            이메일·사내 담당자·거래처의 어떤 데이터로 기준을 잡았는지와 부서별 실행 역할을 한 번에 확인합니다.
          </span>
        </div>

        <div className={styles.deptPills} role="group" aria-label="부서별 레버 필터">
          {COST_AGI_DEPARTMENTS.map((d) => {
            const active = deptFilter === d.id;
            return (
              <button
                key={d.id}
                type="button"
                data-testid={`dept-filter-${d.id}`}
                aria-pressed={active}
                className={`${styles.pillBtn} ${active ? styles.pillBtnActive : ''}`}
                onClick={() => {
                  setDeptFilter(d.id);
                  const nextList = d.id === 'ALL'
                    ? levers
                    : levers.filter((lv) => lv.primaryDept === d.id || (lv.departments || []).includes(d.id));
                  if (nextList.length && !nextList.some((lv) => lv.code === selectedLeverCode)) {
                    setSelectedLeverCode(nextList[0].code);
                  }
                }}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 10대 레버 선택 카드 스트립 */}
      <div className={styles.leverChipBar} role="tablist" aria-label="10대 원가 이익 레버 선택">
        {filteredLevers.map((lv) => {
          const active = activeLever.code === lv.code;
          return (
            <button
              key={lv.code}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`story-lever-chip-${lv.code}`}
              className={`${styles.leverChip} ${active ? styles.leverChipActive : ''}`}
              onClick={() => setSelectedLeverCode(lv.code)}
            >
              <div className={styles.leverChipTop}>
                <span className={styles.leverChipCode}>{lv.code}</span>
                <span className={styles.leverChipGain}>{fmtSignedKRW(lv.profitGainKRW)}</span>
              </div>
              <span className={styles.leverChipName}>{lv.title}</span>
              <span className={styles.leverChipDept}>주관 {lv.primaryDept} · 52주 {fmtSignedKRW(lv.annualizedGainKRW)}</span>
            </button>
          );
        })}
      </div>

      {/* 선택된 레버 최상단: 핵심 목적 · PURPOSE */}
      <div className={styles.leverPurposeCallout} data-testid="cost-agi-lever-purpose-callout">
        <div className={styles.purposeTopRow}>
          <span className={styles.purposeTag}>{activeLever.code} 핵심 목적 · PURPOSE</span>
          <span className={styles.purposeOwnerBadge}>주관 {activeLever.primaryDept}</span>
          <span className={styles.purposeRecoveryMetric}>
            차수 순이익 회수 {fmtSignedKRW(activeLever.profitGainKRW)} · 연 52주 {fmtSignedKRW(activeLever.annualizedGainKRW)} (회수율 {activeLever.visualDiagram?.waterfall?.recoveryPct ?? 0}%)
          </span>
        </div>
        <p className={styles.purposeHeadline}>
          {activeLever.story.analogySummary}
        </p>
        <div className={styles.purposeSubLine}>
          차단 대상 원가 누수: <b>{activeLever.visualDiagram?.waterfall?.beforeLabel || '무대응 손실 노출'} ₩{fmtKRW(activeLever.visualDiagram?.waterfall?.beforeKRW)}</b> → 조치 후 잔여 노출 ₩{fmtKRW(activeLever.visualDiagram?.waterfall?.afterKRW)} ({activeLever.driverText})
        </div>
      </div>

      {/* 실시간 모션 트레이스 도면 (전폭 배치) */}
      <LeverDiagramSvg lever={activeLever} />

      {/* 상황 BEFORE / AFTER 브리핑 */}
      <div className={styles.situationBox} data-testid="cost-agi-lever-situation">
        <div className={styles.situationHead}>
          <h3>[현장 상황] {activeLever.code} · {activeLever.title}</h3>
          <span className={`${styles.statusTag} ${styles.isInfo}`}>주관 {activeLever.primaryDept}</span>
        </div>
        <div className={styles.beforeAfterSplit}>
          <div className={`${styles.sceneCard} ${styles.sceneBefore}`}>
            <span className={styles.sceneTag}>BEFORE · 지금 돈이 새는 현장 상황</span>
            <p className={styles.sceneText}>{activeLever.story.beforeScene}</p>
          </div>
          <div className={`${styles.sceneCard} ${styles.sceneAfter}`}>
            <span className={styles.sceneTag}>AFTER · 레버 적용 후 바뀌는 현장</span>
            <p className={styles.sceneText}>{activeLever.story.afterScene}</p>
          </div>
        </div>
        <div className={styles.kvGrid}>
          <div className={styles.kvCell}>
            <span>차수 기대 이익 개선 ({activeLever.code})</span>
            <b>{fmtSignedKRW(activeLever.profitGainKRW)}</b>
          </div>
          <div className={styles.kvCell}>
            <span>연간 환산 (52주)</span>
            <b>{fmtSignedKRW(activeLever.annualizedGainKRW)}</b>
          </div>
        </div>
      </div>

      {/* 기준 데이터 출처 표 + 부서별 연계 업무 표 */}
      <div className={styles.lineageSubTables}>
        <div className={styles.subTablePanel} data-testid="cost-agi-lever-data-basis">
          <div className={styles.subTableHead}>
            <h4>[기준 데이터 출처 표] {activeLever.code} 4원천 계보 (어디서 무엇으로 기준을 잡았는가)</h4>
            <span className={styles.panelHint}>이메일 · 담당자 · 거래처 · 기준식</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>이메일 · 첨부 서류 원천</th>
                  <th>사내 담당자 · 채널 원천</th>
                  <th>거래처 · 농장 · 포워더 원천</th>
                  <th>판정 기준식 · 임계치</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{activeLever.dataBasis.emailSource}</td>
                  <td>{activeLever.dataBasis.staffSource}</td>
                  <td>{activeLever.dataBasis.counterpartySource}</td>
                  <td><b>{activeLever.dataBasis.criterionRule}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className={styles.subTablePanel} data-testid="cost-agi-lever-dept-table">
          <div className={styles.subTableHead}>
            <h4>[부서별 연계 업무 표] {activeLever.code} 전사 4개 부서 역할 및 실행 화면</h4>
            <span className={styles.panelHint}>원장 무쓰기 · 담당자 확인 실행</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>부서</th>
                  <th>핵심 역할</th>
                  <th>구체적 조치 · 시점</th>
                  <th>연결 화면</th>
                </tr>
              </thead>
              <tbody>
                {(activeLever.departmentTasks || []).map((task) => {
                  const isFocusedDept = deptFilter !== 'ALL' && task.dept === deptFilter;
                  return (
                    <tr key={task.dept} className={isFocusedDept ? styles.isSelected : ''}>
                      <td><b>{task.dept}</b></td>
                      <td>{task.role}</td>
                      <td>
                        <div>{task.action}</div>
                        <div className={styles.leverDriver}>실행 시점: {task.timing}</div>
                      </td>
                      <td>
                        <Link href={withPopup(task.href, isPopup)} className={styles.linkBtn}>
                          {task.screenLabel}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 전사 L1~L10 기준 데이터 출처 일람표 (접이식) */}
      <details className={styles.allLineageDetails}>
        <summary>전사 10대 레버(L1~L10) 전체 기준 데이터 출처 &amp; 부서 일람표 펼쳐보기</summary>
        <div className={styles.tableWrap} style={{ marginTop: 8 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>레버</th>
                <th>주관 부서</th>
                <th>이메일·첨부 서류</th>
                <th>사내 담당자·채널</th>
                <th>거래처·해외농장·포워더</th>
                <th>판정 기준식</th>
                <th className={styles.numCell}>차수 이익</th>
              </tr>
            </thead>
            <tbody>
              {levers.map((lv) => (
                <tr
                  key={lv.code}
                  className={lv.code === activeLever.code ? styles.isSelected : ''}
                  onClick={() => setSelectedLeverCode(lv.code)}
                >
                  <td><b>{lv.code}</b></td>
                  <td>{lv.primaryDept}</td>
                  <td>{lv.dataBasis.emailSource}</td>
                  <td>{lv.dataBasis.staffSource}</td>
                  <td>{lv.dataBasis.counterpartySource}</td>
                  <td>{lv.dataBasis.criterionRule}</td>
                  <td className={styles.numCell}><b>{fmtSignedKRW(lv.profitGainKRW)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function ViewALeversSection({ audit, maxLeverGain, selectedLeverCode, onSelectLever, isPopup, titlePrefix = '뷰 A' }) {
  return (
    <section className={styles.panel} aria-label="10대 이익 레버 분해 프로파일" data-testid="cost-agi-levers-waterfall">
      <div className={styles.panelHead}>
        <h3>{titlePrefix} · 10대 이익 레버 분해 (차수 개선 합계 {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)})</h3>
        <span className={styles.panelHint}>L1~L10 각 레버별 실측·기준 기여액 (행 클릭 시 상단 도해 연동)</span>
      </div>
      <div className={styles.leverList}>
        {audit.levers.map((lv) => {
          const widthPct = lv.profitGainKRW > 0
            ? Math.max(4, Math.round((lv.profitGainKRW / maxLeverGain) * 100))
            : 0;
          const active = selectedLeverCode === lv.code;
          return (
            <div
              key={lv.id}
              role="button"
              tabIndex={0}
              className={`${styles.leverRow} ${active ? styles.leverRowActive : ''}`}
              onClick={() => onSelectLever?.(lv.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectLever?.(lv.code);
                }
              }}
            >
              <span className={styles.leverCode}>{lv.code}</span>
              <div>
                <div className={styles.leverTitle}>{lv.title}</div>
                <div className={styles.leverDriver}>[{lv.primaryDept}] {lv.driverText}</div>
              </div>
              <div className={styles.barTrack} aria-hidden="true">
                <span className={styles.barFill} style={{ width: `${widthPct}%` }} />
              </div>
              <div className={styles.leverGain}>{fmtSignedKRW(lv.profitGainKRW)}</div>
              <Link
                href={withPopup(lv.href, isPopup)}
                className={styles.linkBtn}
                onClick={(e) => e.stopPropagation()}
              >
                {lv.actionLabel}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ViewASkuTable({ audit, selectedSku, onSelectSku }) {
  return (
    <section className={styles.panel} aria-label="품목별 실질 도착원가 및 마진 방어 원장">
      <div className={styles.panelHead}>
        <h3>품목별 실질 도착원가(True Landed Cost) 고밀도 원장 ({audit.skus.length}건)</h3>
        <span className={styles.panelHint}>행을 누르면 상세 분해·2×2 매트릭스 드로어와 동시 연동됩니다</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>품목 · 국가</th>
              <th>기준 → 대안 농장</th>
              <th className={styles.numCell}>무대응 원가</th>
              <th className={styles.numCell}>시뮬 원가</th>
              <th className={styles.numCell}>현재 판가</th>
              <th className={styles.numCell}>시뮬 마진</th>
              <th className={styles.numCell}>권장 보정</th>
              <th className={styles.numCell}>이익 개선</th>
              <th>판정</th>
            </tr>
          </thead>
          <tbody>
            {audit.skus.map((sku) => {
              const selected = selectedSku?.id === sku.id;
              const tagTone = sku.status === '단가 방어 필요'
                ? styles.isErr
                : sku.status === '원가 절감 유망'
                  ? styles.isWarn
                  : styles.isOk;
              return (
                <tr
                  key={sku.id}
                  className={selected ? styles.isSelected : ''}
                  tabIndex={0}
                  onClick={() => onSelectSku(sku.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectSku(sku.id);
                    }
                  }}
                >
                  <td>
                    <b>{sku.prodName}</b>
                    <div className={styles.leverDriver}>
                      {sku.countryName} · {fmtKRW(sku.qty)}{sku.unit} · 입수율 {sku.fillPct}%
                    </div>
                  </td>
                  <td>
                    <div>{sku.farmName}</div>
                    <div className={styles.leverDriver}>→ {sku.peerFarmName}</div>
                  </td>
                  <td className={styles.numCell}>₩{fmtKRW(sku.unhedgedLandedKRW)}</td>
                  <td className={styles.numCell}>
                    <b>₩{fmtKRW(sku.simLandedKRW)}</b>
                    <div className={styles.leverDriver}>
                      {sku.costDeltaKRW <= 0 ? `${fmtKRW(sku.costDeltaKRW)}원` : `+${fmtKRW(sku.costDeltaKRW)}원`}
                    </div>
                  </td>
                  <td className={styles.numCell}>₩{fmtKRW(sku.currentSellPriceKRW)}</td>
                  <td className={styles.numCell}>
                    <b>{sku.simPostMarginPct}%</b>
                    <div className={styles.leverDriver}>무대응 {sku.unhedgedMarginPct}%</div>
                  </td>
                  <td className={styles.numCell}>
                    {sku.appliedPriceDeltaKRW > 0 ? `+₩${fmtKRW(sku.appliedPriceDeltaKRW)}` : '유지'}
                  </td>
                  <td className={styles.numCell}>
                    <b>{fmtSignedKRW(sku.skuTotalBenefitKRW)}</b>
                  </td>
                  <td>
                    <span className={`${styles.statusTag} ${tagTone}`}>{sku.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ViewBMatrixSection({ audit, selectedSku, onSelectSku }) {
  return (
    <section className={styles.panel} aria-label="뷰 B 마진 리스크 대 물량 매트릭스">
      <div className={styles.panelHead}>
        <h3>뷰 B · 원가 리스크 × 차수 물량 비중 2×2 매트릭스</h3>
        <span className={styles.panelHint}>번호 포인트를 클릭하면 우측 반사실 슬라이더 검수 드로어가 갱신됩니다</span>
      </div>

      <div className={styles.svgWrap}>
        <svg className={styles.matrixSvg} viewBox="0 0 680 430" role="img" aria-label="원가 리스크 대 차수 물량 2x2 매트릭스">
          <rect x="64" y="34" width="584" height="336" fill="var(--agi-surface-2)" stroke="var(--agi-line)" strokeWidth="1" />
          <line x1="356" y1="34" x2="356" y2="370" stroke="var(--agi-line)" strokeWidth="1.2" />
          <line x1="64" y1="202" x2="648" y2="202" stroke="var(--agi-line)" strokeWidth="1.2" />
          <line x1="210" y1="34" x2="210" y2="370" stroke="var(--agi-line-soft)" strokeDasharray="3 4" />
          <line x1="502" y1="34" x2="502" y2="370" stroke="var(--agi-line-soft)" strokeDasharray="3 4" />
          <line x1="64" y1="118" x2="648" y2="118" stroke="var(--agi-line-soft)" strokeDasharray="3 4" />
          <line x1="64" y1="286" x2="648" y2="286" stroke="var(--agi-line-soft)" strokeDasharray="3 4" />

          <text x="74" y="54" fill="var(--agi-ok)" fontSize="12.5" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>핵심 수익 유지·물량 확대</text>
          <text x="638" y="54" textAnchor="end" fill="var(--agi-err)" fontSize="12.5" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>즉시 단가·원가 방어 (우선)</text>
          <text x="74" y="358" fill="var(--agi-muted)" fontSize="12.5" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>안정 관찰</text>
          <text x="638" y="358" textAnchor="end" fill="var(--agi-warn)" fontSize="12.5" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>AWB 혼적·농장 리밸런싱</text>

          <text x="64" y="390" textAnchor="middle" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>0</text>
          <text x="356" y="390" textAnchor="middle" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>50</text>
          <text x="648" y="390" textAnchor="middle" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>100</text>
          <text x="356" y="414" textAnchor="middle" fill="var(--agi-ink)" fontSize="13" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>
            원가 상승·마진 침식 리스크 (0~100)
          </text>

          <text x="54" y="370" textAnchor="end" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>0</text>
          <text x="54" y="206" textAnchor="end" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>50</text>
          <text x="54" y="42" textAnchor="end" fill="var(--agi-muted)" fontSize="12.5" style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}>100</text>
          <text x="20" y="202" textAnchor="middle" transform="rotate(-90 20 202)" fill="var(--agi-ink)" fontSize="13" fontWeight="700" style={{ fontFamily: 'var(--agi-font)' }}>
            차수 매출·이익 기여도
          </text>

          {audit.skus.map((sku) => {
            const cx = 64 + (sku.riskScore / 100) * 584;
            const cy = 370 - (sku.volumeScore / 100) * 336;
            const active = selectedSku?.id === sku.id;
            const strokeColor = sku.status === '단가 방어 필요'
              ? 'var(--agi-err)'
              : sku.status === '원가 절감 유망'
                ? 'var(--agi-warn)'
                : 'var(--agi-ok)';
            return (
              <g
                key={sku.id}
                transform={`translate(${cx.toFixed(1)}, ${cy.toFixed(1)})`}
                className={styles.blip}
                role="button"
                tabIndex={0}
                aria-label={`${sku.no}번 ${sku.prodName} 리스크 ${sku.riskScore} 물량 ${sku.volumeScore}`}
                aria-pressed={active}
                onClick={() => onSelectSku(sku.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSku(sku.id);
                  }
                }}
              >
                <title>{`${sku.no}. ${sku.prodName} · 리스크 ${sku.riskScore} · 기여도 ${sku.volumeScore} · ${sku.quadrant}`}</title>
                {active && <circle r="17" fill="none" stroke="var(--agi-accent)" strokeWidth="2" />}
                <circle
                  r={active ? 12 : 10}
                  fill={active ? strokeColor : 'var(--agi-surface)'}
                  stroke={strokeColor}
                  strokeWidth={active ? 2.5 : 1.8}
                />
                <text
                  textAnchor="middle"
                  dy="4"
                  fontSize="12.5"
                  fontWeight="700"
                  fill={active ? '#ffffff' : 'var(--agi-ink)'}
                  style={{ fontFamily: 'var(--agi-font)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {sku.no}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className={styles.blipIndex} aria-label="매트릭스 품목 번호 색인">
        {audit.skus.map((sku) => {
          const active = selectedSku?.id === sku.id;
          return (
            <button
              key={sku.id}
              type="button"
              className={`${styles.blipChip} ${active ? styles.blipChipActive : ''}`}
              onClick={() => onSelectSku(sku.id)}
            >
              <span>#{sku.no}</span>
              <span>{sku.prodName}</span>
              <span>{sku.simPostMarginPct}%</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ViewBSkuDrawer({ selectedSku, isPopup, pipelineHref, quickAbsorbHref }) {
  return (
    <aside className={styles.panel} aria-label="반사실 품목 검수 드로어">
      <div className={styles.panelHead}>
        <h3>반사실 품목 검수 드로어</h3>
        <span className={styles.panelHint}>{selectedSku?.quadrant || '—'}</span>
      </div>

      {selectedSku && (
        <>
          <div>
            <b style={{ fontSize: 14 }}>#{selectedSku.no} {selectedSku.prodName}</b>
            <div className={styles.leverDriver}>
              {selectedSku.countryName} · {selectedSku.farmName} → {selectedSku.peerFarmName} · 박스당 {selectedSku.actualUnitsPerBox}/{selectedSku.targetUnitsPerBox}{selectedSku.unit}
            </div>
          </div>

          <div className={styles.kvGrid}>
            <div className={styles.kvCell}>
              <span>기존 도착원가(충격 0)</span>
              <b>₩{fmtKRW(selectedSku.baseLandedKRW)}</b>
            </div>
            <div className={styles.kvCell}>
              <span>충격 무대응 원가</span>
              <b>₩{fmtKRW(selectedSku.unhedgedLandedKRW)}</b>
            </div>
            <div className={styles.kvCell}>
              <span>AGI 시뮬 원가</span>
              <b>₩{fmtKRW(selectedSku.simLandedKRW)}</b>
            </div>
            <div className={styles.kvCell}>
              <span>현재 판가 → 권장 판가</span>
              <b>₩{fmtKRW(selectedSku.currentSellPriceKRW)} → ₩{fmtKRW(selectedSku.simSellPriceKRW)}</b>
            </div>
            <div className={styles.kvCell}>
              <span>마진율 (무대응 → 시뮬)</span>
              <b>{selectedSku.unhedgedMarginPct}% → {selectedSku.simPostMarginPct}%</b>
            </div>
            <div className={styles.kvCell}>
              <span>품목 예상 이익 개선</span>
              <b>{fmtSignedKRW(selectedSku.skuTotalBenefitKRW)}</b>
            </div>
          </div>

          <div className={styles.panelHead} style={{ marginTop: 4 }}>
            <h3>바로 실행 연결</h3>
            <span className={styles.panelHint}>원장 수동 승인</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Link href={pipelineHref} className={styles.linkBtn}>
              수입 원스톱 파이프라인 실행
            </Link>
            <Link href={quickAbsorbHref} className={styles.linkBtn}>
              빠른 분배 단가 확인
            </Link>
            <Link href={withPopup('/import/freight-calc', isPopup)} className={styles.linkBtn}>
              AWB 운임 계산기
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}

function ViewCCarbonConsole({ audit, simParams, isPopup, testId = 'cost-agi-carbon-console' }) {
  return (
    <div className={styles.carbonGrid} data-testid={testId}>
      <section className={styles.panel} aria-label="환율 변동 스트레스 래더">
        <div className={styles.panelHead}>
          <h3>뷰 C · 환율 스트레스 민감도 래더 (-50원 ~ +100원)</h3>
          <span className={styles.panelHint}>현재 설정 {simParams.fxDeltaKRW >= 0 ? '+' : ''}{simParams.fxDeltaKRW}원 강조</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>변동폭</th>
                <th className={styles.numCell}>적용 환율(USD)</th>
                <th className={styles.numCell}>무대응 마진</th>
                <th className={styles.numCell}>방어후 마진</th>
                <th className={styles.numCell}>순이익 개선</th>
              </tr>
            </thead>
            <tbody>
              {audit.fxLadder.map((row) => (
                <tr key={row.fxDeltaKRW} className={row.isCurrent ? styles.isSelected : ''}>
                  <td>
                    <b>{row.fxDeltaKRW >= 0 ? `+${row.fxDeltaKRW}` : row.fxDeltaKRW}원</b>
                  </td>
                  <td className={styles.numCell}>₩{fmtKRW(row.usdRate)}</td>
                  <td className={styles.numCell}>{row.unhedgedMarginPct}%</td>
                  <td className={styles.numCell}>
                    <b>{row.defendedMarginPct}%</b>
                  </td>
                  <td className={styles.numCell}>
                    <b>{fmtSignedKRW(row.netGainKRW)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-label="AWB 중량 계단 및 혼적 최적화">
        <div className={styles.panelHead}>
          <h3>AWB 중량 계단(+100/+300/+500kg) 절감 탐색</h3>
          <span className={styles.panelHint}>{audit.awbs.length}개 AWB 중 구간 근접 {audit.summary.awbTierReadyCount}건</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>AWB · 국가</th>
                <th className={styles.numCell}>박스/중량(CW)</th>
                <th>현재 구간 → 다음 구간</th>
                <th className={styles.numCell}>부족 kg</th>
                <th className={styles.numCell}>절감 잠재액</th>
              </tr>
            </thead>
            <tbody>
              {audit.awbs.map((a) => (
                <tr key={a.awb}>
                  <td>
                    <b>{a.awb}</b>
                    <div className={styles.leverDriver}>{a.countryName} · {a.farms.join(', ')}</div>
                  </td>
                  <td className={styles.numCell}>{a.boxes}bx / {fmtNum(a.cwKg, 0)}kg</td>
                  <td>
                    <div>{a.currentTierLabel} ({a.currentRate}) → {a.nextTierLabel} ({a.nextRate})</div>
                    <div className={styles.leverDriver}>{a.note}</div>
                  </td>
                  <td className={styles.numCell}>{a.kgToNext > 0 ? `${a.kgToNext}kg` : '도달'}</td>
                  <td className={styles.numCell}>
                    <b>{fmtSignedKRW(a.unitRateSaveKRW)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-label="미회수 해외 농장 크레딧 노트 탐지">
        <div className={styles.panelHead}>
          <h3>해외 농장 불량 Credit Note 미회수 누수 탐지</h3>
          <span className={styles.panelHint}>합계 ${audit.summary.potentialCreditUSD} (₩{fmtKRW(audit.summary.potentialCreditKRW)})</span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>농장 · 품목</th>
                <th className={styles.numCell}>불량 수량</th>
                <th className={styles.numCell}>추정 크레딧</th>
                <th className={styles.numCell}>경과</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {audit.claims.map((c) => (
                <tr key={c.id}>
                  <td>
                    <b>{c.farmName}</b> · {c.countryName}
                    <div className={styles.leverDriver}>{c.prodName} — {c.reason}</div>
                  </td>
                  <td className={styles.numCell}>{fmtKRW(c.defectQty)}{c.unit}</td>
                  <td className={styles.numCell}>
                    <b>${fmtKRW(c.claimUSD)}</b>
                    <div className={styles.leverDriver}>₩{fmtKRW(c.krwValue)}</div>
                  </td>
                  <td className={styles.numCell}>{c.ageDays}일</td>
                  <td>
                    <span className={`${styles.statusTag} ${c.confirmed ? styles.isWarn : styles.isErr}`}>
                      {c.statusLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.panel} aria-label="고효율 수입 루틴 진단">
        <div className={styles.panelHead}>
          <h3>고효율 수입 루틴 (수입 속도 지수 {audit.summary.velocityScore}/100)</h3>
          <span className={styles.panelHint}>인수인계 4단계 원클릭 실행</span>
        </div>
        <ol className={styles.traceList}>
          {audit.routineSteps.map((st) => (
            <li key={st.id} className={styles.traceItem}>
              <div className={styles.traceTop}>
                <span className={styles.traceStage}>STEP 0{st.stepNo} · {st.status}</span>
                <span className={styles.traceMetric}>{st.score}점</span>
              </div>
              <div className={styles.traceTitle}>{st.title}</div>
              <div className={styles.traceDesc} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <span>{st.detail}</span>
                <Link href={withPopup(st.href, isPopup)} className={styles.linkBtn}>
                  {st.actionLabel}
                </Link>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function ContinuousBuildQueueSection({ queue, stageFilter, setStageFilter, onCopyBrief, buildCopyNotice, isPopup }) {
  const counts = useMemo(() => {
    const out = { LIVE: 0, BUILDING: 0, SPEC_READY: 0 };
    for (const item of queue) {
      if (out[item.stage] !== undefined) out[item.stage] += 1;
    }
    return out;
  }, [queue]);

  const filtered = useMemo(() => {
    if (stageFilter === 'ALL') return queue;
    return queue.filter((item) => item.stage === stageFilter);
  }, [queue, stageFilter]);

  const stageTone = (stage) => {
    if (stage === 'LIVE') return styles.isOk;
    if (stage === 'BUILDING') return styles.isWarn;
    return styles.isInfo;
  };

  const totalWeeklyBuildGain = filtered.reduce((s, x) => s + (Number(x.expectedWeeklyGainKRW) || 0), 0);

  return (
    <section
      className={styles.panel}
      data-testid="cost-agi-continuous-build-queue"
      aria-label="계속 구현해내는 자율 확장 파이프라인"
    >
      <div className={styles.panelHead}>
        <div>
          <h3>계속 구현해내는 자율 확장 파이프라인 (Continuous AGI Build Queue · L1~L10 연계 10대 모듈)</h3>
          <span className={styles.panelHint}>
            10대 레버에서 파생된 자동화 기능의 구현 단계와 기대 추가 이익을 확인하고 작업지시서를 바로 복사해 후속 구현을 이어갑니다.
          </span>
        </div>
        <span className={styles.metaBadge}>
          LIVE {counts.LIVE} · BUILDING {counts.BUILDING} · SPEC_READY {counts.SPEC_READY} · 합산 +{fmtKRW(totalWeeklyBuildGain)}원/차수
        </span>
      </div>

      <div className={styles.buildQueueControls}>
        <div className={styles.deptPills} role="group" aria-label="구현 단계 필터">
          {BUILD_STAGES.map((st) => {
            const active = stageFilter === st.id;
            return (
              <button
                key={st.id}
                type="button"
                aria-pressed={active}
                data-testid={`build-stage-${st.id}`}
                className={`${styles.pillBtn} ${active ? styles.pillBtnActive : ''}`}
                onClick={() => setStageFilter(st.id)}
              >
                {st.label}
              </button>
            );
          })}
        </div>
        <span className={styles.panelHint}>원장 무쓰기 읽기 전용 지시서 · 담당자 승인 후 배포</span>
      </div>

      {buildCopyNotice && (
        <div className={styles.noticeBanner} role="status" data-testid="cost-agi-build-copy-notice">
          {buildCopyNotice}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>레버</th>
              <th>자동화 모듈명 · 구현 작업 범위</th>
              <th>진행 단계</th>
              <th>연결 부서</th>
              <th className={styles.numCell}>기대 추가 이익 (차수 / 52주)</th>
              <th>작업 실행 · 지시서</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((mod) => (
              <tr key={mod.moduleId}>
                <td><b>{mod.leverCode}</b></td>
                <td>
                  <b>{mod.title}</b>
                  <div className={styles.leverDriver}>{mod.implementationBrief}</div>
                </td>
                <td>
                  <span className={`${styles.statusTag} ${stageTone(mod.stage)}`}>{mod.stageLabel}</span>
                </td>
                <td>{(mod.targetDepts || []).join(' · ')}</td>
                <td className={styles.numCell}>
                  <b>{fmtSignedKRW(mod.expectedWeeklyGainKRW)}</b>
                  <div className={styles.leverDriver}>연 {fmtSignedKRW(mod.expectedAnnualGainKRW)}</div>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Link href={withPopup(mod.ownerRoute, isPopup)} className={styles.linkBtn}>
                      대상 화면
                    </Link>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      data-testid={`copy-build-brief-${mod.moduleId}`}
                      onClick={() => onCopyBrief(mod)}
                    >
                      구현 작업지시서 복사
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ImportCostAgiWorkbench({
  userId = '',
  userName = '',
  embedded = false,
  initialViewMode = 'A',
  showGuide = true,
}) {
  const [orderYear, setOrderYear] = useState('2026');
  const [orderWeek, setOrderWeek] = useState('46-01');
  const [country, setCountry] = useState('ALL');
  const [viewMode, setViewMode] = useState(VALID_VIEWS.includes(initialViewMode) ? initialViewMode : 'A');
  const [isPopup, setIsPopup] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [simParams, setSimParams] = useState(() => ({ ...DEFAULT_SIM_PARAMS }));
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [selectedLeverCode, setSelectedLeverCode] = useState('L1');
  const [buildStageFilter, setBuildStageFilter] = useState('ALL');

  const [recentWeeks, setRecentWeeks] = useState([]);
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatusNote, setFetchStatusNote] = useState('');

  const [copyNotice, setCopyNotice] = useState('');
  const [buildCopyNotice, setBuildCopyNotice] = useState('');
  const briefingRef = useRef(null);
  const activeFetchRef = useRef(null);

  useEffect(() => {
    const init = parseInitContext(initialViewMode);
    setOrderYear(init.orderYear);
    setOrderWeek(init.orderWeek);
    setCountry(init.country);
    setViewMode(init.viewMode);
    setIsPopup(init.isPopup);
    setHydrated(true);

    const ctrl = new AbortController();
    fetchReadOnlyJson('/api/incoming/insight?view=weeks', ctrl.signal)
      .then((j) => {
        if (!ctrl.signal.aborted && Array.isArray(j.weeks)) {
          setRecentWeeks(j.weeks.slice(0, 12));
        }
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [initialViewMode]);

  useEffect(() => {
    if (!hydrated || embedded || typeof window === 'undefined') return;
    const params = new URLSearchParams();
    params.set('year', orderYear);
    params.set('week', orderWeek);
    if (country && country !== 'ALL') params.set('country', country);
    if (viewMode !== 'A') params.set('view', viewMode);
    if (isPopup) params.set('popup', '1');
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    if (nextUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [hydrated, embedded, orderYear, orderWeek, country, viewMode, isPopup]);

  const loadLiveContext = useCallback(async () => {
    if (!hydrated || !/^\d{4}$/.test(orderYear) || !/^\d{2}-\d{2}$/.test(orderWeek)) return;
    activeFetchRef.current?.abort();
    const ctrl = new AbortController();
    activeFetchRef.current = ctrl;
    setLoading(true);
    setFetchStatusNote('');

    const requests = [
      ['board', fetchReadOnlyJson(`/api/incoming/insight?view=board&year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`, ctrl.signal)],
      ['awbcalc', fetchReadOnlyJson(`/api/incoming/insight?view=awbcalc&year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`, ctrl.signal)],
      ['lista', fetchReadOnlyJson(`/api/incoming/insight?view=lista&year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}`, ctrl.signal)],
      ['arrivalCosts', fetchReadOnlyJson(`/api/arrival-cost?orderYear=${encodeURIComponent(orderYear)}&orderWeek=${encodeURIComponent(orderWeek)}&allVarieties=1&page=1&pageSize=200`, ctrl.signal)],
      ['exchange', fetchReadOnlyJson('/api/finance/exchange', ctrl.signal)],
    ];

    const settled = await Promise.allSettled(requests.map(([, p]) => p));
    if (ctrl.signal.aborted) return;

    const next = {};
    let okCount = 0;
    requests.forEach(([key], idx) => {
      const outcome = settled[idx];
      if (outcome.status === 'fulfilled') {
        okCount++;
        if (key === 'board') next.board = outcome.value;
        else if (key === 'awbcalc') next.awbcalc = outcome.value.awbs || [];
        else if (key === 'lista') next.lista = outcome.value.rows || [];
        else if (key === 'arrivalCosts') next.arrivalCosts = outcome.value.rows || [];
        else if (key === 'exchange') next.exchange = outcome.value;
      }
    });

    setApiData(next);
    setFetchStatusNote(
      okCount === 0
        ? '오프라인/미접속 시뮬레이션 기준 모델 가동 중 (전산 원장 미연결)'
        : `읽기 전용 조회 ${okCount}/5개 응답 수신 완료`,
    );
    setLoading(false);
  }, [hydrated, orderYear, orderWeek]);

  useEffect(() => {
    if (!hydrated) return undefined;
    const timer = setTimeout(() => { void loadLiveContext(); }, 90);
    return () => {
      clearTimeout(timer);
      activeFetchRef.current?.abort();
    };
  }, [hydrated, orderYear, orderWeek, loadLiveContext]);

  const audit = useMemo(
    () => runCostAgiAudit({ orderYear, orderWeek, country, simParams, apiData }),
    [orderYear, orderWeek, country, simParams, apiData],
  );

  const selectedSku = useMemo(() => {
    if (!audit.skus.length) return null;
    return audit.skus.find((s) => s.id === selectedSkuId) || audit.skus[0];
  }, [audit.skus, selectedSkuId]);

  const briefingText = useMemo(() => buildCostAgiExecutiveBriefing(audit), [audit]);

  const isDirtyState = useMemo(() => {
    const def = DEFAULT_SIM_PARAMS;
    const simChanged = Object.keys(def).some((k) => simParams[k] !== def[k]);
    return simChanged || viewMode !== initialViewMode || Boolean(selectedSkuId) || country !== 'ALL' || deptFilter !== 'ALL';
  }, [simParams, viewMode, initialViewMode, selectedSkuId, country, deptFilter]);

  useEffect(() => {
    const onBack = (event) => {
      if (!isDirtyState) return;
      event.preventDefault();
      setSimParams({ ...DEFAULT_SIM_PARAMS });
      setViewMode(VALID_VIEWS.includes(initialViewMode) ? initialViewMode : 'A');
      setSelectedSkuId('');
      setCountry('ALL');
      setDeptFilter('ALL');
      setSelectedLeverCode('L1');
      setBuildStageFilter('ALL');
      setCopyNotice('');
      setBuildCopyNotice('');
    };
    window.addEventListener(MENU_BACK_REQUEST_EVENT, onBack);
    return () => window.removeEventListener(MENU_BACK_REQUEST_EVENT, onBack);
  }, [isDirtyState, initialViewMode]);

  const updateParam = (key, value) => {
    setSimParams((prev) => normalizeSimParams({ ...prev, [key]: value }));
  };

  const applyPreset = (preset) => {
    setSimParams(normalizeSimParams(preset.params));
  };

  const moveYear = (delta) => {
    const num = Number(orderYear);
    if (!Number.isFinite(num)) return;
    setOrderYear(String(Math.max(2020, Math.min(2099, num + delta))));
  };

  const moveWeek = (dir) => {
    const next = stepWeek(`${orderYear}-${orderWeek}`, dir);
    const parts = next.split('-');
    if (parts.length === 3) {
      setOrderYear(parts[0]);
      setOrderWeek(`${parts[1]}-${parts[2]}`);
    }
  };

  const onTabKeyDown = (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll('button[role="tab"]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const nextIdx = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    const nextMode = COST_AGI_VIEW_MODES[nextIdx]?.id;
    if (nextMode) setViewMode(nextMode);
    buttons[nextIdx]?.focus();
  };

  const copyBriefing = async () => {
    const ok = await copyTextSafe(briefingText, briefingRef);
    setCopyNotice(
      ok
        ? '사장님 보고용 10대 레버 원가·이익 브리핑을 클립보드에 복사했습니다. (자동 발송 없음)'
        : '자동 복사가 차단되었습니다. 아래 브리핑 상자에서 Ctrl+C로 복사해 주세요.',
    );
  };

  const copyBuildBrief = async (mod) => {
    const fullBrief = [
      `[원가·이익 AGI 연속구현 작업지시서] ${mod.leverCode} · ${mod.title}`,
      `단계: ${mod.stageLabel} | 대상 부서: ${(mod.targetDepts || []).join(', ')} | 대상 화면: ${mod.ownerRoute}`,
      `기대 효과: 차수 +₩${fmtKRW(mod.expectedWeeklyGainKRW)} / 52주 +₩${fmtKRW(mod.expectedAnnualGainKRW)}`,
      `구현 명세: ${mod.implementationBrief}`,
    ].join('\n');
    const ok = await copyTextSafe(fullBrief);
    const msg = ok
      ? `[${mod.leverCode}] "${mod.title}" 구현 작업지시서를 클립보드에 복사했습니다.`
      : `[${mod.leverCode}] "${mod.title}" 구현 작업지시서 복사 대기 (수동 복사 필요).`;
    setBuildCopyNotice(msg);
    setCopyNotice(msg);
  };

  const maxLeverGain = Math.max(1, ...audit.levers.map((l) => l.profitGainKRW));
  const pipelineHref = withPopup(`/import/pipeline?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}${country !== 'ALL' ? `&country=${encodeURIComponent(country)}` : ''}`, isPopup);
  const quickAbsorbHref = withPopup('/shipment/quick-absorb', isPopup);
  const manualsHref = withPopup('/work/manuals', isPopup);

  return (
    <div
      className={`${styles.root} ${embedded ? styles.embedded : ''}`}
      data-view={viewMode}
      data-testid="cost-profit-agi-workbench"
    >
      {/* 1. 상단 헤더 & 1px 헤어라인 KPI 스트립 */}
      <header className={styles.topbar}>
        <div className={styles.topMain}>
          <div className={styles.titleBlock}>
            <div className={styles.eyebrow} data-desktop-chrome>
              IMPORT COST &amp; PROFIT AGI · 10-LEVER LINEAGE &amp; MULTI-VIEW WORKBENCH
            </div>
            <div className={styles.titleRow}>
              {embedded ? (
                <h2>수입 원가·이익 AGI 워크벤치</h2>
              ) : (
                <h1 data-desktop-chrome>수입 원가·이익 AGI 워크벤치</h1>
              )}
            </div>
            <p className={styles.subtitle}>
              AWB·혼적, 교차소싱·APTA 관세, 마진방어(23%), 크레딧, 선처리, 외화송금, 체화재고, 공헌이익 배분, 카톡 추가취소 컷오프, 통관·보세·용차 대사까지 전사 10대 이익 레버(L1~L10)와 데이터 출처·부서 업무를 실시간 시뮬레이션합니다.
            </p>
          </div>

          <div className={styles.metaBadges}>
            <span className={styles.metaBadge}>
              {orderYear}년 {orderWeek}차 · {countryLabel(country)}
            </span>
            <span className={`${styles.metaBadge} ${styles.metaBadgeOk}`}>
              {audit.dataMode === 'live-plus-model' ? '실전산 + 기준모델' : '시뮬레이션 기준 모델 (무쓰기)'}
            </span>
            {userName && <span className={styles.metaBadge}>담당 {userName}</span>}
          </div>
        </div>

        {/* 최상단 핵심 목적 · PURPOSE Callout */}
        <div className={styles.purposeCallout} data-testid="cost-agi-purpose-callout">
          <div className={styles.purposeTopRow}>
            <span className={styles.purposeTag}>핵심 목적 · PURPOSE</span>
            <span className={styles.purposeRecoveryMetric}>
              전사 10대 레버(L1~L10) 차수 순이익 회수 {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)} · 연 52주 {fmtSignedKRW(audit.summary.annualizedProfitKRW)}
            </span>
          </div>
          <p className={styles.purposeHeadline}>
            수입·통관·배분·정산 전 구간의 10대 원가 누수를 선제 차단해 차수당 {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)}(연간 {fmtSignedKRW(audit.summary.annualizedProfitKRW)}) 순이익을 회수하는 읽기 전용 의사결정 워크벤치입니다.
          </p>
          <div className={styles.purposeSubLine}>
            무대응 총이익률 <b>{audit.summary.unhedgedMarginPct}%</b> → 방어 후 <b>{audit.summary.simulatedMarginPct}%</b> ({audit.summary.marginDeltaPctPt >= 0 ? '+' : ''}{audit.summary.marginDeltaPctPt}%p) · 원가 누수·마진 경보 <b>{audit.summary.costLeakAlertCount}건</b> 즉시 진단 · 담당자 승인 전 원장 무쓰기 보장
          </div>
        </div>

        <div className={styles.kpiStrip} aria-label="이익 최적화 핵심 지표">
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>전사 10대 레버 차수 이익 개선액</span>
            <b className={`${styles.kpiValue} ${styles.isOk}`} data-testid="cost-agi-kpi-profit">
              {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)}
            </b>
            <span className={styles.kpiSub}>
              무대응 {fmtKRW(audit.summary.unhedgedProfitKRW)}원 → 개선 {fmtKRW(audit.summary.simulatedProfitKRW)}원
            </span>
          </div>
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>연간 환산 이익 개선 (52주)</span>
            <b className={`${styles.kpiValue} ${styles.isOk}`} data-testid="cost-agi-kpi-annual">
              {fmtSignedKRW(audit.summary.annualizedProfitKRW)}
            </b>
            <span className={styles.kpiSub}>
              기준환율 ₩{fmtKRW(audit.fx.USD)}/USD · ₩{fmtKRW(audit.fx.EUR)}/EUR
            </span>
          </div>
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>원가 누수·마진 경보</span>
            <b className={`${styles.kpiValue} ${audit.summary.costLeakAlertCount > 0 ? styles.isWarn : styles.isOk}`}>
              {audit.summary.costLeakAlertCount}건
            </b>
            <span className={styles.kpiSub}>
              마진미달 {audit.summary.marginErosionAlertCount} · AWB근접 {audit.summary.awbTierReadyCount} · 크레딧 {audit.summary.unrecoveredClaimCount}
            </span>
          </div>
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>목표 마진 방어율 · 총이익률</span>
            <b className={`${styles.kpiValue} ${audit.summary.marginDefenseRatePct >= 80 ? styles.isOk : styles.isWarn}`}>
              {audit.summary.marginDefenseRatePct}% · {audit.summary.simulatedMarginPct}%
            </b>
            <span className={styles.kpiSub}>
              무대응 {audit.summary.unhedgedMarginPct}% 대비 {audit.summary.marginDeltaPctPt >= 0 ? '+' : ''}{audit.summary.marginDeltaPctPt}%p
            </span>
          </div>
        </div>
      </header>

      {/* 사용 가이드 영상 (단독 페이지 기본 제공) */}
      {showGuide && (
        <div className={styles.guideWrap}>
          <WorkflowGuide workflowId="import-cost-profit-agi" initialRole="수입부" />
        </div>
      )}

      {/* 2. 차수·국가 필터 바 & 시안 A·B·C·ALL 전환 탭 */}
      <section className={styles.controlStrip} aria-label="차수·국가 선택 및 시안 전환">
        <div className={styles.scopeRow}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="cost-agi-year">연도 (OrderYear)</label>
            <div className={styles.stepper}>
              <button type="button" aria-label="이전 연도" onClick={() => moveYear(-1)}>‹</button>
              <input
                id="cost-agi-year"
                aria-label="연도 (OrderYear)"
                maxLength={4}
                value={orderYear}
                onChange={(e) => setOrderYear(e.target.value)}
              />
              <button type="button" aria-label="다음 연도" onClick={() => moveYear(1)}>›</button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="cost-agi-week">세부차수 (OrderWeek)</label>
            <div className={styles.stepper}>
              <button type="button" aria-label="이전 세부차수" onClick={() => moveWeek('prev')}>‹</button>
              <input
                id="cost-agi-week"
                aria-label="세부차수 (OrderWeek)"
                maxLength={5}
                value={orderWeek}
                onChange={(e) => setOrderWeek(e.target.value)}
              />
              <button type="button" aria-label="다음 세부차수" onClick={() => moveWeek('next')}>›</button>
            </div>
          </div>

          {recentWeeks.length > 0 && (
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="cost-agi-recent-week">최근 입고 차수</label>
              <select
                id="cost-agi-recent-week"
                className={styles.selectInput}
                value={`${orderYear}|${orderWeek}`}
                onChange={(e) => {
                  const [y, w] = e.target.value.split('|');
                  if (y && w) { setOrderYear(y); setOrderWeek(w); }
                }}
              >
                {recentWeeks.map((w) => (
                  <option key={`${w.year}-${w.week}`} value={`${w.year}|${w.week}`}>
                    {w.year} {w.week} ({w.n}건)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>국가 선택</span>
            <div className={styles.countryPills} role="group" aria-label="수입 국가 필터">
              {PIPELINE_COUNTRIES.map((c) => {
                const active = country === c.code;
                return (
                  <button
                    key={c.code}
                    type="button"
                    aria-pressed={active}
                    className={`${styles.pillBtn} ${active ? styles.pillBtnActive : ''}`}
                    onClick={() => setCountry(c.code)}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryBtn} onClick={loadLiveContext} disabled={loading}>
              {loading ? '조회 중…' : '실데이터 재조회'}
            </button>
            <Link href={pipelineHref} className={styles.linkBtn}>
              수입 원스톱 파이프라인
            </Link>
            <Link href={quickAbsorbHref} className={styles.linkBtn}>
              빠른 분배 단가 확인
            </Link>
            <Link href={manualsHref} className={styles.linkBtn}>
              업무 매뉴얼
            </Link>
            <button
              type="button"
              className={styles.primaryBtn}
              data-testid="cost-agi-copy-briefing"
              onClick={copyBriefing}
            >
              사장님 보고용 원가·이익 브리핑 복사
            </button>
          </div>
        </div>

        {fetchStatusNote && (
          <div className={styles.panelHint} role="status">
            {fetchStatusNote} · 원장 무쓰기 읽기 전용
          </div>
        )}

        {copyNotice && (
          <div className={styles.noticeBanner} role="status" data-testid="cost-agi-copy-notice">
            {copyNotice}
          </div>
        )}

        <div className={styles.viewTabs} role="tablist" aria-label="시안 A B C ALL 시뮬레이션 뷰 전환" onKeyDown={onTabKeyDown}>
          {COST_AGI_VIEW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`cost-agi-view-tab-${m.id}`}
              aria-selected={viewMode === m.id}
              aria-controls="cost-agi-view-stage"
              data-testid={`cost-agi-view-${m.id}`}
              className={styles.viewTab}
              onClick={() => setViewMode(m.id)}
            >
              <span>{m.code}</span>
              <span>{m.shortLabel}</span>
            </button>
          ))}
          <span className={styles.viewDesc}>
            {COST_AGI_VIEW_MODES.find((m) => m.id === viewMode)?.description}
          </span>
        </div>
      </section>

      {/* 3. 반사실(Counterfactual) 이익 시뮬레이터 컨트롤 (전사 L1~L10 마스터 제어) */}
      <section className={styles.simPanel} aria-label="반사실 이익 시뮬레이터 제어">
        <div className={styles.simHead}>
          <h2>마스터 반사실(Counterfactual) 이익 시뮬레이션 컨트롤 (L1~L10 동시 연동)</h2>
          <div className={styles.presetRow}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`cost-agi-preset-${p.id}`}
                className={styles.secondaryBtn}
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.slidersGrid}>
          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-fx-delta">환율 충격 (₩/USD)</label>
              <span className={styles.sliderReadout} data-testid="readout-fx">
                {simParams.fxDeltaKRW >= 0 ? '+' : ''}{simParams.fxDeltaKRW}원 (₩{fmtKRW(audit.fx.USD)})
              </span>
            </div>
            <input
              id="sim-fx-delta"
              type="range"
              min={-50}
              max={100}
              step={5}
              value={simParams.fxDeltaKRW}
              onChange={(e) => updateParam('fxDeltaKRW', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>범위 -50원 ~ +100원 (EUR/CNY 연동)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-rebalance">L2 농장 리밸런싱 비율</label>
              <span className={styles.sliderReadout} data-testid="readout-rebalance">
                {simParams.rebalancePct}%
              </span>
            </div>
            <input
              id="sim-rebalance"
              type="range"
              min={0}
              max={50}
              step={5}
              value={simParams.rebalancePct}
              onChange={(e) => updateParam('rebalancePct', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>우위 농장 교차 배분 · E1 관세 (0~50%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-box-fill">L1 박스 채움·혼적 개선</label>
              <span className={styles.sliderReadout} data-testid="readout-boxfill">
                +{simParams.boxFillGainPct}%
              </span>
            </div>
            <input
              id="sim-box-fill"
              type="range"
              min={0}
              max={20}
              step={2}
              value={simParams.boxFillGainPct}
              onChange={(e) => updateParam('boxFillGainPct', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>입수 정상화 · AWB 계단 진입 (0~20%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-margin-defense">L3·L5 권장 판가 방어율</label>
              <span className={styles.sliderReadout} data-testid="readout-defense">
                {simParams.marginDefenseRatio}%
              </span>
            </div>
            <input
              id="sim-margin-defense"
              type="range"
              min={0}
              max={100}
              step={10}
              value={simParams.marginDefenseRatio}
              onChange={(e) => updateParam('marginDefenseRatio', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>마진 침식 품목 출고단가 보정률 (0~100%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-target-margin">L3 목표 총이익률 기준선</label>
              <span className={styles.sliderReadout} data-testid="readout-targetmargin">
                {simParams.targetMarginPct}%
              </span>
            </div>
            <input
              id="sim-target-margin"
              type="range"
              min={12}
              max={30}
              step={1}
              value={simParams.targetMarginPct}
              onChange={(e) => updateParam('targetMarginPct', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>품목별 목표 마진 방어 하한선 (12~30%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-fx-split">L6 외화 송금 분할 방어</label>
              <span className={styles.sliderReadout} data-testid="readout-fxsplit">
                {simParams.fxSplitSchedulePct}%
              </span>
            </div>
            <input
              id="sim-fx-split"
              type="range"
              min={0}
              max={100}
              step={10}
              value={simParams.fxSplitSchedulePct}
              onChange={(e) => updateParam('fxSplitSchedulePct', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>미등록 49농장·30원+ 편차 분산 (0~100%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-aged-stock">L7 체화재고 조기 소진</label>
              <span className={styles.sliderReadout} data-testid="readout-agedstock">
                {simParams.agedStockClearRatio}%
              </span>
            </div>
            <input
              id="sim-aged-stock"
              type="range"
              min={0}
              max={100}
              step={10}
              value={simParams.agedStockClearRatio}
              onChange={(e) => updateParam('agedStockClearRatio', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>D+3·5·7일 잔량 특가 회수율 (0~100%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-customer-alloc">L8 공헌이익 배분 가중</label>
              <span className={styles.sliderReadout} data-testid="readout-custalloc">
                {simParams.customerAllocRatio}%
              </span>
            </div>
            <input
              id="sim-customer-alloc"
              type="range"
              min={0}
              max={100}
              step={10}
              value={simParams.customerAllocRatio}
              onChange={(e) => updateParam('customerAllocRatio', Number(e.target.value))}
            />
            <span className={styles.sliderSub}>순단가-클레임-미수 우선 배분 (0~100%)</span>
          </div>
        </div>

        <div className={styles.creditToggleRow}>
          <div className={styles.toggleGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                data-testid="toggle-credit-recovery"
                checked={simParams.creditRecoveryEnabled}
                onChange={(e) => updateParam('creditRecoveryEnabled', e.target.checked)}
              />
              <span>
                L4 미회수 Credit Note 회수 ({audit.claims.length}건 · ${audit.summary.potentialCreditUSD})
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                data-testid="toggle-cutoff-guard"
                checked={simParams.cutoffGuardEnabled}
                onChange={(e) => updateParam('cutoffGuardEnabled', e.target.checked)}
              />
              <span>
                L9 카톡 추가취소(addcancel) D-2h 컷오프 방어
              </span>
            </label>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                data-testid="toggle-customs-audit"
                checked={simParams.customsRateAuditEnabled}
                onChange={(e) => updateParam('customsRateAuditEnabled', e.target.checked)}
              />
              <span>
                L10 통관(선율)·보세(백상)·용차 요율 대사
              </span>
            </label>
          </div>
          <span className={styles.panelHint}>
            원장 무쓰기 읽기 전용 · 모든 수치가 실시간 재계산됩니다.
          </span>
        </div>
      </section>

      {/* 3.5 보고자·경영진 친화적 10대 레버 상황·그림·데이터 계보·부서업무 브리핑 패널 */}
      <LeverStoryLineagePanel
        levers={audit.levers}
        deptFilter={deptFilter}
        setDeptFilter={setDeptFilter}
        selectedLeverCode={selectedLeverCode}
        setSelectedLeverCode={setSelectedLeverCode}
        isPopup={isPopup}
      />

      {/* 4. 시안 A · B · C · ALL 메인 스테이지 */}
      <div id="cost-agi-view-stage" role="tabpanel" aria-labelledby={`cost-agi-view-tab-${viewMode}`}>
        {viewMode === 'A' && (
          <div className={styles.split}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <ViewALeversSection
                audit={audit}
                maxLeverGain={maxLeverGain}
                selectedLeverCode={selectedLeverCode}
                onSelectLever={setSelectedLeverCode}
                isPopup={isPopup}
                titlePrefix="뷰 A"
              />
              <ViewASkuTable
                audit={audit}
                selectedSku={selectedSku}
                onSelectSku={setSelectedSkuId}
              />
            </div>

            {/* 우측: 선택 품목 상세 & 4단계 AGI 추론 파이프라인 */}
            <aside className={styles.panel} aria-label="선택 품목 원가 분해 및 AGI 추론">
              <div className={styles.panelHead}>
                <h3>선택 품목 반사실 검수</h3>
                <span className={styles.panelHint}>{selectedSku?.countryName || '—'}</span>
              </div>

              {selectedSku && (
                <>
                  <div>
                    <b style={{ fontSize: 14 }}>{selectedSku.prodName}</b>
                    <div className={styles.leverDriver}>
                      {selectedSku.farmName} ({selectedSku.fobForeign} {selectedSku.currency}) → 대안 {selectedSku.peerFarmName} ({selectedSku.peerFobForeign} {selectedSku.currency})
                    </div>
                  </div>

                  <div className={styles.kvGrid}>
                    <div className={styles.kvCell}>
                      <span>무대응 도착원가</span>
                      <b>₩{fmtKRW(selectedSku.unhedgedLandedKRW)}/{selectedSku.unit}</b>
                    </div>
                    <div className={styles.kvCell}>
                      <span>시뮬레이션 도착원가</span>
                      <b>₩{fmtKRW(selectedSku.simLandedKRW)}/{selectedSku.unit}</b>
                    </div>
                    <div className={styles.kvCell}>
                      <span>L1 AWB·박스 채움 절감</span>
                      <b>+₩{fmtKRW(selectedSku.l1TotalSaveKRW)}</b>
                    </div>
                    <div className={styles.kvCell}>
                      <span>L2 농장 리밸런싱 절감</span>
                      <b>+₩{fmtKRW(selectedSku.l2TotalSaveKRW)}</b>
                    </div>
                    <div className={styles.kvCell}>
                      <span>L3 권장 단가 방어</span>
                      <b>+₩{fmtKRW(selectedSku.l3TotalDefenseKRW)}</b>
                    </div>
                    <div className={styles.kvCell}>
                      <span>품목 합산 이익 개선</span>
                      <b>{fmtSignedKRW(selectedSku.skuTotalBenefitKRW)}</b>
                    </div>
                  </div>
                </>
              )}

              <div className={styles.panelHead} style={{ marginTop: 4 }}>
                <h3>Observe → Diagnose → Simulate → Propose</h3>
                <span className={styles.panelHint}>4단계 자율 추론 근거</span>
              </div>
              <ol className={styles.traceList}>
                {audit.agiTrace.map((t) => (
                  <li key={t.stage} className={styles.traceItem}>
                    <div className={styles.traceTop}>
                      <span className={styles.traceStage}>{t.stepNo} · {t.stage}</span>
                      <span className={styles.traceMetric}>{t.metric}</span>
                    </div>
                    <div className={styles.traceTitle}>{t.title}</div>
                    <div className={styles.traceDesc}>{t.summary}</div>
                  </li>
                ))}
              </ol>

              <div className={styles.panelHead} style={{ marginTop: 4 }}>
                <h3>사장님 보고용 브리핑 미리보기</h3>
                <span className={styles.panelHint}>복사용 텍스트</span>
              </div>
              <textarea
                ref={briefingRef}
                readOnly
                aria-label="사장님 보고용 원가 이익 브리핑"
                className={styles.briefingBox}
                value={briefingText}
              />
            </aside>
          </div>
        )}

        {viewMode === 'B' && (
          <div className={styles.split}>
            <ViewBMatrixSection
              audit={audit}
              selectedSku={selectedSku}
              onSelectSku={setSelectedSkuId}
            />
            <ViewBSkuDrawer
              selectedSku={selectedSku}
              isPopup={isPopup}
              pipelineHref={pipelineHref}
              quickAbsorbHref={quickAbsorbHref}
            />
          </div>
        )}

        {viewMode === 'C' && (
          <ViewCCarbonConsole
            audit={audit}
            simParams={simParams}
            isPopup={isPopup}
            testId="cost-agi-carbon-console"
          />
        )}

        {viewMode === 'ALL' && (
          <div className={styles.allContainer} data-testid="cost-agi-all-mode">
            <div className={styles.allSyncBar}>
              <span>
                뷰 ALL · A·B·C 동시 시뮬레이션 가동 중 — 상단 마스터 슬라이더·국가·품목 선택이 뷰 A(10대 레버), 뷰 B(2×2 매트릭스), 뷰 C(카본 콘솔)에 동시 반영됩니다.
              </span>
              <span className={styles.metaBadge}>
                선택 품목: {selectedSku ? `#${selectedSku.no} ${selectedSku.prodName}` : '—'} · 선택 레버: {selectedLeverCode}
              </span>
            </div>

            {/* 동시 패널 1행: 뷰 A(10대 레버 + 원장 요약) + 뷰 B(2×2 매트릭스 + 검수 드로어) */}
            <div className={styles.allPairGrid}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }} data-testid="cost-agi-all-panel-A">
                <ViewALeversSection
                  audit={audit}
                  maxLeverGain={maxLeverGain}
                  selectedLeverCode={selectedLeverCode}
                  onSelectLever={setSelectedLeverCode}
                  isPopup={isPopup}
                  titlePrefix="뷰 A (동시)"
                />
                <ViewASkuTable
                  audit={audit}
                  selectedSku={selectedSku}
                  onSelectSku={setSelectedSkuId}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }} data-testid="cost-agi-all-panel-B">
                <ViewBMatrixSection
                  audit={audit}
                  selectedSku={selectedSku}
                  onSelectSku={setSelectedSkuId}
                />
                <ViewBSkuDrawer
                  selectedSku={selectedSku}
                  isPopup={isPopup}
                  pipelineHref={pipelineHref}
                  quickAbsorbHref={quickAbsorbHref}
                />
              </div>
            </div>

            {/* 동시 패널 2행: 뷰 C(매트 카본 다크 전술 콘솔) */}
            <div className={styles.carbonSurface} data-testid="cost-agi-all-panel-C">
              <div className={styles.panelHead}>
                <h3>뷰 C (동시) · 매트 카본 환율·AWB·크레딧·속도 전술 콘솔</h3>
                <span className={styles.panelHint}>환율 충격 {simParams.fxDeltaKRW >= 0 ? '+' : ''}{simParams.fxDeltaKRW}원 · 크레딧 {simParams.creditRecoveryEnabled ? '반영' : '제외'} 실시간 동기화</span>
              </div>
              <ViewCCarbonConsole
                audit={audit}
                simParams={simParams}
                isPopup={isPopup}
                testId="cost-agi-all-carbon-console"
              />
            </div>

            {/* 하단: 계속 구현해내는 자율 확장 파이프라인 */}
            <ContinuousBuildQueueSection
              queue={audit.continuousBuildQueue}
              stageFilter={buildStageFilter}
              setStageFilter={setBuildStageFilter}
              onCopyBrief={copyBuildBrief}
              buildCopyNotice={buildCopyNotice}
              isPopup={isPopup}
            />
          </div>
        )}
      </div>
    </div>
  );
}
