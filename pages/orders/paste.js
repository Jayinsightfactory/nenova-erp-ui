// pages/orders/paste.js — 붙여넣기 주문등록
import { useState, useEffect, useRef } from 'react';
import Layout from '../../components/Layout';
import { apiGet } from '../../lib/useApi';
import { filterProducts } from '../../lib/displayName';

// "Caroline" → ["caroline"] / "Don pedro (Red)" → ["don", "pedro", "red"]
function normalizeTokens(name) {
  return name.replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').filter(Boolean);
}

function matchProducts(inputName, products) {
  if (!inputName) return [];
  const tokens = normalizeTokens(inputName);
  const inputLower = tokens.join(' ');

  // 1. DisplayName 완전/부분 일치
  const dnExact = products.filter(p => {
    const dn = (p.DisplayName || '').toLowerCase();
    return dn === inputLower || dn.includes(inputLower);
  });
  if (dnExact.length > 0) return dnExact;

  // 2. ProdName에 모든 토큰 포함
  const wordMatch = products.filter(p => {
    const pn = (p.ProdName || '').toLowerCase();
    return tokens.every(t => pn.includes(t));
  });
  if (wordMatch.length > 0) return wordMatch;

  // 3. ProdName에 주요 토큰(2글자 이상) 대부분 포함
  const mainTokens = tokens.filter(t => t.length >= 3);
  if (mainTokens.length > 0) {
    const partial = products.filter(p => {
      const pn = (p.ProdName || '').toLowerCase();
      const matched = mainTokens.filter(t => pn.includes(t));
      return matched.length >= Math.ceil(mainTokens.length * 0.7);
    });
    if (partial.length > 0) return partial;
  }

  // 4. 자모/한글 매칭 (filterProducts)
  const jamo = filterProducts(products, inputName);
  if (jamo.length > 0) return jamo;

  return [];
}

// "Caroline | 2" / "Caroline : 2" / "Caroline  2" → { name, qty }
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const sep = trimmed.includes('|') ? '|' : trimmed.includes(':') ? ':' : null;
  if (sep) {
    const [name, qtyStr] = trimmed.split(sep);
    const qty = parseFloat(qtyStr?.trim());
    return { name: name.trim(), qty: isNaN(qty) ? 1 : qty };
  }
  // 마지막 공백 뒤가 숫자인 경우
  const m = trimmed.match(/^(.+?)\s+(\d+(?:\.\d+)?)$/);
  if (m) return { name: m[1].trim(), qty: parseFloat(m[2]) };
  return { name: trimmed, qty: 1 };
}

export default function PasteOrderPage() {
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [custSearch, setCustSearch] = useState('');
  const [selectedCust, setSelectedCust] = useState(null);
  const [week, setWeek] = useState('');
  const [weeks, setWeeks] = useState([]);
  const [pasteText, setPasteText] = useState('');
  const [parsed, setParsed] = useState(null);   // 파싱 결과 배열
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [showCustDrop, setShowCustDrop] = useState(false);
  const custRef = useRef(null);

  useEffect(() => {
    apiGet('/api/master', { entity: 'customers' }).then(d => setCustomers(d.data || []));
    apiGet('/api/master', { entity: 'products' }).then(d => setProducts(d.data || []));
    apiGet('/api/incoming-price').then(d => { if (d.success) setWeeks(d.weeks || []); });
    const onClick = e => { if (!custRef.current?.contains(e.target)) setShowCustDrop(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filteredCusts = custSearch
    ? customers.filter(c => c.CustName?.includes(custSearch) || c.CustCode?.includes(custSearch))
    : customers.slice(0, 20);

  const handleParse = () => {
    const lines = pasteText.split('\n').map(l => l.trim()).filter(Boolean);
    const result = lines.map((line, idx) => {
      const parsed = parseLine(line);
      if (!parsed) return null;
      const matches = matchProducts(parsed.name, products);
      return {
        idx,
        inputName: parsed.name,
        qty: parsed.qty,
        unit: '박스',
        matches,
        selectedProd: matches.length === 1 ? matches[0] : null,
        prodSearch: '',
        prodSearchResults: [],
        skip: false,
      };
    }).filter(Boolean);
    setParsed(result);
    setResultMsg('');
  };

  const updateItem = (idx, patch) => {
    setParsed(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };

  const handleProdSearch = (idx, q) => {
    const results = q ? filterProducts(products, q).slice(0, 10) : [];
    updateItem(idx, { prodSearch: q, prodSearchResults: results });
  };

  const handleRegister = async () => {
    if (!selectedCust) { alert('거래처를 선택하세요.'); return; }
    if (!week) { alert('차수를 선택하세요.'); return; }
    if (!parsed || parsed.length === 0) { alert('품목을 먼저 파싱하세요.'); return; }

    const items = parsed
      .filter(it => !it.skip && it.selectedProd)
      .map(it => ({
        prodKey: it.selectedProd.ProdKey,
        prodName: it.selectedProd.ProdName,
        qty: it.qty,
        unit: it.unit,
      }));

    if (items.length === 0) { alert('등록할 품목이 없습니다.'); return; }

    setSaving(true);
    setResultMsg('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ custKey: selectedCust.CustKey, week, items }),
      });
      const d = await res.json();
      if (d.success) {
        setResultMsg(`✅ ${items.length}개 품목 주문등록 완료 (${selectedCust.CustName} / ${week})`);
        setParsed(null);
        setPasteText('');
      } else {
        setResultMsg(`❌ 오류: ${d.error}`);
      }
    } catch (e) {
      setResultMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const unmatched = parsed?.filter(it => !it.skip && !it.selectedProd) || [];
  const matched   = parsed?.filter(it => !it.skip &&  it.selectedProd) || [];

  return (
    <Layout title="붙여넣기 주문등록">
      <div style={{ padding: '16px 20px', maxWidth: 900, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a237e', margin: '0 0 16px' }}>
          📋 붙여넣기 주문등록
        </h2>

        {/* 거래처 + 차수 */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* 거래처 */}
          <div ref={custRef} style={{ position: 'relative', minWidth: 220 }}>
            <label style={labelS}>거래처</label>
            <input
              style={inputS(selectedCust ? '#e8f5e9' : '#fff')}
              placeholder="거래처 검색..."
              value={selectedCust ? selectedCust.CustName : custSearch}
              onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); setShowCustDrop(true); }}
              onFocus={() => setShowCustDrop(true)}
            />
            {selectedCust && (
              <button onClick={() => { setSelectedCust(null); setCustSearch(''); }} style={clearBtnS}>✕</button>
            )}
            {showCustDrop && !selectedCust && (
              <div style={dropS}>
                {filteredCusts.length === 0
                  ? <div style={{ padding: '8px 12px', color: '#aaa', fontSize: 12 }}>없음</div>
                  : filteredCusts.map(c => (
                    <div key={c.CustKey} style={dropItemS}
                      onMouseDown={() => { setSelectedCust(c); setCustSearch(''); setShowCustDrop(false); }}>
                      <strong>{c.CustName}</strong>
                      <span style={{ fontSize: 11, color: '#999', marginLeft: 6 }}>{c.CustArea}</span>
                    </div>
                  ))
                }
              </div>
            )}
          </div>

          {/* 차수 */}
          <div>
            <label style={labelS}>차수</label>
            <select style={inputS()} value={week} onChange={e => setWeek(e.target.value)}>
              <option value="">차수 선택</option>
              {weeks.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </div>

        {/* 붙여넣기 영역 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>
            품목 붙여넣기 <span style={{ fontWeight: 400, color: '#888', fontSize: 11 }}>형식: 품목명 | 수량 (한 줄에 하나)</span>
          </label>
          <textarea
            style={{ width: '100%', height: 220, padding: '10px 12px', border: '1px solid #bbb', borderRadius: 6, fontSize: 13, fontFamily: 'var(--mono, monospace)', resize: 'vertical', boxSizing: 'border-box' }}
            placeholder={'Caroline | 2\nCherrio | 5\nMoon Light | 3\n수국 핑크 | 2\n...'}
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setParsed(null); }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button
            onClick={handleParse}
            disabled={!pasteText.trim()}
            style={{ padding: '8px 20px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            🔍 파싱
          </button>
          {parsed && (
            <span style={{ fontSize: 13, color: '#555' }}>
              총 {parsed.length}줄 — <span style={{ color: '#1b5e20', fontWeight: 600 }}>{matched.length}개 매칭</span>
              {unmatched.length > 0 && <span style={{ color: '#c62828', fontWeight: 600 }}> / {unmatched.length}개 미매칭</span>}
            </span>
          )}
        </div>

        {/* 파싱 결과 */}
        {parsed && (
          <div style={{ marginBottom: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#1a237e', color: '#fff' }}>
                  <th style={thS(30)}>#</th>
                  <th style={thS(160, 'left')}>입력 품목명</th>
                  <th style={thS(60)}>수량</th>
                  <th style={thS(80)}>단위</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 600 }}>매칭 결과</th>
                  <th style={thS(60)}>건너뛰기</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((it, idx) => (
                  <tr key={idx} style={{ background: it.skip ? '#f5f5f5' : it.selectedProd ? '#e8f5e9' : '#fff3e0', opacity: it.skip ? 0.5 : 1, borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', textAlign: 'center', color: '#888', fontSize: 11 }}>{idx + 1}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono, monospace)', fontSize: 12 }}>{it.inputName}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <input type="number" min="0" step="0.5"
                        value={it.qty}
                        onChange={e => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                        style={{ width: 56, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, textAlign: 'right', fontSize: 13 }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <select value={it.unit} onChange={e => updateItem(idx, { unit: e.target.value })}
                        style={{ fontSize: 12, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4 }}>
                        <option>박스</option><option>단</option><option>송이</option>
                      </select>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {it.selectedProd ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ color: '#1b5e20', fontWeight: 600, fontSize: 12 }}>✅ {it.selectedProd.DisplayName || it.selectedProd.ProdName}</span>
                          <span style={{ color: '#999', fontSize: 11 }}>{it.selectedProd.ProdName}</span>
                          {it.matches.length > 1 && (
                            <select
                              value={it.selectedProd.ProdKey}
                              onChange={e => {
                                const p = it.matches.find(m => m.ProdKey === parseInt(e.target.value));
                                if (p) updateItem(idx, { selectedProd: p });
                              }}
                              style={{ fontSize: 11, padding: '1px 4px', borderRadius: 3, border: '1px solid #bbb', marginLeft: 4 }}
                            >
                              {it.matches.map(m => <option key={m.ProdKey} value={m.ProdKey}>{m.DisplayName || m.ProdName}</option>)}
                            </select>
                          )}
                        </div>
                      ) : (
                        <div style={{ position: 'relative' }}>
                          <input
                            type="text"
                            placeholder="품목명 검색 (한글/영문)..."
                            value={it.prodSearch}
                            onChange={e => handleProdSearch(idx, e.target.value)}
                            style={{ width: '100%', padding: '3px 8px', border: '1px solid #e65100', borderRadius: 4, fontSize: 12 }}
                          />
                          {it.prodSearchResults.length > 0 && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, maxHeight: 160, overflowY: 'auto' }}>
                              {it.prodSearchResults.map(p => (
                                <div key={p.ProdKey}
                                  style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f5f5f5' }}
                                  onMouseDown={() => updateItem(idx, { selectedProd: p, prodSearch: '', prodSearchResults: [] })}
                                >
                                  <strong>{p.DisplayName || p.ProdName}</strong>
                                  <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>{p.FlowerName} / {p.CounName}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={it.skip} onChange={e => updateItem(idx, { skip: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 등록 버튼 */}
        {parsed && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
            {resultMsg && (
              <span style={{ fontSize: 13, fontWeight: 600, color: resultMsg.startsWith('✅') ? '#1b5e20' : '#c62828' }}>
                {resultMsg}
              </span>
            )}
            {unmatched.length > 0 && (
              <span style={{ fontSize: 12, color: '#e65100' }}>⚠️ {unmatched.length}개 미매칭 (빨간 행) — 검색 또는 건너뛰기</span>
            )}
            <button
              onClick={handleRegister}
              disabled={saving || matched.length === 0}
              style={{ padding: '9px 28px', background: matched.length > 0 ? '#2e7d32' : '#aaa', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: matched.length > 0 ? 'pointer' : 'not-allowed' }}
            >
              {saving ? '등록 중...' : `💾 주문등록 (${matched.length}개)`}
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}

const labelS = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };
const inputS = (bg = '#fff') => ({ padding: '7px 10px', border: '1px solid #bbb', borderRadius: 6, fontSize: 13, minWidth: 180, background: bg, width: '100%' });
const clearBtnS = { position: 'absolute', right: 6, top: '50%', transform: 'translateY(50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: 14, padding: 0 };
const dropS = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 220, overflowY: 'auto' };
const dropItemS = { padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5' };
const thS = (w, align = 'center') => ({ width: w, minWidth: w, padding: '7px 8px', textAlign: align, fontWeight: 600 });
