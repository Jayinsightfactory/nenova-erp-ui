import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InvoiceReceiptCostReview from './InvoiceReceiptCostReview.js';
import styles from '../../styles/InvoiceReceipt.module.css';
import { assertReceiptScope, runReceiptPreparation, verifyReceiptDocument } from '../../lib/invoiceReceiptWorkflow.js';
import {
  adaptPackingReceipts,
  buildReceiptCommitPending,
  isVerifiedReceiptCommitRejection,
  normalizeReceiptDocument,
  nullableNumber,
  receiptPartIdForCommit,
  receiptLineQuantity,
  sha256File,
  toReceiptDraftPayload,
} from '../../lib/importPackingReceiptAdapter.js';

const jsonHeaders = { 'Content-Type': 'application/json' };
const EMPTY_LIST = Object.freeze([]);
const WORKFLOW_STAGES = [
  ['conversion', '국가별 변환'], ['draft', '초안 저장'], ['validation', '서버 검증'],
  ['receipt', '입고 확인'], ['receiptVerify', '입고 재조회'], ['cost', '원가 계산'],
  ['costSave', '원가 승인·저장'], ['costVerify', '원가 재조회'],
];
const CONVERSION_MISMATCH_WARNING = '국가별 패킹 변환 수량이 원문 수량과 다릅니다. 원문과 변환 근거를 행별로 확인하세요.';
const RECEIPT_QUANTITY_FIELDS = new Set(['boxQuantity', 'bunchQuantity', 'stemQuantity']);

function conversionMismatchLines(document) {
  return (document?.lines || []).filter(line => line.sourceEvidence?.conversionValidation?.status === 'MISMATCH');
}

function unresolvedConversionMismatchLines(document) {
  return conversionMismatchLines(document).filter(line => line.reviewed?.conversionConfirmed !== true);
}

function conversionWarnings(document) {
  const warnings = (document?.sourceWarnings || []).filter(warning => warning !== CONVERSION_MISMATCH_WARNING);
  return unresolvedConversionMismatchLines(document).length ? [...warnings, CONVERSION_MISMATCH_WARNING] : warnings;
}

function applyConversionReviewState(document) {
  return { ...document, sourceWarnings: conversionWarnings(document) };
}

function resetWorkflowStages() {
  return Object.fromEntries(WORKFLOW_STAGES.map(([id]) => [id,
    { id, status: 'waiting', message: '입력 변경으로 재검증 필요', at: null },
  ]));
}

async function readJson(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) {
    const error = new Error(data?.error || `요청에 실패했습니다. (${response.status})`);
    error.code = data?.code || null;
    error.httpStatus = response.status;
    error.resultUnknown = data?.resultUnknown;
    error.details = data;
    throw error;
  }
  return data;
}

function responseDocument(data) {
  return data?.document || data?.draft || data?.result?.document || null;
}

function issueText(issue) {
  if (typeof issue === 'string') return issue;
  return issue?.message || issue?.reason || issue?.code || '확인 필요';
}

function issueLineId(issue) {
  return typeof issue === 'object' && issue ? (issue.lineId || issue.receiptLineId || null) : null;
}

function displayNumber(value) {
  const number = nullableNumber(value);
  return number == null ? '—' : number.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

function productLabel(product) {
  if (!product) return '';
  return `${product.DisplayName || product.ProdName || product.ProdCode || '이름 없음'} (#${product.ProdKey})`;
}

function newUuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error('이 브라우저에서는 작업 UUID를 만들 수 없습니다.');
  return globalThis.crypto.randomUUID();
}

function operationKey(documentId) {
  return `nenova.invoice-receipt.operation.${documentId}`;
}

function loadPendingOperation(documentId) {
  if (!documentId || typeof localStorage === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(operationKey(documentId)) || 'null');
    return value?.operationId && value?.receiptPartId ? value : null;
  } catch (_) {
    return null;
  }
}

function storePendingOperation(documentId, value) {
  if (!documentId || typeof localStorage === 'undefined') return;
  if (value) localStorage.setItem(operationKey(documentId), JSON.stringify(value));
  else localStorage.removeItem(operationKey(documentId));
}

async function submitReceiptCommit(pending) {
  if (!pending?.documentId || !pending?.requestBody) throw new Error('원래 등록 요청 본문이 없어 같은 작업을 재시도할 수 없습니다. 작업 상태만 다시 확인하세요.');
  return readJson(await fetch(`/api/import/receipts/${pending.documentId}/commit`, {
    method: 'POST', credentials: 'same-origin', headers: jsonHeaders,
    body: JSON.stringify(pending.requestBody),
  }));
}

export function canCommitReceipt(record) {
  const issues = Array.isArray(record?.preview?.issues) ? record.preview.issues : [];
  return Boolean(record && !record.dirty && record.preview?.canCommit === true && issues.length === 0
    && record.preview?.baselineDigest && record.document?.revision != null
    && Number.isSafeInteger(Number(record.document.revision)) && !record.pendingOperation);
}

export function buildReceiptIssueBrief(document, preview) {
  const issues = Array.isArray(preview?.issues) ? preview.issues : [];
  if (!issues.length) return '확인할 이슈가 없습니다.';
  const lineById = new Map((document?.lines || []).map(line => [line.lineId, line]));
  return issues.map((issue, index) => {
    const line = lineById.get(issueLineId(issue));
    const name = line?.originalName || (typeof issue === 'object' ? issue.originalName : '') || `이슈 ${index + 1}`;
    const country = document?.reviewedMetadata?.country || '';
    const quantity = line ? receiptLineQuantity(line, country) : null;
    const unit = country === 'CN' ? '단' : '송이';
    return `${name} · ${quantity == null ? '수량 미확인' : `${displayNumber(quantity)}${unit}`} · ${issueText(issue)}`;
  }).join('\n');
}

function NumberInput({ value, onChange, label, className }) {
  return <input className={className} aria-label={label} inputMode="decimal" value={value ?? ''}
    onChange={event => onChange(event.target.value)} />;
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? styles.fieldWide : styles.field}><span>{label}</span>{children}</label>;
}

function Modal({ title, onClose, children, initialFocusRef, footer }) {
  useEffect(() => {
    initialFocusRef?.current?.focus();
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [initialFocusRef, onClose]);
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}>
      <header><h3>{title}</h3><button type="button" onClick={onClose} aria-label="닫기">×</button></header>
      <div className={styles.modalBody}>{children}</div>
      {footer && <footer>{footer}</footer>}
    </section>
  </div>;
}

export default function InvoiceReceiptWorkbench({
  excels = EMPTY_LIST, invoices = EMPTY_LIST, country = '', file = null, products = EMPTY_LIST, reviewConfirmed = false, truncated = false,
}) {
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [sourceState, setSourceState] = useState({ busy: false, error: '', hash: '' });
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [savedDocuments, setSavedDocuments] = useState([]);
  const [savedError, setSavedError] = useState('');
  const [farmQuery, setFarmQuery] = useState('');
  const [farmOptions, setFarmOptions] = useState([]);
  const [farmBusy, setFarmBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmReason, setConfirmReason] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [operationResult, setOperationResult] = useState(null);
  const [browseYear, setBrowseYear] = useState('');
  const [browseWeek, setBrowseWeek] = useState('');
  const [browseScope, setBrowseScope] = useState({ orderYear: '', orderWeek: '' });
  const workflowGenerationRef = useRef(0);
  const workflowLockRef = useRef(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const confirmButtonRef = useRef(null);
  const reasonRef = useRef(null);
  const copyRef = useRef(null);
  const rowRefs = useRef(new Map());

  const selected = records.find(record => record.document.documentId === selectedId) || records[0] || null;
  const documentValue = selected?.document || null;
  const preview = selected?.preview || null;
  const issues = Array.isArray(preview?.issues) ? preview.issues : [];
  const issuesByLine = useMemo(() => {
    const grouped = new Map();
    for (const issue of issues) {
      const lineId = issueLineId(issue);
      if (!lineId) continue;
      if (!grouped.has(lineId)) grouped.set(lineId, []);
      grouped.get(lineId).push(issue);
    }
    return grouped;
  }, [issues]);
  const productByKey = useMemo(() => new Map((products || []).map(product => [Number(product.ProdKey), product])), [products]);
  const selectableProducts = useMemo(() => (products || []).filter(product => product?.selectable !== false
    && (!documentValue?.reviewedMetadata?.country || product.country === documentValue.reviewedMetadata.country)),
  [documentValue?.reviewedMetadata?.country, products]);
  const productByLabel = useMemo(() => new Map(selectableProducts.map(product => [productLabel(product), product])), [selectableProducts]);
  const onCostStageChange = useCallback(event => {
    if (!event || event.documentId !== selectedIdRef.current || Number(event.revision) !== Number(documentValue?.revision)) return;
    setRecords(current => current.map(record => record.document.documentId === event.documentId
      ? { ...record, stageProgress: { ...(record.stageProgress || {}), [event.id]: event } } : record));
  }, [documentValue?.revision]);

  useEffect(() => {
    let active = true;
    workflowGenerationRef.current += 1;
    if (!file || !invoices.length || !excels.length) {
      setSourceState({ busy: false, error: '', hash: '' });
      return () => { active = false; };
    }
    setSourceState({ busy: true, error: '', hash: '' });
    (async () => {
      const hash = await sha256File(file);
      const documents = await adaptPackingReceipts({
        excels, invoices, country, fileName: file.name, products, sourceHash: hash, reviewConfirmed, truncated,
      });
      if (!active) return;
      const next = documents.map(document => ({ document, dirty: true, preview: null, pendingOperation: loadPendingOperation(document.documentId) }));
      setRecords(next);
      setSelectedId(next[0]?.document.documentId || '');
      setSourceState({ busy: false, error: '', hash });
      setNotice({ type: 'info', text: '분석값을 입고 초안으로 준비했습니다. 아직 ERP 입고가 등록된 상태가 아닙니다.' });
    })().catch(error => {
      if (active) setSourceState({ busy: false, error: error.message, hash: '' });
    });
    return () => { active = false; };
  }, [country, excels, file, invoices, products, reviewConfirmed, truncated]);

  useEffect(() => {
    if (!documentValue?.documentId) return;
    const pendingOperation = loadPendingOperation(documentValue.documentId);
    setRecords(current => current.map(record => record.document.documentId === documentValue.documentId
      ? { ...record, pendingOperation } : record));
  }, [documentValue?.documentId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setFarmBusy(true);
      try {
        const response = await fetch(`/api/arrival-cost?lookup=farms&q=${encodeURIComponent(farmQuery.trim())}&limit=30`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        const data = await readJson(response);
        setFarmOptions(data.farms || []);
      } catch (error) {
        if (error.name !== 'AbortError') setFarmOptions([]);
      } finally {
        if (!controller.signal.aborted) setFarmBusy(false);
      }
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [farmQuery]);

  const scopeYear = documentValue?.orderYear || browseScope.orderYear;
  const scopeWeek = documentValue?.orderWeek || browseScope.orderWeek;
  useEffect(() => {
    if (!scopeYear || !scopeWeek) { setSavedDocuments([]); return undefined; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSavedError('');
      try {
        const response = await fetch(`/api/import/receipts/drafts?orderYear=${encodeURIComponent(scopeYear)}&orderWeek=${encodeURIComponent(scopeWeek)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        const data = await readJson(response);
        setSavedDocuments(data.documents || data.drafts || data.items || []);
      } catch (error) {
        if (error.name !== 'AbortError') setSavedError(error.message);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scopeWeek, scopeYear]);

  function updateSelected(mutator) {
    workflowGenerationRef.current += 1;
    setRecords(current => current.map(record => {
      if (record.document.documentId !== selectedId) return record;
      const document = applyConversionReviewState(mutator(record.document));
      const mismatchLines = conversionMismatchLines(document);
      const unresolved = unresolvedConversionMismatchLines(document);
      const stageProgress = resetWorkflowStages(record.stageProgress);
      if (mismatchLines.length) stageProgress.conversion = {
        id: 'conversion', status: unresolved.length ? 'blocked' : 'passed',
        message: unresolved.length
          ? `원문/변환 차이 ${unresolved.length}행의 수량 조정과 명시 확인이 필요합니다.`
          : `원문/변환 차이 ${mismatchLines.length}행을 확인하고 입고 수량을 명시적으로 승인했습니다.`,
        at: new Date().toISOString(),
      };
      return { ...record, document, dirty: true, preview: null, stageProgress };
    }));
    setOperationResult(null);
  }

  function updateDocumentField(field, value) {
    updateSelected(document => ({ ...document, [field]: value }));
  }

  function updateMetadata(field, value) {
    updateSelected(document => ({ ...document, reviewedMetadata: { ...document.reviewedMetadata, [field]: value } }));
  }

  function updateFreightCurrency(value) {
    const currency = value.toUpperCase();
    updateSelected(document => {
      const metadata = document.reviewedMetadata || {};
      const costInputs = { ...(metadata.costInputs || {}) };
      if (currency !== 'USD') {
        if (nullableNumber(metadata.docFee) != null && nullableNumber(costInputs.docFee?.amount) == null) {
          costInputs.docFee = { ...(costInputs.docFee || {}), currency, amount: metadata.docFee, source: 'review' };
        }
      }
      return { ...document, reviewedMetadata: {
        ...metadata, freightCurrency: currency, costInputs,
        freightRate: currency === 'USD' ? metadata.freightRate : null,
        docFee: currency === 'USD' ? metadata.docFee : null,
      } };
    });
  }

  function updateCostInput(field, value) {
    updateSelected(document => ({ ...document, reviewedMetadata: {
      ...document.reviewedMetadata,
      costInputs: {
        ...(document.reviewedMetadata.costInputs || {}),
        [field]: {
          ...(document.reviewedMetadata.costInputs?.[field] || {}),
          currency: document.reviewedMetadata.freightCurrency || '', amount: value, source: 'review',
        },
      },
    } }));
  }

  function updateLine(lineId, field, value) {
    updateSelected(document => ({
      ...document,
      lines: document.lines.map(line => {
        if (line.lineId !== lineId) return line;
        const conversionQuantityEdit = line.sourceEvidence?.conversionValidation?.status === 'MISMATCH'
          && RECEIPT_QUANTITY_FIELDS.has(field) && String(value ?? '') !== String(line[field] ?? '');
        const reviewed = conversionQuantityEdit
          ? { ...(line.reviewed || {}), confirmed: false, conversionConfirmed: false }
          : line.reviewed;
        return { ...line, [field]: value, ...(reviewed ? { reviewed } : {}) };
      }),
    }));
  }

  function confirmConversionLine(lineId, confirmed) {
    updateSelected(document => ({
      ...document,
      lines: document.lines.map(line => line.lineId === lineId
        ? { ...line, reviewed: { ...(line.reviewed || {}), confirmed: Boolean(confirmed), conversionConfirmed: Boolean(confirmed) } }
        : line),
    }));
  }

  function updateLineProduct(lineId, value) {
    const product = productByLabel.get(value) || null;
    updateSelected(document => ({
      ...document,
      lines: document.lines.map(line => line.lineId === lineId
        ? { ...line, productSearch: value, prodKey: product ? Number(product.ProdKey) : null }
        : line),
    }));
  }

  async function saveDraftRecord(target, isCurrent = () => true, applyToState = true) {
    if (!target) throw new Error('저장할 문서가 없습니다.');
    try {
      const isUpdate = target.document.revision != null;
      const url = isUpdate ? `/api/import/receipts/${target.document.documentId}` : '/api/import/receipts/drafts';
      const response = await fetch(url, {
        method: isUpdate ? 'PATCH' : 'POST', credentials: 'same-origin', headers: jsonHeaders,
        body: JSON.stringify(toReceiptDraftPayload(target.document)),
      });
      const data = await readJson(response);
      const saved = responseDocument(data);
      if (!saved) throw new Error('저장 응답에서 초안 문서를 확인할 수 없습니다.');
      const normalized = { ...normalizeReceiptDocument(saved), sourceWarnings: target.document.sourceWarnings || [] };
      if (applyToState && isCurrent()) {
        const expectedRevision = target.document.revision == null ? 1 : Number(target.document.revision) + 1;
        assertReceiptScope(normalized, target.document, expectedRevision);
        setRecords(current => current.map(record => record.document.documentId === target.document.documentId
          ? { ...record, document: normalized, dirty: false, preview: null } : record));
        setSelectedId(normalized.documentId);
      }
      return normalized;
    } catch (error) {
      throw error;
    }
  }

  async function saveDraft() {
    if (!selected || busy || workflowLockRef.current || selected.recoveryRequired) return;
    if (unresolvedConversionMismatchLines(selected.document).length) {
      setNotice({ type: 'error', text: '원문과 변환 수량 차이를 행별로 확인하고 입고 수량을 수정한 뒤 각 행의 ‘차이 검토 확인’을 체크해야 저장할 수 있습니다.' });
      return;
    }
    workflowLockRef.current = { kind: 'manual-save', documentId: selected.document.documentId };
    setBusy('save'); setNotice(null);
    try {
      const saved = await saveDraftRecord(selected);
      setManualStage(selected.document.documentId, 'draft', 'passed', `초안 revision ${saved.revision} 저장 및 응답 scope 확인`);
      setNotice({ type: 'success', text: `초안 revision ${saved.revision}을 저장했습니다. ERP 입고 등록은 아직 실행되지 않았습니다.` });
    } catch (error) {
      setManualStage(selected.document.documentId, 'draft', error.resultUnknown || !error.httpStatus || error.httpStatus >= 500 ? 'unknown' : 'failed', error.message);
      if (error.resultUnknown || !error.httpStatus || error.httpStatus >= 500) {
        setRecords(current => current.map(record => record.document.documentId === selected.document.documentId
          ? { ...record, recoveryRequired: true, stageProgress: { ...(record.stageProgress || {}),
            draft: { id: 'draft', status: 'unknown', message: '저장 결과 확인이 필요합니다. 같은 문서를 다시 불러오세요.', at: new Date().toISOString() } } } : record));
      }
      setNotice({ type: 'error', text: error.message });
    }
    finally { workflowLockRef.current = null; setBusy(''); }
  }

  function installSavedDocument(loaded) {
    const normalized = applyConversionReviewState(normalizeReceiptDocument(loaded));
    const pendingOperation = loadPendingOperation(normalized.documentId);
    let verifiedReceipt = false;
    let receiptVerifyError = '';
    if (normalized.receiptStatus === 'COMMITTED') {
      try {
        const verified = verifyReceiptDocument(normalized, normalized);
        verifiedReceipt = !pendingOperation || pendingOperation.operationId === verified.operation.operationId;
        if (!verifiedReceipt) receiptVerifyError = '대기 중 operationId와 서버 완료 operationId가 다릅니다.';
      } catch (error) { receiptVerifyError = error.message; }
    }
    if (verifiedReceipt && pendingOperation) storePendingOperation(normalized.documentId, null);
    setRecords(current => {
      const existing = current.find(record => record.document.documentId === normalized.documentId);
      const sameRevision = existing
        && Number(existing.document.revision) === Number(normalized.revision)
        && existing.document.sourceHash === normalized.sourceHash
        && String(existing.document.orderYear) === String(normalized.orderYear)
        && String(existing.document.orderWeek) === String(normalized.orderWeek);
      const now = new Date().toISOString();
      const initialStages = {
        conversion: { id: 'conversion', status: 'waiting', displayStatus: '기존 문서', message: '기존 저장 문서 · 이 세션에서 국가별 변환은 실행하지 않았습니다.', at: now },
        draft: { id: 'draft', status: 'passed', message: `저장된 revision ${normalized.revision}을 서버 조회에서 확인했습니다.`, at: now },
        validation: { id: 'validation', status: 'waiting', displayStatus: '미리보기 필요', message: '현재 revision의 서버 미리보기 검증 기록이 확인되지 않았습니다.', at: now },
        receipt: { id: 'receipt', status: pendingOperation ? 'unknown' : 'waiting', message: pendingOperation ? '확인 대기 중인 operation이 있습니다.' : '입고 승인 대기', at: now },
        receiptVerify: { id: 'receiptVerify', status: pendingOperation ? 'unknown' : 'waiting', message: pendingOperation ? '같은 operation의 결과 재조회가 필요합니다.' : '입고 등록 후 서버 readback을 기다립니다.', at: now },
        cost: { id: 'cost', status: 'waiting', displayStatus: '입고 확인 후', message: '현재 revision 입고 readback 확인 전에는 원가 계산을 열지 않습니다.', at: now },
        costSave: { id: 'costSave', status: 'waiting', displayStatus: '승인 대기', message: '실제 원가 계산·검증 후 명시 승인을 기다립니다.', at: now },
        costVerify: { id: 'costVerify', status: 'waiting', displayStatus: '저장 후 확인', message: '원가 승인 저장 후 별도 재조회가 필요합니다.', at: now },
      };
      const priorStages = sameRevision ? existing.stageProgress || {} : {};
      const stageProgress = { ...initialStages, ...priorStages };
      if (verifiedReceipt) {
        stageProgress.receipt = { id: 'receipt', status: 'passed', message: '현재 revision의 COMMITTED operation 확인', at: now };
        stageProgress.receiptVerify = { id: 'receiptVerify', status: 'passed', message: `문서·revision·원본범위·WarehouseKey ${normalized.warehouseKey} readback 확인`, at: now };
      } else if (normalized.receiptStatus === 'COMMITTED') {
        stageProgress.receipt = { id: 'receipt', status: 'unknown', message: '서버 상태는 COMMITTED이나 operation 신원 검증은 완료되지 않았습니다.', at: now };
        stageProgress.receiptVerify = { id: 'receiptVerify', status: 'failed', message: receiptVerifyError || '입고 readback 검증 실패', at: now };
      } else if (pendingOperation) {
        stageProgress.receipt = { id: 'receipt', status: 'unknown', message: '동일 operation 복구 확인이 필요합니다.', at: now };
        stageProgress.receiptVerify = { id: 'receiptVerify', status: 'unknown', message: '새 입고 요청 전 기존 operation을 확인하세요.', at: now };
      }
      const nextRecord = {
        document: { ...normalized, sourceWarnings: existing?.document.sourceWarnings || [] },
        dirty: false,
        preview: null,
        pendingOperation: verifiedReceipt ? null : pendingOperation,
        stageProgress,
      };
      return [...current.filter(record => record.document.documentId !== normalized.documentId), nextRecord];
    });
    setSelectedId(normalized.documentId);
    return normalized;
  }

  async function loadDocument(documentId) {
    const generation = workflowGenerationRef.current;
    setBusy('load'); setNotice(null);
    try {
      const data = await readJson(await fetch(`/api/import/receipts/${documentId}`, { credentials: 'same-origin', cache: 'no-store' }));
      const loaded = responseDocument(data);
      if (!loaded) throw new Error('저장 문서를 불러오지 못했습니다.');
      if (workflowGenerationRef.current !== generation) return;
      installSavedDocument(loaded);
      setNotice({ type: 'success', text: '저장 초안과 행·이력을 불러왔습니다.' });
    } catch (error) {
      if (workflowGenerationRef.current === generation) setNotice({ type: 'error', text: error.message });
    } finally {
      setBusy('');
    }
  }

  async function requestPreview() {
    if (!selected || selected.dirty || selected.document.revision == null || selected.document.sourceWarnings?.length || busy || workflowLockRef.current) return;
    workflowLockRef.current = { kind: 'manual-preview', documentId: selected.document.documentId };
    setBusy('preview'); setNotice(null);
    try {
      const result = await previewDraft(selected);
      setRecords(current => current.map(record => record.document.documentId === selected.document.documentId
        ? { ...record, preview: result } : record));
      setManualStage(selected.document.documentId, 'validation', result.canCommit === true && result.issues?.length === 0 ? 'passed' : 'blocked',
        result.canCommit === true && result.issues?.length === 0 ? '서버 미리보기 통과' : '서버 미리보기에서 등록 보류');
      setNotice({ type: result.canCommit ? 'success' : 'info', text: result.canCommit
        ? '서버 미리보기 검증을 통과했습니다. 등록 전 범위와 이슈 0건을 다시 확인하세요.'
        : '서버 미리보기가 등록을 허용하지 않았습니다. 오른쪽 이슈를 확인하세요.' });
    } catch (error) {
      setManualStage(selected.document.documentId, 'validation', 'failed', error.message);
      setNotice({ type: 'error', text: error.message });
    }
    finally { workflowLockRef.current = null; setBusy(''); }
  }

  async function previewDraft(target) {
      const data = await readJson(await fetch(`/api/import/receipts/${target.document.documentId}/preview`, {
        method: 'POST', credentials: 'same-origin', headers: jsonHeaders,
        body: JSON.stringify({ revision: target.document.revision }),
      }));
      if (!data.preview) throw new Error('미리보기 응답이 비어 있습니다.');
      if (Number(data.preview.documentRevision) !== Number(target.document.revision)) {
        throw new Error('서버 미리보기 revision이 현재 문서와 일치하지 않습니다.');
      }
      return data.preview;
  }

  function setWorkflowStage(documentId, generation, event) {
    const lock = workflowLockRef.current;
    const draftAdvances = event.id === 'draft' && event.status === 'passed'
      && Number(event.revision) === Number(lock?.revision) + 1;
    if (workflowGenerationRef.current !== generation || selectedIdRef.current !== documentId
      || event.documentId !== documentId
      || (lock?.generation === generation && lock.revision != null
        && Number(event.revision) !== Number(lock.revision) && !draftAdvances)) return;
    if (lock?.generation === generation && event.id === 'draft' && event.status === 'passed') {
      workflowLockRef.current = { ...lock, revision: event.revision };
    }
    setRecords(current => current.map(record => record.document.documentId === documentId
      ? { ...record, stageProgress: { ...(record.stageProgress || {}), [event.id]: event } } : record));
  }

  async function runAutomaticPreparation() {
    if (!selected || busy || workflowLockRef.current || selected.recoveryRequired) return;
    const target = selected;
    const documentId = target.document.documentId;
    const unresolvedConversions = unresolvedConversionMismatchLines(target.document);
    if (unresolvedConversions.length) {
      setRecords(current => current.map(item => item.document.documentId === documentId
        ? { ...item, stageProgress: { ...(item.stageProgress || {}), conversion: {
          id: 'conversion', status: 'blocked', message: `원문/변환 차이 ${unresolvedConversions.length}행을 확인하고 입고 수량을 명시 승인해야 자동 검증을 시작할 수 있습니다.`, at: new Date().toISOString(),
        } } } : item));
      setNotice({ type: 'error', text: '원문과 변환 수량 차이를 행별로 확인하고 각 행의 ‘차이 검토 확인’을 체크해야 자동 검증·저장을 시작할 수 있습니다.' });
      return;
    }
    const generation = ++workflowGenerationRef.current;
    const isCurrent = () => workflowGenerationRef.current === generation && selectedIdRef.current === documentId;
    workflowLockRef.current = { documentId, generation, revision: target.document.revision };
    setBusy('auto-workflow'); setNotice(null);
    setWorkflowStage(documentId, generation, { id: 'conversion', status: 'passed', message: '기존 국가별 변환 결과 사용', at: new Date().toISOString(), documentId, revision: target.document.revision });
    try {
      const result = await runReceiptPreparation({
        record: target,
        saveDraft: record => saveDraftRecord({ ...target, document: record }, isCurrent, false),
        previewDraft: document => previewDraft({ document }),
        readDocument: async documentId => {
          const loaded = await readDocument(documentId);
          verifyReceiptDocument(loaded, target.document);
          return loaded;
        },
        onStage: event => setWorkflowStage(documentId, generation, event),
        isCurrent,
      });
      if (isCurrent()) {
        const returned = result.document;
        if (returned && returned.documentId === target.document.documentId
          && Number.isSafeInteger(Number(returned.revision)) && Number(returned.revision) > 0) {
          assertReceiptScope(returned, target.document, returned.revision);
          const revisionAdvanced = target.document.revision == null
            || Number(returned.revision) > Number(target.document.revision);
          const sameRevision = Number(returned.revision) === Number(target.document.revision);
          if (revisionAdvanced || (sameRevision && result.preview)) {
            setRecords(current => current.map(item => item.document.documentId === documentId
              ? { ...item,
                ...(revisionAdvanced ? { document: returned, dirty: false, recoveryRequired: false } : {}),
                ...(result.preview ? { preview: result.preview } : {}),
              } : item));
          }
        }
        if (result.stage === 'draft' && ['UNKNOWN', 'FAILED'].includes(result.status)) {
          setRecords(current => current.map(item => item.document.documentId === documentId
            ? { ...item, recoveryRequired: true } : item));
        }
        if (result.status === 'RECEIPT_VERIFIED') installSavedDocument(result.document);
        setNotice({ type: result.status === 'BLOCKED' || result.status === 'FAILED' || result.status === 'UNKNOWN' ? 'error' : 'info',
        text: result.error || (result.status === 'WAITING_CONFIRMATION'
          ? '초안과 서버 검증을 마쳤습니다. 입고 등록은 실행하지 않았습니다. 범위·사유를 확인하고 명시적으로 승인하세요.'
          : result.status === 'RECEIPT_VERIFIED' ? '기존 입고를 재조회해 확인했습니다. 새 입고는 실행하지 않았습니다.' : `자동 준비 상태: ${result.status}`) });
      }
    } catch (error) {
      if (isCurrent()) setNotice({ type: 'error', text: error.message });
    } finally {
      if (workflowLockRef.current?.generation === generation) { workflowLockRef.current = null; setBusy(''); }
    }
  }

  async function readDocument(documentId) {
    const data = await readJson(await fetch(`/api/import/receipts/${documentId}`, { credentials: 'same-origin', cache: 'no-store' }));
    const loaded = responseDocument(data);
    if (!loaded) throw new Error('저장 문서를 다시 불러오지 못했습니다.');
    return normalizeReceiptDocument(loaded);
  }

  function openCommit() {
    if (!canCommitReceipt(selected)) return;
    setConfirmReason(''); setConfirmOpen(true); setTimeout(() => reasonRef.current?.focus(), 0);
  }

  function closeCommit() {
    setConfirmOpen(false); setTimeout(() => confirmButtonRef.current?.focus(), 0);
  }

  function clearPendingCommit(documentId, { invalidatePreview = false } = {}) {
    storePendingOperation(documentId, null);
    setRecords(current => current.map(record => record.document.documentId === documentId
      ? { ...record, pendingOperation: null, preview: invalidatePreview ? null : record.preview } : record));
  }

  function setManualStage(documentId, id, status, message) {
    setRecords(current => current.map(record => record.document.documentId === documentId
      ? { ...record, stageProgress: { ...(record.stageProgress || {}), [id]: { id, status, message, at: new Date().toISOString(),
        documentId, revision: record.document.revision } } } : record));
  }

  async function acceptCommitResult(pending, result, message, isCurrent = () => true) {
    const expected = records.find(record => record.document.documentId === pending.documentId)?.document;
    if (!expected) throw new Error('등록 작업의 원본 문서가 없어 readback 신원을 확인할 수 없습니다.');
    if (isCurrent()) setRecords(current => current.map(record => record.document.documentId === pending.documentId
      ? { ...record, stageProgress: { ...(record.stageProgress || {}),
        receipt: { id: 'receipt', status: 'passed', message: 'ERP 등록 응답 확인', at: new Date().toISOString() },
        receiptVerify: { id: 'receiptVerify', status: 'running', message: '서버 문서·operation 재조회 중', at: new Date().toISOString() },
      } } : record));
    try {
      const fresh = await readDocument(pending.documentId);
      const verified = verifyReceiptDocument(fresh, { ...expected, operationId: pending.operationId, warehouseKey: result.warehouseKey });
      if (verified.operation.operationId !== pending.operationId || verified.warehouseKey !== Number(result.warehouseKey)) {
        throw new Error('재조회 operationId 또는 WarehouseKey가 현재 요청 결과와 일치하지 않습니다.');
      }
      if (!isCurrent()) return;
      installSavedDocument(fresh);
      clearPendingCommit(pending.documentId);
      setOperationResult(result);
      setNotice({ type: 'success', text: `${message} WarehouseKey ${result.warehouseKey ?? '응답 누락'} · 원가 ${result.costStatus || '상태 미확인'}` });
    } catch (refreshError) {
      if (!isCurrent()) {
        refreshError.staleWorkflowResponse = true;
        throw refreshError;
      }
      setRecords(current => current.map(record => record.document.documentId === pending.documentId
        ? { ...record, stageProgress: { ...(record.stageProgress || {}),
          receipt: { id: 'receipt', status: 'passed', message: 'ERP 등록 응답 확인', at: new Date().toISOString() },
          receiptVerify: { id: 'receiptVerify', status: 'failed', message: refreshError.message, at: new Date().toISOString() },
        } } : record));
      setNotice({ type: 'error', text: `입고 응답은 받았지만 새 문서 재조회 신원 검증에 실패했습니다. pending은 유지했습니다. 재등록하지 말고 ‘입고 readback만 재조회’를 사용하세요: ${refreshError.message}` });
      refreshError.receiptReadbackFailure = true;
      throw refreshError;
    }
  }

  function handleCommitFailure(pending, error) {
    if (error.receiptReadbackFailure || error.staleWorkflowResponse) return;
    if (!pending) {
      setNotice({ type: 'error', text: error.message });
      return;
    }
    if (pending && isVerifiedReceiptCommitRejection(error)) {
      clearPendingCommit(pending.documentId, { invalidatePreview: true });
      setManualStage(pending.documentId, 'receipt', 'failed', error.message);
      setNotice({ type: 'error', text: `${error.message} 서버가 rollback을 확인해 같은 초안을 유지하고 미리보기를 무효화했습니다.` });
      return;
    }
    setManualStage(pending.documentId, 'receipt', 'unknown', 'operation 상태를 같은 ID로 복구해야 합니다. 새 등록은 시작하지 않습니다.');
    setNotice({ type: 'error', text: `${error.message} 결과가 확정되지 않아 원래 요청 전체와 같은 operationId를 보존했습니다. 새 ID로 자동 재시도하지 않습니다.` });
  }

  async function commitReceipt() {
    const reason = confirmReason.trim();
    if (!selected || !reason || !canCommitReceipt(selected) || busy || workflowLockRef.current) return;
    const generation = workflowGenerationRef.current;
    const documentId = selected.document.documentId;
    const isCurrent = () => workflowGenerationRef.current === generation && selectedIdRef.current === documentId;
    workflowLockRef.current = { kind: 'manual-commit', documentId: selected.document.documentId };
    let operation;
    try {
      const operationId = newUuid();
      const receiptPartId = receiptPartIdForCommit(selected.document, newUuid);
      operation = buildReceiptCommitPending({
        document: selected.document, preview: selected.preview, reason, operationId, receiptPartId,
      });
      storePendingOperation(selected.document.documentId, operation);
      setRecords(current => current.map(record => record.document.documentId === selected.document.documentId
        ? { ...record, pendingOperation: operation } : record));
      setConfirmOpen(false); setBusy('commit'); setNotice(null);
      setManualStage(selected.document.documentId, 'receipt', 'running', '명시적으로 승인된 입고 등록 요청 진행 중');
      const data = await submitReceiptCommit(operation);
      if (!data.result) {
        const error = new Error('등록 결과 readback이 비어 있습니다.');
        error.resultUnknown = true;
        throw error;
      }
      await acceptCommitResult(operation, data.result, '서버 등록 결과와 현재 문서를 다시 확인했습니다.', isCurrent);
    } catch (error) {
      if (!isCurrent()) error.staleWorkflowResponse = true;
      handleCommitFailure(operation, error);
    } finally {
      workflowLockRef.current = null;
      setBusy('');
    }
  }

  async function retryPendingOperation() {
    const pending = selected?.pendingOperation;
    if (!pending || busy || workflowLockRef.current) return;
    const generation = workflowGenerationRef.current;
    const documentId = selected.document.documentId;
    const isCurrent = () => workflowGenerationRef.current === generation && selectedIdRef.current === documentId;
    workflowLockRef.current = { kind: 'operation-recovery', documentId: selected.document.documentId };
    setBusy('operation-retry'); setNotice(null);
    setManualStage(selected.document.documentId, 'receiptVerify', 'running', '같은 operation 상태를 조회 중');
    try {
      const data = await readJson(await fetch(`/api/import/receipts/operations/${pending.operationId}`, {
        credentials: 'same-origin', cache: 'no-store',
      }));
      if (!isCurrent()) return;
      if (data.operation) {
        const result = { ...data.operation, ...(data.operation.result || {}) };
        const status = String(result.status || '').toUpperCase();
        if (['COMMITTED', 'SUCCEEDED', 'SUCCESS'].includes(status)) {
          await acceptCommitResult(pending, result, '같은 작업의 완료 상태와 현재 문서를 확인했습니다.', isCurrent);
        } else if (['FAILED', 'ROLLED_BACK'].includes(status)) {
          clearPendingCommit(pending.documentId, { invalidatePreview: true });
          setManualStage(pending.documentId, 'receipt', 'failed', `같은 작업이 ${status}로 종료됨`);
          setNotice({ type: 'error', text: `같은 작업이 ${status}로 종료되어 pending을 해제하고 미리보기를 무효화했습니다.` });
        } else {
          setNotice({ type: 'info', text: `같은 작업 상태가 ${result.status || '확인 중'}이므로 요청을 다시 보내지 않았습니다.` });
        }
        return;
      }
      if (!isCurrent()) return;
      const retried = await submitReceiptCommit(pending);
      if (!retried.result) {
        const error = new Error('같은 작업 재시도 결과 readback이 비어 있습니다.');
        error.resultUnknown = true;
        throw error;
      }
      await acceptCommitResult(pending, retried.result, '저장해 둔 동일 요청으로 작업을 다시 확인했습니다.', isCurrent);
    } catch (error) {
      if (!isCurrent()) error.staleWorkflowResponse = true;
      handleCommitFailure(pending, error);
    } finally {
      workflowLockRef.current = null;
      setBusy('');
    }
  }

  async function retryReceiptReadback() {
    const pending = selected?.pendingOperation;
    if (!pending || busy || workflowLockRef.current) return;
    const generation = workflowGenerationRef.current;
    const documentId = selected.document.documentId;
    const isCurrent = () => workflowGenerationRef.current === generation && selectedIdRef.current === documentId;
    workflowLockRef.current = { kind: 'receipt-readback', documentId: pending.documentId };
    setBusy('receipt-readback');
    try {
      const expected = selected.document;
      const fresh = await readDocument(pending.documentId);
      const verified = verifyReceiptDocument(fresh, { ...expected, operationId: pending.operationId });
      if (verified.operation.operationId !== pending.operationId) throw new Error('재조회된 operationId가 대기 작업과 다릅니다.');
      if (!isCurrent()) return;
      installSavedDocument(fresh);
      clearPendingCommit(pending.documentId);
      setNotice({ type: 'success', text: `입고 readback만 다시 확인했습니다. WarehouseKey ${verified.warehouseKey}. 등록 요청은 보내지 않았습니다.` });
    } catch (error) {
      if (!isCurrent()) return;
      setRecords(current => current.map(record => record.document.documentId === pending.documentId
        ? { ...record, stageProgress: { ...(record.stageProgress || {}), receipt: { id: 'receipt', status: 'passed', message: '기존 등록 응답 확인', at: new Date().toISOString() },
          receiptVerify: { id: 'receiptVerify', status: 'failed', message: error.message, at: new Date().toISOString() } } } : record));
      setNotice({ type: 'error', text: `입고 등록을 다시 보내지 않았습니다. readback 확인 실패, pending 유지: ${error.message}` });
    } finally { workflowLockRef.current = null; setBusy(''); }
  }

  async function copyBrief() {
    const value = buildReceiptIssueBrief(documentValue, preview);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (_) {
      copyRef.current?.select();
      setCopied(false);
    }
  }

  async function refreshAfterCostSave() {
    const documentId = documentValue?.documentId;
    if (!documentId) return;
    const generation = workflowGenerationRef.current;
    const isCurrent = () => workflowGenerationRef.current === generation && selectedIdRef.current === documentId;
    setBusy('cost-refresh');
    try {
      const refreshed = await readDocument(documentId);
      if (!isCurrent()) return;
      installSavedDocument(refreshed);
      setNotice({ type: 'success', text: `원가 저장 후 문서를 갱신했습니다. 원가 상태 ${refreshed.costStatus || '확인 필요'}` });
    } catch (error) {
      if (isCurrent()) setNotice({ type: 'error', text: `원가는 저장됐지만 현재 문서 갱신에 실패했습니다: ${error.message}` });
    } finally {
      setBusy('');
    }
  }

  function submitSavedScope(event) {
    event.preventDefault();
    setBrowseScope({ orderYear: browseYear.trim(), orderWeek: browseWeek.trim() });
  }

  function renderSavedDocuments(includeHistory = false) {
    return <section className={styles.saved} aria-label="같은 연도 차수 저장 문서">
      <header><div><strong>같은 연도·세부차수 저장 문서</strong><span>{scopeYear || '연도 미입력'} · {scopeWeek || '차수 미입력'}</span></div>{savedError && <span className={styles.inlineError}>{savedError}</span>}</header>
      <div className={styles.savedList}>{savedDocuments.length === 0 ? <span className={styles.muted}>조회 결과 없음</span> : savedDocuments.map(item => <button type="button" key={item.documentId} onClick={() => loadDocument(item.documentId)} disabled={Boolean(busy)}>
        <strong>{item.invoiceNo || '번호 없음'}</strong><span>{item.farmName || item.reviewedMetadata?.farmName || '농장 미선택'}</span><small>rev {item.revision} · {item.receiptStatus || 'DRAFT'}</small>
      </button>)}</div>
      {includeHistory && documentValue?.history?.length > 0 && <details><summary>선택 문서 이력 {documentValue.history.length}건</summary><ol>{documentValue.history.map((entry, index) => <li key={entry.historyId || `${entry.revision}-${index}`}>{entry.action || 'UPDATE'} · revision {entry.revision ?? '—'} · {entry.createdAt || entry.at || ''}</li>)}</ol></details>}
    </section>;
  }

  if (sourceState.busy) return <section className={styles.root} aria-label="인보이스 입고 작업대"><p role="status">원본 파일 SHA-256과 입고 초안을 준비하는 중입니다…</p></section>;
  if (!selected || !documentValue) return <section className={styles.root} aria-label="인보이스 입고 작업대" data-testid="invoice-receipt-workbench">
    <header className={styles.heading}><div><span className={styles.eyebrow}>CONNECTED RECEIPT WORKBENCH</span><h2>저장 인보이스 입고 문서</h2><p>파일을 다시 올리지 않아도 저장된 문서를 연도와 세부차수로 찾아 이어서 검토할 수 있습니다.</p></div></header>
    {sourceState.error && <p className={styles.error} role="alert">{sourceState.error}</p>}
    <form className={styles.savedScope} onSubmit={submitSavedScope} aria-label="저장 인보이스 검색">
      <Field label="저장 연도"><input value={browseYear} inputMode="numeric" placeholder="예: 2026" onChange={event => setBrowseYear(event.target.value)} /></Field>
      <Field label="저장 세부차수"><input value={browseWeek} placeholder="예: 41-01" onChange={event => setBrowseWeek(event.target.value)} /></Field>
      <button type="submit" disabled={!browseYear.trim() || !browseWeek.trim() || Boolean(busy)}>{busy === 'load' ? '문서 불러오는 중…' : '저장 문서 조회'}</button>
    </form>
    {renderSavedDocuments(false)}
  </section>;

  const localWarnings = conversionWarnings(documentValue);
  const mismatchRows = conversionMismatchLines(documentValue);
  const canPreview = !selected.dirty && documentValue.revision != null && localWarnings.length === 0
    && unresolvedConversionMismatchLines(documentValue).length === 0 && !selected.pendingOperation;
  const issueBrief = buildReceiptIssueBrief(documentValue, preview);
  const reconciliationRows = preview?.reconciliation?.rows || [];
  const reconciliationByLine = new Map(reconciliationRows.map(row => [row.lineId, row]));
  const committedOperations = (documentValue.operations || []).filter(operation => operation.status === 'COMMITTED');
  const committedLineIds = new Set(committedOperations.flatMap(operation => {
    const mappings = operation?.result?.lineMappings || operation?.lineMappings || [];
    return mappings.map(mapping => mapping.lineId).filter(Boolean);
  }));
  const receiptReadbackPassed = selected.stageProgress?.receiptVerify?.status === 'passed';
  const currentRevisionCommitted = !selected.dirty && receiptReadbackPassed
    && documentValue.receiptStatus === 'COMMITTED'
    && committedOperations.some(operation => Number(operation.documentRevision) === Number(documentValue.revision));
  const costIsStale = documentValue.costStatus === 'STALE'
    || (committedOperations.length > 0 && (selected.dirty || !currentRevisionCommitted));

  return <section className={styles.root} aria-label="인보이스 입고 작업대" data-testid="invoice-receipt-workbench">
    <header className={styles.heading}>
      <div><span className={styles.eyebrow}>CONNECTED RECEIPT WORKBENCH</span><h2>인보이스 입고 검토·등록</h2>
        <p>분석 완료는 입고 완료가 아닙니다. 초안 저장 → 서버 미리보기 → 명시 확인 후에만 등록됩니다.</p></div>
      <div className={styles.hash} title={documentValue.sourceHash}>원본 SHA-256 <code>{documentValue.sourceHash.slice(0, 12)}…</code></div>
    </header>

    <div className={styles.documentTabs} role="tablist" aria-label="원본 인보이스">
      {records.map((record, index) => <button type="button" role="tab" aria-selected={record.document.documentId === selected.document.documentId}
        key={record.document.documentId} disabled={Boolean(busy)} onClick={() => {
          workflowGenerationRef.current += 1;
          workflowLockRef.current = null;
          setSelectedId(record.document.documentId);
        }}>
        {record.document.invoiceNo || `인보이스 ${index + 1}`} {record.dirty ? '•' : ''}
      </button>)}
    </div>

    {notice && <p className={notice.type === 'error' ? styles.error : notice.type === 'success' ? styles.success : styles.info}
      role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    {localWarnings.map(warning => <p className={styles.warning} role="alert" key={warning}>{warning}</p>)}

    <section className={styles.stagePanel} aria-label="문서별 독립 단계 진행" aria-live="polite">
      <header><strong>문서 단계</strong><span>{documentValue.documentId} · {documentValue.orderYear || '연도 미입력'} / {documentValue.orderWeek || '차수 미입력'} · revision {documentValue.revision ?? '미저장'} · {documentValue.sourceHash?.slice(0, 12) || 'hash 없음'}</span></header>
      <div className={styles.stageGrid}>{WORKFLOW_STAGES.map(([id, label]) => {
        const stage = selected.stageProgress?.[id] || { status: 'waiting' };
        return <div className={styles.stageCard} data-status={stage.status || 'waiting'} key={id}>
          <strong>{label}</strong><span>{stage.displayStatus || ({ waiting: '대기', running: '진행 중', passed: '통과', blocked: '차단', failed: '실패', unknown: '확인 불가' })[stage.status] || '대기'}</span>
          {stage.message && <small>{stage.message}</small>}
        </div>;
      })}</div>
      <small className={styles.scopeHint}>자동 실행 범위: 선택 문서 1건 · sourceHash/revision/연도/차수 고정 · 입고와 원가 승인은 별도 확인</small>
    </section>

    <fieldset disabled={Boolean(busy)} className={styles.editFieldset}>
    {mismatchRows.length > 0 && <section className={styles.conversionReview} aria-label="국가별 패킹 변환 수량 차이 검토">
      <header><strong>원문 수량과 국가별 변환 대조</strong><span>각 행을 비교하고 실제 입고 수량을 입력한 뒤 행별로 확인하세요.</span></header>
      <div className={styles.conversionReviewRows}>{mismatchRows.map(line => {
        const evidence = line.sourceEvidence.conversionValidation;
        const quantityField = RECEIPT_QUANTITY_FIELDS.has(evidence.quantityField) ? evidence.quantityField : null;
        const quantityLabel = quantityField === 'boxQuantity' ? '박스' : quantityField === 'bunchQuantity' ? '단' : quantityField === 'stemQuantity' ? '송이' : evidence.quantityField || '수량';
        return <div className={styles.conversionReviewRow} key={line.lineId}>
          <div className={styles.conversionReviewIdentity}><strong>{line.lineNo}행 · {line.originalName || '원문 품목 미확인'}</strong>
            <small>{evidence.quantityField || '수량'} · 문서 집계 차이</small></div>
          <div className={styles.conversionReviewEvidence}>{(evidence.differences || []).map((difference, index) => <span key={`${difference.field || 'quantity'}-${index}`}>
            원문 {difference.field || quantityLabel}: <b>{displayNumber(difference.sourceValue)}</b> · 변환: <b>{displayNumber(difference.generatedValue)}</b>
          </span>)}
            {!evidence.differences?.length && <span>원문 합계 <b>{displayNumber(evidence.sourceTotal)}</b> · 변환 합계 <b>{displayNumber(evidence.generatedTotal)}</b></span>}
          </div>
          {quantityField ? <Field label={`입고 ${quantityLabel} 직접 입력`}><NumberInput label={`${line.lineNo}행 입고 ${quantityLabel} 직접 입력`}
            value={line[quantityField]} onChange={value => updateLine(line.lineId, quantityField, value)} /></Field>
            : <p className={styles.conversionReviewError}>수량 필드 계약을 확인할 수 없어 저장할 수 없습니다. 원본 분석을 다시 확인하세요.</p>}
          <label className={styles.conversionConfirm}><input type="checkbox" checked={line.reviewed?.conversionConfirmed === true}
            disabled={!quantityField || nullableNumber(line[quantityField]) == null} onChange={event => confirmConversionLine(line.lineId, event.target.checked)} />
            <span>현재 입력 수량 유지·차이 검토 확인</span></label>
        </div>;
      })}</div>
      <small>확인한 행의 mismatch 경고만 해소됩니다. GW·CW·잘림 등 다른 원문 경고는 별도 검토 전까지 유지됩니다.</small>
    </section>}
    <div className={styles.metadata}>
      <Field label="입고 연도"><input value={documentValue.orderYear ?? ''} inputMode="numeric" placeholder="예: 2026" onChange={event => updateDocumentField('orderYear', event.target.value)} /></Field>
      <Field label="세부차수"><input value={documentValue.orderWeek ?? ''} placeholder="예: 41-01" onChange={event => updateDocumentField('orderWeek', event.target.value)} /></Field>
      <Field label="인보이스 번호"><input value={documentValue.invoiceNo ?? ''} onChange={event => updateDocumentField('invoiceNo', event.target.value)} /></Field>
      <Field label="인보이스 연도"><input value={documentValue.invoiceYear ?? ''} inputMode="numeric" onChange={event => updateDocumentField('invoiceYear', event.target.value)} /></Field>
      <Field label="입고일"><input type="date" value={documentValue.reviewedMetadata.inputDate || ''} onChange={event => updateMetadata('inputDate', event.target.value)} /></Field>
      <Field label="인보이스일"><input type="date" value={documentValue.reviewedMetadata.invoiceDate || ''} onChange={event => updateMetadata('invoiceDate', event.target.value)} /></Field>
      <Field label="운송 방식"><select value={documentValue.reviewedMetadata.transportMode || ''} onChange={event => updateMetadata('transportMode', event.target.value)}>
        <option value="">선택 필요</option><option value="AIR">AIR</option><option value="SEA">SEA</option><option value="OTHER">OTHER</option>
      </select></Field>
      <Field label="AWB"><input value={documentValue.reviewedMetadata.awb || ''} onChange={event => updateMetadata('awb', event.target.value)} /></Field>
      <Field label="GW"><NumberInput label="GW" value={documentValue.reviewedMetadata.gw} onChange={value => updateMetadata('gw', value)} /></Field>
      <Field label="CW"><NumberInput label="CW" value={documentValue.reviewedMetadata.cw} onChange={value => updateMetadata('cw', value)} /></Field>
      <Field label="운임 통화"><input value={documentValue.reviewedMetadata.freightCurrency || ''} maxLength={3} placeholder="명시 필요" onChange={event => updateFreightCurrency(event.target.value)} /></Field>
      <Field label="운송·부대비 총액 (원가)"><NumberInput label="운송·부대비 총액 원가" value={documentValue.reviewedMetadata.costInputs?.freight?.amount} onChange={value => updateCostInput('freight', value)} /></Field>
      {documentValue.reviewedMetadata.freightCurrency === 'USD' ? <>
        <Field label="ERP 헤더 FreightRate (USD/kg)"><NumberInput label="ERP 헤더 FreightRate USD/kg" value={documentValue.reviewedMetadata.freightRate} onChange={value => updateMetadata('freightRate', value)} /></Field>
        <Field label="ERP 헤더 문서비 (USD)"><NumberInput label="ERP 헤더 문서비 USD" value={documentValue.reviewedMetadata.docFee} onChange={value => updateMetadata('docFee', value)} /></Field>
      </> : <>
        <Field label="비USD 문서비 원가"><NumberInput label="비USD 문서비 원가" value={documentValue.reviewedMetadata.costInputs?.docFee?.amount} onChange={value => updateCostInput('docFee', value)} /></Field>
      </>}
      <Field label="농장 검색" wide><input value={farmQuery} placeholder="기존 Farm 마스터 검색" onChange={event => setFarmQuery(event.target.value)} /></Field>
      <Field label={farmBusy ? '농장 검색 중…' : '농장 선택'} wide><select value={documentValue.farmKey ?? ''} onChange={event => {
        const key = Number(event.target.value) || null;
        const farm = farmOptions.find(option => Number(option.FarmKey) === key);
        updateSelected(document => ({ ...document, farmKey: key, reviewedMetadata: { ...document.reviewedMetadata, farmName: farm?.FarmName || '' } }));
      }}><option value="">선택 필요</option>{documentValue.farmKey && !farmOptions.some(farm => Number(farm.FarmKey) === Number(documentValue.farmKey))
        ? <option value={documentValue.farmKey}>{documentValue.reviewedMetadata.farmName || '저장 농장'} (#{documentValue.farmKey})</option> : null}
      {farmOptions.map(farm => <option key={farm.FarmKey} value={farm.FarmKey}>{farm.FarmName} (#{farm.FarmKey})</option>)}</select></Field>
      <Field label="입고 메모" wide><input value={documentValue.reviewedMetadata.receiptNotes || ''} onChange={event => updateMetadata('receiptNotes', event.target.value)} /></Field>
    </div>

    <div className={styles.actionBar}>
      <button type="button" className={styles.primary} onClick={runAutomaticPreparation} disabled={Boolean(busy) || Boolean(selected.pendingOperation) || Boolean(selected.recoveryRequired)}>
        {busy === 'auto-workflow' ? '단계 검증 중…' : '자동 검증·계속'}
      </button>
      <button type="button" className={styles.primary} onClick={saveDraft} disabled={Boolean(busy) || Boolean(selected.recoveryRequired)}>{busy === 'save' ? '초안 저장 중…' : documentValue.revision == null ? '초안 저장' : '변경 초안 저장'}</button>
      <button type="button" onClick={requestPreview} disabled={!canPreview || Boolean(busy)}>{busy === 'preview' ? '미리보기 검증 중…' : '서버 미리보기'}</button>
      <button ref={confirmButtonRef} type="button" className={styles.danger} onClick={openCommit} disabled={!canCommitReceipt(selected) || Boolean(busy)}>ERP 입고 등록 확인</button>
      {selected.recoveryRequired && <button type="button" onClick={() => loadDocument(documentValue.documentId)} disabled={Boolean(busy)}>같은 문서 다시 불러오기</button>}
      {selected.pendingOperation && selected.stageProgress?.receiptVerify?.status === 'failed' && <button type="button" onClick={retryReceiptReadback} disabled={Boolean(busy)}>
        {busy === 'receipt-readback' ? '입고 readback 재조회 중…' : '입고 readback만 재조회'}
      </button>}
      {selected.pendingOperation && <button type="button" onClick={retryPendingOperation} disabled={Boolean(busy)}>{busy === 'operation-retry' ? '같은 작업 확인 중…' : '같은 작업 다시 확인·재시도'}</button>}
      <button type="button" onClick={() => { setCopyOpen(true); setCopied(false); }} disabled={Boolean(busy)}>특이사항 복사</button>
      <span className={styles.state}>{selected.dirty ? '저장되지 않은 변경 있음' : `저장됨 · revision ${documentValue.revision}`}</span>
    </div>

    {documentValue.receiptStatus === 'COMMITTED' && <p className={styles.committed}>등록 문서 · WarehouseKey {documentValue.warehouseKey ?? '확인 중'}{selected.dirty ? ' · 편집 초안은 저장 API 처리 전까지 기존 입고를 바꾸지 않습니다.' : ''}</p>}
    {operationResult && <div className={styles.resultReadback}><strong>작업 readback</strong><span>상태 {operationResult.status || 'SUCCESS'}</span><span>WarehouseKey {operationResult.warehouseKey ?? '—'}</span><span>원가 {operationResult.costStatus || '—'}</span></div>}

    <div className={styles.workspace}>
      <div className={styles.sheetScroll} tabIndex={0} role="region" aria-label="입고 검토 행 표">
        <table className={styles.sheet}>
          <thead><tr><th>#</th><th>원문 품목</th><th>전산 품목</th><th>박스</th><th>단</th><th>송이</th><th>가격단위</th><th>단가</th><th>통화</th><th>금액</th><th>대조</th></tr></thead>
          <tbody>{documentValue.lines.map(line => {
            const product = productByKey.get(Number(line.prodKey));
            const committedProduct = committedLineIds.has(line.lineId);
            const productSearch = line.productSearch ?? productLabel(product);
            const rowIssues = issuesByLine.get(line.lineId) || [];
            const reconciliation = reconciliationByLine.get(line.lineId);
            return <tr key={line.lineId} ref={element => element ? rowRefs.current.set(line.lineId, element) : rowRefs.current.delete(line.lineId)} className={rowIssues.length ? styles.issueRow : ''}>
              <td>{line.lineNo}</td><td title={line.originalName}>{line.originalName || '원문 미확인'}{line.lengthText ? <small>{line.lengthText}</small> : null}</td>
              <td>{committedProduct
                ? <div className={styles.productLock}><strong>{productLabel(product) || `ProdKey #${line.prodKey}`}</strong><small>확정 입고 행의 품목은 변경할 수 없습니다. 수량 0 취소 후 새 행을 사용하세요.</small></div>
                : <div className={styles.productPicker}><input type="search" list="invoice-receipt-products" aria-label={`${line.lineNo}행 전산 품목 검색`}
                  placeholder="품목명 또는 코드 검색" value={productSearch} onChange={event => updateLineProduct(line.lineId, event.target.value)} />
                  {!product && <small className={styles.required}>목록에서 전산 품목을 선택하세요.</small>}</div>}</td>
              {['boxQuantity', 'bunchQuantity', 'stemQuantity'].map((field, index) => <td key={field}><NumberInput className={styles.cellInput} label={`${line.lineNo}행 ${['박스','단','송이'][index]}`} value={line[field]} onChange={value => updateLine(line.lineId, field, value)} /></td>)}
              <td><select className={styles.cellSelect} value={line.priceUnit || ''} onChange={event => updateLine(line.lineId, 'priceUnit', event.target.value)}><option value="">선택</option><option value="박스">박스</option><option value="단">단</option><option value="송이">송이</option></select></td>
              <td><NumberInput className={styles.cellInput} label={`${line.lineNo}행 단가`} value={line.unitPrice} onChange={value => updateLine(line.lineId, 'unitPrice', value)} /></td>
              <td><input className={styles.currencyInput} aria-label={`${line.lineNo}행 통화`} maxLength={3} value={line.currency || ''} onChange={event => updateLine(line.lineId, 'currency', event.target.value.toUpperCase())} /></td>
              <td><NumberInput className={styles.cellInput} label={`${line.lineNo}행 금액`} value={line.lineAmount} onChange={value => updateLine(line.lineId, 'lineAmount', value)} /></td>
              <td>{rowIssues.length ? <button type="button" className={styles.issueBadge} onClick={() => rowRefs.current.get(line.lineId)?.scrollIntoView({ block: 'center' })}>{rowIssues.length}건</button>
                : reconciliation ? <span>{reconciliation.status || reconciliation.result || '대조됨'}</span> : <span className={styles.muted}>미리보기 전</span>}</td>
            </tr>;
          })}</tbody>
        </table>
        <datalist id="invoice-receipt-products">{selectableProducts.map(product => <option key={product.ProdKey} value={productLabel(product)} />)}</datalist>
      </div>

      <aside className={styles.issues} aria-label="미리보기 이슈">
        <div className={styles.issueHeader}><div><strong>서버 이슈</strong><span>{issues.length}건</span></div><small>행을 누르면 표 위치로 이동합니다.</small></div>
        {!preview && <p className={styles.empty}>저장 후 서버 미리보기를 실행하세요.</p>}
        {preview && !issues.length && <p className={styles.clear}>이슈 0건 · canCommit {String(preview.canCommit)}</p>}
        {issues.map((issue, index) => {
          const lineId = issueLineId(issue);
          const line = documentValue.lines.find(item => item.lineId === lineId);
          return <button type="button" className={styles.issueCard} key={`${lineId || 'global'}-${index}`} onClick={() => lineId && rowRefs.current.get(lineId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            <span>{line ? `${line.lineNo}행 · ${line.originalName}` : '문서 범위'}</span><strong>{issueText(issue)}</strong>{typeof issue === 'object' && issue?.resolution ? <small>{issue.resolution}</small> : null}
          </button>;
        })}
        {preview && <div className={styles.previewMeta}><span>eligibility</span><strong>{preview.eligibility?.allowed === true ? '허용' : preview.eligibility?.allowed === false ? '차단' : '서버 결과 확인'}</strong><span>원가</span><strong>{preview.cost?.status || preview.costStatus || '서버 결과 확인'}</strong><span>문서 revision</span><strong>{preview.documentRevision ?? '—'}</strong></div>}
      </aside>
    </div>
    </fieldset>

    {renderSavedDocuments(true)}

    {currentRevisionCommitted
      ? <InvoiceReceiptCostReview document={documentValue} onSaved={refreshAfterCostSave}
        autoProcess={receiptReadbackPassed} onStageChange={onCostStageChange} />
      : costIsStale
        ? <section className={styles.costStale} role="alert"><strong>도착원가 STALE</strong><span>입고 확정 후 문서가 편집되어 이전 원가는 현재 revision에 적용되지 않습니다. 수정 입고를 다시 preview·commit한 뒤 원가를 재검토하세요.</span></section>
        : <section className={styles.costPending} role="status"><strong>도착원가 PENDING</strong><span>현재 문서 revision의 입고 등록이 완료되면 실제 입고량 원가 검토를 시작할 수 있습니다.</span></section>}

    {copyOpen && <Modal title="특이사항 복사" onClose={() => setCopyOpen(false)} initialFocusRef={copyRef} footer={<><button type="button" onClick={() => setCopyOpen(false)}>닫기</button><button type="button" className={styles.primary} onClick={copyBrief}>{copied ? '복사됨' : '클립보드 복사'}</button></>}>
      <p>서버가 반환한 이슈 사실만 포함합니다. HTML로 해석하지 않는 안전한 텍스트입니다.</p>
      <textarea ref={copyRef} readOnly value={issueBrief} rows={Math.min(16, Math.max(5, issueBrief.split('\n').length + 1))} />
    </Modal>}

    {confirmOpen && <Modal title="ERP 입고 등록 최종 확인" onClose={closeCommit} initialFocusRef={reasonRef} footer={<><button type="button" onClick={closeCommit}>취소</button><button type="button" className={styles.danger} onClick={commitReceipt} disabled={!confirmReason.trim()}>이 범위로 등록</button></>}>
      <div className={styles.confirmScope}><strong>{documentValue.orderYear} / {documentValue.orderWeek}</strong><span>인보이스 {documentValue.invoiceNo || '미입력'}</span><span>농장 {documentValue.reviewedMetadata.farmName || '미선택'} (#{documentValue.farmKey || '—'})</span><span>행 {documentValue.lines.length}개</span><span>baseline {preview?.baselineDigest?.slice(0, 16) || '누락'}…</span><span>이슈 {issues.length}건 · canCommit {String(preview?.canCommit)}</span></div>
      <p className={styles.confirmWarning}>등록은 Warehouse와 재고에 영향을 줍니다. 이 확인은 초안 저장이나 분석 완료 확인이 아닙니다.</p>
      <section className={styles.confirmLines} aria-label="ERP 저장수량 확인">
        <header><strong>ERP 저장수량</strong><span>재고 반영은 원시 박스·단·송이가 아니라 서버 미리보기의 아래 수량·단위를 사용합니다.</span></header>
        <div>{(preview?.lines || []).map(output => {
          const sourceLine = documentValue.lines.find(line => line.lineId === output.lineId);
          return <div className={styles.confirmLine} key={output.lineId}>
            <span>{sourceLine?.lineNo ?? '—'}행 · {sourceLine?.originalName || output.prodName || '원문 미확인'}</span>
            <span>{output.prodName || productByKey.get(Number(output.prodKey))?.ProdName || `ProdKey #${output.prodKey ?? '—'}`}</span>
            <strong>{displayNumber(output.outQuantity)} {output.outUnit || '단위 미확인'}</strong>
          </div>;
        })}</div>
      </section>
      <label className={styles.reason}><span>등록 사유 (필수)</span><textarea ref={reasonRef} value={confirmReason} onChange={event => setConfirmReason(event.target.value)} rows={4} /></label>
    </Modal>}
  </section>;
}
