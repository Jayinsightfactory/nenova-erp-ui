import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit } from '../../lib/orderUtils';
import { filterProducts } from '../../lib/displayName';
import { ensureWeekCanDistribute } from '../../lib/ensureWeekCanDistribute';

function buildFullWeek(yearStr, shortWeek) {
  const w = String(shortWeek || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (/^\d{2}-\d{2}$/.test(w)) return `${yearStr || new Date().getFullYear()}-${w}`;
  return w;
}

function emptyLine() {
  return {
    id: `${Date.now()}-${Math.random()}`,
    prodKey: null,
    prodName: '',
    unit: '단',
    qty: '',
    action: 'ADD',
    prodSearch: '',
    prodOpen: false,
  };
}

export default function OrderRegisterDistributeModal({
  open,
  onClose,
  yearStr,
  weekNum,
  selectedShip,
  initialCust,
  products = [],
  onSuccess,
}) {
  const [cust, setCust] = useState(null);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState([]);
  const [custOpen, setCustOpen] = useState(false);
  const [weekValue, setWeekValue] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const wrapRef = useRef(null);

  const weekOptions = useMemo(() => {
    const subs = String(selectedShip?.SubWeeks || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (subs.length > 0) {
      return subs.map(w => ({
        value: buildFullWeek(yearStr, w),
        label: formatWeekDisplay(buildFullWeek(yearStr, w)),
      }));
    }
    const fallback = buildFullWeek(yearStr, `${String(weekNum || '').padStart(2, '0')}-01`);
    return [{ value: fallback, label: formatWeekDisplay(fallback) }];
  }, [selectedShip, yearStr, weekNum]);

  useEffect(() => {
    if (!open) return;
    const fromShip = selectedShip?.CustKey
      ? { CustKey: selectedShip.CustKey, CustName: selectedShip.CustName || '' }
      : null;
    const fromFilter = initialCust?.CustKey ? initialCust : null;
    const next = fromShip || fromFilter || null;
    setCust(next);
    setCustQuery(next?.CustName || '');
    setCustResults([]);
    setCustOpen(false);
    setWeekValue(weekOptions[0]?.value || '');
    setLines([emptyLine()]);
    setResult(null);
  }, [open, selectedShip, initialCust, weekOptions]);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setCustOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const q = custQuery.trim();
    if (!open || q.length < 1) {
      setCustResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      apiGet('/api/customers/search', { q })
        .then((d) => { setCustResults(d.customers || []); setCustOpen(true); })
        .catch(() => setCustResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [custQuery, open]);

  const updateLine = (id, patch) => {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)));
    setResult(null);
  };

  const pickProduct = (lineId, prod) => {
    updateLine(lineId, {
      prodKey: prod.ProdKey,
      prodName: prod.ProdName || '',
      unit: normalizeOrderUnit(prod.OutUnit),
      prodSearch: prod.ProdName || '',
      prodOpen: false,
    });
  };

  const addLine = () => setLines(prev => [...prev, emptyLine()]);

  const removeLine = (id) => {
    setLines(prev => (prev.length <= 1 ? [emptyLine()] : prev.filter(l => l.id !== id)));
  };

  const validTargets = lines
    .map((l) => {
      const qty = parseFloat(l.qty);
      if (!l.prodKey || !(qty > 0)) return null;
      return {
        prodKey: l.prodKey,
        prodName: l.prodName,
        qty,
        unit: normalizeOrderUnit(l.unit),
        type: l.action === 'CANCEL' ? 'CANCEL' : 'ADD',
      };
    })
    .filter(Boolean);

  const submit = async () => {
    if (!cust?.CustKey) { alert('업체를 선택하세요.'); return; }
    if (!weekValue) { alert('등록 차수를 선택하세요.'); return; }
    if (!validTargets.length) { alert('품목과 수량을 입력하세요.'); return; }

    const preview = validTargets.map(t => `${t.prodName}: ${t.type === 'CANCEL' ? '−' : '+'}${t.qty}${t.unit}`).join('\n');
    if (!confirm(`${cust.CustName} / ${formatWeekDisplay(weekValue)}\n${validTargets.length}개 품목 주문등록+분배:\n\n${preview}\n\n진행할까요?\n(추가 = OrderDetail+ShipmentDetail 동시 +, 취소 = 동시 −)`)) return;

    if (!(await ensureWeekCanDistribute(weekValue, validTargets.map(t => t.prodKey)))) return;

    setRunning(true);
    setResult(null);
    const details = [];
    for (const t of validTargets) {
      try {
        const d = await apiPost('/api/shipment/adjust', {
          custKey: cust.CustKey,
          prodKey: t.prodKey,
          week: weekValue,
          type: t.type,
          qty: t.qty,
          unit: t.unit,
          memo: `견적서 주문등록+분배: ${t.prodName} ${t.type === 'CANCEL' ? '−' : '+'}${t.qty}${t.unit}`,
          force: true,
        });
        details.push({ ...t, ok: !!d.success, error: d.error });
      } catch (e) {
        details.push({ ...t, ok: false, error: e.message });
      }
    }
    const okCount = details.filter(d => d.ok).length;
    const failCount = details.length - okCount;
    setResult({ okCount, failCount, details });
    setRunning(false);
    if (okCount > 0) {
      onSuccess?.({ custKey: cust.CustKey, week: weekValue, okCount });
    }
  };

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}
    >
      <div ref={wrapRef} style={{ background: '#fff', borderRadius: 12, width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 16px 48px rgba(15,23,42,0.2)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>주문등록 + 분배</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
              입력 수량만큼 해당 차수 주문(OrderDetail)과 출고분배(ShipmentDetail)에 <strong>누적</strong>됩니다.
            </div>
          </div>
          <button type="button" onClick={() => !running && onClose()} style={{ border: 0, background: 'transparent', fontSize: 20, cursor: 'pointer', color: '#64748b' }}>✕</button>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed' }}>업체</span>
              {cust?.CustName && (
                <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>{cust.CustName}</span>
              )}
              <input
                value={custQuery}
                onChange={(e) => { setCustQuery(e.target.value); if (cust) setCust(null); }}
                onFocus={() => { if (custResults.length) setCustOpen(true); }}
                placeholder="업체명 검색 후 선택"
                disabled={running}
                style={{ height: 36, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 10px', fontSize: 13 }}
              />
              {custOpen && custResults.length > 0 && (
                <div style={{ position: 'relative' }}>
                  <div style={{ position: 'absolute', top: 4, left: 0, right: 0, maxHeight: 200, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, zIndex: 10, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }}>
                    {custResults.map((c) => (
                      <button
                        key={c.CustKey}
                        type="button"
                        onClick={() => { setCust(c); setCustQuery(c.CustName); setCustOpen(false); }}
                        style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f1f5f9', background: Number(cust?.CustKey) === Number(c.CustKey) ? '#f5f3ff' : '#fff', padding: '8px 10px', cursor: 'pointer' }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 13 }}>{c.CustName}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{[c.CustArea, c.Manager].filter(Boolean).join(' · ')}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedShip?.CustName && (
                <span style={{ fontSize: 11, color: '#92400e' }}>출고목록 선택: {selectedShip.CustName}</span>
              )}
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#15803d' }}>등록 차수</span>
              <select
                value={weekValue}
                onChange={(e) => setWeekValue(e.target.value)}
                disabled={running}
                style={{ height: 36, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 8px', fontSize: 13, fontWeight: 700 }}
              >
                {weekOptions.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>품목 · 수량</span>
              <button type="button" onClick={addLine} disabled={running} style={{ marginLeft: 'auto', height: 28, padding: '0 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', fontSize: 12, cursor: 'pointer' }}>+ 행 추가</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {lines.map((line) => {
                const prodResults = line.prodSearch.trim()
                  ? filterProducts(products, line.prodSearch).slice(0, 8)
                  : [];
                return (
                  <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 72px 64px 32px', gap: 8, alignItems: 'start' }}>
                    <select
                      value={line.action}
                      onChange={(e) => updateLine(line.id, { action: e.target.value })}
                      disabled={running}
                      style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, fontWeight: 700, color: line.action === 'CANCEL' ? '#c62828' : '#2e7d32' }}
                    >
                      <option value="ADD">추가</option>
                      <option value="CANCEL">취소</option>
                    </select>
                    <div style={{ position: 'relative' }}>
                      <input
                        value={line.prodSearch}
                        onChange={(e) => updateLine(line.id, { prodSearch: e.target.value, prodOpen: true, prodKey: null, prodName: '' })}
                        onFocus={() => updateLine(line.id, { prodOpen: true })}
                        placeholder="품목 검색"
                        disabled={running}
                        style={{ width: '100%', height: 34, border: `1px solid ${line.prodKey ? '#86efac' : '#cbd5e1'}`, borderRadius: 6, padding: '0 8px', fontSize: 12, boxSizing: 'border-box' }}
                      />
                      {line.prodOpen && prodResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 180, overflow: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 6, zIndex: 15, boxShadow: '0 8px 20px rgba(15,23,42,0.1)' }}>
                          {prodResults.map((p) => (
                            <button
                              key={p.ProdKey}
                              type="button"
                              onClick={() => pickProduct(line.id, p)}
                              style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid #f1f5f9', background: '#fff', padding: '6px 8px', cursor: 'pointer', fontSize: 12 }}
                            >
                              <div style={{ fontWeight: 700 }}>{p.ProdName}</div>
                              <div style={{ fontSize: 10, color: '#64748b' }}>{p.CounName} · {p.FlowerName} · {p.OutUnit}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={line.qty}
                      onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                      placeholder="수량"
                      disabled={running}
                      style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 6px', fontSize: 13, fontWeight: 700, textAlign: 'center' }}
                    />
                    <input
                      value={line.unit}
                      onChange={(e) => updateLine(line.id, { unit: e.target.value })}
                      disabled={running}
                      style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 4px', fontSize: 12, textAlign: 'center' }}
                    />
                    <button type="button" onClick={() => removeLine(line.id)} disabled={running} style={{ height: 34, border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc', cursor: 'pointer' }}>−</button>
                  </div>
                );
              })}
            </div>
          </div>

          {result && (
            <div style={{ padding: 12, borderRadius: 8, background: result.failCount ? '#fff7ed' : '#ecfdf5', border: `1px solid ${result.failCount ? '#fdba74' : '#86efac'}` }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>완료 {result.okCount}건{result.failCount ? ` / 실패 ${result.failCount}건` : ''}</div>
              {result.details.filter(d => !d.ok).map((d, i) => (
                <div key={i} style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>{d.prodName}: {d.error}</div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '12px 20px 20px', display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0' }}>
          <button type="button" onClick={() => !running && onClose()} disabled={running} style={{ height: 38, padding: '0 16px', border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', cursor: 'pointer' }}>닫기</button>
          <button
            type="button"
            onClick={submit}
            disabled={running || !cust?.CustKey || !validTargets.length}
            style={{ height: 38, padding: '0 20px', border: 'none', borderRadius: 7, background: running || !validTargets.length ? '#94a3b8' : '#15803d', color: '#fff', fontWeight: 900, cursor: running ? 'wait' : 'pointer' }}
          >
            {running ? '처리 중…' : '주문등록 + 분배 실행'}
          </button>
        </div>
      </div>
    </div>
  );
}
