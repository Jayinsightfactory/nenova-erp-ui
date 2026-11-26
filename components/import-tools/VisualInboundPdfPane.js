// 왼쪽 원본 PDF/AWB 뷰어: 쪽 자동 이동 · 원문 위치 강조 상자 · 항목 확대 · 100/145/190% · 원본 새 창.
// PDF는 브라우저 안에서만 읽는다(업로드·외부 요청 없음). 기존 loadPdfPreview 자산을 그대로 쓴다.
import { useEffect, useRef, useState, useCallback } from 'react';
import { loadPdfPreview } from '../../lib/importPackingPdfPreview.js';
import styles from '../../styles/VisualInboundVerifyWorkbench.module.css';

const ZOOMS = [[1, '100%'], [1.45, '145%'], [1.9, '190%']];

function base64ToBlobUrl(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export default function VisualInboundPdfPane({ docs, tab, onTabChange, target, tone = 'checking', highlightRef, paneRef, onLayout }) {
  const previews = useRef(new Map());
  const canvasRef = useRef(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [focusMode, setFocusMode] = useState(true);
  const [located, setLocated] = useState(null);
  const [status, setStatus] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [baseWidth, setBaseWidth] = useState(612);
  const [paneWidth, setPaneWidth] = useState(720);
  const doc = docs?.[tab] || null;

  const previewFor = useCallback(kind => {
    const source = docs?.[kind];
    if (!source?.base64) return null;
    const cached = previews.current.get(kind);
    if (cached && cached.base64 === source.base64) return cached.promise;
    if (cached) cached.promise.then(p => p.destroy()).catch(() => {});
    const promise = loadPdfPreview(source.base64);
    promise.catch(() => {});
    previews.current.set(kind, { base64: source.base64, promise });
    return promise;
  }, [docs]);

  useEffect(() => () => {
    for (const { promise } of previews.current.values()) promise.then(p => p.destroy()).catch(() => {});
    previews.current.clear();
  }, []);

  useEffect(() => {
    const el = paneRef?.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => setPaneWidth(Math.max(320, Math.floor(entries[0].contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, [paneRef]);

  // 우측 항목 포커스 → 해당 서류 탭·쪽으로 이동하고 원문 위치를 찾는다.
  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    const kind = target.doc === 'awb' && docs?.awb ? 'awb' : 'invoice';
    if (kind !== tab) onTabChange?.(kind);
    const promise = previewFor(kind);
    if (!promise) return undefined;
    setStatus('원문 위치 찾는 중…');
    (async () => {
      try {
        const preview = await promise;
        const request = { page: target.page, invoiceNo: target.invoiceNo, supplier: target.supplier, quotes: target.quotes, bbox: target.bbox };
        let result = target.page ? await preview.resolveTarget(request) : null;
        if (!result?.bbox) result = await preview.resolveTarget({ ...request, page: null });
        if (!alive) return;
        setLocated({ kind, page: result.page, bbox: result.bbox, label: result.bbox ? `${target.label} · ${result.label}` : `${target.label} · 원문 위치 직접 확인` });
        setPage(result.page);
        setStatus(result.bbox ? '' : `${result.page}쪽에서 ${target.label} 위치를 자동으로 찾지 못했습니다. 화면에서 직접 확인하세요.`);
      } catch (error) {
        if (alive) setStatus(error?.message || 'PDF 원문 위치를 찾지 못했습니다.');
      }
    })();
    return () => { alive = false; };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitScale = Math.max(0.5, (paneWidth - 32) / Math.max(200, baseWidth));
  // 좁은 단일 항목(송장번호·AWB·중량·총액)은 1.75배 확대 포커싱, 표 전체 행 강조는 가로가 잘리지 않게 폭 맞춤
  const isWideBand = Boolean(located?.bbox && located.bbox[2] > 0.65);
  const focusBoost = focusMode && located?.bbox && located.kind === tab ? (isWideBand ? Math.max(zoom, 1.0) : Math.max(zoom, 1.75)) : zoom;
  const effectiveScale = Math.min(4, Math.max(0.25, fitScale * focusBoost));

  useEffect(() => {
    let alive = true;
    const promise = previewFor(tab);
    if (!promise || !canvasRef.current) return undefined;
    (async () => {
      try {
        const preview = await promise;
        if (!alive) return;
        setNumPages(preview.numPages);
        const safePage = Math.min(Math.max(1, page), preview.numPages);
        const result = await preview.renderPage(safePage, canvasRef.current, Math.round(effectiveScale * 100) / 100);
        if (!alive || result?.cancelled) return;
        setSize({ width: result.width, height: result.height });
        const natural = result.width / result.scale;
        if (Math.abs(natural - baseWidth) > 1) setBaseWidth(natural);
        onLayout?.();
      } catch (error) {
        if (alive) setStatus(error?.message || 'PDF를 표시하지 못했습니다.');
      }
    })();
    return () => { alive = false; };
  }, [tab, page, effectiveScale, previewFor]); // eslint-disable-line react-hooks/exhaustive-deps

  // 확대 모드: 강조 상자를 화면 가운데로 가져온다.
  useEffect(() => {
    const pane = paneRef?.current;
    const box = highlightRef?.current;
    if (!pane || !box || !located?.bbox || located.kind !== tab || located.page !== page || !size.width) return;
    const paneRect = pane.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const smooth = typeof window !== 'undefined' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    pane.scrollTo({
      left: pane.scrollLeft + (boxRect.left + boxRect.width / 2) - (paneRect.left + paneRect.width / 2),
      top: pane.scrollTop + (boxRect.top + boxRect.height / 2) - (paneRect.top + paneRect.height / 2),
      behavior: smooth ? 'smooth' : 'auto',
    });
    const timer = setTimeout(() => onLayout?.(), smooth ? 420 : 0);
    return () => clearTimeout(timer);
  }, [located, size, page, tab, focusMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const openOriginal = () => {
    if (!doc?.base64) return;
    const url = base64ToBlobUrl(doc.base64);
    window.open(`${url}#page=${page}`, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const showBox = located?.bbox && located.kind === tab && located.page === page && size.width > 0;
  const [bx, by, bw, bh] = showBox ? located.bbox : [0, 0, 0, 0];
  const boxStyle = showBox ? { left: bx * size.width, top: by * size.height, width: bw * size.width, height: bh * size.height } : null;
  const labelBelow = showBox && by * size.height < 30;

  return (
    <section className={styles.viewer} aria-label="원본 서류 보기">
      <div className={styles.viewerBar}>
        <div className={styles.docTabs} role="tablist" aria-label="서류 선택">
          <button type="button" role="tab" aria-selected={tab === 'invoice'} className={tab === 'invoice' ? styles.docTabOn : styles.docTab}
            onClick={() => onTabChange?.('invoice')}>인보이스 CI</button>
          <button type="button" role="tab" aria-selected={tab === 'awb'} className={tab === 'awb' ? styles.docTabOn : styles.docTab}
            disabled={!docs?.awb} title={docs?.awb ? docs.awb.name : 'AWB PDF를 함께 넣으면 열립니다'}
            onClick={() => onTabChange?.('awb')}>AWB 운송장</button>
        </div>
        <div className={styles.viewerTools}>
          <button type="button" className={styles.toolButton} aria-label="이전 쪽" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>이전</button>
          <span className={styles.pageLabel} aria-live="polite">{numPages ? `${page} / ${numPages}쪽` : '—'}</span>
          <button type="button" className={styles.toolButton} aria-label="다음 쪽" disabled={!numPages || page >= numPages} onClick={() => setPage(p => Math.min(numPages, p + 1))}>다음</button>
          <span className={styles.toolDivider} aria-hidden="true" />
          <button type="button" className={focusMode ? styles.toolButtonOn : styles.toolButton} aria-pressed={focusMode} onClick={() => setFocusMode(v => !v)}>항목 확대</button>
          {ZOOMS.map(([value, label]) => (
            <button key={label} type="button" className={zoom === value ? styles.toolButtonOn : styles.toolButton} aria-pressed={zoom === value} onClick={() => setZoom(value)}>{label}</button>
          ))}
          <button type="button" className={styles.toolButton} onClick={openOriginal} disabled={!doc}>원본 새 창</button>
        </div>
      </div>
      {status && <p className={styles.viewerStatus} role="status">{status}</p>}
      <div ref={paneRef} className={styles.viewerScroll} tabIndex={0} aria-label={`${tab === 'awb' ? 'AWB 운송장' : '인보이스'} 원본 ${page}쪽`}>
        {doc ? (
          <div className={styles.pageWrap} style={{ width: size.width || undefined, height: size.height || undefined }}>
            <canvas ref={canvasRef} className={styles.pageCanvas} />
            {showBox && (
              <div ref={highlightRef} className={`${styles.highlight} ${styles['tone_' + tone]} ${focusMode ? styles.highlightFocus : ''}`} style={boxStyle} data-testid="evidence-highlight">
                <span className={`${styles.highlightLabel} ${labelBelow ? styles.highlightLabelBelow : ''}`}>{located.label}</span>
              </div>
            )}
          </div>
        ) : <p className={styles.viewerEmpty}>왼쪽에 표시할 PDF가 없습니다.</p>}
      </div>
    </section>
  );
}
