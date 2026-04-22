// pages/admin/category-overrides.js — 운송기준원가 "세부카테고리" 관리
// DB(Product.FlowerName)는 건드리지 않고 웹에서만 카테고리 재분류 — 전산 DB 이슈 원천 차단
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Layout from '../../components/Layout';
import { apiGet } from '../../lib/useApi';

export default function CategoryOverridesAdmin() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [msg, setMsg] = useState('');
  const [search, setSearch] = useState('');

  const [addProdSearch, setAddProdSearch] = useState('');
  const [addProdResults, setAddProdResults] = useState([]);
  const [selectedProd, setSelectedProd] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [newNote, setNewNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const d = await apiGet('/api/freight/category-override');
      setList(d.list || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); apiGet('/api/master', { entity: 'products' }).then(d => setProducts(d.data || [])); }, []);

  const save = async (prodKey, category, note) => {
    await fetch('/api/freight/category-override', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ prodKey, category, note }),
    });
    setMsg(`✅ 저장 완료: ${category || '삭제'}`);
    setTimeout(() => setMsg(''), 2000);
    await load();
  };
  const del = async (prodKey) => {
    if (!confirm('이 세부카테고리를 삭제하시겠습니까?')) return;
    await fetch(`/api/freight/category-override?prodKey=${prodKey}`, { method: 'DELETE', credentials: 'same-origin' });
    await load();
  };

  const filtered = search
    ? list.filter(x =>
        (x.prodName || '').toLowerCase().includes(search.toLowerCase()) ||
        (x.category || '').toLowerCase().includes(search.toLowerCase()) ||
        (x.dbFlowerName || '').toLowerCase().includes(search.toLowerCase())
      )
    : list;

  const handleAddSearch = (q) => {
    setAddProdSearch(q);
    if (!q || q.length < 2) { setAddProdResults([]); return; }
    const lower = q.toLowerCase();
    const r = products.filter(p =>
      (p.ProdName || '').toLowerCase().includes(lower) ||
      (p.DisplayName || '').toLowerCase().includes(lower)
    ).slice(0, 15);
    setAddProdResults(r);
  };
  const addOverride = async () => {
    if (!selectedProd || !newCategory.trim()) { alert('품목 + 세부카테고리를 선택/입력하세요.'); return; }
    await save(selectedProd.ProdKey, newCategory.trim(), newNote.trim());
    setSelectedProd(null); setNewCategory(''); setNewNote(''); setAddProdSearch(''); setAddProdResults([]);
  };

  return (
    <Layout title="세부카테고리 관리">
      <Head><title>세부카테고리 관리</title></Head>
      <div style={{ padding: '16px 20px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#1a237e' }}>🏷 세부카테고리 관리</h2>
          <span style={{ fontSize: 11, color: '#888' }}>
            (웹 전용 · Product.FlowerName 미변경 · 전산 DB 안전) · 현재 {list.length}개
          </span>
          <Link href="/freight" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', background: '#1565c0', color: '#fff', borderRadius: 4, textDecoration: 'none' }}>
            🚛 운송기준원가 →
          </Link>
        </div>

        <div style={{ padding: '8px 12px', background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 4, marginBottom: 12, fontSize: 11, color: '#e65100' }}>
          💡 DB의 FlowerName이 &quot;기타&quot; 인데 운송원가 화면에서만 세부 분류가 필요할 때 사용. 여기서 등록한 세부카테고리는 <b>운송원가 화면/엑셀에만 반영</b>되고 DB는 변경되지 않습니다.
        </div>

        {msg && <div style={{ padding: '6px 10px', background: '#e8f5e9', color: '#1b5e20', borderRadius: 4, marginBottom: 10, fontSize: 12 }}>{msg}</div>}

        <div style={{ border: '1px solid #c5cae9', borderRadius: 6, padding: 12, marginBottom: 14, background: '#f3f4ff' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1a237e', marginBottom: 8 }}>➕ 새 세부카테고리 추가</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 250, position: 'relative' }}>
              <input type="text" placeholder="품목명 검색 (2자 이상)" value={addProdSearch}
                onChange={e => handleAddSearch(e.target.value)}
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid #bbb', borderRadius: 4 }} />
              {addProdResults.length > 0 && !selectedProd && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, maxHeight: 240, overflowY: 'auto', zIndex: 10 }}>
                  {addProdResults.map(p => (
                    <div key={p.ProdKey} onClick={() => { setSelectedProd(p); setAddProdSearch(p.ProdName); setAddProdResults([]); }}
                      style={{ padding: '5px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f4ff'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                      <b>{p.DisplayName || p.ProdName}</b>
                      <span style={{ color: '#888', marginLeft: 6, fontSize: 10 }}>{p.ProdName} · {p.FlowerName || '-'} · {p.CounName || '-'}</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedProd && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#388e3c' }}>
                  ✅ {selectedProd.DisplayName || selectedProd.ProdName} (ProdKey {selectedProd.ProdKey}, DB: {selectedProd.FlowerName || '-'})
                  <button onClick={() => { setSelectedProd(null); setAddProdSearch(''); }} style={{ marginLeft: 8, fontSize: 10, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer' }}>× 취소</button>
                </div>
              )}
            </div>
            <input type="text" placeholder="세부카테고리 (예: 줄맨드라미, 기타-녹색)" value={newCategory}
              list="known-categories" onChange={e => setNewCategory(e.target.value)}
              style={{ width: 200, padding: '6px 10px', fontSize: 12, border: '1px solid #bbb', borderRadius: 4 }} />
            <input type="text" placeholder="메모 (선택)" value={newNote}
              onChange={e => setNewNote(e.target.value)}
              style={{ width: 200, padding: '6px 10px', fontSize: 12, border: '1px solid #bbb', borderRadius: 4 }} />
            <button onClick={addOverride}
              style={{ padding: '6px 16px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              💾 저장
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <input type="text" placeholder="목록 검색 (품목명/세부카테고리/DB값)"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: 280, padding: '5px 10px', fontSize: 12, border: '1px solid #bbb', borderRadius: 4 }} />
        </div>

        {loading ? <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>로딩 중...</div> : (
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#e8eaf6' }}>
                  <th style={th}>ProdKey</th>
                  <th style={th}>품목명</th>
                  <th style={th}>DisplayName</th>
                  <th style={th}>국가</th>
                  <th style={{ ...th, background: '#fff9c4' }}>DB 카테고리</th>
                  <th style={{ ...th, background: '#c5e1a5' }}>세부카테고리</th>
                  <th style={th}>메모</th>
                  <th style={th}>저장일시</th>
                  <th style={th}>동작</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: '#888' }}>
                    세부카테고리 등록된 품목 없음. 위에서 추가하거나 운송기준원가 페이지 카테고리 셀에서 등록하세요.
                  </td></tr>
                )}
                {filtered.map(x => (
                  <OverrideRow key={x.prodKey} item={x} onSave={save} onDelete={del} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <datalist id="known-categories">
          {['장미','카네이션','리모니움','유칼립투스','리시안서스','안개꽃','아스파라거스','스프레이카네이션','알스트로','루스커스','릴리','튤립','소국','기타','줄맨드라미'].map(c => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>
    </Layout>
  );
}

function OverrideRow({ item, onSave, onDelete }) {
  const [cat, setCat] = useState(item.category);
  const [note, setNote] = useState(item.note);
  const [dirty, setDirty] = useState(false);
  return (
    <tr style={{ borderBottom: '1px solid #f0f0f0', background: dirty ? '#fffde7' : undefined }}>
      <td style={td}>{item.prodKey}</td>
      <td style={{ ...td, fontSize: 11 }}>{item.prodName}</td>
      <td style={{ ...td, fontSize: 11 }}>{item.displayName || '-'}</td>
      <td style={{ ...td, textAlign: 'center', fontSize: 11 }}>{item.counName || '-'}</td>
      <td style={{ ...td, background: '#fff9c4', fontWeight: 600 }}>{item.dbFlowerName || '-'}</td>
      <td style={{ ...td, background: '#f1f8e9' }}>
        <input list="known-categories" value={cat}
          onChange={e => { setCat(e.target.value); setDirty(true); }}
          style={{ width: 140, padding: '3px 6px', fontSize: 11, border: '1px solid #a5d6a7', borderRadius: 3 }} />
      </td>
      <td style={td}>
        <input type="text" value={note}
          onChange={e => { setNote(e.target.value); setDirty(true); }}
          style={{ width: 160, padding: '3px 6px', fontSize: 11, border: '1px solid #ddd', borderRadius: 3 }} />
      </td>
      <td style={{ ...td, fontSize: 10, color: '#888' }}>{item.savedAt ? new Date(item.savedAt).toLocaleString('ko-KR') : '-'}</td>
      <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {dirty && <button onClick={() => { onSave(item.prodKey, cat, note); setDirty(false); }}
          style={{ padding: '3px 10px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 3, fontSize: 10, fontWeight: 700, cursor: 'pointer', marginRight: 3 }}>💾 저장</button>}
        <button onClick={() => onDelete(item.prodKey)}
          style={{ padding: '3px 10px', background: '#fff', color: '#c62828', border: '1px solid #ffcdd2', borderRadius: 3, fontSize: 10, cursor: 'pointer' }}>🗑</button>
      </td>
    </tr>
  );
}

const th = { padding: '6px 8px', textAlign: 'center', fontWeight: 700, fontSize: 11, color: '#333', borderBottom: '1px solid #c5cae9' };
const td = { padding: '5px 8px' };
