import Head from 'next/head';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSXStyled from 'xlsx-js-style';
import { apiGet } from '../../lib/useApi';
import { applyDutchWeekdayEdits, attachDutchLiveCustomerKeys } from '../../lib/dutchVolumePrice';
import { addDutchPriceColumns, buildDutchEntriesFromPivotData, createDutchBulkPriceConfig, dutchCustomerIdentity, dutchCustomerLabel, dutchPriceKey, dutchUniformPricePeerKeys, isDutchBulkPriceCustomer, migrateDutchBulkPriceConfig, migrateDutchPriceDraft, normalizeDutchBulkPriceConfig, parseDutchPivotWorkbook, restoreDutchPriceDraft } from '../../lib/dutchVolumePrice';
import { addDutchPriceShapesToXlsx } from '../../lib/dutchPriceShapes';
import { buildDutchPreviewEntries, dutchPreviewRowKind, dutchSourceIdentity, editDutchDraftEntry, isDutchPreviewCurrent, isDutchValidationCurrent, newDutchDraftEntry, readDutchDraft, writeDutchDraft } from '../../lib/dutchVolumeDraft';
import ErpMatchPicker from '../../components/dutch/ErpMatchPicker';
import DutchVolumeSheet from '../../components/dutch/DutchVolumeSheet';
import DutchWorkHistory from '../../components/dutch/DutchWorkHistory';
import { buildDutchWorkPayload, restoreDutchWorkSnapshot, DUTCH_WORK_CLIENT_MAX_BYTES } from '../../lib/dutchVolumeWorkClient';

const customerName = value => String(value || '').split('\n')[0].trim();
const BULK_PRICE_CONFIG_KEY = 'nenova.dutch-volume-bulk-price.v1';
const fmt = value => Number(value || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
const currentYear = new Date().getFullYear();
const requestHeaders = { 'Content-Type': 'application/json' };
const num = value => Number(value ?? 0);

function withEditedWorkbook(workbook, entries, prices, bulkPriceConfig) {
  const copy = { ...workbook, SheetNames: [...workbook.SheetNames], Sheets: { ...workbook.Sheets } };
  const touched = new Set();
  for (const entry of entries) {
    if (entry.added || !entry.sheetName || !entry.cellAddress || !copy.Sheets[entry.sheetName]) continue;
    if (!touched.has(entry.sheetName)) { copy.Sheets[entry.sheetName] = { ...copy.Sheets[entry.sheetName] }; touched.add(entry.sheetName); }
    const sheet = copy.Sheets[entry.sheetName];
    sheet[entry.cellAddress] = { ...(sheet[entry.cellAddress] || {}), t: 'n', v: Number(entry.quantity) };
  }
  const added = entries.filter(entry => entry.added);
  const rematched = entries.some(entry => Number(entry.custKey) > 0 || Number(entry.prodKey) > 0);
  if (added.length || rematched) {
    const sheetName = 'ERP적용초안';
    if (!copy.SheetNames.includes(sheetName)) copy.SheetNames.push(sheetName);
    copy.Sheets[sheetName] = XLSXStyled.utils.aoa_to_sheet([
      ['ERP 적용 초안 — 원본 Pivot 셀 및 도형은 별도 보존'],
      ['업체', '업체키', '품목', '품목키', '수량', '단위', 'KRW 입력값(빈칸=기존값 보존)', '원본 위치'],
      ...entries.map(entry => [entry.customer, entry.custKey || entry.sourceCustKey || '', entry.product, entry.prodKey || '', Number(entry.quantity), entry.unit || 'ERP 출고단위', prices[dutchPriceKey(entry, bulkPriceConfig)] ?? '', entry.added ? '수동 추가행' : `${entry.sheetName}!${entry.cellAddress}`]),
    ]);
  }
  return copy;
}

export default function DutchVolumeBoard() {
  const [fileName, setFileName] = useState('');
  const [storageKey, setStorageKey] = useState('');
  const [workbook, setWorkbook] = useState(null);
  const [entries, setEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [bulkPriceConfig, setBulkPriceConfig] = useState(() => createDutchBulkPriceConfig());
  const [bulkPriceSettingsOpen, setBulkPriceSettingsOpen] = useState(false);
  const [bulkPriceSettingsDraft, setBulkPriceSettingsDraft] = useState(null);
  const [bulkCustomerQuery, setBulkCustomerQuery] = useState('');
  const [dayEdits, setDayEdits] = useState({});
  const [legacyCurrency, setLegacyCurrency] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState('35-01');
  const [availableWeeks, setAvailableWeeks] = useState([]);
  const [weeksLoading, setWeeksLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourceMode, setSourceMode] = useState('');
  const [activeTab, setActiveTab] = useState('sheet');
  const [activeEntryId, setActiveEntryId] = useState('');
  const [draftReset, setDraftReset] = useState(false);
  const [rematchNotice, setRematchNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [matchCache, setMatchCache] = useState({});
  const [customerOptions, setCustomerOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ackReplacement, setAckReplacement] = useState(false);
  const [ackQtyWarnings, setAckQtyWarnings] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [activeJobId, setActiveJobId] = useState('');
  const [workName, setWorkName] = useState('');
  const [workBusy, setWorkBusy] = useState(false);
  const [workNotice, setWorkNotice] = useState('');
  const [workError, setWorkError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [workHistory, setWorkHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const workBusyRef = useRef(false);
  const historyRequestRef = useRef(0);
  const matchPopupRequestsRef = useRef(new Map());
  const reviewRef = useRef(null);
  const inputRefs = useRef([]);
  const revisionRef = useRef(0);
  const loadRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const sourceRef = useRef('');
  const sourceBaseRef = useRef('');
  const sourceModeRef = useRef('');
  const applyingRef = useRef(false);
  const editRowRefs = useRef({});
  const priceInputRefs = useRef({});
  const previewCurrent = !loading && isDutchPreviewCurrent(preview, revisionRef.current, year, week, storageKey);
  const validationCurrent = !loading && isDutchValidationCurrent(preview, revisionRef.current, year, week, storageKey);
  const matchStatusUsable = validationCurrent || Boolean(applyResult?.failed);
  const previewRows = preview?.rows || [];
  const missingRows = previewRows.filter(row => row.missingFromExcel);
  const blockedRows = previewRows.filter(row => row.fixBlocked);
  const warningRows = previewRows.filter(row => row.hasQtyWarning);
  const changedRows = previewRows.filter(row => num(row.shipmentDiffQty) !== 0 || row.priceChanged || num(row.orderAfterQty) !== num(row.orderBeforeQty));
  const visibleEntries = useMemo(() => { const token = query.trim().toLowerCase(); return token ? entries.filter(row => `${row.customer} ${row.product} ${row.color}`.toLowerCase().includes(token)) : entries; }, [entries, query]);
  const bulkCustomers = useMemo(() => {
    const seen = new Map();
    for (const entry of entries) { const id = dutchCustomerIdentity(entry); if (!seen.has(id)) seen.set(id, { id, label: dutchCustomerLabel(entry), defaultExcluded: String(entry.sourceCustomer || entry.customer || '').split('\n')[0].includes('주광') }); }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  }, [entries]);
  const enteredPriceCount = entries.filter(row => prices[dutchPriceKey(row, bulkPriceConfig)] !== '' && prices[dutchPriceKey(row, bulkPriceConfig)] !== undefined).length;

  useEffect(() => {
    if (activeTab !== 'edit' || !activeEntryId) return undefined;
    const frame = requestAnimationFrame(() => {
      editRowRefs.current[activeEntryId]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      priceInputRefs.current[activeEntryId]?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTab, activeEntryId]);

  useEffect(() => {
    const settle = pending => {
      if (pending?.returnFocusElement?.isConnected) pending.returnFocusElement.focus();
    };
    const onMatchPopupMessage = event => {
      if (event.origin !== window.location.origin) return;
      const data = event.data || {};
      const pending = matchPopupRequestsRef.current.get(String(data.token || ''));
      if (!pending || event.source !== pending.popup || data.kind !== pending.kind) return;
      if (data.type === 'dutch-match-popup-ready') {
        event.source.postMessage({ type: 'dutch-match-popup-init', token: data.token, kind: pending.kind, options: pending.options }, window.location.origin);
        return;
      }
      if (data.type === 'dutch-match-popup-selected') {
        const key = Number(pending.kind === 'product' ? data.item?.prodKey ?? data.item?.ProdKey : data.item?.custKey ?? data.item?.CustKey);
        if (Number.isInteger(key) && key > 0) pending.onPick(data.item);
      }
      if (data.type === 'dutch-match-popup-selected' || data.type === 'dutch-match-popup-cancel') {
        matchPopupRequestsRef.current.delete(String(data.token));
        settle(pending);
      }
    };
    const cleanClosedPopups = window.setInterval(() => {
      for (const [token, pending] of matchPopupRequestsRef.current) {
        if (pending.popup.closed) { matchPopupRequestsRef.current.delete(token); settle(pending); }
      }
    }, 500);
    window.addEventListener('message', onMatchPopupMessage);
    return () => { window.removeEventListener('message', onMatchPopupMessage); window.clearInterval(cleanClosedPopups); };
  }, []);

  useEffect(() => { if (storageKey && entries.length) writeDutchDraft(localStorage, storageKey, entries, prices, dayEdits, bulkPriceConfig); }, [storageKey, entries, prices, dayEdits, bulkPriceConfig]);
  useEffect(() => {
    let active = true;
    async function loadRecordedWeeks() {
      setWeeksLoading(true);
      try {
        const result = await apiGet('/api/stats/pivot-weeks', { orderYear: year, source: 'orders' });
        if (!active) return;
        const recorded = Array.isArray(result.weeks) ? result.weeks : [];
        setAvailableWeeks(recorded);
        // An archive is an explicit selected scope, not today's LIVE default.
        if (sourceModeRef.current === 'SAVED') return;
        if (!recorded.length) { if (sourceModeRef.current !== 'UPLOAD') setError(`${year}년 DB 입력 차수가 없습니다.`); return; }
        const selectedWeek = recorded.includes(week) ? week : recorded[0];
        if (selectedWeek !== weekRef.current) { invalidate(); weekRef.current = selectedWeek; if (sourceModeRef.current === 'UPLOAD') reloadUploadedScope(); }
        setWeek(selectedWeek);
        if (sourceModeRef.current !== 'UPLOAD') await loadLive(year, selectedWeek);
      } catch (cause) { if (active) setError(cause.message || 'DB 입력 차수 목록을 불러오지 못했습니다.'); }
      finally { if (active) setWeeksLoading(false); }
    }
    loadRecordedWeeks();
    return () => { active = false; };
  }, [year]);

  function invalidate() {
    revisionRef.current += 1;
    previewRequestRef.current += 1;
    setPreview(null); setAckReplacement(false); setAckQtyWarnings(false);
    setPreviewLoading(false);
  }

  async function runPreview(nextEntries = entries, nextPrices = prices, selectedYear = year, selectedWeek = week, identity = storageKey, name = fileName, selectedBulkPriceConfig = bulkPriceConfig) {
    if (!nextEntries.length || !identity || applyingRef.current) return;
    const revision = revisionRef.current;
    const request = ++previewRequestRef.current;
    setPreviewLoading(true); setError(''); setPreview(null); setAckReplacement(false); setAckQtyWarnings(false);
    try {
      const prepared = buildDutchPreviewEntries(nextEntries, nextPrices, entry => dutchPriceKey(entry, selectedBulkPriceConfig));
      const response = await fetch('/api/shipment/dutch-volume-preview', { method: 'POST', headers: requestHeaders, credentials: 'same-origin', body: JSON.stringify({ year: selectedYear, week: selectedWeek, entries: prepared, sourceFileName: name }) });
      const data = await response.json();
      if (request !== previewRequestRef.current || revision !== revisionRef.current || identity !== sourceRef.current || selectedYear !== yearRef.current || selectedWeek !== weekRef.current) return;
      if (!response.ok) throw new Error(data.error || 'ERP 미리보기 검증에 실패했습니다.');
      setMatchCache(Object.fromEntries((data.entryMatches || []).map(item => [item.id, item])));
      setCustomerOptions(data.customerOptions || []);
      setProductOptions(data.productOptions || []);
      setPreview({ ...data, revision, year: selectedYear, week: selectedWeek, sourceIdentity: identity });
      return data;
    } catch (cause) { if (request === previewRequestRef.current && revision === revisionRef.current) setError(cause.message || 'ERP 미리보기 검증에 실패했습니다.'); }
    finally { if (request === previewRequestRef.current && revision === revisionRef.current) setPreviewLoading(false); }
  }
  const yearRef = useRef(year);
  const weekRef = useRef(week);
  yearRef.current = year; weekRef.current = week;

  async function acceptSource(nextWorkbook, name, baseIdentity, nextEntries, mode) {
    const identity = dutchSourceIdentity(baseIdentity, nextEntries, yearRef.current, weekRef.current);
    const saved = readDutchDraft(localStorage, identity, nextEntries, migrateDutchPriceDraft);
    let globalBulkPriceConfig = null;
    try { globalBulkPriceConfig = JSON.parse(localStorage.getItem(BULK_PRICE_CONFIG_KEY) || 'null'); } catch { globalBulkPriceConfig = null; }
    const previousBulkPriceConfig = saved.bulkPriceConfig || undefined;
    const nextBulkPriceConfig = normalizeDutchBulkPriceConfig(globalBulkPriceConfig || saved.bulkPriceConfig, nextEntries);
    const migratedPrices = migrateDutchBulkPriceConfig(saved.entries, saved.prices, previousBulkPriceConfig, nextBulkPriceConfig).prices;
    const restoredWorkbook = applyDutchWeekdayEdits(XLSXStyled, nextWorkbook, saved.dayEdits);
    invalidate(); sourceRef.current = identity; sourceBaseRef.current = baseIdentity; sourceModeRef.current = mode; setSourceMode(mode);
    setMatchCache({}); setCustomerOptions([]); setProductOptions([]);
    setWorkbook(restoredWorkbook); setFileName(name); setStorageKey(identity); setDayEdits(saved.dayEdits || {});
    setEntries(saved.entries); setPrices(migratedPrices); setLegacyCurrency(saved.legacyCurrency);
    setBulkPriceConfig(nextBulkPriceConfig); setBulkPriceSettingsDraft(null); setBulkPriceSettingsOpen(false);
    setDraftReset(!!saved.draftReset); setRematchNotice(''); setActiveTab('sheet'); setActiveEntryId('');
    setWorkName(''); setWorkNotice(''); setWorkError('');
    setApplyResult(null);
    // Initial matching is a read-only preview. Apply is always a separate, explicit action.
    await runPreview(saved.entries, migratedPrices, yearRef.current, weekRef.current, identity, name, nextBulkPriceConfig);
  }

  async function loadLive(selectedYear = year, selectedWeek = week) {
    const request = ++loadRequestRef.current;
    invalidate(); setLoading(true); setError('');
    try {
      const result = await apiGet('/api/stats/pivot-data', { orderYear: selectedYear, weekStart: selectedWeek, weekEnd: selectedWeek });
      const liveEntries = buildDutchEntriesFromPivotData(result, selectedYear, selectedWeek);
      if (!liveEntries.length) throw new Error(`${selectedYear}년 ${selectedWeek} 네덜란드 업체별 주문수량이 없습니다.`);
      const params = new URLSearchParams({ orderYear: String(selectedYear), weekStart: selectedWeek, weekEnd: selectedWeek, species: 'country:네덜란드' });
      const volumeResponse = await fetch(`/api/stats/pivot-volume-excel?${params.toString()}`, { credentials: 'same-origin' });
      if (!volumeResponse.ok) { const detail = await volumeResponse.json().catch(() => ({})); throw new Error(detail.error || 'Pivot 물량표 원본 엑셀을 만들지 못했습니다.'); }
      const nextWorkbook = XLSXStyled.read(await volumeResponse.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      if (request !== loadRequestRef.current || selectedYear !== yearRef.current || selectedWeek !== weekRef.current) return;
      const activeCustomerKeys = (result.customersByKey || result.customers || []).map(customer => customer.custKey);
      const liveEntriesWithIdentity = attachDutchLiveCustomerKeys(XLSXStyled, nextWorkbook, parsed.entries, activeCustomerKeys);
      await acceptSource(nextWorkbook, `${selectedWeek.replace(/-/g, '')}_네덜란드.xlsx`, `live:${selectedYear}:${selectedWeek}`, liveEntriesWithIdentity, 'LIVE');
    } catch (cause) { if (request === loadRequestRef.current) setError(cause.message || '네덜란드 물량표 조회에 실패했습니다.'); }
    finally { if (request === loadRequestRef.current) setLoading(false); }
  }

  function stepWeek(delta) {
    if (!availableWeeks.length) return;
    const currentIndex = availableWeeks.indexOf(week);
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.max(0, Math.min(availableWeeks.length - 1, baseIndex - delta));
    changeWeek(availableWeeks[nextIndex]);
  }
  function clearLiveSource() {
    ++loadRequestRef.current;
    setLoading(false);
    if (!['LIVE', 'SAVED'].includes(sourceModeRef.current)) return;
    sourceRef.current = ''; sourceBaseRef.current = ''; sourceModeRef.current = '';
    setSourceMode(''); setStorageKey(''); setWorkbook(null); setFileName('');
    setEntries([]); setPrices({}); setDayEdits({}); setBulkPriceConfig(createDutchBulkPriceConfig()); setBulkPriceSettingsDraft(null); setBulkPriceSettingsOpen(false); setMatchCache({}); setApplyResult(null);
  }
  function reloadUploadedScope() {
    if (sourceModeRef.current !== 'UPLOAD' || !workbook || !sourceBaseRef.current) return;
    try {
      const parsed = parseDutchPivotWorkbook(XLSXStyled, workbook);
      void acceptSource(workbook, fileName, sourceBaseRef.current, parsed.entries, 'UPLOAD');
    } catch (cause) { setError(cause.message || '업로드 원본을 다시 읽지 못했습니다.'); }
  }
  function changeWeek(value) { if (workBusyRef.current || applyingRef.current) return; invalidate(); clearLiveSource(); weekRef.current = value; setWeek(value); reloadUploadedScope(); }
  function changeYear(value) { if (workBusyRef.current || applyingRef.current) return; invalidate(); clearLiveSource(); yearRef.current = value; setYear(value); reloadUploadedScope(); }

  async function upload(file) {
    if (workBusyRef.current || applyingRef.current) return;
    const request = ++loadRequestRef.current;
    invalidate(); setLoading(true); setError('');
    try {
      const nextWorkbook = XLSXStyled.read(await file.arrayBuffer(), { type: 'array', cellStyles: true, cellFormula: true });
      const parsed = parseDutchPivotWorkbook(XLSXStyled, nextWorkbook);
      if (request !== loadRequestRef.current) return;
      const identity = `${file.name}:${file.size}:${file.lastModified}`;
      await acceptSource(nextWorkbook, file.name, identity, parsed.entries, 'UPLOAD');
    } catch (cause) { if (request === loadRequestRef.current) setError(cause.message || '엑셀 파일을 읽지 못했습니다.'); }
    finally { if (request === loadRequestRef.current) setLoading(false); }
  }

  function updateEntry(id, change) { if (workBusyRef.current || applyingRef.current) return; invalidate(); setApplyResult(null); setEntries(previous => editDutchDraftEntry(previous, id, change)); }
  function updateCellQuantity(id, quantity, newEntry) {
    if (workBusyRef.current || applyingRef.current) return;
    invalidate(); setApplyResult(null);
    setEntries(previous => newEntry && !previous.some(entry => entry.id === id)
      ? [...previous, { ...newEntry, quantity }]
      : editDutchDraftEntry(previous, id, { quantity }));
  }
  function updateWeekday(sheetName, address, value) {
    if (workBusyRef.current || applyingRef.current || !workbook) return;
    const key = `${sheetName}!${address}`;
    const nextEdits = { ...dayEdits, [key]: String(value ?? '') };
    setDayEdits(nextEdits);
    setWorkbook(applyDutchWeekdayEdits(XLSXStyled, workbook, { [key]: value }));
  }
  function updatePrice(entry, value) {
    if (workBusyRef.current || applyingRef.current) return;
    invalidate(); setApplyResult(null);
    const keys = dutchUniformPricePeerKeys(entries, entry, bulkPriceConfig);
    setPrices(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, value])) }));
  }
  function openBulkPriceSettings() {
    const config = normalizeDutchBulkPriceConfig(bulkPriceConfig, entries);
    setBulkPriceSettingsDraft({ ...config, excludedCustomers: [...config.excludedCustomers] }); setBulkCustomerQuery('');
    setBulkPriceSettingsOpen(true);
  }
  function toggleBulkPriceExclusion(customerId) {
    setBulkPriceSettingsDraft(previous => {
      if (!previous) return previous;
      const excluded = new Set(previous.excludedCustomers);
      if (excluded.has(customerId)) excluded.delete(customerId); else excluded.add(customerId);
      return { ...previous, excludedCustomers: [...excluded] };
    });
  }
  function saveBulkPriceSettings() {
    if (!bulkPriceSettingsDraft || workBusyRef.current || applyingRef.current) return;
    const nextConfig = normalizeDutchBulkPriceConfig(bulkPriceSettingsDraft, entries);
    const migrated = migrateDutchBulkPriceConfig(entries, prices, bulkPriceConfig, nextConfig);
    invalidate(); setApplyResult(null); setBulkPriceConfig(nextConfig); setPrices(migrated.prices);
    try { localStorage.setItem(BULK_PRICE_CONFIG_KEY, JSON.stringify(nextConfig)); } catch { setError('이 브라우저에서 일괄 업체 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.'); }
    setBulkPriceSettingsOpen(false); setBulkPriceSettingsDraft(null);
    setRematchNotice(migrated.conflicts.length
      ? `일괄 적용 범위가 저장됐습니다. 업체별 단가가 달라 ${migrated.conflicts.length}개 품목 묶음은 자동 통합하지 않았습니다. 해당 품목 단가를 확인해 주세요.`
      : `일괄 업체 설정을 저장했습니다. 포함 ${bulkCustomers.filter(item => nextConfig.enabled && !nextConfig.excludedCustomers.includes(item.id)).length}개 · 제외/개별 ${bulkCustomers.filter(item => !nextConfig.enabled || nextConfig.excludedCustomers.includes(item.id)).length}개. 새 설정으로 다시 검증하세요.`);
  }
  function restorePriceDraft(snapshot) {
    if (workBusyRef.current || applyingRef.current) return;
    invalidate(); setApplyResult(null);
    setPrices(previous => restoreDutchPriceDraft(previous, snapshot));
  }
  function pickMaster(entry, kind, item) {
    if (workBusyRef.current || applyingRef.current) return;
    const next = kind === 'product'
      ? { prodKey: Number(item.prodKey ?? item.ProdKey), product: String(item.prodName || item.ProdName || item.displayName || item.DisplayName || '') }
      : { custKey: Number(item.custKey ?? item.CustKey) };
    const masterField = kind === 'product' ? 'prodKey' : 'custKey';
    const pickedKey = Number(next[masterField]);
    const oldMasterKey = Number(entry[masterField]) || 0;
    const sameSource = kind === 'customer'
      ? row => !!entry.sheetName && row.sheetName === entry.sheetName && row.sourceColumn === entry.sourceColumn && row.sourceCustomer === entry.sourceCustomer
      : row => !!entry.sheetName && row.sheetName === entry.sheetName && row.sourceRow === entry.sourceRow
        && row.sourceFlower === entry.sourceFlower && row.sourceItem === entry.sourceItem && row.sourceColor === entry.sourceColor;
    const targetEntries = entries.filter(row => (row.id === entry.id || (sameSource(row)
      && (!Number(row[masterField]) || Number(row[masterField]) === oldMasterKey || Number(row[masterField]) === pickedKey))));
    const targetIds = new Set(targetEntries.map(row => row.id));
    const updates = targetEntries.map(row => ({ row, updated: { ...row, ...next } }));
    const priceMoves = updates.map(({ row, updated }) => ({ oldKey: dutchPriceKey(row, bulkPriceConfig), newKey: dutchPriceKey(updated, bulkPriceConfig) }))
      .filter(move => move.oldKey !== move.newKey);
    const movesByTarget = new Map();
    for (const move of priceMoves) {
      const oldValue = prices[move.oldKey];
      if (oldValue === undefined || oldValue === null || String(oldValue) === '') continue;
      const values = movesByTarget.get(move.newKey) || new Set();
      values.add(String(oldValue));
      movesByTarget.set(move.newKey, values);
    }
    const existingPriceConflicts = [...movesByTarget].filter(([newKey, values]) => {
      const existing = prices[newKey];
      return existing !== undefined && existing !== null && String(existing) !== '' && [...values].some(value => value !== String(existing));
    });
    if (existingPriceConflicts.length && !window.confirm(`선택한 ERP 품목에는 기존 단가가 있습니다. 해당 ERP 단가를 유지하며 같은 원본 행 ${targetEntries.length}건을 함께 매칭할까요?`)) return;

    const nextPrices = { ...prices };
    const priceWarnings = [];
    let carriedPrice = false;
    for (const [newKey, values] of movesByTarget) {
      const existing = nextPrices[newKey];
      if (existing !== undefined && existing !== null && String(existing) !== '') continue;
      if (values.size === 1) { nextPrices[newKey] = [...values][0]; carriedPrice = true; }
      else priceWarnings.push('여러 원본 단가가 달라 새 품목 단가로 자동 이동하지 않았습니다.');
    }
    const newKeys = new Set(updates.map(({ updated }) => dutchPriceKey(updated, bulkPriceConfig)));
    const untouched = entries.filter(row => !targetIds.has(row.id));
    for (const oldKey of new Set(priceMoves.map(move => move.oldKey))) {
      if (!newKeys.has(oldKey) && !untouched.some(row => dutchPriceKey(row, bulkPriceConfig) === oldKey)) delete nextPrices[oldKey];
    }

    invalidate(); setApplyResult(null);
    setEntries(previous => previous.map(row => targetIds.has(row.id) ? { ...row, ...next } : row));
    if (JSON.stringify(nextPrices) !== JSON.stringify(prices)) setPrices(nextPrices);
    setRematchNotice(priceWarnings[0] || (carriedPrice
      ? `단가를 보존하며 같은 원본 ${kind === 'product' ? '품목 행' : '업체 열'} ${targetEntries.length}건을 매칭했습니다.`
      : `같은 원본 ${kind === 'product' ? '품목 행' : '업체 열'} ${targetEntries.length}건을 함께 매칭했습니다. 전체 적용 전 다시 검증하세요.`));
  }
  function openMatchPopup({ kind, entryId, initialQuery, country = '네덜란드', flower = '', options = [], onPick, returnFocusElement } = {}) {
    if (workBusyRef.current || applyingRef.current || typeof window === 'undefined') return false;
    const token = window.crypto?.randomUUID?.() || `dutch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const params = new URLSearchParams({ popup: '1', token, kind, entryId: String(entryId || ''), query: String(initialQuery || ''), country, flower });
    const popup = window.open(`/stats/dutch-volume-match?${params.toString()}`, `dutch-erp-match-${token}`, 'popup=yes,width=1100,height=820,left=120,top=80,resizable=yes,scrollbars=yes');
    if (!popup) { setError('매칭 새 창이 브라우저에서 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 선택하세요.'); return false; }
    setError('');
    matchPopupRequestsRef.current.set(token, { popup, kind, options: kind === 'customer' ? options : [], onPick, returnFocusElement });
    popup.focus();
    return true;
  }
  function openUnmatchedEntry(entry, kind, returnFocusElement = typeof document === 'undefined' ? null : document.activeElement) {
    const initialQuery = kind === 'product'
      ? (entry.sourceItem || entry.sourceColor || entry.color || entry.product)
      : customerName(entry.sourceCustomer || entry.customer);
    openMatchPopup({ kind, entryId: entry.id, initialQuery, country: '네덜란드', flower: entry.sourceFlower || '', options: customerOptions, onPick: item => pickMaster(entry, kind, item), returnFocusElement });
  }
  function addRow() {
    if (workBusyRef.current || applyingRef.current) return;
    invalidate();
    const id = `manual:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    setEntries(previous => [...previous, newDutchDraftEntry(id)]);
    setActiveEntryId(id); setActiveTab('edit'); setQuery('');
  }
  function removeRow(id) { if (workBusyRef.current || applyingRef.current) return; invalidate(); setEntries(previous => previous.filter(row => row.id !== id)); }
  function moveNext(event, index) { if (event.key === 'Enter') { event.preventDefault(); inputRefs.current[index + 1]?.focus(); inputRefs.current[index + 1]?.select(); } }

  async function download() {
    if (!workbook) return;
    try {
      const edited = withEditedWorkbook(workbook, entries, prices, bulkPriceConfig);
      const priced = addDutchPriceColumns(XLSXStyled, edited, entries, prices, 'KRW', bulkPriceConfig);
      const base = XLSXStyled.write(priced.workbook, { type: 'array', bookType: 'xlsx', compression: true });
      const shaped = await addDutchPriceShapesToXlsx(XLSXStyled, base, priced.workbook, entries.filter(row => !row.added), prices, bulkPriceConfig);
      const url = URL.createObjectURL(new Blob([shaped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${fileName.replace(/\.xlsx?$/i, '')}_입력.xlsx`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause.message || '엑셀 저장에 실패했습니다.'); }
  }

  async function loadWorkHistory(append = false) {
    const request = ++historyRequestRef.current;
    setHistoryLoading(true); setWorkError('');
    try {
      const params = append && historyCursor ? `?cursor=${encodeURIComponent(historyCursor)}` : '';
      const response = await fetch(`/api/shipment/dutch-volume-work${params}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '작업 이력을 불러오지 못했습니다.');
      if (request !== historyRequestRef.current) return;
      setWorkHistory(previous => append ? [...previous, ...(data.items || [])] : (data.items || []));
      setHistoryCursor(data.nextCursor || null);
      if (data.corruptCount) setWorkError(`읽을 수 없는 저장본 ${data.corruptCount}건이 있습니다. 관리자 확인이 필요합니다.`);
    } catch (cause) { if (request === historyRequestRef.current) setWorkError(cause.message); }
    finally { if (request === historyRequestRef.current) setHistoryLoading(false); }
  }

  async function persistWork(name = workName) {
    const payload = buildDutchWorkPayload({ name, sourceMode, fileName, year, week, workbook, entries, prices, bulkPriceConfig, sourceIdentity: storageKey });
    const body = JSON.stringify(payload);
    if (new Blob([body]).size > DUTCH_WORK_CLIENT_MAX_BYTES) throw new Error('작업 저장 용량은 900KB 이하입니다. 단가표 엑셀로 먼저 보관하고 불필요한 원본 시트를 정리하세요.');
    const response = await fetch('/api/shipment/dutch-volume-work', { method: 'POST', headers: requestHeaders, credentials: 'same-origin', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || '작업 저장 응답을 확인하지 못했습니다. 저장 이력을 먼저 확인하세요.');
    setWorkNotice(`작업 저장 완료 · ${data.snapshot.name} · ${new Date(data.snapshot.savedAt).toLocaleString('ko-KR')} (ERP 반영과 별도)`);
    setHistoryOpen(true);
    void loadWorkHistory();
    return data.snapshot;
  }

  async function saveWork() {
    if (workBusyRef.current || applyingRef.current || loading) return;
    workBusyRef.current = true; setWorkBusy(true); setWorkError(''); setWorkNotice('');
    try { await persistWork(); }
    catch (cause) { setWorkError(cause.message); }
    finally { workBusyRef.current = false; setWorkBusy(false); }
  }

  async function restoreWork(id) {
    if (workBusyRef.current || applyingRef.current || loading) return;
    if (!window.confirm('저장본의 연도·차수, 원본 시트, 수량·매칭·단가로 현재 작업을 교체합니다. 아직 저장하지 않은 수정은 먼저 작업 저장하세요. 불러오기만으로 ERP에는 반영되지 않습니다. 계속하시겠습니까?')) return;
    workBusyRef.current = true; setWorkBusy(true); setWorkError(''); setWorkNotice('');
    ++loadRequestRef.current; invalidate();
    try {
      const response = await fetch(`/api/shipment/dutch-volume-work?id=${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '저장본을 불러오지 못했습니다.');
      const restored = restoreDutchWorkSnapshot(data.snapshot);
      const restoredBulkConfig = normalizeDutchBulkPriceConfig(restored.bulkPriceConfig, restored.entries);
      sourceModeRef.current = 'SAVED'; sourceRef.current = restored.identity; sourceBaseRef.current = restored.baseIdentity;
      yearRef.current = restored.year; weekRef.current = restored.week;
      setYear(restored.year); setWeek(restored.week); setSourceMode('SAVED'); setStorageKey(restored.identity);
      setWorkbook(restored.workbook); setEntries(restored.entries); setPrices(restored.prices); setBulkPriceConfig(restoredBulkConfig); setBulkPriceSettingsDraft(null); setBulkPriceSettingsOpen(false); setDayEdits({}); setFileName(restored.fileName);
      setWorkName(restored.name); setMatchCache({}); setProductOptions([]); setCustomerOptions([]);
      setApplyResult(null); setActiveJobId(''); setLegacyCurrency(''); setDraftReset(false); setRematchNotice('');
      setQuery(''); setActiveTab('sheet'); setActiveEntryId(''); setError('');
      setWorkNotice('저장본을 불러왔습니다. ERP 반영 전 ‘작업 완료·업로드 검토’로 현재 DB를 다시 검증하세요.');
    } catch (cause) { setWorkError(cause.message); }
    finally { workBusyRef.current = false; setWorkBusy(false); }
  }

  async function reviewForUpload() {
    if (workBusyRef.current || applyingRef.current || loading || previewLoading) return;
    const result = await runPreview();
    if (result) requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }

  async function recoverJob(jobId) {
    const deadline = Date.now() + 12 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      try {
        const response = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' });
        if (response.status === 401) throw new Error('로그인 세션이 만료되었습니다. 작업 ID로 관리자에게 확인하세요.');
        if (!response.ok) continue;
        const data = await response.json();
        if (!data.progress) continue;
        setApplyResult(previous => ({ ...previous, progress: data.progress }));
        if (data.progress.finished) return data.progress.result || { success: false, error: data.progress.error?.message || '서버 적용 작업 실패' };
      } catch (cause) { if (cause.message?.includes('로그인 세션')) throw cause; }
    }
    throw new Error(`결과를 확인하지 못했습니다. 자동 재적용하지 마세요. 작업 ID ${jobId}로 이력을 확인하세요.`);
  }

  async function applyPreview() {
    if (!previewCurrent || !ackReplacement || (warningRows.length && !ackQtyWarnings) || applyingRef.current || workBusyRef.current) return;
    const summary = `${year}년 ${week} 선택 품종 전체 교체\n대상 품종: ${(preview.replacementCategories || []).join(', ') || '서버 검증 범위'}\n변경 ${changedRows.length}건 / 파일 누락 분배 0 ${missingRows.length}건 / 확정 차단 ${blockedRows.length}건\n기존 주문은 보존, 없는 양수 주문만 생성합니다.\n표에 표시된 기존→최종 수량과 원화 단가를 확인하셨습니까?`;
    if (!window.confirm(summary)) return;
    // Archive the reviewed input before issuing the existing single-use ERP job.
    workBusyRef.current = true; setWorkBusy(true); setWorkError('');
    try { await persistWork(workName || `${year}년 ${week} ${fileName} · ERP 적용 전`); }
    catch (cause) { setWorkError(`${cause.message} ERP 적용 요청은 보내지 않았습니다.`); return; }
    finally { workBusyRef.current = false; setWorkBusy(false); }
    const jobId = `dutch_${crypto.randomUUID()}`;
    applyingRef.current = true; setApplying(true); setActiveJobId(jobId); setError(''); setApplyResult({ running: true, progress: { stage: '서버 요청 중', done: 0, total: previewRows.length, logs: ['서버 적용 중입니다. 창을 닫거나 다시 적용하지 마세요.'] } });
    const timer = setInterval(async () => {
      try { const response = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' }); const data = await response.json(); if (data.progress) setApplyResult(previous => previous?.running ? { ...previous, progress: data.progress } : previous); } catch { /* POST result or recovery determines completion. */ }
    }, 900);
    try {
      let data;
      let response;
      try { response = await fetch('/api/shipment/dutch-volume-apply', { method: 'POST', headers: requestHeaders, credentials: 'same-origin', body: JSON.stringify({ planToken: preview.planToken, jobId, ackQtyWarnings }) }); }
      catch { data = await recoverJob(jobId); }
      if (!data && [502, 503, 504].includes(response.status)) data = await recoverJob(jobId);
      if (!data) { try { data = await response.json(); } catch { data = await recoverJob(jobId); } }
      if (!data.success) throw new Error(data.error || 'ERP 적용 실패');
      setApplyResult({ ...data, running: false });
      invalidate();
    } catch (cause) {
      let finalProgress = null;
      try {
        const response = await fetch(`/api/shipment/distribute-import-apply-progress?jobId=${encodeURIComponent(jobId)}`, { credentials: 'same-origin' });
        const payload = await response.json();
        finalProgress = payload.progress || null;
      } catch { /* Keep the latest already-polled snapshot if recovery is unavailable. */ }
      const message = cause.message || 'ERP 적용 실패.';
      setError(`${message} 작업 로그를 확인하고, 수정 후 다시 적용할 때는 ‘ERP 매칭·최종수량 다시 검증’을 먼저 실행하세요. 결과 미확인 상태에서는 재적용하지 마세요.`);
      setApplyResult(previous => ({ ...previous, progress: finalProgress || previous.progress, running: false, failed: true, error: message }));
      invalidate();
    }
    finally { clearInterval(timer); applyingRef.current = false; setApplying(false); }
  }

  return <><Head><title>네덜란드 물량표 - nenova ERP</title></Head><style jsx>{`
    .dutch-board{padding:10px;min-height:calc(100vh - 44px);zoom:.7;width:142.8571429%;box-sizing:border-box}
    .dutch-board>header{padding:9px 14px}
    .board-layout{display:grid;grid-template-columns:minmax(0,1fr) 370px;gap:10px;align-items:start;margin-top:8px}
    .source-controls{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin-top:8px;padding:9px;background:#fff;border:1px solid #c9d4e3;border-radius:5px}
    .source-controls h2{font-size:13px;color:#16335e;margin:0 6px 5px 0}
    .source-controls .upload{display:flex;align-items:center;justify-content:center;min-height:32px;padding:5px 12px;border:1px solid #aebbd0;border-radius:4px}
    .source-controls .live-load{display:flex;align-items:end;gap:8px;margin:0;padding:0;border:0;background:transparent;flex:1;min-width:480px}
    .source-controls .live-load .load{border-radius:4px;min-height:32px}
    .source-controls .live-load label div select{width:100px}
    .always-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:#e8f1ff;border:1px solid #a8c7ef;border-radius:5px}
    .always-actions button{padding:7px 10px;border:1px solid #8aa8cc;border-radius:4px;background:#fff;color:#164c94;font-weight:800}
    .always-actions button:disabled{opacity:.55;cursor:not-allowed}
    .always-actions span{font-size:12px;color:#52647c}
    .board-primary{grid-column:1;grid-row:1;min-width:0}
    .board-side{grid-column:2;grid-row:1;display:flex;flex-direction:column;gap:8px;min-width:0}
    .side-card{padding:9px;background:#fff;border:1px solid #c9d4e3;border-radius:5px;min-width:0}
    .side-card h2{font-size:13px;margin:0 0 7px;color:#16335e}
    .side-source{display:flex;flex-direction:column;gap:8px}
    .board-side .upload{display:flex;align-items:center;justify-content:center;min-height:32px;padding:5px 10px;border:1px solid #aebbd0;border-radius:4px}
    .board-side .live-load{display:grid;grid-template-columns:1fr 1fr;align-items:end;gap:6px;margin:0;padding:0;border:0;background:transparent}
    .board-side .live-load label{display:flex;flex-direction:column;gap:3px;font-size:11px}
    .board-side .live-load label>input,.board-side .live-load label div{width:100%;box-sizing:border-box}
    .board-side .live-load label div select{width:auto;flex:1}
    .board-side .live-load label div button{min-width:27px;padding:0 5px}
    .board-side .live-load .load,.board-side .live-load>span{grid-column:1/-1}
    .board-side .live-load .load{width:100%;min-height:34px;border-radius:4px}
    .board-side .live-load>span{margin:0;line-height:1.35}
    .board-primary .toolbar{margin-top:0}
    .board-primary .guide{display:none}
    .board-primary .actions{display:none}
    .side-instructions{font-size:11px;color:#3c587d}
    .side-instructions summary{cursor:pointer;font-weight:700}
    .side-instructions p{margin:7px 0 0;line-height:1.45}
    .board-primary .grid-wrap{max-height:calc(100vh - 250px);min-height:calc(100vh - 250px)}
    .board-primary :global(.sheet-scroll){max-height:calc(100vh - 235px);min-height:calc(100vh - 235px)}
    .board-primary .mapping-table{table-layout:fixed;width:100%;font-size:15px}
    .board-primary .mapping-table th,.board-primary .mapping-table td{height:auto;min-height:42px;padding:6px 5px;white-space:normal;overflow-wrap:anywhere;vertical-align:middle}
    .board-primary .mapping-table td input,.board-primary .mapping-table td select{width:100%;min-width:0;box-sizing:border-box;font-size:14px}
    .board-primary .mapping-table td>small{font-size:12px;line-height:1.25}
    .board-primary .mapping-table .status{font-size:13px}
    .side-history :global(.work-panel){margin:0;padding:8px}
    .side-history :global(.work-actions){display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .side-history :global(.work-actions input){grid-column:1/-1;min-width:0;width:100%;max-width:none;box-sizing:border-box}
    .side-history :global(.work-actions .primary){grid-column:1/-1;margin-left:0}
    .side-history :global(.work-panel button){padding:6px 7px;font-size:11px}
    .side-history :global(.history-table){max-height:300px}
    .side-history :global(.history-table td:nth-child(2)){min-width:110px;max-width:150px}
    @media(max-width:1200px){.board-layout{grid-template-columns:minmax(0,1fr) 320px}.board-primary .grid-wrap{max-height:65vh;min-height:360px}}
    @media(max-width:1100px){.dutch-board{zoom:1;width:100%}.board-layout{display:flex;flex-direction:column}.board-primary{order:0;width:100%}.board-side{order:1;width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}.board-side .side-source{grid-column:1/-1}.side-history{grid-column:1/-1}.source-controls .live-load{min-width:min(480px,100%);flex-wrap:wrap}.source-controls .live-load>span{width:100%}}
    @media(max-width:760px){.board-layout{display:flex}.board-side{display:flex}.board-primary .grid-wrap,.board-primary :global(.sheet-scroll){max-height:55vh;min-height:300px}}
  `}</style><section className="dutch-board">
    <header><div><h1>네덜란드 물량표</h1><p>원본 엑셀을 올리고 ERP 업체·품목 매칭, 최종 분배수량, 원화 단가를 검토합니다.</p></div></header>
    <section className="source-controls" aria-label="물량표 불러오기"><h2>물량표 입력</h2><label className="upload">엑셀 업로드<input type="file" accept=".xlsx,.xls" disabled={workBusy || applying} onChange={event => event.target.files?.[0] && upload(event.target.files[0])}/></label>
      <div className="live-load"><label>연도<input aria-label="연도" type="number" min="2000" max="2100" value={year} disabled={workBusy || applying} onChange={event => changeYear(Number(event.target.value))}/></label><label>DB 입력 차수<div><button aria-label="이전 입력 차수" onClick={() => stepWeek(-1)} disabled={workBusy || applying || weeksLoading || (!availableWeeks.length && sourceMode !== 'SAVED')}>‹</button><select aria-label="차수" value={week} onChange={event => changeWeek(event.target.value)} disabled={workBusy || applying || weeksLoading || !availableWeeks.length}>{weeksLoading && <option value="">조회 중…</option>}{!weeksLoading && !availableWeeks.length && <option value="">입력 이력 없음</option>}{(sourceMode === 'SAVED' && !availableWeeks.includes(week) ? [week, ...availableWeeks] : availableWeeks).map(recordedWeek => <option key={recordedWeek} value={recordedWeek}>{recordedWeek}</option>)}</select><button aria-label="다음 입력 차수" onClick={() => stepWeek(1)} disabled={workBusy || applying || weeksLoading || !availableWeeks.length}>›</button></div></label><button className="load" onClick={() => loadLive(year, week)} disabled={workBusy || applying || loading || weeksLoading || !availableWeeks.length}>{loading ? '조회 중…' : '네노바웹 물량 바로 불러오기'}</button><span>선택 연도·차수는 ERP 검증에도 사용됩니다.</span></div>
    </section>
    <div className="always-actions" aria-label="물량표 작업 도구"><button onClick={addRow} disabled={workBusy || applying}>업체·품목 행 추가</button><button onClick={() => runPreview()} disabled={workBusy || applying || previewLoading || !entries.length}>{previewLoading ? '검증 중…' : 'ERP 매칭·최종수량 다시 검증'}</button><span>{entries.length ? (previewCurrent ? '검증됨 — 아래 전체 교체 범위를 확인하세요.' : validationCurrent ? '검증 완료 — 아래 미매칭·차단 사유를 확인하세요.' : '편집 후에는 다시 검증해야 적용할 수 있습니다.') : '물량표를 불러오거나 엑셀을 업로드하면 작업할 수 있습니다.'}</span></div>
    <div className="board-layout"><main className="board-primary" aria-label="네덜란드 물량표">
    {error && <div className="notice error" role="alert">{error}</div>}
    {legacyCurrency && <div className="notice warning">이 파일의 이전 {legacyCurrency} 단가 초안은 원화로 재해석하지 않았습니다. 필요한 원화 단가를 다시 입력하세요.</div>}
    {draftReset && <div className="notice warning">이전 양식 초안은 자동 복원하지 않았습니다. 원본과 단가·매칭을 다시 확인하세요. 이전 저장값은 삭제하지 않았습니다.</div>}
    {rematchNotice && <div className="notice warning" role="status">{rematchNotice}</div>}
    {!entries.length && !loading && <div className="empty">네덜란드 Pivot 엑셀을 올리거나 DB 물량을 조회해 주세요. 조회와 자동 매칭은 읽기 전용이며 적용 버튼을 누르기 전에는 ERP에 저장하지 않습니다.</div>}
    {!!entries.length && <><div className="toolbar"><div><b>{sourceMode === 'LIVE' ? `네노바웹 ${year}년 ${week} 직접 조회` : fileName}</b><span>{entries.length}행 · 원화 단가 입력 {enteredPriceCount}행 · 미입력은 기존 단가 보존</span></div><input aria-label="업체·품목 검색" value={query} onChange={event => { setQuery(event.target.value); if (event.target.value) setActiveTab('edit'); }} placeholder="업체·품목 검색"/><span className="currency">KRW 원화 고정</span><button className="bulk-settings-trigger" onClick={openBulkPriceSettings} disabled={workBusy || applying}>일괄업체 설정 · {bulkPriceConfig.enabled ? bulkCustomers.filter(item => !bulkPriceConfig.excludedCustomers.includes(item.id)).length : 0}개 포함</button><button onClick={download}>단가표 엑셀 저장</button></div>
      {bulkPriceSettingsOpen && bulkPriceSettingsDraft && <div className="bulk-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setBulkPriceSettingsOpen(false); }}><section className="bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-settings-title"><header><div><h2 id="bulk-settings-title">일괄 단가 업체 설정</h2><p>체크한 업체는 일괄 단가에서 제외되어 업체별로 따로 입력됩니다.</p></div><button aria-label="닫기" onClick={() => setBulkPriceSettingsOpen(false)}>×</button></header><label className="bulk-enabled"><input type="checkbox" checked={bulkPriceSettingsDraft.enabled} onChange={event => setBulkPriceSettingsDraft(previous => ({ ...previous, enabled: event.target.checked }))}/> 일괄 단가 사용</label><div className="bulk-modal-count">포함 {bulkCustomers.filter(item => bulkPriceSettingsDraft.enabled && !bulkPriceSettingsDraft.excludedCustomers.includes(item.id)).length}개 · 개별/제외 {bulkCustomers.filter(item => !bulkPriceSettingsDraft.enabled || bulkPriceSettingsDraft.excludedCustomers.includes(item.id)).length}개 <span>주광은 기본 제외이며 변경할 수 있습니다.</span></div><input className="bulk-search" aria-label="업체 설정 검색" placeholder="업체 검색" value={bulkCustomerQuery} onChange={event => setBulkCustomerQuery(event.target.value)}/><div className="bulk-customer-list">{bulkCustomers.filter(item => item.label.toLowerCase().includes(bulkCustomerQuery.trim().toLowerCase())).map(item => <label key={item.id}><input type="checkbox" checked={bulkPriceSettingsDraft.excludedCustomers.includes(item.id)} disabled={!bulkPriceSettingsDraft.enabled} onChange={() => toggleBulkPriceExclusion(item.id)}/><span>{item.label}</span><small>{!bulkPriceSettingsDraft.enabled || bulkPriceSettingsDraft.excludedCustomers.includes(item.id) ? '개별 단가' : '일괄 적용'}</small></label>)}</div><footer><button onClick={() => setBulkPriceSettingsOpen(false)}>취소</button><button className="save-bulk" onClick={saveBulkPriceSettings} disabled={workBusy || applying}>설정 저장</button></footer></section></div>}
      <div className="sheet-tabs" role="tablist" aria-label="물량표 작업 보기">
        <button role="tab" aria-selected={activeTab === 'sheet'} onClick={() => setActiveTab('sheet')}>원본 물량표</button>
        <button role="tab" aria-selected={activeTab === 'edit'} onClick={() => setActiveTab('edit')}>단가 수정·매칭</button>
        <span>같은 초안으로 연결됩니다 · 수량 셀 클릭은 수량 변경, 원화 입력·품목 매칭도 여기서 바로 편집</span>
      </div>
      {activeTab === 'sheet' && <DutchVolumeSheet workbook={workbook} entries={entries} prices={prices} priceKey={entry => dutchPriceKey(entry, bulkPriceConfig)} matchCache={matchCache} validationCurrent={matchStatusUsable} activeEntryId={activeEntryId} disabled={workBusy || applying} onQuantityChange={updateCellQuantity} onPriceChange={updatePrice} onPriceRestore={restorePriceDraft} onDayChange={updateWeekday} onMatch={openUnmatchedEntry}/>}
      {activeTab === 'edit' && <><div className="editor-context"><b>{activeEntryId ? (() => { const row = entries.find(item => item.id === activeEntryId); return row ? `${row.sourceCustomer || row.customer} · ${row.sourceItem || row.color || row.product} · ${row.cellAddress || '수동 추가'}` : '전체 입력'; })() : '업체·품목별 단가와 매칭 수정'}</b><button onClick={() => setActiveTab('sheet')}>물량표에서 확인 ↗</button><span>원본 품목 옆 ERP 품목, 원본 업체 옆 ERP 업체를 표시합니다. Enter로 선택 창을 열고 Esc로 닫을 수 있습니다.</span></div>
      <div className="grid-wrap" aria-label="물량 초안 표 가로 세로 스크롤"><table className="mapping-table"><colgroup><col style={{ width: '14%' }}/><col style={{ width: '20%' }}/><col style={{ width: '12%' }}/><col style={{ width: '20%' }}/><col style={{ width: '6%' }}/><col style={{ width: '7%' }}/><col style={{ width: '14%' }}/><col style={{ width: '7%' }}/></colgroup><thead><tr><th>품목 / 원문</th><th>ERP 매칭 품목</th><th>업체 / 원문</th><th>ERP 매칭 업체</th><th>수량</th><th>단위</th><th>단가 (KRW / 견적단위)</th><th>상태</th></tr></thead><tbody>{visibleEntries.map((row, index) => {
        const individual = !isDutchBulkPriceCustomer(row, bulkPriceConfig);
        const match = matchCache[row.id];
        return <tr key={row.id} ref={node => { editRowRefs.current[row.id] = node; }} className={`${match?.status === 'unmatched' ? 'unmatched' : ''} ${activeEntryId === row.id ? 'selected-entry' : ''}`}>
          <td title={row.sourceItem || row.product}>{row.added ? <input aria-label="추가 품목명" value={row.product} onChange={event => updateEntry(row.id, { product: event.target.value })}/> : <><b>{row.sourceItem || row.color || row.product}</b><small>{row.sourceFlower || row.product} · {row.sourceColor || ''} · {row.sheetName}!{row.cellAddress}</small></>}</td>
          <td title={row.sourceCustomer || row.customer}>{row.added ? <input aria-label="추가 업체명" value={row.customer} onChange={event => updateEntry(row.id, { customer: event.target.value })}/> : <b>{customerName(row.sourceCustomer || row.customer)}</b>}<small className={individual ? 'individual-price' : 'uniform-price'}>{individual ? '개별 단가' : '일괄 단가'}</small></td>
          <td><ErpMatchPicker kind="product" entryId={row.id} initialQuery={row.sourceItem || row.color || row.product} country="네덜란드" flower={row.sourceFlower || ''} value={row.prodKey || match?.prodKey} label={row.prodKey ? row.product : match?.prodName} options={productOptions} onOpen={openMatchPopup} onPick={item => pickMaster(row, 'product', item)} disabled={workBusy || applying}/></td>
          <td><ErpMatchPicker kind="customer" entryId={row.id} initialQuery={match?.custName || customerName(row.sourceCustomer || row.customer)} value={row.custKey || match?.custKey} label={match?.custName || (row.custKey ? row.customer : '')} options={customerOptions} onOpen={openMatchPopup} onPick={item => pickMaster(row, 'customer', item)} disabled={workBusy || applying}/></td>
          <td><input aria-label={`${customerName(row.customer)} ${row.product} 수량`} type="number" min="0" step="any" value={row.quantity} disabled={workBusy || applying} onChange={event => updateEntry(row.id, { quantity: event.target.value })}/></td>
          <td><select aria-label={`${row.product} 단위`} value={row.unit || ''} disabled={workBusy || applying} onChange={event => updateEntry(row.id, { unit: event.target.value })}><option value="">ERP 출고단위</option><option value="박스">박스</option><option value="단">단</option><option value="송이">송이</option></select></td>
          <td><input ref={node => { inputRefs.current[index] = node; priceInputRefs.current[row.id] = node; }} aria-label={`${customerName(row.customer)} ${row.sourceItem || row.color || row.product} ${individual ? '개별단가' : '균일가'}`} type="number" min="0" step="any" value={prices[dutchPriceKey(row, bulkPriceConfig)] ?? ''} disabled={workBusy || applying} onChange={event => updatePrice(row, event.target.value)} onKeyDown={event => moveNext(event, index)} placeholder="미입력: 보존"/><small>{match?.estUnit ? match.estUnit : '견적단위: 검증 후 확인'}</small></td>
          <td className="status">{matchStatusUsable && match?.status === 'unmatched' ? <span style={{ color: '#b42318', fontWeight: 800, fontSize: 11 }}>미매칭 · {customerName(row.sourceCustomer || row.customer)}</span> : null}{row.added && <button onClick={() => removeRow(row.id)} disabled={workBusy || applying}>행 삭제</button>}</td>
        </tr>;
      })}</tbody></table></div></>}
      {entries.some(row => row.added || row.prodKey || row.custKey) && <p className="export-note">원본 Pivot 셀과 단가 도형은 보존됩니다. 수동 추가·ERP 재매칭을 포함한 전체 입력은 내보내기 파일의 ‘ERP적용초안’ 시트에 별도로 기록됩니다. 원본 시트의 업체·품목 표시는 재매칭 결과로 바꾸지 않습니다.</p>}
      {preview && <section className="review" ref={reviewRef}><div className="review-head"><h2>ERP 최종 적용 미리보기</h2><span>{validationCurrent ? '현재 초안 검증' : '초안 변경으로 무효화됨'}</span></div><p>범위: {preview.orderYear ?? year}년 {preview.week ?? week} · 서버가 판정한 CountryFlower {(preview.replacementCategories || []).join(', ') || '검증 범위'} 전체 교체. 파일에 없는 기존 업체·품목도 최종 0으로 표시됩니다. 표 필터와 무관하게 전체가 적용 대상입니다.</p><div className="kpis"><b>전체 {previewRows.length}</b><b>변경 {changedRows.length}</b><b>누락→0 {missingRows.length}</b><b>확정 차단 {blockedRows.length}</b><b>미매칭 {(preview.unmatched || []).length}</b></div>
        {(preview.unmatched || []).length > 0 && <div className="notice error">미매칭 {(preview.unmatched || []).length}건. 위 초안에서 ERP 업체·품목을 선택하고 다시 검증하세요. {(preview.unmatched || []).slice(0, 8).map(item => item.reason || item.product || item.customer).join(' / ')}</div>}
        {!!preview.blockers?.length && <div className="notice warning" role="alert">{preview.blockers.join(' / ')}</div>}
        <div className="preview-wrap" aria-label="전체 교체 미리보기 표 가로 세로 스크롤"><table><thead><tr><th>구분</th><th>업체</th><th>품목</th><th>기존 주문</th><th>적용 후 주문</th><th>기존 분배</th><th>최종 분배 (출고단위)</th><th>증감</th><th>기존 단가</th><th>최종 단가 KRW / 견적단위</th><th>상태 / 차단 사유</th></tr></thead><tbody>{previewRows.map((row, index) => <tr key={`${row.custKey}:${row.prodKey}:${index}`} className={dutchPreviewRowKind(row)}><td>{row.missingFromExcel ? '파일 누락→0' : row.priceChanged && !num(row.shipmentDiffQty) ? '단가만' : '입력'}</td><td>{row.custName || row.customer}</td><td>{row.prodName || row.product || row.displayName}</td><td className="number">{fmt(row.orderBeforeQty ?? row.orderQty)}</td><td className="number">{fmt(row.orderAfterQty ?? row.orderBeforeQty ?? row.orderQty)}</td><td className="number">{fmt(row.currentOutQty)}</td><td className="number">{fmt(row.uploadQty)} {row.outUnit || ''}</td><td className="number">{fmt(row.shipmentDiffQty)}</td><td className="number">{row.currentCost == null ? '-' : fmt(row.currentCost)}</td><td className="number">{row.unitPrice == null ? '보존' : `${fmt(row.targetCost ?? row.unitPrice)}${num(row.unitPrice) === 0 ? ' (명시 0원)' : ''}`} {row.estUnit || ''}</td><td>{row.fixBlocked ? '확정 차단' : row.qtyWarnings?.map(item => item.message).join(' / ') || row.status || '검증'} {row.reason || ''}</td></tr>)}</tbody></table></div>
        {!!(preview.logs || []).length && <details><summary>검증 로그</summary><div className="logs">{preview.logs.map((line, index) => <div key={index}>{typeof line === 'string' ? line : JSON.stringify(line)}</div>)}</div></details>}
        <div className="approval"><label><input type="checkbox" checked={ackReplacement} disabled={workBusy || !previewCurrent || applying} onChange={event => setAckReplacement(event.target.checked)}/> 파일 누락행의 최종 0과 위 전체 수량·주문·원화 단가를 확인했습니다.</label>{warningRows.length > 0 && <label><input type="checkbox" checked={ackQtyWarnings} disabled={workBusy || !previewCurrent || applying} onChange={event => setAckQtyWarnings(event.target.checked)}/> 수량 경고 {warningRows.length}건을 확인했습니다.</label>}<button className="apply" disabled={workBusy || !previewCurrent || !ackReplacement || !!blockedRows.length || !!(preview.unmatched || []).length || !!(warningRows.length && !ackQtyWarnings) || applying} onClick={applyPreview}>{applying ? '적용 중…' : '확인한 전체 범위 ERP 적용'}</button>{!preview?.planToken && <strong>서버가 적용 계획을 발행하지 않았습니다. 사유를 수정하고 다시 검증하세요.</strong>}</div>
      </section>}
      {applyResult && <section className="result" role="status"><h2>{applyResult.running ? '적용 진행 중' : applyResult.failed ? '적용 실패 또는 결과 확인 필요' : '적용 완료·DB 검증'}</h2><p>작업 ID: {activeJobId}</p>{applyResult.progress && <p>{applyResult.progress.stage} · {applyResult.progress.done}/{applyResult.progress.total}건 {applyResult.progress.current}</p>}{applyResult.error && <p className="error">{applyResult.error}</p>}{!applyResult.running && !applyResult.failed && <p>적용 {applyResult.appliedCount ?? 0}건 · 신규 주문 {applyResult.orderCreatedCount ?? 0}건 · 출고 변경 {applyResult.shipmentChangedCount ?? 0}건 · DB 사후검증 {applyResult.verification?.checked ?? 0}건 / 불일치 {applyResult.verification?.mismatchCount ?? 0}건</p>}<div className="logs">{(applyResult.logs || applyResult.progress?.logs || []).map((line, index) => <div key={index}>{typeof line === 'string' ? line : JSON.stringify(line)}</div>)}</div>{(applyResult.appliedRows || []).length > 0 && <details><summary>행별 적용·검증 결과</summary><div className="logs">{applyResult.appliedRows.map((row, index) => <div key={index}>{row.custName || row.customer} · {row.prodName || row.product} · {JSON.stringify(row)}</div>)}</div></details>}</section>}
    </>}
    </main><aside className="board-side" aria-label="보조 기능">
      <details className="side-card side-instructions"><summary>입력 안내</summary><p>주광은 업체별 단가를 입력합니다. 그 외 업체는 같은 품목·칼라의 균일가를 사용합니다. 빈 단가는 ERP 기존값을 보존하고 0원은 명시 변경입니다. Enter를 누르면 다음 단가 칸으로 이동합니다.</p></details>
      <div className="side-history"><DutchWorkHistory name={workName} onName={setWorkName} hasWork={!!entries.length} busy={workBusy || applying || loading || weeksLoading} saving={workBusy} reviewing={previewLoading} notice={workNotice} error={workError} onSave={saveWork} onReview={reviewForUpload} open={historyOpen} onToggle={() => { const next = !historyOpen; setHistoryOpen(next); if (next) void loadWorkHistory(); }} items={workHistory} loading={historyLoading} cursor={historyCursor} onMore={() => loadWorkHistory(true)} onRestore={restoreWork}/></div>
    </aside></div>
  </section><style jsx>{`.bulk-modal-backdrop{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:#0d1b2a80}.bulk-modal{width:min(620px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border:1px solid #9db2cc;border-radius:8px;box-shadow:0 18px 60px #0d1b2a55;color:#172033;padding:16px}.bulk-modal>header{display:flex;align-items:flex-start;gap:12px;background:#f1f6fc;color:#172033;border-radius:5px;padding:12px}.bulk-modal>header h2{margin:0 0 4px}.bulk-modal>header p{margin:0;color:#52647c;font-size:12px}.bulk-modal>header>button{font-size:21px;border:0;background:transparent;color:#52647c}.bulk-enabled{display:flex;align-items:center;gap:8px;margin:12px 2px;font-weight:800}.bulk-modal-count{font-size:12px;font-weight:800;color:#1a4679;padding:8px;background:#edf5ff;border-radius:4px}.bulk-modal-count span{font-weight:400;color:#52647c;margin-left:8px}.bulk-search{height:34px;margin:9px 0;border:1px solid #bccbdd;border-radius:4px;padding:0 9px}.bulk-customer-list{overflow:auto;display:grid;grid-template-columns:1fr 1fr;gap:5px}.bulk-customer-list label{display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 7px;border:1px solid #e1e7ef;border-radius:4px;font-size:12px}.bulk-customer-list label>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.bulk-customer-list small{font-size:10px;color:#64748b}.bulk-modal>footer{display:flex;justify-content:flex-end;gap:7px;padding-top:12px}.bulk-modal>footer button{padding:7px 12px;border:1px solid #b3c0d0;border-radius:4px;background:#fff}.bulk-modal>footer .save-bulk{background:#155bd7;color:#fff;border-color:#155bd7;font-weight:800}.bulk-settings-trigger{white-space:nowrap}.sheet-tabs{display:flex;align-items:center;gap:4px;border-bottom:2px solid #155bd7;margin:8px 0 0}.sheet-tabs button{padding:10px 18px;border:1px solid #c7d6e9;border-bottom:0;border-radius:6px 6px 0 0;background:#f3f6fa;color:#35516f;cursor:pointer;font-weight:800}.sheet-tabs button[aria-selected=true]{background:#155bd7;color:white;border-color:#155bd7}.sheet-tabs span{margin-left:12px;font-size:11px;color:#52647c}.editor-context{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 10px;background:#e8f1ff;border:1px solid #bfcada;font-size:12px}.editor-context button{background:white;color:#155bd7;border:1px solid #8eb2e2;border-radius:4px;padding:5px 9px}.editor-context span{font-size:11px;color:#52647c}.selected-entry{outline:2px solid #155bd7;outline-offset:-2px}@media(max-width:760px){.bulk-customer-list{grid-template-columns:1fr}.sheet-tabs{flex-wrap:wrap}.sheet-tabs span{width:100%;margin:5px}.editor-context b{overflow-wrap:anywhere}}.dutch-board{padding:14px;background:#eef2f7;min-height:calc(100vh - 44px);color:#172033;box-sizing:border-box}header{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#102d72,#1676b8);color:#fff;padding:14px 18px;border-radius:5px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0}header p{margin:0;font-size:12px;opacity:.9}.upload{background:#fff;color:#164c94;padding:8px 14px;border-radius:4px;font-weight:800;cursor:pointer}.upload input{display:none}.live-load{display:flex;align-items:end;gap:8px;padding:10px;margin-top:8px;background:#fff;border:1px solid #c9d4e3}.live-load label{font-size:11px;font-weight:800}.live-load label>input{display:block;width:82px}.live-load label div{display:flex}.live-load input,.live-load select,.live-load button{height:31px;border:1px solid #aebbd0;padding:0 7px}.live-load label div select{width:86px;text-align:center;font-weight:800}.live-load .load{background:#148044;color:#fff;font-weight:800;border-color:#148044}.live-load span{color:#617188;font-size:11px;margin-left:5px}.empty,.notice{margin-top:12px;padding:12px;background:#fff;border:1px solid #c9d4e3;border-radius:5px}.error{color:#a61b14;background:#fff1ef}.warning{color:#7a4a00;background:#fff7df}.toolbar{display:flex;gap:8px;align-items:center;margin-top:10px;padding:9px;background:#fff;border:1px solid #c9d4e3}.toolbar>div{display:flex;flex-direction:column;margin-right:auto}.toolbar span{font-size:11px;color:#617188}.toolbar input{width:240px}.toolbar input,.toolbar button{height:32px;border:1px solid #aebbd0;border-radius:3px;padding:0 9px}.toolbar button{background:#155bd7;color:#fff;font-weight:800}.currency{white-space:nowrap;font-weight:800;color:#136239!important}.guide{margin:7px 0;padding:8px 10px;background:#e8f1ff;border:1px solid #a8c7ef;font-size:12px}.guide b{margin-right:12px}.actions{display:flex;align-items:center;gap:8px;margin:8px 0}.actions button{padding:7px 10px;border:1px solid #8aa8cc;border-radius:4px;background:white;color:#164c94;font-weight:800}.actions span{font-size:12px;color:#52647c}.grid-wrap,.preview-wrap{overflow:auto;background:#fff;border:1px solid #bfcada}.grid-wrap{max-height:calc(100vh - 345px);min-height:160px}.preview-wrap{max-height:430px}table{border-collapse:collapse;min-width:100%;width:max-content;font-size:12px}th{position:sticky;top:0;z-index:2;background:#dce6f4;color:#16335e}th,td{height:38px;padding:5px 8px;border-right:1px solid #d4dce7;border-bottom:1px solid #d4dce7;white-space:nowrap}td small{display:block;color:#64748b}td input,td select{width:115px;height:29px;border:1px solid #aebbd0;padding:3px 6px}.number{text-align:right}.status{max-width:230px;white-space:normal}.status button{margin-left:5px}.unmatched,.blocked{background:#fff1ef}.missing{background:#fff6df}.price{background:#eef7ff}.individual-price{color:#7a45b8}.uniform-price{color:#168447}.export-note{font-size:11px;color:#7b4a18}.review,.result{background:#fff;border:1px solid #bfcada;margin-top:12px;padding:12px}.review-head{display:flex;justify-content:space-between}.review p{font-size:12px}.kpis{display:flex;gap:7px;margin:9px 0;flex-wrap:wrap}.kpis b{background:#e8f1ff;padding:6px 10px;border-radius:4px}.approval{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:10px}.approval label{font-size:12px}.approval .apply{background:#148044;color:white;border:0;border-radius:4px;padding:9px 14px;font-weight:900}.approval .apply:disabled{background:#9ca9b7}.approval strong{color:#a61b14;font-size:12px}.logs{max-height:180px;overflow:auto;background:#f6f8fb;padding:8px;font-size:11px;white-space:pre-wrap}details{margin-top:10px;font-size:12px}@media(max-width:760px){.dutch-board{padding:7px}header{align-items:flex-start;gap:10px}header p{display:none}.live-load,.toolbar,.actions{flex-wrap:wrap}.live-load span,.toolbar>div{width:100%}.toolbar input{flex:1;width:auto}.grid-wrap{max-height:500px}.approval{align-items:flex-start;flex-direction:column}}`}</style></>;
}
