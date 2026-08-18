// pages/orders/import.js — 이미지/엑셀 업로드 주문등록 (라움 등 거래처 발주표)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit } from '../../lib/orderUtils';
import { scoreMatch, getDisplayName } from '../../lib/displayName';
import { clearImportProductMatchForName } from '../../lib/orderImportMatch';
import { mergeRegisterItems } from '../../lib/orderImportRegister';
import { buildStatementRowsFromImportItems, parentWeekFromFullWeek } from '../../lib/importStatementRows';
import { loadImportDraft, saveImportDraft, clearImportDraft } from '../../lib/orderImportDraft';
import { ESTIMATE_PRINT_FORMAT } from '../../lib/estimatePrintFormats';
import * as XLSX from 'xlsx';
import { initializeShipDateAllocations, moveShipmentQuantity, allocationTotal, buildShipmentListRows } from '../../lib/orderShipmentList';
import { sanitizeExcelSheetName } from '../../lib/estimatePrintPrepare';
import {
  buildEstimatePrintWorkbook,
  buildEstimatePrintWorksheet,
  downloadEstimatePrintWorkbook,
} from '../../lib/estimatePrintExcel';

const DEFAULT_CUST_SEARCH = '라움';
const IMPORT_CUST_STORAGE_KEY = 'nenova_import_last_cust';
const IMPORT_MAPPING_KEY = 'nenova_import_local_mappings';

function loadLocalImportMappings() {
  try { return JSON.parse(localStorage.getItem(IMPORT_MAPPING_KEY) || '{}'); } catch { return {}; }
}

function saveLocalImportMapping(inputName, prod, unit) {
  if (!inputName || !prod?.ProdKey) return;
  try {
    const key = String(inputName).trim().toLowerCase();
    const cache = loadLocalImportMappings();
    cache[key] = {
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
      unit: unit || '',
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(IMPORT_MAPPING_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

async function persistItemMapping(item, prod, { force = true } = {}) {
  if (!item?.inputName || !prod?.ProdKey) return false;
  saveLocalImportMapping(item.inputName, prod, item.unit);
  try {
    await apiPost('/api/orders/mappings', {
      inputToken: item.inputName,
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
      unit: item.unit,
      force,
    });
    if (item.unit) {
      await apiPost('/api/orders/import-units', {
        inputName: item.inputName,
        unit: item.unit,
        source: 'manual',
      });
    }
    return true;
  } catch (e) {
    console.warn('[import] mapping save failed:', e?.message || e);
    return false;
  }
}

function getNearby2026Weeks(range = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const curWeek = Math.min(Math.ceil(dayOfYear / 7), 52);
  const weeks = [];
  for (let w = Math.max(1, curWeek - range); w <= curWeek + range; w += 1) {
    for (let s = 1; s <= 3; s += 1) {
      weeks.push(`${year}-${String(w).padStart(2, '0')}-${String(s).padStart(2, '0')}`);
    }
  }
  return weeks;
}

function unitSourceLabel(source) {
  if (source === 'upload') return '엑셀열';
  if (source === 'catalog') return '엑셀학습';
  if (source === 'inferred') return '품목추론';
  if (source === 'mapping') return '저장매핑';
  if (source === 'manual') return '수동';
  if (source === 'product') return '품목설정';
  if (source === 'history') return '주문이력';
  return '';
}

const st = {
  page: { maxWidth: 1100, margin: '0 auto', padding: '16px 20px 120px' },
  card: { background: '#fff', border: '1px solid #dbe3ef', borderRadius: 8, padding: 16, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 4 },
  sub: { fontSize: 12, color: '#64748b', marginBottom: 12 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  label: { fontSize: 12, fontWeight: 600, color: '#475569', minWidth: 56 },
  input: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 },
  btn: { padding: '8px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnPrimary: { background: '#1565c0', color: '#fff' },
  btnSecondary: { background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1' },
  drop: { border: '2px dashed #94a3b8', borderRadius: 8, padding: 24, textAlign: 'center', background: '#f8fafc', cursor: 'pointer' },
  dropActive: { borderColor: '#1565c0', background: '#eff6ff' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '8px 6px', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', fontWeight: 700 },
  td: { padding: '7px 6px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' },
  badgeOk: { background: '#dcfce7', color: '#166534', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  badgeWarn: { background: '#ffedd5', color: '#c2410c', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  badgeErr: { background: '#fee2e2', color: '#b91c1c', padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700 },
  suggestRow: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  suggestBtn: { fontSize: 10, padding: '3px 6px', borderRadius: 4, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', textAlign: 'left' },
  searchWrap: { position: 'relative', minWidth: 220 },
  dropdown: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, maxHeight: 180, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' },
  pickRow: { display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 'none', background: '#fff', cursor: 'pointer', fontSize: 11 },
  editBtn: { fontSize: 11, padding: '2px 8px', marginTop: 4, border: '1px solid #1565c0', borderRadius: 4, background: '#e3f2fd', color: '#0d47a1', cursor: 'pointer' },
  clearBtn: { fontSize: 11, padding: '2px 8px', marginTop: 4, marginLeft: 4, border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', color: '#64748b', cursor: 'pointer' },
  kpi: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  kpiBox: { padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 },
};

function CustomerSearchSelect({ value, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [label, setLabel] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!value) { setLabel(''); return; }
    (async () => {
      try {
        const d = await apiGet('/api/customers/search', { q: String(value) });
        const hit = (d.customers || []).find(c => String(c.CustKey) === String(value));
        if (hit) setLabel(hit.CustName);
      } catch { /* ignore */ }
    })();
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setRemote([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await apiGet('/api/customers/search', { q: query.trim() });
        setRemote(d.customers || []);
      } catch {
        setRemote([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  return (
    <div ref={wrapRef} style={st.searchWrap}>
      <input
        style={{ ...st.input, width: '100%', minWidth: 200, boxSizing: 'border-box' }}
        value={open ? query : (label || query)}
        placeholder={placeholder || '거래처 검색 (라움)'}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange(null); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div style={st.dropdown}>
          {loading && <div style={{ padding: 8, fontSize: 11, color: '#64748b' }}>검색 중…</div>}
          {!loading && query.trim() && remote.length === 0 && (
            <div style={{ padding: 8, fontSize: 11, color: '#64748b' }}>검색 결과 없음</div>
          )}
          {remote.map(c => (
            <button
              key={c.CustKey}
              type="button"
              style={st.pickRow}
              onMouseDown={() => {
                onChange({ CustKey: c.CustKey, CustName: c.CustName });
                setLabel(c.CustName);
                setQuery('');
                setOpen(false);
              }}
            >
              {c.CustName}{c.OrderCode ? ` (${c.OrderCode})` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductPicker({ row, allProducts, onPick, onPersistMapping, compact = false }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const matchQuery = row.matchName || row.inputName;
  const defaultSuggestions = useMemo(() => {
    if ((row.suggestedProducts || []).length > 0) return row.suggestedProducts;
    if (!row.inputName) return [];
    return allProducts
      .map(p => ({ prod: p, score: scoreMatch(matchQuery, p, '') }))
      .filter(x => x.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(x => ({
        prodKey: x.prod.ProdKey,
        prodName: x.prod.ProdName,
        displayName: x.prod.DisplayName || x.prod.ProdName,
        flowerName: x.prod.FlowerName,
        counName: x.prod.CounName,
        outUnit: x.prod.OutUnit,
        score: x.score,
      }));
  }, [row.suggestedProducts, matchQuery, allProducts]);

  const searchHits = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return allProducts
      .map(p => ({ prod: p, score: scoreMatch(matchQuery, p, search) }))
      .filter(x => x.score >= 30 || getDisplayName(x.prod).toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [search, allProducts, matchQuery]);

  const pick = async (prod) => {
    const saved = onPersistMapping ? await onPersistMapping(row, prod) : true;
    onPick(prod);
    setOpen(false);
    setSearch('');
    if (!saved) {
      alert('현재 화면의 품목은 변경했지만 저장매핑 반영에 실패했습니다. 다시 업로드하기 전에 품목을 다시 선택해 주세요.');
    }
  };

  return (
    <div ref={wrapRef}>
      {defaultSuggestions.length > 0 && (
        <div style={st.suggestRow}>
          {defaultSuggestions.map(s => (
            <button
              key={s.prodKey}
              type="button"
              style={st.suggestBtn}
              title={`${s.score}%`}
              onClick={() => void pick({
                ProdKey: s.prodKey,
                ProdName: s.prodName,
                DisplayName: s.displayName,
                FlowerName: s.flowerName,
                CounName: s.counName,
                OutUnit: s.outUnit,
              })}
            >
              ★ {s.score}% {s.displayName || s.prodName}
            </button>
          ))}
        </div>
      )}
      <div style={{ marginTop: compact ? 4 : 6, position: 'relative' }}>
        <input
          style={{ ...st.input, width: '100%', boxSizing: 'border-box' }}
          placeholder="품목 검색 (한글·영문)…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {open && search.trim() && searchHits.length > 0 && (
          <div style={st.dropdown}>
            {searchHits.map(({ prod, score }) => (
              <button key={prod.ProdKey} type="button" style={st.pickRow} onMouseDown={() => void pick(prod)}>
                {score}% · {getDisplayName(prod)} · {prod.CounName || ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductMatchCell({ row, idx, allProducts, editing, onToggleEdit, onPick, onClear, onPersistMapping }) {
  const hasMatch = !!row.prodKey;

  return (
    <div>
      {hasMatch && (
        <div style={{ marginBottom: editing ? 8 : 0 }}>
          <div style={{ fontWeight: 600, color: '#1e40af' }}>{row.displayName || row.prodName}</div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{row.counName} · {row.flowerName}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            <button type="button" style={st.editBtn} onClick={onToggleEdit}>
              {editing ? '닫기' : '✎ 품목 변경'}
            </button>
            {editing && (
              <button type="button" style={st.clearBtn} onClick={onClear}>매칭 해제</button>
            )}
          </div>
        </div>
      )}
      {(!hasMatch || editing) && (
        <ProductPicker
          row={row}
          allProducts={allProducts}
          onPick={onPick}
          onPersistMapping={onPersistMapping}
          compact={hasMatch}
        />
      )}
    </div>
  );
}

export default function OrderImportPage() {
  const [week, setWeek] = useState(getCurrentWeek());
  const [weeks, setWeeks] = useState([]);
  const [showOldWeeks, setShowOldWeeks] = useState(false);
  const [cust, setCust] = useState(null);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [fileName, setFileName] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [statementLoading, setStatementLoading] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [defaultShipDates, setDefaultShipDates] = useState({ 1: '', 2: '' });
  const [shipmentRows, setShipmentRows] = useState([]);
  const [shipmentSource, setShipmentSource] = useState('upload');
  const [targetShipDate, setTargetShipDate] = useState('');
  const [moveQty, setMoveQty] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const [allProducts, setAllProducts] = useState([]);
  const [editProdIdx, setEditProdIdx] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    const draft = loadImportDraft();
    if (!draft?.items?.length) return;
    setItems(draft.items);
    setSummary(draft.summary || null);
    setLogs(draft.logs || []);
    setFileName(draft.fileName || '');
    setSourceType(draft.sourceType || '');
    if (draft.week) setWeek(draft.week);
    if (draft.cust?.CustKey) setCust(draft.cust);
    setResultMsg(`💾 이전 매칭 ${draft.items.length}건 복원 (${draft.fileName || '업로드'})`);
  }, []);

  const loadDefaultCust = useCallback(async () => {
    const cd = await apiGet('/api/customers/search', { q: DEFAULT_CUST_SEARCH });
    const raum = (cd.customers || []).find(c => /라움/i.test(c.CustName));
    if (raum) return { CustKey: raum.CustKey, CustName: raum.CustName };
    return null;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const d = await apiGet('/api/products/search');
        setAllProducts(d.products || []);

        let nextCust = null;
        try {
          const saved = localStorage.getItem(IMPORT_CUST_STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.CustKey && parsed?.CustName) nextCust = parsed;
          }
        } catch { /* ignore */ }
        if (!nextCust) nextCust = await loadDefaultCust();
        if (nextCust) setCust(nextCust);
      } catch { /* ignore */ }
    })();
  }, [loadDefaultCust]);

  useEffect(() => {
    if (cust?.CustKey) {
      try {
        localStorage.setItem(IMPORT_CUST_STORAGE_KEY, JSON.stringify(cust));
      } catch { /* ignore */ }
    }
  }, [cust]);

  useEffect(() => {
    if (!items.length) return undefined;
    const timer = setTimeout(() => {
      saveImportDraft({
        items,
        summary,
        logs,
        fileName,
        sourceType,
        week,
        cust,
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [items, summary, logs, fileName, sourceType, week, cust]);

  useEffect(() => {
    apiGet('/api/orders/weeks').then((d) => {
      if (!d.success) return;
      const def = getCurrentWeek();
      const nearby = getNearby2026Weeks(4);
      const dbWeeks = (d.weeks || []).filter(w => !nearby.includes(w));
      setWeeks([...nearby, ...dbWeeks]);
      setWeek(def);
    }).catch(() => {
      setWeeks(getNearby2026Weeks(4));
    });
  }, []);

  const openTemplateWindow = useCallback(() => {
    const suffix = week ? `?week=${encodeURIComponent(week)}&popup=1` : '?popup=1';
    const popup = window.open(
      `/orders/paste-template${suffix}`,
      'pasteOrderTemplatePopup',
      'width=1440,height=920,left=30,top=20,resizable=yes,scrollbars=yes',
    );
    if (!popup) window.location.href = `/orders/paste-template${suffix}`;
  }, [week]);

  const handleStatementExcel = useCallback(async () => {
    if (!cust?.CustKey) {
      alert('거래처를 선택하세요.');
      return;
    }
    if (!week) {
      alert('차수를 선택하세요.');
      return;
    }

    const pw = parentWeekFromFullWeek(week);
    const printDate = new Date().toISOString().slice(0, 10);
    const weekLabel = pw || week;
    setStatementLoading(true);

    try {
      const gridRows = buildStatementRowsFromImportItems(
        mergeRegisterItems(items.filter(it => !it.skip && it.prodKey && Number(it.qty) > 0)),
        allProducts,
      );

      let rows = gridRows;
      let sourceLabel = '업로드 화면';

      if (!rows.length) {
        const d = await apiGet('/api/estimate/order-statement-rows', {
          custKey: cust.CustKey,
          orderYear: week.match(/^(\d{4})-/)?.[1] || '',
          parentWeek: pw,
          week: pw,
        });
        if (!d.success) throw new Error(d.error || '조회 실패');
        rows = d.rows || [];
        sourceLabel = '주문등록(DB)';
      }

      if (!rows.length) {
        alert('거래명세표로 내려받을 품목이 없습니다.\n업로드 후 매칭하거나, 해당 차수에 주문을 등록했는지 확인하세요.');
        return;
      }

      const sheetName = sanitizeExcelSheetName(cust.CustName);
      const wb = buildEstimatePrintWorkbook([{
        name: sheetName,
        worksheet: buildEstimatePrintWorksheet({
          custName: cust.CustName,
          week: `${weekLabel}차`,
          printDate,
          serialNo: '',
          printFormat: ESTIMATE_PRINT_FORMAT.STATEMENT,
          rows,
          showBoxQty: false,
          showDistribDesc: false,
          showDeductionOutDay: false,
          bigoLabel: `${weekLabel}차 종합거래명세표 (${sourceLabel})`,
        }),
      }]);

      downloadEstimatePrintWorkbook(
        wb,
        `거래명세표_${cust.CustName}_${weekLabel}차.xlsx`,
      );
    } catch (e) {
      alert(e.message || '거래명세표 다운로드 실패');
    } finally {
      setStatementLoading(false);
    }
  }, [allProducts, cust, items, week]);

  const resetDefaultCust = async () => {
    try {
      const next = await loadDefaultCust();
      if (next) setCust(next);
      else alert(`「${DEFAULT_CUST_SEARCH}」 거래처를 찾을 수 없습니다.`);
    } catch (e) {
      alert(e.message);
    }
  };

  const isDefaultCust = !!cust?.CustName && /라움/i.test(cust.CustName);

  const uploadFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    setResultMsg('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/orders/import-parse', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      const d = await res.json();
      if (!d.success) {
        const detail = (d.logs || []).slice(-4).join('\n');
        throw new Error(detail ? `${d.error || '파싱 실패'}\n\n${detail}` : (d.error || '파싱 실패'));
      }
      setItems(d.items || []);
      setSummary(d.summary || null);
      setLogs(d.logs || []);
      setFileName(d.fileName || file.name);
      setSourceType(d.sourceType || '');
      const meta = d.metadata || {};
      if (meta.majorWeek) {
        const year = new Date().getFullYear();
        setWeek(`${year}-${meta.majorWeek}-01`);
      }
      if (d.matchedCustomer?.CustKey) {
        setCust({ CustKey:d.matchedCustomer.CustKey, CustName:d.matchedCustomer.CustName });
        setResultMsg(`✅ 업체 자동매칭: ${d.matchedCustomer.CustName}${d.matchedCustomer.fromMapping ? ' (저장 매핑)' : ''}`);
      } else if (meta.customerName) {
        try {
          const found = await apiGet('/api/customers/search', { q: meta.customerName });
          const exact = (found.customers || []).find(c => String(c.CustName).replace(/\s/g, '') === String(meta.customerName).replace(/\s/g, ''));
          if (exact) setCust({ CustKey: exact.CustKey, CustName: exact.CustName });
          else setResultMsg(`⚠ 업체 자동매칭 실패: ${meta.customerName} — 업체를 직접 선택하세요.`);
        } catch { /* 사용자가 직접 선택 */ }
      }
      setEditProdIdx(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const prepareShipmentList = async () => {
    let sourceItems = items;
    if (shipmentSource !== 'upload') {
      if (!cust?.CustKey || !week) { alert('업체와 차수를 선택하세요.'); return; }
      try {
        const d = await apiGet('/api/orders/shipment-list-source', {
          source: shipmentSource, custKey:cust.CustKey,
          year:String(week).match(/^(\d{4})-/)?.[1] || new Date().getFullYear(), week,
        });
        sourceItems = (d.rows || []).map((r,i)=>({ rowNo:i+1,prodKey:r.ProdKey,prodName:r.ProdName,displayName:r.DisplayName,
          flowerName:r.FlowerName,counName:r.CounName,unit:normalizeOrderUnit(r.OutUnit),qty:Number(r.qty),unitPrice:Number(r.unitPrice||0) }));
      } catch (e) { alert(e.message); return; }
    }
    const rows = initializeShipDateAllocations(sourceItems, week, defaultShipDates);
    if (!rows.length) { alert('먼저 품목을 업로드하고 매칭하세요.'); return; }
    const no = Number(String(week).slice(-2));
    if (!defaultShipDates[no]) { alert(`${no}차 기본출고일을 먼저 설정하세요.`); return; }
    setShipmentRows(rows);
  };

  const moveRowDate = (idx, fromDate) => {
    try {
      setShipmentRows(prev => prev.map((row, i) => i === idx
        ? moveShipmentQuantity(row, fromDate, targetShipDate, moveQty[idx] || 1)
        : row));
    } catch (e) { alert(e.message); }
  };

  const downloadShipmentList = () => {
    const flat = buildShipmentListRows(shipmentRows);
    if (!flat.length || !cust?.CustName) { alert('생성할 출고내역이 없습니다.'); return; }
    const grouped = new Map();
    flat.sort((a,b) => a.shipDate.localeCompare(b.shipDate)).forEach(row => {
      const date = row.shipDate; const flower = row.flowerName || '기타';
      if (!grouped.has(date)) grouped.set(date, new Map());
      if (!grouped.get(date).has(flower)) grouped.get(date).set(flower, []);
      grouped.get(date).get(flower).push(row);
    });
    const aoa = [[`${cust.CustName} ${String(week).match(/-(\d{2})-/)?.[1] || ''}차 예상 출고리스트`], [], ['품 명','칼 라','주문수량','출고수량','단가','비 고']];
    const merges = [{s:{r:0,c:0},e:{r:0,c:5}}];
    for (const [date, flowers] of grouped) {
      const dateStart = aoa.length;
      for (const [flower, group] of flowers) {
        const flowerStart = aoa.length;
        group.forEach((row, idx) => aoa.push([idx ? '' : flower, row.color || row.displayName || row.prodName, row.totalQty, row.shipQty, row.unitPrice || '', '']));
        if (group.length > 1) merges.push({s:{r:flowerStart,c:0},e:{r:aoa.length-1,c:0}});
        aoa.push(['', '합계', group.reduce((s,r)=>s+r.totalQty,0), group.reduce((s,r)=>s+r.shipQty,0), '', '']);
      }
      const dateEnd = aoa.length - 1;
      const day = ['일','월','화','수','목','금','토'][new Date(`${date}T00:00:00`).getDay()];
      aoa[dateStart][5] = `${date} ${day}요일 출고`;
      if (dateEnd > dateStart) merges.push({s:{r:dateStart,c:5},e:{r:dateEnd,c:5}});
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{wch:20},{wch:38},{wch:12},{wch:12},{wch:12},{wch:20}];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${cust.CustName}_${week}_출고리스트.xlsx`);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) uploadFile(file);
  };

  const updateItem = (idx, patch) => {
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handlePersistMapping = useCallback((row, prod) => {
    return persistItemMapping(row, prod, { force: true });
  }, []);

  const pickProduct = (idx, prod) => {
    const current = items[idx];
    const nextRow = {
      ...current,
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
      unit: current?.unit || normalizeOrderUnit(prod.OutUnit || '박스'),
      fromMapping: false,
      mappingMatchType: 'manual',
      confidence: 1,
      confidenceLabel: 'high',
    };
    updateItem(idx, {
      prodKey: nextRow.prodKey,
      prodName: nextRow.prodName,
      displayName: nextRow.displayName,
      flowerName: nextRow.flowerName,
      counName: nextRow.counName,
      unit: nextRow.unit,
      fromMapping: false,
      mappingMatchType: 'manual',
      confidence: 1,
      confidenceLabel: 'high',
    });
    setEditProdIdx(null);
  };

  const clearProduct = (idx) => {
    updateItem(idx, {
      prodKey: null,
      prodName: null,
      displayName: null,
      flowerName: null,
      counName: null,
      fromMapping: false,
      mappingMatchType: null,
      confidence: 0,
      confidenceLabel: 'none',
    });
    setEditProdIdx(idx);
  };

  const changeUnit = async (idx, unit) => {
    const row = items[idx];
    updateItem(idx, { unit, unitSource: 'manual', unitMatchType: 'manual' });
    if (row?.inputName) {
      try {
        await apiPost('/api/orders/import-units', {
          inputName: row.inputName,
          unit,
          source: 'manual',
        });
      } catch { /* ignore */ }
    }
  };

  const handleRegister = async () => {
    if (!cust?.CustKey) { alert('거래처를 선택하세요.'); return; }
    if (!week) { alert('차수를 입력하세요.'); return; }
    const registerItems = mergeRegisterItems(items.filter(it => !it.skip && it.prodKey && Number(it.qty) > 0));
    if (!registerItems.length) { alert('등록할 매칭 품목이 없습니다. (수량 0·미매칭·제외 행 확인)'); return; }

    const yearFromWeek = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());
    if (!confirm(`${cust.CustName} / ${formatWeekDisplay(week)}\n${registerItems.length}개 품목 주문등록 (delta 추가)?`)) return;

    setRegistering(true);
    setResultMsg('');
    try {
      const d = await apiPost('/api/orders', {
        custKey: cust.CustKey,
        week,
        year: yearFromWeek,
        items: registerItems.map(it => ({
          prodKey: it.prodKey,
          prodName: it.prodName,
          qty: it.qty,
          unit: it.unit,
        })),
        delta: true,
        source: 'import',
      });
      if (!d.success) throw new Error(d.error || '저장 실패');
      const okCount = d.results?.filter(r => ['OK', 'UPDATED', 'ADDED', 'DELETED'].includes(r.status)).length ?? registerItems.length;
      setResultMsg(`✅ ${okCount}개 저장 완료 — OrderKey ${d.orderMasterKey}${d.warning ? ` / ⚠ ${d.warning}` : ''}`);
      clearImportDraft();
    } catch (e) {
      setResultMsg(`❌ ${e.message}`);
    } finally {
      setRegistering(false);
    }
  };

  const liveSummary = useMemo(() => {
    const active = items.filter(it => !it.skip);
    return {
      total: items.length,
      matched: active.filter(it => it.prodKey).length,
      registerable: active.filter(it => it.prodKey && Number(it.qty) > 0).length,
      unmatched: active.filter(it => !it.prodKey).length,
    };
  }, [items]);

  const newWeeks = weeks.filter(w => w.match(/^\d{4}-/));
  const oldWeeks = weeks.filter(w => !w.match(/^\d{4}-/));

  return (
    <>
      <div style={st.page}>
        <div style={st.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={st.title}>📤 이미지 / 엑셀 업로드 주문등록</div>
            <button
              type="button"
              onClick={openTemplateWindow}
              style={{
                padding: '8px 18px',
                background: '#5e35b1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(94,53,177,0.25)',
              }}
              title="새 창에서 원본 차수 주문 불러오기, 즐겨찾기 저장/수정, 등록대상 차수 주문등록"
            >
              주문즐겨찾기
            </button>
            <button
              type="button"
              onClick={handleStatementExcel}
              disabled={statementLoading || !cust?.CustKey}
              style={{
                ...st.btn,
                background: '#00897b',
                color: '#fff',
                opacity: statementLoading || !cust?.CustKey ? 0.55 : 1,
              }}
              title="업로드 화면 품목 또는 등록된 주문(ViewOrder) 기준 거래명세표 Excel"
            >
              {statementLoading ? '다운로드 중…' : '📥 거래명세표 Excel'}
            </button>
          </div>
          <div style={st.sub}>
            발주표(카톡 이미지·엑셀)를 먼저 업로드하면 제목의 <b>업체·차수</b>와 품목·단위를 자동매칭합니다.
            업로드 후 <b>업체·차수·수량·단위·품목</b>은 모두 수정할 수 있습니다.
          </div>

          <div
            style={{ ...st.drop, ...(dragOver ? st.dropActive : {}) }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const selected = e.target.files?.[0];
                e.target.value = '';
                uploadFile(selected);
              }}
            />
            {loading ? (
              <div style={{ color: '#1565c0', fontWeight: 600 }}>파싱·매칭 중…</div>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>1. 파일을 드래그하거나 클릭하여 업로드</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>xlsx · xls · csv · png · jpg · webp</div>
                {fileName && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                    최근: {fileName} ({sourceType === 'image' ? '이미지 OCR' : '엑셀'})
                  </div>
                )}
              </>
            )}
          </div>

          {items.length > 0 && <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#1a237e', marginBottom: 10 }}>2. 자동 매칭 결과 확인</div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ ...st.label, display: 'block', marginBottom: 6 }}>
              거래처
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                기본 라움 · 검색으로 변경
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <CustomerSearchSelect value={cust?.CustKey || ''} onChange={setCust} />
              {isDefaultCust && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#1a237e', background: '#e8eaf6', padding: '4px 10px', borderRadius: 10 }}>
                  기본: 라움
                </span>
              )}
              {!isDefaultCust && cust?.CustName && (
                <button
                  type="button"
                  onClick={resetDefaultCust}
                  style={{ ...st.btn, ...st.btnSecondary, fontSize: 11, padding: '5px 10px' }}
                >
                  ↺ 라움으로
                </button>
              )}
              {cust?.CustName && (
                <span style={{ fontSize: 12, color: '#334155', fontWeight: 600 }}>
                  선택: {cust.CustName}
                </span>
              )}
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ ...st.label, display: 'block', marginBottom: 6 }}>
              등록 차수
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                주변 차수 선택 · 직접 입력 가능
              </span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#1a237e', fontWeight: 700, background: '#e8eaf6', padding: '2px 8px', borderRadius: 10 }}>2026</span>
              {newWeeks.map(w => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeek(w)}
                  style={{
                    padding: '5px 22px',
                    borderRadius: 20,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: week === w ? '2px solid #1a237e' : '1px solid #c5cae9',
                    background: week === w ? '#1a237e' : '#f3f4ff',
                    color: week === w ? '#fff' : '#1a237e',
                    fontWeight: week === w ? 700 : 500,
                  }}
                >
                  {formatWeekDisplay(w)}
                </button>
              ))}
            </div>
            {oldWeeks.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowOldWeeks(v => !v)}
                  style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #ddd', borderRadius: 10, padding: '2px 10px', cursor: 'pointer', marginBottom: 4 }}
                >
                  {showOldWeeks ? '▲' : '▼'} 이전 차수 (25년도) {oldWeeks.length}개
                </button>
                {showOldWeeks && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                    {oldWeeks.map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWeek(w)}
                        style={{
                          padding: '4px 11px',
                          borderRadius: 20,
                          fontSize: 12,
                          cursor: 'pointer',
                          border: week === w ? '2px solid #888' : '1px solid #ddd',
                          background: week === w ? '#666' : '#f9f9f9',
                          color: week === w ? '#fff' : '#888',
                        }}
                      >
                        {formatWeekDisplay(w)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input style={st.input} value={week} onChange={(e) => setWeek(e.target.value)} placeholder="2026-28-01" />
              {week && (
                <span style={{ fontSize: 12, color: '#1a237e', fontWeight: 600 }}>
                  선택: {formatWeekDisplay(week)}
                </span>
              )}
            </div>
          </div>

          <div style={{ ...st.row, padding: 10, background: '#f8fafc', border: '1px solid #dbe3ef', borderRadius: 7 }}>
            <strong style={{ fontSize: 12 }}>세부차수 기본출고일</strong>
            <label style={{ fontSize: 12 }}>1차 <input type="date" style={st.input} value={defaultShipDates[1]} onChange={e=>setDefaultShipDates(v=>({...v,1:e.target.value}))}/></label>
            <label style={{ fontSize: 12 }}>2차 <input type="date" style={st.input} value={defaultShipDates[2]} onChange={e=>setDefaultShipDates(v=>({...v,2:e.target.value}))}/></label>
            <span style={{fontSize:11,color:'#64748b'}}>매칭 수량은 선택 세부차수의 기본출고일에 전량 배정됩니다.</span>
          </div>
          </div>}

          {(summary || items.length > 0) && (
            <div style={st.kpi}>
              <div style={st.kpiBox}>전체 <b>{liveSummary.total}</b></div>
              <div style={st.kpiBox}>매칭 <b style={{ color: '#166534' }}>{liveSummary.matched}</b></div>
              <div style={st.kpiBox}>미매칭 <b style={{ color: liveSummary.unmatched ? '#c2410c' : '#166534' }}>{liveSummary.unmatched}</b></div>
            </div>
          )}

          {resultMsg && (
            <div style={{ padding: 10, marginBottom: 10, borderRadius: 6, background: resultMsg.startsWith('✅') ? '#ecfdf5' : '#fef2f2', fontSize: 13 }}>
              {resultMsg}
            </div>
          )}

          {logs.length > 0 && (
            <details style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
              <summary>파싱 로그 ({logs.length})</summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {logs.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </details>
          )}
        </div>

        <div style={{ ...st.card, border: '2px solid #00897b' }}>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:10}}>
            <strong>📥 출고리스트 엑셀 만들기</strong>
            <select style={st.input} value={shipmentSource} onChange={e=>setShipmentSource(e.target.value)}>
              <option value="upload">업로드 매칭 기준</option><option value="order">선택 차수 주문등록 기준</option><option value="shipment">선택 차수 분배 기준</option>
            </select>
            <button type="button" style={{...st.btn,...st.btnPrimary}} onClick={prepareShipmentList}>수량 불러오기</button>
            <input type="date" style={st.input} value={targetShipDate} onChange={e=>setTargetShipDate(e.target.value)} title="이동할 출고일"/>
            <button type="button" style={{...st.btn,background:'#00897b',color:'#fff'}} disabled={!shipmentRows.length} onClick={downloadShipmentList}>엑셀 다운로드</button>
          </div>
          <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>모든 수량은 기본출고일에 먼저 배정됩니다. 다른 날짜로 보낼 수량만 선택해 이동하세요.</div>
          {shipmentRows.map((row,idx)=><div key={`${row.prodKey}-${idx}`} style={{display:'grid',gridTemplateColumns:'minmax(240px,1fr) 1fr',gap:8,padding:'6px 0',borderBottom:'1px solid #eef2f7',fontSize:12}}>
            <div><b>{row.displayName || row.prodName}</b> · 총 {row.totalQty}{row.unit} <span style={{color:allocationTotal(row)===row.totalQty?'#166534':'#b91c1c'}}>배정 {allocationTotal(row)}</span></div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
              {Object.entries(row.allocations || {}).map(([date,qty])=><span key={date} style={{display:'inline-flex',alignItems:'center',gap:4}}>
                {date} <b>{qty}</b>
                <input type="number" min="0.001" max={qty} step="0.001" style={{...st.input,width:72}} value={moveQty[idx] ?? 1} onChange={e=>setMoveQty(v=>({...v,[idx]:e.target.value}))}/>
                <button type="button" style={{...st.btn,...st.btnSecondary,padding:'4px 7px'}} disabled={!targetShipDate || targetShipDate===date} onClick={()=>moveRowDate(idx,date)}>선택일로 보내기</button>
              </span>)}
            </div>
          </div>)}
        </div>

        {items.length > 0 && (
          <div style={st.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <strong style={{ fontSize: 14 }}>품목 매칭 결과</strong>
              <button
                type="button"
                style={{ ...st.btn, ...st.btnPrimary, opacity: liveSummary.unmatched || registering ? 0.6 : 1 }}
                disabled={!!liveSummary.unmatched || registering}
                onClick={handleRegister}
                title={liveSummary.unmatched ? '미매칭 품목을 먼저 지정하세요' : ''}
              >
                {registering ? '등록 중…' : `주문등록 (${liveSummary.registerable}품목)`}
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={st.table}>
                <thead>
                  <tr>
                    <th style={st.th}>#</th>
                    <th style={st.th}>입력 품목 / 품종·세부정보</th>
                    <th style={st.th}>수량</th>
                    <th style={st.th}>단위</th>
                    <th style={st.th}>매칭 품목</th>
                    <th style={st.th}>상태</th>
                    <th style={st.th}>제외</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={`${row.rowNo}-${row.inputName}`} style={{ background: row.skip ? '#f8fafc' : row.prodKey ? '#fff' : '#fffbeb' }}>
                      <td style={st.td}>{row.rowNo}</td>
                      <td style={st.td}>
                        <input
                          type="text"
                          style={{ ...st.input, width: '100%', minWidth: 120, boxSizing: 'border-box', fontWeight: 600 }}
                          value={row.inputName}
                          onChange={(e) => {
                            updateItem(idx, clearImportProductMatchForName(row, e.target.value));
                            setEditProdIdx(idx);
                          }}
                          title="발주표 품목명 (수정 가능)"
                        />
                        {Array.isArray(row.detailLabels) && row.detailLabels.length > 0 && (
                          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {row.detailLabels.map(label => (
                              <span key={label} style={{ fontSize: 10, color: '#475569', background: '#eef2f7', padding: '2px 6px', borderRadius: 8 }}>
                                품종·세부: {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={st.td}>
                        <input
                          type="number"
                          min={0}
                          style={{ ...st.input, width: 88 }}
                          value={row.qty}
                          onChange={(e) => {
                            const v = e.target.value;
                            updateItem(idx, { qty: v === '' ? '' : Math.max(0, Number(v) || 0) });
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '' || Number(e.target.value) <= 0) {
                              updateItem(idx, { qty: 0 });
                            }
                          }}
                        />
                      </td>
                      <td style={st.td}>
                        <select
                          style={st.input}
                          value={row.unit || '박스'}
                          onChange={(e) => changeUnit(idx, e.target.value)}
                        >
                          {['박스', '단', '송이'].map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                        {row.unitSource && (
                          <div style={{ fontSize: 10, color: '#0369a1', marginTop: 2 }}>
                            {unitSourceLabel(row.unitSource)}
                            {row.unitMatchType === 'fuzzy' ? ' (유사)' : ''}
                          </div>
                        )}
                        {row.rawUnit && row.rawUnit !== row.unit && (
                          <div style={{ fontSize: 10, color: '#94a3b8' }}>원본: {row.rawUnit}</div>
                        )}
                      </td>
                      <td style={st.td}>
                        <ProductMatchCell
                          row={row}
                          idx={idx}
                          allProducts={allProducts}
                          editing={editProdIdx === idx}
                          onToggleEdit={() => setEditProdIdx(editProdIdx === idx ? null : idx)}
                          onPick={(p) => pickProduct(idx, p)}
                          onClear={() => clearProduct(idx)}
                          onPersistMapping={handlePersistMapping}
                        />
                      </td>
                      <td style={st.td}>
                        {row.skip ? <span style={st.badgeErr}>제외</span>
                          : !row.prodKey ? <span style={st.badgeWarn}>미매칭</span>
                            : Number(row.qty) <= 0 ? <span style={st.badgeWarn}>수량0</span>
                              : row.fromMapping ? <span style={st.badgeOk}>저장매칭</span>
                                : row.mappingMatchType === 'manual' ? <span style={st.badgeOk}>수동</span>
                                  : row.confidenceLabel === 'high' ? <span style={st.badgeOk}>자동</span>
                                    : <span style={st.badgeOk}>자동</span>}
                      </td>
                      <td style={st.td}>
                        <input type="checkbox" checked={!!row.skip} onChange={(e) => updateItem(idx, { skip: e.target.checked })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </>
  );
}
