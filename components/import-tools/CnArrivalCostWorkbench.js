import React, { useEffect, useMemo, useRef, useState } from 'react';
import s from '../../styles/CnArrivalCost.module.css';
import { CN_CATEGORIES, CN_MODES } from '../../lib/cnArrivalCostRules.js';
import { CN_HEADER_FIELDS, applyCnCategory, buildCnDraft, computeCnCost, isCnWeightAllocation, reconcileCnAutoHeader } from '../../lib/cnArrivalCostEngine.js';
import { parseHubfreshFooterCharges, parseHubfreshInvoice } from '../../lib/hubfreshPacking.js';
import { sendWorkbookToArrivalUploadReview } from '../../lib/arrivalCostUploadBridge.js';
import { cleanArrivalFlowerChip } from '../../lib/arrivalCostView.js';

const MEMORY_KEY = 'nenova.cnArrivalCost.prodMemory.v1';
const MODE_LABEL = { CLOUD: 'CLOUD(중국 항공)', HUBFRESH: 'HUBFRESH(중국 해상)' };
const won = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '-');
const fix = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-');
const readMemory = () => { try { return JSON.parse(window.localStorage.getItem(MEMORY_KEY) || '{}') || {}; } catch { return {}; } };
const writeMemory = value => { try { window.localStorage.setItem(MEMORY_KEY, JSON.stringify(value)); } catch { /* 저장 공간이 없으면 이번 화면에서만 유지 */ } };
const pct = v => (v === '' || v == null ? '' : Math.round(Number(v) * 1e8) / 1e6);
const fromPct = v => (v === '' ? '' : Number(v) / 100);
const fromNum = v => (v === '' ? '' : Number(v));

function parseCloudSheetHints(grid = []) {
  const hints = {};
  const textOf = v => String(v ?? '').trim();
  const numOf = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : null; };
  for (const row of grid.slice(0, 45)) {
    if (!Array.isArray(row)) continue;
    for (let i = 0; i < row.length; i++) {
      const label = textOf(row[i]);
      if (!label) continue;
      const nextNum = [row[i + 1], row[i + 2], row[i + 3]].map(numOf).find(v => v != null);
      if (/^환율$/i.test(label) && nextNum && hints.exchangeRate == null) hints.exchangeRate = nextNum;
      if (/^GW$|^Gross\s*weight$/i.test(label) && nextNum && hints.gw == null) hints.gw = nextNum;
      if ((/^awb\s*cbm$/i.test(label) || /^Chargeable\s*weight$/i.test(label)) && nextNum) hints.cw = nextNum;
      if (/^CW$/i.test(label) && nextNum && hints.cw == null) hints.cw = nextNum;
      if (/^항공료$|^항공운임$/i.test(label) && nextNum && hints.airFreight == null) hints.airFreight = nextNum;
    }
  }
  return hints;
}

export default function CnArrivalCostWorkbench({ orderYear, orderWeek, warehouseKey, warehouseKeys, onClose, onOpenLegacy, onSendToUploadReview = null }) {
  const keyList = useMemo(() => (Array.isArray(warehouseKeys) && warehouseKeys.length ? warehouseKeys : [warehouseKey].filter(Boolean)), [warehouseKey, warehouseKeys]);
  const keyParam = keyList.join(',');
  const [source, setSource] = useState(null);
  const [state, setState] = useState({ loading: true, error: '' });
  const [draft, setDraft] = useState(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [onlyReview, setOnlyReview] = useState(false);
  const [selectedVarieties, setSelectedVarieties] = useState([]);
  const [multiVariety, setMultiVariety] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [multiCategory, setMultiCategory] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [multiProduct, setMultiProduct] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowLimit, setRowLimit] = useState(100);
  const fileRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, error: '' }); setDraft(null); setSource(null); setNotice('');
    const params = keyList.length > 1
      ? new URLSearchParams({ orderYear, orderWeek, warehouseKeys: keyParam })
      : new URLSearchParams({ orderYear, orderWeek, warehouseKey: String(keyList[0] ?? '') });
    fetch(`/api/import/receipts/cn-arrival-cost?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || '입고자료를 불러오지 못했습니다.'); return data.source; })
      .then(next => {
        if (controller.signal.aborted) return;
        setSource(next);
        const memory = readMemory();
        const initial = buildCnDraft(next, {});
        setDraft(buildCnDraft(next, { mode: initial.mode, memory: memory[initial.mode] || {} }));
        setState({ loading: false, error: '' });
      })
      .catch(error => { if (!controller.signal.aborted) setState({ loading: false, error: error.message }); });
    return () => controller.abort();
  }, [orderYear, orderWeek, keyParam]);

  const preview = useMemo(() => (draft ? computeCnCost(draft) : null), [draft]);
  const categoryLabelMap = useMemo(() => new Map(CN_CATEGORIES.map(c => [c.code, c.label])), []);
  const rowVarietyOf = row => cleanArrivalFlowerChip({
    productNameRaw: row.name,
    flowerNameRaw: categoryLabelMap.get(row.categoryCode) || '',
  });
  const varietySet = useMemo(() => new Set(selectedVarieties), [selectedVarieties]);
  const categorySet = useMemo(() => new Set(selectedCategories), [selectedCategories]);
  const productSet = useMemo(() => new Set(selectedProducts), [selectedProducts]);
  const normalizedCnSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);
  const varietyButtons = useMemo(() => {
    if (!draft?.rows?.length) return [];
    const counts = new Map();
    for (const row of draft.rows) {
      const v = rowVarietyOf(row);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => Number(a[0] === '기타') - Number(b[0] === '기타') || a[0].localeCompare(b[0], 'ko'))
      .map(([label, count]) => ({ label, count }));
  }, [draft?.rows, categoryLabelMap]);
  const categoryButtons = useMemo(() => {
    if (!draft?.rows?.length) return [];
    const counts = new Map();
    for (const row of draft.rows) {
      if (varietySet.size > 0 && !varietySet.has(rowVarietyOf(row))) continue;
      counts.set(row.categoryCode, (counts.get(row.categoryCode) || 0) + 1);
    }
    return [...counts.entries()].map(([code, count]) => ({
      code,
      label: categoryLabelMap.get(code) || code,
      count,
    }));
  }, [draft?.rows, categoryLabelMap, varietySet]);
  const productButtons = useMemo(() => {
    if (!draft?.rows?.length) return [];
    const counts = new Map();
    for (const row of draft.rows) {
      if (onlyReview && !row.needsReview) continue;
      if (varietySet.size > 0 && !varietySet.has(rowVarietyOf(row))) continue;
      if (categorySet.size > 0 && !categorySet.has(row.categoryCode)) continue;
      counts.set(row.name, (counts.get(row.name) || 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count }));
  }, [draft?.rows, onlyReview, varietySet, categorySet, categoryLabelMap]);
  useEffect(() => { setRowLimit(100); }, [onlyReview, selectedVarieties, selectedCategories, selectedProducts, normalizedCnSearch]);

  function switchMode(mode) {
    if (!source || draft?.mode === mode) return;
    setNotice('');
    setDraft(buildCnDraft(source, { mode, memory: readMemory()[mode] || {} }));
  }
  function resetDefaults() {
    if (!source || !draft) return;
    setNotice('표준 기본값과 입고 자동추출값으로 복원했습니다.');
    setDraft(buildCnDraft(source, { mode: draft.mode, memory: readMemory()[draft.mode] || {} }));
  }
  function setHeader(key, value) {
    setNotice('');
    setDraft(d => ({ ...d, header: { ...d.header, [key]: value }, headerSources: { ...d.headerSources, [key]: '화면 수정값' } }));
  }
  function rememberRow(row, mode) {
    if (!remember || row.prodKey == null) return;
    const memory = readMemory();
    memory[mode] = { ...(memory[mode] || {}), [String(row.prodKey)]: { categoryCode: row.categoryCode, bunchesPerBox: row.bunchesPerBox, cbmPerBunch: row.cbmPerBunch,
      weightKgPerBunch: row.weightKgPerBunch, tariffRate: row.tariffRate, stemsPerBunch: row.stemsPerBunch } };
    writeMemory(memory);
  }
  function editRow(lineId, change) {
    setNotice('');
    setDraft(d => {
      const rows = d.rows.map(row => {
        if (row.lineId !== lineId) return row;
        let next;
        if ('categoryCode' in change) next = { ...applyCnCategory(row, change.categoryCode, d.mode), stemsPerBunch: row.stemsPerBunch };
        else if ('bunchesPerBox' in change && Number(change.bunchesPerBox) > 0 && Number(row.bunchesPerBox) > 0 && Number.isFinite(Number(row.cbmPerBunch))) {
          next = { ...row, ...change, cbmPerBunch: Math.round(Number(row.cbmPerBunch) * Number(row.bunchesPerBox) / Number(change.bunchesPerBox) * 1e9) / 1e9 };
        } else next = { ...row, ...change };
        next.edited = true;
        if ('categoryCode' in change) next.needsReview = false;
        if (!('quantity' in change) && !('fob' in change)) rememberRow(next, d.mode);
        return next;
      });
      return reconcileCnAutoHeader({ ...d, rows });
    });
  }

  async function importDocFile(file) {
    if (!file || !draft) return;
    setNotice('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', sheetRows: 5000 });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', range: 0 });
      if (draft.mode === CN_MODES.HUBFRESH) {
        let applied = [];
        try {
          const parsed = parseHubfreshInvoice(grid);
          setDraft(d => {
            const nextHeader = { ...d.header }, nextSources = { ...d.headerSources };
            const applyVal = (k, v, label) => { if (Number.isFinite(v) && v > 0) { nextHeader[k] = v; nextSources[k] = label; applied.push(k); } };
            applyVal('nenovaCbm', parsed.cbmSummary.nenovaCbm, `${file.name} CL박스 CBM`);
            applyVal('realCbm', parsed.cbmSummary.realCbm, `${file.name} 전체 CBM`);
            for (const [k, v] of Object.entries(parsed.charges || {})) applyVal(k, v, `${file.name} 하단 부대비`);
            return { ...d, header: nextHeader, headerSources: nextSources };
          });
        } catch {
          const charges = parseHubfreshFooterCharges(grid);
          setDraft(d => {
            const nextHeader = { ...d.header }, nextSources = { ...d.headerSources };
            for (const [k, v] of Object.entries(charges)) if (Number.isFinite(v) && v > 0) { nextHeader[k] = v; nextSources[k] = `${file.name} 자동추출`; applied.push(k); }
            return { ...d, header: nextHeader, headerSources: nextSources };
          });
        }
        setNotice(applied.length ? `${file.name}에서 ${applied.length}개 해상 변수를 채웠습니다. 필요하면 화면에서 바로 수정하세요.` : `${file.name}에서 추출할 해상 항목을 찾지 못했습니다. 상단 입력칸에서 직접 수정하세요.`);
      } else {
        const hints = parseCloudSheetHints(grid);
        const keys = Object.keys(hints);
        if (keys.length) {
          setDraft(d => {
            const nextHeader = { ...d.header }, nextSources = { ...d.headerSources };
            for (const [k, v] of Object.entries(hints)) { nextHeader[k] = v; nextSources[k] = `${file.name} 자동추출`; }
            return { ...d, header: nextHeader, headerSources: nextSources };
          });
        }
        setNotice(keys.length ? `${file.name}에서 ${keys.join(', ')} 값을 채웠습니다.` : `${file.name}에서 중량·운임 항목을 찾지 못했습니다. 상단 입력칸에서 직접 수정하세요.`);
      }
    } catch (error) {
      setNotice(`서류 읽기에 실패했습니다 (${error.message}). 상단 입력칸에서 직접 수정할 수 있습니다.`);
    }
  }

  async function download({ sendToUploadReview = false } = {}) {
    if (!draft || busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch('/api/import/receipts/cn-arrival-cost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ mode: draft.mode, header: draft.header, rows: draft.rows, warehouseKey: draft.warehouseKey, warehouseKeys: draft.warehouseKeys, orderYear: draft.orderYear, orderWeek: draft.orderWeek, farmName: draft.farmName, invoiceNo: draft.invoiceNo }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '엑셀을 만들지 못했습니다.'); }
      const blob = await response.blob();
      const keyPart = draft.warehouseKeys?.length > 1 ? draft.warehouseKeys.join('-') : draft.warehouseKey;
      const fileName = `중국도착원가_${draft.mode}_${draft.orderYear}_${draft.orderWeek}_${keyPart}.xlsx`;
      if (sendToUploadReview) {
        await sendWorkbookToArrivalUploadReview({
          blob,
          fileName,
          orderYear: draft.orderYear,
          orderWeek: draft.orderWeek,
          country: '중국',
          onSendToUploadReview,
        });
        setNotice(`계산한 원가 엑셀(${fileName})을 도착원가 업로드 검토 패널로 전달했습니다. 아래 시트 검토에서 확인 후 선택 시트 저장을 누르세요.`);
      } else {
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = fileName; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setNotice(`화면 수정값 그대로 엑셀(.xlsx)을 생성했습니다 (${blob.size.toLocaleString('ko-KR')}바이트). 노란 입력칸을 바꾸면 엑셀에서도 같은 수식으로 재계산됩니다.`);
      }
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }

  if (state.loading) return <section className={s.panel}><p className={s.status} role="status">중국 입고자료와 기본값을 불러오는 중입니다.</p></section>;
  if (state.error) return <section className={s.panel}><p className={s.error} role="alert">{state.error}</p><button type="button" className={s.secondary} onClick={onClose}>닫기</button></section>;
  if (!draft) return null;
  const fields = CN_HEADER_FIELDS[draft.mode];
  const groups = [...new Set(fields.map(f => f.group))];
  const isSea = draft.mode === CN_MODES.HUBFRESH;
  const d = preview?.derived;
  const reviewCount = draft.rows.filter(r => r.needsReview).length;
  const resultById = new Map((preview?.rows || []).map(r => [r.lineId, r]));
  const visibleRows = draft.rows.filter(r => {
    if (onlyReview && !r.needsReview) return false;
    if (varietySet.size > 0 && !varietySet.has(rowVarietyOf(r))) return false;
    if (categorySet.size > 0 && !categorySet.has(r.categoryCode)) return false;
    if (productSet.size > 0 && !productSet.has(r.name)) return false;
    if (normalizedCnSearch) {
      const catLabel = categoryLabelMap.get(r.categoryCode) || r.categoryCode || '';
      if (!`${r.name} ${catLabel} ${rowVarietyOf(r)}`.toLowerCase().includes(normalizedCnSearch)) return false;
    }
    return true;
  });
  const pagedVisibleRows = visibleRows.slice(0, rowLimit);
  const hasCnFilter = onlyReview || selectedVarieties.length > 0 || selectedCategories.length > 0 || selectedProducts.length > 0 || normalizedCnSearch.length > 0;
  const visibleProductChips = showAllProducts || productButtons.length <= 24 ? productButtons : productButtons.slice(0, 24);
  const filteredSubtotal = visibleRows.reduce((acc, row) => {
    const r = resultById.get(row.lineId);
    acc.qty += Number(row.quantity) || 0;
    acc.fob += (Number(row.quantity) || 0) * (Number(row.fob) || 0);
    acc.totalCost += Number(r?.totalCost) || 0;
    return acc;
  }, { qty: 0, fob: 0, totalCost: 0 });
  const categories = CN_CATEGORIES.filter(c => !(isSea && c.code === 'ORCHID'));
  const keyHeading = draft.warehouseKeys?.length > 1 ? draft.warehouseKeys.map(k => `#${k}`).join(' + ') : `#${draft.warehouseKey}`;

  return (
    <section className={s.panel} aria-label="중국 도착원가 CLOUD HUBFRESH 계산">
      <div className={s.purpose}>
        <strong>[핵심 목적 · PURPOSE]</strong> 중국 운영 체제를 <strong>CLOUD(중국 항공)</strong>과 <strong>HUBFRESH(중국 해상 · 40ft 혼적 최종본)</strong> 2축으로 단일화해 도착원가를 산출합니다. 모든 항목에 기본값·자동추출값이 선입력되어 있으며, 바꾼 값은 화면 미리보기와 다운로드 엑셀(.xlsx) 수식에 100% 동일하게 반영됩니다.
      </div>
      <header className={s.head}>
        <div>
          <h3>입고 {keyHeading} · {draft.orderYear}/{draft.orderWeek} · {draft.farmName}</h3>
          <p className={s.sub}>송장 {draft.invoiceNo || '-'} · 멜로디·헨지 미사용(과거 레거시 입고는 CLOUD 항공에서 수수료율 0%로 호환 열람) · 운영 DB 읽기 전용{draft.legacy ? ' · 레거시 수수료 0% 자동 적용됨' : ''}</p>
        </div>
        <div className={s.modeSwitch} role="group" aria-label="중국 원가 모드">
          {[CN_MODES.CLOUD, CN_MODES.HUBFRESH].map(mode => (
            <button key={mode} type="button" className={draft.mode === mode ? s.modeOn : s.modeOff} aria-pressed={draft.mode === mode} onClick={() => switchMode(mode)}>{MODE_LABEL[mode]}</button>
          ))}
        </div>
      </header>

      {draft.notices.length > 0 && <ul className={s.notices}>{draft.notices.map((n, i) => <li key={i} className={n.level === 'warn' ? s.warn : s.info}>{n.text}</li>)}</ul>}

      <div className={s.headerGrid}>
        {groups.map(group => (
          <fieldset key={group} className={s.group}>
            <legend>{group}</legend>
            {fields.filter(f => f.group === group).map(field => {
              const value = draft.header[field.key];
              const sourceLabel = draft.headerSources[field.key];
              return (
                <label key={field.key} className={s.field}>
                  <span className={s.fieldLabel}>{field.label}</span>
                  <span className={s.inputWrap}>
                    {field.select ? (
                      <select aria-label={field.label} value={value} onChange={e => setHeader(field.key, Number(e.target.value))} className={sourceLabel === '화면 수정값' ? s.inputEdited : s.input}>
                        {field.select.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    ) : (
                      <>
                        <input type="number" step="any" min="0" aria-label={field.label} value={field.percent ? pct(value) : value}
                          onChange={e => setHeader(field.key, field.percent ? fromPct(e.target.value) : fromNum(e.target.value))}
                          className={sourceLabel === '화면 수정값' ? s.inputEdited : s.input} />
                        <span className={s.unit}>{field.percent ? '%' : field.unit}</span>
                      </>
                    )}
                  </span>
                  <span className={s.source}>{sourceLabel}</span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>

      {d && (
        <dl className={s.summary}>
          {isSea ? (<>
            <div><dt>CBM 지분율 (F40÷F41)</dt><dd>{fix(d.share * 100, 2)}%</dd></div>
            <div><dt>규격표 합산 CBM</dt><dd>{fix(d.rowCbm, 4)} CBM</dd></div>
            <div><dt>컨테이너 원액 100%</dt><dd>{fix(d.containerCharges)} CNY</dd></div>
            <div><dt>안분운송료 (C11)</dt><dd>{fix(d.allocatedFreight)} CNY</dd></div>
            <div><dt>CBM당 단가 Rate (P5)</dt><dd>{fix(d.rate, 4)} CNY</dd></div>
            <div><dt>안분 통관비</dt><dd>{won(d.customsTotal)}원</dd></div>
            <div><dt>그외통관(단)</dt><dd>{fix(d.customsPerBunch)}원</dd></div>
          </>) : (<>
            <div><dt>적용 배분 기준</dt><dd>{isCnWeightAllocation(draft.header) ? 'GW = CW · 중량 비례' : 'GW < CW · CBM 비례'}</dd></div>
            <div><dt>배분 단가 Rate</dt><dd>{fix(d.rate, 4)} CNY</dd></div>
            <div><dt>백상비</dt><dd>{won(d.warehouseFee)}원</dd></div>
            <div><dt>검역비</dt><dd>{won(d.quarantineFee)}원</dd></div>
            <div><dt>총 통관비</dt><dd>{won(d.customsTotal)}원</dd></div>
            <div><dt>그외통관(단)</dt><dd>{fix(d.customsPerBunch)}원</dd></div>
          </>)}
          <div><dt>입고 단수</dt><dd>{won(d.totalQty)}단</dd></div>
          <div><dt>총 도착원가</dt><dd>{won(preview.totals.totalCostKrw)}원</dd></div>
        </dl>
      )}
      {preview?.issues?.length > 0 && <ul className={s.issues} role="alert">{preview.issues.slice(0, 8).map((i, n) => <li key={n}>{i.text}</li>)}</ul>}

      <div className={s.toolbar}>
        <label className={s.check}><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />수정한 품목 규격을 ProdKey별로 기억 (로컬스토리지 자동 적용)</label>
        {reviewCount > 0 && <label className={s.check}><input type="checkbox" checked={onlyReview} onChange={e => setOnlyReview(e.target.checked)} />미등록 품종 {reviewCount}건만 보기</label>}
        <input ref={fileRef} type="file" accept=".xlsx" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importDocFile(f); e.target.value = ''; }} />
        <button type="button" className={s.secondary} onClick={() => fileRef.current?.click()}>업로드 서류(.xlsx) 값 자동채움</button>
        <button type="button" className={s.secondary} onClick={resetDefaults}>기본값 복원</button>
        {onOpenLegacy && keyList.length === 1 && <button type="button" className={s.secondary} onClick={() => onOpenLegacy(keyList[0])}>구 개별 원가 화면</button>}
        <span className={s.spacer} />
        <button type="button" className={s.secondary} onClick={onClose}>입고 목록으로</button>
        <button type="button" className={s.secondary} disabled={busy || !preview?.rows?.length} onClick={() => download({ sendToUploadReview: true })}>{busy ? '전달 준비 중' : '도착원가 업로드 검토로 바로 보내기'}</button>
        <button type="button" className={s.primary} disabled={busy || !preview?.rows?.length} onClick={() => download()}>{busy ? '엑셀 생성 중' : '화면 수정값으로 원가 엑셀(.xlsx) 다운로드'}</button>
      </div>
      {notice && <p className={s.status} role="status">{notice}</p>}

      <div className={s.filterPanel} role="toolbar" aria-label="카테고리 원클릭 버튼 필터">
        <div className={s.chipRow} role="toolbar" aria-label="중국 품종 원클릭 버튼 필터">
          <span className={s.filterLabel}>품종</span>
          <div className={s.chipList}>
            <button
              type="button"
              className={selectedVarieties.length === 0 ? s.chipActive : s.chip}
              aria-pressed={selectedVarieties.length === 0}
              onClick={() => { setSelectedVarieties([]); setSelectedCategories([]); setSelectedProducts([]); }}
            >
              전체 품종 ({draft.rows.length})
            </button>
            {varietyButtons.map(v => {
              const active = varietySet.has(v.label);
              return (
                <button
                  key={v.label}
                  type="button"
                  className={active ? s.chipActive : s.chip}
                  aria-pressed={active}
                  onClick={e => {
                    const additive = multiVariety || e.metaKey || e.ctrlKey || e.shiftKey;
                    setSelectedCategories([]);
                    setSelectedProducts([]);
                    setSelectedVarieties(prev => {
                      if (!additive) return prev.length === 1 && prev[0] === v.label ? [] : [v.label];
                      return prev.includes(v.label) ? prev.filter(x => x !== v.label) : [...prev, v.label];
                    });
                  }}
                >
                  {v.label} ({v.count})
                </button>
              );
            })}
          </div>
          <div className={s.filterRight}>
            <button
              type="button"
              className={multiVariety ? s.chipModeOn : s.chipMode}
              aria-pressed={multiVariety}
              onClick={() => setMultiVariety(v => !v)}
            >
              복수 품종
            </button>
          </div>
        </div>
        <div className={s.chipRow}>
          <span className={s.filterLabel}>카테고리</span>
          <div className={s.chipList}>
            <button
              type="button"
              className={!onlyReview && selectedCategories.length === 0 ? s.chipActive : s.chip}
              aria-pressed={!onlyReview && selectedCategories.length === 0}
              onClick={() => { setOnlyReview(false); setSelectedCategories([]); setSelectedProducts([]); }}
            >
              전체 ({draft.rows.length})
            </button>
            {reviewCount > 0 && (
              <button
                type="button"
                className={onlyReview ? s.chipActive : s.chipWarn}
                aria-pressed={onlyReview}
                onClick={() => { setOnlyReview(v => !v); setSelectedProducts([]); }}
              >
                미등록 확인 ({reviewCount})
              </button>
            )}
            {categoryButtons.map(cat => {
              const active = categorySet.has(cat.code);
              return (
                <button
                  key={cat.code}
                  type="button"
                  className={active ? s.chipActive : s.chip}
                  aria-pressed={active}
                  onClick={e => {
                    const additive = multiCategory || e.metaKey || e.ctrlKey || e.shiftKey;
                    setSelectedProducts([]);
                    setSelectedCategories(prev => {
                      if (!additive) return prev.length === 1 && prev[0] === cat.code ? [] : [cat.code];
                      return prev.includes(cat.code) ? prev.filter(x => x !== cat.code) : [...prev, cat.code];
                    });
                  }}
                >
                  {cat.label} ({cat.count})
                </button>
              );
            })}
          </div>
          <div className={s.filterRight}>
            <button
              type="button"
              className={multiCategory ? s.chipModeOn : s.chipMode}
              aria-pressed={multiCategory}
              onClick={() => setMultiCategory(v => !v)}
            >
              복수 선택
            </button>
          </div>
        </div>
        <div className={s.chipRow} role="toolbar" aria-label="중국 품목 원클릭 버튼 필터">
          <span className={s.filterLabel}>품목</span>
          <div className={s.chipList}>
            <button
              type="button"
              className={selectedProducts.length === 0 ? s.chipActive : s.chip}
              aria-pressed={selectedProducts.length === 0}
              onClick={() => setSelectedProducts([])}
            >
              전체 품목 ({productButtons.length})
            </button>
            {visibleProductChips.map(prod => {
              const active = productSet.has(prod.name);
              return (
                <button
                  key={prod.name}
                  type="button"
                  className={active ? s.chipActive : s.chip}
                  aria-pressed={active}
                  onClick={e => {
                    const additive = multiProduct || e.metaKey || e.ctrlKey || e.shiftKey;
                    setSelectedProducts(prev => {
                      if (!additive) return prev.length === 1 && prev[0] === prod.name ? [] : [prod.name];
                      return prev.includes(prod.name) ? prev.filter(x => x !== prod.name) : [...prev, prod.name];
                    });
                  }}
                >
                  {prod.name}{prod.count > 1 ? ` (${prod.count})` : ''}
                </button>
              );
            })}
            {productButtons.length > 24 && (
              <button
                type="button"
                className={s.chipMode}
                onClick={() => setShowAllProducts(v => !v)}
              >
                {showAllProducts ? '품목 접기' : `품목 더보기 (+${productButtons.length - 24})`}
              </button>
            )}
          </div>
          <div className={s.filterRight}>
            <button
              type="button"
              className={multiProduct ? s.chipModeOn : s.chipMode}
              aria-pressed={multiProduct}
              onClick={() => setMultiProduct(v => !v)}
            >
              복수 품목
            </button>
            <input
              type="search"
              aria-label="중국 품명 또는 카테고리 검색"
              className={s.searchInput}
              value={searchQuery}
              placeholder="품명 · 카테고리 검색"
              onChange={e => setSearchQuery(e.target.value)}
            />
            {hasCnFilter && (
              <button
                type="button"
                className={s.secondary}
                onClick={() => { setOnlyReview(false); setSelectedVarieties([]); setSelectedCategories([]); setSelectedProducts([]); setSearchQuery(''); }}
              >
                초기화
              </button>
            )}
          </div>
        </div>
        {hasCnFilter && (
          <div className={s.filterSubtotal}>
            선택 <strong>{visibleRows.length}</strong> / {draft.rows.length}품목 · 수량 <strong>{won(filteredSubtotal.qty)}단</strong> · FOB <strong>{fix(filteredSubtotal.fob, 2)} CNY</strong> · 선택 도착원가 합계 <strong>{won(filteredSubtotal.totalCost)}원</strong>
          </div>
        )}
      </div>

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>No</th><th>품종</th><th>품명</th><th>수량(단)</th><th>FOB(CNY)</th><th>박스당단수</th><th>{isSea ? '단당 CBM' : '단당 CBM(kg)'}</th>
              {!isSea && <th>단당 중량(kg)</th>}<th>관세율(%)</th><th>단당줄기수</th>
              <th>{isSea ? '박스비(단)' : '허가증(단)'}</th><th>운송비(단)</th><th>CNF(단)</th><th>수수료(원)</th><th>관세(원)</th><th>그외통관(단)</th><th>도착원가(단)</th><th>줄기당 원가</th><th>목표마진 판매가</th>
            </tr>
          </thead>
          <tbody>
            {pagedVisibleRows.map(row => {
              const r = resultById.get(row.lineId);
              return (
                <tr key={row.lineId} className={row.needsReview ? s.rowReview : row.edited ? s.rowEdited : undefined}>
                  <td>{row.lineNo}</td>
                  <td>
                    <select aria-label={`${row.name} 카테고리`} value={row.categoryCode} onChange={e => editRow(row.lineId, { categoryCode: e.target.value })} className={s.select}>
                      {categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </td>
                  <td className={s.name}>{row.name}{row.reviewReason && <span className={s.badge}>{row.reviewReason}</span>}{row.memoryApplied && <span className={s.badgeInfo}>기억값</span>}</td>
                  <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} 수량`} value={row.quantity} onChange={e => editRow(row.lineId, { quantity: fromNum(e.target.value) })} /></td>
                  <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} FOB`} value={row.fob} onChange={e => editRow(row.lineId, { fob: fromNum(e.target.value) })} /></td>
                  <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} 박스당단수`} value={row.bunchesPerBox} onChange={e => editRow(row.lineId, { bunchesPerBox: fromNum(e.target.value) })} /></td>
                  <td><input type="number" step="any" min="0" className={s.cellWide} aria-label={`${row.name} 단당 CBM`} value={row.cbmPerBunch} onChange={e => editRow(row.lineId, { cbmPerBunch: fromNum(e.target.value) })} /></td>
                  {!isSea && <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} 단당 중량`} value={row.weightKgPerBunch} onChange={e => editRow(row.lineId, { weightKgPerBunch: fromNum(e.target.value) })} /></td>}
                  <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} 관세율`} value={pct(row.tariffRate)} onChange={e => editRow(row.lineId, { tariffRate: fromPct(e.target.value) })} /></td>
                  <td><input type="number" step="any" min="0" className={s.cell} aria-label={`${row.name} 단당줄기수`} value={row.stemsPerBunch} onChange={e => editRow(row.lineId, { stemsPerBunch: fromNum(e.target.value) })} /></td>
                  <td className={s.num}>{fix(isSea ? r?.boxFee : r?.permit, 4)}</td>
                  <td className={s.num}>{fix(r?.freight, 4)}</td>
                  <td className={s.num}>{fix(r?.cnf, 4)}</td>
                  <td className={s.num}>{won(r?.fee)}</td>
                  <td className={s.num}>{won(r?.duty)}</td>
                  <td className={s.num}>{won(r?.customs)}</td>
                  <td className={s.numStrong}>{won(r?.cost)}</td>
                  <td className={s.num}>{won(r?.costPerStem)}</td>
                  <td className={s.num}>{won(r?.salePrice)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visibleRows.length > rowLimit && (
        <div className={s.moreBar}>
          <span>표시 {pagedVisibleRows.length} / {visibleRows.length}품목</span>
          <button type="button" className={s.secondary} onClick={() => setRowLimit(n => n + 100)}>
            더 보기 (+100건 · 남은 {visibleRows.length - rowLimit}건)
          </button>
        </div>
      )}
      {draft.excluded.length > 0 && (
        <p className={s.sub}>원가 품목에서 제외한 비상품·메타 행 {draft.excluded.length}건: {draft.excluded.map(x => `${x.name}${x.amount ? ` ${Number(x.amount).toLocaleString('ko-KR')}` : ''}`).join(' · ')}</p>
      )}
      <p className={s.sub}>카테고리 기준: 41순위 결정론적 매처 · 프리저브드 25% 최우선 · CLOUD 항공 22종+ / HUBFRESH 해상 34종 규격표 · 판매가 = 도착원가 ÷ (1 − 마진율) × 1.1</p>
    </section>
  );
}
