// pages/orders/import.js — 이미지/엑셀 업로드 주문등록 (라움 등 거래처 발주표)

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Layout 은 _app.js 가 전역 래핑 — 페이지 자체 래핑 금지(이중 사이드바 원인)
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit } from '../../lib/orderUtils';
import { scoreMatch, getDisplayName } from '../../lib/displayName';
import { mergeRegisterItems } from '../../lib/orderImportRegister';
import { buildStatementRowsFromImportItems, parentWeekFromFullWeek } from '../../lib/importStatementRows';
import { loadImportDraft, saveImportDraft, clearImportDraft } from '../../lib/orderImportDraft';
import { ESTIMATE_PRINT_FORMAT } from '../../lib/estimatePrintFormats';
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
  if (!item?.inputName || !prod?.ProdKey) return;
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
  } catch (e) {
    console.warn('[import] mapping save failed:', e?.message || e);
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

  const defaultSuggestions = useMemo(() => {
    if ((row.suggestedProducts || []).length > 0) return row.suggestedProducts;
    if (!row.inputName) return [];
    return allProducts
      .map(p => ({ prod: p, score: scoreMatch(row.inputName, p, '') }))
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
  }, [row.suggestedProducts, row.inputName, allProducts]);

  const searchHits = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return allProducts
      .map(p => ({ prod: p, score: scoreMatch(row.inputName, p, search) }))
      .filter(x => x.score >= 30 || getDisplayName(x.prod).toLowerCase().includes(q))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [search, allProducts, row.inputName]);

  const pick = (prod) => {
    if (onPersistMapping) onPersistMapping(row, prod);
    onPick(prod);
    setOpen(false);
    setSearch('');
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
              onClick={() => pick({
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
              <button key={prod.ProdKey} type="button" style={st.pickRow} onMouseDown={() => pick(prod)}>
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
      setEditProdIdx(null);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

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
    persistItemMapping(row, prod, { force: true });
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
            기본 거래처 <b>라움</b> · 발주표(카톡 이미지·엑셀) 업로드 후 품목·단위 자동매칭·주문등록.
            업로드 후 <b>수량·단위·품목 매칭</b>은 모두 수정 가능 (자동매칭 품목도 「품목 변경」).
          </div>

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
              onChange={(e) => uploadFile(e.target.files?.[0])}
            />
            {loading ? (
              <div style={{ color: '#1565c0', fontWeight: 600 }}>파싱·매칭 중…</div>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>파일을 드래그하거나 클릭하여 업로드</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>xlsx · xls · csv · png · jpg · webp</div>
                {fileName && (
                  <div style={{ marginTop: 10, fontSize: 12, color: '#334155' }}>
                    최근: {fileName} ({sourceType === 'image' ? '이미지 OCR' : '엑셀'})
                  </div>
                )}
              </>
            )}
          </div>

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
                    <th style={st.th}>입력 품목</th>
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
                          onChange={(e) => updateItem(idx, { inputName: e.target.value.trim() })}
                          title="발주표 품목명 (수정 가능)"
                        />
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
