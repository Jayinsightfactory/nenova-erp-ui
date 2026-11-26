// PDF·AWB 바로 입고 작업대 — /incoming 메인 진입 + /import/tools 공용.
// [핵심 목적] 인보이스(및 AWB) PDF를 엑셀 변환 없이 눈으로 한 번 검증하고 바로 입고한다.
// 우측 어떤 항목이든 누르면 왼쪽 원본이 해당 쪽으로 이동해 원문 위치를 강조하고, 두 곳을 선으로 잇는다.
// 저장은 기존 POST /api/warehouse(사전 검증 previewOnly → 송장별 본 저장) 한 경로만 사용한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import styles from '../../styles/VisualInboundVerifyWorkbench.module.css';
import VisualInboundPdfPane from './VisualInboundPdfPane.js';
import VisualInboundLeaderLine from './VisualInboundLeaderLine.js';
import { readAwbPdf } from '../../lib/importAwbPdf.js';
import { isAirWaybillDocument, parseSupportAwbDocument } from '../../lib/importAwbFields.js';
import { extractPackingDocument } from '../../lib/importPackingExtractClient.js';
import { parsePackingResponse } from '../../lib/importPackingResponse.js';
import { packingFileReuse } from '../../lib/packingFileReuse.js';
import { packingErpAliases } from '../../lib/importPackingErpMatches.js';
import { packingSourceKey } from '../../lib/importPacking.js';
import { rankProductSuggestions, defaultInvoiceMatchSuggestion } from '../../lib/invoiceMatchAssist.js';
import { findSavedFarmMatch, suggestColombiaPackingDefaults, suggestNewFarmName } from '../../lib/importPackingFarmMatches.js';
import {
  WORKBENCH_COUNTRIES, AWB_COUNTRIES, STATUS, HEADER_FIELDS, blankRow, buildWorkbenchInvoices, normalizeRoundInput, hintsFromFileName,
  reviewInvoice, invoiceStatus, requiredCheckKeys, backSolveRow, suggestReconcileFix, applyReconcileFix, buildWarehouseUploadPayload,
  buildPackingGrid, evidenceTarget, connectorTone, applyExistingReceipts, duplicateRangeLabel, runSequentialUpload, normalizeAwbDocument, round2,
} from '../../lib/visualInboundWorkbench.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const num = value => (value === '' || value == null ? '' : String(value));
const toNumber = value => { const s = String(value ?? '').trim().replace(/,/g, ''); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const fmtMoney = n => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const statusClass = { [STATUS.PENDING]: 'st_pending', [STATUS.WARN]: 'st_warn', [STATUS.VERIFIED]: 'st_verified', [STATUS.UPLOADED]: 'st_uploaded', [STATUS.ERROR]: 'st_error', [STATUS.DUPLICATE]: 'st_duplicate' };

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return { base64: btoa(binary), hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data: data || {} };
}

function CheckToggle({ checked, onToggle, label }) {
  return (
    <button type="button" className={checked ? styles.checkOn : styles.checkOff} aria-pressed={checked} onClick={onToggle}
      title={checked ? `${label} 확인 취소` : `${label} 원문과 같음 — 확인`}>
      {checked ? '확인됨' : '확인'}
    </button>
  );
}

export default function VisualInboundVerifyWorkbench({ open, onClose, onUploaded, entry = 'incoming' }) {
  const rootRef = useRef(null);
  const leftPaneRef = useRef(null);
  const rightPaneRef = useRef(null);
  const highlightRef = useRef(null);
  const dropRef = useRef(null);
  const fileInputRef = useRef(null);
  const openerRef = useRef(null);
  const [docs, setDocs] = useState({ invoice: null, awb: null });
  const [tab, setTab] = useState('invoice');
  const [country, setCountry] = useState('');
  const [roundHint, setRoundHint] = useState('');
  const [analysis, setAnalysis] = useState({ stage: 'idle', message: '' });
  const [drafts, setDrafts] = useState([]);
  const [activeKey, setActiveKey] = useState('');
  const [activeField, setActiveField] = useState('');
  const [target, setTarget] = useState(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [catalog, setCatalog] = useState({ products: [], value: null, revision: 0, loaded: false, error: '' });
  const [farms, setFarms] = useState({ farms: [], value: null, revision: 0, loaded: false, error: '' });
  const [includeAwbFreight, setIncludeAwbFreight] = useState(true);
  const [upload, setUpload] = useState({ busy: false, message: '', progress: '' });
  const [notice, setNotice] = useState('');
  const [farmQuery, setFarmQuery] = useState('');
  const [productQuery, setProductQuery] = useState('');

  const active = drafts.find(d => d.key === activeKey) || drafts[0] || null;
  const locked = active?.upload?.state === 'ok' || Boolean(active?.duplicate);

  // 열기/닫기: 첫 조작부로 초점 이동, 닫으면 호출 버튼으로 복귀, Escape로 닫기.
  useEffect(() => {
    if (!open) return undefined;
    openerRef.current = document.activeElement;
    const timer = setTimeout(() => dropRef.current?.focus(), 30);
    const onKey = event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (event.target?.closest?.('[data-escape-local]')) return;
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(timer); document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function resetSession() {
    const pending = drafts.some(d => d.selected && !d.duplicate && d.upload?.state !== 'ok');
    if (pending && !window.confirm('입고하지 않은 검증 내용이 있습니다. 새 PDF를 넣을까요?')) return;
    setDocs({ invoice: null, awb: null });
    setDrafts([]);
    setActiveKey('');
    setActiveField('');
    setTarget(null);
    setCountry('');
    setRoundHint('');
    setAnalysis({ stage: 'idle', message: '' });
    setUpload({ busy: false, message: '', progress: '' });
    setNotice('');
  }

  function requestClose() {
    const pending = drafts.some(d => d.selected && !d.duplicate && d.upload?.state !== 'ok');
    if (pending && !window.confirm('입고하지 않은 검증 내용이 있습니다. 작업대를 닫을까요?')) return;
    onClose?.();
    setTimeout(() => openerRef.current?.focus?.(), 0);
  }

  // 전산 품목·농장 매칭 자료(팀 공용)
  useEffect(() => {
    if (!open || catalog.loaded) return;
    jsonFetch('/api/import/tools/product-matches').then(({ ok, data }) => setCatalog(ok && data.success
      ? { products: data.products || [], value: data.value, revision: data.revision ?? 0, loaded: true, error: '' }
      : { products: [], value: null, revision: 0, loaded: true, error: data.error || '전산 품목 목록을 불러오지 못했습니다.' }));
    jsonFetch('/api/import/tools/farm-matches').then(({ ok, data }) => setFarms(ok && data.success
      ? { farms: data.farms || [], value: data.value, revision: data.revision ?? 0, loaded: true, error: '' }
      : { farms: [], value: null, revision: 0, loaded: true, error: data.error || '전산 농장 목록을 불러오지 못했습니다.' }));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = useCallback((key, updater) => {
    setDrafts(list => list.map(d => (d.key === key ? { ...updater(d), upload: d.upload?.state === 'error' ? { state: 'idle', warehouseKey: null, error: '' } : d.upload } : d)));
  }, []);
  const setHeader = (field, value) => active && !locked && updateDraft(active.key, d => ({ ...d, header: { ...d.header, [field]: value }, checked: { ...d.checked, [headerCheckKey(field)]: false } }));
  const toggleCheck = key => active && !locked && updateDraft(active.key, d => ({ ...d, checked: { ...d.checked, [key]: !d.checked[key] } }));
  const setRow = (rowId, patch) => active && !locked && updateDraft(active.key, d => ({ ...d, rows: d.rows.map(r => (r.id === rowId ? { ...r, ...patch } : r)), checked: { ...d.checked, [`row:${rowId}`]: false } }));

  // 파일 투입: PDF 여러 개를 한 번에. AWB는 내용으로 자동 분류한다.
  async function acceptFiles(fileList) {
    const files = [...(fileList || [])].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) { setNotice('PDF 파일만 넣을 수 있습니다.'); return; }
    if (files.some(f => f.size > MAX_PDF_BYTES)) { setNotice('PDF는 20MB 이하만 열 수 있습니다.'); return; }
    setNotice('');
    setAnalysis({ stage: 'reading', message: 'PDF를 읽는 중입니다…' });
    const next = { invoice: null, awb: null };
    for (const file of files) {
      const { base64, hash } = await fileToBase64(file);
      const hints = hintsFromFileName(file.name);
      let isAwb = hints.isAwb;
      let local = null;
      try {
        local = await readAwbPdf(base64);
        if (isAirWaybillDocument(local)) isAwb = true;
      } catch { /* 스캔 PDF 등: 파일명 힌트만 사용 */ }
      const entryDoc = { name: file.name, base64, hash, size: file.size, local };
      if (isAwb && !next.awb) next.awb = entryDoc;
      else if (!next.invoice) next.invoice = entryDoc;
      else if (!next.awb) next.awb = entryDoc;
    }
    if (!next.invoice) { setAnalysis({ stage: 'idle', message: '' }); setNotice('인보이스 PDF가 필요합니다. AWB만 넣은 경우 인보이스를 함께 넣으세요.'); return; }
    const hints = hintsFromFileName(next.invoice.name);
    setDocs(next);
    setTab('invoice');
    setDrafts([]);
    setActiveField('');
    setTarget(null);
    setCountry(c => hints.country || c || (next.awb ? 'EC' : ''));
    setRoundHint(hints.round || '');
    setAnalysis({ stage: 'ready', message: '' });
  }

  function awbDocumentFromLocal() {
    if (!docs.awb?.local) return null;
    const parsed = parseSupportAwbDocument(docs.awb.local);
    return parsed?._error ? null : parsed;
  }

  function mergeAwb(aiDoc) {
    const local = awbDocumentFromLocal();
    if (!aiDoc) return local;
    if (!local) return aiDoc;
    const merged = { ...local };
    for (const [k, v] of Object.entries(aiDoc)) if (v != null && v !== '' && k !== 'evidence') merged[k] = v;
    merged.evidence = { ...(local.evidence || {}), ...Object.fromEntries(Object.entries(aiDoc.evidence || {}).filter(([, e]) => e?.quote)) };
    return merged;
  }

  function adoptResult(result, sourceLabel) {
    const awbDocument = mergeAwb(result?.awb_document || null);
    let built = buildWorkbenchInvoices(result, { country, fileHints: { round: roundHint }, awbDocument });
    built = built.map(d => autoMatchDraft(d));
    setDrafts(built);
    setActiveKey(built[0]?.key || '');
    setAnalysis({ stage: 'done', message: `${sourceLabel} · 송장 ${built.length}건 · 모든 값은 원문과 눈으로 확인하세요.` });
    checkExisting(built);
  }

  // 0원: 팀 공용 분석 재사용 → 내 분석 저장본 → (NL·CN) 로컬 판독. 그래도 없으면 명시적 AI 분석 버튼.
  async function analyze({ allowAI = false } = {}) {
    if (!docs.invoice || !country) { setNotice('국가를 선택하세요.'); return; }
    setNotice('');
    try {
      if (!allowAI) {
        setAnalysis({ stage: 'checking', message: '같은 파일의 기존 분석을 찾는 중입니다(비용 없음)…' });
        const history = await jsonFetch('/api/import/tools/upload-history');
        if (history.ok && Array.isArray(history.data.rows)) {
          const reuse = packingFileReuse(history.data.rows, { country, sourceHash: docs.invoice.hash, fileName: docs.invoice.name });
          if (reuse.exact) {
            const record = await jsonFetch(`/api/import/tools/upload-history?id=${encodeURIComponent(reuse.exact.id)}`);
            const result = record.data?.record?.snapshot?.lastExtraction?.result;
            if (record.ok && Array.isArray(result?.invoices) && result.invoices.length) { adoptResult(result, '팀 공용 분석 재사용(비용 없음)'); return; }
          }
        }
        const cached = await jsonFetch('/api/import/tools/parse-pdf', { method: 'POST', body: JSON.stringify({ country, pdfBase64: docs.invoice.base64, ...(docs.awb ? { awbPdfBase64: docs.awb.base64 } : {}), cacheOnly: true }) });
        if (cached.ok && Array.isArray(cached.data?.content)) { adoptResult(parsePackingResponse(cached.data, country).result, '저장된 분석 재사용(비용 없음)'); return; }
        const local = await extractPackingDocument({ country, pdfBase64: docs.invoice.base64, readPdf: readAwbPdf, allowAI: false });
        if (local?.data) { adoptResult(parsePackingResponse(local.data, country).result, '로컬 판독(비용 없음)'); return; }
        setAnalysis({ stage: 'needs-ai', message: '이 양식은 기존 분석이 없습니다. AI 원문 분석(유료)을 누르거나 직접 입력으로 시작하세요.' });
        return;
      }
      setAnalysis({ stage: 'running', message: 'AI 원문 분석 중입니다. 쪽수가 많으면 몇 분 걸립니다…' });
      const extracted = await extractPackingDocument({ country, pdfBase64: docs.invoice.base64, awbPdfBase64: docs.awb && AWB_COUNTRIES.has(country) ? docs.awb.base64 : null,
        readPdf: readAwbPdf, allowAI: true,
        onProgress: p => setAnalysis({ stage: 'running', message: p?.total ? `AI 원문 분석 중 · ${p.completed ?? 0}/${p.total} 구간 · ${p.elapsedSeconds ?? 0}초` : `AI 원문 분석 중 · ${p?.elapsedSeconds ?? 0}초` }) });
      adoptResult(parsePackingResponse(extracted.data, country).result, extracted.source === 'ai' ? 'AI 원문 분석 완료' : '저장된 분석 재사용(비용 없음)');
    } catch (error) {
      setAnalysis({ stage: 'error', message: error?.message || '원문 분석에 실패했습니다. 직접 입력으로 계속할 수 있습니다.', retryJobId: error?.pdfRetryJobId || null });
    }
  }

  // 콜롬비아 구간 분석이 '불명확'으로 끝난 경우: 저장된 구간 응답만 다시 검증(추가 AI 호출 없음).
  async function revalidateSaved() {
    if (!analysis.retryJobId || country !== 'CO') return;
    setAnalysis(a => ({ ...a, stage: 'running', message: '저장된 구간 응답을 다시 검증하는 중입니다(추가 비용 없음)…' }));
    try {
      const extracted = await extractPackingDocument({ country, pdfBase64: docs.invoice.base64, retryJobId: analysis.retryJobId, revalidateOnly: true });
      adoptResult(parsePackingResponse(extracted.data, country).result, '저장 구간 재검증(비용 없음)');
    } catch (error) {
      setAnalysis({ stage: 'error', message: `${error?.message || '재검증에 실패했습니다.'} 직접 입력으로 시작하면 원문을 보며 값을 입력할 수 있습니다.`, retryJobId: error?.pdfRetryJobId || analysis.retryJobId });
    }
  }

  function startManual() {
    const awbDocument = mergeAwb(null);
    const awb = normalizeAwbDocument(awbDocument);
    const [draft] = buildWorkbenchInvoices({ invoices: [{ invoice: '', products: [{ description: '직접 입력 품목' }] }] }, { country, fileHints: { round: roundHint }, awbDocument });
    const rows = draft.rows.map(r => ({ ...r, description: '', evidence: {} }));
    const manual = { ...draft, key: `manual-${Date.now()}`, rows, header: { ...draft.header, awb: awb?.awb || '' } };
    setDrafts([manual]);
    setActiveKey(manual.key);
    setAnalysis({ stage: 'done', message: '직접 입력 모드 · 값을 입력하면 왼쪽 원문에서 같은 글자를 찾아 강조합니다.' });
  }

  // 저장된 품목 별칭 → 고득점 단일 후보 순서로 자동 연결(사람 확인 전에는 확인됨 표시 없음).
  function autoMatchDraft(draft) {
    const products = catalog.products;
    if (!products.length) return draft;
    const aliases = packingErpAliases(draft.header.country, {}, catalog.value, products);
    const rows = draft.rows.map(row => {
      if (row.kind !== 'goods' || row.prodName) return row;
      const alias = aliases[packingSourceKey(row.description)];
      if (alias && !alias.startsWith('\u0000')) {
        const product = products.find(p => p.ProdName === alias && p.country === draft.header.country);
        return { ...row, prodName: alias, prodKey: product?.ProdKey ?? null, matchSource: '저장된 별칭' };
      }
      const suggestion = defaultInvoiceMatchSuggestion(row.description, products, draft.header.country);
      return suggestion ? { ...row, prodName: suggestion.product.ProdName, prodKey: suggestion.product.ProdKey, matchSource: `자동 후보 ${suggestion.score}점` } : row;
    });
    const saved = findSavedFarmMatch(farms.value, draft.header.country, draft.header.supplier);
    const header = saved && !draft.header.farmName
      ? { ...draft.header, farmName: saved.farmName, farmKey: saved.farmKey ?? null, farmSourceWarehouseKey: saved.farmSourceWarehouseKey ?? null, isNewFarm: saved.isNewFarm === true, farmSource: '저장된 농장 연결' }
      : draft.header;
    return { ...draft, rows, header };
  }

  useEffect(() => {
    if (catalog.loaded && farms.loaded && drafts.length) setDrafts(list => list.map(autoMatchDraft));
  }, [catalog.loaded, farms.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkExisting(list = drafts) {
    if (!list.length) return;
    const first = list[0].header;
    const { ok, data } = await jsonFetch('/api/import/tools/check-existing-receipts', { method: 'POST', body: JSON.stringify({
      country: first.country, orderYear: first.orderYear, orderWeek: normalizeRoundInput(first.orderWeek),
      invoices: list.map((d, index) => ({ index, invoice: d.header.invoiceNo, supplier: d.header.farmName || d.header.supplier, awb: d.header.awb, date: d.header.invoiceDate })) }) });
    if (!ok || !data.success) { setNotice(data.error || '기입고 대조에 실패했습니다. 업로드 직전 서버가 다시 검사합니다.'); return; }
    setDrafts(current => {
      const updated = applyExistingReceipts(current, data.matches || []);
      const cur = updated.find(d => d.key === activeKey) || updated[0];
      if (cur?.duplicate) {
        const firstNew = updated.find(d => !d.duplicate && d.upload?.state !== 'ok');
        if (firstNew) setActiveKey(firstNew.key);
      }
      return updated;
    });
  }

  // 우측 항목 포커스 → 왼쪽 원문 이동·강조 요청
  function focusField(fieldKey) {
    if (!active) return;
    setActiveField(fieldKey);
    const request = evidenceTarget(active, fieldKey, { hasAwbDoc: Boolean(docs.awb) });
    if (request) setTarget({ ...request, seq: Date.now() });
  }

  const review = useMemo(() => (active ? reviewInvoice(active) : null), [active]);
  const issuesFor = key => {
    if (!review) return [];
    if (key.startsWith('row:')) { const [, rowId, field] = key.split(':'); return review.issues.filter(i => i.rowId === rowId && (!field || i.field === field)); }
    return review.issues.filter(i => !i.rowId && i.field === key);
  };
  const lineKey = activeField.startsWith('row:') ? activeField.split(':').slice(0, 2).join(':') : activeField;
  const activeCheckKey = activeField.startsWith('row:') ? lineKey : headerCheckKey(activeField);
  const tone = connectorTone({ checked: Boolean(active?.checked?.[activeCheckKey]), issues: activeField ? issuesFor(activeField) : [] });

  const statuses = useMemo(() => drafts.map(d => invoiceStatus(d)), [drafts]);
  const uploadable = drafts.filter(d => d.selected && !d.duplicate && d.upload?.state !== 'ok');
  const allVerified = uploadable.length > 0 && uploadable.every(d => invoiceStatus(d) === STATUS.VERIFIED);
  const failed = drafts.filter(d => d.upload?.state === 'error');
  const dupLabel = duplicateRangeLabel(drafts);

  async function runUpload(onlyFailed = false) {
    const targets = drafts.filter(d => (onlyFailed ? d.upload?.state === 'error' : true));
    if (!targets.length) return;
    if (!onlyFailed && !allVerified) { setNotice('선택한 송장의 모든 항목을 원문과 확인(검증완료)한 뒤 입고하세요.'); return; }
    setUpload({ busy: true, message: '', progress: '사전 검증 중…' });
    const results = await runSequentialUpload(targets.map(d => ({ ...d, selected: onlyFailed ? true : d.selected })), {
      newOperationId: () => crypto.randomUUID(),
      buildPayload: (draft, previewOnly) => buildWarehouseUploadPayload(draft, { fileName: docs.invoice?.name || 'invoice.pdf', sourceHash: docs.invoice?.hash || '', includeAwbFreight, previewOnly }),
      post: async body => (await jsonFetch('/api/warehouse', { method: 'POST', body: JSON.stringify(body) })).data,
      onProgress: ({ key, stage }) => {
        const label = drafts.find(d => d.key === key)?.header.invoiceNo || '송장';
        setUpload(u => ({ ...u, progress: stage === 'preview' ? `${label} 사전 검증 중…` : stage === 'commit' ? `${label} 정식 입고 중…` : u.progress }));
      },
    });
    setDrafts(list => list.map(d => {
      const r = results.find(x => x.key === d.key);
      if (!r) return d;
      return { ...d, operationId: r.operationId, upload: r.state === 'ok' ? { state: 'ok', warehouseKey: r.warehouseKey, error: '' } : { state: 'error', warehouseKey: null, error: r.error } };
    }));
    const ok = results.filter(r => r.state === 'ok');
    const bad = results.filter(r => r.state !== 'ok');
    setUpload({ busy: false, progress: '', message: `입고 완료 ${ok.length}건${ok.length ? ` (${ok.map(r => `#${r.warehouseKey}`).join(', ')})` : ''}${bad.length ? ` · 실패 ${bad.length}건 — 실패 건만 다시 올릴 수 있습니다.` : ''}` });
    if (ok.length) onUploaded?.(ok.map(r => r.warehouseKey));
  }

  function downloadPacking() {
    if (!active) return;
    const sheet = XLSX.utils.aoa_to_sheet(buildPackingGrid(active));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Packing');
    XLSX.writeFile(book, `패킹_${normalizeRoundInput(active.header.orderWeek) || '차수'}_${active.header.farmName || active.header.supplier || '농장'}_${active.header.invoiceNo || '송장'}.xlsx`);
  }

  async function saveAlias(row) {
    if (!row.prodKey || !active) return;
    const { ok, data } = await jsonFetch('/api/import/tools/product-matches', { method: 'POST', body: JSON.stringify({ expectedRevision: catalog.revision, entries: [{ country: active.header.country, description: row.description, prodKey: Number(row.prodKey) }] }) });
    if (!ok || !data.success) { setNotice(data.error || '품목 별칭 저장에 실패했습니다.'); return; }
    setCatalog(c => ({ ...c, value: data.value, revision: data.revision }));
    setRow(row.id, { aliasSaved: true, matchSource: '저장된 별칭' });
    setNotice(`"${row.description}" → ${row.prodName} 별칭을 팀 공용으로 저장했습니다.`);
  }

  async function saveFarmMatch() {
    if (!active?.header.supplier) { setNotice('원문 공급자명이 없어 농장 연결을 저장할 수 없습니다.'); return; }
    const h = active.header;
    const defaults = h.country === 'CO' ? suggestColombiaPackingDefaults(h.supplier) : {};
    const entryBody = h.isNewFarm ? { country: h.country, supplier: h.supplier, isNewFarm: true, farmName: h.farmName, packingAbbr: defaults.packingAbbr }
      : { country: h.country, supplier: h.supplier, farmKey: h.farmKey ?? null, farmSourceWarehouseKey: h.farmKey ? null : h.farmSourceWarehouseKey ?? null, packingAbbr: defaults.packingAbbr };
    const { ok, data } = await jsonFetch('/api/import/tools/farm-matches', { method: 'POST', body: JSON.stringify({ expectedRevision: farms.revision, entries: [entryBody] }) });
    if (!ok || !data.success) { setNotice(data.error || '농장 연결 저장에 실패했습니다.'); return; }
    setFarms(f => ({ ...f, value: data.value, revision: data.revision, farms: data.farms || f.farms }));
    setNotice(`${h.supplier} → ${h.farmName} 농장 연결을 팀 공용으로 저장했습니다.`);
  }

  const farmCandidates = useMemo(() => {
    if (!active) return [];
    const q = (farmQuery || active.header.supplier || '').toUpperCase().split(/[^A-Z0-9가-힣]+/).filter(w => w.length >= 3);
    const countryKr = WORKBENCH_COUNTRIES.find(([c]) => c === active.header.country)?.[1];
    return farms.farms.filter(f => !f.isDeleted && (!countryKr || !f.CounName || f.CounName === countryKr))
      .map(f => ({ f, score: q.reduce((s, w) => s + (String(f.FarmName).toUpperCase().includes(w) ? 1 : 0), 0) }))
      .filter(x => x.score > 0 || !q.length).sort((a, b) => b.score - a.score || Number(b.f.UsageCount || 0) - Number(a.f.UsageCount || 0)).slice(0, 8).map(x => x.f);
  }, [active, farms.farms, farmQuery]);

  const activeRowId = activeField.startsWith('row:') ? activeField.split(':')[1] : '';
  const activeRow = active?.rows.find(r => r.id === activeRowId) || null;
  const productCandidates = useMemo(() => {
    if (!activeRow || activeRow.kind !== 'goods' || !active) return [];
    return rankProductSuggestions(productQuery || activeRow.description, catalog.products, { country: active.header.country, supplier: active.header.supplier, limit: 6, minScore: productQuery ? 10 : 30 }).items;
  }, [activeRow, catalog.products, productQuery, active]);

  function addRow(kind) {
    if (!active || locked) return;
    const extra = kind === 'gwcw' ? [blankRow('gw', { steamQty: active.header.gw ?? 0 }), blankRow('cw', { steamQty: active.header.cw ?? 0 })] : [blankRow(kind)];
    updateDraft(active.key, d => ({ ...d, rows: [...d.rows, ...extra] }));
    setTimeout(() => focusField(`row:${extra[0].id}:${kind === 'goods' ? 'description' : kind === 'freight' ? 'totalPrice' : 'steamQty'}`), 0);
  }

  function markAllVisibleChecked() {
    if (!active || locked) return;
    updateDraft(active.key, d => ({ ...d, checked: Object.fromEntries(requiredCheckKeys(d).map(k => [k, true])) }));
  }

  if (!open) return null;
  const header = active?.header;
  const fixSuggestion = active ? suggestReconcileFix(active) : null;
  const fieldProps = key => ({
    'data-field-key': key,
    className: `${styles.field} ${lineKey === key ? styles.fieldActive : ''} ${issuesFor(key).some(i => i.level === 'block') ? styles.fieldBlock : issuesFor(key).length ? styles.fieldWarn : ''}`,
  });

  return (
    <div className={styles.overlay} ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="visual-inbound-title" data-entry={entry}>
      <header className={styles.top}>
        <div className={styles.purpose}>
          <span className={styles.purposeTag}>[핵심 목적 · PURPOSE]</span>
          <h2 id="visual-inbound-title">인보이스·AWB PDF를 엑셀 변환 없이 눈으로 검증하고 바로 입고</h2>
          <p>우측 항목을 누르면 왼쪽 원본의 같은 위치가 강조되고 선으로 이어집니다. 다르면 그 자리에서 고치고, 모든 항목을 확인한 송장만 입고됩니다.</p>
        </div>
        <ol className={styles.steps} aria-label="진행 단계">
          <li className={docs.invoice ? styles.stepDone : styles.stepNow}>1 PDF 넣기</li>
          <li className={drafts.length ? styles.stepDone : docs.invoice ? styles.stepNow : ''}>2 원문 분석</li>
          <li className={allVerified ? styles.stepDone : drafts.length ? styles.stepNow : ''}>3 눈으로 확인·수정</li>
          <li className={drafts.some(d => d.upload?.state === 'ok') ? styles.stepDone : allVerified ? styles.stepNow : ''}>4 바로 입고</li>
        </ol>
        <div className={styles.topButtons}>
          {drafts.length > 0 && <button type="button" className={styles.secondary} onClick={resetSession}>새 PDF 넣기</button>}
          <button type="button" className={styles.close} onClick={requestClose}>닫기 (Esc)</button>
        </div>
      </header>

      {!drafts.length ? (
        <section className={styles.intake}>
          <div ref={dropRef} tabIndex={0} role="button" className={styles.drop} aria-label="PDF 파일 선택 또는 끌어놓기"
            onClick={() => fileInputRef.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); acceptFiles(e.dataTransfer.files); }}>
            <strong>인보이스 PDF와 (있으면) AWB PDF를 한 번에 끌어놓거나 눌러서 선택</strong>
            <span>여러 쪽·여러 송장 묶음 PDF도 됩니다. 에콰도르·호주 등은 AWB를 함께 넣으면 AWB 번호·GW·CW·운임을 AWB 원본에서 확인합니다.</span>
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { acceptFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {docs.invoice && (
            <div className={styles.intakeForm}>
              <dl className={styles.fileList}>
                <div><dt>인보이스</dt><dd>{docs.invoice.name}</dd></div>
                <div><dt>AWB 운송장</dt><dd>{docs.awb ? docs.awb.name : '없음'}</dd></div>
              </dl>
              <label className={styles.inline}>국가
                <select value={country} onChange={e => setCountry(e.target.value)}>
                  <option value="">선택</option>
                  {WORKBENCH_COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label className={styles.inline}>차수
                <input value={roundHint} placeholder="48-01" onChange={e => setRoundHint(e.target.value)} onBlur={e => setRoundHint(normalizeRoundInput(e.target.value))} inputMode="numeric" />
              </label>
              <button type="button" className={styles.primary} disabled={!country || ['checking', 'running', 'reading'].includes(analysis.stage)} onClick={() => analyze()}>원문 분석 (기존 분석 재사용)</button>
              {analysis.stage === 'needs-ai' || analysis.stage === 'error' ? <>
                {analysis.retryJobId && country === 'CO' && <button type="button" className={styles.secondary} onClick={revalidateSaved}>저장 구간 무료 재검증</button>}
                <button type="button" className={styles.secondary} onClick={() => analyze({ allowAI: true })}>{analysis.retryJobId ? '새로 AI 분석 (추가 비용)' : 'AI 원문 분석 시작 (유료)'}</button>
                <button type="button" className={styles.secondary} onClick={startManual}>직접 입력으로 시작</button>
              </> : null}
            </div>
          )}
          {(analysis.message || notice) && <p className={analysis.stage === 'error' ? styles.errorText : styles.infoText} role="status">{notice || analysis.message}</p>}
        </section>
      ) : (
        <div className={styles.body}>
          <div className={styles.left}>
            <VisualInboundPdfPane docs={docs} tab={tab} onTabChange={setTab} target={target} tone={tone} highlightRef={highlightRef} paneRef={leftPaneRef}
              onLayout={() => setLayoutRevision(v => v + 1)} />
          </div>
          <div className={styles.gutter} aria-hidden="true" />
          <div className={styles.right} ref={rightPaneRef}>
            <p className={styles.infoText} role="status">{analysis.message}</p>
            {notice && <p className={styles.noticeText} role="status">{notice}</p>}
            <section aria-label="송장 목록" className={styles.strip}>
              <div className={styles.stripHead}>
                <strong>송장 {drafts.length}건</strong>
                {dupLabel && <span className={styles.dupSummary}>기입고 완료 ({dupLabel}) — 자동 제외</span>}
                <button type="button" className={styles.linkButton} onClick={() => checkExisting()}>기입고 다시 확인</button>
              </div>
              <ul className={styles.stripList}>
                {drafts.map((d, i) => (
                  <li key={d.key} className={d.key === active?.key ? styles.stripItemOn : styles.stripItem}>
                    <input type="checkbox" aria-label={`${d.header.invoiceNo || `송장 ${i + 1}`} 입고 선택`} checked={d.selected && !d.duplicate} disabled={Boolean(d.duplicate) || d.upload?.state === 'ok'}
                      onChange={e => updateDraft(d.key, x => ({ ...x, selected: e.target.checked }))} />
                    <button type="button" className={styles.stripButton} aria-pressed={d.key === active?.key} onClick={() => { setActiveKey(d.key); setActiveField(''); setTarget(null); }}>
                      <span className={styles.stripInvoice}>{d.header.invoiceNo || '송장번호 없음'}</span>
                      <span className={styles.stripFarm}>{d.header.farmName || d.header.supplier || '농장 미지정'}</span>
                      <span className={`${styles.badge} ${styles[statusClass[statuses[i]]]}`}>
                        {d.duplicate ? `기입고 완료 (#${d.duplicate.warehouseKey})` : d.upload?.state === 'ok' ? `입고완료 (#${d.upload.warehouseKey})` : statuses[i]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {active && <>
              {active.duplicate && <p className={styles.noticeText}>이 송장은 이미 입고되어 있습니다 (#{active.duplicate.warehouseKey} · {active.duplicate.orderWeek} · {active.duplicate.farmName}). 수정·입고할 수 없습니다.</p>}
              {active.upload?.state === 'error' && <p className={styles.errorText} role="alert">{active.upload.error}</p>}
              <fieldset className={styles.section}>
                <legend>① 송장 머리 정보 — 누르면 왼쪽 원문 위치로 이동{locked ? ' (기입고·입고완료 · 읽기 전용 확인)' : ''}</legend>
                <div className={styles.headerGrid}>
                  <div {...fieldProps('country')}>
                    <label htmlFor="vw-country">국가</label>
                    <select id="vw-country" value={header.country} disabled={locked} onFocus={() => focusField('country')} onChange={e => setHeader('country', e.target.value)}>
                      {WORKBENCH_COUNTRIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                    <CheckToggle checked={Boolean(active.checked.country)} onToggle={() => toggleCheck('country')} label="국가" />
                  </div>
                  <div {...fieldProps('round')}>
                    <label htmlFor="vw-year">연도·차수</label>
                    <span className={styles.pair}>
                      <input id="vw-year" value={header.orderYear} readOnly={locked} inputMode="numeric" maxLength={4} aria-label="주문연도" onFocus={() => focusField('round')} onChange={e => setHeader('orderYear', e.target.value.replace(/\D/g, ''))} />
                      <input value={header.orderWeek} readOnly={locked} placeholder="48-01" aria-label="차수" onFocus={() => focusField('round')} onChange={e => setHeader('orderWeek', e.target.value)}
                        onBlur={e => setHeader('orderWeek', normalizeRoundInput(e.target.value))} />
                    </span>
                    <CheckToggle checked={Boolean(active.checked.round)} onToggle={() => toggleCheck('round')} label="연도·차수" />
                  </div>
                  <div {...fieldProps('inputDate')}>
                    <label htmlFor="vw-date">입고일</label>
                    <input id="vw-date" type="date" value={header.inputDate} readOnly={locked} onFocus={() => focusField('inputDate')} onChange={e => setHeader('inputDate', e.target.value)} />
                    <CheckToggle checked={Boolean(active.checked.inputDate)} onToggle={() => toggleCheck('inputDate')} label="입고일" />
                    {header.invoiceDate && <small className={styles.hint}>송장일 {header.invoiceDate}</small>}
                  </div>
                  <div {...fieldProps('farm')} data-wide="true">
                    <label htmlFor="vw-farm">농장</label>
                    <input id="vw-farm" value={farmQuery || header.farmName} readOnly={locked} placeholder={header.supplier ? `원문: ${header.supplier}` : '농장 검색'} onFocus={() => focusField('farm')}
                      onChange={e => setFarmQuery(e.target.value)} data-escape-local="true"
                      onKeyDown={e => { if (e.key === 'Escape') { setFarmQuery(''); e.currentTarget.blur(); } }} />
                    <CheckToggle checked={Boolean(active.checked.farm)} onToggle={() => toggleCheck('farm')} label="농장" />
                    <div className={styles.chips} role="listbox" aria-label="농장 후보">
                      {farmCandidates.map(f => (
                        <button type="button" role="option" aria-selected={header.farmName === f.FarmName} disabled={locked} key={`${f.FarmKey}-${f.WarehouseKey}-${f.FarmName}`}
                          className={header.farmName === f.FarmName ? styles.chipOn : styles.chip}
                          onClick={() => { updateDraft(active.key, d => ({ ...d, header: { ...d.header, farmName: f.FarmName, farmKey: f.FarmKey ?? null, farmSourceWarehouseKey: f.WarehouseKey ?? null, isNewFarm: false, farmSource: '직접 선택' }, checked: { ...d.checked, farm: false } })); setFarmQuery(''); }}>
                          {f.FarmName}
                        </button>
                      ))}
                      <button type="button" className={styles.chipNew} disabled={locked} onClick={() => {
                        const name = window.prompt('신규 입고 농장명을 입력하세요', farmQuery || suggestNewFarmName(header.supplier) || '');
                        if (name && name.trim()) { updateDraft(active.key, d => ({ ...d, header: { ...d.header, farmName: name.trim(), farmKey: null, farmSourceWarehouseKey: null, isNewFarm: true, farmSource: '신규 농장' }, checked: { ...d.checked, farm: false } })); setFarmQuery(''); }
                      }}>+ 신규 농장 선택</button>
                      <button type="button" className={styles.linkButton} disabled={locked || !header.farmName || !header.supplier} onClick={saveFarmMatch}>이 공급자 → 농장 연결 저장</button>
                    </div>
                    {header.farmSource && <small className={styles.hint}>{header.farmSource}{header.isNewFarm ? ' · 신규 농장' : ''}</small>}
                  </div>
                  <div {...fieldProps('invoiceNo')}>
                    <label htmlFor="vw-invoice">송장번호</label>
                    <input id="vw-invoice" value={header.invoiceNo} readOnly={locked} onFocus={() => focusField('invoiceNo')} onChange={e => setHeader('invoiceNo', e.target.value)} />
                    <CheckToggle checked={Boolean(active.checked.invoiceNo)} onToggle={() => toggleCheck('invoiceNo')} label="송장번호" />
                  </div>
                  <div {...fieldProps('awb')}>
                    <label htmlFor="vw-awb">AWB 번호{docs.awb ? ' · AWB 원본' : ''}</label>
                    <input id="vw-awb" value={header.awb} readOnly={locked} onFocus={() => focusField('awb')} onChange={e => setHeader('awb', e.target.value)} />
                    <CheckToggle checked={Boolean(active.checked.awb)} onToggle={() => toggleCheck('awb')} label="AWB" />
                  </div>
                  <div {...fieldProps('gw')}>
                    <label htmlFor="vw-gw">GW (kg)</label>
                    <input id="vw-gw" value={num(header.gw)} readOnly={locked} inputMode="decimal" onFocus={() => focusField('gw')} onChange={e => setHeader('gw', toNumber(e.target.value))} />
                    <CheckToggle checked={Boolean(active.checked.gw)} onToggle={() => toggleCheck('gw')} label="GW" />
                  </div>
                  <div {...fieldProps('cw')}>
                    <label htmlFor="vw-cw">CW (kg)</label>
                    <input id="vw-cw" value={num(header.cw)} readOnly={locked} inputMode="decimal" onFocus={() => focusField('cw')} onChange={e => setHeader('cw', toNumber(e.target.value))} />
                    <CheckToggle checked={Boolean(active.checked.cw)} onToggle={() => toggleCheck('cw')} label="CW" />
                  </div>
                  <div {...fieldProps('freight')}>
                    <label htmlFor="vw-rate">운임 (Rate · 부대비)</label>
                    <span className={styles.pair}>
                      <input id="vw-rate" value={num(header.rate)} readOnly={locked} inputMode="decimal" aria-label="운임 단가 Rate" placeholder="Rate" onFocus={() => focusField('freight')} onChange={e => setHeader('rate', toNumber(e.target.value))} />
                      <input value={num(header.docFee)} readOnly={locked} inputMode="decimal" aria-label="AWB 부대비" placeholder="부대비" onFocus={() => focusField('freight')} onChange={e => setHeader('docFee', toNumber(e.target.value))} />
                    </span>
                    <label className={styles.checkLabel}><input type="checkbox" disabled={locked} checked={includeAwbFreight} onChange={e => setIncludeAwbFreight(e.target.checked)} /> AWB 운임·중량을 입고 헤더에 함께 저장</label>
                  </div>
                  <div {...fieldProps('invoiceTotal')}>
                    <label htmlFor="vw-total">송장 총액{header.currency ? ` (${header.currency})` : ''}</label>
                    <input id="vw-total" value={num(header.invoiceTotal)} readOnly={locked} inputMode="decimal" onFocus={() => focusField('invoiceTotal')} onChange={e => setHeader('invoiceTotal', toNumber(e.target.value))} />
                    <CheckToggle checked={Boolean(active.checked.invoiceTotal)} onToggle={() => toggleCheck('invoiceTotal')} label="송장 총액" />
                  </div>
                </div>
                {review.issues.filter(i => !i.rowId && i.field !== 'invoiceTotal' && i.field !== 'rows').map((issue, i) => (
                  <p key={i} className={issue.level === 'block' ? styles.issueBlock : styles.issueWarn}>{HEADER_FIELDS.find(([k]) => k === issue.field)?.[1] || '확인'} · {issue.message}</p>
                ))}
              </fieldset>

              <fieldset className={styles.section}>
                <legend>② 품목·부대비 — 모든 칸 직접 수정 가능</legend>
                <div className={styles.tableWrap}>
                  <table className={styles.rows}>
                    <thead>
                      <tr><th scope="col">확인</th><th scope="col">원문 품명 → 전산 품목</th><th scope="col">박스</th><th scope="col">박스당 송이</th><th scope="col">총 송이</th><th scope="col">단가</th><th scope="col">금액</th><th scope="col">행</th></tr>
                    </thead>
                    <tbody>
                      {active.rows.map(row => {
                        const rowKey = `row:${row.id}`;
                        const rowIssues = review.issues.filter(i => i.rowId === row.id);
                        const cell = (field, extra = {}) => (
                          <td className={`${styles.cell} ${activeField === `${rowKey}:${field}` ? styles.cellActive : ''} ${rowIssues.some(i => i.field === field && i.level === 'block') ? styles.cellBlock : rowIssues.some(i => i.field === field) ? styles.cellWarn : ''}`}>
                            <input aria-label={`${row.description || '행'} ${({ boxQty: '박스', steamOf1Box: '박스당 송이', steamQty: '총 송이', unitPrice: '단가', totalPrice: '금액' })[field]}`}
                              value={num(row[field])} readOnly={locked} inputMode="decimal" onFocus={() => focusField(`${rowKey}:${field}`)}
                              onChange={e => setRow(row.id, { [field]: toNumber(e.target.value), ...(field === 'unitPrice' && row.kind === 'freight' ? { totalPrice: toNumber(e.target.value) } : {}) })} {...extra} />
                          </td>
                        );
                        return (
                          <tr key={row.id} data-field-key={rowKey} className={lineKey === rowKey ? styles.rowActive : ''}>
                            <td><CheckToggle checked={Boolean(active.checked[rowKey])} onToggle={() => toggleCheck(rowKey)} label={row.description || '행'} /></td>
                            <td className={`${styles.cell} ${styles.nameCell} ${activeField === `${rowKey}:description` ? styles.cellActive : ''} ${rowIssues.some(i => i.field === 'description') ? styles.cellBlock : ''}`}>
                              <input aria-label="원문 품명" value={row.description} readOnly={locked} onFocus={() => focusField(`${rowKey}:description`)} onChange={e => setRow(row.id, { description: e.target.value })} />
                              {row.kind === 'goods'
                                ? <span className={styles.matchLine}>{row.prodName ? <><b>{row.prodName}</b><small>{row.matchSource || '직접 선택'}</small>{!locked && !row.aliasSaved && row.prodKey ? <button type="button" className={styles.linkButton} onClick={() => saveAlias(row)}>별칭 저장</button> : null}</> : <em>전산 품목 연결 필요 — 이 칸을 누르면 후보가 아래에 나옵니다</em>}</span>
                                : <span className={styles.matchLine}><b>{row.prodName}</b><small>{row.kind === 'freight' ? '부대비' : '중량 행'}</small></span>}
                            </td>
                            {cell('boxQty')}{cell('steamOf1Box')}{cell('steamQty')}{cell('unitPrice')}{cell('totalPrice')}
                            <td className={styles.rowTools}>
                              {!locked && row.kind === 'goods' && Number(row.boxQty) === 0 && <button type="button" className={styles.linkButton} onClick={() => setRow(row.id, { zeroBoxConfirmed: !row.zeroBoxConfirmed })}>{row.zeroBoxConfirmed ? '합포장 취소' : '합포장 확인'}</button>}
                              {!locked && <button type="button" className={styles.dangerLink} aria-label={`${row.description || '행'} 삭제`} onClick={() => updateDraft(active.key, d => ({ ...d, rows: d.rows.filter(r => r.id !== row.id) }))}>삭제</button>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!locked && activeRow && activeRow.kind === 'goods' && (
                  <div className={styles.matchPanel} aria-label="전산 품목 후보">
                    <label className={styles.inline}>품목 검색 (화종 자동 필터)
                      <input value={productQuery} placeholder={activeRow.description} onChange={e => setProductQuery(e.target.value)} data-escape-local="true"
                        onKeyDown={e => { if (e.key === 'Escape') { setProductQuery(''); } }} />
                    </label>
                    <div className={styles.chips} role="listbox" aria-label="품목 후보">
                      {productCandidates.map(({ product, score }) => (
                        <button type="button" role="option" aria-selected={activeRow.prodKey === product.ProdKey} key={product.ProdKey} className={activeRow.prodKey === product.ProdKey ? styles.chipOn : styles.chip}
                          onClick={() => { setRow(activeRow.id, { prodName: product.ProdName, prodKey: product.ProdKey, matchSource: `직접 선택 ${score}점`, aliasSaved: false }); setProductQuery(''); }}>
                          {product.ProdName} <small>{score}점</small>
                        </button>
                      ))}
                      {!productCandidates.length && <span className={styles.hint}>{catalog.error || '후보가 없습니다. 검색어를 바꿔 보세요.'}</span>}
                    </div>
                    {review.issues.filter(i => i.rowId === activeRow.id).map((issue, i) => (
                      <p key={i} className={issue.level === 'block' ? styles.issueBlock : styles.issueWarn}>
                        {issue.message}
                        {issue.field === 'totalPrice' && issue.level === 'warn' && <button type="button" className={styles.linkButton} onClick={() => setRow(activeRow.id, backSolveRow(activeRow, 'totalPrice'))}>금액 역산</button>}
                        {issue.field === 'totalPrice' && issue.level === 'warn' && <button type="button" className={styles.linkButton} onClick={() => setRow(activeRow.id, backSolveRow(activeRow, 'unitPrice'))}>단가 역산</button>}
                        {issue.field === 'steamQty' && issue.level === 'warn' && <button type="button" className={styles.linkButton} onClick={() => setRow(activeRow.id, backSolveRow(activeRow, 'steamQty'))}>총 송이 = 박스 × 박스당 송이</button>}
                      </p>
                    ))}
                  </div>
                )}
                {!locked && <div className={styles.addRow}>
                  <button type="button" className={styles.secondary} onClick={() => addRow('goods')}>+ 품목 행 추가</button>
                  <button type="button" className={styles.secondary} onClick={() => addRow('freight')}>+ 운송료/PHYTO</button>
                  <button type="button" className={styles.secondary} onClick={() => addRow('gwcw')}>+ GW/CW</button>
                </div>}
                <div className={`${styles.totals} ${review.totals.ok ? styles.totalsOk : review.totals.hasTotal ? styles.totalsBad : ''}`} aria-live="polite">
                  <span>상품합 <b>{fmtMoney(review.totals.goods)}</b></span>
                  <span>+ 부대비 <b>{fmtMoney(review.totals.extras)}</b></span>
                  <span>= 합계 <b>{fmtMoney(review.totals.sum)}</b></span>
                  <span>송장 총액 <b>{fmtMoney(review.totals.total)}</b></span>
                  <span>차액 <b>{review.totals.diff == null ? '—' : fmtMoney(review.totals.diff)}</b></span>
                  <span>박스 <b>{round2(review.totals.boxes)}</b> · 송이 <b>{Number(review.totals.stems).toLocaleString('ko-KR')}</b></span>
                  {fixSuggestion && !locked && <button type="button" className={styles.linkButton} onClick={() => updateDraft(active.key, d => applyReconcileFix(d, fixSuggestion))}>1클릭 역산 보정: {fixSuggestion.label}</button>}
                </div>
              </fieldset>
            </>}

            <footer className={styles.actions}>
              <span className={styles.progress} role="status">{upload.progress || upload.message}</span>
              <button type="button" className={styles.secondary} disabled={!active || locked} onClick={markAllVisibleChecked} title="원문과 모두 대조한 경우에만 누르세요">이 송장 전 항목 확인 표시</button>
              <button type="button" className={styles.secondary} disabled={!active} onClick={downloadPacking}>패킹 .xlsx 받기</button>
              {failed.length > 0 && <button type="button" className={styles.secondary} disabled={upload.busy} onClick={() => runUpload(true)}>실패 건만 재업로드 ({failed.length})</button>}
              <button type="button" className={styles.primary} disabled={upload.busy || !allVerified} onClick={() => runUpload(false)}>
                검증 완료 · 바로 입고 업로드 ({uploadable.length}건)
              </button>
            </footer>
          </div>
          <VisualInboundLeaderLine rootRef={rootRef} fromRef={highlightRef} fromPaneRef={leftPaneRef} toPaneRef={rightPaneRef} toKey={target && lineKey ? lineKey : ''} tone={tone} revision={layoutRevision + (target?.seq || 0)} />
        </div>
      )}
    </div>
  );
}

function headerCheckKey(field) {
  if (field === 'orderYear' || field === 'orderWeek') return 'round';
  if (field === 'farmName') return 'farm';
  if (field === 'rate' || field === 'docFee') return 'freight';
  return field;
}
