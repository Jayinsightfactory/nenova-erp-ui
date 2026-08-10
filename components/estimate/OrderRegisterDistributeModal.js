import { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { formatWeekDisplay } from '../../lib/useWeekInput';
import { normalizeOrderUnit } from '../../lib/orderUtils';
import { rankProductSearchOptions } from '../../lib/productSearchRanking';
import { ensureWeekCanDistribute } from '../../lib/ensureWeekCanDistribute';
import { buildEstimateAdditionalWeek, validateAdditionalProductSelection } from '../../lib/estimateAdditionalProduct';
import { runEditWithFixCycle } from '../../lib/fixCycleClient';

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
    context: null,
    contextError: '',
    costSourceId: '',
    cost: '',
    farmKey: '',
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
    try { const value=buildEstimateAdditionalWeek(yearStr, weekNum); return [{value,label:formatWeekDisplay(value)}]; }
    catch { return []; }
  }, [yearStr, weekNum]);

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

  const pickProduct = async (lineId, prod) => {
    updateLine(lineId, {
      prodKey: prod.ProdKey,
      prodName: prod.ProdName || '',
      unit: normalizeOrderUnit(prod.OutUnit),
      prodSearch: prod.ProdName || '',
      prodOpen: false,
      context: null, contextError: '단가·농장 조회 중…', costSourceId:'', cost:'', farmKey:'',
    });
    try {
      const d = await apiGet('/api/estimate/additional-product-context', {
        year: yearStr, week: `${String(weekNum).padStart(2,'0')}-02`, custKey: cust?.CustKey, prodKey: prod.ProdKey,
      });
      updateLine(lineId, { context:d, contextError:'', farmKey:'' });
    } catch (e) { updateLine(lineId, { context:null, contextError:e.message }); }
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
        context:l.context, contextError:l.contextError, cost:Number(l.cost), costSourceId:l.costSourceId, farmKey:Number(l.farmKey),
      };
    })
    .filter(Boolean);

  const submit = async () => {
    if (!cust?.CustKey) { alert('업체를 선택하세요.'); return; }
    if (!weekValue) { alert('등록 차수를 선택하세요.'); return; }
    if (!validTargets.length) { alert('품목과 수량을 입력하세요.'); return; }

    try { validTargets.forEach(t => validateAdditionalProductSelection({cost:t.cost,costSourceId:t.costSourceId,farmKey:t.farmKey,shipmentDate:t.context?.shipmentDate})); }
    catch(e) { alert(e.message); return; }
    const preview = validTargets.map(t => `${t.prodName}: +${t.qty}${t.unit} / ${t.cost.toLocaleString()}원 / ${t.context?.farms?.find(f=>f.farmKey===t.farmKey)?.farmName||''}`).join('\n');
    if (!confirm(`${cust.CustName} / ${formatWeekDisplay(weekValue)}\n${validTargets.length}개 품목을 02차에 등록합니다.\n\n${preview}\n\n기존 주문이 있으면 주문수량은 유지하고 분배만 증가합니다. 진행할까요?`)) return;

    if (!(await ensureWeekCanDistribute(weekValue, validTargets.map(t => t.prodKey), yearStr))) return;

    setRunning(true);
    setResult(null);
    const details = [];
    const mustCycle = validTargets.some(t => t.context?.fixed);
    const apply = async () => {
      for (const t of validTargets) {
        try {
        const d = await apiPost('/api/shipment/adjust', {
          custKey: cust.CustKey,
          prodKey: t.prodKey,
          week: weekValue,
          type: t.type,
          qty: t.qty,
          unit: t.unit,
          year: yearStr,
          mode: 'PIVOT_DISTRIBUTION',
          unitCost: t.cost,
          costSourceId: t.costSourceId,
          shipmentDate: t.context.shipmentDate,
          farmAssignments: [{ farmKey:t.farmKey, shipmentQuantity:t.qty }],
          memo: `견적서 추가 품목: ${t.prodName} +${t.qty}${t.unit} 단가출처=${t.costSourceId}`,
          force: false,
        });
        details.push({ ...t, ok: !!d.success, error: d.error });
        } catch (e) { details.push({ ...t, ok: false, error: e.message }); }
      }
      return { success: details.every(d => d.ok) };
    };
    try {
      if (mustCycle) {
        await runEditWithFixCycle({
          weeks: [`${String(weekNum).padStart(2,'0')}-02`],
          orderYear: yearStr,
          stockProdKeys: validTargets.map(t => t.prodKey),
          apply,
        });
      } else {
        await apply();
      }
    } catch (e) {
      if (!details.length) validTargets.forEach(t=>details.push({...t,ok:false,error:e.message}));
      else details.push({prodName:'확정 사이클',ok:false,error:e.message});
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
            <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a' }}>추가 품목등록</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
              현재 연도·차수의 검증된 <strong>02차</strong>에 주문 정책과 농장분배 계약을 적용합니다.
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
                  ? rankProductSearchOptions(line.prodSearch, products, { limit: 8 })
                  : [];
                return (
                  <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '1fr 72px 64px 32px', gap: 8, alignItems: 'start', paddingBottom:12, borderBottom:'1px solid #e2e8f0' }}>
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
                      readOnly
                      disabled={running}
                      style={{ height: 34, border: '1px solid #cbd5e1', borderRadius: 6, padding: '0 4px', fontSize: 12, textAlign: 'center' }}
                    />
                    <button type="button" onClick={() => removeLine(line.id)} disabled={running} style={{ height: 34, border: '1px solid #e2e8f0', borderRadius: 6, background: '#f8fafc', cursor: 'pointer' }}>−</button>
                    <div style={{gridColumn:'1 / -1',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      {line.contextError && <div style={{gridColumn:'1 / -1',fontSize:11,color:'#c62828'}}>{line.contextError}</div>}
                      <select value={line.costSourceId} onChange={e=>{const id=e.target.value;const src=line.context?.priceSources?.find(x=>x.id===id);updateLine(line.id,{costSourceId:id,cost:src?.cost||''});}} disabled={!line.context} style={{height:34,border:'1px solid #cbd5e1',borderRadius:6}}>
                        <option value="">참고단가 출처 선택 (자동 확정 안 함)</option>
                        {(line.context?.priceSources||[]).map(s=><option key={s.id} value={s.id}>{s.customerName} · {s.year} {s.week} · {s.shipmentDate} · VAT 포함 · {Number(s.cost).toLocaleString()}원</option>)}
                        <option value="DIRECT">직접 입력</option>
                      </select>
                      <input type="number" value={line.cost} onChange={e=>updateLine(line.id,{cost:e.target.value,costSourceId:line.costSourceId||'DIRECT'})} placeholder="VAT 포함 단가" style={{height:34,border:'1px solid #cbd5e1',borderRadius:6,padding:'0 8px'}} />
                      <select value={line.farmKey} onChange={e=>updateLine(line.id,{farmKey:e.target.value})} disabled={!line.context} style={{height:34,border:'1px solid #cbd5e1',borderRadius:6}}><option value="">농장 선택</option>{(line.context?.farms||[]).map(f=><option key={f.farmKey} value={f.farmKey}>{f.farmName} ({f.farmCode})</option>)}</select>
                      <div style={{fontSize:11,color:'#475569',alignSelf:'center'}}>출고일 {line.context?.shipmentDate||'-'} · 재고 부족 시 저장 중단</div>
                    </div>
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
            {running ? '처리 중…' : '추가 품목등록 실행'}
          </button>
        </div>
      </div>
    </div>
  );
}
