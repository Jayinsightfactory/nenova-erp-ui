import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../styles/PackingEvidenceReview.module.css';
import { isValidNormalizedBBox, loadPdfPreview } from '../../lib/importPackingPdfPreview.js';

const FIELDS = ['gw', 'cw', 'freight'];
const FIELD_LABELS = { gw: '총중량 (GW)', cw: '운임 적용 중량 (CW)', freight: '운송·부대비' };
const FIELD_TEST_IDS = { gw: 'field-gw', cw: 'field-cw', freight: 'field-freight' };
const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const rowIdentity = row => String(row?.invoiceIndex ?? '');
const stringValue = value => value === null || value === undefined ? '' : String(value);

function makeDraft(row) {
  return {
    invoiceIndex: row?.invoiceIndex,
    values: Object.fromEntries(FIELDS.map(field => [field, stringValue(row?.values?.[field])])),
    reason: stringValue(row?.reason),
    confirmed: row?.confirmed === true,
  };
}

function makeBaseline(row) {
  return {
    invoiceIndex: row?.invoiceIndex,
    values: Object.fromEntries(FIELDS.map(field => [field, stringValue(row?.original?.[field])])),
  };
}

function comparableValue(value) {
  const text = stringValue(value).trim();
  if (!text) return '';
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(text)) return `invalid:${text}`;
  return String(Number(text.replaceAll(',', '')));
}

function fieldChanged(draft, baseline, field) {
  return comparableValue(draft?.values?.[field]) !== comparableValue(baseline?.values?.[field]);
}

function validateDrafts(drafts, baselines) {
  const errors = {};
  for (const draft of drafts) {
    const key = rowIdentity(draft);
    const rowErrors = {};
    for (const field of FIELDS) {
      const value = stringValue(draft.values?.[field]).trim();
      const validShape = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(value);
      const number = validShape ? Number(value.replaceAll(',', '')) : NaN;
      if (value && (!validShape || !Number.isFinite(number) || Math.abs(number) > 1e12)) {
        rowErrors[field] = `${field === 'freight' ? '비용' : '중량'} 숫자 형식을 확인하세요.`;
      } else if (field !== 'freight' && value && number < 0) {
        rowErrors[field] = '중량은 0 이상이어야 합니다.';
      }
    }
    if (FIELDS.some(field => fieldChanged(draft, baselines.get(key), field)) && !draft.reason.trim()) {
      rowErrors.reason = '인식값을 변경한 사유를 입력하세요.';
    }
    if (!draft.confirmed) rowErrors.confirmed = '이 인보이스의 값을 검토했다는 확인이 필요합니다.';
    if (Object.keys(rowErrors).length) errors[key] = rowErrors;
  }
  return errors;
}

function fieldStatus(row, field) {
  const evidence = row?.evidence?.[field];
  const page = Number(evidence?.page);
  const hasPage = Number.isInteger(page) && page > 0;
  if (hasPage && typeof evidence?.quote === 'string' && evidence.quote.trim()) return '근거 확인 가능';
  if (hasPage && isValidNormalizedBBox(evidence?.bbox)) return 'AI 추정 영역';
  if (!stringValue(row?.values?.[field]).trim()) return '미인식 · 직접 입력';
  return '수동 확인 · 위치 확인 필요';
}

function originalText(row, field) {
  const original = row?.original?.[field];
  if (original === null || original === undefined || original === '') return '원본 인식값 없음';
  const printedUnit = stringValue(row?.evidence?.[field]?.unit).trim();
  const unit = printedUnit || (field === 'freight' ? stringValue(row?.currency).trim() : 'kg');
  return `원본 ${original}${unit ? ` ${unit}` : ''}`;
}

export default function PackingEvidenceReview({
  rows,
  onConfirm,
  onClose,
  pdfBase64,
  fileName,
  open = true,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const baselinesRef = useRef(new Map(safeRows.map(row => [rowIdentity(row), makeBaseline(row)])));
  const [drafts, setDrafts] = useState(() => safeRows.map(makeDraft));
  const [selectedKey, setSelectedKey] = useState(() => rowIdentity(safeRows[0]));
  const [activeField, setActiveField] = useState(() => safeRows.length ? { key: rowIdentity(safeRows[0]), field: 'gw' } : null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState({ loading: false, error: '' });
  const [renderError, setRenderError] = useState('');
  const [highlight, setHighlight] = useState({ source: 'none', bbox: null, label: '위치 확인 필요' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [pending, setPending] = useState(false);
  const dialogRef = useRef(null);
  const firstControlRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const identities = new Set(safeRows.map(rowIdentity));
    for (const row of safeRows) {
      const key = rowIdentity(row);
      if (!baselinesRef.current.has(key)) baselinesRef.current.set(key, makeBaseline(row));
    }
    setDrafts(previous => safeRows.map(row => previous.find(draft => rowIdentity(draft) === rowIdentity(row)) || makeDraft(row)));
    setSelectedKey(previous => identities.has(previous) ? previous : rowIdentity(safeRows[0]));
  }, [rows]);

  useEffect(() => {
    let stale = false;
    let loadedPreview = null;
    setPreview(null);
    setHighlight({ source: 'none', bbox: null, label: '위치 확인 필요' });
    setRenderError('');
    if (!pdfBase64) {
      setPreviewState({ loading: false, error: '' });
      return undefined;
    }
    setPreviewState({ loading: true, error: '' });
    loadPdfPreview(pdfBase64).then(result => {
      loadedPreview = result;
      if (stale) return result.destroy();
      setPreview(result);
      const firstEvidencePage = Number(safeRows[0]?.evidence?.gw?.page);
      setPageNumber(Number.isInteger(firstEvidencePage) && firstEvidencePage >= 1 && firstEvidencePage <= result.numPages
        ? firstEvidencePage : 1);
      setPreviewState({ loading: false, error: '' });
      return undefined;
    }).catch(error => {
      if (!stale) setPreviewState({ loading: false, error: error?.message || 'PDF 미리보기를 열지 못했습니다.' });
    });
    return () => {
      stale = true;
      loadedPreview?.destroy();
    };
  }, [pdfBase64]);

  useEffect(() => {
    if (!open || !preview || !canvasRef.current) return undefined;
    let stale = false;
    setRenderError('');
    preview.renderPage(pageNumber, canvasRef.current, zoom).then(result => {
      if (!stale && !result?.cancelled) setRenderError('');
    }).catch(error => {
      if (!stale) setRenderError(error?.message || 'PDF 페이지를 표시하지 못했습니다.');
    });
    return () => { stale = true; };
  }, [open, preview, pageNumber, zoom]);

  const rowMap = useMemo(() => new Map(safeRows.map(row => [rowIdentity(row), row])), [rows]);
  const draftMap = useMemo(() => new Map(drafts.map(draft => [rowIdentity(draft), draft])), [drafts]);
  const selectedRow = rowMap.get(selectedKey) || safeRows[0] || null;
  const selectedDraft = draftMap.get(selectedKey) || drafts[0] || null;
  const activeEvidence = activeField ? rowMap.get(activeField.key)?.evidence?.[activeField.field] : null;

  useEffect(() => {
    if (!open || !preview) return undefined;
    let stale = false;
    setHighlight({ source: 'none', bbox: null, label: '근거 위치 확인 중' });
    preview.locateEvidence(pageNumber, activeEvidence).then(result => {
      if (!stale) setHighlight(result);
    }).catch(() => {
      if (!stale) setHighlight({ source: 'none', bbox: null, label: '위치 확인 필요' });
    });
    return () => { stale = true; };
  }, [open, preview, pageNumber, activeEvidence]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = globalThis.setTimeout(() => firstControlRef.current?.focus(), 0);
    return () => {
      globalThis.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!pending) closeReview();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = [...dialogRef.current.querySelectorAll(focusableSelector)]
        .filter(control => control.getAttribute('aria-hidden') !== 'true' && control.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, pending]);

  const closeReview = () => {
    if (pending) return;
    onClose?.();
  };

  const selectEvidence = (key, field) => {
    const row = rowMap.get(key);
    setActiveField({ key, field });
    const evidencePage = Number(row?.evidence?.[field]?.page);
    if (preview && Number.isInteger(evidencePage) && evidencePage >= 1 && evidencePage <= preview.numPages) {
      setPageNumber(evidencePage);
    }
  };

  const updateValue = (key, field, value) => {
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key
      ? { ...draft, values: { ...draft.values, [field]: value }, confirmed: false }
      : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], [field]: '', confirmed: '' } }));
    setSubmitError('');
  };

  const updateReason = (key, reason) => {
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? { ...draft, reason } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], reason: '' } }));
    setSubmitError('');
  };

  const updateConfirmed = (key, confirmed) => {
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? { ...draft, confirmed } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], confirmed: '' } }));
    setSubmitError('');
  };

  const confirmDrafts = async () => {
    const nextErrors = validateDrafts(drafts, baselinesRef.current);
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length) {
      const firstKey = drafts.find(draft => nextErrors[rowIdentity(draft)])?.invoiceIndex;
      if (firstKey !== undefined) setSelectedKey(String(firstKey));
      return;
    }
    const submission = safeRows.map(row => {
      const draft = draftMap.get(rowIdentity(row)) || makeDraft(row);
      return { ...row, values: { ...draft.values }, reason: draft.reason, confirmed: draft.confirmed };
    });
    setPending(true);
    try {
      await onConfirm?.(submission);
    } catch (error) {
      setSubmitError(error?.message || '확인값을 적용하지 못했습니다. 입력값을 다시 확인하세요.');
    } finally {
      setPending(false);
    }
  };

  if (!open) return null;
  const currentErrors = errors[selectedKey] || {};

  return (
    <div className={styles.backdrop} data-testid="evidence-review">
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="패킹 중량 및 운송비 근거 확인">
        <header className={styles.header}>
          <div>
            <h2>중량·운송비 근거 확인</h2>
            <p>{fileName || '업로드 문서'} · 인보이스 {safeRows.length}건</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={closeReview} disabled={pending} aria-label="근거 확인 닫기">닫기</button>
        </header>

        <div className={styles.workspace}>
          <section className={styles.previewPanel} aria-label="로컬 PDF 원본">
            <div className={styles.previewToolbar}>
              <strong>원본 PDF</strong>
              <div className={styles.pageControls}>
                <button type="button" onClick={() => setPageNumber(value => Math.max(1, value - 1))} disabled={!preview || pageNumber <= 1} aria-label="이전 PDF 페이지">이전</button>
                <label>페이지
                  <input
                    type="number"
                    min="1"
                    max={preview?.numPages || 1}
                    value={pageNumber}
                    onChange={event => {
                      const value = Number(event.target.value);
                      if (Number.isInteger(value) && preview && value >= 1 && value <= preview.numPages) setPageNumber(value);
                    }}
                    aria-label="PDF 페이지 번호"
                  />
                  <span>/ {preview?.numPages || '—'}</span>
                </label>
                <button type="button" onClick={() => setPageNumber(value => Math.min(preview?.numPages || value, value + 1))} disabled={!preview || pageNumber >= preview.numPages} aria-label="다음 PDF 페이지">다음</button>
              </div>
              <div className={styles.zoomControls}>
                <button type="button" onClick={() => setZoom(value => Math.max(0.75, Number((value - 0.25).toFixed(2))))} disabled={zoom <= 0.75} aria-label="PDF 축소">−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom(value => Math.min(2, Number((value + 0.25).toFixed(2))))} disabled={zoom >= 2} aria-label="PDF 확대">+</button>
              </div>
            </div>

            <div className={styles.previewStatus} role="status" aria-live="polite">
              {previewState.loading && '로컬 PDF를 여는 중…'}
              {previewState.error && previewState.error}
              {!pdfBase64 && 'PDF 원본이 없어 문서 위치를 표시할 수 없습니다. Excel 원본은 별도로 확인하세요.'}
              {pdfBase64 && preview && !previewState.loading && !previewState.error && `${highlight.label} · ${pageNumber}페이지`}
            </div>
            <div className={styles.canvasScroller} data-testid="pdf-preview" tabIndex="0" aria-label={`PDF ${pageNumber}페이지 미리보기`}>
              {pdfBase64 && <div className={styles.canvasStage}>
                <canvas ref={canvasRef} />
                {highlight.bbox && <span
                  className={`${styles.highlight} ${highlight.source === 'bbox' ? styles.estimatedHighlight : ''}`}
                  style={{ left: `${highlight.bbox[0] * 100}%`, top: `${highlight.bbox[1] * 100}%`, width: `${highlight.bbox[2] * 100}%`, height: `${highlight.bbox[3] * 100}%` }}
                  aria-hidden="true"
                />}
              </div>}
            </div>
            {renderError && <p className={styles.error} role="alert">{renderError}</p>}
          </section>

          <section className={styles.formPanel} aria-label="인식값 검토">
            {safeRows.length ? <>
              <label className={styles.invoicePicker}>검토할 인보이스
                <select ref={firstControlRef} value={selectedKey} onChange={event => {
                  setSelectedKey(event.target.value);
                  selectEvidence(event.target.value, 'gw');
                }}>
                  {safeRows.map((row, index) => <option key={rowIdentity(row)} value={rowIdentity(row)}>{row.label || `인보이스 ${index + 1}`}</option>)}
                </select>
              </label>

              <div className={styles.invoiceHeading}>
                <div>
                  <h3>{selectedRow?.label || '인보이스'}</h3>
                  <p>{selectedRow?.currency ? `통화 ${selectedRow.currency}` : '통화 미확인'}</p>
                </div>
                <span className={selectedDraft?.confirmed ? styles.reviewed : styles.needsReview}>{selectedDraft?.confirmed ? '검토 확인됨' : '검토 필요'}</span>
              </div>

              {selectedRow?.explanation && <p className={styles.explanation}>{selectedRow.explanation}</p>}

              <div className={styles.fields}>
                {FIELDS.map(field => {
                  const evidence = selectedRow?.evidence?.[field];
                  const label = field === 'freight' ? (selectedRow?.freightLabel || FIELD_LABELS.freight) : FIELD_LABELS[field];
                  return <div className={styles.fieldCard} key={field}>
                    <div className={styles.fieldHeading}>
                      <strong>{label}{field !== 'freight' ? ' · kg' : ''}</strong>
                      <span>{fieldStatus(selectedRow, field)}</span>
                    </div>
                    <label>
                      <span className={styles.srOnly}>{label}{field !== 'freight' ? ' kg' : ''}</span>
                      <div className={styles.inputRow}>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={selectedDraft?.values?.[field] ?? ''}
                          onFocus={() => selectEvidence(selectedKey, field)}
                          onClick={() => selectEvidence(selectedKey, field)}
                          onChange={event => updateValue(selectedKey, field, event.target.value)}
                          aria-invalid={Boolean(currentErrors[field])}
                          data-testid={FIELD_TEST_IDS[field]}
                        />
                        <span>{field === 'freight' ? (selectedRow?.currency || '통화 미확인') : 'kg'}</span>
                      </div>
                    </label>
                    <p className={styles.original}>{originalText(selectedRow, field)}</p>
                    {evidence?.quote && <q className={styles.quote}>{evidence.quote}</q>}
                    {currentErrors[field] && <p className={styles.error} role="alert">{currentErrors[field]}</p>}
                  </div>;
                })}
              </div>

              <label className={styles.reasonLabel}>수정 사유
                <input
                  type="text"
                  value={selectedDraft?.reason || ''}
                  onChange={event => updateReason(selectedKey, event.target.value)}
                  placeholder="인식값을 바꾼 경우 이유를 입력하세요"
                  aria-invalid={Boolean(currentErrors.reason)}
                />
              </label>
              {currentErrors.reason && <p className={styles.error} role="alert">{currentErrors.reason}</p>}

              <label className={styles.confirmLabel}>
                <input
                  type="checkbox"
                  checked={selectedDraft?.confirmed === true}
                  onChange={event => updateConfirmed(selectedKey, event.target.checked)}
                  data-testid="evidence-confirm"
                />
                <span>이 인보이스의 원본 근거와 입력값을 직접 검토했습니다.</span>
              </label>
              {currentErrors.confirmed && <p className={styles.error} role="alert">{currentErrors.confirmed}</p>}
            </> : <p className={styles.empty}>검토할 인보이스가 없습니다.</p>}
          </section>
        </div>

        <footer className={styles.footer}>
          <p>이 확인은 결과 파일을 다시 만드는 단계이며 ERP DB에 저장하지 않습니다.</p>
          <div>
            <button type="button" onClick={closeReview} disabled={pending}>취소</button>
            <button type="button" className={styles.applyButton} onClick={confirmDrafts} disabled={pending || !safeRows.length}>
              {pending ? '적용 중…' : '확인값 적용 · 결과 재생성'}
            </button>
          </div>
          {submitError && <p className={styles.submitError} role="alert">{submitError}</p>}
        </footer>
      </section>
    </div>
  );
}

export { makeDraft, validateDrafts };
