import HubfreshPacking from './HubfreshPacking.js';
import styles from '../../styles/ImportPacking.module.css';
import typography from '../../styles/ImportReviewTypography.module.css';
import WorkflowGuide from '../WorkflowGuide';
import ReceiptBunchConfirmation from '../ReceiptBunchConfirmation';
import PackingManifestFarmReview from './PackingManifestFarmReview.js';
import {pendingManifestIssues} from '../../lib/packingManifestReconciliation.js';
import {packingAmountIssues} from '../../lib/packingAmountReview.js';
import PackingAmountReview from './PackingAmountReview';
import { blockingPackingIssues } from '../../lib/packingReceiptDatePolicy.js';
import {createPackingHistoryClient,loadPackingHistory} from '../../lib/packingSharedHistoryClient.js';
import {packingFileReuse,analyzedPackingUploads,readCompletedPackingAnalysis} from '../../lib/packingFileReuse.js';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import PackingResults from './PackingResults.js';
import { packingReceiptMatchState, effectivePackingMatchReview } from '../../lib/packingReceiptMatchState.js';
import PackingEvidenceReview from './PackingEvidenceReview.js';
import PackingProductMatchDialog from './PackingProductMatchDialog.js';
import PackingUploadMatchModal, { PackingUploadMatchAlertBanner } from './PackingUploadMatchModal.js';
import { collectUploadMatchingNeeds, applyUploadQuantityEdits } from '../../lib/packingUploadMatchPrompt.js';
import InvoiceUploadIssues from './InvoiceUploadIssues.js';
import PackingMatchManager from './PackingMatchManager.js';
import ChinaLegacyReview from './ChinaLegacyReview.js';
import { findLegacyChinaInvoiceCandidates, parseChinaLegacyInvoiceWorkbook } from '../../lib/importChinaLegacyInvoice.js';
import { resolveLegacyChinaInvoice } from '../../lib/importChinaLegacyReview.js';
import {packingErpCatalog,packingErpAliases,packingLegacyExportBlocked} from '../../lib/importPackingErpMatches.js';
import { makePackingReviewRows, applyPackingReview, packingReviewWriter } from '../../lib/importPackingReview.js';
import { packingValidationIssues } from '../../lib/packingValidationIssues.js';
import { notifyPackingBlocked } from '../../lib/packingBlockedNotice.js';
import { parsePackingResponse, healColombiaInvoiceExtraction } from '../../lib/importPackingResponse.js';
import { reconcileInvoiceSupplier } from '../../lib/invoiceSupplierEvidence.js';
import { inspectNzBloomInvoice, nzOriginComparisonDocument, packingOriginMismatch, SUPPLEMENTAL_PACKING_ORIGINS } from '../../lib/packingOriginEvidence.js';
import InvoiceReceiptComparison from './InvoiceReceiptComparison.js';
import { parseAwbFields, parsePrintedDate, parseSupportAwbDocument, isAirWaybillDocument } from '../../lib/importAwbFields.js';
import { partitionPackingInvoicesByDuplicates } from '../../lib/packingDuplicateCheck.js';
import { extractPackingDocument } from '../../lib/importPackingExtractClient.js';
import { packingWeight } from '../../lib/invoiceReceiptAutoFill.js';
import { parseChinaInvoiceWorkbook, CHINA_INVOICE_MAX_BYTES } from '../../lib/importChinaInvoice.js';
import ChinaInvoiceSheetReview from './ChinaInvoiceSheetReview.js';
import { isModernChinaInvoice } from '../../lib/importChinaInvoiceFormat.js';
import { readPackingRecords, indexPackingCatalog, savePackingAliases, writePackingRecord,
  PACKING_STORAGE_KEYS, isPackingDownloadBlocked, previewPackingCatalog,
  distinctPackingVarieties, PACKING_PDF_MAX_BYTES,
  readPackingPdfResponse } from '../../lib/importPackingState.js';
import { ALL_SEED_ALIASES, aliasKey, packingSourceKey, parseCatalog, parseAliasesXlsx, exportAliasesXlsx,
  genColombia, genNL, genChina, genEcuador, genThailand, genAustralia, genUS, genVN,
  AWB_DEFAULT_COMPANIES, writeAWBWorkbook, parseWeekFromFilename } from '../../lib/importPacking.js';
import { packingInvoiceSourceIdentity, packingInvoiceTotals, sha256File } from '../../lib/importPackingReceiptAdapter.js';
import { assertPackingSourceValues, bindPackingSourceReviewPolicy } from '../../lib/importPackingSourceReview.js';
import { buildPackingMatchPreview } from '../../lib/importPackingMatchPreview.js';
import { packingWeekScope, needsPackingWeekDate, applyPackingWeekDate } from '../../lib/packingWeekDate.js';
import { packingMatchReview } from '../../lib/packingMatchReview.js';
import { createPackingWorkDraftStore } from '../../lib/packingWorkDraft.js';
import { needsInvoiceAllocation } from '../../lib/invoiceProductAllocation.js';
import { invoiceBoxTotal, reviewAirWaybill } from '../../lib/invoiceAwbEvidence.js';
import { packingPreparationBlockReason } from '../../lib/packingReceiptPreparation.js';

import { I18N, packingText, seoulCalendarDate, EMPTY_RECEIPT_ITEMS, LEGACY_CN_REVIEW_MESSAGE, isLegacyChinaInvoice, unresolvedExtractionIssues, chinaLegacyReviewPayload, buildPackingCountryView } from '../../lib/importPacking/packingToolSupport.js';
import { NoticeText as _NoticeText, PendingItem as _PendingItem, NoMatchItem as _NoMatchItem, renderPackingMismatchAndAliasesFooter } from './PackingLegacyMatchItems.js';
import _AWBPanel from './PackingAwbPanel.js';
import { renderPackingCatalogSection } from './PackingCatalogSection.js';
import { renderPackingCountryGrid, renderPackingSupplementalOrigin, renderPackingSavedHistoryPanel, renderPackingFileChoicePanel, renderPackingAwbAttachmentDetails, renderPackingExistingDuplicatesPanel } from './PackingCountryAndReusePanels.js';

const NoticeText = _NoticeText;
const PendingItem = _PendingItem;
const NoMatchItem = _NoMatchItem;
const AWBPanel = _AWBPanel;

// Claude API 정책 보존: 기존 결과와 완료 구간을 먼저 재사용하며 실패 시 자동 재호출하지 않습니다.
const loadXLSX = () => import('xlsx-js-style').then(m => m.default || m);
const readLocalAwbPdf = async base64 => (await import('../../lib/importAwbPdf')).readAwbPdf(base64);

async function requestErpMatches(body, revisionOnly = false) {
  const response=await fetch('/api/import/tools/product-matches'+(revisionOnly?'?revisionOnly=1':''),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.success){const error=new Error(data?.error||'전산 품목·매칭 자료를 불러오지 못했습니다. 다시 조회하세요.');error.statusCode=response.status;throw error;}
  return data;
}
async function requestFarmMatches(body, revisionOnly = false) {
  try {
    const response=await fetch('/api/import/tools/farm-matches'+(revisionOnly?'?revisionOnly=1':''),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(!response.ok||!data?.success){
      if(!body) return { success:true, farms:[], value:null, revision:0, scope:'team' };
      const error=new Error(data?.error||'전산 농장·매칭 자료를 저장하지 못했습니다. 다시 시도하세요.');
      error.statusCode=response.status;
      throw error;
    }
    return { ...data, farms: Array.isArray(data.farms) ? data.farms : [] };
  } catch (error) {
    if (!body) return { success:true, farms:[], value:null, revision:0, scope:'team' };
    throw error;
  }
}
export default function PackingListTool({ storage, readAwbPdf = readLocalAwbPdf, onReceiptSourceChange, receiptMatchState, userId = '', sharedRestore, autoAnalyze = true, onContinue, costOnly = false, initialHubfresh = false, onHubfreshUpload }) {
  const [screen, setScreen] = useState(initialHubfresh ? 'hubfresh' : 'country');
  const [country, setCountry] = useState(null);
  const [originPreview, setOriginPreview] = useState(null);
  const [nzReceiptSource, setNzReceiptSource] = useState(null);
  const [contractReceiptSource,setContractReceiptSource]=useState(null);
  const [lang, setLang] = useState('ko');
  const t = { ...I18N[lang] || I18N.ko, ...packingText(lang) };
  const changeLang = setLang;
  const [file, setFile] = useState(null);
  const [fileChoice,setFileChoice]=useState(null);
  const [chinaSheetReview,setChinaSheetReview]=useState(null);
  const selectedChinaSheet=useRef(null);
  const [selectingFile,setSelectingFile]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false);
  const [historyRows,setHistoryRows]=useState([]);
  const [historySearch,setHistorySearch]=useState('');
  const [historyError,setHistoryError]=useState('');
  const fileChoiceRef=useRef(null);
  const reusableExtraction=useRef(null);
  useEffect(()=>{if(fileChoice)fileChoiceRef.current?.focus();},[fileChoice]);
  const [invoiceUploadDate, setInvoiceUploadDate] = useState('');
  const [audMarketRate, setAudMarketRate] = useState(null);
  const [audMarketRateError, setAudMarketRateError] = useState('');
  const [awbFile, setAwbFile] = useState(null);
  const [awbPdfBase64, setAwbPdfBase64] = useState('');
  const [awbSourceHash, setAwbSourceHash] = useState('');
  const [localAwbDocument, setLocalAwbDocument] = useState(null);
  const [awbValues, setAwbValues] = useState(null);
  const [awbManualFields, setAwbManualFields] = useState([]);
  const [awbReviewed, setAwbReviewed] = useState(false);
  const awbFileRef = useRef(null);
  const [existingReceipts, setExistingReceipts] = useState({ matchesByIndex: {}, orderYear: '', orderWeek: '', checking: false });
  const [excludedDuplicateIndexes, setExcludedDuplicateIndexes] = useState(() => new Set());
  const existingCheckSeq = useRef(0);
  const [dateYear, setDateYear] = useState('');
  useEffect(() => { setDateYear(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date())); }, []);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [status, setStatus] = useState(null);
  const [blockedEvent,setBlockedEvent]=useState(null);
  const recordBlocked=(detail,code='REVIEW_BLOCKED')=>setBlockedEvent({eventId:crypto.randomUUID(),owner:userId,fileName:file?.name||'',code,count:1,detail:String(detail).slice(0,2000)});
  const [steps, setSteps] = useState([]);
  const [excels, setExcels] = useState([]);
  const [matchPreview, setMatchPreview] = useState([]);
  const [scrollMatchPreview, setScrollMatchPreview] = useState(false);
  const [generated, setGenerated] = useState({});
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const catalogRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [xlsxLib, setXlsxLib] = useState(null);
  const [lastExtraction, setLastExtraction] = useState(null);
  const awbReview = useMemo(() => {
    if (country !== 'AU' && country !== 'EC') return null;
    const parsed = lastExtraction?.result?.awb_document || localAwbDocument || {};
    const edited = awbValues || {};
    return reviewAirWaybill({
      awbDocument: {
        ...parsed,
        awb: edited.awb ?? parsed.awb,
        packages: edited.packages ?? parsed.packages,
        gross_weight_kg: edited.grossWeightKg ?? parsed.gross_weight_kg,
        chargeable_weight_kg: edited.chargeableWeightKg ?? parsed.chargeable_weight_kg,
      },
      invoices: lastExtraction?.result?.invoices || [],
      packageTotal: invoiceBoxTotal(lastExtraction?.result?.invoices || []),
      manualFields: awbManualFields,
    });
  }, [awbManualFields, awbValues, country, lastExtraction, localAwbDocument]);
  const awbObjectUrl = useMemo(() => awbFile && typeof URL !== 'undefined' && URL.createObjectURL
    ? URL.createObjectURL(awbFile) : '', [awbFile]);
  useEffect(() => () => { if (awbObjectUrl) URL.revokeObjectURL(awbObjectUrl); }, [awbObjectUrl]);
  useEffect(() => {
    const parsed = lastExtraction?.result?.awb_document || localAwbDocument;
    if ((country !== 'AU' && country !== 'EC') || !parsed) return;
    setAwbValues({
      awb: parsed.awb || '', packages: parsed.packages ?? '',
      grossWeightKg: parsed.gross_weight_kg ?? '', chargeableWeightKg: parsed.chargeable_weight_kg ?? '',
    });
    setAwbManualFields([]);
    setAwbReviewed(false);
  }, [country, lastExtraction?.sourceHash, lastExtraction?.result?.awb_document, localAwbDocument]);

  useEffect(() => {
    const invoices = lastExtraction?.result?.invoices;
    if (!Array.isArray(invoices) || !invoices.length || !country || typeof fetch !== 'function') {
      setExistingReceipts({ matchesByIndex: {}, orderYear: '', orderWeek: '', checking: false });
      setExcludedDuplicateIndexes(prev => (prev.size === 0 ? prev : new Set()));
      return undefined;
    }
    const seq = ++existingCheckSeq.current;
    const explicitYear = file?.name?.match(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/)?.[1];
    const orderYear = explicitYear || dateYear || '';
    const weekParsed = lastExtraction?.weekParsed;
    const orderWeek = weekParsed ? `${weekParsed.week}-${weekParsed.num}` : '';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    setExistingReceipts(prev => ({ ...prev, checking: true }));
    fetch('/api/import/tools/check-existing-receipts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
      body: JSON.stringify({
        country,
        orderYear,
        orderWeek,
        invoices: invoices.map((inv, index) => ({
          index,
          invoice: inv?.invoice || '',
          supplier: inv?.supplier || '',
          awb: inv?.awb || '',
          date: inv?.date || '',
        })),
      }),
    })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (seq !== existingCheckSeq.current) return;
        const list = data?.success && Array.isArray(data.matches) ? data.matches : [];
        const byIndex = {};
        for (const item of list) byIndex[item.index] = item;
        setExistingReceipts({ matchesByIndex: byIndex, orderYear: data?.orderYear || orderYear, orderWeek: data?.orderWeek || orderWeek, checking: false });
        setExcludedDuplicateIndexes(prev => {
          const next = new Set(list.map(item => item.index));
          return prev.size === next.size && [...prev].every(x => next.has(x)) ? prev : next;
        });
      })
      .catch(() => {
        if (seq !== existingCheckSeq.current) return;
        setExistingReceipts({ matchesByIndex: {}, orderYear, orderWeek, checking: false });
        setExcludedDuplicateIndexes(prev => (prev.size === 0 ? prev : new Set()));
      });
    return () => controller?.abort?.();
  }, [lastExtraction?.sourceHash, lastExtraction?.result?.invoices?.length, country, dateYear, file?.name]);

  // Catalog (Lista de productos Nenova) — persists across sessions
  const [catalog, setCatalog] = useState(null);
  const [erpMatches,setErpMatches]=useState(null);
  const [farmMatches,setFarmMatches]=useState(null);
  const [matchModalOpen,setMatchModalOpen]=useState(false);
  const [matchModalError,setMatchModalError]=useState('');
  const autoPromptedSources=useRef(new WeakSet());
  const [generatedErp,setGeneratedErp]=useState(null);
  const [latestShared,setLatestShared]=useState(false);
  const erpReadSequence=useRef(0);
  const revisionFlight=useRef(false);
  const toolRoot=useRef(null);
  const [matchTarget,setMatchTarget]=useState(null);
  const [matchError,setMatchError]=useState('');
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogDraft, setCatalogDraft] = useState(null);
  const [catalogParsing, setCatalogParsing] = useState(false);
  const [catalogMode, setCatalogMode] = useState('merge');
  const [catalogReplaceConfirmed, setCatalogReplaceConfirmed] = useState(false);
  const [catalogClearConfirm, setCatalogClearConfirm] = useState(false);
  // A retained draft is revalidated after every shared reload. Validation errors
  // are UI data, never render exceptions or permission to save a stale preview.
  const catalogPreviewState = useMemo(() => {
    if (!catalogDraft) return { preview: null, error: null };
    try {
      return { preview: previewPackingCatalog(catalog, catalogDraft.catalog), error: null };
    } catch (error) {
      return { preview: null, error: error.message || String(error) };
    }
  }, [catalog, catalogDraft]);
  const catalogPreview = catalogPreviewState.preview;
  const catalogPreviewError = catalogPreviewState.error;
  const [allNoMatches, setAllNoMatches] = useState([]);
  // Aliases: { aliasKey(invoiceDesc) → catalogName } — seed + learned matches
  const [aliases, setAliases] = useState({ ...ALL_SEED_ALIASES });
  const [showAliasManager, setShowAliasManager] = useState(false);
  // Editable matches import/export; API credentials and model belong to the server.
  const aliasFileRef = useRef(null);
  // Pending decisions waiting for user confirmation
  const [pending, setPending] = useState([]);
  // Total-vs-invoice mismatches (after building excels): array of
  // { country, invoice, computed, expected }.  Surfaced as a red warning panel.
  const [mismatches, setMismatches] = useState([]);
  // Set of invoice keys for which the user has manually overridden the
  // mismatch block ("desbloquear manualmente").  Key is `${country}|${invoice}`.
  const [mismatchOverrides, setMismatchOverrides] = useState(new Set());
  // Last-extracted result so we can rebuild excels after user confirms aliases
  const [legacyReviewData, setLegacyReviewData] = useState(null);
  const [legacyPackingReviewRequired, setLegacyPackingReviewRequired] = useState(false);
  const [reviewRows, setReviewRows] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [matchingReviewedFile, setMatchingReviewedFile] = useState(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const reviewButtonRef = useRef(null);
  const matchPreviewRef = useRef(null);
  const [reviewInitialTarget, setReviewInitialTarget] = useState(null);
  const receiptIntent = useRef(false);
  const workStore = useMemo(() => userId ? createPackingWorkDraftStore(userId, { workspace: costOnly ? 'cost' : 'receipt' }) : null, [userId, costOnly]);
  const [savedWork, setSavedWork] = useState(null);
  const [workReady, setWorkReady] = useState(false);
  const [workMessage, setWorkMessage] = useState('');
  const [workError, setWorkError] = useState('');
  const [restoringWork, setRestoringWork] = useState(false);
  const workSaveSequence = useRef(0);
  const [needsAI, setNeedsAI] = useState(false);
  const [pdfRetryJobId, setPdfRetryJobId] = useState(null);
  const [extractionSource, setExtractionSource] = useState('');


  const [sharedError, setSharedError] = useState(null);
  const [sharedReady, setSharedReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const savingRef = useRef(false);
  const readerVersion = useRef(0);
  const exportGeneration = useRef(0);
  const exportInFlight = useRef(false);
  const [exportReview, setExportReview] = useState(null);
  const catalogReaderVersion = useRef(0);
  const sharedScopeVersion = useRef(0);
  const processingRef = useRef(false);
  const teamHistory = useMemo(() => createPackingHistoryClient(userId), [userId]);
  const [teamHistoryStatus, setTeamHistoryStatus] = useState('');
  const [teamHistoryError, setTeamHistoryError] = useState('');
  const [teamHistoryRetry, setTeamHistoryRetry] = useState(0);
  const sharedRestoreButton = useRef(null);
  useEffect(() => () => {
    ++readerVersion.current; ++catalogReaderVersion.current;
    ++sharedScopeVersion.current;
  }, []);

  useEffect(() => {
    if (!workStore) return;
    let active = true;
    setWorkReady(false);
    (async () => {
      const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok || !data.success || String(data.user?.userId) !== String(userId)) throw new Error('로그인 계정을 확인한 뒤 작업을 복구하세요.');
      const draft = await workStore.load();
      if (active) { setSavedWork(draft); setWorkReady(true); }
    })().catch(error => { if (active) setWorkError(`작업 보관을 사용할 수 없습니다: ${error.message}`); });
    return () => { active = false; };
  }, [workStore, userId]);

  useEffect(() => {
    if (!workStore || !workReady || !file || !lastExtraction || restoringWork) return;
    const sequence = ++workSaveSequence.current;
    let active = true;
    setWorkMessage('현재 작업 보관 중…');
    workStore.save({ file, country, dateYear, invoiceUploadDate, lastExtraction, reviewRows, reviewConfirmed, matchingReviewed: matchingReviewedFile === file,
      legacyReviewData, legacyPackingReviewRequired, extractionSource }).then(() => {
      if (active && sequence === workSaveSequence.current) { setWorkError(''); setWorkMessage('현재 작업 보관됨 · 같은 PC·계정에서 새로고침 후 이어서 작업할 수 있습니다.'); }
    }).catch(error => {
      if (active && sequence === workSaveSequence.current) { setWorkMessage(''); setWorkError(`현재 작업 보관 실패: ${error.message} · 이 화면을 닫지 말고 다시 시도하세요.`); }
    });
    return () => { active = false; };
  }, [workStore, workReady, file, country, dateYear, invoiceUploadDate, lastExtraction, reviewRows, reviewConfirmed, matchingReviewedFile, legacyReviewData, legacyPackingReviewRequired, extractionSource, restoringWork]);

  useEffect(() => {
    if (!userId || !file || restoringWork) return;
    let active = true;
    setTeamHistoryStatus('팀 업로드 이력 보관 대기 중…');
    const timer = setTimeout(() => {
      let pending;
      try { pending = teamHistory.save({file, country, dateYear, invoiceUploadDate, lastExtraction, reviewRows, reviewConfirmed, matchingReviewed: matchingReviewedFile === file,
        legacyReviewData, legacyPackingReviewRequired, extractionSource}); }
      catch (error) { setTeamHistoryError(error.message); return; }
      pending.then(() => { if (active) { setTeamHistoryError(''); setTeamHistoryStatus('팀 업로드 이력 보관 완료 · 변경 이력에서 모든 직원이 불러올 수 있습니다.'); } })
        .catch(error => { if (active) { setTeamHistoryStatus(''); setTeamHistoryError(error.message); } });
    }, 800);
    return () => { active = false; clearTimeout(timer); };
  }, [teamHistory, userId, file, country, dateYear, invoiceUploadDate, lastExtraction, reviewRows, reviewConfirmed, matchingReviewedFile, legacyReviewData, legacyPackingReviewRequired, extractionSource, restoringWork, teamHistoryRetry]);

  useEffect(() => {
    if (!sharedRestore) return;
    // Stage the shared copy, never replace the currently active file automatically.
    setSavedWork(sharedRestore.snapshot);
    setStatus({type:'info',msg:'팀 업로드를 불러왔습니다. 아래 「매칭 작업 이어서 하기」를 눌러 복구하세요. 기존 작업은 팀 이력에서 다시 불러올 수 있습니다.'});
  }, [sharedRestore]);

  useEffect(() => {
    if (sharedRestore && savedWork === sharedRestore.snapshot) sharedRestoreButton.current?.focus();
  }, [sharedRestore, savedWork]);

  const restoreWork = async (options) => {
    const work=options?.snapshot||savedWork;
    if (!work || (!options?.snapshot && !workReady && work !== sharedRestore?.snapshot) || savingRef.current || processingRef.current) return;
    processingRef.current = true; setRestoringWork(true); setWorkError('');
    const version = ++readerVersion.current;
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
      const account = await response.json();
      if (!response.ok || !account.success || String(account.user?.userId) !== String(userId)) throw new Error('로그인 계정이 변경되었습니다. 페이지를 새로고침하세요.');
      const restoredFile = new File([work.file], work.fileName, { type: work.fileType, lastModified: work.lastModified });
      const [freshErp, records, hash, base64] = await Promise.all([
        requestErpMatches(), readPackingRecords(storage), sha256File(restoredFile),
        new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('보관된 원본 파일을 읽을 수 없습니다.')); reader.readAsDataURL(restoredFile); }),
      ]);
      if (readerVersion.current !== version) return;
      setInvoiceUploadDate(work.invoiceUploadDate || '');
      if (work.country === 'AU' && /\.pdf$/i.test(restoredFile.name)) {
        const mismatch = packingOriginMismatch(await readAwbPdf(base64).catch(() => null), work.country);
        if (readerVersion.current !== version) return;
        if (mismatch) throw new Error(mismatch);
      }
      const extraction = work.lastExtraction;
      if (!extraction?.result?.invoices?.length || !extraction?.sourceInvoices?.length) {
        resetResults(); setCountry(work.country); setDateYear(work.dateYear || ''); setScreen('upload'); setFile(restoredFile); setPdfBase64(base64);
        setErpMatches(freshErp); setAliases(records.aliases); setLatestShared(false); setSavedWork(null);
        setStatus({type:'info',msg:'원본 파일을 복구했습니다. 분석을 실행한 뒤 매칭을 확인하세요. 입고는 등록하지 않았습니다.'});
        return;
      }
      if (extraction.sourceHash !== hash) throw new Error('원본 파일과 분석 근거가 일치하지 않습니다. 다시 분석하세요.');
      if (/\.pdf$/i.test(restoredFile.name) && [...extraction.sourceInvoices, ...extraction.result.invoices].some(invoice => invoice.pdfSourceHash !== hash)) throw new Error('원본 파일과 분석 근거가 일치하지 않습니다. 다시 분석하세요.');
      const healedResultInvoices = work.country === 'CO'
        ? extraction.result.invoices.map(inv => {
          const healed = healColombiaInvoiceExtraction(inv);
          return /\.pdf$/i.test(restoredFile.name)
            ? bindPackingSourceReviewPolicy({ ...healed, pdfReviewRequired: true, pdfSourceHash: hash }, work.country, { source: extraction.source || 'cache' })
            : healed;
        })
        : extraction.result.invoices;
      const healedSourceInvoices = work.country === 'CO'
        ? extraction.sourceInvoices.map(inv => {
          const healed = healColombiaInvoiceExtraction(inv);
          return /\.pdf$/i.test(restoredFile.name)
            ? bindPackingSourceReviewPolicy({ ...healed, pdfReviewRequired: true, pdfSourceHash: hash }, work.country, { source: extraction.source || 'cache' })
            : healed;
        })
        : extraction.sourceInvoices;
      const healedExtraction = {
        ...extraction,
        sourceHash: hash,
        result: { ...extraction.result, invoices: healedResultInvoices },
        sourceInvoices: healedSourceInvoices,
      };
      let confirmed = work.reviewConfirmed;
      if (confirmed && /\.pdf$/i.test(restoredFile.name)) {
        try { healedExtraction.result.invoices.forEach(invoice => assertPackingSourceValues(invoice, work.country)); }
        catch { confirmed = false; }
      }
      autoAnalysisFile.current=null;
      setFileChoice(null);setHistoryOpen(false);
      setAwbFile(null);setAwbPdfBase64('');setAwbSourceHash('');setAwbValues(null);setAwbManualFields([]);setAwbReviewed(false);
      setCountry(work.country); setDateYear(work.dateYear || ''); setScreen('upload'); setFile(restoredFile); setPdfBase64(base64);
      setMatchingReviewedFile(work.matchingReviewed === true ? restoredFile : null);
      autoPromptedSources.current.add(healedExtraction);
      setLastExtraction(healedExtraction); setReviewRows(makePackingReviewRows(healedExtraction.sourceInvoices, work.country));
      if(work.country==='CN'&&healedExtraction.result.invoices.every(i=>i.source_format==='china_cloud_contract_xlsx'))setContractReceiptSource({country:'CN',file:restoredFile,invoices:healedExtraction.result.invoices,
        excels:buildPackingMatchPreview({invoices:healedExtraction.result.invoices,country:'CN',aliases:records.aliases,erpMatches:freshErp}),products:freshErp.products,reviewConfirmed:true,packingActive:true,truncated:false,invoiceUploadDate:work.invoiceUploadDate||''});
      setReviewConfirmed(confirmed); setReviewOpen(false); setReviewRevision(value => value + 1);
      setLegacyReviewData(work.legacyReviewData); setLegacyPackingReviewRequired(work.legacyPackingReviewRequired);
      setExtractionSource('저장 분석 재사용 · API 호출 없음'); setErpMatches(freshErp); setAliases(records.aliases); setLatestShared(false);
      setExcels([]); setGenerated({}); setGeneratedErp(null);
      setMatchPreview(buildPackingMatchPreview({ invoices: healedExtraction.result.invoices, country: work.country, aliases: records.aliases, erpMatches: freshErp }));
      setScrollMatchPreview(true); setSavedWork(null);
      setStatus({ type: 'info', msg: '보관한 작업을 복구하고 최신 팀 매칭을 다시 적용했습니다. 입고 업로드는 별도로 승인해야 합니다.' });
    } catch (error) { setWorkError(`작업 복구 실패: ${error.message}`); }
    finally { processingRef.current = false; setRestoringWork(false); }
  };

  useEffect(() => {
    if (!scrollMatchPreview || !matchPreview.length || screen !== 'upload') return;
    matchPreviewRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    setScrollMatchPreview(false);
  }, [scrollMatchPreview, matchPreview, screen]);

  useEffect(() => {
    if (typeof onReceiptSourceChange !== 'function') return;
    if(country==='CN'&&contractReceiptSource?.file===file){onReceiptSourceChange(contractReceiptSource);return;}
    if (country === 'NZ' && nzReceiptSource) {
      onReceiptSourceChange({...nzReceiptSource,invoiceUploadDate});
      return;
    }
    // Empty source suspends new adaptation; the workbench retains its records.
    if (latestShared || !file || !lastExtraction || !excels.length || !generatedErp || !reviewConfirmed) {
      onReceiptSourceChange({
        excels: EMPTY_RECEIPT_ITEMS,
        invoices: EMPTY_RECEIPT_ITEMS,
        country: '',
        file: null,
        products: generatedErp?.products || EMPTY_RECEIPT_ITEMS,
        reviewConfirmed: false,
        truncated: false,
        packingActive: Boolean(file),
        awb: null,
        invoiceUploadDate: '',
        audMarketRate: null,
        audMarketRateError: '',
      });
      return;
    }
    const activeForReceipt = partitionPackingInvoicesByDuplicates(lastExtraction.result.invoices, excludedDuplicateIndexes).activeInvoices;
    onReceiptSourceChange({
      excels,
      invoices: activeForReceipt,
      country,
      file,
      products: generatedErp.products,
      reviewConfirmed,
      truncated: lastExtraction.wasTruncated === true,
      packingActive: true,
      invoiceUploadDate,
      awb: (country === 'AU' || country === 'EC') && awbFile ? {
        fileName: awbFile.name, sourceHash: awbSourceHash, uploadDate: invoiceUploadDate,
        review: awbReview, confirmed: awbReviewed, manualFields: awbManualFields,
      } : null,
      audMarketRate: country === 'AU' ? audMarketRate : null,
      audMarketRateError: country === 'AU' ? audMarketRateError : '',
    });
  }, [country, nzReceiptSource, contractReceiptSource, generatedErp, excels, file, lastExtraction, excludedDuplicateIndexes, onReceiptSourceChange, reviewConfirmed, latestShared,
    invoiceUploadDate, awbFile, awbSourceHash, awbReview, awbReviewed, awbManualFields, audMarketRate, audMarketRateError]);

  const resetResults = () => {
    exportGeneration.current++;
    existingCheckSeq.current++;
    setExportReview(null);
    setExistingReceipts({ matchesByIndex: {}, orderYear: '', orderWeek: '', checking: false });
    setExcludedDuplicateIndexes(prev => (prev.size === 0 ? prev : new Set()));
    setMatchingReviewedFile(null);
    setFileChoice(null);setSelectingFile(false);setHistoryOpen(false);setHistoryError('');
    receiptIntent.current = false;
    setMatchTarget(null);setMatchError('');
    setMatchModalOpen(false);setMatchModalError('');
    setReviewRows(null); setReviewOpen(false); setReviewConfirmed(false);
    setReviewInitialTarget(null); setScrollMatchPreview(false);
    setNeedsAI(false); setExtractionSource(''); setPdfRetryJobId(null);
    setExcels([]); setMatchPreview([]); setGenerated({}); setGeneratedErp(null); setLastExtraction(null);
    setLegacyReviewData(null);
    setLegacyPackingReviewRequired(false);
    setPending([]); setAllNoMatches([]); setMismatches([]);
    setMismatchOverrides(new Set()); setSteps([]);
  };

  useEffect(() => {
    let active = true;
    loadXLSX().then(lib => { if (active) setXlsxLib(lib); })
      .catch(error => { if (active) setCatalogError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    ++sharedScopeVersion.current; ++catalogReaderVersion.current;
    setCatalogParsing(false); setCatalogReplaceConfirmed(false); setCatalogClearConfirm(false);
    setCatalogLoading(true); setSharedReady(false); setSharedError(null);
    Promise.all([readPackingRecords(storage),requestErpMatches(),requestFarmMatches()]).then(([records,erp,farmsData]) => {
      if (!active) return;
      setCatalog(records.catalog); setAliases(records.aliases);
      setErpMatches(erp); setFarmMatches(farmsData);
      if (lastExtraction) refreshPreviewForMappings({ nextAliases: records.aliases, nextErp: erp });
      else resetResults();
      setLatestShared(false); setSharedReady(true);
    }).catch(error => {
      if (active) setSharedError(error.message || String(error));
    }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [storage, reloadVersion]);

  useEffect(() => {
    if (!sharedReady || !erpMatches || typeof document === 'undefined' || !document.defaultView) return;
    const browser = document.defaultView;
    let active = true;
    const check = async () => {
      if (!active || document.visibilityState === 'hidden' || toolRoot.current?.closest('[hidden]') || savingRef.current || processingRef.current || revisionFlight.current) return;
      const scope = sharedScopeVersion.current, sequence = erpReadSequence.current;
      revisionFlight.current = true;
      try {
        const data = await requestErpMatches(undefined, true);
        if (!active || scope !== sharedScopeVersion.current || sequence !== erpReadSequence.current || savingRef.current || processingRef.current) return;
        if (data.scope === 'team' && data.revision !== erpMatches.revision) setLatestShared(true);
      } catch { /* A transient background failure never discards local work. */ }
      finally { revisionFlight.current = false; }
    };
    const timer = browser.setInterval(check, 30000);
    browser.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; browser.clearInterval(timer); browser.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [sharedReady, erpMatches]);

  // Commit UI only after shared save succeeds; serialize rapid confirmations.
  const runSharedWrite = async action => {
    if (savingRef.current || !sharedReady || processingRef.current || catalogParsing) return;
    const scope = sharedScopeVersion.current;
    savingRef.current = true; setSaving(true); setSharedError(null);
    ++erpReadSequence.current;
    try {
      await action();
    } catch (error) {
      if (sharedScopeVersion.current === scope) {
        setSharedError(error.message || String(error));
        setSharedReady(false); // reload revision before retrying after a conflict; keep drafts
        setCatalogReplaceConfirmed(false);
      }
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };

  const handleCatalogFile = async f => {
    if (!f || !xlsxLib || savingRef.current || processingRef.current || !sharedReady) return;
    const version = ++catalogReaderVersion.current;
    setCatalogParsing(true); setCatalogError(null);
    setCatalogDraft(null); setCatalogClearConfirm(false); setCatalogReplaceConfirmed(false); setCatalogMode('merge');
    try {
      const parsed = indexPackingCatalog(parseCatalog(xlsxLib, await f.arrayBuffer()));
      if (!parsed.items.length) throw new Error('Empty catalog.');
      if (catalogReaderVersion.current !== version) return;
      previewPackingCatalog(catalog, parsed); // reject before publishing an invalid draft
      if (catalogReaderVersion.current === version) setCatalogDraft({ catalog: parsed, fileName: f.name });
    } catch (error) {
      if (catalogReaderVersion.current === version) setCatalogError(error.message || String(error));
    } finally {
      if (catalogReaderVersion.current === version) setCatalogParsing(false);
    }
  };

  const cancelCatalogDraft = () => {
    ++catalogReaderVersion.current;
    setCatalogDraft(null); setCatalogParsing(false); setCatalogReplaceConfirmed(false); setCatalogClearConfirm(false);
  };

  const confirmCatalogDraft = () => {
    if (!catalogPreview || (catalogMode === 'replace' && !catalogReplaceConfirmed)) return;
    const next = catalogPreview[catalogMode];
    const scope = sharedScopeVersion.current;
    return runSharedWrite(async () => {
      await writePackingRecord(storage, PACKING_STORAGE_KEYS.catalog, { items: next.items, savedAt: next.savedAt });
      if (sharedScopeVersion.current !== scope) return;
      setCatalogError(null); setCatalog(next); cancelCatalogDraft(); resetResults();
    });
  };

  const clearCatalog = () => {
    if (!catalogClearConfirm) return;
    const scope = sharedScopeVersion.current;
    return runSharedWrite(async () => {
      await writePackingRecord(storage, PACKING_STORAGE_KEYS.catalog, null);
      if (sharedScopeVersion.current !== scope) return;
      setCatalog(null); cancelCatalogDraft(); resetResults();
    });
  };

  const refreshPreviewForMappings = ({ invoices = lastExtraction?.result?.invoices, nextAliases = aliases, nextErp = erpMatches } = {}) => {
    const nextPreview = invoices && nextErp ? buildPackingMatchPreview({ invoices, country, aliases: nextAliases, erpMatches: nextErp }) : null;
    if (nextPreview) setMatchPreview(nextPreview);
    // Mapping/catalog revisions invalidate generated bytes, but retain source-review drafts.
    setExcels([]); setGenerated({}); setGeneratedErp(null);
    setPending([]); setAllNoMatches([]); setMismatches([]);
    return nextPreview;
  };

  const rebuildWithAliases = currentAliases => refreshPreviewForMappings({ nextAliases: currentAliases });

  const importAliasesFile = async f => {
    if (!f || !xlsxLib) return;
    await runSharedWrite(async () => {
      const imported = parseAliasesXlsx(xlsxLib, await f.arrayBuffer());
      if (!Object.keys(imported).length) throw new Error(t.noMatchesFile);
      const newAliases = { ...aliases, ...imported };
      await savePackingAliases(storage, newAliases);
      setAliases(newAliases); rebuildWithAliases(newAliases);
      if (!lastExtraction) setStatus({ type: 'success', msg: t.matchesImported(Object.keys(imported).length) });
    });
  };

  // Export ALL current matches (base + learned) to a visible, editable Excel.
  const exportAliases = () => {
    if (!xlsxLib) return;
    try { exportAliasesXlsx(xlsxLib, aliases); } catch (e) { setStatus({ type: 'error', msg: t.errorPrefix + (e.message || e) }); }
  };

  const { countryLabels, cfg } = buildPackingCountryView(country, t);
  const autoAnalysisFile = useRef(null);
  const autoPreparedSources = useRef(new WeakSet());
  const handleAwbFile = async f => {
    if(fileChoice||selectingFile)return;
    if (!f || processingRef.current || savingRef.current) return;
    if (!file) { setStatus({ type: 'error', msg: '인보이스를 먼저 선택한 뒤 해당 인보이스의 AWB를 올리세요.' }); return; }
    if (f.size > PACKING_PDF_MAX_BYTES || !/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf')) {
      setStatus({ type: 'error', msg: 'AWB는 20MiB 이하 PDF 파일만 지원합니다.' }); return;
    }
    try {
      const [hash, base64] = await Promise.all([sha256File(f), new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('AWB PDF 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(f);
      })]);
      if (!base64) throw new Error('AWB PDF 파일에 데이터가 없습니다.');
      setAwbFile(f); setAwbPdfBase64(base64); setAwbSourceHash(hash);
      setAwbValues(null); setAwbManualFields([]); setAwbReviewed(false);
      if (country === 'EC') {
        const parsedLocal = await readAwbPdf(base64).then(pdfData => parseSupportAwbDocument(pdfData, { currency: 'USD' })).catch(() => null);
        if (parsedLocal && !parsedLocal._error) {
          setLocalAwbDocument(parsedLocal);
          setExcels([]); setGenerated({}); setGeneratedErp(null); setReviewConfirmed(false);
          if (lastExtraction?.result?.invoices?.length) {
            setStatus({ type: 'success', msg: `에콰도르 AWB(${parsedLocal.awb || f.name})를 로컬에서 읽었습니다. 아래 AWB 대조 확인을 체크하면 빈 AWB·중량·운임이 자동 반영됩니다.` });
            return;
          }
        } else {
          setLocalAwbDocument(null);
        }
      } else {
        setLocalAwbDocument(null);
      }
      resetResults();
      autoAnalysisFile.current = autoAnalyze ? file : null;
      setStatus({ type: 'info', msg: '인보이스와 AWB를 함께 분석합니다. GW·CW는 AWB 원문 대조를 확인하세요.' });
    } catch (error) { setStatus({ type: 'error', msg: error.message }); }
  };
  const readUploadHistory=async()=>{
    const response=await fetch('/api/import/tools/upload-history',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();
    if(!response.ok||!data.success||!Array.isArray(data.rows))throw Error(data.error||'업로드 이력을 확인하지 못했습니다. 자동 분석하지 않습니다. 다시 시도하세요.');
    return data.rows;
  };
  const cancelFileChoice=()=>{
    ++readerVersion.current;autoAnalysisFile.current=null;setFileChoice(null);
    setStatus({type:'info',msg:'새 파일 선택을 취소했습니다. 기존 작업은 그대로 유지됩니다.'});
    toolRoot.current?.querySelector('[role="button"][aria-label*="인보이스"]')?.focus();
  };
  const restoreAnalyzedUpload=async(row,version=++readerVersion.current)=>{
    if(processingRef.current||savingRef.current)return;
    autoAnalysisFile.current=null;setSelectingFile(true);setHistoryError('');
    try{
      const snapshot=await loadPackingHistory(row.id);
      if(readerVersion.current!==version)return;
      if(snapshot.country!==country||snapshot.lastExtraction?.sourceHash!==row.sourceHash
        ||!snapshot.lastExtraction?.result?.invoices?.length||!snapshot.lastExtraction?.sourceInvoices?.length)
        throw Error('저장 분석과 원본·국가가 일치하지 않습니다. 자동 재분석하지 않습니다.');
      setSelectingFile(false);
      await restoreWork({snapshot});
    }catch(error){if(readerVersion.current===version){setHistoryError(error.message);setStatus({type:'error',msg:`저장 분석 불러오기 실패: ${error.message} · 현재 작업을 유지합니다.`});}}
    finally{if(readerVersion.current===version)setSelectingFile(false);}
  };
  const showAnalyzedUploads=async()=>{
    const version=readerVersion.current;
    setHistoryOpen(true);setHistoryError('');setSelectingFile(true);
    try{const rows=await readUploadHistory();if(readerVersion.current===version)setHistoryRows(analyzedPackingUploads(rows,country));}
    catch(error){if(readerVersion.current===version)setHistoryError(error.message);}
    finally{if(readerVersion.current===version)setSelectingFile(false);}
  };
  const acceptSelectedFile=(f,version,cached=null,base64=null)=>{
    if(readerVersion.current!==version||processingRef.current||savingRef.current)return;
    setFileChoice(null);setHistoryOpen(false);
    setPdfBase64(null); resetResults(); setStatus(null); setFile(null);
    setContractReceiptSource(null);
    const uploadDate = seoulCalendarDate();
    setInvoiceUploadDate(uploadDate);
    setAudMarketRate(null); setAudMarketRateError('');
    if (country === 'AU') {
      fetch(`/api/import/receipts/aud-exchange-rate?date=${encodeURIComponent(uploadDate)}`, { credentials: 'same-origin', cache: 'no-store' })
        .then(async response => { const data = await response.json(); if (!response.ok || !data?.success) throw new Error(data?.error || 'AUD 환율을 조회하지 못했습니다.'); return data; })
        .then(data => {if(readerVersion.current===version)setAudMarketRate(data);})
        .catch(error => {if(readerVersion.current===version)setAudMarketRateError(error.message);});
    }
    setAwbFile(null); setAwbPdfBase64(''); setAwbSourceHash(''); setLocalAwbDocument(null); setAwbValues(null); setAwbManualFields([]); setAwbReviewed(false);
    autoAnalysisFile.current = autoAnalyze ? f : null;
    reusableExtraction.current=cached?{file:f,data:cached}:null;
    setFile(f);
    if(base64){setPdfBase64(base64);return;}
    const reader = new FileReader();
    reader.onload = () => {if (readerVersion.current === version) setPdfBase64(String(reader.result).split(',')[1]);};
    reader.onerror = () => {if (readerVersion.current === version) setStatus({ type: 'error', msg: '선택한 원본 파일을 읽지 못했습니다.' });};
    reader.readAsDataURL(f);
  };
  const handleFile = async (f) => {
    if (!f || processingRef.current || savingRef.current) return;
    if(country==='NZ')setInvoiceUploadDate(seoulCalendarDate());
    const version = ++readerVersion.current;
    autoAnalysisFile.current=null;setFileChoice(null);
    const isChinaExcel = country === 'CN' && /\.xlsx$/i.test(f.name);
    if (f.size > (isChinaExcel ? CHINA_INVOICE_MAX_BYTES : PACKING_PDF_MAX_BYTES)) {
      setStatus({ type: 'error', msg: isChinaExcel ? '중국 인보이스 Excel은 최대 50MiB까지 지원합니다.' : t.pdfLimit });
      return;
    }
    if (!isChinaExcel && (!/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf'))) {
      setStatus({ type: 'error', msg: country === 'CN' ? '중국 인보이스는 PDF 또는 XLSX 파일을 선택하세요.' : t.pdfOnly });
      return;
    }
    if (country === 'EC' || country === 'NL') {
      try {
        const localCheckBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
          reader.onerror = () => reject(new Error('선택한 원본 파일을 읽지 못했습니다.'));
          reader.readAsDataURL(f);
        });
        const localPdf = await readAwbPdf(localCheckBase64).catch(() => null);
        if (readerVersion.current !== version) return;
        if (localPdf && isAirWaybillDocument(localPdf)) {
          if (country === 'EC' && file) {
            await handleAwbFile(f);
          } else {
            const parsed = parseAwbFields(localPdf);
            setStatus({
              type: 'info',
              msg: country === 'EC'
                ? `이 파일은 항공운송장(AWB ${parsed.awb || f.name}) PDF입니다. 먼저 에콰도르 인보이스(CI) PDF를 선택한 뒤 아래 「AWB 항공운송장 PDF (선택)」에 올려 주세요.`
                : `이 파일은 항공운송장(AWB ${parsed.awb || f.name}) PDF입니다. 패킹리스트 변환에는 네덜란드 상업송장(CI / Factuur) PDF를 올려 주세요. AWB 중량·운임 대조는 도착원가 화면의 「AWB 업로드」에서 사용할 수 있습니다.`,
            });
          }
          return;
        }
      } catch { /* fall through to normal CI handling */ }
    }
    if (country === 'AU' || country === 'NZ') {
      setOriginPreview(null); setNzReceiptSource(null); setStatus(null); setSelectingFile(true);
      try {
        const base64 = await new Promise((resolve,reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(new Error('선택한 원본 파일을 읽지 못했습니다.'));
          reader.readAsDataURL(f);
        });
        const evidence = await readAwbPdf(base64).catch(error => {
          if (country === 'NZ') throw error;
          return null;
        });
        if (readerVersion.current !== version) return;
        const mismatch = packingOriginMismatch(evidence, country);
        if (mismatch) {
          resetResults(); setFile(null); setPdfBase64(null); setStatus({ type:'error', msg:mismatch });
          return;
        }
        if (country === 'NZ') {
          const invoice = inspectNzBloomInvoice(evidence);
          if (invoice) setOriginPreview({ ...invoice, file:f });
          else setStatus({ type:'error', msg:'지원하는 뉴질랜드 인보이스 서식이 아니거나 송장번호·수량·금액이 원문과 일치하지 않습니다. 분석 API는 호출하지 않았습니다.' });
          return;
        }
      } catch (error) {
        if (readerVersion.current === version) setStatus({type:'error',msg:error.message});
        return;
      } finally {
        if (readerVersion.current === version) setSelectingFile(false);
      }
    }
    if(isChinaExcel){
      setSelectingFile(true);setStatus(null);
      try{
        if(!xlsxLib)throw Error('Excel 읽기 도구가 준비되지 않았습니다. 잠시 후 다시 선택하세요.');
        const bytes=await f.arrayBuffer();
        const source=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(String(reader.result).split(',')[1]);
          reader.onerror=()=>reject(Error('선택한 원본 Excel을 읽지 못했습니다.'));
          reader.readAsDataURL(f);
        });
        if(readerVersion.current===version)setChinaSheetReview({file:f,book:xlsxLib.read(bytes,{type:'array',cellFormula:true}),base64:source,version});
      }catch(e){if(readerVersion.current===version)setStatus({type:'error',msg:e.message});}
      finally{if(readerVersion.current===version)setSelectingFile(false);}
      return;
    }
    setChinaSheetReview(null);
    if (autoAnalyze) {setSelectingFile(true);try {
      const sourceHash = await sha256File(f);
      const rows=await readUploadHistory();
      if (readerVersion.current !== version) return;
      const reuse=packingFileReuse(rows,{country,sourceHash,fileName:f.name});
      setHistoryRows(reuse.analyzed);
      if(reuse.exact){setSelectingFile(false);await restoreAnalyzedUpload(reuse.exact,version);return;}
      let base64=null;
      if(!isChinaExcel&&country!=='AU'){
        base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('원본 파일을 읽지 못했습니다.'));reader.readAsDataURL(f);});
        if(readerVersion.current!==version)return;
        const cached=await readCompletedPackingAnalysis({country,pdfBase64:base64});
        if(readerVersion.current!==version)return;
        if(cached){setSelectingFile(false);acceptSelectedFile(f,version,cached,base64);return;}
      }
      if(!reuse.previous){acceptSelectedFile(f,version,null,base64);return;}
      setFileChoice({file:f,sourceHash,previous:reuse.previous,version});
      setStatus({type:'info',msg:'파일명은 같지만 내용이 달라졌습니다. 사용할 분석을 선택하세요.'});
      return;
    } catch (error) { if (readerVersion.current === version) setStatus({type:'error',msg:error.message}); return; }
    finally{if(readerVersion.current===version)setSelectingFile(false);}}
    acceptSelectedFile(f,version);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  // Generate Excel files only after the user explicitly confirms source review.
  const buildExcels = (params) => {
    const { invoices, masterAwb, weekParsed, currentAliases, wasTruncated = false } = params;
    const sourceInvoices = Array.isArray(invoices) ? invoices : [];
    const legacyDetected = country === 'CN' && (params.legacyReviewRequired === true
      || lastExtraction?.legacyReviewRequired === true
      || sourceInvoices.some(isLegacyChinaInvoice));
    if (legacyDetected) {
      setExcels([]); setGenerated({}); setPending([]); setAllNoMatches([]); setMismatches([]);
      setStatus({ type: 'error', msg: LEGACY_CN_REVIEW_MESSAGE });
      throw new Error(LEGACY_CN_REVIEW_MESSAGE);
    }
    if (country === 'CN' && legacyPackingReviewRequired && params.legacyPackingReviewConfirmed !== true) {
      setExcels([]); setGenerated({});
      setStatus({ type: 'error', msg: '구형 중국 인보이스는 별도 GW·CW·운송비 검토를 확인한 뒤에만 생성할 수 있습니다.' });
      throw new Error('구형 중국 인보이스는 별도 GW·CW·운송비 검토를 확인한 뒤에만 생성할 수 있습니다.');
    }
    const unresolved = unresolvedExtractionIssues(sourceInvoices, params.extractionResult || lastExtraction?.result);
    if (unresolved.length) {
      setExcels([]); setGenerated({}); setPending([]); setAllNoMatches([]); setMismatches([]);
      setStatus({ type: 'error', msg: `추출 검토 항목 ${unresolved.length}건이 남아 있어 생성하지 않았습니다. 원문 확인 후 다시 검토하세요.` });
      throw new Error(`추출 검토 항목 ${unresolved.length}건이 남아 있습니다. ${packingValidationIssues(sourceInvoices, country).slice(0, 5).map(issue => issue.text).join('\n')}`);
    }
    const currentErp=params.erpMatches??erpMatches;
    const currentFarmMatches=params.farmMatches??farmMatches;
    if(!currentErp)throw new Error('전산 품목을 먼저 불러오세요.');
    const generators = { CO: genColombia, NL: genNL, CN: genChina, EC: genEcuador, TH: genThailand, AU: genAustralia, US: genUS, VN: genVN };
    const gen = generators[country];
    const allPending = [];
    const allNm = [];
    const allMismatches = [];
    const builtExcels = sourceInvoices.map((rawInv, idx) => {
      // All invoices in the same PDF share the same week-num.  The farm
      // abbreviation in the filename (e.g. _BAL_, _FLO_) keeps them unique.
      const inv = (country === 'EC' && awbFile && awbReviewed && awbReview?.ready)
        ? {
          ...rawInv,
          awb: awbReview.awb || rawInv.awb || '',
          gross_weight: awbReview.grossWeightKg ?? rawInv.gross_weight,
          vol_weight: awbReview.chargeableWeightKg ?? rawInv.vol_weight,
        }
        : rawInv;
      const fileNum = weekParsed.num;
      const opts = { catalog:packingErpCatalog(currentErp.products), masterAwb,
        aliases:packingErpAliases(country,currentAliases,currentErp.value,currentErp.products),
        farmMatches:currentFarmMatches?.value??null };
      const res = gen(packingReviewWriter(xlsxLib, inv, file?.name), inv, weekParsed.week, fileNum, opts);
      const reviewedProducts = (res.products || []).map(product => {
        const description = String(product.matchingDescription || product.sourceName || '').trim();
        const matchedName = String(product.matchedName || product.name || '').trim();
        const entry = (currentErp.value?.entries || []).find(item => item.country === country
          && item.sourceKey === packingSourceKey(description) && item.prodName === matchedName);
        const target = entry && currentErp.products.find(item => item.country === country
          && item.ProdKey === entry.prodKey && item.ProdName === entry.prodName && item.selectable);
        return target && product.viaAlias === true ? { ...product, erpMatch: {
          type: 'MANUAL', confirmed: true, prodKey: target.ProdKey, sourceDescription: description, matchedName,
        } } : product;
      });
      if (res.pending && res.pending.length > 0) allPending.push(...res.pending);
      if (res.noMatches && res.noMatches.length > 0) allNm.push(...res.noMatches);
      if (res.totalMismatch) allMismatches.push(res.totalMismatch);
      return { ...res, products: reviewedProducts, sourceInvoiceIdentity: packingInvoiceSourceIdentity(inv, idx), wasTruncated,
        invoiceTotals: packingInvoiceTotals(inv, country),
        grossWeight: packingWeight(inv, 'gw'),
        chargeableWeight: packingWeight(inv, 'cw') };
    });
    // Dedup pending/noMatches by aliasKey so the user sees each distinct
    // description only once, even if it appeared in multiple invoices/farms.
    const dedupedPending = distinctPackingVarieties(allPending);
    const dedupedNm = distinctPackingVarieties(allNm);
    if (new Set(builtExcels.map(ex => ex.name)).size !== builtExcels.length) {
      throw new Error('Duplicate output filenames. Verify invoice numbers.');
    }
    const newGenerated = {};
    builtExcels.forEach((ex) => { newGenerated[ex.name] = ex.buf; });
    exportGeneration.current++;
    setExportReview(null);
    setGenerated(newGenerated);
    // Dialog/catalog reads must not re-adapt and replace receipt workbench drafts.
    // Only an explicit generation/rebuild publishes a new receipt product snapshot.
    setGeneratedErp(currentErp);
    setExcels(builtExcels);
    setMatchPreview([]);
    setPending(dedupedPending);
    setAllNoMatches(dedupedNm);
    setMismatches(allMismatches);
    setMismatchOverrides(new Set());
    setSteps([
      { label: t.steps[0], state: 'done' },
      { label: t.steps[1], state: 'done' },
      { label: t.steps[2], state: 'done' },
    ]);
    let summary = `✓ ${builtExcels.length} packing list${builtExcels.length === 1 ? '' : 's'}.`;
    if (wasTruncated) summary += ' ' + t.summaryTruncated;
    if (dedupedPending.length > 0) summary += t.summaryPending(dedupedPending.length);
    if (dedupedNm.length > 0) summary += t.summaryNoMatch(dedupedNm.length);
    if (allMismatches.length > 0) summary += t.summaryMismatch(allMismatches.length);
    if (!wasTruncated && dedupedPending.length === 0 && dedupedNm.length === 0 && allMismatches.length === 0) summary += ' ' + t.summaryOk;
    const statusType = (wasTruncated || allMismatches.length > 0)
      ? 'error'
      : (dedupedPending.length > 0 || dedupedNm.length > 0 ? 'info' : 'success');
    setStatus({ type: statusType, msg: summary });
    return true;
  };


  const reloadErpMatches=async()=>{
    if(savingRef.current||processingRef.current)return;
    const scope=sharedScopeVersion.current;
    const sequence=++erpReadSequence.current;
    savingRef.current=true;setSaving(true);setMatchError('');
    try {
      const [ data, records, farmsData ] = await Promise.all([requestErpMatches(),readPackingRecords(storage),requestFarmMatches()]);
      if(scope!==sharedScopeVersion.current||sequence!==erpReadSequence.current)return;
      setErpMatches(data);setFarmMatches(farmsData);setAliases(records.aliases);
      refreshPreviewForMappings({ nextAliases: records.aliases, nextErp: data });
      setLatestShared(false);
      if (matchTarget?.origin === 'manager') {
        const entry = data.value?.entries?.find(e => e.country === matchTarget.country && e.sourceKey === packingSourceKey(matchTarget.description));
        if (!entry) { setMatchTarget(target => target ? {...target, requiresReload:true} : target); throw new Error('저장된 연결이 더 이상 없습니다. 창을 닫고 매칭 목록을 다시 확인하세요.'); }
        setMatchTarget(target => target ? {...target, currentName:entry.prodName, currentProdKey:entry.prodKey, expectedRevision:data.revision, requiresReload:false} : target);
      } else setMatchTarget(target=>{
        if (!target) return target;
        const entry = data.value?.entries?.find(e => e.country === country && e.sourceKey === packingSourceKey(target.description));
        return {...target,currentName:entry?.prodName,currentProdKey:entry?.prodKey,expectedRevision:data.revision,requiresReload:false};
      });
    }
    catch(error){if(scope===sharedScopeVersion.current){setMatchError(error.message);setStatus({type:'error',msg:error.message});}}
    finally{savingRef.current=false;setSaving(false);}
  };
  const openProductMatch=async product=>{
    if(needsInvoiceAllocation(country,product.sourceName||product.matchingDescription)){await prepareReceipt({allowAllocationReview:true});return;}
    if(savingRef.current||processingRef.current)return;
    const description=product.matchingDescription;
    if(!description){setStatus({type:'error',msg:'이 행의 원문 연결 정보가 없습니다. 파일을 다시 처리하세요.'});return;}
    const scope=sharedScopeVersion.current,version=readerVersion.current,sequence=++erpReadSequence.current;
    savingRef.current=true;setSaving(true);setMatchError('');
    try {
      const data=await requestErpMatches();
      if(scope!==sharedScopeVersion.current||version!==readerVersion.current||sequence!==erpReadSequence.current)return;
      if(data.revision!==erpMatches?.revision)setLatestShared(true);
      const current = data.value?.entries?.find(entry => entry.country === country && entry.sourceKey === packingSourceKey(description));
      setErpMatches(data);setMatchTarget({description,currentName:current?.prodName,currentProdKey:current?.prodKey,expectedRevision:data.revision});
    } catch(error){if(scope===sharedScopeVersion.current){setMatchError(error.message);setStatus({type:'error',msg:error.message});}}
    finally{savingRef.current=false;setSaving(false);}
  };
  const openInvoiceAllocation = () => prepareReceipt({ allowAllocationReview: true });
  const saveErpMatch=async (prodKey, inlineTarget)=>{
    const target=inlineTarget ?? matchTarget;
    if(savingRef.current||processingRef.current||!target||target.requiresReload||!erpMatches||(!lastExtraction&&target.origin!=='manager'))return {error:'현재 매칭을 저장할 수 없습니다. 다시 조회하세요.'};
    const scope=sharedScopeVersion.current;
    const fileVersion=readerVersion.current;
    savingRef.current=true;setSaving(true);setMatchError('');
    ++erpReadSequence.current;
    try {
      const data=await requestErpMatches({country:target.country ?? country,description:target.description,prodKey,expectedRevision:target.expectedRevision});
      if(scope!==sharedScopeVersion.current)return {error:'작업 범위가 변경됐습니다. 다시 조회하세요.'};
      setErpMatches(data);
      const nextPreview = refreshPreviewForMappings({ nextErp: data });
      if (file && fileVersion === readerVersion.current && target.origin !== 'manager') {
        const rows = nextPreview?.flatMap(excel => excel.products || []) || [];
        setMatchingReviewedFile(rows.length && rows.every(row => !packingMatchReview(row, data.products, country).needsReview) ? file : null);
      }
      setMatchTarget(null);
      setLatestShared(false);
      if (target.origin === 'manager') setStatus({type:'success',msg:'팀 공용 DB 매칭을 수정했습니다. 다음 업로드와 현재 매칭표에 적용되며, 이미 저장된 입고 문서는 변경하지 않습니다.'});
      return {success:true};
    } catch(error) {
      if(scope===sharedScopeVersion.current){
        setMatchError(error.message);
        if(error.statusCode===409){
          setLatestShared(true);setMatchTarget(target=>target?{...target,requiresReload:true}:target);
          try{const latest=await requestErpMatches();if(scope===sharedScopeVersion.current)setErpMatches(latest);}catch{/* Retain selection and conflict message. */}
          if(scope===sharedScopeVersion.current)setMatchError(error.message+' · 최신 팀 매칭 적용 후 선택을 다시 확인하세요.');
        }
      }
      return {error:error.message};
    }
    finally {savingRef.current=false;setSaving(false);}
  };

  const openSavedErpMatch=async entry=>{
    if(savingRef.current||processingRef.current||!sharedReady||catalogParsing||restoringWork)return;
    const scope=sharedScopeVersion.current,version=readerVersion.current,sequence=++erpReadSequence.current;
    savingRef.current=true;setSaving(true);setMatchError('');
    try {
      const data=await requestErpMatches();
      if(scope!==sharedScopeVersion.current||version!==readerVersion.current||sequence!==erpReadSequence.current)return;
      setErpMatches(data);
      if(data.revision!==erpMatches?.revision)setLatestShared(true);
      const current=data.value?.entries?.find(e=>e.country===entry.country&&e.sourceKey===entry.sourceKey);
      if(!current)throw new Error('저장된 연결이 더 이상 없습니다. 최신 목록을 확인하세요.');
      setMatchTarget({origin:'manager',country:current.country,description:current.description,currentName:current.prodName,currentProdKey:current.prodKey,expectedRevision:data.revision});
    } catch(error){if(scope===sharedScopeVersion.current){setMatchError(error.message);setStatus({type:'error',msg:error.message});}}
    finally{savingRef.current=false;setSaving(false);}
  };

  const clearAliases = () => runSharedWrite(async () => {
    await writePackingRecord(storage, PACKING_STORAGE_KEYS.aliases, null);
    const records = await readPackingRecords(storage);
    setCatalog(records.catalog); setAliases(records.aliases); resetResults();
  });

  const deleteAlias = key => runSharedWrite(async () => {
    const newAliases = { ...aliases };
    if (ALL_SEED_ALIASES[key] !== undefined) newAliases[key] = ALL_SEED_ALIASES[key];
    else delete newAliases[key];
    await savePackingAliases(storage, newAliases);
    setAliases(newAliases); rebuildWithAliases(newAliases);
  });

  const revalidateSavedResponse = async () => {
    const validationVersion=readerVersion.current,validationScope=sharedScopeVersion.current;
    if(processingRef.current||!pdfBase64||country!=='CO')return;
    processingRef.current=true;setProcessing(true);
    setStatus({type:'info',msg:'저장 응답으로 파서를 재검증합니다. AI·입고 저장은 호출하지 않습니다.'});
    try{
      const extraction=await extractPackingDocument({country,pdfBase64,retryJobId:pdfRetryJobId,revalidateOnly:true});
      if(readerVersion.current!==validationVersion||sharedScopeVersion.current!==validationScope)return;
      processingRef.current=false;setProcessing(false);
      await process(false,null,extraction);
    }catch(error){setStatus({type:'error',msg:error.message});}
    finally{processingRef.current=false;setProcessing(false);}
  };
  const process = async (allowAI = true, retryJobId = null, savedExtraction = null) => {
    if(fileChoice||selectingFile)return;
    // PDF uploads use Claude after checking durable results. Failed jobs require
    // the separate explicit retry action; OCR is not an automatic fallback.
    if (!pdfBase64 || !xlsxLib || !sharedReady || savingRef.current || processingRef.current || catalogParsing) return;
    const parsed = parseWeekFromFilename(file.name);
    if (!parsed) {
      setStatus({ type: 'error', msg: t.errWeek(file.name) });
      return;
    }
    processingRef.current = true; setProcessing(true);
    ++erpReadSequence.current;
    const version = readerVersion.current;
    const scope = sharedScopeVersion.current;
    const isCurrent = () => readerVersion.current === version && sharedScopeVersion.current === scope;
    resetResults();
    setSteps([
      { label: t.steps[0], state: 'active' },
      { label: t.steps[1], state: '' },
      { label: t.steps[2], state: '' },
    ]);
    setStatus({ type: 'info', msg: t.processing });
    try {
      const sourceHashPromise = sha256File(file);
      const [freshErp,freshRecords,freshFarms,sourceHash]=await Promise.all([requestErpMatches(),readPackingRecords(storage),requestFarmMatches(),sourceHashPromise]);
      if(!isCurrent())return;
      setErpMatches(freshErp);setFarmMatches(freshFarms);setAliases(freshRecords.aliases);setLatestShared(false);
      let extraction;
      if(savedExtraction){extraction=savedExtraction;}
      else if(reusableExtraction.current?.file===file){
        extraction={data:reusableExtraction.current.data,source:'cache'};reusableExtraction.current=null;
      } else if (country === 'CN' && /\.xlsx$/i.test(file.name)) {
        try {
          const selected=selectedChinaSheet.current;
          extraction = { source: 'local', data: parseChinaInvoiceWorkbook(xlsxLib, pdfBase64, selected?.file===file?{sheetName:selected.name}:undefined) };
        } catch (modernError) {
          if(selectedChinaSheet.current?.file===file)throw modernError;
          try {
            const workbook = xlsxLib.read(pdfBase64, { type: 'base64', cellFormula: true });
            const candidates = findLegacyChinaInvoiceCandidates(xlsxLib, workbook);
            if (!candidates.length) throw modernError;
            extraction = { source: 'local', data: parseChinaLegacyInvoiceWorkbook(xlsxLib, workbook) };
          } catch (legacyError) {
            if (legacyError === modernError) throw modernError;
            throw legacyError;
          }
        }
      } else {
        extraction = await extractPackingDocument({country,pdfBase64,awbPdfBase64:(country==='AU'||country==='EC')?awbPdfBase64:null,readPdf:readAwbPdf,allowAI:true,retryJobId,
          onProgress: progress => {
            if (!isCurrent()) return;
            const label=progress.stage==='SUBMITTING'?'PDF 분석 접수 중':'AI 분석 중 · 결과 확인 중';
            setSteps([{label,state:'active'}]);
            setStatus({type:'info',msg:progress.stage==='SUBMITTING'
              ? '분석 작업을 접수합니다. 원본 파일은 유지됩니다.'
              : progress.total ? `PDF 구간 ${progress.completed}/${progress.total} 완료 · ${progress.stage==='VALIDATING'?'누락·중복·총금액 검증 중':`${progress.current}번째 구간 분석 중`}. 완료 구간은 재사용하며 결과 조회는 AI를 다시 호출하지 않습니다.`
              : `AI 분석 결과를 확인하고 있습니다${progress.elapsedSeconds ? ` (${progress.elapsedSeconds}초 경과)` : ''}. 결과 조회는 AI를 다시 호출하지 않습니다.`});
          }});
      }
      if (!isCurrent()) return;
      if(extraction.needsAI){
        setNeedsAI(true);setSteps([]);
        setStatus({type:'info',msg:t.localUnavailable});return;
      }
      const data=extraction.data;
      const localContract=country==='CN'&&extraction.source==='local'&&Array.isArray(data?.content)
        ? JSON.parse(data.content.find(c=>c.type==='text')?.text||'null') : null;
      if(localContract?.receiptOnly===true&&localContract.invoices?.every(i=>i.source_format==='china_cloud_contract_xlsx')){
        const invoices=localContract.invoices.map(i=>({...i,pdfSourceHash:sourceHash}));
        const previews=buildPackingMatchPreview({invoices,country,aliases:freshRecords.aliases,erpMatches:freshErp});
        setLastExtraction({result:{invoices},sourceInvoices:invoices,masterAwb:'',weekParsed:parsed,wasTruncated:false,sourceHash});
        setContractReceiptSource({file,country:'CN',invoices,excels:previews,products:freshErp.products,reviewConfirmed:true,truncated:false,packingActive:true,invoiceUploadDate});
        setStatus({type:'success',msg:'CLOUD Contract 상품·포장비·비용·총액 검증 완료. 입고 작업에서 참조번호·연도·품목을 확인하세요. 박스와 GW/CW는 미기재로 유지하며 패킹 파일은 만들지 않습니다.'});
        setSteps([{label:'Contract 원문 8열 확인',state:'done'},{label:'상품·포장비·3개 비용·TOTAL 대조',state:'done'}]);
        focusReceipt();return;
      }
      const sourceLabel=extraction.source==='saved-response'?'저장 응답 재검증 · API 호출 없음':extraction.source==='free-ocr'?'이전 OCR 결과 재사용':extraction.source==='local'?t.sourceLocal:extraction.source==='cache'?t.sourceCache:t.sourceAI;
      setExtractionSource(sourceLabel+(extraction.source==='ai'&&extraction.cacheSaved===false?' · '+t.cacheNotSaved:''));
      setSteps([
        { label: t.steps[0], state: 'done' },
        { label: sourceLabel, state: 'done' },
        { label: t.steps[2], state: 'active' },
      ]);
      const directLegacy = country === 'CN' ? chinaLegacyReviewPayload(data) : null;
      if (directLegacy) {
        const sourceInvoices = directLegacy.invoices || [];
        let result = directLegacy.result || { invoices: sourceInvoices, extractionIssues: directLegacy.extractionIssues || [] };
        if (Array.isArray(data?.content)) {
          try { result = parsePackingResponse(data, 'CN').result; } catch { /* preserve the explicit source-review payload */ }
        }
        const normalizedSources = (result.invoices?.some(isLegacyChinaInvoice) ? result.invoices : sourceInvoices)
          .map(invoice => /\.pdf$/i.test(file?.name || '') ? { ...invoice, pdfReviewRequired: true, pdfSourceHash: sourceHash } : invoice);
        result = { ...result, invoices: normalizedSources };
        setLastExtraction({ result, sourceInvoices: normalizedSources, masterAwb: result.master_awb || '', weekParsed: parsed,
          wasTruncated: false, legacyReviewRequired: true, sourceHash });
        setLegacyReviewData({ ...directLegacy, invoices: normalizedSources });
        setExcels([]); setGenerated({});
        setStatus({ type: 'error', msg: LEGACY_CN_REVIEW_MESSAGE });
        setSteps([{ label: t.steps[0], state: 'done' }, { label: '중국 구형 원문 검토 전용', state: 'done' }]);
        return;
      }
      const { result, wasTruncated } = parsePackingResponse(data, country);
      result.invoices=result.invoices.map(invoice=>reconcileInvoiceSupplier(invoice,country,extraction.localSource));
      const invoices = (result.invoices || []).map(invoice => {
        const withSource = /\.pdf$/i.test(file?.name || '')
          ? { ...invoice, pdfReviewRequired: true, pdfSourceHash: sourceHash } : invoice;
        return bindPackingSourceReviewPolicy(withSource, country, { source: extraction.source });
      });
      result.invoices = invoices;
      const masterAwb = result.master_awb || (invoices[0] && invoices[0].awb) || '';
      if (invoices.length === 0) throw new Error(t.noInvoices);
      const legacyData = country === 'CN' ? chinaLegacyReviewPayload(data, result) : null;
      // Save extraction for potential re-build after alias updates
      setLastExtraction({ result, sourceInvoices: invoices, masterAwb, weekParsed: parsed, wasTruncated,
        legacyReviewRequired: Boolean(legacyData), sourceHash });
      setMatchPreview(buildPackingMatchPreview({ invoices, country, aliases: freshRecords.aliases, erpMatches: freshErp }));
      setScrollMatchPreview(true);
      if (legacyData) {
        setLegacyReviewData(legacyData);
        setExcels([]); setGenerated({});
        setStatus({ type: 'error', msg: LEGACY_CN_REVIEW_MESSAGE });
        setSteps([{ label: t.steps[0], state: 'done' }, { label: sourceLabel, state: 'done' }, { label: '구형 중국 검토 전용 · 생성 차단', state: 'done' }]);
        return;
      }
      setLegacyReviewData(null);
      const unresolved = unresolvedExtractionIssues(invoices, result);
      setReviewRows(makePackingReviewRows(invoices, country)); setReviewOpen(false);
      if (unresolved.length) {
        setExcels([]); setGenerated({}); setGeneratedErp(null);
        const rows = invoices.reduce((sum, invoice) => sum + (country === 'NL' ? invoice.lines || [] : invoice.products || []).length, 0);
        setSteps([{ label: t.steps[0], state: 'done' }, { label: sourceLabel, state: 'done' }, { label: 'DB 매칭 미리보기 준비 · 검토 대기', state: 'done' }]);
        setStatus({ type: 'info', msg: `DB 매칭 미리보기 ${rows}행 · 추출 검토 ${unresolved.length}건은 인식값 확인 전까지 패킹을 생성하지 않습니다.` });
        return;
      }
      setExcels([]); setGenerated({}); setGeneratedErp(null);
      const rows = invoices.reduce((sum, invoice) => sum + (country === 'NL' ? invoice.lines || [] : invoice.products || []).length, 0);
      setSteps([{ label: t.steps[0], state: 'done' }, { label: sourceLabel, state: 'done' }, { label: 'DB 품목 매칭 준비', state: 'done' }]);
      setStatus({ type: 'info', msg: `DB 매칭 미리보기 ${rows}행 · 원본 품명 옆 DB 품목을 모두 연결한 뒤 「다음 · 입고 준비」를 누르세요.` });
    } catch (e) {
      if (isCurrent()) {
        setStatus({ type: 'error', msg: t.errorPrefix + e.message });
        setSteps([{label:'인보이스 분석 중단 · 파일 유지',state:'error'}]);
        if (allowAI===true || allowAI==='auto') setNeedsAI(true);
        setPdfRetryJobId(e.pdfRetryJobId || null);
      }
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (autoAnalysisFile.current !== file || !file || !pdfBase64 || !xlsxLib || !sharedReady
      || saving || processing || catalogParsing) return;
    autoAnalysisFile.current = null;
    process('auto');
  }, [file, pdfBase64, awbPdfBase64, country, xlsxLib, sharedReady, saving, processing, catalogParsing]);

  const duplicatePartition = useMemo(
    () => partitionPackingInvoicesByDuplicates(lastExtraction?.result?.invoices || [], excludedDuplicateIndexes),
    [lastExtraction?.result?.invoices, excludedDuplicateIndexes],
  );
  const activeInvoices = duplicatePartition.activeInvoices;
  const activeOriginalIndexes = duplicatePartition.activeOriginalIndexes;
  const activeMatchPreview = useMemo(() => {
    if (!excludedDuplicateIndexes.size) return matchPreview;
    return matchPreview.filter((item, idx) => !excludedDuplicateIndexes.has(item?.sourceInvoiceIdentity?.sourceInvoiceIndex ?? item?.sourceInvoiceIndex ?? idx));
  }, [matchPreview, excludedDuplicateIndexes]);
  const existingMatchesList = useMemo(
    () => Object.values(existingReceipts.matchesByIndex || {}).sort((a, b) => a.index - b.index),
    [existingReceipts.matchesByIndex],
  );
  const toggleDuplicateExclusion = index => {
    setExcludedDuplicateIndexes(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setExcels([]); setGenerated({}); setGeneratedErp(null); setReviewConfirmed(false);
  };

  const sourceReviewBlocked = () => {
    if (country === 'AU' && (!awbFile || !awbReview?.ready || !awbReviewed)) return true;
    if (country === 'EC' && awbFile && (!awbReview?.ready || !awbReviewed)) return true;
    if (!/\.pdf$/i.test(file?.name || '')) return false;
    try {
      if (!activeInvoices.length) return true;
      activeInvoices.forEach(invoice => assertPackingSourceValues(invoice, country));
      return false;
    } catch { return true; }
  };
  const isBlocked = excel => packingLegacyExportBlocked(excel, generatedErp?.products, country) || latestShared || !sharedReady || saving || processing || !reviewConfirmed || sourceReviewBlocked() || isPackingDownloadBlocked(excel, {
    pending, noMatches: allNoMatches, overrides: mismatchOverrides,
    truncated: lastExtraction?.wasTruncated,
  });

  const savePackingFile = (name, blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadPackingFiles = async (names, confirmations = {}) => {
    if (exportInFlight.current || names.some(name => !generated[name] || isBlocked(excels.find(ex => ex.name === name)))) return;
    const generation = exportGeneration.current;
    const fileVersion = readerVersion.current;
    const isCurrent = () => generation === exportGeneration.current && fileVersion === readerVersion.current;
    const files = [];
    const issues = [];
    exportInFlight.current = true;
    setExportReview(null);
    try {
      for (const name of names) {
        let blob = new Blob([generated[name]], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        if (country === 'EC' || country === 'US') {
          const workbook = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('생성한 패킹 엑셀을 읽지 못했습니다.'));
            reader.readAsDataURL(blob);
          });
          if (!isCurrent()) return;
          const result = await fetch('/api/import/tools/packing-export', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ country, workbook, confirmations:confirmations[name] }), signal: AbortSignal.timeout(15000),
          });
          if (!result.ok) {
            const error = await result.json().catch(() => ({}));
            if (Array.isArray(error.issues) && error.issues.length) {
              issues.push(...error.issues.map(issue=>({...issue,fileName:name})));
              continue;
            }
            throw new Error(`${name} · ${error.error || '패킹 엑셀 수량 검증을 완료하지 못했습니다.'}`);
          }
          blob = await result.blob();
        }
        if (!isCurrent()) return;
        files.push({ name, blob });
      }
      if (issues.length && isCurrent()) {
        setExportReview({names, confirmations, issues});
        return;
      }
      files.forEach(({ name, blob }, index) => setTimeout(() => {
        if (isCurrent()) savePackingFile(name, blob);
      }, index * 250));
    } catch (error) {
      if (isCurrent()) setStatus({ type: 'error', exportBlocked: true, msg: error.message || '패킹 엑셀 다운로드를 다시 시도하세요.' });
    } finally {
      exportInFlight.current = false;
    }
  };
  const dl = name => downloadPackingFiles([name]);
  const dlAll = () => downloadPackingFiles(Object.keys(generated));

  const statusBg = status?.type === 'error' ? '#fde8e8' : status?.type === 'success' ? '#e8f5ee' : '#e8f0fe';
  const statusBorder = status?.type === 'error' ? '#f8b4b4' : status?.type === 'success' ? '#84e1bc' : '#c3d3fb';
  const statusColor = status?.type === 'error' ? '#c81e1e' : status?.type === 'success' ? '#057a55' : '#2457c5';

  const closeReview = () => { setReviewOpen(false); setTimeout(() => reviewButtonRef.current?.focus(), 0); };
  const focusReceipt = () => {
    onContinue?.(); return setTimeout(() => {
    const target = toolRoot.current?.ownerDocument?.getElementById(costOnly ? 'packing-cost-stage' : 'packing-receipt-stage');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  }, 200);
  };
  const receiptStatus = excels.length ? packingReceiptMatchState({ snapshot: receiptMatchState, file, excels,
    invoices: activeInvoices, country, products: erpMatches?.products || [] }) : null;
  const receiptMatches = receiptStatus?.byRow || new Map();
  const visiblePreviewOrExcels = excels.length ? excels : activeMatchPreview;
  const matchingRows = visiblePreviewOrExcels.flatMap(excel => excel.products || []);
  const matchingProducts = excels.length ? generatedErp?.products || [] : erpMatches?.products || [];
  const remainingMatches = visiblePreviewOrExcels.flatMap((excel, excelIndex) =>
    (excel.products || []).map((row, rowIndex) => effectivePackingMatchReview(
      packingMatchReview(row, matchingProducts, country),
      receiptMatches.get(`${excel.sourceInvoiceIdentity?.sourceInvoiceIndex ?? excelIndex}:${rowIndex}`)
    ))).filter(review => review.needsReview && review.status !== 'ALLOCATION').length;
  const allocationCount = receiptStatus?.valid && receiptStatus.allocationPending === 0 ? 0
    : matchingRows.filter(row => needsInvoiceAllocation(country,row.sourceName||row.matchingDescription)).length;
  const matchingComplete = matchingRows.length > 0 && remainingMatches === 0;
  const validationIssues = packingValidationIssues(lastExtraction?.result?.invoices || [], country)
    .filter(issue => !excludedDuplicateIndexes.has(issue.invoiceIndex));
  const matchingNeeds = useMemo(() => {
    if (!activeInvoices.length || !country) {
      return { unmatchedFarms: [], unmatchedProducts: [], quantityIssues: [], totalCount: 0 };
    }
    return collectUploadMatchingNeeds({
      country,
      invoices: activeInvoices,
      excels: visiblePreviewOrExcels,
      products: matchingProducts,
      farms: farmMatches?.farms || [],
      farmMatches: farmMatches?.value || null,
      receiptMatches,
      mismatches,
    });
  }, [country, activeInvoices, visiblePreviewOrExcels, matchingProducts, farmMatches, receiptMatches, mismatches]);

  useEffect(() => {
    if (!lastExtraction || processing || saving || !sharedReady || legacyReviewData) return;
    if (autoPromptedSources.current.has(lastExtraction)) return;
    autoPromptedSources.current.add(lastExtraction);
    if (matchingNeeds.totalCount > 0) {
      setMatchModalError('');
      setMatchModalOpen(true);
    }
  }, [lastExtraction, matchingNeeds.totalCount, processing, saving, sharedReady, legacyReviewData]);

  const handleSaveUploadMatches = async ({ farmEntries = [], productEntries = [], rowEdits = {}, invoiceEdits = {} }) => {
    if (savingRef.current || processingRef.current || !lastExtraction || !erpMatches) return;
    const scope = sharedScopeVersion.current;
    const fileVersion = readerVersion.current;
    savingRef.current = true;
    setSaving(true);
    setMatchModalError('');
    ++erpReadSequence.current;
    try {
      let nextErp = erpMatches;
      let nextFarms = farmMatches;

      if (farmEntries.length > 0) {
        const latestFarms = await requestFarmMatches();
        nextFarms = await requestFarmMatches({
          entries: farmEntries,
          expectedRevision: latestFarms.revision ?? 0,
        });
        if (scope !== sharedScopeVersion.current) return;
        setFarmMatches(nextFarms);
      }

      if (productEntries.length > 0) {
        const latestErp = await requestErpMatches();
        nextErp = await requestErpMatches({
          entries: productEntries,
          expectedRevision: latestErp.revision ?? 0,
        });
        if (scope !== sharedScopeVersion.current) return;
        setErpMatches(nextErp);
      }

      let nextInvoices = lastExtraction.result.invoices;
      let nextSourceInvoices = lastExtraction.sourceInvoices;
      let nextResult = lastExtraction.result;
      let quantityApplied = false;

      if (Object.keys(rowEdits).length > 0 || Object.keys(invoiceEdits).length > 0) {
        const mappedRowEdits = {};
        for (const [key, val] of Object.entries(rowEdits)) {
          const [invIdxStr, lineIdxStr] = key.split(':');
          const origIdx = activeOriginalIndexes[Number(invIdxStr)] ?? Number(invIdxStr);
          mappedRowEdits[`${origIdx}:${lineIdxStr}`] = val;
        }
        const mappedInvoiceEdits = {};
        for (const [key, val] of Object.entries(invoiceEdits)) {
          const origIdx = activeOriginalIndexes[Number(key)] ?? Number(key);
          mappedInvoiceEdits[String(origIdx)] = val;
        }
        const edited = applyUploadQuantityEdits({
          sourceInvoices: lastExtraction.sourceInvoices,
          result: lastExtraction.result,
          country,
          rowEdits: mappedRowEdits,
          invoiceEdits: mappedInvoiceEdits,
        });
        if (edited.changed) {
          quantityApplied = true;
          nextInvoices = edited.invoices;
          nextSourceInvoices = edited.invoices;
          nextResult = edited.result;
          setReviewRows(makePackingReviewRows(nextInvoices, country));
        }
      }

      const nextPreview = buildPackingMatchPreview({
        invoices: nextInvoices,
        country,
        aliases,
        erpMatches: nextErp,
      });
      setMatchPreview(nextPreview);

      const updatedExtraction = {
        ...lastExtraction,
        result: nextResult,
        sourceInvoices: nextSourceInvoices,
      };
      // Prevent re-opening the modal on our own saved extraction unless unresolved items remain
      const remaining = collectUploadMatchingNeeds({
        country,
        invoices: nextInvoices,
        excels: nextPreview,
        products: nextErp.products || [],
        farms: nextFarms?.farms || [],
        farmMatches: nextFarms?.value || null,
        receiptMatches,
        mismatches: [],
      });
      autoPromptedSources.current.add(updatedExtraction);
      setLastExtraction(updatedExtraction);
      setExcels([]);
      setGenerated({});
      setGeneratedErp(null);
      setLatestShared(false);

      if (file && fileVersion === readerVersion.current) {
        const allRows = nextPreview.flatMap(ex => ex.products || []);
        setMatchingReviewedFile(allRows.length && allRows.every(row => !packingMatchReview(row, nextErp.products, country).needsReview) ? file : null);
      }

      if (remaining.totalCount === 0) {
        setMatchModalOpen(false);
        setStatus({
          type: 'success',
          msg: `농장 ${farmEntries.length}건 · 품목 ${productEntries.length}건${quantityApplied ? ' · 수량 대조 보정' : ''} 저장 완료. 다음 업로드부터 자동 매칭됩니다.`,
        });
      } else {
        setMatchModalOpen(false);
        setStatus({
          type: 'info',
          msg: `선택한 매칭을 저장했습니다. 남은 확인 항목 ${remaining.totalCount}건은 상단 알림 배너 또는 아래 표에서 이어서 연결하세요.`,
        });
      }
    } catch (err) {
      if (scope === sharedScopeVersion.current) {
        setMatchModalError(err.message || '매칭 저장 중 오류가 발생했습니다. 입력값은 유지됩니다.');
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const openValidationIssue = issue => {
    setReviewInitialTarget({ invoiceIndex: issue.invoiceIndex, field: issue.field, lineIndex: issue.lineIndex });
    setReviewOpen(true);
  };
  const prepareReceipt = async ({ allowAllocationReview = false } = {}) => {
    const blockedReason = packingPreparationBlockReason({
      sharedReady, saving: savingRef.current, processing: processingRef.current, latestShared,
      matchingComplete, remainingMatches, allowAllocationReview, allocationCount,
    });
    if (blockedReason) {
      setStatus({ type: 'error', msg: blockedReason });
      recordBlocked(blockedReason,'PREPARE_BLOCKED');
      notifyPackingBlocked(blockedReason);
      if (matchingNeeds.totalCount > 0) setMatchModalOpen(true);
      return;
    }
    receiptIntent.current = true;
    processingRef.current = true; setProcessing(true);
    const version = readerVersion.current;
    try {
      let result = lastExtraction.result;
      if (result.invoices.some(needsPackingWeekDate)) {
        const explicitYear = file?.name?.match(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/)?.[1];
        const scope = packingWeekScope(explicitYear || dateYear, `${lastExtraction.weekParsed.week}-${lastExtraction.weekParsed.num}`);
        const response = await fetch(`/api/import/packing-week-date?orderYear=${scope.orderYear}&orderWeek=${scope.orderWeek}`, { cache: 'no-store' });
        const data = await response.json();
        if (version !== readerVersion.current) return;
        if (!response.ok || !data.success) throw new Error(data.error || '차수 기준일을 조회하지 못했습니다.');
        const invoices = result.invoices.map(invoice => applyPackingWeekDate(invoice, data.calendar, scope));
        result = { ...result, invoices };
        const sourceInvoices = lastExtraction.sourceInvoices.map(invoice => applyPackingWeekDate(invoice, data.calendar, scope));
        setLastExtraction(current => ({ ...current, result, sourceInvoices }));
        setReviewRows(makePackingReviewRows(invoices, country));
        setMatchPreview(buildPackingMatchPreview({ invoices, country, aliases, erpMatches }));
      }
      const activeForBuild = partitionPackingInvoicesByDuplicates(result.invoices, excludedDuplicateIndexes).activeInvoices;
      if (!activeForBuild.length) {
        throw new Error('신규로 입고 진행할 송장이 없습니다. (전체 송장이 기입고 완료 상태입니다.)');
      }
      const activeResult = excludedDuplicateIndexes.size ? { ...result, invoices: activeForBuild } : result;
      if (/\.pdf$/i.test(file?.name || '')) activeForBuild.forEach(invoice => assertPackingSourceValues(invoice, country));
      if (!excels.length && buildExcels({ invoices: activeForBuild,
        masterAwb: lastExtraction.masterAwb, weekParsed: lastExtraction.weekParsed,
        currentAliases: aliases, wasTruncated: lastExtraction.wasTruncated,
        extractionResult: activeResult }) === false) return;
      setReviewConfirmed(true);
      receiptIntent.current = false;
      setStatus({ type: 'success', msg: '품목 매칭 완료. 입고 준비 화면에서 차수·농장·수량을 확인한 뒤 저장하세요. 아직 입고·재고는 변경하지 않았습니다.' });
      focusReceipt();
    } catch (error) {
      const message = `입고 업로드 준비 실패: ${error.message}\n「인식값 수정」에서 해당 값을 고쳐 주세요. 현재 매칭과 파일은 유지됩니다. 입고·재고는 변경하지 않았습니다.`;
      setStatus({ type: 'error', msg: message }); recordBlocked(message,'PREPARE_BLOCKED'); notifyPackingBlocked(message);
      if (validationIssues.length) openValidationIssue(validationIssues[0]);
    } finally {
      processingRef.current = false; setProcessing(false);
    }
  };
  const confirmReview = drafts => {
    if (!lastExtraction || processingRef.current || savingRef.current || !sharedReady) throw new Error('현재 파일 분석이 완료된 뒤 다시 확인하세요.');
    if (country === 'CN' && (lastExtraction.legacyReviewRequired || lastExtraction.sourceInvoices?.some(isLegacyChinaInvoice))) {
      setStatus({ type: 'error', msg: LEGACY_CN_REVIEW_MESSAGE });
      throw new Error('일반 GW·CW·운송비 확인은 중국 구형 행 단위·통화 검토를 대신할 수 없습니다.');
    }
    const invoices = applyPackingReview(lastExtraction.sourceInvoices, drafts, country, undefined, { requireConfirmation: false });
    const reviewedResult = { ...lastExtraction.result, invoices };
    setMatchPreview(buildPackingMatchPreview({ invoices, country, aliases, erpMatches }));
    const activeReviewed = partitionPackingInvoicesByDuplicates(invoices, excludedDuplicateIndexes).activeInvoices;
    const activeReviewedResult = excludedDuplicateIndexes.size ? { ...reviewedResult, invoices: activeReviewed } : reviewedResult;
    const unresolved = unresolvedExtractionIssues(activeReviewed, activeReviewedResult);
    if (unresolved.length) {
      setExcels([]); setGenerated({});
      setStatus({ type: 'error', msg: `인식값 확인 후에도 추출 검토 항목 ${unresolved.length}건이 남아 있습니다. 해결 근거를 확인하기 전까지 생성을 차단합니다.` });
      throw new Error('추출 검토 항목이 남아 있습니다. 해당 항목을 해결한 뒤 다시 확인하세요.');
    }
    // Build first: a failure preserves the previous extraction and review draft.
    const built = buildExcels({ invoices: activeReviewed, masterAwb: lastExtraction.masterAwb, weekParsed: lastExtraction.weekParsed,
      currentAliases: aliases, wasTruncated: lastExtraction.wasTruncated, extractionResult: activeReviewedResult,
      legacyPackingReviewConfirmed: country === 'CN' && legacyPackingReviewRequired });
    if (built === false) throw new Error('검토가 끝나지 않아 생성하지 않았습니다.');
    // Keep sourceInvoices as the immutable review baseline; later applies must
    // validate against the snapshot the open review draft was created from.
    setLastExtraction(current => ({ ...current, result: reviewedResult }));
    if (country === 'CN' && legacyPackingReviewRequired) setLegacyPackingReviewRequired(false);
    setReviewConfirmed(true); closeReview();
    if (receiptIntent.current) { receiptIntent.current = false; focusReceipt(); }
  };

  useEffect(() => {
    // Preparing the mapped source is not ERP registration. The single explicit
    // receipt/cost button in the workbench remains the mutation boundary.
    if (!autoAnalyze || !lastExtraction || !matchingComplete || validationIssues.length
      || matchingNeeds.unmatchedFarms.length
      || processing || saving || !sharedReady || latestShared || reviewOpen || matchTarget
      || (matchModalOpen && matchingNeeds.totalCount > 0)
      || (excels.length && reviewConfirmed) || autoPreparedSources.current.has(lastExtraction)) return;
    autoPreparedSources.current.add(lastExtraction);
    prepareReceipt();
  }, [autoAnalyze,lastExtraction,matchingComplete,validationIssues.length,matchingNeeds.unmatchedFarms.length,processing,saving,sharedReady,latestShared,reviewOpen,matchTarget,matchModalOpen,excels.length,reviewConfirmed]);

  return (
    <div ref={toolRoot} className={`${styles.root} ${typography.scope}`} lang={lang} style={{ background: 'transparent', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
      {matchModalOpen && matchingNeeds.totalCount > 0 && (
        <PackingUploadMatchModal
          open={matchModalOpen}
          needs={matchingNeeds}
          country={country}
          products={matchingProducts}
          farms={farmMatches?.farms || []}
          pdfBase64={/\.pdf$/i.test(file?.name || '') ? pdfBase64 : null}
          file={file}
          saving={saving || processing}
          error={matchModalError}
          onFarmCreated={farm => {
            if (!farm?.FarmKey) return;
            setFarmMatches(prev => {
              const currentFarms = Array.isArray(prev?.farms) ? prev.farms : [];
              if (currentFarms.some(item => Number(item.FarmKey) === Number(farm.FarmKey))) return prev;
              return {
                ...(prev || { success: true, value: null, revision: 0, scope: 'team' }),
                farms: [
                  { FarmKey: Number(farm.FarmKey), FarmName: farm.FarmName, CounName: farm.CounName || '', UsageCount: 0, isDeleted: 0 },
                  ...currentFarms,
                ],
              };
            });
          }}
          onSave={handleSaveUploadMatches}
          onClose={() => setMatchModalOpen(false)}
        />
      )}
      {matchTarget&&<PackingProductMatchDialog target={matchTarget} country={matchTarget.country ?? country} products={erpMatches?.products??[]} matchEntries={erpMatches?.value?.entries??[]}
        onSave={saveErpMatch} onClose={()=>setMatchTarget(null)} onReload={reloadErpMatches} saving={saving} error={matchError}/>}
      {reviewRows && <PackingEvidenceReview key={reviewRevision} rows={reviewRows} open={reviewOpen && !matchTarget} onClose={closeReview} onConfirm={confirmReview}
        onBlocked={recordBlocked}
        requireSourceConfirmation={false}
        matchedInvoices={excels.length ? excels : matchPreview} initialTarget={reviewInitialTarget}
        validationIssues={validationIssues} onMatch={openProductMatch}
        products={matchingProducts} country={country}
        onInvalidate={() => { exportGeneration.current++; setExportReview(null); setReviewConfirmed(false); }}
        fileName={file?.name || ''} pdfBase64={/\.pdf$/i.test(file?.name || '') ? pdfBase64 : null} />}
      <div className={styles.card} style={{ background: 'transparent', borderRadius: 0, border: 0, padding: 0, maxWidth: 'none', minWidth: 0, boxSizing: 'border-box', width: '100%', boxShadow: 'none' }}>
        <WorkflowGuide workflowId="packing-free-ocr" initialRole="수입부" />
        <InvoiceUploadIssues userId={userId} fileName={file?.name||''} error={status?.type==='error'?status.msg:matchError||null} unmatched={pending.length+allNoMatches.length} mismatches={mismatches.length} processing={processing} blockedEvent={blockedEvent} onChooseFile={()=>fileRef.current?.click()}/>
        {workError && <p role="alert" style={{ color: '#b91c1c' }}>{workError}</p>}
        {workMessage && file && <p role="status" data-testid="packing-work-saved">{workMessage}</p>}
        {teamHistoryStatus && file && <p role="status">{teamHistoryStatus}</p>}
        {teamHistoryError && <p role="alert">팀 이력 보관 실패: {teamHistoryError} · 현재 파일은 유지됩니다. <button type="button" onClick={() => setTeamHistoryRetry(value => value + 1)}>다시 보관</button></p>}
        {savedWork && <section className={styles.sourceBadge} aria-label="보관된 패킹 작업">
          <strong>이어서 작업: {savedWork.fileName}</strong>
          <button ref={sharedRestoreButton} type="button" onClick={restoreWork} disabled={!sharedReady || saving || processing || restoringWork} data-testid="packing-work-restore" style={{ marginLeft: 16 }}>{restoringWork ? '복구 중…' : '매칭 작업 이어서 하기'}</button>
          <button type="button" disabled={restoringWork || saving || processing} onClick={async () => {
            try { await workStore.clear(); setSavedWork(null); setWorkError(''); }
            catch (error) { setWorkError(`임시 작업 삭제 실패: ${error.message}`); }
          }} style={{ marginLeft: 8 }}>보관 작업 삭제</button>
          <p>복구 대기 중인 작업입니다. 여기서 삭제해도 팀 업로드 이력·공용 품목 매칭과 ERP 입고 원장은 삭제되지 않습니다.</p>
        </section>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setReloadVersion(v => v + 1)} disabled={saving || processing || catalogLoading || catalogParsing}>{t.reload}</button>
          {saving && <span role="status">{t.saving}</span>}
          {sharedError && <span role="alert" style={{ color: '#c81e1e', overflowWrap: 'anywhere' }}>{t.sharedFailure} {sharedError}</span>}
          {status && screen !== 'upload' && <span role="status" style={{ color: statusColor }}>{status.msg}</span>}
        </div>
        <fieldset disabled={saving || processing || restoringWork || catalogLoading || catalogParsing || !sharedReady}
          onClickCapture={e => { if (saving || processing || restoringWork || catalogLoading || catalogParsing || !sharedReady) { e.preventDefault(); e.stopPropagation(); } }}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {renderPackingCatalogSection({
          lang, changeLang, t, latestShared, saving, processing, restoringWork,
          catalogLoading, catalogParsing, sharedReady, matchTarget, reloadErpMatches,
          erpMatches, openSavedErpMatch, catalog, catalogRef, xlsxLib,
          handleCatalogFile, cancelCatalogDraft, setCatalogClearConfirm, catalogDraft,
          catalogPreviewError, confirmCatalogDraft, catalogPreview, catalogMode,
          setCatalogMode, catalogReplaceConfirmed, setCatalogReplaceConfirmed,
          catalogClearConfirm, clearCatalog, aliases, aliasFileRef, importAliasesFile,
          exportAliases, catalogError,
        })}

        {screen === 'country' && renderPackingCountryGrid({
          countryLabels, t, setScreen, readerVersion, resetResults, setOriginPreview,
          setNzReceiptSource, setChinaSheetReview, setCountry, setFile, setPdfBase64,
          setStatus, setInvoiceUploadDate, setAudMarketRate, setAudMarketRateError,
          setAwbFile, setAwbPdfBase64, setAwbSourceHash, setLocalAwbDocument,
          setAwbValues, setAwbManualFields, setAwbReviewed,
        })}

        {screen === 'hubfresh' && <HubfreshPacking xlsx={xlsxLib} onBack={() => setScreen('country')} onUpload={onHubfreshUpload} />}
        {screen === 'awb' && (
          <AWBPanel xlsxLib={xlsxLib} lang={lang} readAwbPdf={readAwbPdf} onBack={() => setScreen('country')} />
        )}

        {screen === 'upload' && !cfg && SUPPLEMENTAL_PACKING_ORIGINS.some(item => item.code === country) && renderPackingSupplementalOrigin({
          country, t, readerVersion, setSelectingFile, setScreen, selectingFile,
          handleFile, status, originPreview, requestErpMatches, setNzReceiptSource,
          onContinue, setStatus,
        })}
        {screen === 'upload' && cfg && (
          <>
            <button data-testid="packing-country-back" onClick={() => {++readerVersion.current;autoAnalysisFile.current=null;setFileChoice(null);setSelectingFile(false);setHistoryOpen(false);setScreen('country');}} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#526580', cursor: 'pointer', border: 'none', background: 'none', padding: 0, marginBottom: '1.25rem' }}>{t.back}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 24 }}>{cfg[0]}</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{cfg[1]}</div>
                <div style={{ fontSize: 13, color: '#526580' }}>{cfg[2]}</div>
              </div>
            </div>
            {renderPackingSavedHistoryPanel({
              country, historyOpen, setHistoryOpen, showAnalyzedUploads, historySearch,
              setHistorySearch, historyRows, restoreAnalyzedUpload, selectingFile,
              historyError, processing, saving, restoringWork,
            })}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{country === 'CN' ? '중국 인보이스 업로드 (Excel · PDF)' : t.uploadLabel}</div>
            <div role="button" tabIndex={0} aria-label={country === 'CN' ? '중국 인보이스 업로드 (Excel · PDF)' : t.uploadLabel} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }} onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{ border: '1.5px dashed #ccc', borderRadius: 10, padding: '20px 16px', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#edf2f8' : '#f8fafc', borderColor: dragOver ? '#526580' : '#ccc' }}>
              <input ref={fileRef} type="file" accept={country === 'CN' ? '.pdf,.xlsx' : '.pdf'} style={{ display: 'none' }} onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }} />
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, color: '#526580' }}><strong style={{ color: '#172b4d' }}>{t.uploadClick}</strong> {t.uploadDrag}</div>
              <div style={{ fontSize: 13, marginTop: 4, color: '#526580' }}>{country === 'CN' ? 'PDF 20MiB / Excel 50MiB · 예: 41-1 중국 해상 ci1.xlsx' : <>PDF · 20MiB · {t.uploadHint} <code style={{ background: '#edf2f8', padding: '1px 5px', borderRadius: 3 }}>16-2 Hortensias.pdf</code>)</>}</div>
            </div>
            {country==='CN'&&chinaSheetReview&&<ChinaInvoiceSheetReview key={chinaSheetReview.version} xlsx={xlsxLib} source={chinaSheetReview}
              products={(erpMatches?.products||[]).filter(p=>p.country==='CN'&&p.selectable)}
              onCancel={()=>setChinaSheetReview(null)} onContinue={name=>{
                selectedChinaSheet.current={name,file:chinaSheetReview.file};
                acceptSelectedFile(chinaSheetReview.file,chinaSheetReview.version,null,chinaSheetReview.base64);
                setChinaSheetReview(null);
              }}/>}
            {renderPackingFileChoicePanel({
              country, fileChoice, fileChoiceRef, cancelFileChoice, processing, saving,
              selectingFile, restoringWork, restoreAnalyzedUpload, acceptSelectedFile,
            })}
            {file && (
              <div style={{ marginTop: 10, background: '#f4f7fb', border: '1px solid #dce4ef', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{file.name}</div>
                  <div style={{ fontSize: 13, color: '#526580' }}>{(file.size / 1024).toFixed(0)} KB</div>
                </div>
                <button onClick={() => {
                  ++readerVersion.current; resetResults(); setFile(null); setPdfBase64(null);
                  setInvoiceUploadDate(''); setAudMarketRate(null); setAudMarketRateError('');
                  setAwbFile(null); setAwbPdfBase64(''); setAwbSourceHash(''); setLocalAwbDocument(null); setAwbValues(null); setAwbManualFields([]); setAwbReviewed(false);
                }} style={{ padding: '5px 12px', fontSize: 13, borderRadius: 8, border: '1px solid #ccd6e5', background: '#fff', cursor: 'pointer' }}>{t.uploadRemove}</button>
              </div>
            )}
            {(country === 'AU' || country === 'EC') && <section data-testid="packing-awb-review" aria-label={country === 'EC' ? '선택 사항 · 에콰도르 AWB 업로드 및 검토' : '선택 사항 · 호주 AWB 업로드 및 검토'} style={{ marginTop: 12, border: '1px solid #c9d8ef', borderRadius: 10, padding: 14, background: '#f8fbff', scrollMarginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <strong style={{ color: '#172b4d' }}>AWB 항공운송장 PDF (선택)</strong>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>{country === 'EC' ? '인보이스에 AWB가 공란(SN)이거나 중량·운임이 별도 AWB PDF에 있을 때 첨부하면 AWB 번호·GW·CW·운임을 자동 추출해 대조합니다.' : '같은 항공편 AWB가 있다면 원문과 대조한 값이 입고에 반영됩니다. 인보이스만으로 입고를 저장하고 원가는 나중에 작업할 수 있습니다.'}</div>
                </div>
                <input ref={awbFileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={event => { handleAwbFile(event.target.files?.[0]); event.target.value = ''; }} />
                <button type="button" onClick={() => awbFileRef.current?.click()} disabled={!file || processing} style={{ border: '1px solid #2457c5', borderRadius: 7, padding: '8px 12px', background: '#fff', color: '#2457c5', fontSize: 13.5, fontWeight: 600, cursor: file && !processing ? 'pointer' : 'not-allowed', opacity: file && !processing ? 1 : .5 }}>AWB PDF 선택</button>
              </div>
              <div style={{ marginTop: 8, fontSize: 13, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
                인보이스 업로드일 <strong>{invoiceUploadDate || '인보이스 선택 시 자동 입력'}</strong>
                {country === 'AU' && <>
                  {' · '}AUD 환율 {audMarketRate?.rate ? <strong>1 AUD = {Number(audMarketRate.rate).toLocaleString('ko-KR')} KRW · {audMarketRate.rateDate}{audMarketRate.carriedForward ? ' (직전 고시일)' : ''}</strong> : audMarketRateError ? <span role="alert" style={{ color: '#b42318' }}>{audMarketRateError} · 원가 단계에서 다시 조회할 수 있습니다.</span> : <span>시장 검색 환율 조회 중…</span>}
                </>}
                {country === 'EC' && awbReview && (awbReview.freightRate != null || awbReview.totalPrepaid != null) && <>
                  {' · '}운임단가 <strong>{awbReview.freightRate != null ? `${awbReview.freightRate} USD/kg` : '미확인'}</strong>
                  {' · '}부대비 <strong>{awbReview.otherCharges != null ? `${awbReview.otherCharges.toFixed(2)} USD` : '미확인'}</strong>
                  {' · '}총 운임 <strong>{awbReview.totalPrepaid != null ? `${awbReview.totalPrepaid.toFixed(2)} USD` : '미확인'}</strong>
                  {awbReview.daePmt && <> · DAE/PMT <strong>{awbReview.daePmt}</strong></>}
                </>}
              </div>
              {renderPackingAwbAttachmentDetails({
                awbFile, awbObjectUrl, lastExtraction, localAwbDocument, awbValues,
                setAwbValues, setAwbManualFields, awbReview, awbReviewed, setAwbReviewed,
              })}
            </section>}
            <p className={styles.notice} role="note" style={{ fontSize: 13, color: '#526580', marginTop: 12 }}>{country === 'CN' ? 'Excel은 코드 분석으로 처리합니다. Total of Flower Material은 단수, Stems는 송이수, Unit Price는 단당 단가로 읽습니다. PDF는 Claude API로 분석합니다. 입고등록 전 ERP 원장은 변경하지 않습니다.' : t.pdfNotice}</p>
            {!fileChoice&&!selectingFile&&<div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={() => process(false)} disabled={!pdfBase64 || processing || !xlsxLib} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: pdfBase64 && !processing && xlsxLib ? 'pointer' : 'not-allowed', border: '1px solid #2457c5', background: '#2457c5', color: '#fff', opacity: pdfBase64 && !processing && xlsxLib ? 1 : 0.35 }}>
                {processing ? t.processing : t.generate}
              </button>
              {country==='CO'&&pdfBase64&&<button type="button" onClick={revalidateSavedResponse} disabled={processing} style={{padding:'9px 18px',borderRadius:8,border:'1px solid #2457c5',background:'#eff5ff',color:'#173e83',fontWeight:600}}>저장 응답 재검증 · API 호출 없음</button>}
              {needsAI&&<button onClick={()=>{
                if (pdfRetryJobId && !toolRoot.current?.ownerDocument?.defaultView?.confirm('이전 분석의 결과가 불명확하여 추가 비용이 발생할 수 있습니다. 같은 파일을 새로 AI 분석할까요?')) return;
                return process(true,pdfRetryJobId);
              }} disabled={processing} style={{padding:'9px 18px',borderRadius:8,border:'1px solid #b67b12',background:'#fff4d6',fontWeight:600}}>{pdfRetryJobId?'새로 AI 분석 (추가 비용 확인)':t.aiAnalyze}</button>}
            </div>}
            <div className={styles.modeBadge}>{country==='CN'&&/\.xlsx$/i.test(file?.name||'')?'엑셀 코드 분석 · API 호출 없음':t.localMode}</div>
            {extractionSource&&<p className={styles.sourceBadge} role="status" style={{fontSize:13,color:'#176039'}}>{extractionSource}</p>}
            {country==='CO'&&lastExtraction?.result?.amount_review_country==='CO'&&packingAmountIssues(lastExtraction.result).length>0&&<PackingAmountReview key={`${country}:${lastExtraction.sourceHash}`} result={lastExtraction.result} pdfBase64={pdfBase64} sourceHash={lastExtraction.sourceHash} disabled={processing||saving}
              onDraft={result=>{setLastExtraction(current=>({...current,result}));setExcels([]);setGenerated({});setGeneratedErp(null);setReviewConfirmed(false);}}
              onApply={result=>{setLastExtraction(current=>({...current,result,sourceInvoices:result.invoices}));setReviewRows(makePackingReviewRows(result.invoices,country));setReviewOpen(false);setReviewConfirmed(false);setExcels([]);setGenerated({});setGeneratedErp(null);
                setMatchPreview(buildPackingMatchPreview({invoices:result.invoices,country,aliases,erpMatches}));
                setStatus({type:'success',msg:'원본 대조와 합계 검증을 통과했습니다. 기존 품목 매칭·입고 준비를 계속하세요. 입고 등록은 실행하지 않았습니다.'});}}/>}
            {country==='CO'&&<WorkflowGuide workflowId="packing-amount-review" initialRole="수입부"/>}
            {lastExtraction?.result?.manifest_review&&<PackingManifestFarmReview key={`${country}:${lastExtraction.sourceHash}`} result={lastExtraction.result} country={country} onApply={result=>{
              setLastExtraction(current=>({...current,result,sourceInvoices:result.invoices}));setExcels([]);setGenerated({});setGeneratedErp(null);setReviewConfirmed(false);
              setStatus({type:'success',msg:'명세서·송장·DB 농장을 연결했습니다. 원본 수량·금액은 변경하지 않았습니다.'});
            }}/>}
            {lastExtraction?.result?.free_ocr_review_issues?.length>0&&<div role="status" style={{padding:12,border:'1px solid #e2b459',background:'#fff8e9',borderRadius:8}}>
              <strong>원본 표기 확인 필요 · 나머지 품목은 계속 검토할 수 있습니다.</strong>
              {lastExtraction.result.free_ocr_review_issues.map((issue,index)=><p key={index}>{issue.invoice}: 명세서 {issue.manifest} / 송장 {issue.invoicePrinted} — 두 원문을 그대로 보존했습니다.</p>)}
            </div>}
            {legacyReviewData && <ChinaLegacyReview data={legacyReviewData} resolveLegacyChinaInvoice={resolveLegacyChinaInvoice} onConfirm={confirmation => {
              try {
                const promoted = confirmation.invoices;
                if (!Array.isArray(promoted) || !promoted.length || promoted.some(isLegacyChinaInvoice)) {
                  throw new Error('구형 인보이스 검토 결과가 안전한 생성 형식으로 승격되지 않았습니다.');
                }
                const result = { ...lastExtraction.result, invoices: promoted };
                setLastExtraction(current => ({ ...current, result, sourceInvoices: promoted, legacyReviewRequired: false }));
                setLegacyReviewData(null);
                setLegacyPackingReviewRequired(true);
                setReviewRows(makePackingReviewRows(promoted, 'CN')); setReviewOpen(true); setReviewConfirmed(false);
                setExcels([]); setGenerated({});
                setStatus({ type: 'info', msg: '행별 단위·박스·송이와 통화 확인을 적용했습니다. 생성 전 중량(GW/CW)·운송비 검토를 별도로 완료하세요.' });
              } catch (error) {
                setStatus({ type: 'error', msg: `구형 인보이스 변환 차단: ${error.message}` });
              }
            }} />}
            {isModernChinaInvoice(lastExtraction?.result?.invoices?.[0]?.source_format) && (() => {
              const inv = lastExtraction.result.invoices[0];
              return <section aria-label="중국 원본 합계 검산" className={styles.sourceBadge}>
                <strong>원본 합계 검산 · {inv.invoice} · {inv.date}</strong>
                <div style={{display:'flex',flexWrap:'wrap',gap:'8px 24px',marginTop:6}}>
                  {[['박스', inv.total_boxes], ['단수', inv.total_bunches], ['송이수', inv.total_stems], ['품목금액 CNY', inv.item_subtotal], ['부대비용 CNY', inv.freight], ['전체금액 CNY', inv.total_value]].map(([label, value]) => <span key={label}>{label} <strong>{Number(value).toLocaleString('ko-KR',{maximumFractionDigits:2})}</strong></span>)}
                </div>
                <small>부대비용은 꽃 수량에서 제외합니다. 명시된 0원과 미확인 단가는 구분하며, 미확인 값과 미매칭 품목을 확인한 뒤 다운로드합니다.</small>
              </section>;
            })()}
            {status && (
              <div role={status.type === 'error' ? 'alert' : 'status'} aria-live="polite" style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: status.exportBlocked ? 14 : 13, fontVariantNumeric: 'tabular-nums', background: statusBg, color: status.exportBlocked ? '#991b1b' : statusColor, border: `1px solid ${statusBorder}` }}>
                {processing && <span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid #ccd6e5', borderTopColor: '#172b4d', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginRight: 6, verticalAlign: 'middle' }}></span>}
                {receiptStatus?.valid && status.type !== 'error' && !processing
                  ? '기존 패킹 파일 생성 결과입니다. 현재 행별 매칭 상태는 아래에 표시하며, 입고 문서에서 변경한 품목은 기존 패킹 파일에 소급 반영되지 않습니다.'
                  : status.msg}
                {steps.length > 0 && (processing || !receiptStatus?.valid) && (
                  <div style={{ marginTop: 8 }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{ fontSize: 13, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6, color: s.state === 'done' ? '#22a355' : s.state === 'active' ? '#172b4d' : '#526580', fontWeight: s.state === 'active' ? 500 : 400 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }}></span>{s.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(excels.length > 0 || matchPreview.length > 0 || reviewRows) && (
              <div ref={matchPreviewRef} style={{ marginTop: '1.25rem', scrollMarginTop: 12 }}>
                {renderPackingExistingDuplicatesPanel({
                  existingMatchesList, excludedDuplicateIndexes, activeInvoices,
                  saving, processing, toggleDuplicateExclusion,
                })}
                <PackingUploadMatchAlertBanner
                  needs={matchingNeeds}
                  disabled={saving || processing}
                  onOpen={() => { setMatchModalError(''); setMatchModalOpen(true); }}
                />
                <div className={styles.sourceBadge} role="status" data-testid="packing-upload-next">
                  <strong>{matchingComplete ? (allocationCount ? `일반 매칭 완료 · Woolly bush ${allocationCount}행 입고량 분류 필요` : `품목 매칭 완료 · ${matchingRows.length}행 유지`) : `품목 매칭 확인 ${remainingMatches}행 남음`}</strong>
                  {lastExtraction?.result?.invoices?.some(needsPackingWeekDate) && <label style={{ display: 'block', marginTop: 8 }}>
                    원본 날짜 없음 · 적용 연도 <input aria-label="차수 날짜 적용 연도" inputMode="numeric" maxLength={4}
                      value={file?.name?.match(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/)?.[1] || dateYear}
                      disabled={processing || Boolean(file?.name?.match(/(?:^|[^0-9])(20\d{2})(?=[^0-9]|$)/))}
                      onChange={event => setDateYear(event.target.value)} style={{ width: 80, margin: '0 8px' }} />
                    {lastExtraction.weekParsed.week}-{lastExtraction.weekParsed.num}차 · 다음을 누르면 전산 기준일 자동 적용 (1차 수요일 / 2차 토요일)
                  </label>}
                  {lastExtraction?.result?.invoices?.filter(invoice => invoice.orderWeekDate).map((invoice, index) => <div key={index} role="status" style={{ marginTop: 8 }}>
                    원본 날짜 없음 · {invoice.orderWeekDate.orderYear}년 {invoice.orderWeekDate.orderWeek}차 기준 {invoice.orderWeekDate.date} 자동 적용
                    {String(invoice.date).replaceAll('/', '-') !== invoice.orderWeekDate.date ? ` · 수정한 날짜 ${invoice.date} 사용` : ''} · 날짜 수정은 「인식값 수정」
                  </div>)}
                  {receiptStatus?.valid && <div role="status" data-testid="packing-receipt-match-summary">입고 문서 행별 품목 선택 {receiptStatus.documentTotal - receiptStatus.documentPending}/{receiptStatus.documentTotal}행 · {receiptStatus.documentPending}행 미선택 · 팀 공용 별칭 저장 아님{!receiptStatus.overlayComplete ? ' · 생성 패킹 행과 직접 연결되지 않아 패킹 상태는 별도 표시' : ''}</div>}
                  {matchingComplete && <button type="button" data-testid="packing-receipt-prepare"
                    title={allocationCount ? 'Woolly bush 행별 품목과 입고량을 분류하는 화면을 엽니다.' : undefined}
                    onClick={() => {
                      if (allocationCount) return openInvoiceAllocation();
                      setMatchingReviewedFile(file);
                      return prepareReceipt();
                    }}
                    disabled={saving || processing || !sharedReady || latestShared} style={{ marginLeft: 16, padding: '10px 20px', background: '#2457c5', color: '#fff', border: 0, borderRadius: 8, fontWeight: 700 }}>
                    {allocationCount ? 'Woolly bush 품목·입고량 분류' : costOnly ? '다음 · 도착원가 준비' : '입고 업로드로 이동'}
                  </button>}
                </div>
                <div role="status" style={{ padding: 12, marginBottom: 12, background: reviewConfirmed ? '#edf8f1' : '#fff4d6', border: '1px solid #ccd6e5', borderRadius: 8 }}>
                  <button ref={reviewButtonRef} type="button" onClick={() => { exportGeneration.current++; setExportReview(null); setReviewInitialTarget(null); setReviewOpen(true); }} disabled={processing || saving} data-testid="packing-review-open">인식값 수정 · 원본 PDF 보기</button>
                </div>
                {excels.some(excel => packingLegacyExportBlocked(excel, generatedErp?.products, country)) && <p role="alert">다른 국가에 같은 이름의 품목이 있어 EXE용 패킹 엑셀 다운로드는 차단했습니다. 국가와 품목키로 구분되는 웹 입고 등록을 이용하세요. 도착원가 다운로드는 별도입니다.</p>}
                {reviewConfirmed && exportReview && <section aria-label="다운로드 전 단 수량 확인">
                  <h3>[핵심 목적 · PURPOSE] 단 수량을 확인하고 다운로드</h3>
                  {exportReview.issues.map(issue => <div key={`${issue.fileName}:${issue.row}:${issue.snapshot}`}>
                    <strong>{issue.fileName} · {issue.row}행 · {issue.name}</strong>
                    <ReceiptBunchConfirmation issue={issue} actionLabel="확인하고 다운로드 계속" onConfirm={confirmation=>downloadPackingFiles(exportReview.names,{
                      ...exportReview.confirmations,
                      [issue.fileName]:{...exportReview.confirmations[issue.fileName],[issue.row]:confirmation},
                    })}/>
                  </div>)}
                  <button type="button" onClick={()=>setExportReview(null)}>다운로드 취소</button>
                </section>}
                {excels.length > 1 && (() => {
                  const anyBlocked = excels.some(isBlocked);
                  return (
                  <div style={{ marginBottom: 10 }}>
                    <button
                      onClick={anyBlocked ? undefined : dlAll}
                      disabled={anyBlocked}
                      title={anyBlocked ? t.downloadAllBlockedHint : ''}
                      style={{
                        padding: '5px 12px', fontSize: 13, borderRadius: 8,
                        border: '1px solid ' + (anyBlocked ? '#ccc' : '#172b4d'),
                        background: anyBlocked ? '#ccd6e5' : '#2457c5',
                        color: '#fff', fontWeight: 500,
                        cursor: anyBlocked ? 'not-allowed' : 'pointer',
                        opacity: anyBlocked ? 0.55 : 1,
                      }}>
                      {anyBlocked ? t.downloadAllBlocked : t.downloadAll}
                    </button>
                  </div>
                  );
                })()}
                <div style={{ fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{excels.length ? t.generatedSection : 'DB 매칭 미리보기'}</div>
                {validationIssues.length > 0 && <section aria-label="입고 진행을 막는 인식값" data-testid="packing-validation-issues" className={styles.sourceBadge}>
                  <h3>입고 전 수정 필요 · {validationIssues.length}건</h3>
                  <p>품목 매칭과 별도입니다. 아래 값을 수정하고 재검증하면 입고 준비를 이어갈 수 있습니다.</p>
                  <ul>{validationIssues.map((issue,index) => <li key={`${issue.invoiceIndex}-${issue.code}-${index}`} style={{marginBottom:8,overflowWrap:'anywhere'}}>
                    <strong>{issue.invoiceLabel}</strong> · {issue.text}{' '}
                    <button type="button" disabled={processing || saving} onClick={() => openValidationIssue(issue)}>해당 값 수정</button>
                  </li>)}</ul>
                </section>}
                <PackingResults
                  onInlineMatch={(product, prodKey) => saveErpMatch(prodKey, {
                    description: product.matchingDescription,
                    expectedRevision: erpMatches?.revision,
                    requiresReload: latestShared || !product.matchingDescription
                  })}
                  erpProducts={excels.length ? (generatedErp?.products || []) : (erpMatches?.products || [])}
                  receiptMatches={receiptMatches}
                  excels={visiblePreviewOrExcels}
                  country={country}
                  blocked={isBlocked}
                  onDownload={dl}
                  previewOnly={!excels.length}
                  truncated={lastExtraction?.wasTruncated === true}
                  onMatch={openProductMatch}
                  onAllocate={openInvoiceAllocation}
                  onReviewSource={(product, excel, rowIndex) => {
                    if (!reviewRows) return;
                    setReviewInitialTarget({
                      invoiceIndex: Number.isInteger(product?.sourceInvoiceIndex)
                        ? product.sourceInvoiceIndex
                        : (Number.isInteger(excel?.sourceInvoiceIndex) ? excel.sourceInvoiceIndex : 0),
                      lineIndex: Number.isInteger(product?.sourceLineIndex) ? product.sourceLineIndex : rowIndex,
                    });
                    setReviewOpen(true);
                  }}
                  mappingDisabled={saving||processing||!sharedReady||!erpMatches}
                />

                {renderPackingMismatchAndAliasesFooter({
                  mismatches, mismatchOverrides, setMismatchOverrides, pending,
                  allNoMatches, aliases, showAliasManager, setShowAliasManager,
                  clearAliases, deleteAlias, t,
                })}
              </div>
            )}
          </>
        )}
        </fieldset>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export { NoticeText, PendingItem, NoMatchItem, AWBPanel };
