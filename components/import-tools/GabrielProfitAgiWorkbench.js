import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import WorkflowGuide from '../WorkflowGuide';
import { getCurrentWeek, stepWeek } from '../../lib/useWeekInput';
import { MENU_BACK_REQUEST_EVENT } from '../../lib/menuNavigationHistory';
import {
  DEFAULT_SIM_PARAMS,
  GABRIEL_VIEW_MODES,
  PIPELINE_COUNTRIES,
  buildGabrielExecutiveBriefing,
  countryLabel,
  normalizeCountryCode,
  normalizeSimParams,
  runGabrielAgiAudit,
} from '../../lib/gabrielProfitAgi';
import styles from '../../styles/GabrielProfitAgi.module.css';

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
    },
  }),
  Object.freeze({
    id: 'gabriel-optimal',
    label: '가브리엘 최적 루프',
    params: {
      fxDeltaKRW: 0,
      rebalancePct: 50,
      boxFillGainPct: 20,
      marginDefenseRatio: 100,
      targetMarginPct: 20,
      creditRecoveryEnabled: true,
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
    },
  }),
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
  if (typeof window === 'undefined') {
    return { orderYear: defYear, orderWeek: defWeek, country: 'ALL', viewMode: initialViewMode, isPopup: false };
  }
  const q = new URLSearchParams(window.location.search);
  const v = String(q.get('view') || initialViewMode || 'A').toUpperCase();
  const validView = ['A', 'B', 'C'].includes(v) ? v : 'A';
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

export default function GabrielProfitAgiWorkbench({
  userId = '',
  userName = '',
  embedded = false,
  initialViewMode = 'A',
  showGuide = true,
}) {
  const [orderYear, setOrderYear] = useState('2026');
  const [orderWeek, setOrderWeek] = useState('46-01');
  const [country, setCountry] = useState('ALL');
  const [viewMode, setViewMode] = useState(['A', 'B', 'C'].includes(initialViewMode) ? initialViewMode : 'A');
  const [isPopup, setIsPopup] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [simParams, setSimParams] = useState(() => ({ ...DEFAULT_SIM_PARAMS }));
  const [selectedSkuId, setSelectedSkuId] = useState('');

  const [recentWeeks, setRecentWeeks] = useState([]);
  const [apiData, setApiData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchStatusNote, setFetchStatusNote] = useState('');

  const [copyNotice, setCopyNotice] = useState('');
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
    () => runGabrielAgiAudit({ orderYear, orderWeek, country, simParams, apiData }),
    [orderYear, orderWeek, country, simParams, apiData],
  );

  const selectedSku = useMemo(() => {
    if (!audit.skus.length) return null;
    return audit.skus.find((s) => s.id === selectedSkuId) || audit.skus[0];
  }, [audit.skus, selectedSkuId]);

  const briefingText = useMemo(() => buildGabrielExecutiveBriefing(audit), [audit]);

  // Menu back button contextual reset
  const isDirtyState = useMemo(() => {
    const def = DEFAULT_SIM_PARAMS;
    const simChanged = Object.keys(def).some((k) => simParams[k] !== def[k]);
    return simChanged || viewMode !== initialViewMode || Boolean(selectedSkuId) || country !== 'ALL';
  }, [simParams, viewMode, initialViewMode, selectedSkuId, country]);

  useEffect(() => {
    const onBack = (event) => {
      if (!isDirtyState) return;
      event.preventDefault();
      setSimParams({ ...DEFAULT_SIM_PARAMS });
      setViewMode(['A', 'B', 'C'].includes(initialViewMode) ? initialViewMode : 'A');
      setSelectedSkuId('');
      setCountry('ALL');
      setCopyNotice('');
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
    const nextMode = GABRIEL_VIEW_MODES[nextIdx]?.id;
    if (nextMode) setViewMode(nextMode);
    buttons[nextIdx]?.focus();
  };

  const copyBriefing = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(briefingText);
      } else {
        throw new Error('Clipboard unavailable');
      }
      setCopyNotice('사장님 보고용 원가·이익 브리핑을 클립보드에 복사했습니다. (자동 발송 없음)');
    } catch {
      try {
        briefingRef.current?.focus();
        briefingRef.current?.select();
        const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
        setCopyNotice(
          ok
            ? '사장님 보고용 원가·이익 브리핑을 복사했습니다. (자동 발송 없음)'
            : '자동 복사가 차단되었습니다. 아래 브리핑 상자에서 Ctrl+C로 복사하세요.',
        );
      } catch {
        setCopyNotice('아래 브리핑 상자에서 Ctrl+C로 복사해 주세요.');
      }
    }
  };

  const maxLeverGain = Math.max(1, ...audit.levers.map((l) => l.profitGainKRW));
  const pipelineHref = withPopup(`/import/pipeline?year=${encodeURIComponent(orderYear)}&week=${encodeURIComponent(orderWeek)}${country !== 'ALL' ? `&country=${encodeURIComponent(country)}` : ''}`, isPopup);
  const quickAbsorbHref = withPopup('/shipment/quick-absorb', isPopup);
  const manualsHref = withPopup('/work/manuals', isPopup);

  return (
    <div
      className={`${styles.root} ${embedded ? styles.embedded : ''}`}
      data-view={viewMode}
      data-testid="gabriel-profit-agi-workbench"
    >
      {/* 1. 상단 헤더 & 1px 헤어라인 KPI 스트립 */}
      <header className={styles.topbar}>
        <div className={styles.topMain}>
          <div className={styles.titleBlock}>
            <div className={styles.eyebrow} data-desktop-chrome>
              GABRIEL IMPORT COST &amp; PROFIT AGI · COUNTERFACTUAL WORKBENCH
            </div>
            <div className={styles.titleRow}>
              {embedded ? (
                <h2>가브리엘 수입·원가·이익 최적화 AGI 워크벤치</h2>
              ) : (
                <h1 data-desktop-chrome>가브리엘 수입·원가·이익 최적화 AGI 워크벤치</h1>
              )}
            </div>
            <p className={styles.subtitle}>
              AWB 중량 계단·박스 채움률·농장 교차 소싱·마진 침식 방어·미회수 크레딧 노트를 실시간 반사실 시뮬레이션해 회사 이익 개선 레버를 산출합니다.
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

        <div className={styles.kpiStrip} aria-label="가브리엘 이익 최적화 핵심 지표">
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>차수 이익 개선액</span>
            <b className={`${styles.kpiValue} ${styles.isOk}`} data-testid="gabriel-kpi-profit">
              {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)}
            </b>
            <span className={styles.kpiSub}>
              무대응 {fmtKRW(audit.summary.unhedgedProfitKRW)}원 → 개선 {fmtKRW(audit.summary.simulatedProfitKRW)}원
            </span>
          </div>
          <div className={styles.kpiCell}>
            <span className={styles.kpiLabel}>연간 환산 이익 개선 (52주)</span>
            <b className={`${styles.kpiValue} ${styles.isOk}`} data-testid="gabriel-kpi-annual">
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
          <WorkflowGuide workflowId="gabriel-import-profit-agi" initialRole="수입부" />
        </div>
      )}

      {/* 2. 차수·국가 필터 바 & 시안 A·B·C 전환 탭 */}
      <section className={styles.controlStrip} aria-label="차수·국가 선택 및 시안 전환">
        <div className={styles.scopeRow}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="gabriel-year">연도 (OrderYear)</label>
            <div className={styles.stepper}>
              <button type="button" aria-label="이전 연도" onClick={() => moveYear(-1)}>‹</button>
              <input
                id="gabriel-year"
                aria-label="연도 (OrderYear)"
                maxLength={4}
                value={orderYear}
                onChange={(e) => setOrderYear(e.target.value)}
              />
              <button type="button" aria-label="다음 연도" onClick={() => moveYear(1)}>›</button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="gabriel-week">세부차수 (OrderWeek)</label>
            <div className={styles.stepper}>
              <button type="button" aria-label="이전 세부차수" onClick={() => moveWeek('prev')}>‹</button>
              <input
                id="gabriel-week"
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
              <label className={styles.fieldLabel} htmlFor="gabriel-recent-week">최근 입고 차수</label>
              <select
                id="gabriel-recent-week"
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
              data-testid="gabriel-copy-briefing"
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
          <div className={styles.noticeBanner} role="status" data-testid="gabriel-copy-notice">
            {copyNotice}
          </div>
        )}

        <div className={styles.viewTabs} role="tablist" aria-label="시안 A B C 시뮬레이션 뷰 전환" onKeyDown={onTabKeyDown}>
          {GABRIEL_VIEW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              id={`gabriel-view-tab-${m.id}`}
              aria-selected={viewMode === m.id}
              aria-controls="gabriel-view-stage"
              data-testid={`gabriel-view-${m.id}`}
              className={styles.viewTab}
              onClick={() => setViewMode(m.id)}
            >
              <span>{m.code}</span>
              <span>{m.shortLabel}</span>
            </button>
          ))}
          <span className={styles.viewDesc}>
            {GABRIEL_VIEW_MODES.find((m) => m.id === viewMode)?.description}
          </span>
        </div>
      </section>

      {/* 3. 반사실(Counterfactual) 이익 시뮬레이터 컨트롤 */}
      <section className={styles.simPanel} aria-label="반사실 이익 시뮬레이터 제어">
        <div className={styles.simHead}>
          <h2>반사실(Counterfactual) 이익 시뮬레이션 컨트롤</h2>
          <div className={styles.presetRow}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                data-testid={`gabriel-preset-${p.id}`}
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
              <label htmlFor="sim-rebalance">농장 리밸런싱 비율</label>
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
            <span className={styles.sliderSub}>고원가 농장 → 우위 농장 교차 배분 (0~50%)</span>
          </div>

          <div className={styles.sliderItem}>
            <div className={styles.sliderLabelRow}>
              <label htmlFor="sim-box-fill">박스 채움·혼적 개선</label>
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
              <label htmlFor="sim-margin-defense">권장 판가 방어 반영</label>
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
              <label htmlFor="sim-target-margin">목표 총이익률 기준선</label>
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
        </div>

        <div className={styles.creditToggleRow}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              data-testid="toggle-credit-recovery"
              checked={simParams.creditRecoveryEnabled}
              onChange={(e) => updateParam('creditRecoveryEnabled', e.target.checked)}
            />
            <span>
              미회수 해외 농장 Credit Note(구상 차감) 회수 반영 ({audit.claims.length}건 · ${audit.summary.potentialCreditUSD} · ₩{fmtKRW(audit.summary.potentialCreditKRW)})
            </span>
          </label>
          <span className={styles.panelHint}>
            선택 시뮬레이션 변동분은 전산 원장을 바꾸지 않으며 화면에서 즉시 재계산됩니다.
          </span>
        </div>
      </section>

      {/* 4. 시안 A · B · C 메인 스테이지 */}
      <div id="gabriel-view-stage" role="tabpanel" aria-labelledby={`gabriel-view-tab-${viewMode}`}>
        {viewMode === 'A' && (
          <div className={styles.split}>
            {/* 좌측: 5대 레버 분해 + 품목 원가 원장 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
              <section className={styles.panel} aria-label="5대 이익 레버 분해 프로파일">
                <div className={styles.panelHead}>
                  <h3>뷰 A · 5대 이익 레버 분해 (차수 개선 합계 {fmtSignedKRW(audit.summary.totalPotentialProfitKRW)})</h3>
                  <span className={styles.panelHint}>L1~L5 각 레버별 실측·기준 기여액</span>
                </div>
                <div className={styles.leverList}>
                  {audit.levers.map((lv) => {
                    const widthPct = lv.profitGainKRW > 0
                      ? Math.max(4, Math.round((lv.profitGainKRW / maxLeverGain) * 100))
                      : 0;
                    return (
                      <div key={lv.id} className={styles.leverRow}>
                        <span className={styles.leverCode}>{lv.code}</span>
                        <div>
                          <div className={styles.leverTitle}>{lv.title}</div>
                          <div className={styles.leverDriver}>{lv.driverText}</div>
                        </div>
                        <div className={styles.barTrack} aria-hidden="true">
                          <span className={styles.barFill} style={{ width: `${widthPct}%` }} />
                        </div>
                        <div className={styles.leverGain}>{fmtSignedKRW(lv.profitGainKRW)}</div>
                        <Link href={withPopup(lv.href, isPopup)} className={styles.linkBtn}>
                          {lv.actionLabel}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={styles.panel} aria-label="품목별 실질 도착원가 및 마진 방어 원장">
                <div className={styles.panelHead}>
                  <h3>품목별 실질 도착원가(True Landed Cost) 고밀도 원장 ({audit.skus.length}건)</h3>
                  <span className={styles.panelHint}>행을 누르면 오른쪽 상세 분해와 연동됩니다</span>
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
                            onClick={() => setSelectedSkuId(sku.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedSkuId(sku.id);
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

                  <text x="74" y="54" fill="var(--agi-ok)" fontSize="11.5" fontWeight="700">핵심 수익 유지·물량 확대</text>
                  <text x="638" y="54" textAnchor="end" fill="var(--agi-err)" fontSize="11.5" fontWeight="700">즉시 단가·원가 방어 (우선)</text>
                  <text x="74" y="358" fill="var(--agi-muted)" fontSize="11.5" fontWeight="700">안정 관찰</text>
                  <text x="638" y="358" textAnchor="end" fill="var(--agi-warn)" fontSize="11.5" fontWeight="700">AWB 혼적·농장 리밸런싱</text>

                  <text x="64" y="388" textAnchor="middle" fill="var(--agi-muted)" fontSize="10.5">0</text>
                  <text x="356" y="388" textAnchor="middle" fill="var(--agi-muted)" fontSize="10.5">50</text>
                  <text x="648" y="388" textAnchor="middle" fill="var(--agi-muted)" fontSize="10.5">100</text>
                  <text x="356" y="410" textAnchor="middle" fill="var(--agi-ink)" fontSize="12" fontWeight="700">
                    원가 상승·마진 침식 리스크 (0~100)
                  </text>

                  <text x="54" y="370" textAnchor="end" fill="var(--agi-muted)" fontSize="10.5">0</text>
                  <text x="54" y="206" textAnchor="end" fill="var(--agi-muted)" fontSize="10.5">50</text>
                  <text x="54" y="42" textAnchor="end" fill="var(--agi-muted)" fontSize="10.5">100</text>
                  <text x="20" y="202" textAnchor="middle" transform="rotate(-90 20 202)" fill="var(--agi-ink)" fontSize="12" fontWeight="700">
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
                        onClick={() => setSelectedSkuId(sku.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedSkuId(sku.id);
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
                          dy="3.5"
                          fontSize="10"
                          fontWeight="700"
                          fill={active ? '#ffffff' : 'var(--agi-ink)'}
                          style={{ fontVariantNumeric: 'tabular-nums' }}
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
                      onClick={() => setSelectedSkuId(sku.id)}
                    >
                      <span>#{sku.no}</span>
                      <span>{sku.prodName}</span>
                      <span>{sku.simPostMarginPct}%</span>
                    </button>
                  );
                })}
              </div>
            </section>

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
                      <span>가브리엘 시뮬 원가</span>
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
          </div>
        )}

        {viewMode === 'C' && (
          <div className={styles.carbonGrid} data-testid="gabriel-carbon-console">
            {/* C-1: 환율 스트레스 래더 */}
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

            {/* C-2: AWB 중량 브레이크포인트 게이지 */}
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

            {/* C-3: 미회수 해외 농장 Credit Note 원장 */}
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

            {/* C-4: 가브리엘 고효율 수입 루틴 & 리드타임 단축 점수 */}
            <section className={styles.panel} aria-label="가브리엘 고효율 수입 루틴 진단">
              <div className={styles.panelHead}>
                <h3>가브리엘 고효율 수입 루틴 (수입 속도 지수 {audit.summary.velocityScore}/100)</h3>
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
        )}
      </div>
    </div>
  );
}
