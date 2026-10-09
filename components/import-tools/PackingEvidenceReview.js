import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from '../../styles/PackingEvidenceReview.module.css';
import { isValidNormalizedBBox, loadPdfPreview } from '../../lib/importPackingPdfPreview.js';

const FIELDS = ['gw', 'cw', 'freight'];
const FIELD_LABELS = { gw: '총중량 (GW)', cw: '운임 적용 중량 (CW)', freight: '운송·부대비' };
const FIELD_TEST_IDS = { gw: 'field-gw', cw: 'field-cw', freight: 'field-freight' };
const SOURCE_FIELD_LABELS = { pcs: '박스', total_bunch: '단수', total_stems: '송이 수', steam_box: '박스당 송이', u_price: '단가', t_price: '금액', bunch_st: '단당 송이', stems: '송이 수', price: '단가', raw_qty: '원문 수량', quantity: '수량', qty: '수량', unit_price: '단가', amount: '금액', printed_amount: '인쇄 금액', total: '합계' };
const METADATA_FIELDS = ['date', 'date_kind', 'currency', 'invoice_total'];
const METADATA_LABELS = { date: '인쇄 날짜', date_kind: '날짜 의미', currency: 'ISO 통화', invoice_total: '인쇄 송장 총액' };
const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const rowIdentity = row => String(row?.invoiceIndex ?? '');
const stringValue = value => value === null || value === undefined ? '' : String(value);
const sourceIdentity = (invoiceIndex, row) => `${invoiceIndex}:${row?.lineIndex ?? ''}`;

function collectSourceRows(rows, safeRows) {
  const shared = Array.isArray(rows) ? rows.sourceReview : null;
  if (shared?.required === true && Array.isArray(shared.rows)) {
    return shared.rows.map((row, index) => ({ invoiceIndex: Number.isInteger(row.invoiceIndex) ? row.invoiceIndex : 0,
      sourceReview: shared, row, key: sourceIdentity(Number.isInteger(row.invoiceIndex) ? row.invoiceIndex : 0, { ...row, lineIndex: row.lineIndex ?? index }) }));
  }
  return safeRows.flatMap((invoice, invoiceIndex) => invoice?.sourceReview?.required === true
    && Array.isArray(invoice.sourceReview.rows)
    ? invoice.sourceReview.rows.map((row, index) => ({ invoiceIndex, sourceReview: invoice.sourceReview, row,
      key: sourceIdentity(invoiceIndex, { ...row, lineIndex: row.lineIndex ?? index }) })) : []);
}

function sourceDraftsFrom(entries) {
  return Object.fromEntries(entries.map(({ row, key }) => [key, {
    values: Object.fromEntries(Object.entries(row?.values || {}).map(([field, value]) => [field, stringValue(value)])),
    reason: stringValue(row?.reason),
    confirmed: false,
  }]));
}

function makeDraft(row) {
  return {
    invoiceIndex: row?.invoiceIndex,
    values: Object.fromEntries(FIELDS.map(field => [field, stringValue(row?.values?.[field])])),
    reason: stringValue(row?.reason),
    confirmed: row?.confirmed === true,
    metadata: row?.metadata?.enabled ? {
      values: Object.fromEntries(METADATA_FIELDS.map(field => [field, stringValue(row.metadata.values?.[field])])),
      confirmed: Object.fromEntries(METADATA_FIELDS.map(field => [field, row.metadata.confirmed?.[field] === true])),
      reasons: Object.fromEntries(METADATA_FIELDS.map(field => [field, stringValue(row.metadata.reasons?.[field])])),
    } : null,
  };
}

function makeBaseline(row) {
  return {
    invoiceIndex: row?.invoiceIndex,
    values: Object.fromEntries(FIELDS.map(field => [field, stringValue(row?.original?.[field])])),
    metadata: row?.metadata?.enabled ? {
      values: Object.fromEntries(METADATA_FIELDS.map(field => [field, stringValue(row.metadata.values?.[field])])),
      issueFields: [...(row.metadata.issueFields || [])],
    } : null,
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

function metadataComparable(field, value) {
  const text = stringValue(value).trim();
  if (field === 'currency') return text.toUpperCase();
  if (field === 'date_kind') return text.toLowerCase();
  if (field === 'invoice_total') return comparableValue(text);
  return text;
}

function metadataFieldChanged(draft, baseline, field) {
  return metadataComparable(field, draft?.metadata?.values?.[field])
    !== metadataComparable(field, baseline?.metadata?.values?.[field]);
}

function validateMetadataDraft(draft, baseline, rowErrors) {
  if (!baseline?.metadata) return;
  for (const field of METADATA_FIELDS) {
    const value = stringValue(draft.metadata?.values?.[field]).trim();
    const required = baseline.metadata.issueFields.includes(field) || metadataFieldChanged(draft, baseline, field);
    if (field === 'date' && value) {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (!match || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        rowErrors.metadata_date = '실제로 존재하는 YYYY-MM-DD 전체 날짜를 입력하세요.';
      }
    } else if (field === 'date' && required) rowErrors.metadata_date = '원문에서 연도까지 확인한 전체 날짜를 입력하세요.';
    if (field === 'date_kind' && value && !['invoice', 'arrival', 'shipment'].includes(value.toLowerCase())) {
      rowErrors.metadata_date_kind = '날짜 의미를 인보이스·도착·출고 중에서 선택하세요.';
    } else if (field === 'date_kind' && required && !value) rowErrors.metadata_date_kind = '원문 날짜의 의미를 선택하세요.';
    if (field === 'currency' && value && !/^[A-Za-z]{3}$/.test(value)) rowErrors.metadata_currency = '원문에서 확인한 ISO 4217 3문자 통화를 입력하세요.';
    else if (field === 'currency' && required && !value) rowErrors.metadata_currency = '원문에서 확인한 ISO 4217 통화를 입력하세요.';
    if (field === 'invoice_total' && value) {
      const validAmount = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(value);
      const amount = validAmount ? Number(value.replaceAll(',', '')) : NaN;
      if (!validAmount || !Number.isFinite(amount) || Math.abs(amount) > 1e12) rowErrors.metadata_invoice_total = '송장 총액 숫자 형식 또는 범위를 확인하세요.';
    } else if (field === 'invoice_total' && required) rowErrors.metadata_invoice_total = '원문에 인쇄된 송장 총액을 입력하세요.';
    if (!required) continue;
    if (draft.metadata?.confirmed?.[field] !== true) rowErrors[`metadata_${field}_confirmed`] = `${METADATA_LABELS[field]} 항목을 각각 확인 체크하세요.`;
    if (!stringValue(draft.metadata?.reasons?.[field]).trim()) rowErrors[`metadata_${field}_reason`] = `${METADATA_LABELS[field]} 확인 사유를 입력하세요.`;
    if (stringValue(draft.metadata?.reasons?.[field]).trim().length > 1000) rowErrors[`metadata_${field}_reason`] = '확인 사유는 1,000자 이내로 입력하세요.';
  }
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
    validateMetadataDraft(draft, baselines.get(key), rowErrors);
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
  onInvalidate,
  matchedInvoices = [],
  pdfBase64,
  fileName,
  open = true,
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sourceEntries = useMemo(() => collectSourceRows(rows, safeRows), [rows]);
  const sourceReviewRequired = Boolean(rows?.sourceReview?.required === true
    || safeRows.some(row => row?.sourceReview?.required === true));
  const baselinesRef = useRef(new Map(safeRows.map(row => [rowIdentity(row), makeBaseline(row)])));
  const sourceSignature = JSON.stringify(sourceEntries.map(({ invoiceIndex, row }) => ({ invoiceIndex, row })));
  const sourceSignatureRef = useRef(sourceSignature);
  const fileIdentityRef = useRef({ pdfBase64, fileName });
  const [drafts, setDrafts] = useState(() => safeRows.map(row => ({ ...makeDraft(row), confirmed: sourceReviewRequired ? false : row?.confirmed === true })));
  const [sourceDrafts, setSourceDrafts] = useState(() => sourceDraftsFrom(sourceEntries));
  const [selectedKey, setSelectedKey] = useState(() => rowIdentity(safeRows[0]));
  const [activeField, setActiveField] = useState(() => safeRows.length ? { key: rowIdentity(safeRows[0]), field: 'gw' } : null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState(null);
  const [renderedPage, setRenderedPage] = useState(null);
  const [pdfRetryCount, setPdfRetryCount] = useState(0);
  const [previewState, setPreviewState] = useState({ loading: false, error: '' });
  const [renderError, setRenderError] = useState('');
  const [highlight, setHighlight] = useState({ source: 'none', bbox: null, label: '위치 확인 필요' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [pending, setPending] = useState(false);
  const dialogRef = useRef(null);
  const firstControlRef = useRef(null);
  const canvasRef = useRef(null);
  const canvasScrollerRef = useRef(null);
  const autoFitPreviewRef = useRef(null);

  const invalidateConfirmations = () => {
    setDrafts(previous => previous.map(draft => ({ ...draft, confirmed: false })));
    setSourceDrafts(previous => Object.fromEntries(Object.entries(previous).map(([key, draft]) => [key, { ...draft, confirmed: false }])));
    onInvalidate?.();
  };

  const pdfReady = Boolean(preview && renderedPage?.preview === preview && renderedPage.page === pageNumber
    && !previewState.loading && !previewState.error && !renderError);
  const uncheckedSourceCount = sourceEntries.filter(entry => sourceDrafts[entry.key]?.confirmed !== true).length;
  const sourceInvoiceIndexes = [...new Set(sourceEntries.map(entry => entry.invoiceIndex))];
  const uncheckedInvoiceCount = sourceInvoiceIndexes.filter(index => drafts.find(draft => rowIdentity(draft) === String(index))?.confirmed !== true).length;
  const missingSourceReasonCount = sourceEntries.filter(({ row, key }) => {
    const values = sourceDrafts[key]?.values || {};
    return Object.entries(values).some(([field, value]) => stringValue(value) !== stringValue(row.originalValues?.[field] ?? row.values?.[field]))
      && !stringValue(sourceDrafts[key]?.reason).trim();
  }).length;
  const sourceGateMessage = !sourceReviewRequired ? ''
    : !pdfBase64 ? '원본 PDF가 없어 검증을 완료할 수 없습니다.'
      : !pdfReady ? '현재 PDF 페이지가 실제로 렌더링될 때까지 확인 적용이 차단됩니다.'
        : !sourceEntries.length ? '검토가 필요한 상품행 원문 스냅샷이 없습니다.'
        : uncheckedSourceCount ? `미확인 상품행 ${uncheckedSourceCount}건을 각각 원문과 대조해 확인하세요.`
          : missingSourceReasonCount ? `수정 사유가 필요한 상품행 ${missingSourceReasonCount}건을 입력하세요.`
            : uncheckedInvoiceCount ? `인보이스 확인 ${uncheckedInvoiceCount}건이 남아 있습니다.` : '';

  useEffect(() => {
    const identities = new Set(safeRows.map(rowIdentity));
    baselinesRef.current = new Map(safeRows.map(row => [rowIdentity(row), makeBaseline(row)]));
    setDrafts(previous => safeRows.map(row => {
      const prior = previous.find(draft => rowIdentity(draft) === rowIdentity(row));
      return prior ? { ...prior, confirmed: sourceReviewRequired ? false : prior.confirmed }
        : { ...makeDraft(row), confirmed: sourceReviewRequired ? false : row?.confirmed === true };
    }));
    setSelectedKey(previous => identities.has(previous) ? previous : rowIdentity(safeRows[0]));
  }, [rows]);

  useEffect(() => {
    if (sourceSignatureRef.current === sourceSignature) return;
    sourceSignatureRef.current = sourceSignature;
    setSourceDrafts(sourceDraftsFrom(sourceEntries));
    invalidateConfirmations();
    setSubmitError('상품행 원문 스냅샷이 바뀌어 확인을 초기화했습니다. 다시 대조해 주세요.');
  }, [sourceSignature]);

  useEffect(() => {
    const previous = fileIdentityRef.current;
    if (previous.pdfBase64 !== pdfBase64 || previous.fileName !== fileName) {
      fileIdentityRef.current = { pdfBase64, fileName };
      setRenderedPage(null);
      invalidateConfirmations();
      setSubmitError('원본 파일이 바뀌어 확인을 초기화했습니다. 새 PDF를 대조해 주세요.');
    }
  }, [pdfBase64, fileName]);

  useEffect(() => {
    let stale = false;
    let loadedPreview = null;
    setPreview(null);
    setRenderedPage(null);
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
      setPageNumber(!sourceReviewRequired && Number.isInteger(firstEvidencePage) && firstEvidencePage >= 1 && firstEvidencePage <= result.numPages
        ? firstEvidencePage : 1);
      setPreviewState({ loading: false, error: '' });
      return undefined;
    }).catch(error => {
      if (!stale) {
        setPreviewState({ loading: false, error: error?.message || 'PDF 미리보기를 열지 못했습니다.' });
        setRenderedPage(null);
        invalidateConfirmations();
      }
    });
    return () => {
      stale = true;
      loadedPreview?.destroy();
    };
  }, [pdfBase64, pdfRetryCount, sourceReviewRequired]);

  useEffect(() => {
    if (!open || !preview || !canvasRef.current) return undefined;
    let stale = false;
    setRenderedPage(null);
    setRenderError('');
    preview.renderPage(pageNumber, canvasRef.current, zoom).then(result => {
      if (!stale && !result?.cancelled) {
        setRenderError('');
        setRenderedPage({ preview, page: pageNumber });
        if (autoFitPreviewRef.current !== preview) {
          autoFitPreviewRef.current = preview;
          const availableWidth = (canvasScrollerRef.current?.clientWidth || 0) - 36;
          const fitZoom = result.width > 0 && availableWidth > 0 ? Math.max(0.75, Math.min(2, zoom * availableWidth / result.width)) : zoom;
          if (Math.abs(fitZoom - zoom) >= 0.02) setZoom(Number(fitZoom.toFixed(2)));
        }
      }
    }).catch(error => {
      if (!stale) {
        setRenderError(error?.message || 'PDF 페이지를 표시하지 못했습니다.');
        setRenderedPage(null);
        invalidateConfirmations();
      }
    });
    return () => { stale = true; };
  }, [open, preview, pageNumber, zoom]);

  const rowMap = useMemo(() => new Map(safeRows.map(row => [rowIdentity(row), row])), [rows]);
  const draftMap = useMemo(() => new Map(drafts.map(draft => [rowIdentity(draft), draft])), [drafts]);
  const selectedRow = rowMap.get(selectedKey) || safeRows[0] || null;
  const selectedDraft = draftMap.get(selectedKey) || drafts[0] || null;
  const activeEvidence = activeField ? (activeField.sourceKey
    ? (() => { const entry = sourceEntries.find(item => item.key === activeField.sourceKey); return entry?.row?.evidence?.[activeField.field] || entry?.row?.evidence; })()
    : activeField.field.startsWith('metadata:')
    ? rowMap.get(activeField.key)?.metadata?.evidence?.[activeField.field.slice(9)]
    : rowMap.get(activeField.key)?.evidence?.[activeField.field]) : null;

  const sourceEntriesForInvoice = invoiceIndex => sourceEntries.filter(entry => entry.invoiceIndex === invoiceIndex);
  const invoiceSourceRowsConfirmed = invoiceIndex => sourceEntriesForInvoice(invoiceIndex)
    .every(entry => sourceDrafts[entry.key]?.confirmed === true);
  const sourceReviewForInvoice = invoiceIndex => safeRows[invoiceIndex]?.sourceReview
    || (Array.isArray(rows) ? rows.sourceReview : null);
  const matchedNameForSource = (invoiceIndex, sourceRow) => {
    const candidates = (Array.isArray(matchedInvoices) ? matchedInvoices : [])
      .filter(invoice => invoice?.sourceInvoiceIdentity?.sourceInvoiceIndex === invoiceIndex)
      .flatMap(invoice => Array.isArray(invoice.products) ? invoice.products : [])
      .filter(product => product?.sourceName === sourceRow?.description || product?.matchingDescription === sourceRow?.description);
    if (candidates.length !== 1 || candidates[0]?.unmatched === true) return null;
    return candidates[0]?.matchedName || null;
  };

  const selectSourceEvidence = (entry, field) => {
    const evidence = entry.row?.evidence?.[field] || entry.row?.evidence;
    const page = Number(evidence?.page);
    setSelectedKey(String(entry.invoiceIndex));
    setActiveField({ key: String(entry.invoiceIndex), field, sourceKey: entry.key });
    if (preview && Number.isInteger(page) && page >= 1 && page <= preview.numPages) setPageNumber(page);
  };

  const updateSourceValue = (entry, field, value) => {
    onInvalidate?.();
    setSourceDrafts(previous => ({ ...previous, [entry.key]: {
      ...previous[entry.key], values: { ...previous[entry.key]?.values, [field]: value }, confirmed: false,
    } }));
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === String(entry.invoiceIndex)
      ? { ...draft, confirmed: false } : draft));
    setSubmitError('');
  };

  const updateSourceConfirmed = (entry, confirmed) => {
    setSourceDrafts(previous => ({ ...previous, [entry.key]: { ...previous[entry.key], confirmed } }));
    setErrors(previous => ({ ...previous, [String(entry.invoiceIndex)]: { ...previous[String(entry.invoiceIndex)], sourceRows: '' } }));
    setSubmitError('');
  };

  const updateSourceReason = (entry, reason) => {
    onInvalidate?.();
    setSourceDrafts(previous => ({ ...previous, [entry.key]: { ...previous[entry.key], reason, confirmed: false } }));
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === String(entry.invoiceIndex) ? { ...draft, confirmed: false } : draft));
    setSubmitError('');
  };

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
    const evidence = field.startsWith('metadata:')
      ? row?.metadata?.evidence?.[field.slice(9)] : row?.evidence?.[field];
    const evidencePage = Number(evidence?.page);
    if (preview && Number.isInteger(evidencePage) && evidencePage >= 1 && evidencePage <= preview.numPages) {
      setPageNumber(evidencePage);
    }
  };

  const updateValue = (key, field, value) => {
    onInvalidate?.();
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key
      ? { ...draft, values: { ...draft.values, [field]: value }, confirmed: false }
      : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], [field]: '', confirmed: '' } }));
    setSubmitError('');
  };

  const updateReason = (key, reason) => {
    onInvalidate?.();
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? { ...draft, reason } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], reason: '' } }));
    setSubmitError('');
  };

  const updateConfirmed = (key, confirmed) => {
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? { ...draft, confirmed } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], confirmed: '' } }));
    setSubmitError('');
  };

  const updateMetadataValue = (key, field, value) => {
    onInvalidate?.();
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? {
      ...draft,
      confirmed: false,
      metadata: { ...draft.metadata, values: { ...draft.metadata?.values, [field]: value }, confirmed: { ...draft.metadata?.confirmed, [field]: false } },
    } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], [`metadata_${field}`]: '', [`metadata_${field}_reason`]: '', [`metadata_${field}_confirmed`]: '', confirmed: '' } }));
    setSubmitError('');
  };

  const updateMetadataReason = (key, field, reason) => {
    onInvalidate?.();
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? {
      ...draft,
      confirmed: false,
      metadata: { ...draft.metadata, reasons: { ...draft.metadata?.reasons, [field]: reason }, confirmed: { ...draft.metadata?.confirmed, [field]: false } },
    } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], [`metadata_${field}_reason`]: '', [`metadata_${field}_confirmed`]: '', confirmed: '' } }));
    setSubmitError('');
  };

  const updateMetadataConfirmed = (key, field, confirmed) => {
    setDrafts(previous => previous.map(draft => rowIdentity(draft) === key ? {
      ...draft,
      confirmed: false,
      metadata: { ...draft.metadata, confirmed: { ...draft.metadata?.confirmed, [field]: confirmed } },
    } : draft));
    setErrors(previous => ({ ...previous, [key]: { ...previous[key], [`metadata_${field}_confirmed`]: '', confirmed: '' } }));
    setSubmitError('');
  };

  const confirmDrafts = async () => {
    if (sourceReviewRequired && !pdfReady) {
      setSubmitError(!pdfBase64 ? '원본 PDF가 없어 상품행 대조 확인을 적용할 수 없습니다.' : 'PDF 페이지가 실제로 렌더링될 때까지 확인 적용이 차단됩니다.');
      return;
    }
    if (sourceReviewRequired && (!sourceEntries.length || uncheckedSourceCount > 0 || missingSourceReasonCount > 0 || uncheckedInvoiceCount > 0)) {
      setSubmitError(!sourceEntries.length ? '검토 상품행 스냅샷이 없어 확인 적용을 차단했습니다.'
        : uncheckedSourceCount ? `미확인 상품행 ${uncheckedSourceCount}건이 남아 있습니다. 각 행을 확인하세요.`
          : missingSourceReasonCount ? `수정 사유가 필요한 상품행 ${missingSourceReasonCount}건을 입력하세요.`
            : `인보이스 확인 ${uncheckedInvoiceCount}건이 남아 있습니다.`);
      return;
    }
    const nextErrors = validateDrafts(drafts, baselinesRef.current);
    setErrors(nextErrors);
    setSubmitError('');
    if (Object.keys(nextErrors).length) {
      const firstKey = drafts.find(draft => nextErrors[rowIdentity(draft)])?.invoiceIndex;
      if (firstKey !== undefined) setSelectedKey(String(firstKey));
      return;
    }
    const submission = safeRows.map((row, invoiceIndex) => {
      const draft = draftMap.get(rowIdentity(row)) || makeDraft(row);
      const rowSubmission = { ...row, values: { ...draft.values }, reason: draft.reason, confirmed: draft.confirmed,
        ...(draft.metadata ? { metadata: { values: { ...draft.metadata.values }, confirmed: { ...draft.metadata.confirmed }, reasons: { ...draft.metadata.reasons } } } : {}) };
      if (sourceReviewRequired) {
        const sourceReview = sourceReviewForInvoice(invoiceIndex) || { required: true };
        rowSubmission.sourceReview = { ...sourceReview,
          pdf: { ...(sourceReview.pdf || {}), rendered: pdfReady, page: renderedPage?.page ?? null },
          rows: sourceEntriesForInvoice(invoiceIndex).map(({ row: sourceRow, key }) => ({
            ...sourceRow,
            originalValues: { ...(sourceRow.originalValues || {}) },
            values: { ...sourceDrafts[key]?.values },
            reason: stringValue(sourceDrafts[key]?.reason),
            confirmed: sourceDrafts[key]?.confirmed === true,
            confirmedAt: sourceDrafts[key]?.confirmed === true ? new Date().toISOString() : null,
          })),
        };
      }
      return rowSubmission;
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
  const showMetadataFirst = Boolean(selectedRow?.metadata?.enabled && selectedRow.metadata.issues.length > 0);
  const metadataSection = selectedRow?.metadata?.enabled ? <section className={styles.fields} aria-label="송장 날짜·통화·총액 원문 검토" data-testid="metadata-review">
    <h4>송장 원문 정보</h4>
    <p className={styles.original}>인식 원문 날짜: {selectedRow.metadata.rawDate == null ? '없음' : String(selectedRow.metadata.rawDate)} · 원문 값과 근거는 보존됩니다.</p>
    {selectedRow.metadata.requiredDateKind && <p className={styles.original}>국가별 날짜 기준: {selectedRow.metadata.requiredDateKind === 'invoice' ? '인보이스 발행일' : selectedRow.metadata.requiredDateKind === 'arrival' ? '도착일' : '출고일'}</p>}
    {selectedRow.metadata.issues.length > 0 && <ul aria-label="원본 추출 문제">
      {selectedRow.metadata.issues.map((issue, index) => <li key={`${issue.code || 'issue'}-${index}`}>{issue.message || issue.code || '원문 확인 필요'}</li>)}
    </ul>}
    {METADATA_FIELDS.map(field => {
      const evidence = selectedRow.metadata.evidence?.[field];
      const id = `metadata-${field}-${selectedKey}`;
      const errorKey = `metadata_${field}`;
      const fieldError = currentErrors[errorKey];
      const reasonError = currentErrors[`${errorKey}_reason`];
      const confirmError = currentErrors[`${errorKey}_confirmed`];
      const input = field === 'date'
        ? <input id={id} type="date" value={selectedDraft?.metadata?.values?.[field] || ''} onFocus={() => selectEvidence(selectedKey, `metadata:${field}`)} onClick={() => selectEvidence(selectedKey, `metadata:${field}`)} onChange={event => updateMetadataValue(selectedKey, field, event.target.value)} aria-invalid={Boolean(fieldError)} data-testid="metadata-date" />
        : field === 'date_kind'
          ? <select id={id} value={selectedDraft?.metadata?.values?.[field] || ''} onFocus={() => selectEvidence(selectedKey, `metadata:${field}`)} onChange={event => updateMetadataValue(selectedKey, field, event.target.value)} aria-invalid={Boolean(fieldError)} data-testid="metadata-date-kind">
            <option value="">선택하세요</option><option value="invoice">인보이스 발행일</option><option value="arrival">도착일</option><option value="shipment">출고·운송일</option>
          </select>
          : <input id={id} type="text" inputMode={field === 'invoice_total' ? 'decimal' : 'text'} maxLength={field === 'currency' ? 3 : undefined} value={selectedDraft?.metadata?.values?.[field] || ''} onFocus={() => selectEvidence(selectedKey, `metadata:${field}`)} onClick={() => selectEvidence(selectedKey, `metadata:${field}`)} onChange={event => updateMetadataValue(selectedKey, field, event.target.value)} aria-invalid={Boolean(fieldError)} data-testid={`metadata-${field}`} />;
      return <div className={styles.fieldCard} key={field}>
        <div className={styles.fieldHeading}><strong>{METADATA_LABELS[field]}</strong><span>{evidence?.page ? `원문 ${evidence.page}페이지` : '원문 위치 확인 필요'}</span></div>
        <label htmlFor={id}>{METADATA_LABELS[field]}</label>
        <p className={styles.original}>기존 인식값: {selectedRow.metadata.original?.[field] === '' || selectedRow.metadata.original?.[field] == null ? '없음' : String(selectedRow.metadata.original[field])}</p>
        {input}
        {evidence?.quote && <q className={styles.quote}>{evidence.quote}</q>}
        {fieldError && <p className={styles.error} role="alert">{fieldError}</p>}
        <label className={styles.confirmLabel}>
          <input type="checkbox" checked={selectedDraft?.metadata?.confirmed?.[field] === true} onChange={event => updateMetadataConfirmed(selectedKey, field, event.target.checked)} data-testid={`metadata-confirm-${field}`} />
          <span>이 {METADATA_LABELS[field]}의 원문과 입력값을 각각 대조했습니다.</span>
        </label>
        {confirmError && <p className={styles.error} role="alert">{confirmError}</p>}
        <label className={styles.reasonLabel} htmlFor={`${id}-reason`}>{METADATA_LABELS[field]} 확인 사유
          <input id={`${id}-reason`} type="text" value={selectedDraft?.metadata?.reasons?.[field] || ''} onChange={event => updateMetadataReason(selectedKey, field, event.target.value)} placeholder="원문 확인 또는 수정 근거" aria-invalid={Boolean(reasonError)} data-testid={`metadata-reason-${field}`} />
        </label>
        {reasonError && <p className={styles.error} role="alert">{reasonError}</p>}
      </div>;
    })}
  </section> : null;

  const sourceReviewSection = sourceReviewRequired ? <section className={styles.sourceReview} aria-label="원본 PDF 상품행 검토" data-testid="source-review">
    <h4>상품행 원문 대조</h4>
    <p>AI 신뢰도와 관계없이 각 상품행을 PDF에서 직접 대조하세요. 행의 원문 근거를 누르면 해당 페이지로 이동합니다. 값을 수정하면 그 행과 인보이스 확인이 해제됩니다.</p>
    {sourceEntriesForInvoice(Number(selectedKey)).length === 0
      ? <p role="alert" className={styles.error}>이 인보이스에 연결된 상품행 검토 스냅샷이 없습니다.</p>
      : <div className={styles.sourceTableViewport}>
        <table className={styles.sourceTable}>
          <thead><tr><th scope="col">원문 품목 · ERP 매칭</th><th scope="col">원문값 확인·수정 (필드별 원문은 입력에 표시)</th><th scope="col">개별 원문 확인</th></tr></thead>
          <tbody>{sourceEntriesForInvoice(Number(selectedKey)).map(entry => {
            const sourceRow = entry.row;
            const current = sourceDrafts[entry.key] || { values: sourceRow.values || {}, confirmed: false };
            const evidenceField = Object.keys(sourceRow.evidence || {})[0] || '';
            const original = sourceRow.originalValues || {};
            const matchedName = matchedNameForSource(entry.invoiceIndex, sourceRow);
            return <tr key={entry.key}>
              <th scope="row" className={styles.sourceName}><span>{sourceRow.description || '원문 품명 없음'}</span><small>원문 행 {sourceRow.lineIndex ?? '—'}</small>
                <small>{matchedName || '미매칭 · 결과에서 선택 필요'}</small>
                <button type="button" className={styles.sourceEvidenceButton} onClick={() => selectSourceEvidence(entry, evidenceField)} disabled={!Object.keys(sourceRow.evidence || {}).length}>원문 페이지 열기</button>
              </th>
              <td><div className={styles.sourceEditFields}>{Object.entries(current.values || {}).map(([field, value]) => {
                const sourceValue = original[field] ?? sourceRow.values?.[field];
                const changed = stringValue(value) !== stringValue(sourceValue);
                return <label key={field} title={`원문 ${SOURCE_FIELD_LABELS[field] || field}: ${stringValue(sourceValue) || '없음'}`}>
                  <span>{SOURCE_FIELD_LABELS[field] || field}</span>
                  <input type="text" value={value ?? ''} aria-label={'원문 ' + (sourceRow.description || '') + ' ' + (SOURCE_FIELD_LABELS[field] || field)}
                    onFocus={() => selectSourceEvidence(entry, field)} onChange={event => updateSourceValue(entry, field, event.target.value)} />
                  {changed && <small>원문: {stringValue(sourceValue) || '없음'}</small>}
                </label>;
              })}
                {Object.entries(current.values || {}).some(([field, value]) => stringValue(value) !== stringValue(original[field] ?? sourceRow.values?.[field]))
                  && <label className={styles.sourceReason}><span>수정 사유</span><input type="text" value={current.reason || ''} aria-label={'원문 ' + (sourceRow.description || '') + ' 수정 사유'} placeholder="변경 근거" onChange={event => updateSourceReason(entry, event.target.value)} /></label>}
              </div></td>
              <td><label className={styles.sourceConfirm}>
                <input type="checkbox" checked={current.confirmed === true} disabled={!pdfReady}
                  onChange={event => updateSourceConfirmed(entry, event.target.checked)} data-testid="source-row-confirm" />
                <span>{current.confirmed ? '원문 대조 완료' : '이 상품행 대조 확인'}</span>
              </label></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {sourceReviewRequired && !pdfReady && <p role="status" className={styles.sourceGate}>{sourceGateMessage}</p>}
  </section> : null;

  return (
    <div className={styles.backdrop} data-testid="evidence-review">
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="패킹 metadata·중량·운송비 근거 확인" data-pdf-ready={pdfReady ? 'true' : 'false'}>
        <header className={styles.header}>
          <div>
            <h2>{sourceReviewRequired ? '원본 PDF · 인식값 검증' : '원본 PDF · 중량·운송비 근거 확인'}</h2>
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
                <button type="button" onClick={() => {
                  const canvasWidth = Number.parseFloat(canvasRef.current?.style.width || '0');
                  const availableWidth = (canvasScrollerRef.current?.clientWidth || 0) - 36;
                  if (canvasWidth > 0 && availableWidth > 0) setZoom(value => Math.max(0.75, Math.min(2, Number((value * availableWidth / canvasWidth).toFixed(2)))));
                }} disabled={!preview} aria-label="PDF 너비에 맞춤">너비 맞춤</button>
                <button type="button" onClick={() => setZoom(value => Math.max(0.75, Number((value - 0.25).toFixed(2))))} disabled={zoom <= 0.75} aria-label="PDF 축소">−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom(value => Math.min(2, Number((value + 0.25).toFixed(2))))} disabled={zoom >= 2} aria-label="PDF 확대">+</button>
              </div>
            </div>

            <div className={styles.previewStatus} role="status" aria-live="polite">
              {previewState.loading && '로컬 PDF를 여는 중…'}
              {previewState.error && previewState.error}
              {!pdfBase64 && (sourceReviewRequired ? 'PDF 원본이 없어 상품행 검증과 확인 적용이 차단됩니다.' : 'PDF 원본이 없어 문서 위치를 표시할 수 없습니다. Excel 원본은 별도로 확인하세요.')}
              {pdfBase64 && preview && !previewState.loading && !previewState.error && !renderError && highlight.label + ' · ' + pageNumber + '페이지'}
              {(previewState.error || renderError) && <button type="button" onClick={() => {
                setPreviewState({ loading: false, error: '' }); setRenderError(''); setRenderedPage(null); setPdfRetryCount(value => value + 1);
              }} aria-label="PDF 다시 불러오기">PDF 다시 시도</button>}
            </div>
            <div ref={canvasScrollerRef} className={styles.canvasScroller} data-testid="pdf-preview" tabIndex="0" aria-label={'PDF ' + pageNumber + '페이지 미리보기'}>
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

              {sourceReviewSection}

              {showMetadataFirst && metadataSection}

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

              {!showMetadataFirst && metadataSection}

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
                  disabled={sourceReviewRequired && (!pdfReady || !invoiceSourceRowsConfirmed(Number(selectedKey)))}
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
            <button type="button" className={styles.applyButton} onClick={confirmDrafts} disabled={pending || !safeRows.length || Boolean(sourceGateMessage) || (sourceReviewRequired && !pdfReady)}>
              {pending ? '적용 중…' : '확인값 적용 · 결과 재생성'}
            </button>
          </div>
          {sourceGateMessage && <p className={styles.sourceGate} role="status">{sourceGateMessage}</p>}
          {submitError && <p className={styles.submitError} role="alert">{submitError}</p>}
        </footer>
      </section>
    </div>
  );
}

export { makeDraft, validateDrafts };
