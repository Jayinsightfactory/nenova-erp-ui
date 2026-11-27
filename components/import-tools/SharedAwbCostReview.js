import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import WorkflowGuide from '../WorkflowGuide';
import CostAwbEvidence from './CostAwbEvidence';
import { CO_ORIGINAL_CUSTOMS_DEFAULTS, calculateCoOriginalCustoms } from '../../lib/coOriginalCostInputs.js';
import { CO_DEFAULT_STEMS_PER_BUNCH } from '../../lib/receiptOriginInheritance.js';
import { sendWorkbookToArrivalUploadReview } from '../../lib/arrivalCostUploadBridge.js';
import ledger from '../../styles/ArrivalCostLedger.module.css';

const labels = { ROSE: '장미', CARNATION: '카네이션', ALSTROMERIA: '알스트로', RUSCUS: '루스커스', HYDRANGEA: '수국' };
const VARIETY_BUTTON_ORDER = ['HYDRANGEA', 'ROSE', 'CARNATION', 'ALSTROMERIA', 'RUSCUS'];
const MASTER_LABELS = { CO: '콜카장 누적 원가자료', CO_HYDRANGEA: '수국 누적 원가자료' };
const scopeLabels = {
  MAIN: '콜카장 (장미·카네이션·알스트로·루스커스)',
  HYDRANGEA: '수국',
  ALL: '통합 5품종 (콜카장 + 수국 혼적 AWB)',
};

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const fmtInt = value => (Number.isFinite(value) ? Math.round(value).toLocaleString('ko-KR') : '-');
const fmtDec = (value, digits = 2) => (Number.isFinite(value)
  ? value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  : '-');

const ResultLedgerRow = memo(function ResultLedgerRow({ row }) {
  return (
    <tr className={ledger.resultLedgerRow}>
      <td className={ledger.resultFarmCell}>
        <strong>{row.farmName}</strong>
        {row.invoiceNo && <span className={ledger.resultSubMeta}>{row.invoiceNo}</span>}
      </td>
      <td><span className={ledger.varietyTag}>{row.groupLabel}</span></td>
      <td className={ledger.resultProdCell}>{row.originalName}</td>
      <td className={ledger.numCell}>{fmtDec(row.boxQuantity, Number.isInteger(row.boxQuantity) ? 0 : 2)}</td>
      <td className={ledger.numCell}>{fmtInt(row.stems)}</td>
      <td className={ledger.numCell}>{fmtDec(row.stemsPerBunch, Number.isInteger(row.stemsPerBunch) ? 0 : 2)}</td>
      <td className={ledger.numCell}>{fmtDec(row.fobUnitUSD, 2)}</td>
      <td className={ledger.numCell}>{fmtDec(row.freightUnitUSD, 4)}</td>
      <td className={ledger.numCell}>{fmtInt(row.customsUnitKRW)}</td>
      <td className={ledger.numStrongCell}>{fmtInt(row.arrivalStemKRW)}</td>
      <td className={ledger.numCell}>{fmtInt(row.arrivalBunchKRW)}</td>
      <td className={ledger.numStrongCell}>{fmtInt(row.totalCostKRW)}</td>
    </tr>
  );
});

/**
 * 공동 AWB 원가. 두 가지 입구를 같은 계산 코어로 쓴다.
 * - document: 저장된 인보이스 문서의 AWB (기존)
 * - native: 기존 입고(읽기 전용)에서 같은 차수 콜롬비아 농장 전체를 묶음 (도착원가 작업)
 */
export default function SharedAwbCostReview({ document, native = null, onSendToUploadReview = null }) {
  const orderYear = native ? native.orderYear : document.orderYear;
  const orderWeek = native ? native.orderWeek : document.orderWeek;
  const endpoint = native ? '/api/import/receipts/native-shared-cost' : '/api/import/receipts/shared-awb-cost';
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null);
  const [lineInputs, setLineInputs] = useState([]);
  const [awbText, setAwbText] = useState(native?.awb ?? '');
  const [scope, setScope] = useState(native?.scope || 'MAIN');
  const [scopeNotice, setScopeNotice] = useState('');
  const [fullBox, setFullBox] = useState({});
  const [input, setInput] = useState({
    gw: '',
    cw: '',
    freightAmount: '',
    freightOnlyUSD: '',
    docFeeUSD: '',
    freightCurrency: 'USD',
    exchangeRate: '',
    customsTotalKRW: '',
    customsMode: 'FORMULA',
    exchangeRateType: 'MANUAL',
  });
  const [rateDraft, setRateDraft] = useState(null);
  const [customsParts, setCustomsParts] = useState({
    storagePerKg: String(CO_ORIGINAL_CUSTOMS_DEFAULTS.storagePerKg),
    clearance: String(CO_ORIGINAL_CUSTOMS_DEFAULTS.clearance),
    inspectionPerGroup: String(CO_ORIGINAL_CUSTOMS_DEFAULTS.inspectionPerGroup),
    domestic: String(CO_ORIGINAL_CUSTOMS_DEFAULTS.domestic),
    quarantine: String(CO_ORIGINAL_CUSTOMS_DEFAULTS.quarantine),
    disinfection: '0',
  });
  const [rateStatus, setRateStatus] = useState('');
  const [rateRetry, setRateRetry] = useState(0);

  // 원클릭 버튼형 필터 상태 (품종 · 농장 · 품목 3단 + 검색어 · 복수선택)
  const [selectedVarieties, setSelectedVarieties] = useState([]);
  const [multiVariety, setMultiVariety] = useState(false);
  const [selectedFarms, setSelectedFarms] = useState([]);
  const [multiFarm, setMultiFarm] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [multiProduct, setMultiProduct] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [resultSearch, setResultSearch] = useState('');
  const [resultLimit, setResultLimit] = useState(100);

  // 서버 보관 누적 원가자료는 사용자가 명시적으로 체크한 경우에만 차수 시트를 추가한다 (실수 덮어쓰기 방지).
  const [masters, setMasters] = useState({});
  const [appendToMaster, setAppendToMaster] = useState(false);
  const [masterNote, setMasterNote] = useState('');
  const isTestOnly = input.exchangeRateType === 'TEST_ONLY';

  const update = (field, value) => {
    setInput(current => {
      const next = { ...current, [field]: value };
      if (field === 'freightOnlyUSD') {
        if (value === '') {
          if (current.docFeeUSD !== '' && Number.isFinite(Number(current.docFeeUSD))) {
            next.freightAmount = String(round2(Number(current.docFeeUSD)));
          }
        } else if (Number.isFinite(Number(value))) {
          const doc = current.docFeeUSD !== '' && Number.isFinite(Number(current.docFeeUSD)) ? Number(current.docFeeUSD) : 0;
          next.freightAmount = String(round2(Number(value) + doc));
        }
      } else if (field === 'docFeeUSD') {
        const doc = value === '' ? 0 : Number(value);
        if (Number.isFinite(doc) && doc >= 0) {
          if (current.freightOnlyUSD !== '' && Number.isFinite(Number(current.freightOnlyUSD))) {
            next.freightAmount = String(round2(Number(current.freightOnlyUSD) + doc));
          } else if (current.freightAmount !== '' && Number.isFinite(Number(current.freightAmount)) && Number(current.freightAmount) >= doc) {
            next.freightOnlyUSD = String(round2(Number(current.freightAmount) - doc));
          }
        }
      } else if (field === 'freightAmount') {
        const total = Number(value);
        if (value === '') {
          next.freightOnlyUSD = '';
          next.docFeeUSD = '';
        } else if (Number.isFinite(total) && total >= 0) {
          const doc = current.docFeeUSD !== '' && Number.isFinite(Number(current.docFeeUSD)) ? Number(current.docFeeUSD) : null;
          if (doc !== null && total >= doc) {
            next.freightOnlyUSD = String(round2(total - doc));
          } else {
            next.freightOnlyUSD = '';
            next.docFeeUSD = '';
          }
        }
      }
      return next;
    });
    if (field === 'exchangeRateType' && value === 'TEST_ONLY') setAppendToMaster(false);
    setResult(null);
  };
  const awb = native ? awbText : document.reviewedMetadata.awb;

  const effectiveFreightSplit = useMemo(() => {
    const total = Number(input.freightAmount);
    const cwNum = Number(input.cw);
    const hasDoc = String(input.docFeeUSD).trim() !== '' && Number.isFinite(Number(input.docFeeUSD));
    const hasAir = String(input.freightOnlyUSD).trim() !== '' && Number.isFinite(Number(input.freightOnlyUSD));
    let docFee = hasDoc ? Number(input.docFeeUSD) : 0;
    let freightOnly = hasAir ? Number(input.freightOnlyUSD) : (Number.isFinite(total) ? Math.max(0, round2(total - docFee)) : 0);
    if (!hasAir && !hasDoc && Number.isFinite(total) && total >= 0) {
      docFee = 0;
      freightOnly = total;
    }
    const rate = cwNum > 0 && freightOnly >= 0 ? freightOnly / cwNum : null;
    return { docFee, freightOnly, rate };
  }, [input.freightAmount, input.freightOnlyUSD, input.docFeeUSD, input.cw]);

  const loadMasters = async () => {
    const next = {};
    for (const key of Object.keys(MASTER_LABELS)) {
      try {
        const r = await fetch(`/api/import/receipts/cost-master?country=${key}`, { cache: 'no-store' });
        const d = await r.json();
        next[key] = d.success ? d : { exists: false, sheetNames: [] };
      } catch {
        next[key] = { exists: false, sheetNames: [] };
      }
    }
    setMasters(next);
  };
  useEffect(() => { loadMasters(); }, []);

  async function seedMaster(key, event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('seed'); setError(''); setMasterNote('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const exists = masters[key]?.exists;
      const replace = exists ? window.confirm(`서버에 이미 ${MASTER_LABELS[key]}가 있습니다. 이 파일로 교체할까요? (이전 파일은 서버에 백업됩니다)`) : false;
      if (exists && !replace) return;
      const r = await fetch('/api/import/receipts/cost-master', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'seed', country: key, fileBase64: btoa(binary), replace }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || '누적 파일을 올리지 못했습니다.');
      setMasterNote(`${MASTER_LABELS[key]} ${d.sheetNames.length}개 시트를 서버에 보관했습니다.`);
      loadMasters();
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  }

  const groupIds = [...new Set(lineInputs.map(line => line.groupId).filter(Boolean))];
  const masterKey = groupIds.length && groupIds.every(id => id === 'HYDRANGEA') ? 'CO_HYDRANGEA' : 'CO';
  const master = masters[masterKey];
  const rowBoxes = Object.fromEntries(groupIds.map(id => [
    id,
    (prepared?.members || []).flatMap(m => m.rows)
      .filter(row => lineInputs.find(line => line.lineId === row.lineId)?.groupId === id)
      .reduce((sum, row) => sum + (Number(row.boxQuantity) || 0), 0),
  ]));
  const needsFullBox = groupIds.length > 1;
  const parsedCustomsOverrides = {
    storagePerKg: customsParts.storagePerKg === '' ? null : Number(customsParts.storagePerKg),
    clearance: customsParts.clearance === '' ? null : Number(customsParts.clearance),
    inspectionPerGroup: customsParts.inspectionPerGroup === '' ? null : Number(customsParts.inspectionPerGroup),
    domestic: customsParts.domestic === '' ? null : Number(customsParts.domestic),
    quarantine: customsParts.quarantine === '' ? null : Number(customsParts.quarantine),
    disinfection: customsParts.disinfection === '' ? null : Number(customsParts.disinfection),
  };
  const customs = calculateCoOriginalCustoms(input.gw, groupIds, parsedCustomsOverrides);

  // 환율을 비워 두면 USD 현재 시세 +15원을 자동 조회한다(사용자가 입력하면 조회하지 않음).
  useEffect(() => {
    if (String(input.exchangeRate).trim()) return;
    const controller = new AbortController();
    setRateStatus('USD 현재 시세 +15원 조회 중…');
    fetch('/api/import/receipts/live-exchange-rate?currency=USD', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.success) throw Error(data.error || '환율 조회 실패'); return data; })
      .then(quote => {
        if (controller.signal.aborted) return;
        setInput(current => String(current.exchangeRate).trim() ? current : {
          ...current,
          exchangeRate: quote.rate,
          exchangeRateType: 'LIVE_MARKET_PLUS_15',
          exchangeRateQuoteAt: quote.quoteAt,
          exchangeRateSource: quote.source,
          exchangeRateSourceUrl: quote.sourceUrl,
          exchangeRateMarketRate: quote.marketRate,
          exchangeRateAdjustmentKRW: 15,
        });
        setRateStatus(`${quote.source} · ${quote.quoteAt} · 시세 ${quote.marketRate} +15원 = ${quote.rate}원`);
        setResult(null);
      })
      .catch(e => { if (e.name !== 'AbortError') setRateStatus(`환율 자동 조회 실패: ${e.message} · 다시 조회하거나 직접 입력하세요.`); });
    return () => controller.abort();
  }, [prepared, input.exchangeRate, rateRetry]);

  const serializeLineInputs = () => lineInputs.map(line => ({
    ...line,
    stemsPerBunch: line.stemsPerBunch === '' || line.stemsPerBunch == null ? null : Number(line.stemsPerBunch),
    tariffRate: line.tariffPercent === '' || line.tariffPercent == null ? 0 : Number(line.tariffPercent) / 100,
  }));

  const body = (action, extra = {}) => JSON.stringify({
    action, orderYear, orderWeek, awb, ...(native ? { scope } : {}),
    baselineDigest: prepared?.baselineDigest, completeManifestConfirmed: confirmed,
    lineInputs: serializeLineInputs(),
    input: {
      ...input,
      ...(String(input.docFeeUSD).trim() !== '' ? { docFeeUSD: Number(input.docFeeUSD) } : {}),
      ...(String(input.freightOnlyUSD).trim() !== '' ? { freightOnlyUSD: Number(input.freightOnlyUSD) } : {}),
      ...(input.customsMode === 'FORMULA' ? { coCustomsOverrides: parsedCustomsOverrides } : {}),
      ...(needsFullBox ? { fullBoxCounts: Object.fromEntries(groupIds.map(id => [id, fullBox[id] === '' || fullBox[id] == null ? null : Number(fullBox[id])])) } : {}),
    },
    ...extra,
  });

  async function run(action, overrideScope = scope, options = {}) {
    setBusy(action); setError('');
    if (action === 'prepare' && !options.preserveScopeNotice) setScopeNotice('');
    try {
      const wireAction = action === 'bridge' ? 'download' : action;
      const append = action === 'download' && !isTestOnly && appendToMaster && master?.exists;
      const targetAwb = options.awbOverride ?? awb;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: wireAction === 'prepare'
          ? JSON.stringify({ action: wireAction, orderYear, orderWeek, awb: targetAwb, ...(native ? { scope: overrideScope } : {}), lineInputs: serializeLineInputs() })
          : body(wireAction, append ? { appendToMaster: true } : {}),
      });
      if ((action === 'download' || action === 'bridge') && response.ok) {
        const blob = await response.blob();
        if (action === 'bridge') {
          const bridgeName = `콜롬비아_공동원가_${orderYear}_${orderWeek}_${prepared?.manifest?.awb || awb || 'awb'}.xlsx`;
          await sendWorkbookToArrivalUploadReview({
            blob,
            fileName: bridgeName,
            orderYear,
            orderWeek,
            country: '콜롬비아',
            onSendToUploadReview,
          });
          setMasterNote(`계산한 원가 엑셀(${bridgeName})을 도착원가 업로드 검토 패널로 전달했습니다.`);
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = window.document.createElement('a');
        a.href = url;
        const sheet = decodeURIComponent(response.headers.get('X-Cost-Master-Sheet') || '');
        a.download = append && sheet
          ? `${masterKey === 'CO_HYDRANGEA' ? '콜롬비아_수국' : '콜롬비아_콜카장'}_원가자료_누적_${sheet}.xlsx`
          : `shared-awb-${orderYear}-${orderWeek}-${prepared.manifest.awb}.xlsx`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        if (append) {
          setMasterNote(`${MASTER_LABELS[masterKey]}에 ${sheet} 시트를 ${response.headers.get('X-Cost-Master-Replaced') === 'true' ? '교체' : '추가'}했습니다.`);
          loadMasters();
        }
        return;
      }
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        if (action === 'prepare' && native && options.autoFallbackScope && response.status === 404 && overrideScope !== 'ALL') {
          const altScope = overrideScope === 'MAIN' ? 'HYDRANGEA' : 'MAIN';
          setScope(altScope);
          setScopeNotice(`선택한 AWB에 ${scopeLabels[overrideScope]} 입고가 없어 ${scopeLabels[altScope]} 범위로 자동 전환했습니다.`);
          return await run('prepare', altScope, { ...options, autoFallbackScope: false, preserveScopeNotice: true });
        }
        throw new Error(data.error || '공동 AWB 작업에 실패했습니다.');
      }
      if (action === 'prepare') {
        if (native && options.autoDetectMixedScope && data.awbScopeSummary?.mixedAwb && overrideScope !== 'ALL') {
          setScope('ALL');
          setScopeNotice('이 AWB에는 콜카장과 수국이 함께 입고되어 통합 5품종(ALL) 범위를 기본 적용했습니다. 전체 중량·운임을 1회만 배분합니다.');
          return await run('prepare', 'ALL', { ...options, autoDetectMixedScope: false, autoFallbackScope: false, preserveScopeNotice: true });
        }
        setPrepared(data);
        setLineInputs(data.members.flatMap(member => member.lineInputs.map(line => {
          const groupId = line.groupId || line.suggestedGroupId || '';
          const spb = line.stemsPerBunch > 0 ? line.stemsPerBunch : (CO_DEFAULT_STEMS_PER_BUNCH[groupId] ?? '');
          const tariffPercent = Number.isFinite(Number(line.tariffRate)) ? String(Math.round(Number(line.tariffRate) * 10000) / 100) : '0';
          return { ...line, groupId, stemsPerBunch: spb, tariffPercent };
        })));
        if (data.awbReference) {
          const ref = data.awbReference;
          setInput(current => {
            const currentTotal = String(current.freightAmount).trim() !== '' ? Number(current.freightAmount) : null;
            const matchesRefTotal = currentTotal === null || (ref.freightAmount != null && Math.abs(currentTotal - Number(ref.freightAmount)) <= 0.02);
            return {
              ...current,
              gw: String(current.gw).trim() !== '' ? current.gw : (ref.gw ?? ''),
              cw: String(current.cw).trim() !== '' ? current.cw : (ref.cw ?? ''),
              freightAmount: String(current.freightAmount).trim() !== '' ? current.freightAmount : (ref.freightAmount ?? ''),
              freightOnlyUSD: String(current.freightOnlyUSD).trim() !== ''
                ? current.freightOnlyUSD
                : (matchesRefTotal && ref.freightOnlyUSD != null ? ref.freightOnlyUSD : ''),
              docFeeUSD: String(current.docFeeUSD).trim() !== ''
                ? current.docFeeUSD
                : (matchesRefTotal && ref.docFeeUSD != null ? ref.docFeeUSD : ''),
            };
          });
        }
        setConfirmed(false);
        setResult(null);
        setFullBox({});
        setSelectedVarieties([]);
        setSelectedFarms([]);
        setSelectedProducts([]);
        setShowAllProducts(false);
        setResultSearch('');
      } else {
        setResult(data.result);
      }
    } catch (e) { setError(e.message); setResult(null); }
    finally { setBusy(''); }
  }

  useEffect(() => {
    const initialAwb = String(native?.awb ?? '').replace(/[\s-]/g, '');
    if (native && /^\d{11}$/.test(initialAwb)) {
      run('prepare', native.scope || 'MAIN', { awbOverride: initialAwb, autoFallbackScope: true, autoDetectMixedScope: true });
    }
  }, []);

  // O(1) 맵 인덱싱 및 결과 원장 데이터 메모이제이션
  const sourceRowById = useMemo(() => {
    const map = new Map();
    for (const member of prepared?.members || []) {
      for (const row of member.rows || []) {
        map.set(row.lineId, {
          farmName: member.farmName,
          invoiceNo: member.invoiceNo,
          originalName: row.originalName,
          boxQuantity: Number(row.boxQuantity) || 0,
          stemQuantity: Number(row.stemQuantity) || 0,
        });
      }
    }
    return map;
  }, [prepared]);

  const lineSettingById = useMemo(() => {
    const map = new Map();
    for (const entry of result?.lineInputs || lineInputs) {
      map.set(entry.lineId, entry);
    }
    return map;
  }, [result?.lineInputs, lineInputs]);

  const enrichedResultRows = useMemo(() => {
    if (result?.status !== 'CALCULATED' || !Array.isArray(result.lines)) return [];
    return result.lines.map(cost => {
      const src = sourceRowById.get(cost.lineId);
      const setting = lineSettingById.get(cost.lineId);
      const groupId = cost.groupId || setting?.groupId || '';
      const groupLabel = labels[groupId] || groupId || '-';
      const farmName = cost.farmName || src?.farmName || '-';
      const invoiceNo = cost.invoiceNo || src?.invoiceNo || '';
      const originalName = src?.originalName || '';
      const boxQuantity = src?.boxQuantity ?? 0;
      const stems = Number(cost.priceBasisQuantity ?? cost.quantity ?? src?.stemQuantity ?? 0);
      const rawSpb = Number(setting?.stemsPerBunch);
      const stemsPerBunch = Number.isFinite(rawSpb) && rawSpb > 0 ? rawSpb : (CO_DEFAULT_STEMS_PER_BUNCH[groupId] ?? 1);
      const c = cost.componentAmounts || {};
      const fobTotalUSD = Number(c.goodsNative) || 0;
      const fobUnitUSD = stems > 0 ? fobTotalUSD / stems : 0;
      const freightTotalUSD = Number(c.freightNative) || 0;
      const freightUnitUSD = stems > 0 ? freightTotalUSD / stems : 0;
      const freightKRW = Number(c.freightKRW) || 0;
      const tariffKRW = Number(c.tariffKRW) || 0;
      const customsKRW = Number(c.customsKRW) || 0;
      const customsUnitKRW = stems > 0 ? customsKRW / stems : 0;
      const arrivalStemKRW = stems > 0 ? Number(cost.totalCostKRW) / stems : 0;
      const arrivalBunchKRW = arrivalStemKRW * stemsPerBunch;
      const totalCostKRW = Number(cost.totalCostKRW) || 0;
      const searchKey = `${farmName} ${invoiceNo} ${groupLabel} ${groupId} ${originalName}`.toLowerCase();
      return {
        lineId: cost.lineId,
        farmName,
        invoiceNo,
        groupId,
        groupLabel,
        originalName,
        boxQuantity,
        stems,
        stemsPerBunch,
        fobUnitUSD,
        fobTotalUSD,
        freightUnitUSD,
        freightTotalUSD,
        freightKRW,
        tariffKRW,
        customsUnitKRW,
        customsKRW,
        arrivalStemKRW,
        arrivalBunchKRW,
        totalCostKRW,
        searchKey,
      };
    });
  }, [result, sourceRowById, lineSettingById]);

  const varietyButtons = useMemo(() => {
    const counts = new Map();
    for (const row of enrichedResultRows) {
      counts.set(row.groupId, (counts.get(row.groupId) || 0) + 1);
    }
    return VARIETY_BUTTON_ORDER
      .filter(id => (counts.get(id) || 0) > 0)
      .map(id => ({ id, label: labels[id] || id, count: counts.get(id) }));
  }, [enrichedResultRows]);

  const farmButtons = useMemo(() => {
    const counts = new Map();
    for (const row of enrichedResultRows) {
      counts.set(row.farmName, (counts.get(row.farmName) || 0) + 1);
    }
    return [...counts.entries()].map(([farmName, count]) => ({ farmName, count }));
  }, [enrichedResultRows]);

  const varietySet = useMemo(() => new Set(selectedVarieties), [selectedVarieties]);
  const farmSet = useMemo(() => new Set(selectedFarms), [selectedFarms]);
  const productSet = useMemo(() => new Set(selectedProducts), [selectedProducts]);
  const normalizedQuery = useMemo(() => resultSearch.trim().toLowerCase(), [resultSearch]);
  useEffect(() => { setResultLimit(100); }, [selectedVarieties, selectedFarms, selectedProducts, normalizedQuery]);

  const rowsAfterVarietyAndFarm = useMemo(() => {
    if (!enrichedResultRows.length) return [];
    return enrichedResultRows.filter(row => {
      if (varietySet.size > 0 && !varietySet.has(row.groupId)) return false;
      if (farmSet.size > 0 && !farmSet.has(row.farmName)) return false;
      return true;
    });
  }, [enrichedResultRows, varietySet, farmSet]);

  const productButtons = useMemo(() => {
    const counts = new Map();
    for (const row of rowsAfterVarietyAndFarm) {
      counts.set(row.originalName, (counts.get(row.originalName) || 0) + 1);
    }
    return [...counts.entries()].map(([productName, count]) => ({ productName, count }));
  }, [rowsAfterVarietyAndFarm]);

  const filteredResultRows = useMemo(() => {
    if (!rowsAfterVarietyAndFarm.length) return [];
    return rowsAfterVarietyAndFarm.filter(row => {
      if (productSet.size > 0 && !productSet.has(row.originalName)) return false;
      if (normalizedQuery && !row.searchKey.includes(normalizedQuery)) return false;
      return true;
    });
  }, [rowsAfterVarietyAndFarm, productSet, normalizedQuery]);

  const filteredSummary = useMemo(() => {
    let boxes = 0, stems = 0, fobUSD = 0, freightUSD = 0, freightKRW = 0, customsKRW = 0, tariffKRW = 0, totalCostKRW = 0;
    const presentGroups = new Set();
    for (const row of filteredResultRows) {
      boxes += row.boxQuantity;
      stems += row.stems;
      fobUSD += row.fobTotalUSD;
      freightUSD += row.freightTotalUSD;
      freightKRW += row.freightKRW;
      customsKRW += row.customsKRW;
      tariffKRW += row.tariffKRW;
      totalCostKRW += row.totalCostKRW;
      if (row.groupId) presentGroups.add(row.groupId);
    }
    let fbSum = 0, hasFb = false;
    if (farmSet.size === 0 && productSet.size === 0 && !normalizedQuery && Array.isArray(result?.costGroups)) {
      for (const g of result.costGroups) {
        if ((varietySet.size === 0 || varietySet.has(g.groupId)) && presentGroups.has(g.groupId) && Number(g.fullBoxEquivalent) > 0) {
          fbSum += Number(g.fullBoxEquivalent);
          hasFb = true;
        }
      }
    }
    return {
      itemCount: filteredResultRows.length,
      totalItemCount: enrichedResultRows.length,
      boxes,
      fbSum: hasFb ? fbSum : null,
      stems,
      fobUSD,
      freightUSD,
      freightKRW,
      customsKRW,
      tariffKRW,
      freightAndCustomsKRW: freightKRW + customsKRW + tariffKRW,
      totalCostKRW,
    };
  }, [filteredResultRows, enrichedResultRows.length, farmSet, productSet, normalizedQuery, result?.costGroups, varietySet]);

  const handleVarietyClick = useCallback((id, event) => {
    setSelectedProducts([]);
    if (id === 'ALL') {
      setSelectedVarieties([]);
      return;
    }
    const additive = multiVariety || event?.metaKey || event?.ctrlKey || event?.shiftKey;
    setSelectedVarieties(prev => {
      if (!additive) return prev.length === 1 && prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id];
    });
  }, [multiVariety]);

  const handleFarmClick = useCallback((farmName, event) => {
    setSelectedProducts([]);
    if (farmName === 'ALL') {
      setSelectedFarms([]);
      return;
    }
    const additive = multiFarm || event?.metaKey || event?.ctrlKey || event?.shiftKey;
    setSelectedFarms(prev => {
      if (!additive) return prev.length === 1 && prev[0] === farmName ? [] : [farmName];
      return prev.includes(farmName) ? prev.filter(item => item !== farmName) : [...prev, farmName];
    });
  }, [multiFarm]);

  const handleProductClick = useCallback((productName, event) => {
    if (productName === 'ALL') {
      setSelectedProducts([]);
      return;
    }
    const additive = multiProduct || event?.metaKey || event?.ctrlKey || event?.shiftKey;
    setSelectedProducts(prev => {
      if (!additive) return prev.length === 1 && prev[0] === productName ? [] : [productName];
      return prev.includes(productName) ? prev.filter(item => item !== productName) : [...prev, productName];
    });
  }, [multiProduct]);

  const awbReady = !native || /^\d{11}$/.test(awbText.replace(/[\s-]/g, ''));
  const effectiveAppend = !isTestOnly && appendToMaster;
  const downloadReady = !(effectiveAppend && masters[masterKey] === undefined);
  const hasActiveFilter = selectedVarieties.length > 0 || selectedFarms.length > 0 || selectedProducts.length > 0 || normalizedQuery.length > 0;
  const visibleProductButtons = showAllProducts || productButtons.length <= 24 ? productButtons : productButtons.slice(0, 24);

  return (
    <section className={ledger.sharedPanel} aria-label={native ? '기존 입고 콜롬비아 전체 농장 원가' : '공동 AWB 원가'}>
      <div className={ledger.sharedHeader}>
        <div>
          <h3>{native ? '콜롬비아 전체 농장 · 한 번에 도착원가' : '공동 AWB · 전체 농장 도착원가'}</h3>
          <p className={ledger.sharedSubtext}>
            {orderYear}/{orderWeek}{native ? ' · 기존 입고에서 같은 차수 콜롬비아 농장을 모두 묶어' : ` · ${awb} ·`} 전체 중량·운임을 한 번만 배분합니다. 농장별 CW 입력은 필요하지 않습니다.
          </p>
        </div>
        <span className={ledger.countBadge}>{orderYear} · {orderWeek}</span>
      </div>

      <WorkflowGuide workflowId="shared-awb-cost" initialRole="수입부" />

      {native && (
        <div className={ledger.scopeGrid}>
          <label className={ledger.field}>
            <span>계산 범위</span>
            <select
              aria-label="계산 범위"
              value={scope}
              onChange={event => { setScope(event.target.value); setPrepared(null); setResult(null); }}
            >
              {Object.entries(scopeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className={ledger.field}>
            <span>AWB 번호 (11자리)</span>
            <input
              aria-label="AWB 번호"
              value={awbText}
              placeholder="160-17338005"
              onChange={event => { setAwbText(event.target.value); setPrepared(null); setResult(null); }}
            />
          </label>
        </div>
      )}

      {native && (
        <CostAwbEvidence
          label="공동 AWB 원문"
          onApply={proof => {
            const ref = prepared?.awbReference ?? prepared?.mixedAwbReference ?? null;
            const sameAwb = ref && ref.awb === proof.awb;
            const matchesRefTotal = sameAwb && proof.freightAmount !== '' && ref.freightAmount != null
              && Math.abs(Number(proof.freightAmount) - Number(ref.freightAmount)) <= 0.02;
            setAwbText(proof.awb);
            setPrepared(null);
            setResult(null);
            setConfirmed(false);
            setInput(current => ({
              ...current,
              ...Object.fromEntries(['gw', 'cw', 'freightAmount'].filter(k => proof[k] !== '').map(k => [k, proof[k]])),
              freightOnlyUSD: proof.freightOnlyUSD !== '' && proof.freightOnlyUSD != null
                ? proof.freightOnlyUSD
                : (matchesRefTotal && ref.freightOnlyUSD != null ? ref.freightOnlyUSD : ''),
              docFeeUSD: proof.docFeeUSD !== '' && proof.docFeeUSD != null
                ? proof.docFeeUSD
                : (matchesRefTotal && ref.docFeeUSD != null ? ref.docFeeUSD : ''),
            }));
          }}
        />
      )}

      <div className={ledger.sectionBox}>
        <p className={ledger.sectionBoxTitle}>공동 운임 · 서류비 · 환율 · 통관비 입력</p>
        <p className={ledger.sectionBoxDesc}>
          DB 운임 참고입고(예: Apollo)에 운송비·서류비가 분리되어 있으면 자동 반영되며, 화면에서 수정하면 미리보기와 엑셀(.xlsx) Rate(E9)·서류(E11)·운송비(G11)에 동일하게 적용됩니다.
        </p>
        <div className={ledger.formGrid}>
          {[
            ['gw', '공동 GW (kg)'],
            ['cw', '공동 CW (kg)'],
            ['freightOnlyUSD', '운송비 (USD · G11)'],
            ['docFeeUSD', '서류비 (USD · E11)'],
            ['freightAmount', '공동 운임·서류비 합계 (USD)'],
            ['exchangeRate', '환율 (원/USD)'],
          ].map(([field, label]) => (
            <label key={field} className={ledger.field}>
              <span>{label}</span>
              <input
                aria-label={label}
                type="number"
                min="0"
                step="any"
                value={input[field]}
                placeholder={field === 'docFeeUSD' ? '없으면 0' : field === 'freightOnlyUSD' ? '미입력 시 합계 전체' : undefined}
                onChange={event => {
                  update(field, event.target.value);
                  if (field === 'exchangeRate') update('exchangeRateType', 'MANUAL');
                }}
              />
            </label>
          ))}
          <label className={ledger.field}>
            <span>적용 Rate (USD/kg · E9)</span>
            <input
              aria-label="적용 Rate (USD/kg)"
              type="number"
              min="0"
              step="any"
              value={rateDraft !== null ? rateDraft : (effectiveFreightSplit.rate != null ? round2(effectiveFreightSplit.rate) : '')}
              placeholder="운송비 ÷ CW 자동 산출"
              onFocus={() => setRateDraft(effectiveFreightSplit.rate != null ? String(round2(effectiveFreightSplit.rate)) : '')}
              onBlur={() => setRateDraft(null)}
              onChange={event => {
                const raw = event.target.value;
                setRateDraft(raw);
                const rVal = Number(raw);
                const cwVal = Number(input.cw);
                if (raw !== '' && Number.isFinite(rVal) && rVal >= 0 && cwVal > 0) {
                  update('freightOnlyUSD', String(round2(rVal * cwVal)));
                }
              }}
            />
          </label>
          <label className={ledger.field}>
            <span>통관비 기준</span>
            <select aria-label="통관비 기준" value={input.customsMode} onChange={event => update('customsMode', event.target.value)}>
              <option value="FORMULA">기존 42-1 원가표 수식 자동 계산</option>
              <option value="TOTAL">확인한 합계 직접 입력</option>
            </select>
          </label>
          <label className={ledger.field}>
            <span>공동 통관비 합계 (원)</span>
            <input
              aria-label="공동 통관비 합계 (원)"
              type="number"
              min="0"
              step="any"
              readOnly={input.customsMode === 'FORMULA'}
              value={input.customsMode === 'FORMULA' ? customs.total ?? '' : input.customsTotalKRW}
              placeholder="GW·품종 입력 시 자동 계산"
              onChange={event => update('customsTotalKRW', event.target.value)}
            />
          </label>
          <label className={ledger.field}>
            <span>비용 근거</span>
            <select aria-label="공동 AWB 비용 근거" value={input.exchangeRateType} onChange={event => update('exchangeRateType', event.target.value)}>
              <option value="MANUAL">확인한 비용</option>
              <option value="LIVE_MARKET_PLUS_15">현재 시세 +15원 자동 환율</option>
              <option value="TEST_ONLY">시험값 · 실제 원가 아님</option>
            </select>
          </label>
        </div>
      </div>

      <div className={ledger.rateStrip} role="status">
        <span>{rateStatus || '환율 정보를 확인하세요.'}</span>
        <button
          type="button"
          className={ledger.btnSecondarySm}
          onClick={() => { update('exchangeRate', ''); setRateRetry(n => n + 1); }}
        >
          현재 환율 다시 조회
        </button>
      </div>

      {input.customsMode === 'FORMULA' && (
        <div className={ledger.sectionBox} style={{ marginTop: 8 }}>
          <p className={ledger.sectionBoxTitle}>42-1 통관비 수식 항목 (표준 기본값 미리 채움 · 수정 시 미리보기와 엑셀 동일 반영)</p>
          <div className={ledger.formGrid}>
            {[
              ['storagePerKg', '창고료 단가 (원/kg · P6)'],
              ['clearance', '통관수수료 (원 · P7)'],
              ['inspectionPerGroup', '검역수수료 단가 (원/품종 · P8)'],
              ['domestic', '국내운송비 (원 · P9)'],
              ['quarantine', '검역차감 (원 · R6)'],
              ['disinfection', '소독비 (원 · R7)'],
            ].map(([field, label]) => (
              <label key={field} className={ledger.field}>
                <span>{label}</span>
                <input
                  aria-label={label}
                  type="number"
                  min="0"
                  step="any"
                  value={customsParts[field]}
                  onChange={event => {
                    setCustomsParts(current => ({ ...current, [field]: event.target.value }));
                    setResult(null);
                  }}
                />
              </label>
            ))}
          </div>
          <p className={ledger.formulaNote} style={{ marginTop: 8 }}>
            {customs.source} · {customs.groupCount}종류. 화면에서 항목을 수정하면 미리보기와 다운로드 엑셀 모두 동일하게 반영됩니다.
          </p>
        </div>
      )}

      <div className={ledger.actionRow}>
        <button
          className={ledger.btnPrimary}
          type="button"
          disabled={!!busy || !awbReady}
          onClick={() => run('prepare', scope, { autoFallbackScope: !prepared, autoDetectMixedScope: !prepared })}
        >
          {native ? '콜롬비아 전체 입고 조회' : '공동 AWB 전체 입고 조회'}
        </button>
      </div>

      {scopeNotice && <p className={ledger.statusNotice} role="status">{scopeNotice}</p>}
      {error && <p className={ledger.alertError} role="alert">{error}</p>}

      {prepared && (
        <>
          <p className={ledger.statusNotice}>
            현재 입고 <strong>{prepared.members.length}건</strong> ({prepared.receiptLines?.length ?? 0}품목) · 운영 원장은 읽기 전용으로 유지됩니다.
          </p>
          {prepared.awbScopeSummary?.partialScopeOfMixedAwb && (
            <div className={ledger.alertError} role="alert">
              <p style={{ margin: 0 }}>
                이 AWB에는 콜카장과 수국이 함께 입고되어 있습니다. 전체 중량·운임 200% 이중 계상을 막기 위해 부분 범위에는 전체 AWB 참고 중량·운임을 자동 채우지 않았습니다.
                {prepared.mixedAwbReference ? ` (전체 참고: GW ${prepared.mixedAwbReference.gw ?? '미기재'}kg / CW ${prepared.mixedAwbReference.cw ?? '미기재'}kg / 운임 ${prepared.mixedAwbReference.freightAmount ?? '미기재'} USD)` : ''}
              </p>
              <button
                type="button"
                className={ledger.btnSecondarySm}
                style={{ marginTop: 8 }}
                disabled={!!busy}
                onClick={() => {
                  setScope('ALL');
                  setInput(current => ({ ...current, gw: '', cw: '', freightAmount: '', freightOnlyUSD: '', docFeeUSD: '' }));
                  run('prepare', 'ALL', { autoDetectMixedScope: false, autoFallbackScope: false });
                }}
              >
                통합 5품종(ALL) 범위로 전환하여 한 번에 계산
              </button>
            </div>
          )}
          {prepared.awbReference && (
            <p className={ledger.statusNotice} role="status">
              동일 차수·AWB 운임 참고자료 자동 반영: <strong>{prepared.awbReference.sourceId}</strong>
              {' '}(GW {prepared.awbReference.gw ?? '미기재'}kg · CW {prepared.awbReference.cw ?? '미기재'}kg
              {prepared.awbReference.freightOnlyUSD != null ? ` · 운송비 ${prepared.awbReference.freightOnlyUSD.toLocaleString('ko-KR')} USD` : ''}
              {prepared.awbReference.docFeeUSD != null ? ` · 서류비 ${prepared.awbReference.docFeeUSD.toLocaleString('ko-KR')} USD` : ''}
              {prepared.awbReference.freightRateUSD != null ? ` · Rate ${fmtDec(prepared.awbReference.freightRateUSD, 2)}` : ''}
              {' '}· 합계 {prepared.awbReference.freightAmount != null ? `${prepared.awbReference.freightAmount.toLocaleString('ko-KR')} USD` : '미기재'})
            </p>
          )}
          {prepared.unmappedPaidRows?.length > 0 && (
            <div className={ledger.alertError} role="alert">
              <strong>전산 품목 미매핑 유상 행 {prepared.unmappedPaidRows.length}건 확인 필요 (현재 계산 금액에서 제외됨)</strong>
              <p style={{ margin: '4px 0 0' }}>
                아래 행은 품목코드(ProdKey)가 비어 있어 자동 포함되지 않았습니다. 원장 매칭 누락인지 별도 행으로 수기 재등록된 중복인지 확인하세요.
              </p>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {prepared.unmappedPaidRows.map(row => (
                  <li key={`unmapped-${row.warehouseKey}-${row.wdetailKey}`}>
                    입고 #{row.warehouseKey} {row.farmName} · 송장 {row.invoiceNo} · 상세 #{row.wdetailKey} · {row.stems ?? 0}송이 · {row.amount ?? 0} USD
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prepared.excluded?.filter(row => !row.unmappedPaid).length > 0 && (
            <div className={ledger.sectionBox} role="status">
              <p className={ledger.sectionBoxTitle}>계산에서 제외한 비상품 행 {prepared.excluded.filter(row => !row.unmappedPaid).length}개 (금액에 포함되지 않음)</p>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: '13px', color: '#475569' }}>
                {prepared.excluded.filter(row => !row.unmappedPaid).map(row => (
                  <li key={`${row.warehouseKey}-${row.wdetailKey}`}>
                    {row.farmName} · {row.invoiceNo} · {row.name} · {row.stems}송이 · {row.amount} · {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className={ledger.memberChipList}>
            {prepared.members.map(member => (
              <li key={member.documentId}>{member.farmName} · {member.invoiceNo} · {member.rows.length}품목</li>
            ))}
          </ul>

          <div className={ledger.varietyToolbar}>
            <label className={ledger.checkLabel}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={event => { setConfirmed(event.target.checked); setResult(null); }}
              />
              <span>{native ? '이 차수·범위의 전체 농장 입고가 모두 포함되었습니다' : '공동 AWB의 전체 농장 송장이 모두 포함되었습니다'}</span>
            </label>
            <div style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap' }}>
              <label className={ledger.field} style={{ minWidth: 180 }}>
                <span>전체 품종 일괄 선택</span>
                <select
                  aria-label="공동 AWB 전체 품종"
                  defaultValue=""
                  onChange={event => {
                    if (event.target.value) {
                      setLineInputs(rows => rows.map(row => ({ ...row, groupId: event.target.value })));
                      setResult(null);
                    }
                  }}
                >
                  <option value="">선택</option>
                  {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
              {native && (
                <button
                  type="button"
                  className={ledger.btnSecondary}
                  disabled={!!busy}
                  onClick={() => {
                    setLineInputs(rows => rows.map(row => ({ ...row, groupId: row.suggestedGroupId || row.groupId })));
                    setResult(null);
                  }}
                >
                  추천 품종 적용 (표에서 확인하세요)
                </button>
              )}
            </div>
          </div>

          {needsFullBox && (
            <fieldset className={ledger.awbFieldset}>
              <legend>품종별 FB 환산 박스수 (원본 패킹 기준 · 실물 박스수를 그대로 쓰지 않습니다)</legend>
              <div className={ledger.formGrid} style={{ marginTop: 8 }}>
                {groupIds.map(id => (
                  <label key={id} className={ledger.field}>
                    <span>{labels[id]} (입고 실물 {rowBoxes[id]}박스)</span>
                    <input
                      aria-label={`${labels[id]} FB 환산 박스수`}
                      type="number"
                      min="0"
                      step="any"
                      value={fullBox[id] ?? ''}
                      onChange={event => { setFullBox(current => ({ ...current, [id]: event.target.value })); setResult(null); }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className={ledger.reviewTableWrap}>
            <table className={ledger.reviewTable}>
              <thead>
                <tr>
                  <th>농장·송장</th>
                  <th>품종</th>
                  <th>품목</th>
                  <th>송이</th>
                  <th>단당 송이</th>
                  <th>관세율(%)</th>
                </tr>
              </thead>
              <tbody>
                {prepared.members.flatMap(member => member.rows.map(row => {
                  const currentLine = lineInputs.find(line => line.lineId === row.lineId);
                  return (
                    <tr key={row.lineId}>
                      <td>{member.farmName} · {member.invoiceNo}</td>
                      <td>
                        <select
                          aria-label={`${row.originalName} 품종`}
                          value={currentLine?.groupId || ''}
                          onChange={event => {
                            const nextGroup = event.target.value;
                            setLineInputs(lines => lines.map(line => line.lineId === row.lineId ? {
                              ...line,
                              groupId: nextGroup,
                              stemsPerBunch: (line.stemsPerBunch !== '' && line.stemsPerBunch != null && Number(line.stemsPerBunch) > 0)
                                ? line.stemsPerBunch
                                : (CO_DEFAULT_STEMS_PER_BUNCH[nextGroup] ?? ''),
                            } : line));
                            setResult(null);
                          }}
                        >
                          <option value="">품종 확인</option>
                          {Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                      </td>
                      <td>{row.originalName}</td>
                      <td>{Number(row.stemQuantity ?? 0).toLocaleString('ko-KR')}</td>
                      <td>
                        <input
                          aria-label={`${row.originalName} 단당 송이수`}
                          type="number"
                          min="0.000001"
                          step="any"
                          style={{ width: 84 }}
                          value={currentLine?.stemsPerBunch ?? ''}
                          onChange={event => {
                            setLineInputs(lines => lines.map(line => line.lineId === row.lineId ? { ...line, stemsPerBunch: event.target.value } : line));
                            setResult(null);
                          }}
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`${row.originalName} 관세율`}
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          style={{ width: 72 }}
                          value={currentLine?.tariffPercent ?? '0'}
                          onChange={event => {
                            setLineInputs(lines => lines.map(line => line.lineId === row.lineId ? { ...line, tariffPercent: event.target.value } : line));
                            setResult(null);
                          }}
                        />
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>

          <div className={ledger.actionRow}>
            <button className={ledger.btnPrimary} type="button" disabled={!!busy || !confirmed} onClick={() => run('preview')}>
              {native ? '콜롬비아 전체 원가 계산' : '공동 AWB 원가 계산'}
            </button>
          </div>

          {result?.issues?.length > 0 && (
            <ul className={ledger.alertError} role="alert" style={{ paddingLeft: 28 }}>
              {result.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}
            </ul>
          )}

          {result?.status === 'CALCULATED' && (
            <>
              <div className={ledger.calcSummaryBar}>
                <div className={ledger.calcSummaryText}>
                  <span>
                    항공료 <strong>${fmtDec(result.totals.freightNative, 2)}</strong>
                    {result.freightBreakdown && (
                      <> (운송비 ${fmtDec(result.freightBreakdown.freightOnlyUSD, 2)} + 서류 ${fmtDec(result.freightBreakdown.docFeeUSD, 2)} · Rate {fmtDec(result.freightBreakdown.freightRateUSD, 2)})</>
                    )}
                  </span>
                  <span> · 통관비 <strong>{fmtInt(result.totals.customsKRW)}원</strong></span>
                  <span> · 전체 <strong>{result.lines.length}품목</strong></span>
                  <span> · 총 도착원가 <strong>{fmtInt(result.lines.reduce((s, l) => s + l.totalCostKRW, 0))}원</strong></span>
                </div>
                <div className={ledger.rowActions}>
                  <button className={ledger.btnSecondarySm} disabled={!!busy || !downloadReady} type="button" onClick={() => run('bridge')}>
                    도착원가 업로드 검토로 바로 보내기
                  </button>
                  <button className={ledger.btnPrimarySm} disabled={!!busy || !downloadReady} type="button" onClick={() => run('download')}>
                    {effectiveAppend && master?.exists ? '누적 원가 엑셀(.xlsx) 다운로드' : '원가 엑셀(.xlsx) 바로 다운로드'}
                  </button>
                </div>
              </div>

              <section className={ledger.resultWorkbench} aria-label="품종·농장 원클릭 도착원가 뷰">
                <div className={ledger.filterBarGroup}>
                  <div className={ledger.filterBarRow} role="toolbar" aria-label="품종 버튼 필터">
                    <span className={ledger.filterGroupLabel}>품종</span>
                    <div className={ledger.chipGroup}>
                      <button
                        type="button"
                        className={selectedVarieties.length === 0 ? ledger.filterChipActive : ledger.filterChip}
                        aria-pressed={selectedVarieties.length === 0}
                        onClick={e => handleVarietyClick('ALL', e)}
                      >
                        전체 ({enrichedResultRows.length})
                      </button>
                      {varietyButtons.map(item => {
                        const active = varietySet.has(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={active ? ledger.filterChipActive : ledger.filterChip}
                            aria-pressed={active}
                            onClick={e => handleVarietyClick(item.id, e)}
                          >
                            {item.label} ({item.count})
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className={multiVariety ? ledger.modeToggleActive : ledger.modeToggle}
                      aria-pressed={multiVariety}
                      onClick={() => setMultiVariety(v => !v)}
                    >
                      복수 선택
                    </button>
                  </div>

                  <div className={ledger.filterBarRow} role="toolbar" aria-label="농장 버튼 필터">
                    <span className={ledger.filterGroupLabel}>농장</span>
                    <div className={ledger.chipGroup}>
                      <button
                        type="button"
                        className={selectedFarms.length === 0 ? ledger.filterChipActive : ledger.filterChip}
                        aria-pressed={selectedFarms.length === 0}
                        onClick={e => handleFarmClick('ALL', e)}
                      >
                        전체 농장 ({farmButtons.length})
                      </button>
                      {farmButtons.map(item => {
                        const active = farmSet.has(item.farmName);
                        return (
                          <button
                            key={item.farmName}
                            type="button"
                            className={active ? ledger.filterChipActive : ledger.filterChip}
                            aria-pressed={active}
                            onClick={e => handleFarmClick(item.farmName, e)}
                          >
                            {item.farmName} ({item.count})
                          </button>
                        );
                      })}
                    </div>
                    <div className={ledger.filterSearchTools}>
                      <button
                        type="button"
                        className={multiFarm ? ledger.modeToggleActive : ledger.modeToggle}
                        aria-pressed={multiFarm}
                        onClick={() => setMultiFarm(v => !v)}
                      >
                        복수 농장
                      </button>
                    </div>
                  </div>

                  <div className={ledger.filterBarRow} role="toolbar" aria-label="품목 버튼 필터">
                    <span className={ledger.filterGroupLabel}>품목</span>
                    <div className={ledger.chipGroup}>
                      <button
                        type="button"
                        className={selectedProducts.length === 0 ? ledger.filterChipActive : ledger.filterChip}
                        aria-pressed={selectedProducts.length === 0}
                        onClick={e => handleProductClick('ALL', e)}
                      >
                        전체 품목 ({productButtons.length})
                      </button>
                      {visibleProductButtons.map(item => {
                        const active = productSet.has(item.productName);
                        return (
                          <button
                            key={item.productName}
                            type="button"
                            className={active ? ledger.filterChipActive : ledger.filterChip}
                            aria-pressed={active}
                            onClick={e => handleProductClick(item.productName, e)}
                          >
                            {item.productName}{item.count > 1 ? ` (${item.count})` : ''}
                          </button>
                        );
                      })}
                      {productButtons.length > 24 && (
                        <button
                          type="button"
                          className={ledger.modeToggle}
                          onClick={() => setShowAllProducts(v => !v)}
                        >
                          {showAllProducts ? '품목 접기' : `품목 더보기 (+${productButtons.length - 24})`}
                        </button>
                      )}
                    </div>
                    <div className={ledger.filterSearchTools}>
                      <button
                        type="button"
                        className={multiProduct ? ledger.modeToggleActive : ledger.modeToggle}
                        aria-pressed={multiProduct}
                        onClick={() => setMultiProduct(v => !v)}
                      >
                        복수 품목
                      </button>
                      <input
                        type="search"
                        aria-label="품목명 또는 농장 검색"
                        className={ledger.filterSearchInput}
                        value={resultSearch}
                        placeholder="품목명 · 농장 · 송장 검색"
                        onChange={e => setResultSearch(e.target.value)}
                      />
                      {hasActiveFilter && (
                        <button
                          type="button"
                          className={ledger.btnSecondarySm}
                          onClick={() => { setSelectedVarieties([]); setSelectedFarms([]); setSelectedProducts([]); setResultSearch(''); }}
                        >
                          초기화
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <dl className={ledger.resultSubtotalStrip} aria-label="선택 조건 소계">
                  <div>
                    <dt>품목수</dt>
                    <dd>
                      {filteredSummary.itemCount}품목
                      {hasActiveFilter && <span className={ledger.kpiSub}> / 전체 {filteredSummary.totalItemCount}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>실물박스 (FB)</dt>
                    <dd>
                      {fmtDec(filteredSummary.boxes, Number.isInteger(filteredSummary.boxes) ? 0 : 2)}박스
                      {filteredSummary.fbSum != null && <span className={ledger.kpiSub}> (FB {fmtDec(filteredSummary.fbSum, Number.isInteger(filteredSummary.fbSum) ? 0 : 2)})</span>}
                    </dd>
                  </div>
                  <div>
                    <dt>총송이</dt>
                    <dd>{fmtInt(filteredSummary.stems)}송이</dd>
                  </div>
                  <div>
                    <dt>FOB 합계 (USD)</dt>
                    <dd>${fmtDec(filteredSummary.fobUSD, 2)}</dd>
                  </div>
                  <div>
                    <dt>운임 + 통관 합계</dt>
                    <dd>
                      ${fmtDec(filteredSummary.freightUSD, 2)} · {fmtInt(filteredSummary.freightAndCustomsKRW)}원
                    </dd>
                  </div>
                  <div className={ledger.kpiHighlight}>
                    <dt>도착원가 합계 (KRW)</dt>
                    <dd>{fmtInt(filteredSummary.totalCostKRW)}원</dd>
                  </div>
                </dl>

                <div className={ledger.resultLedgerWrap}>
                  <table className={ledger.resultLedgerTable}>
                    <thead>
                      <tr>
                        <th>농장</th>
                        <th>품종</th>
                        <th>품목명</th>
                        <th className={ledger.numHead}>박스</th>
                        <th className={ledger.numHead}>송이수</th>
                        <th className={ledger.numHead}>단당송이</th>
                        <th className={ledger.numHead}>FOB($)</th>
                        <th className={ledger.numHead}>송이당운임($)</th>
                        <th className={ledger.numHead}>통관(원)</th>
                        <th className={ledger.numHead}>도착원가(송이)</th>
                        <th className={ledger.numHead}>도착원가(단)</th>
                        <th className={ledger.numHead}>총원가(원)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResultRows.length === 0 ? (
                        <tr>
                          <td colSpan={12} className={ledger.emptyFilterCell}>
                            선택한 품종·농장·검색어 조건에 해당하는 품목이 없습니다.
                          </td>
                        </tr>
                      ) : (
                        filteredResultRows.slice(0, resultLimit).map(row => <ResultLedgerRow key={row.lineId} row={row} />)
                      )}
                    </tbody>
                    {filteredResultRows.length > 0 && (
                      <tfoot>
                        <tr>
                          <td colSpan={3}>선택 합계 ({filteredSummary.itemCount}품목)</td>
                          <td className={ledger.numCell}>{fmtDec(filteredSummary.boxes, Number.isInteger(filteredSummary.boxes) ? 0 : 2)}</td>
                          <td className={ledger.numCell}>{fmtInt(filteredSummary.stems)}</td>
                          <td className={ledger.numCell}>-</td>
                          <td className={ledger.numCell}>${fmtDec(filteredSummary.fobUSD, 2)}</td>
                          <td className={ledger.numCell}>${fmtDec(filteredSummary.freightUSD, 2)}</td>
                          <td className={ledger.numCell}>{fmtInt(filteredSummary.customsKRW)}</td>
                          <td className={ledger.numCell}>-</td>
                          <td className={ledger.numCell}>-</td>
                          <td className={ledger.numStrongCell}>{fmtInt(filteredSummary.totalCostKRW)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {filteredResultRows.length > resultLimit && (
                  <div className={ledger.actionRow} style={{ padding: '10px 14px', justifyContent: 'center' }}>
                    <button type="button" className={ledger.btnSecondarySm} onClick={() => setResultLimit(n => n + 100)}>
                      더 보기 (+100건 · 남은 {filteredResultRows.length - resultLimit}건)
                    </button>
                  </div>
                )}
              </section>

              <section className={ledger.masterSection} aria-label="누적 원가자료">
                <p>
                  {master?.exists
                    ? `${MASTER_LABELS[masterKey]}: ${master.sheetNames.length}개 시트 · 마지막 ${master.sheetNames.at(-1)} · ${String(master.updatedAt || '').slice(0, 16).replace('T', ' ')}`
                    : `서버에 ${MASTER_LABELS[masterKey]}가 없습니다. 기존 누적 파일을 한 번 올리면 전 과거 차수 시트에도 품종 필터·고정헤드가 자동 적용되어 쌓입니다.`}
                  {master?.exists && (
                    <>
                      {' · '}
                      <a href={`/api/import/receipts/cost-master?country=${masterKey}&download=1`} className={ledger.awbSourceLink}>
                        서버 보관 누적 원가자료(.xlsx) 바로 다운로드
                      </a>
                    </>
                  )}
                </p>
                {master?.exists && (
                  <label className={ledger.checkLabel}>
                    <input
                      type="checkbox"
                      aria-label="누적 원가자료에 이번 차수 시트 추가"
                      checked={effectiveAppend}
                      disabled={!!busy || isTestOnly}
                      onChange={event => setAppendToMaster(event.target.checked)}
                    />
                    <span>
                      다운로드할 때 {MASTER_LABELS[masterKey]}에 이번 차수({orderWeek}) 시트 추가 · 같은 차수는 그 시트만 교체
                      {isTestOnly ? ' (시험값 계산본은 누적 파일에 반영하지 않습니다)' : ''}
                    </span>
                  </label>
                )}
                <label className={ledger.field} style={{ maxWidth: 420 }}>
                  <span>{master?.exists ? `${MASTER_LABELS[masterKey]} 교체` : `${MASTER_LABELS[masterKey]} 올리기`}</span>
                  <input
                    aria-label={`${MASTER_LABELS[masterKey]} 파일`}
                    type="file"
                    accept=".xlsx"
                    disabled={!!busy}
                    onChange={event => seedMaster(masterKey, event)}
                  />
                </label>
                {masterNote && <p className={ledger.statusNotice} role="status">{masterNote}</p>}
              </section>
              <div className={ledger.actionRow}>
                <button className={ledger.btnSecondary} disabled={!!busy || !downloadReady} type="button" onClick={() => run('bridge')}>
                  도착원가 업로드 검토로 바로 보내기
                </button>
                <button className={ledger.btnPrimary} disabled={!!busy || !downloadReady} type="button" onClick={() => run('download')}>
                  {effectiveAppend && master?.exists
                    ? '누적 도착원가 엑셀 다운로드 · 이번 차수 시트 추가'
                    : (native ? '콜롬비아 전체 도착원가 엑셀 다운로드' : '공동 AWB 도착원가 엑셀 다운로드')}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
