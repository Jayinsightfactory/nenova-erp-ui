import dynamic from 'next/dynamic';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkflowGuide from '../WorkflowGuide';
import { createImportTeamStorage } from '../../lib/importTeamClient';
import { getCurrentWeek, stepWeek } from '../../lib/useWeekInput';
import { MENU_BACK_REQUEST_EVENT } from '../../lib/menuNavigationHistory';
import {
  PIPELINE_COUNTRIES,
  PIPELINE_STEPS,
  buildKakaoSummaryText,
  buildPipelineDeepLinks,
  countryLabel,
  formatShortDriveCycle,
  normalizeCountryCode,
  normalizePipelineScope,
  parsePipelineQuery,
  pipelineQueryString,
  summarizePipelineSteps,
  weekDateWindow,
} from '../../lib/importOneStopPipeline';
import styles from '../../styles/ImportOneStopPipeline.module.css';

const toolLoading = () => <p className={styles.mutedText} role="status">도구를 불러오는 중입니다…</p>;
const PackingListTool = dynamic(() => import('./PackingListTool'), { ssr: false, loading: toolLoading });
const InvoiceReceiptWorkbench = dynamic(() => import('./InvoiceReceiptWorkbench'), { ssr: false, loading: toolLoading });
const NativeReceiptCost = dynamic(() => import('./NativeReceiptCost'), { ssr: false, loading: toolLoading });
const SharedAwbCostReview = dynamic(() => import('./SharedAwbCostReview'), { ssr: false, loading: toolLoading });
const InvoiceArrivalCostPanel = dynamic(() => import('./InvoiceArrivalCostPanel'), { ssr: false, loading: toolLoading });

const EMPTY_RECEIPT_SOURCE = Object.freeze({
  excels: Object.freeze([]),
  invoices: Object.freeze([]),
  country: '',
  file: null,
  products: Object.freeze([]),
  reviewConfirmed: false,
  truncated: false,
});

const STATUS_BADGES = Object.freeze({
  complete: { label: '완료', className: styles.statusComplete },
  in_progress: { label: '진행 중', className: styles.statusProgress },
  pending: { label: '대기', className: styles.statusPending },
  error: { label: '조회 확인', className: styles.statusError },
});

function formatNum(value, digits = 0) {
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

async function fetchJsonSafe(url, signal) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    const err = new Error(data?.error || `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return data || {};
}

export default function ImportOneStopPipeline({ userId = '', userName = '' }) {
  const [orderYear, setOrderYear] = useState('');
  const [orderWeek, setOrderWeek] = useState('');
  const [country, setCountry] = useState('ALL');
  const [activeStep, setActiveStep] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  const [recentWeeks, setRecentWeeks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [storageError, setStorageError] = useState('');

  const [stateData, setStateData] = useState({
    drafts: [],
    warehouses: [],
    board: null,
    invoiceCosts: [],
    arrivalCosts: [],
    uploadHistory: [],
    driveFiles: [],
    errors: {},
    lastLoadedAt: '',
  });
  const [moyiStatus, setMoyiStatus] = useState({ checked: false, connected: false, message: '' });

  const [receiptSource, setReceiptSource] = useState(EMPTY_RECEIPT_SOURCE);
  const [receiptMatchState, setReceiptMatchState] = useState(null);
  const receiptSourceRef = useRef(receiptSource);

  const [selectedWarehouseKey, setSelectedWarehouseKey] = useState(null);
  const [showSharedAwb, setShowSharedAwb] = useState(false);

  const [customNote, setCustomNote] = useState('');
  const [includeItems, setIncludeItems] = useState(true);
  const [copiedAt, setCopiedAt] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const summaryTextareaRef = useRef(null);
  const stepPanelRef = useRef(null);
  const fetchGenRef = useRef(0);
  const activeControllerRef = useRef(null);

  const storage = useMemo(() => createImportTeamStorage(setStorageError), []);

  useEffect(() => {
    const [defaultYear, defaultWeek, defaultSeq] = getCurrentWeek().split('-');
    const parsed = parsePipelineQuery(window.location.search, {
      orderYear: defaultYear,
      orderWeek: `${defaultWeek}-${defaultSeq}`,
    });
    setOrderYear(parsed.orderYear);
    setOrderWeek(parsed.orderWeek);
    setCountry(parsed.country);
    setActiveStep(parsed.step);
    setHydrated(true);

    const controller = new AbortController();
    fetchJsonSafe('/api/incoming/insight?view=weeks', controller.signal)
      .then((json) => {
        if (!controller.signal.aborted && Array.isArray(json.weeks)) {
          setRecentWeeks(json.weeks.slice(0, 8));
        }
      })
      .catch(() => {});

    fetch('/api/moyi/drive-admin', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (res.status === 403) {
          setMoyiStatus({ checked: true, connected: false, message: 'MOYI Drive 관리는 관리자 계정 전용입니다. 일반 공유는 업무 드라이브를 이용하세요.' });
          return;
        }
        if (res.ok && body?.connected) {
          const count = Array.isArray(body.files) ? body.files.length : 0;
          setMoyiStatus({ checked: true, connected: true, message: `연결됨 (${body.company?.name || '회사 Drive'} · ${count}개 파일)` });
        } else {
          setMoyiStatus({ checked: true, connected: false, message: body?.connectionReason || 'MOYI Drive 연결 상태를 확인하세요.' });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMoyiStatus({ checked: true, connected: false, message: 'MOYI Drive 상태 확인 생략' });
        }
      });

    return () => controller.abort();
  }, []);

  const scope = useMemo(
    () => normalizePipelineScope({ orderYear, orderWeek, country, step: activeStep }),
    [orderYear, orderWeek, country, activeStep],
  );

  useEffect(() => {
    if (!hydrated || !scope.valid) return;
    const isPopup = new URLSearchParams(window.location.search).get('popup') === '1';
    const qs = pipelineQueryString(scope, { popup: isPopup });
    const nextUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (nextUrl !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [hydrated, scope]);

  useEffect(() => {
    const onMenuBack = (event) => {
      if (activeStep !== 1) {
        event.preventDefault();
        setActiveStep(1);
      }
    };
    window.addEventListener(MENU_BACK_REQUEST_EVENT, onMenuBack);
    return () => window.removeEventListener(MENU_BACK_REQUEST_EVENT, onMenuBack);
  }, [activeStep]);

  const loadPipelineStatus = useCallback(async () => {
    if (!hydrated || !scope.valid) return;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const generation = ++fetchGenRef.current;

    setLoading(true);
    const { orderYear: yr, orderWeek: wk, country: cCode } = scope;
    const shortCycle = formatShortDriveCycle(wk);
    const invoiceCostQs = new URLSearchParams({ orderYear: yr, orderWeek: wk, limit: '20' });
    if (cCode !== 'ALL') invoiceCostQs.set('country', cCode);

    const driveSearchUrl = shortCycle
      ? `/api/work/drive?search=${encodeURIComponent(shortCycle)}&criteria=${encodeURIComponent(JSON.stringify({ scope: 'all', limit: 200 }))}`
      : '/api/work/drive?format=table-v1&preview=1';

    const requests = [
      ['drafts', fetchJsonSafe(`/api/import/receipts/drafts?orderYear=${encodeURIComponent(yr)}&orderWeek=${encodeURIComponent(wk)}`, controller.signal)],
      ['warehouses', fetchJsonSafe(`/api/import/receipts/warehouse-list?orderYear=${encodeURIComponent(yr)}&orderWeek=${encodeURIComponent(wk)}`, controller.signal)],
      ['board', fetchJsonSafe(`/api/incoming/insight?view=board&year=${encodeURIComponent(yr)}&week=${encodeURIComponent(wk)}`, controller.signal)],
      ['invoiceCosts', fetchJsonSafe(`/api/arrival-cost/invoice-costs?${invoiceCostQs}`, controller.signal)],
      ['arrivalCosts', fetchJsonSafe(`/api/arrival-cost?orderYear=${encodeURIComponent(yr)}&orderWeek=${encodeURIComponent(wk)}&allVarieties=1&page=1&pageSize=200`, controller.signal)],
      ['uploadHistory', fetchJsonSafe('/api/import/tools/upload-history', controller.signal)],
      ['drive', fetchJsonSafe(driveSearchUrl, controller.signal)],
    ];

    const settled = await Promise.allSettled(requests.map(([, p]) => p));
    if (controller.signal.aborted || fetchGenRef.current !== generation) return;

    const results = {};
    const errors = {};
    requests.forEach(([key], idx) => {
      const outcome = settled[idx];
      if (outcome.status === 'fulfilled') {
        results[key] = outcome.value;
      } else {
        errors[key] = outcome.reason?.message || '조회 실패';
      }
    });

    setStateData((prev) => ({
      drafts: results.drafts ? (results.drafts.documents || []) : (errors.drafts ? [] : prev.drafts),
      warehouses: results.warehouses ? (results.warehouses.rows || []) : (errors.warehouses ? [] : prev.warehouses),
      board: results.board || (errors.board ? null : prev.board),
      invoiceCosts: results.invoiceCosts ? (results.invoiceCosts.rows || []) : (errors.invoiceCosts ? [] : prev.invoiceCosts),
      arrivalCosts: results.arrivalCosts ? (results.arrivalCosts.rows || []) : (errors.arrivalCosts ? [] : prev.arrivalCosts),
      uploadHistory: results.uploadHistory ? (results.uploadHistory.rows || []) : (errors.uploadHistory ? [] : prev.uploadHistory),
      driveFiles: results.drive ? (results.drive.files || []) : (errors.drive ? [] : prev.driveFiles),
      errors,
      lastLoadedAt: new Date().toISOString(),
    }));
    setLoading(false);
  }, [hydrated, scope]);

  useEffect(() => {
    if (!hydrated || !scope.valid) return;
    const timer = setTimeout(() => { void loadPipelineStatus(); }, 120);
    return () => {
      clearTimeout(timer);
      activeControllerRef.current?.abort();
    };
  }, [hydrated, scope.valid, scope.orderYear, scope.orderWeek, scope.country, refreshTick, loadPipelineStatus]);

  const changeReceiptSource = useCallback((next) => {
    const prevFile = receiptSourceRef.current?.file;
    receiptSourceRef.current = next;
    setReceiptSource(next);
    setReceiptMatchState(null);
    const nextCode = normalizeCountryCode(next?.country);
    if (nextCode !== 'ALL' && (next?.file !== prevFile || country === 'ALL')) {
      setCountry(nextCode);
    }
  }, [country]);

  const changeReceiptMatchState = useCallback((snapshot) => {
    const current = receiptSourceRef.current;
    if (
      snapshot?.file === current.file
      && snapshot?.excels === current.excels
      && snapshot?.invoices === current.invoices
      && snapshot?.country === current.country
      && current.file
    ) {
      setReceiptMatchState(snapshot);
    }
  }, []);

  const goToStep = useCallback((nextStep) => {
    const clamped = Math.max(1, Math.min(4, Number(nextStep) || 1));
    setActiveStep(clamped);
    requestAnimationFrame(() => {
      stepPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const moveYear = (delta) => {
    const num = Number(orderYear);
    if (!Number.isFinite(num)) return;
    const next = Math.max(2020, Math.min(2099, num + delta));
    setOrderYear(String(next));
    setSelectedWarehouseKey(null);
  };

  const moveWeek = (direction) => {
    const baseYear = scope.yearValid ? scope.orderYear : String(new Date().getFullYear());
    const baseWeek = scope.weekValid ? scope.orderWeek : '01-01';
    const nextCombined = stepWeek(`${baseYear}-${baseWeek}`, direction);
    const parts = nextCombined.split('-');
    if (parts.length === 3) {
      setOrderYear(parts[0]);
      setOrderWeek(`${parts[1]}-${parts[2]}`);
      setSelectedWarehouseKey(null);
    }
  };

  const summary = useMemo(() => summarizePipelineSteps({
    scope,
    drafts: stateData.drafts,
    warehouses: stateData.warehouses,
    board: stateData.board,
    invoiceCosts: stateData.invoiceCosts,
    arrivalCosts: stateData.arrivalCosts,
    uploadHistory: stateData.uploadHistory,
    driveFiles: stateData.driveFiles,
    activePackingSource: receiptSource,
    copiedAt,
    errors: stateData.errors,
  }), [scope, stateData, receiptSource, copiedAt]);

  const kakaoSummaryText = useMemo(() => buildKakaoSummaryText({
    scope,
    summary,
    drafts: stateData.drafts,
    warehouses: stateData.warehouses,
    invoiceCosts: stateData.invoiceCosts,
    arrivalCosts: stateData.arrivalCosts,
    driveFiles: stateData.driveFiles,
    includeItems,
    customNote,
  }), [scope, summary, stateData, includeItems, customNote]);

  const deepLinks = useMemo(() => buildPipelineDeepLinks(scope), [scope]);
  const dateInfo = useMemo(() => weekDateWindow(scope.orderYear, scope.orderWeek), [scope.orderYear, scope.orderWeek]);

  async function copySummary() {
    const text = kakaoSummaryText;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      const nowIso = new Date().toISOString();
      setCopiedAt(nowIso);
      setCopyNotice('요약문을 클립보드에 복사했습니다. (자동 발송 없음 — 카톡방에 붙여넣으세요)');
    } catch (_) {
      try {
        summaryTextareaRef.current?.focus();
        summaryTextareaRef.current?.select();
        const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
        if (ok) {
          setCopiedAt(new Date().toISOString());
          setCopyNotice('요약문을 복사했습니다. (자동 발송 없음)');
          return;
        }
      } catch (_) {}
      setCopyNotice('자동 복사가 차단되었습니다. 아래 요약문 상자에서 Ctrl+C로 복사해 주세요.');
    }
  }

  function downloadSummaryTxt() {
    const blob = new Blob([`\uFEFF${kakaoSummaryText}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `수입요약_${scope.orderYear}_${scope.orderWeek}_${scope.country}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onStepperKeyDown(event) {
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
    buttons[nextIdx]?.focus();
  }

  const errorEntries = Object.entries(stateData.errors || {}).filter(([, msg]) => Boolean(msg));
  const step1Info = summary.steps[0];
  const step2Info = summary.steps[1];
  const step3Info = summary.steps[2];
  const step4Info = summary.steps[3];

  const driveFilesShown = scope.country === 'ALL'
    ? summary.driveSummary.cycleFiles
    : [...summary.driveSummary.countryFiles, ...summary.driveSummary.cycleFiles.filter((f) => !summary.driveSummary.countryFiles.includes(f))];

  return (
    <main className={styles.page} data-testid="import-onestop-pipeline">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow} data-desktop-chrome>수입 업무 · 원스톱 워크벤치</span>
          <h1 data-desktop-chrome>수입 원스톱 파이프라인</h1>
          <p className={styles.subtitle}>
            인보이스 확인 → 입고관리 반영 → 도착원가 생성 → 카톡 요약복사 · 드라이브 공유를 연도·차수·국가 컨텍스트 그대로 이어서 처리합니다.
          </p>
        </div>
        <div className={styles.headerBadges}>
          <span className={styles.contextBadge}>
            {scope.orderYear || '----'}년 {scope.orderWeek || '--'}차 · {countryLabel(scope.country)}
          </span>
          {userName && <span className={styles.contextBadge}>담당 {userName}</span>}
          <span className={styles.safeBadge}>원장 보호 · 수동 승인/복사 전용</span>
        </div>
      </header>

      <div className={styles.guideWrap}>
        <WorkflowGuide workflowId="import-onestop-pipeline" initialRole="수입부" />
      </div>

      <section className={styles.contextBar} aria-label="공통 차수 및 국가 선택">
        <div className={styles.contextRow}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="pipeline-order-year">연도 (OrderYear)</label>
            <div className={styles.stepperInput}>
              <button type="button" aria-label="이전 연도" onClick={() => moveYear(-1)} disabled={!scope.yearValid || Number(orderYear) <= 2020}>‹</button>
              <input
                id="pipeline-order-year"
                aria-label="연도 (OrderYear)"
                inputMode="numeric"
                maxLength={4}
                value={orderYear}
                onChange={(e) => { setOrderYear(e.target.value); setSelectedWarehouseKey(null); }}
              />
              <button type="button" aria-label="다음 연도" onClick={() => moveYear(1)} disabled={!scope.yearValid || Number(orderYear) >= 2099}>›</button>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="pipeline-order-week">세부차수 (OrderWeek)</label>
            <div className={styles.stepperInput}>
              <button type="button" aria-label="이전 세부차수" onClick={() => moveWeek('prev')}>‹</button>
              <input
                id="pipeline-order-week"
                aria-label="세부차수 (OrderWeek)"
                maxLength={5}
                placeholder="46-01"
                value={orderWeek}
                onChange={(e) => { setOrderWeek(e.target.value); setSelectedWarehouseKey(null); }}
                onBlur={() => {
                  const normalized = normalizePipelineScope({ orderYear, orderWeek, country, step: activeStep });
                  if (normalized.weekValid && normalized.orderWeek !== orderWeek) setOrderWeek(normalized.orderWeek);
                }}
              />
              <button type="button" aria-label="다음 세부차수" onClick={() => moveWeek('next')}>›</button>
            </div>
          </div>

          {dateInfo.label && (
            <div className={styles.dateRangeTag} title="수요일 시작~화요일 종료 기준">
              차수 기간 {dateInfo.label}
            </div>
          )}

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel} id="pipeline-country-label">국가 필터 (Country)</span>
            <div className={styles.countryPills} role="group" aria-labelledby="pipeline-country-label">
              {PIPELINE_COUNTRIES.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  aria-pressed={scope.country === c.code}
                  className={`${styles.countryPill} ${scope.country === c.code ? styles.countryPillActive : ''}`}
                  onClick={() => setCountry(c.code)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.contextActions}>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={loading || !scope.valid}
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              {loading ? '상태 조회 중…' : '전체 상태 새로고침'}
            </button>
          </div>
        </div>

        {recentWeeks.length > 0 && (
          <div className={styles.recentWeeksRow} aria-label="최근 입고 차수 바로 선택">
            <span className={styles.recentWeeksLabel}>최근 입고 차수:</span>
            {recentWeeks.map((item) => {
              const y = String(item.year);
              const w = String(item.week);
              const selected = scope.orderYear === y && scope.orderWeek === w;
              return (
                <button
                  key={`${y}-${w}`}
                  type="button"
                  className={`${styles.weekChip} ${selected ? styles.weekChipActive : ''}`}
                  onClick={() => { setOrderYear(y); setOrderWeek(w); setSelectedWarehouseKey(null); }}
                >
                  {y} {w} ({item.n}건)
                </button>
              );
            })}
          </div>
        )}
      </section>

      {!scope.valid && hydrated && (
        <div className={styles.alertError} role="alert">
          연도(4자리, 예: 2026)와 세부차수(예: 46-01)를 올바르게 입력하면 4단계 파이프라인 상태를 조회합니다.
        </div>
      )}
      {storageError && (
        <div className={styles.alertError} role="alert">
          팀 공동 매칭 자료 오류: {storageError}
        </div>
      )}
      {errorEntries.length > 0 && (
        <div className={styles.alertInfo} role="status">
          일부 조회 항목은 응답을 확인하지 못했습니다 ({errorEntries.map(([k, m]) => `${k}: ${m}`).join(' · ')}). 확인된 단계는 그대로 표시되며, 다시 조회할 수 있습니다.
        </div>
      )}

      <section className={styles.progressSection} aria-label="4단계 진행률 스테퍼">
        <div className={styles.progressHeader}>
          <span className={styles.progressTitle}>
            원스톱 진행률 · {summary.completedCount} / {summary.totalSteps}단계 완료 ({summary.progressPercent}%)
          </span>
          <div className={styles.progressMeta}>
            <div className={styles.progressBarTrack} role="progressbar" aria-valuenow={summary.progressPercent} aria-valuemin={0} aria-valuemax={100} aria-label="파이프라인 완료율">
              <div className={styles.progressBarFill} style={{ width: `${summary.progressPercent}%` }} />
            </div>
            {stateData.lastLoadedAt && <span>조회 {formatDateTime(stateData.lastLoadedAt)}</span>}
          </div>
        </div>

        <div className={styles.stepperGrid} role="tablist" aria-label="수입 원스톱 4단계" onKeyDown={onStepperKeyDown}>
          {PIPELINE_STEPS.map((stepDef, index) => {
            const stepSummary = summary.steps[index];
            const badge = STATUS_BADGES[stepSummary.status] || STATUS_BADGES.pending;
            const isSelected = activeStep === stepDef.id;
            return (
              <button
                key={stepDef.id}
                type="button"
                role="tab"
                id={`pipeline-tab-${stepDef.id}`}
                aria-selected={isSelected}
                aria-controls={`pipeline-panel-${stepDef.id}`}
                className={`${styles.stepCard} ${isSelected ? styles.stepCardActive : ''}`}
                onClick={() => goToStep(stepDef.id)}
              >
                <div className={styles.stepCardTop}>
                  <span className={styles.stepNumber}>{stepDef.id}</span>
                  <span className={`${styles.statusPill} ${badge.className}`}>{badge.label}</span>
                </div>
                <strong className={styles.stepTitle}>{stepDef.shortTitle}</strong>
                <span className={styles.stepSummary}>{stepSummary.summaryText}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div ref={stepPanelRef}>
        {/* STEP 1: 인보이스·패킹 확인 */}
        <section
          id="pipeline-panel-1"
          role="tabpanel"
          aria-labelledby="pipeline-tab-1"
          hidden={activeStep !== 1}
          className={styles.panelCard}
        >
          <header className={styles.panelHeader}>
            <div>
              <h2>1. 인보이스·패킹 확인 ({scope.orderYear} · {scope.orderWeek} · {countryLabel(scope.country)})</h2>
              <p>인보이스 PDF/Excel 업로드·품목 매칭 후 바로 2단계 입고 검수로 전달됩니다. 저장된 초안 문서도 이어서 열 수 있습니다.</p>
            </div>
            <div className={styles.panelActions}>
              <a className={styles.secondaryBtn} href={deepLinks.importHub}>수입부 통합 ↗</a>
              <a className={styles.secondaryBtn} href={deepLinks.importTools}>기존 업무도구 ↗</a>
              <button type="button" className={styles.primaryBtn} onClick={() => goToStep(2)}>2단계 입고 검수로 이동 →</button>
            </div>
          </header>

          <div className={styles.summaryGrid}>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>저장 인보이스 초안 ({scope.orderYear} {scope.orderWeek})</div>
              <div className={styles.kpiValue}>{step1Info.metrics.draftTotal}건</div>
              <div className={styles.kpiSub}>입고확정 {step1Info.metrics.draftCommittedCount}건 · 검토대기 {step1Info.metrics.draftPendingCount}건</div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>공동 패킹 업로드 이력 ({countryLabel(scope.country)})</div>
              <div className={styles.kpiValue}>{step1Info.metrics.uploadHistoryCount}건</div>
              <div className={styles.kpiSub}>팀 공용 업로드 보관 기록 기준</div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>현재 화면 준비 인보이스</div>
              <div className={styles.kpiValue}>{receiptSource.file ? receiptSource.file.name : '미선택'}</div>
              <div className={styles.kpiSub}>{receiptSource.excels.length ? `변환 ${receiptSource.excels.length}건 준비됨 · 2단계 즉시 전달 가능` : '아래에서 인보이스를 올리거나 복원하세요'}</div>
            </div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>해당 차수 저장 인보이스 문서 ({stateData.drafts.length}건)</span>
              <button type="button" className={styles.secondaryBtn} onClick={() => goToStep(2)}>2단계에서 문서 선택·검수</button>
            </div>
            {stateData.drafts.length === 0 ? (
              <p className={styles.mutedText}>아직 {scope.orderYear}년 {scope.orderWeek}차에 저장된 웹 인보이스 문서가 없습니다. 아래에서 PDF/Excel을 올려 준비하거나 2단계에서 기존 입고를 조회하세요.</p>
            ) : (
              <div className={styles.listGrid}>
                {stateData.drafts.slice(0, 12).map((doc) => (
                  <div key={doc.documentId} className={styles.listItemCard}>
                    <strong>{doc.invoiceNo || doc.originalFileName || '송장번호 미기재'}</strong>
                    <span className={styles.listItemMeta}>
                      입고 {doc.receiptStatus || 'DRAFT'} · 원가 {doc.costStatus || 'PENDING'} · {doc.lineCount ?? 0}행 · rev {doc.revision}
                    </span>
                    <span className={styles.listItemMeta}>수정 {formatDateTime(doc.updatedAt)} ({doc.updatedBy || '—'})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>인보이스 변환 · 품목 매칭 작업대</span>
            </div>
            <PackingListTool
              key={`packing-${userId}`}
              userId={userId}
              storage={storage}
              onReceiptSourceChange={changeReceiptSource}
              receiptMatchState={receiptMatchState}
              onContinue={() => goToStep(2)}
            />
          </div>
        </section>

        {/* STEP 2: 입고관리 업로드·검수 */}
        <section
          id="pipeline-panel-2"
          role="tabpanel"
          aria-labelledby="pipeline-tab-2"
          hidden={activeStep !== 2}
          className={styles.panelCard}
        >
          <header className={styles.panelHeader}>
            <div>
              <h2>2. 입고관리 업로드·검수 ({scope.orderYear} · {scope.orderWeek} · {countryLabel(scope.country)})</h2>
              <p>발주·입고·분배 대조를 확인하고, 준비된 인보이스를 검수·입고 등록한 뒤 3단계 도착원가로 이어갑니다.</p>
            </div>
            <div className={styles.panelActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => goToStep(1)}>← 1단계 인보이스</button>
              <a className={styles.secondaryBtn} href={deepLinks.incoming}>입고관리 전체 ↗</a>
              <a className={styles.secondaryBtn} href={deepLinks.importToolsIncoming}>입고 정정·승인 ↗</a>
              <a className={styles.secondaryBtn} href={deepLinks.warehouse}>발주관리 ↗</a>
              <button type="button" className={styles.primaryBtn} onClick={() => goToStep(3)}>3단계 도착원가로 이동 →</button>
            </div>
          </header>

          <div className={styles.summaryGrid}>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>전산 입고 마스터 ({scope.orderYear} {scope.orderWeek})</div>
              <div className={styles.kpiValue}>{step2Info.metrics.warehouseCount}건</div>
              <div className={styles.kpiSub}>WarehouseMaster 활성 입고 기준</div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>발주 → 입고 → 분배 ({countryLabel(scope.country)})</div>
              <div className={styles.kpiValue}>
                {formatNum(step2Info.metrics.orderedQty)} → {formatNum(step2Info.metrics.receivedQty)} → {formatNum(step2Info.metrics.shippedQty)}
              </div>
              <div className={styles.kpiSub}>입고율 {step2Info.metrics.fillRate == null ? '—' : `${step2Info.metrics.fillRate}%`}</div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>미입고 / 부족 / 초과 / 미발주</div>
              <div className={styles.kpiValue}>
                {step2Info.metrics.missingItems} / {step2Info.metrics.shortItems} / {step2Info.metrics.overItems} / {step2Info.metrics.unorderedItems}
              </div>
              <div className={styles.kpiSub}>품목 단위 대사 기준</div>
            </div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>전산 입고 목록 ({stateData.warehouses.length}건)</span>
              <span className={styles.mutedText}>입고 건을 누르면 3단계에서 바로 도착원가를 계산합니다.</span>
            </div>
            {stateData.warehouses.length === 0 ? (
              <p className={styles.mutedText}>{scope.orderYear}년 {scope.orderWeek}차 전산 입고가 아직 없습니다. 아래 작업대에서 초안을 검수·등록하세요.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>입고번호</th>
                      <th>농장</th>
                      <th>송장번호</th>
                      <th>입고일</th>
                      <th className={styles.num}>GW (kg)</th>
                      <th className={styles.num}>CW (kg)</th>
                      <th>다음 작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stateData.warehouses.slice(0, 30).map((row) => (
                      <tr key={row.WarehouseKey}>
                        <td className={styles.num}>#{row.WarehouseKey}</td>
                        <td>{row.FarmName || '—'}</td>
                        <td>{row.InvoiceNo || '—'}</td>
                        <td>{row.InputDate || '—'}</td>
                        <td className={styles.num}>{formatNum(row.GrossWeight, 2)}</td>
                        <td className={styles.num}>{formatNum(row.ChargeableWeight, 2)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.secondaryBtn}
                            onClick={() => { setSelectedWarehouseKey(row.WarehouseKey); goToStep(3); }}
                          >
                            3단계 원가 계산 →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>인보이스 입고 검수 · 등록 작업대</span>
            </div>
            <InvoiceReceiptWorkbench
              key={`receipt-${userId}`}
              userId={userId}
              {...receiptSource}
              initialOrderYear={scope.orderYear}
              initialOrderWeek={scope.orderWeek}
              onMatchStateChange={changeReceiptMatchState}
              workspaceMode="receipt"
              onWorkspaceModeChange={(mode, nextScope) => {
                if (mode === 'cost') {
                  if (nextScope?.warehouseKey) setSelectedWarehouseKey(nextScope.warehouseKey);
                  setRefreshTick((t) => t + 1);
                  goToStep(3);
                }
              }}
            />
          </div>
        </section>

        {/* STEP 3: 도착원가 산출·확정 */}
        <section
          id="pipeline-panel-3"
          role="tabpanel"
          aria-labelledby="pipeline-tab-3"
          hidden={activeStep !== 3}
          className={styles.panelCard}
        >
          <header className={styles.panelHeader}>
            <div>
              <h2>3. 도착원가 산출·확정 ({scope.orderYear} · {scope.orderWeek} · {countryLabel(scope.country)})</h2>
              <p>입고자료 기반 도착원가 계산, 승인 원가 엑셀 다운로드 및 차수별 도착원가 반영 현황을 확인합니다.</p>
            </div>
            <div className={styles.panelActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => goToStep(2)}>← 2단계 입고 검수</button>
              <a className={styles.secondaryBtn} href={deepLinks.arrivalCost}>도착원가 전체 ↗</a>
              <button type="button" className={styles.primaryBtn} onClick={() => goToStep(4)}>4단계 카톡 복사 · 공유로 이동 →</button>
            </div>
          </header>

          <div className={styles.summaryGrid}>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>인보이스 승인 실제 원가</div>
              <div className={styles.kpiValue}>{step3Info.metrics.approvedInvoiceCostCount}건</div>
              <div className={styles.kpiSub}>
                합계 {formatNum(step3Info.metrics.totalApprovedCostKRW)}원
                {step3Info.metrics.staleInvoiceCostCount > 0 ? ` · 재승인 필요 ${step3Info.metrics.staleInvoiceCostCount}건` : ''}
              </div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>차수 도착원가 반영 행 ({countryLabel(scope.country)})</div>
              <div className={styles.kpiValue}>{step3Info.metrics.arrivalUploadedCount}행</div>
              <div className={styles.kpiSub}>매칭완료 {step3Info.metrics.arrivalMatchedCount} · 미매칭 {step3Info.metrics.arrivalUnmatchedCount}</div>
            </div>
            <div className={styles.kpiBox}>
              <div className={styles.kpiLabel}>원가 미업로드 입고 품목</div>
              <div className={styles.kpiValue}>{step3Info.metrics.arrivalMissingCount}품목</div>
              <div className={styles.kpiSub}>기존 입고 대비 원가 누락 확인용</div>
            </div>
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>입고자료로 도착원가 바로 계산 (원장 변경 없음)</span>
              {(scope.country === 'CO' || scope.country === 'ALL') && (
                <button type="button" className={styles.secondaryBtn} onClick={() => setShowSharedAwb((v) => !v)}>
                  {showSharedAwb ? '콜롬비아 전체 농장 계산 닫기' : '콜롬비아 전체 농장 한 번에 계산'}
                </button>
              )}
            </div>
            {showSharedAwb && <SharedAwbCostReview native={{ orderYear: scope.orderYear, orderWeek: scope.orderWeek }} />}
            {selectedWarehouseKey ? (
              <NativeReceiptCost
                key={`${scope.orderYear}-${scope.orderWeek}-${selectedWarehouseKey}`}
                orderYear={scope.orderYear}
                orderWeek={scope.orderWeek}
                warehouseKey={selectedWarehouseKey}
                onClose={() => setSelectedWarehouseKey(null)}
              />
            ) : stateData.warehouses.length === 0 ? (
              <p className={styles.mutedText}>계산할 전산 입고 내역이 없습니다.</p>
            ) : (
              <div className={styles.listGrid}>
                {stateData.warehouses.slice(0, 12).map((row) => (
                  <div key={row.WarehouseKey} className={styles.listItemCard}>
                    <strong>{row.FarmName || '농장 미기재'} · {row.InvoiceNo || '송장번호 미기재'}</strong>
                    <span className={styles.listItemMeta}>
                      입고 #{row.WarehouseKey} · {row.InputDate || '—'} · GW {formatNum(row.GrossWeight, 2)} / CW {formatNum(row.ChargeableWeight, 2)} kg
                    </span>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={() => setSelectedWarehouseKey(row.WarehouseKey)}
                    >
                      도착원가 계산 · 엑셀 다운로드
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.subSection}>
            <InvoiceArrivalCostPanel
              orderYear={scope.orderYear}
              orderWeek={scope.orderWeek}
              country={scope.country === 'ALL' ? '' : scope.country}
            />
          </div>

          <div className={styles.subSection}>
            <div className={styles.subSectionTitle}>
              <span>차수 도착원가 품목 현황 ({summary.scopedArrivalRows.length}행)</span>
              <a className={styles.secondaryBtn} href={deepLinks.arrivalCost}>도착원가 화면에서 수정 ↗</a>
            </div>
            {summary.scopedArrivalRows.length === 0 ? (
              <p className={styles.mutedText}>선택 조건({scope.orderYear} {scope.orderWeek} · {countryLabel(scope.country)})의 도착원가 행이 없습니다.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>국가</th>
                      <th>품목</th>
                      <th>농장</th>
                      <th>단위</th>
                      <th className={styles.num}>수량</th>
                      <th className={styles.num}>도착원가(원)</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.scopedArrivalRows.slice(0, 30).map((row, idx) => {
                      const cost = row.selectedArrivalCostKRW ?? row.sourceArrivalCostKRW;
                      return (
                        <tr key={row.arrivalLineKey ?? idx}>
                          <td>{row.countryName || row.dbCountryName || '—'}</td>
                          <td className={styles.itemNameCell} title={row.displayName || row.prodName || row.productNameRaw}>
                            {row.displayName || row.prodName || row.productNameRaw || '—'}
                          </td>
                          <td>{row.farmName || row.autoFarmName || row.farmNameRaw || '—'}</td>
                          <td>{row.unit || '—'}</td>
                          <td className={styles.num}>{formatNum(row.quantity, 2)}</td>
                          <td className={styles.num}>{row.uploadStatus === 'COST_NOT_UPLOADED' ? '미업로드' : formatNum(cost)}</td>
                          <td>{row.uploadStatus === 'COST_NOT_UPLOADED' ? '원가 미업로드' : row.matchStatus === 'MATCHED' ? '매칭완료' : '확인필요'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* STEP 4: 카톡 요약복사 & 드라이브 업로드 */}
        <section
          id="pipeline-panel-4"
          role="tabpanel"
          aria-labelledby="pipeline-tab-4"
          hidden={activeStep !== 4}
          className={styles.panelCard}
        >
          <header className={styles.panelHeader}>
            <div>
              <h2>4. 카톡 요약복사 &amp; 드라이브 업로드 ({scope.orderYear} · {scope.orderWeek} · {countryLabel(scope.country)})</h2>
              <p>도착원가·입고 결과를 정형화된 카톡 보고 양식으로 복사(자동 발송 없음)하고 업무 드라이브·MOYI Drive로 이어집니다.</p>
            </div>
            <div className={styles.panelActions}>
              <button type="button" className={styles.secondaryBtn} onClick={() => goToStep(3)}>← 3단계 도착원가</button>
              <button type="button" className={styles.secondaryBtn} disabled={loading} onClick={() => setRefreshTick((t) => t + 1)}>
                {loading ? '최신화 중…' : '요약 데이터 최신화'}
              </button>
            </div>
          </header>

          <div className={styles.shareGrid}>
            <section className={styles.shareCard} aria-label="카톡 보고 요약문 생성 및 복사">
              <h3>카톡 공유용 수입 요약문</h3>
              <div className={styles.alertInfo} role="note">
                자동 발송 금지 안전선 준수 — <strong>[요약문 복사]</strong>로 복사한 뒤 담당자가 직접 카카오톡에 붙여넣어 전송하세요.
              </div>
              <div className={styles.shareControls}>
                <input
                  type="text"
                  aria-label="특이사항 메모"
                  placeholder="특이사항 입력 (예: 콜롬비아 수국 2박스 지연 입고)"
                  value={customNote}
                  onChange={(e) => setCustomNote(e.target.value)}
                />
                <label>
                  <input type="checkbox" checked={includeItems} onChange={(e) => setIncludeItems(e.target.checked)} />
                  {' '}주요 품목 원가 포함
                </label>
              </div>
              <textarea
                ref={summaryTextareaRef}
                readOnly
                className={styles.summaryTextarea}
                aria-label="카톡 공유용 수입 요약문"
                value={kakaoSummaryText}
              />
              <div className={styles.shareControls}>
                <button type="button" className={styles.primaryBtn} data-testid="pipeline-copy-summary" onClick={copySummary}>
                  요약문 복사
                </button>
                <button type="button" className={styles.secondaryBtn} onClick={downloadSummaryTxt}>
                  요약문 .txt 다운로드
                </button>
                {copiedAt && <span className={`${styles.statusPill} ${styles.statusComplete}`}>복사됨 ({formatDateTime(copiedAt)})</span>}
              </div>
              {copyNotice && <p className={styles.alertInfo} role="status">{copyNotice}</p>}
            </section>

            <section className={styles.shareCard} aria-label="업무 드라이브 및 MOYI Drive 연결">
              <h3>업무 드라이브 · MOYI Drive 연결</h3>
              <p className={styles.mutedText}>
                {scope.orderYear}년 {scope.orderWeek}차 업무 드라이브 파일 {step4Info.metrics.driveTotalCount}건
                {scope.country !== 'ALL' ? ` (${countryLabel(scope.country)} 관련 ${step4Info.metrics.driveCountryCount}건)` : ''}
                {' · '}입고 {step4Info.metrics.driveReceiptStageCount} · 원가·운임 {step4Info.metrics.driveCostStageCount}
              </p>
              <div className={styles.driveLinksRow}>
                <a className={styles.primaryBtn} href={deepLinks.workDrive}>업무 드라이브 열기 ↗</a>
                <a className={styles.secondaryBtn} href={deepLinks.moyiDrive}>MOYI Drive 관리 열기 ↗</a>
              </div>
              {moyiStatus.checked && (
                <p className={styles.mutedText} role="status">
                  MOYI Drive 상태: {moyiStatus.message}
                </p>
              )}
              {driveFilesShown.length === 0 ? (
                <p className={styles.mutedText}>
                  {scope.orderWeek}차로 분류된 업무 드라이브 파일이 아직 없습니다. 데스크톱 자동 업로드 또는 웹 원가/인보이스 업로드를 실행하면 자동 반영됩니다.
                </p>
              ) : (
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>파일명</th>
                        <th>단계</th>
                        <th>올린 사람</th>
                        <th>시각</th>
                        <th>내려받기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {driveFilesShown.slice(0, 25).map((file) => (
                        <tr key={file.id}>
                          <td className={styles.itemNameCell} title={file.filename}>{file.filename}</td>
                          <td>{file.stage || '미분류'}</td>
                          <td>{file.uploaderName || '—'}</td>
                          <td>{formatDateTime(file.uploadedAt)}</td>
                          <td>
                            {file.canDownload ? (
                              <a className={styles.secondaryBtn} href={`/api/work/drive?download=${encodeURIComponent(file.id)}`}>받기</a>
                            ) : (
                              <span className={styles.mutedText}>권한제한</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
