// pages/orders/paste.js — 붙여넣기 주문등록 (Claude AI 파싱)
import { useState, useEffect, useRef } from 'react';
import Layout from '../../components/Layout';
import { apiGet } from '../../lib/useApi';
import { filterProducts } from '../../lib/displayName';

export default function PasteOrderPage() {
  const [allProducts, setAllProducts] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [week, setWeek] = useState('');
  const [weekPage, setWeekPage] = useState(0);
  const WEEK_PAGE_SIZE = 6;
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [parseError, setParseError] = useState('');

  useEffect(() => {
    apiGet('/api/master', { entity: 'customers' }).then(d => setAllCustomers(d.data || []));
    apiGet('/api/master', { entity: 'products'  }).then(d => setAllProducts(d.data  || []));
    apiGet('/api/orders/weeks').then(d => {
      if (d.success) {
        const ws = d.weeks || [];
        setWeeks(ws);
        if (ws.length > 0) { setWeek(ws[0]); setWeekPage(0); }
      }
    });
  }, []);

  const handleParse = async () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setParsed(null);
    setParseError('');
    setResultMsg('');
    try {
      const res = await fetch('/api/orders/parse-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await res.json();
      if (!d.success) { setParseError(d.error || '파싱 실패'); return; }

      // items에 편집 상태 추가
      const items = (d.items || []).map((it, idx) => ({
        ...it,
        idx,
        unit: '박스',
        skip: false,
        prodSearch: '',
        prodSearchResults: [],
      }));
      setParsed({ custMatch: d.custMatch, items });
    } catch (e) {
      setParseError(e.message);
    } finally {
      setParsing(false);
    }
  };

  const updateItem = (idx, patch) => {
    setParsed(prev => ({ ...prev, items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }));
  };

  const handleProdSearch = (idx, q) => {
    const results = q ? filterProducts(allProducts, q).slice(0, 10) : [];
    updateItem(idx, { prodSearch: q, prodSearchResults: results });
  };

  const handleRegister = async () => {
    const cust = parsed?.custMatch;
    if (!cust) { alert('거래처를 확인하세요.'); return; }
    if (!week) { alert('차수를 선택하세요.'); return; }

    const items = (parsed?.items || [])
      .filter(it => !it.skip && it.prodKey)
      .map(it => ({ prodKey: it.prodKey, prodName: it.prodName, qty: it.qty, unit: it.unit }));

    if (items.length === 0) { alert('등록할 품목이 없습니다.'); return; }

    setSaving(true);
    setResultMsg('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ custKey: cust.CustKey, week, items }),
      });
      const d = await res.json();
      if (d.success) {
        setResultMsg(`✅ ${items.length}개 품목 주문등록 완료 (${cust.CustName} / ${week})`);
        setParsed(null);
        setPasteText('');
      } else {
        setResultMsg(`❌ ${d.error}`);
      }
    } catch (e) {
      setResultMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const matched   = parsed?.items?.filter(it => !it.skip && it.prodKey) || [];
  const unmatched = parsed?.items?.filter(it => !it.skip && !it.prodKey) || [];

  return (
    <Layout title="붙여넣기 주문등록">
      <div style={{ padding: '16px 20px', maxWidth: 920, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a237e', margin: '0 0 16px' }}>
          📋 붙여넣기 주문등록
        </h2>

        {/* 차수 선택 버튼형 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>차수</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => setWeekPage(p => Math.min(p + 1, Math.floor((weeks.length - 1) / WEEK_PAGE_SIZE)))}
              disabled={weekPage >= Math.floor((weeks.length - 1) / WEEK_PAGE_SIZE)}
              style={navBtnS}
            >◀</button>
            {weeks.slice(weekPage * WEEK_PAGE_SIZE, (weekPage + 1) * WEEK_PAGE_SIZE).map(w => (
              <button key={w} onClick={() => setWeek(w)}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  border: week === w ? '2px solid #1a237e' : '1px solid #bbb',
                  background: week === w ? '#1a237e' : '#fff',
                  color: week === w ? '#fff' : '#333',
                  fontWeight: week === w ? 700 : 400,
                }}>
                {w}
              </button>
            ))}
            <button
              onClick={() => setWeekPage(p => Math.max(p - 1, 0))}
              disabled={weekPage === 0}
              style={navBtnS}
            >▶</button>
            {week && <span style={{ fontSize: 12, color: '#1a237e', fontWeight: 600, marginLeft: 4 }}>선택: {week}</span>}
          </div>
        </div>

        {/* 붙여넣기 영역 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>
            텍스트 붙여넣기
            <span style={{ fontWeight: 400, color: '#888', fontSize: 11, marginLeft: 6 }}>
              거래처명 / 품목명 | 수량 형식
            </span>
          </label>
          <textarea
            style={{ width: '100%', height: 200, padding: '10px 12px', border: '1px solid #bbb', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
            placeholder={'청화꽃집\nCaroline | 2\nMoon Light | 3\n수국 핑크 | 2\n...'}
            value={pasteText}
            onChange={e => { setPasteText(e.target.value); setParsed(null); setParseError(''); }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
          <button
            onClick={handleParse}
            disabled={parsing || !pasteText.trim()}
            style={{ padding: '9px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: parsing ? 0.7 : 1 }}
          >
            {parsing ? '🤖 Claude 분석 중...' : '🤖 Claude로 분석'}
          </button>
          {parseError && <span style={{ color: '#c62828', fontSize: 13 }}>❌ {parseError}</span>}
          {parsed && (
            <span style={{ fontSize: 13, color: '#555' }}>
              <span style={{ color: '#1b5e20', fontWeight: 600 }}>{matched.length}개 매칭</span>
              {unmatched.length > 0 && <span style={{ color: '#e65100', fontWeight: 600 }}> / {unmatched.length}개 미매칭</span>}
            </span>
          )}
        </div>

        {/* 분석 결과 */}
        {parsed && (
          <>
            {/* 거래처 확인 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, padding: '10px 14px', background: parsed.custMatch ? '#e8f5e9' : '#fff3e0', borderRadius: 8, border: `1px solid ${parsed.custMatch ? '#a5d6a7' : '#ffb74d'}` }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#333' }}>거래처:</span>
              {parsed.custMatch ? (
                <>
                  <span style={{ fontWeight: 700, color: '#1b5e20', fontSize: 15 }}>✅ {parsed.custMatch.CustName}</span>
                  <span style={{ fontSize: 12, color: '#888' }}>{parsed.custMatch.CustArea}</span>
                  <button onClick={() => setParsed(p => ({ ...p, custMatch: null }))}
                    style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: 'none', border: '1px solid #bbb', borderRadius: 4, cursor: 'pointer', color: '#888' }}>
                    변경
                  </button>
                </>
              ) : (
                <CustSelector customers={allCustomers}
                  onSelect={c => setParsed(p => ({ ...p, custMatch: c }))} />
              )}
            </div>

            {/* 품목 목록 */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 14 }}>
              <thead>
                <tr style={{ background: '#1a237e', color: '#fff' }}>
                  <th style={thS(30)}>#</th>
                  <th style={thS(160, 'left')}>입력 품목명</th>
                  <th style={thS(60)}>수량</th>
                  <th style={thS(70)}>단위</th>
                  <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 600 }}>매칭 결과</th>
                  <th style={thS(60)}>건너뛰기</th>
                </tr>
              </thead>
              <tbody>
                {parsed.items.map((it, idx) => (
                  <tr key={idx} style={{
                    background: it.skip ? '#fafafa' : it.prodKey ? '#e8f5e9' : '#fff3e0',
                    opacity: it.skip ? 0.5 : 1,
                    borderBottom: '1px solid #eee',
                  }}>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11 }}>{idx + 1}</td>
                    <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 12 }}>{it.inputName}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="number" min="0" step="0.5" value={it.qty}
                        onChange={e => updateItem(idx, { qty: parseFloat(e.target.value) || 0 })}
                        style={{ width: 56, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, textAlign: 'right', fontSize: 13 }} />
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <select value={it.unit} onChange={e => updateItem(idx, { unit: e.target.value })}
                        style={{ fontSize: 12, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4 }}>
                        <option>박스</option><option>단</option><option>송이</option>
                      </select>
                    </td>
                    <td style={{ padding: '4px 8px' }}>
                      {it.prodKey ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color: '#1b5e20', fontWeight: 600, fontSize: 12 }}>
                            ✅ {it.displayName || it.prodName}
                          </span>
                          <span style={{ color: '#aaa', fontSize: 11 }}>{it.prodName}</span>
                          <button onClick={() => updateItem(idx, { prodKey: null, prodName: null, displayName: null })}
                            style={{ fontSize: 10, padding: '1px 5px', background: 'none', border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer', color: '#aaa', marginLeft: 'auto' }}>
                            변경
                          </button>
                        </div>
                      ) : (
                        <ProdSearchInput
                          value={it.prodSearch}
                          results={it.prodSearchResults}
                          onChange={q => handleProdSearch(idx, q)}
                          onSelect={p => updateItem(idx, { prodKey: p.ProdKey, prodName: p.ProdName, displayName: p.DisplayName || p.ProdName, prodSearch: '', prodSearchResults: [] })}
                        />
                      )}
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      <input type="checkbox" checked={it.skip} onChange={e => updateItem(idx, { skip: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end' }}>
              {resultMsg && (
                <span style={{ fontSize: 13, fontWeight: 600, color: resultMsg.startsWith('✅') ? '#1b5e20' : '#c62828' }}>
                  {resultMsg}
                </span>
              )}
              {unmatched.length > 0 && (
                <span style={{ fontSize: 12, color: '#e65100' }}>⚠️ {unmatched.length}개 미매칭 — 검색 또는 건너뛰기</span>
              )}
              <button
                onClick={handleRegister}
                disabled={saving || matched.length === 0 || !parsed.custMatch || !week}
                style={{
                  padding: '9px 28px', background: (matched.length > 0 && parsed.custMatch && week) ? '#2e7d32' : '#bbb',
                  color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700,
                  cursor: (matched.length > 0 && parsed.custMatch && week) ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? '등록 중...' : `💾 주문등록 (${matched.length}개)`}
              </button>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function CustSelector({ customers, onSelect }) {
  const [q, setQ] = useState('');
  const results = q ? customers.filter(c => c.CustName?.includes(q)) : customers.slice(0, 15);
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input type="text" placeholder="거래처 검색..." value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '4px 8px', border: '1px solid #ffb74d', borderRadius: 4, fontSize: 13 }} />
      {results.length > 0 && q && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 180, overflowY: 'auto' }}>
          {results.map(c => (
            <div key={c.CustKey} style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5' }}
              onMouseDown={() => { onSelect(c); setQ(''); }}>
              <strong>{c.CustName}</strong>
              <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>{c.CustArea}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProdSearchInput({ value, results, onChange, onSelect }) {
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" placeholder="품목명 검색 (한글/영문)..." value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '3px 8px', border: '1px solid #e65100', borderRadius: 4, fontSize: 12 }} />
      {results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, maxHeight: 160, overflowY: 'auto' }}>
          {results.map(p => (
            <div key={p.ProdKey} style={{ padding: '5px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f5f5f5' }}
              onMouseDown={() => onSelect(p)}>
              <strong>{p.DisplayName || p.ProdName}</strong>
              <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>{p.FlowerName} / {p.CounName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const labelS = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };
const thS = (w, align = 'center') => ({ width: w, minWidth: w, padding: '7px 8px', textAlign: align, fontWeight: 600 });
const navBtnS = { padding: '5px 10px', borderRadius: 6, border: '1px solid #bbb', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, color: '#555' };
