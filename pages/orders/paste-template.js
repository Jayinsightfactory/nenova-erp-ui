// pages/orders/paste-template.js — 붙여넣기 주문등록용 주문 즐겨찾기 큰 창
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit } from '../../lib/orderUtils';

const ORDER_TEMPLATE_PAGE = 'paste-order-template';

function getNearby2026Weeks(range = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const curWeek = Math.min(Math.ceil(dayOfYear / 7), 52);
  const weeks = [];
  for (let w = Math.max(1, curWeek - range); w <= curWeek + range; w++) {
    for (let s = 1; s <= 3; s++) {
      weeks.push(`${year}-${String(w).padStart(2, '0')}-${String(s).padStart(2, '0')}`);
    }
  }
  return weeks;
}

function parseTemplateFavorite(fav) {
  try {
    return { ...fav, data: JSON.parse(fav.FilterData || '{}') };
  } catch {
    return { ...fav, data: null };
  }
}

function isNetherlandsProduct(prod = {}) {
  return /네덜란드|netherlands|holland|dutch/i.test(String(prod.CounName || prod.counName || ''));
}

function extractMoqText(prod = {}) {
  if (!isNetherlandsProduct(prod)) return '';
  const descr = String(prod.ProdDescr || prod.Descr || prod.descr || '').trim();
  if (!descr) return '';
  const line = descr.split(/\r?\n/).find(v => /moq|엠오큐|최소/i.test(v)) || '';
  const m = line.match(/(?:moq|엠오큐|최소)\s*[:：=]?\s*([^,;/\n]+)/i);
  return (m ? `MOQ ${m[1].trim()}` : line.trim()).trim();
}

function favoriteItemFromOrderItem(it, allProducts = []) {
  const prod = allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey)) || it;
  return {
    prodKey: Number(it.prodKey),
    prodName: it.prodName || prod?.ProdName || '',
    displayName: it.displayName || prod?.DisplayName || it.prodName || prod?.ProdName || '',
    flowerName: it.flowerName || prod?.FlowerName || '',
    counName: it.counName || prod?.CounName || '',
    qty: Number(it.qty || it.outQty || 0),
    unit: normalizeOrderUnit(it.unit || prod?.OutUnit),
    descr: it.descr || extractMoqText(prod),
  };
}

function fmtQty(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function yearFromWeek(week) {
  const m = String(week || '').match(/^(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
}

function normalizeWeekInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = raw.match(/^(\d{1,2})\s*차\s*(\d{1,2})?$/);
  if (m) return `${m[1].padStart(2, '0')}-${String(m[2] || '01').padStart(2, '0')}`;
  return raw;
}

function shiftWeekByOrder(value, delta) {
  const raw = normalizeWeekInput(value) || getCurrentWeek();
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const hasYear = !!m;
  if (!m) m = raw.match(/^(\d{2})-(\d{2})$/);
  if (!m) return raw;

  let year = hasYear ? parseInt(m[1], 10) : null;
  let week = parseInt(m[hasYear ? 2 : 1], 10) + delta;
  const seq = parseInt(m[hasYear ? 3 : 2], 10);

  if (week < 1) {
    if (hasYear) { year -= 1; week = 52; }
    else week = 1;
  } else if (week > 52) {
    if (hasYear) { year += 1; week = 1; }
    else week = 52;
  }

  const body = `${String(week).padStart(2, '0')}-${String(seq).padStart(2, '0')}`;
  return hasYear ? `${year}-${body}` : body;
}

function RegisterCustomerPicker({
  registerCust,
  favoriteCustName,
  onSelect,
  onReset,
  disabled,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);
  const changed = favoriteCustName && registerCust?.custName
    && String(registerCust.custName) !== String(favoriteCustName);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      setLoading(true);
      apiGet('/api/customers/search', { q })
        .then((d) => {
          setResults(d.customers || []);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (cust) => {
    onSelect({ custKey: cust.CustKey, custName: cust.CustName || '' });
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} style={{ display: 'grid', gap: 5, minWidth: 280, position: 'relative' }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed' }}>등록 업체</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: '#0f172a' }}>
          {registerCust?.custName || '업체 미선택'}
        </span>
        {changed && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '2px 8px' }}>
            원본 {favoriteCustName}
          </span>
        )}
        {changed && (
          <button
            type="button"
            onClick={onReset}
            disabled={disabled}
            style={{ height: 24, padding: '0 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer' }}
          >
            원본으로
          </button>
        )}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true); }}
        disabled={disabled}
        placeholder="다른 업체명 검색 후 선택"
        style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', fontSize: 13, boxSizing: 'border-box', background: disabled ? '#f8fafc' : '#fff' }}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 220, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, boxShadow: '0 8px 24px rgba(15,23,42,0.12)', zIndex: 20 }}>
          {results.map((cust) => (
            <button
              key={cust.CustKey}
              type="button"
              onClick={() => pick(cust)}
              style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #eef2f7', background: Number(registerCust?.custKey) === Number(cust.CustKey) ? '#f5f3ff' : '#fff', padding: '8px 10px', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 800, fontSize: 13 }}>{cust.CustName}</div>
              <div style={{ marginTop: 2, fontSize: 11, color: '#64748b' }}>
                {[cust.CustArea, cust.Manager, cust.OrderCode].filter(Boolean).join(' · ')}
              </div>
            </button>
          ))}
        </div>
      )}
      {loading && <span style={{ fontSize: 11, color: '#64748b' }}>검색 중…</span>}
    </div>
  );
}

function WeekInput({ label, value, onChange, weeks, accent }) {
  const listId = `${label.replace(/\s+/g, '-')}-weeks`;
  const shift = (delta) => onChange(shiftWeekByOrder(value, delta));
  return (
    <label style={{ display: 'grid', gap: 5, minWidth: 180 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: accent }}>{label}</span>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 28px', gap: 5 }}>
        <input
          list={listId}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', fontSize: 13, fontWeight: 700, boxSizing: 'border-box' }}
        />
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 2 }}>
          <button type="button" title="1차수 올리기" onClick={(e) => { e.preventDefault(); shift(1); }} style={{ border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', fontSize: 10, fontWeight: 900, lineHeight: 1, cursor: 'pointer' }}>▲</button>
          <button type="button" title="1차수 내리기" onClick={(e) => { e.preventDefault(); shift(-1); }} style={{ border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', fontSize: 10, fontWeight: 900, lineHeight: 1, cursor: 'pointer' }}>▼</button>
        </div>
      </div>
      <datalist id={listId}>
        {weeks.map(w => <option key={w} value={w}>{formatWeekDisplay(w)}</option>)}
      </datalist>
    </label>
  );
}

function orderItemDisplayQty(item = {}) {
  return Number(item.outQty ?? item.qty ?? item.boxQty ?? item.bunchQty ?? item.steamQty ?? 0);
}

export default function PasteTemplateWindow() {
  const [weeks, setWeeks] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [sourceWeek, setSourceWeek] = useState('');
  const [targetWeek, setTargetWeek] = useState('');
  const [sourceOrders, setSourceOrders] = useState([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [orderTemplates, setOrderTemplates] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedFavoriteKey, setSelectedFavoriteKey] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [registerResult, setRegisterResult] = useState(null);
  const [registerCust, setRegisterCust] = useState({ custKey: null, custName: '' });

  const syncRegisterCust = (custKey, custName) => {
    setRegisterCust({ custKey: custKey || null, custName: custName || '' });
  };

  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const initialWeek = qs.get('week') || getCurrentWeek();
    setSourceWeek(initialWeek);
    setTargetWeek(initialWeek);

    apiGet('/api/orders/weeks').then(d => {
      const nearby = getNearby2026Weeks(5);
      const ws = [...new Set([initialWeek, ...nearby, ...(d.weeks || [])].filter(Boolean))];
      setWeeks(ws);
    }).catch(() => setWeeks([initialWeek, ...getNearby2026Weeks(5)]));

    apiGet('/api/master', { entity: 'products' }).then(d => setAllProducts(d.data || [])).catch(() => {});
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const d = await apiGet('/api/favorites', { page: ORDER_TEMPLATE_PAGE });
      setOrderTemplates((d.favorites || []).map(parseTemplateFavorite).filter(f => f.data?.items?.length));
    } catch {
      setOrderTemplates([]);
    }
  };

  const filteredSourceOrders = useMemo(() => {
    const q = sourceFilter.trim().toLowerCase();
    if (!q) return sourceOrders;
    return sourceOrders.filter(o =>
      String(o.custName || '').toLowerCase().includes(q) ||
      String(o.custArea || '').toLowerCase().includes(q)
    );
  }, [sourceOrders, sourceFilter]);

  const totalQty = useMemo(() => (
    (draft?.items || []).reduce((sum, it) => sum + Number(it.qty || 0), 0)
  ), [draft]);

  const rememberWeekOption = (value) => {
    const next = normalizeWeekInput(value);
    if (!next || !/^(\d{4}-)?\d{2}-\d{2}$/.test(next)) return;
    setWeeks(prev => prev.includes(next) ? prev : [next, ...prev]);
  };

  const changeSourceWeek = (value) => {
    setSourceWeek(value);
    rememberWeekOption(value);
  };

  const changeTargetWeek = (value) => {
    setTargetWeek(value);
    rememberWeekOption(value);
    setRegisterResult(null);
    setDraft(prev => prev ? ({ ...prev, resultMsg: '' }) : prev);
  };

  const setDraftFromOrder = (order) => {
    if (!order) return;
    const items = (order.items || [])
      .filter(it => it.prodKey && Number(it.qty || it.outQty || 0) !== 0)
      .map(it => favoriteItemFromOrderItem(it, allProducts));
    setDraft({
      favoriteKey: null,
      name: `${order.custName || '주문'} ${formatWeekDisplay(order.week || sourceWeek)}`,
      custKey: order.custKey,
      custName: order.custName || '',
      sourceWeek: order.week || sourceWeek,
      items,
      resultMsg: '',
    });
    syncRegisterCust(order.custKey, order.custName);
    setRegisterResult(null);
    setSelectedFavoriteKey('');
    setStatus(`${order.custName || ''} 원본 주문 ${items.length}품목을 불러왔습니다.`);
  };

  const loadSourceOrders = async () => {
    const lookupWeek = normalizeWeekInput(sourceWeek);
    if (!lookupWeek) { alert('원본 차수를 입력하세요.'); return; }
    setSourceWeek(lookupWeek);
    setSourceLoading(true);
    setStatus('');
    try {
      const d = await apiGet('/api/orders', { week: lookupWeek });
      const list = d.orders || [];
      setSourceOrders(list);
      setSelectedSourceId('');
      setStatus(list.length ? `${formatWeekDisplay(lookupWeek)} 원본 주문 ${list.length}건을 불러왔습니다.` : `${formatWeekDisplay(lookupWeek)} 주문등록 내역이 없습니다.`);
    } catch (e) {
      setStatus(`원본 주문 불러오기 실패: ${e.message}`);
    } finally {
      setSourceLoading(false);
    }
  };

  const loadFavoriteDraft = (favoriteKey) => {
    setSelectedFavoriteKey(favoriteKey);
    const fav = orderTemplates.find(f => Number(f.FavoriteKey) === Number(favoriteKey));
    if (!fav?.data) { setDraft(null); syncRegisterCust(null, ''); return; }
    setDraft({
      favoriteKey: fav.FavoriteKey,
      name: fav.FavName,
      custKey: fav.data.custKey,
      custName: fav.data.custName,
      sourceWeek: fav.data.sourceWeek,
      items: (fav.data.items || []).map(it => ({ ...it, unit: normalizeOrderUnit(it.unit) })),
      resultMsg: '',
    });
    syncRegisterCust(fav.data.custKey, fav.data.custName);
    setRegisterResult(null);
    setSelectedSourceId('');
    setStatus(`${fav.FavName} 즐겨찾기를 불러왔습니다.`);
  };

  const updateDraftItem = (idx, patch) => {
    setRegisterResult(null);
    setDraft(prev => prev ? ({
      ...prev,
      items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
      resultMsg: '',
    }) : prev);
  };

  const removeDraftItem = (idx) => {
    setRegisterResult(null);
    setDraft(prev => prev ? ({ ...prev, items: prev.items.filter((_, i) => i !== idx), resultMsg: '' }) : prev);
  };

  const payloadFromDraft = () => {
    const items = (draft?.items || [])
      .filter(it => it.prodKey && Number(it.qty || 0) !== 0)
      .map(it => {
        const prod = allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey));
        return {
          prodKey: it.prodKey,
          prodName: it.prodName,
          qty: Number(it.qty || 0),
          unit: normalizeOrderUnit(it.unit),
          descr: it.descr || extractMoqText(prod),
        };
      });
    return {
      custKey: draft?.custKey,
      custName: draft?.custName,
      sourceWeek: draft?.sourceWeek || sourceWeek,
      items,
    };
  };

  const saveDraftAsFavorite = async ({ replace = false } = {}) => {
    if (!draft?.items?.length) { alert('저장할 품목이 없습니다.'); return; }
    const payload = payloadFromDraft();
    if (!payload.custKey || !payload.items.length) { alert('거래처와 품목수량을 확인하세요.'); return; }
    setSaving(true);
    try {
      const saved = await apiPost('/api/favorites', {
        page: ORDER_TEMPLATE_PAGE,
        name: draft.name || draft.custName || '주문 즐겨찾기',
        filterData: JSON.stringify(payload),
      });
      if (replace && draft.favoriteKey) {
        await apiDelete('/api/favorites', { favoriteKey: draft.favoriteKey });
      }
      await loadTemplates();
      setDraft(prev => prev ? ({ ...prev, favoriteKey: saved.favoriteKey || prev.favoriteKey, resultMsg: replace ? '즐겨찾기 수정 저장 완료' : '새 즐겨찾기로 저장 완료' }) : prev);
      setSelectedFavoriteKey(String(saved.favoriteKey || ''));
      setStatus(replace ? '기존 즐겨찾기를 새 내용으로 수정했습니다.' : '새 즐겨찾기로 저장했습니다.');
    } catch (e) {
      setStatus(`즐겨찾기 저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const deleteFavorite = async () => {
    if (!draft?.favoriteKey) return;
    if (!confirm(`${draft.name || '선택 즐겨찾기'}를 삭제할까요?`)) return;
    setSaving(true);
    try {
      await apiDelete('/api/favorites', { favoriteKey: draft.favoriteKey });
      await loadTemplates();
      setDraft(null);
      syncRegisterCust(null, '');
      setSelectedFavoriteKey('');
      setStatus('즐겨찾기를 삭제했습니다.');
    } catch (e) {
      setStatus(`즐겨찾기 삭제 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const registerDraft = async () => {
    if (!registerCust?.custKey) { alert('등록할 업체를 선택하세요.'); return; }
    const registerWeek = normalizeWeekInput(targetWeek);
    if (!registerWeek) { alert('등록대상 차수를 입력하세요.'); return; }
    setTargetWeek(registerWeek);
    const payload = payloadFromDraft();
    if (!payload.items.length) { alert('등록할 품목수량이 없습니다.'); return; }
    const registerLabel = registerCust.custName || draft?.custName || '';
    if (!confirm(`${registerLabel} / ${formatWeekDisplay(registerWeek)}\n${payload.items.length}개 품목을 주문등록합니다.\n\n진행할까요?`)) return;
    setSaving(true);
    try {
      const d = await apiPost('/api/orders', {
        custKey: registerCust.custKey,
        week: registerWeek,
        year: yearFromWeek(registerWeek),
        items: payload.items,
        delta: true,
        source: 'paste-template',
      });
      if (!d.success) throw new Error(d.error || '주문등록 실패');

      const verify = await apiGet('/api/orders', { custName: registerLabel, week: registerWeek });
      const verifiedOrder = (verify.orders || []).find(o => Number(o.custKey) === Number(registerCust.custKey)) || null;
      const resultRows = (d.results || []).map(r => {
        const draftItem = payload.items.find(it => Number(it.prodKey) === Number(r.prodKey)) || {};
        const verifiedItem = (verifiedOrder?.items || []).find(it => Number(it.prodKey) === Number(r.prodKey)) || null;
        const previousQty = Number(r.previousQty ?? 0);
        const deltaQty = Number(r.deltaQty ?? draftItem.qty ?? r.qty ?? 0);
        const finalQty = Number(r.finalQty ?? (previousQty + deltaQty));
        const verifiedQty = verifiedItem ? orderItemDisplayQty(verifiedItem) : null;
        const deleteVerified = Math.abs(finalQty) < 0.0001 && !verifiedItem && r.status === 'DELETED';
        return {
          prodKey: r.prodKey,
          prodName: draftItem.prodName || r.prodName || draftItem.displayName || '',
          displayName: draftItem.displayName || r.prodName || draftItem.prodName || '',
          unit: normalizeOrderUnit(r.unit || draftItem.unit),
          status: r.status,
          previousQty,
          deltaQty,
          finalQty,
          verifiedQty,
          ok: deleteVerified || (verifiedQty !== null && Math.abs(Number(verifiedQty) - Number(finalQty)) < 0.0001),
        };
      });
      const okCount = resultRows.filter(r => r.ok).length;
      setRegisterResult({
        orderMasterKey: d.orderMasterKey,
        week: registerWeek,
        custName: registerLabel,
        source: d.source || 'real_db',
        message: d.message || '',
        warning: d.warning || '',
        verifiedOrder,
        rows: resultRows,
      });
      setDraft(prev => prev ? ({ ...prev, resultMsg: `주문등록 완료: OrderKey ${d.orderMasterKey} · 전산조회 ${okCount}/${resultRows.length}개 일치` }) : prev);
      setStatus(`${registerLabel} / ${formatWeekDisplay(registerWeek)} 주문등록 완료 · 전산조회 ${okCount}/${resultRows.length}개 일치`);
    } catch (e) {
      setDraft(prev => prev ? ({ ...prev, resultMsg: `주문등록 실패: ${e.message}` }) : prev);
      setRegisterResult({
        orderMasterKey: null,
        week: registerWeek,
        custName: registerLabel,
        source: 'error',
        message: `주문등록 실패: ${e.message}`,
        warning: '',
        verifiedOrder: null,
        rows: [],
      });
      setStatus(`주문등록 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', color: '#0f172a' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: '#ffffff', borderBottom: '1px solid #dbe3ea', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, color: '#1f2937' }}>주문 즐겨찾기 크게 보기</h1>
          <div style={{ marginTop: 3, fontSize: 12, color: '#64748b' }}>원본 주문을 불러와 즐겨찾기로 저장하고, 등록대상 차수에 주문등록합니다.</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {status && (
            <span style={{ fontSize: 12, fontWeight: 800, color: /실패|오류/.test(status) ? '#b91c1c' : '#166534', maxWidth: 560, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {status}
            </span>
          )}
          <button onClick={() => window.close()} style={{ height: 32, padding: '0 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>창 닫기</button>
        </div>
      </div>

      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '360px minmax(680px, 1fr)', gap: 14 }}>
        <aside style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <section style={{ background: '#fff', border: '1px solid #dbe3ea', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>원본 주문 불러오기</h2>
              <button
                onClick={loadSourceOrders}
                disabled={sourceLoading || !sourceWeek}
                style={{ height: 30, padding: '0 10px', border: 'none', borderRadius: 6, background: sourceLoading ? '#94a3b8' : '#2563eb', color: '#fff', fontWeight: 800, cursor: sourceLoading ? 'wait' : 'pointer' }}
              >
                {sourceLoading ? '불러오는 중' : '불러오기'}
              </button>
            </div>
            <WeekInput label="원본 차수" value={sourceWeek} onChange={changeSourceWeek} weeks={weeks} accent="#1d4ed8" />
            <input
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              placeholder="업체 검색"
              style={{ marginTop: 10, width: '100%', height: 32, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 9px' }}
            />
            <div style={{ marginTop: 10, maxHeight: 280, overflow: 'auto', border: '1px solid #eef2f7', borderRadius: 6 }}>
              {filteredSourceOrders.length === 0 ? (
                <div style={{ padding: 14, color: '#64748b', fontSize: 13 }}>원본 차수 주문을 불러오면 여기에 업체 목록이 표시됩니다.</div>
              ) : filteredSourceOrders.map(o => {
                const active = String(selectedSourceId) === String(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => { setSelectedSourceId(o.id); setDraftFromOrder(o); }}
                    style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #eef2f7', background: active ? '#eff6ff' : '#fff', padding: '9px 10px', cursor: 'pointer' }}
                  >
                    <div style={{ fontWeight: 800, color: '#0f172a' }}>{o.custName}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: '#64748b' }}>{formatWeekDisplay(o.week)} · {o.items?.length || 0}품목</div>
                  </button>
                );
              })}
            </div>
          </section>

          <section style={{ background: '#fff', border: '1px solid #dbe3ea', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15 }}>저장 즐겨찾기</h2>
              <button onClick={loadTemplates} style={{ height: 28, padding: '0 9px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' }}>새로고침</button>
            </div>
            <select
              value={selectedFavoriteKey}
              onChange={e => loadFavoriteDraft(e.target.value)}
              style={{ width: '100%', height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 9px', background: '#fff' }}
            >
              <option value="">즐겨찾기 선택</option>
              {orderTemplates.map(f => (
                <option key={f.FavoriteKey} value={f.FavoriteKey}>
                  {f.FavName} / {f.data?.custName || ''} / {f.data?.items?.length || 0}품목
                </option>
              ))}
            </select>
            <div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto', border: '1px solid #eef2f7', borderRadius: 6 }}>
              {orderTemplates.length === 0 ? (
                <div style={{ padding: 14, color: '#64748b', fontSize: 13 }}>저장된 주문 즐겨찾기가 없습니다.</div>
              ) : orderTemplates.map(f => {
                const active = String(selectedFavoriteKey) === String(f.FavoriteKey);
                return (
                  <button
                    key={f.FavoriteKey}
                    onClick={() => loadFavoriteDraft(f.FavoriteKey)}
                    style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #eef2f7', background: active ? '#fff7ed' : '#fff', padding: '9px 10px', cursor: 'pointer' }}
                  >
                    <div style={{ fontWeight: 800 }}>{f.FavName}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: '#64748b' }}>{f.data?.custName || ''} · 원본 {formatWeekDisplay(f.data?.sourceWeek || '')} · {f.data?.items?.length || 0}품목</div>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <main style={{ background: '#fff', border: '1px solid #dbe3ea', borderRadius: 8, minHeight: 620, display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
          <div style={{ padding: 14, borderBottom: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={draft?.name || ''}
                  onChange={e => setDraft(prev => prev ? ({ ...prev, name: e.target.value, resultMsg: '' }) : prev)}
                  placeholder="즐겨찾기 이름"
                  disabled={!draft}
                  style={{ minWidth: 300, height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', fontSize: 14, fontWeight: 800, background: draft ? '#fff' : '#f8fafc' }}
                />
                {draft?.sourceWeek && <span style={{ fontSize: 12, fontWeight: 800, color: '#92400e', background: '#fef3c7', borderRadius: 999, padding: '4px 9px' }}>원본 {formatWeekDisplay(draft.sourceWeek)}</span>}
                {draft && <span style={{ fontSize: 12, fontWeight: 800, color: '#0f766e', background: '#ccfbf1', borderRadius: 999, padding: '4px 9px' }}>{draft.items?.length || 0}품목 · 합계 {fmtQty(totalQty)}</span>}
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'end', flexWrap: 'wrap' }}>
                <RegisterCustomerPicker
                  registerCust={registerCust}
                  favoriteCustName={draft?.custName || ''}
                  disabled={!draft || saving}
                  onSelect={(cust) => {
                    setRegisterResult(null);
                    setRegisterCust(cust);
                    setDraft(prev => prev ? ({ ...prev, resultMsg: '' }) : prev);
                  }}
                  onReset={() => {
                    setRegisterResult(null);
                    syncRegisterCust(draft?.custKey, draft?.custName);
                    setDraft(prev => prev ? ({ ...prev, resultMsg: '' }) : prev);
                  }}
                />
                <WeekInput label="등록대상 차수" value={targetWeek} onChange={changeTargetWeek} weeks={weeks} accent="#15803d" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={() => saveDraftAsFavorite({ replace: false })}
                disabled={saving || !draft?.items?.length}
                style={{ height: 34, padding: '0 13px', border: 'none', borderRadius: 6, background: saving || !draft?.items?.length ? '#94a3b8' : '#7c3aed', color: '#fff', fontWeight: 900, cursor: saving ? 'wait' : 'pointer' }}
              >
                즐겨찾기로 저장하기
              </button>
              <button
                onClick={() => saveDraftAsFavorite({ replace: true })}
                disabled={saving || !draft?.favoriteKey || !draft?.items?.length}
                style={{ height: 34, padding: '0 13px', border: 'none', borderRadius: 6, background: saving || !draft?.favoriteKey ? '#cbd5e1' : '#92400e', color: draft?.favoriteKey ? '#fff' : '#64748b', fontWeight: 900, cursor: saving ? 'wait' : 'pointer' }}
              >
                현재 즐겨찾기 수정
              </button>
              <button
                onClick={deleteFavorite}
                disabled={saving || !draft?.favoriteKey}
                style={{ height: 34, padding: '0 12px', border: '1px solid #fecaca', borderRadius: 6, background: '#fff', color: draft?.favoriteKey ? '#b91c1c' : '#94a3b8', fontWeight: 800, cursor: draft?.favoriteKey ? 'pointer' : 'not-allowed' }}
              >
                삭제
              </button>
            </div>
          </div>

          <div style={{ overflow: 'auto' }}>
            {!draft ? (
              <div style={{ padding: 40, color: '#64748b', textAlign: 'center' }}>왼쪽에서 원본 주문 또는 저장 즐겨찾기를 선택하세요.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead style={{ position: 'sticky', top: 0, background: '#e2e8f0', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 320 }}>품목</th>
                    <th style={{ padding: '8px 10px', width: 90 }}>국가</th>
                    <th style={{ padding: '8px 10px', width: 90 }}>분류</th>
                    <th style={{ padding: '8px 10px', width: 90 }}>수량</th>
                    <th style={{ padding: '8px 10px', width: 90 }}>단위</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 180 }}>비고</th>
                    <th style={{ padding: '8px 10px', width: 70 }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {(draft.items || []).map((it, idx) => (
                    <tr key={`${it.prodKey}-${idx}`} style={{ borderBottom: '1px solid #edf2f7' }}>
                      <td style={{ padding: '7px 10px', fontWeight: 800 }}>{it.displayName || it.prodName}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: '#166534', fontWeight: 700 }}>{it.counName || ''}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center', color: '#6d28d9', fontWeight: 700 }}>{it.flowerName || ''}</td>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <input
                          type="number"
                          step="0.5"
                          value={it.qty}
                          onChange={e => updateDraftItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                          style={{ width: 76, height: 28, border: '1px solid #cbd5e1', borderRadius: 5, textAlign: 'right', padding: '0 6px', fontWeight: 800 }}
                        />
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <select
                          value={normalizeOrderUnit(it.unit)}
                          onChange={e => updateDraftItem(idx, { unit: e.target.value })}
                          style={{ height: 28, border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff' }}
                        >
                          <option>박스</option><option>단</option><option>송이</option>
                        </select>
                      </td>
                      <td style={{ padding: '7px 10px' }}>
                        <input
                          value={it.descr || ''}
                          onChange={e => updateDraftItem(idx, { descr: e.target.value })}
                          style={{ width: '100%', height: 28, border: '1px solid #cbd5e1', borderRadius: 5, padding: '0 7px' }}
                        />
                      </td>
                      <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                        <button onClick={() => removeDraftItem(idx)} style={{ height: 26, padding: '0 8px', border: '1px solid #fecaca', borderRadius: 5, background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ padding: 14, borderTop: '1px solid #e2e8f0', display: 'grid', gap: 10, background: '#f8fafc' }}>
            {registerResult && <RegisterResultPanel result={registerResult} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <div style={{ fontSize: 12, color: '#475569' }}>
                {draft?.resultMsg || '등록은 등록대상 차수에만 적용됩니다. 원본 차수와 즐겨찾기 내용은 주문등록 버튼만으로 변경되지 않습니다.'}
              </div>
              <button
                onClick={registerDraft}
                disabled={saving || !draft?.items?.length || !targetWeek || !registerCust?.custKey}
                style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 7, background: saving || !draft?.items?.length || !registerCust?.custKey ? '#94a3b8' : '#15803d', color: '#fff', fontWeight: 900, cursor: saving ? 'wait' : 'pointer' }}
              >
                등록대상 차수에 주문등록하기
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function statusLabel(status) {
  if (status === 'OK') return '신규';
  if (status === 'ADDED') return '추가';
  if (status === 'CANCELLED') return '취소';
  if (status === 'UPDATED') return '수정';
  if (status === 'DELETED') return '삭제';
  if (status === 'NOT_FOUND') return '품목없음';
  return status || '';
}

function RegisterResultPanel({ result }) {
  const rows = result.rows || [];
  const okCount = rows.filter(r => r.ok).length;
  const hasError = result.source === 'error' || /실패|오류/.test(result.message || '');
  return (
    <div style={{ border: `1px solid ${hasError ? '#fecaca' : '#bbf7d0'}`, borderRadius: 8, background: hasError ? '#fff1f2' : '#f0fdf4', overflow: 'hidden' }}>
      <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
        <div style={{ fontWeight: 900, color: hasError ? '#b91c1c' : '#166534' }}>
          {hasError ? '주문등록 실패' : '주문등록 후 전산조회 확인'}
        </div>
        <div style={{ fontSize: 12, color: '#475569' }}>
          {result.custName} · {formatWeekDisplay(result.week)} · {hasError ? result.message : `일치 ${okCount}/${rows.length}품목`}
        </div>
        {result.orderMasterKey && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', fontWeight: 800 }}>
            OrderKey {result.orderMasterKey}
          </div>
        )}
      </div>
      {result.warning && (
        <div style={{ padding: '7px 12px', fontSize: 12, color: '#92400e', background: '#fffbeb', borderBottom: '1px solid rgba(15,23,42,0.08)' }}>
          {result.warning}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ maxHeight: 190, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#dcfce7' }}>
              <tr>
                <th style={{ padding: '7px 9px', textAlign: 'left' }}>품목</th>
                <th style={{ padding: '7px 9px', width: 70 }}>구분</th>
                <th style={{ padding: '7px 9px', width: 90 }}>기존</th>
                <th style={{ padding: '7px 9px', width: 90 }}>이번등록</th>
                <th style={{ padding: '7px 9px', width: 90 }}>최종</th>
                <th style={{ padding: '7px 9px', width: 110 }}>전산조회</th>
                <th style={{ padding: '7px 9px', width: 80 }}>확인</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const deleted = r.status === 'DELETED' && r.verifiedQty === null;
                return (
                  <tr key={`${r.prodKey}-${idx}`} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '7px 9px', fontWeight: 800 }}>{r.displayName || r.prodName}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'center', color: (r.status === 'DELETED' || r.status === 'CANCELLED') ? '#b91c1c' : '#166534', fontWeight: 800 }}>{statusLabel(r.status)}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'right' }}>{fmtQty(r.previousQty)} {r.unit}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'right', color: r.deltaQty < 0 ? '#b91c1c' : '#1d4ed8', fontWeight: 800 }}>{fmtQty(r.deltaQty)} {r.unit}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'right', fontWeight: 900 }}>{fmtQty(r.finalQty)} {r.unit}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'right' }}>{deleted ? '삭제 확인' : r.verifiedQty === null ? '미조회' : `${fmtQty(r.verifiedQty)} ${r.unit}`}</td>
                    <td style={{ padding: '7px 9px', textAlign: 'center', color: r.ok ? '#166534' : '#b91c1c', fontWeight: 900 }}>{r.ok ? '일치' : '확인필요'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
