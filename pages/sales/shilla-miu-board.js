// 호텔+미우 통합게시판 홈 — 이미지/텍스트 발주를 합쳐 주문만 가산 등록
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { getCurrentWeek } from '../../lib/useWeekInput';
import { getClipboardImage } from '../../lib/raumPnlImage';
import {
  HOTEL_MIU_FAVORITE_PAGE,
  batchQtyDelta,
  mergeDraftLines,
} from '../../lib/hotelMiuIntake';

function defaultScope() {
  const cur = String(getCurrentWeek() || '');
  const m = cur.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { year: m[1], week: `${m[2]}-${m[3]}` };
  const m2 = cur.match(/^(\d{2})-(\d{2})$/);
  return { year: String(new Date().getFullYear()), week: m2 ? cur : '01-01' };
}

const fmt = (n) => Number(n || 0).toLocaleString();
let lineSeq = 1;

export default function HotelMiuIntakePage() {
  const initial = useMemo(() => defaultScope(), []);
  const [year, setYear] = useState(initial.year);
  const [week, setWeek] = useState(initial.week);
  const [favorites, setFavorites] = useState([]);
  const [cust, setCust] = useState(null);
  const [custQ, setCustQ] = useState('');
  const [custHits, setCustHits] = useState([]);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState([]);
  const [batches, setBatches] = useState([]);
  const [editing, setEditing] = useState(null);
  const [picker, setPicker] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const loadFavorites = async () => {
    const d = await apiGet('/api/favorites', { page: HOTEL_MIU_FAVORITE_PAGE });
    const list = (d.favorites || []).map((f) => {
      let data = {};
      try { data = JSON.parse(f.FilterData || '{}'); } catch { data = {}; }
      return {
        favoriteKey: f.FavoriteKey,
        name: f.FavName,
        custKey: Number(data.custKey),
        custName: data.custName || f.FavName,
        week: data.week || '',
        year: data.year || '',
      };
    }).filter((f) => f.custKey);
    setFavorites(list);
    return list;
  };

  const loadBatches = async (nextCust = cust, nextYear = year, nextWeek = week) => {
    if (!nextCust?.custKey || !nextYear || !nextWeek) { setBatches([]); return; }
    const d = await apiGet('/api/sales/hotel-miu-intake', {
      year: nextYear, week: nextWeek, custKey: nextCust.custKey,
    });
    setBatches(d.batches || []);
  };

  useEffect(() => { loadFavorites().catch((e) => setError(e.message)); }, []);
  useEffect(() => { loadBatches().catch((e) => setError(e.message)); }, [cust?.custKey, year, week]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectFav = (f) => {
    setCust({ custKey: f.custKey, custName: f.custName });
    if (f.year) setYear(f.year);
    if (f.week) setWeek(f.week);
  };

  const addFavorite = async (hit) => {
    const name = hit.CustName || hit.custName;
    const key = Number(hit.CustKey || hit.custKey);
    await apiPost('/api/favorites', {
      page: HOTEL_MIU_FAVORITE_PAGE,
      name,
      filterData: JSON.stringify({ custKey: key, custName: name, year, week }),
    });
    const list = await loadFavorites();
    const f = list.find((x) => x.custKey === key);
    if (f) selectFav(f);
    setCustHits([]);
    setCustQ('');
  };

  const removeFavorite = async (f) => {
    await fetch('/api/favorites', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favoriteKey: f.favoriteKey }),
    });
    if (cust?.custKey === f.custKey) setCust(null);
    await loadFavorites();
  };

  const searchCust = async () => {
    if (!custQ.trim()) return;
    const d = await apiGet('/api/customers/search', { q: custQ.trim() });
    setCustHits(d.customers || d.rows || []);
  };

  const appendItems = (items, sourceType) => {
    const next = (items || []).filter((it) => !it.skip && Number(it.qty) > 0).map((it) => ({
      id: lineSeq++,
      inputName: it.inputName,
      qty: Number(it.qty),
      unit: it.unit || '',
      prodKey: it.prodKey || null,
      prodName: it.prodName || it.displayName || '',
      displayName: it.displayName || it.prodName || '',
      sourceType,
      suggestedProducts: it.suggestedProducts || [],
    }));
    setDraft((prev) => [...prev, ...next]);
  };

  const parseText = async () => {
    if (!text.trim()) return;
    setBusy('parse'); setError(''); setMessage('');
    try {
      const d = await apiPost('/api/sales/hotel-miu-parse', { text });
      appendItems(d.items, 'text');
      setText('');
      setMessage(`텍스트 ${d.summary?.matched || 0}/${d.summary?.active || 0}건 매칭`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const parseImage = async (file) => {
    if (!file) return;
    setBusy('parse'); setError(''); setMessage('');
    try {
      const fd = new FormData();
      fd.append('file', file, file.name || `paste-${Date.now()}.png`);
      const res = await fetch('/api/sales/hotel-miu-parse', { method: 'POST', credentials: 'include', body: fd });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || '이미지 분석 실패');
      appendItems(d.items, 'image');
      setMessage(`이미지 ${d.summary?.matched || 0}/${d.summary?.active || 0}건 매칭`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const onPaste = useCallback((e) => {
    const file = getClipboardImage(e.clipboardData?.items);
    if (!file) return;
    e.preventDefault();
    parseImage(file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = useMemo(() => mergeDraftLines(draft), [draft]);
  const unmatched = draft.filter((l) => !l.prodKey);

  const pickProduct = async (line, prod) => {
    const p = {
      prodKey: Number(prod.ProdKey || prod.prodKey),
      ProdKey: Number(prod.ProdKey || prod.prodKey),
      prodName: prod.ProdName || prod.prodName,
      ProdName: prod.ProdName || prod.prodName,
      displayName: prod.DisplayName || prod.displayName,
      DisplayName: prod.DisplayName || prod.displayName,
      FlowerName: prod.FlowerName || prod.flowerName,
      CounName: prod.CounName || prod.counName,
    };
    setDraft((prev) => prev.map((l) => (l.id === line.id
      ? { ...l, prodKey: p.prodKey, prodName: p.prodName, displayName: p.displayName || p.prodName }
      : l)));
    try {
      await apiPost('/api/sales/hotel-miu-intake', {
        action: 'saveMapping', inputName: line.inputName, prod: p, unit: line.unit,
      });
    } catch { /* overlay 저장 실패해도 화면 매칭은 유지 */ }
    setPicker(null);
  };

  const register = async () => {
    if (!cust?.custKey) { setError('업체를 선택하세요.'); return; }
    if (unmatched.length) { setError('미매칭 품목을 먼저 고르세요.'); return; }
    if (!merged.length) { setError('등록할 품목이 없습니다.'); return; }
    if (!window.confirm(`${cust.custName} / ${week}\n${merged.length}개 품목을 주문수량에 더할까요? (출고분배는 하지 않습니다)`)) return;
    setBusy('register'); setError(''); setMessage('');
    try {
      await apiPost('/api/orders', {
        source: 'hotel-miu-board',
        custKey: cust.custKey,
        custName: cust.custName,
        year,
        week,
        items: merged,
      });
      const rec = await apiPost('/api/sales/hotel-miu-intake', {
        action: 'recordBatch',
        year, week, custKey: cust.custKey,
        sourceNote: `주문입력 ${draft.filter((l) => l.sourceType === 'image').length}이미지+${draft.filter((l) => l.sourceType === 'text').length}텍스트`,
        lines: draft,
      });
      setDraft([]);
      setBatches(rec.batches || []);
      setMessage(`${rec.batchNo}차로 주문수량을 더했습니다.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  const saveBatchEdit = async () => {
    if (!editing) return;
    const nextLines = editing.lines;
    const delta = batchQtyDelta(editing.original, nextLines);
    setBusy('edit'); setError('');
    try {
      if (delta.length) {
        await apiPost('/api/orders', {
          source: 'hotel-miu-board',
          custKey: cust.custKey,
          custName: cust.custName,
          year, week,
          items: delta,
        });
      }
      const rec = await apiPost('/api/sales/hotel-miu-intake', {
        action: 'updateBatch',
        year, week, custKey: cust.custKey,
        batchKey: editing.batchKey,
        lines: nextLines,
      });
      setBatches(rec.batches || []);
      setEditing(null);
      setMessage(`${editing.batchNo}차 수량을 수정했습니다.`);
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  return (
    <div style={st.page} onPaste={onPaste}>
      <div style={st.head}>
        <div>
          <h1 style={st.h1}>호텔+미우 통합게시판</h1>
          <p style={st.sub}>이미지·텍스트 발주를 같은 업체·차수에 합친 뒤 주문수량만 더합니다. 출고분배는 하지 않습니다.</p>
        </div>
        <a href="/sales/shilla-miu-allocation" style={st.linkBtn}>잔량분배표</a>
      </div>

      <div style={st.bar}>
        <label>연도 <input style={st.inp} value={year} onChange={(e) => setYear(e.target.value)} /></label>
        <label>차수 <input style={st.inp} value={week} onChange={(e) => setWeek(e.target.value)} placeholder="33-01" title="주문 등록에 쓰는 세부차수" /></label>
        <span style={{ color: '#64748b', fontSize: 12 }}>즐겨찾기 업체</span>
        {favorites.map((f) => (
          <span key={f.favoriteKey} style={{ display: 'inline-flex', gap: 4 }}>
            <button style={cust?.custKey === f.custKey ? st.chipOn : st.chip} onClick={() => selectFav(f)}>{f.custName}</button>
            <button style={st.tiny} onClick={() => removeFavorite(f)} title="즐겨찾기 해제">×</button>
          </span>
        ))}
        <input style={{ ...st.inp, width: 140 }} value={custQ} onChange={(e) => setCustQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchCust()} placeholder="업체 검색 후 추가" />
        <button style={st.btn} onClick={searchCust}>검색</button>
      </div>
      {custHits.length > 0 && (
        <div style={st.hits}>
          {custHits.slice(0, 8).map((c) => (
            <button key={c.CustKey || c.custKey} style={st.chip} onClick={() => addFavorite(c)}>
              + {c.CustName || c.custName}
            </button>
          ))}
        </div>
      )}
      {cust && <div style={st.note}>작업 업체: <b>{cust.custName}</b> · {year} / {week} · 이미 등록한 같은 품목은 주문수량에 더해집니다.</div>}

      <div style={st.grid}>
        <div style={st.panel} onPaste={onPaste}>
          <b>1) 이미지 붙여넣기 / 텍스트 추가</b>
          <div style={st.drop}>이 칸을 클릭한 뒤 Ctrl+V 로 표 사진을 붙여 넣으세요.</div>
          <input type="file" accept="image/*" onChange={(e) => parseImage(e.target.files?.[0])} />
          <textarea style={st.ta} value={text} onChange={(e) => setText(e.target.value)} placeholder={'엑셀에서 복사한 품명 / 단위 / 수량\n수국 화이트\t대\t220'} />
          <button style={st.primary} disabled={busy === 'parse'} onClick={parseText}>{busy === 'parse' ? '분석 중…' : '텍스트로 품목 추가'}</button>
        </div>
        <div style={st.panel}>
          <b>2) 이번 입력 (합치기 전 원행)</b>
          {!draft.length && <div style={st.muted}>아직 추가된 행이 없습니다.</div>}
          {draft.map((l) => (
            <div key={l.id} style={st.row}>
              <span style={{ flex: 1 }}>{l.inputName}</span>
              <span>{l.unit || '-'}</span>
              <input style={{ ...st.inp, width: 64 }} value={l.qty} onChange={(e) => setDraft((p) => p.map((x) => (x.id === l.id ? { ...x, qty: Number(e.target.value) || 0 } : x)))} />
              <button style={l.prodKey ? st.matchOk : st.warn} onClick={() => setPicker(l)}>{l.prodName || '품목 매칭'}</button>
              <button style={st.tiny} onClick={() => setDraft((p) => p.filter((x) => x.id !== l.id))}>×</button>
            </div>
          ))}
          {!!merged.length && (
            <div style={{ marginTop: 10 }}>
              <b>합친 수량 ({merged.length}품목)</b>
              {merged.map((m) => (
                <div key={m.prodKey} style={st.merge}>{m.displayName || m.prodName} · {m.unit} · {fmt(m.qty)}</div>
              ))}
              <button style={st.primary} disabled={!!busy || !cust} onClick={register}>{busy === 'register' ? '등록 중…' : '주문등록 (더하기)'}</button>
            </div>
          )}
        </div>
      </div>

      <div style={st.panel}>
        <b>등록된 차수별 입력 — 1차 / 2차 수정</b>
        {!batches.length && <div style={st.muted}>이 업체·차수에 등록된 입력이 없습니다.</div>}
        {batches.map((b) => (
          <div key={b.batchKey} style={st.batch}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b>{b.batchNo}차</b>
              <span style={st.muted}>{b.createdAt} · {b.sourceNote}</span>
              <button style={st.btn} onClick={() => setEditing({ ...b, original: b.lines.map((l) => ({ ...l })) })}>수정</button>
            </div>
            {b.lines.map((l, i) => (
              <div key={i} style={st.merge}>{l.prodName || l.inputName} · {l.unit} · {fmt(l.qty)}</div>
            ))}
          </div>
        ))}
      </div>

      {editing && (
        <div style={st.modal}>
          <div style={st.modalBox}>
            <b>{editing.batchNo}차 수량 수정</b>
            {editing.lines.map((l, i) => (
              <div key={i} style={st.row}>
                <span style={{ flex: 1 }}>{l.prodName || l.inputName}</span>
                <input style={{ ...st.inp, width: 72 }} value={l.qty} onChange={(e) => {
                  const qty = Number(e.target.value) || 0;
                  setEditing((cur) => ({ ...cur, lines: cur.lines.map((x, idx) => (idx === i ? { ...x, qty } : x)) }));
                }} />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button style={st.primary} disabled={!!busy} onClick={saveBatchEdit}>주문수량에 차이만큼 반영</button>
              <button style={st.btn} onClick={() => setEditing(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {picker && (
        <div style={st.modal}>
          <div style={st.modalBox}>
            <b>품목 매칭 — {picker.inputName}</b>
            <ProductSearch query={picker.inputName} suggestions={picker.suggestedProducts} onPick={(p) => pickProduct(picker, p)} onClose={() => setPicker(null)} />
          </div>
        </div>
      )}

      {message && <div style={st.okMsg}>{message}</div>}
      {error && <div style={st.err}>{error}</div>}
    </div>
  );
}

function ProductSearch({ query, suggestions, onPick, onClose }) {
  const [q, setQ] = useState(query || '');
  const [rows, setRows] = useState(suggestions || []);
  const search = async () => {
    const d = await apiGet('/api/products/search', { q });
    setRows(d.products || d.rows || []);
  };
  useEffect(() => { if (!suggestions?.length) search(); }, []); // eslint-disable-line
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
        <input style={{ ...st.inp, flex: 1, width: 'auto' }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button style={st.btn} onClick={search}>검색</button>
      </div>
      {(Array.isArray(rows) ? rows : []).slice(0, 12).map((p) => (
        <button key={p.ProdKey || p.prodKey} style={{ ...st.chip, display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }} onClick={() => onPick(p)}>
          {p.ProdName || p.prodName} {p.DisplayName || p.displayName ? `(${p.DisplayName || p.displayName})` : ''} · {p.CounName || p.counName || ''}
        </button>
      ))}
      <button style={st.btn} onClick={onClose}>닫기</button>
    </div>
  );
}

const st = {
  page: { padding: 16, maxWidth: 1180, margin: '0 auto', fontSize: 13, color: '#0f172a' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  h1: { margin: 0, fontSize: 20 },
  sub: { margin: '6px 0 0', color: '#64748b', fontSize: 12 },
  bar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '12px 0' },
  inp: { border: '1px solid #cbd5e1', borderRadius: 6, padding: '6px 8px', width: 88 },
  btn: { border: '1px solid #94a3b8', background: '#fff', borderRadius: 6, padding: '6px 10px', cursor: 'pointer' },
  primary: { background: '#0f766e', color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', marginTop: 8 },
  linkBtn: { background: '#1d4ed8', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '8px 12px', fontWeight: 700 },
  chip: { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 999, padding: '4px 10px', cursor: 'pointer' },
  chipOn: { border: '1px solid #0f766e', background: '#ccfbf1', borderRadius: 999, padding: '4px 10px', cursor: 'pointer', fontWeight: 800 },
  tiny: { border: 0, background: 'transparent', cursor: 'pointer', color: '#64748b' },
  hits: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  note: { background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 8, padding: '6px 10px', marginBottom: 10 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  panel: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#fff' },
  drop: { background: '#f8fafc', border: '1px dashed #94a3b8', borderRadius: 8, padding: 16, margin: '8px 0', color: '#475569' },
  ta: { width: '100%', minHeight: 110, border: '1px solid #cbd5e1', borderRadius: 8, padding: 8, marginTop: 8 },
  row: { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f1f5f9' },
  merge: { fontSize: 12, color: '#334155', padding: '2px 0' },
  batch: { borderTop: '1px solid #e2e8f0', padding: '8px 0' },
  muted: { color: '#94a3b8', fontSize: 12 },
  okMsg: { background: '#f0fdf4', color: '#166534', padding: 8, borderRadius: 8, marginTop: 8 },
  err: { background: '#fef2f2', color: '#b91c1c', padding: 8, borderRadius: 8, marginTop: 8 },
  warn: { background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' },
  matchOk: { background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' },
  modal: { position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 40 },
  modalBox: { background: '#fff', padding: 16, width: 'min(560px, 92vw)', maxHeight: '80vh', overflow: 'auto', borderRadius: 10 },
};
