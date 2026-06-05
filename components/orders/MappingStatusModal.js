// components/orders/MappingStatusModal.js
// 붙여넣기 주문등록 — 저장된 매칭 현황 보기 + 개별 삭제.
//   탭: 품목 매핑(order-mappings) / 거래처 매핑(customer-mappings)
//   - 품목별/거래처별로 입력토큰을 묶어 표시
//   - 한 대상(prodKey/custKey)에 입력이 5개 이상이면 "중복/과다 매핑" 강조
//   - 입력토큰 개별 삭제(DELETE)
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';
import { filterProducts, getDisplayName } from '../../lib/displayName';

const FALLBACK_THRESHOLD = 5;

export default function MappingStatusModal({ open, onClose }) {
  const [tab, setTab] = useState('product');
  const [prodMap, setProdMap] = useState({});
  const [custMap, setCustMap] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  // 품목 재지정(잘못 매핑된 입력의 품목만 변경)
  const [products, setProducts] = useState(null);   // null=미로딩
  const [prodLoading, setProdLoading] = useState(false);
  const [editKey, setEditKey] = useState('');       // 수정 중인 입력토큰
  const [editQuery, setEditQuery] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [p, c] = await Promise.all([
        apiGet('/api/orders/mappings').catch(() => ({ mappings: {} })),
        apiGet('/api/orders/customer-mappings').catch(() => ({ mappings: {} })),
      ]);
      setProdMap(p.mappings || {});
      setCustMap(c.mappings || {});
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); setEditKey(''); setEditQuery(''); }
  };

  useEffect(() => { if (open) load(); }, [open]);

  // 대상(prodKey/custKey)별로 입력키를 묶는다.
  const groups = useMemo(() => {
    const src = tab === 'product' ? prodMap : custMap;
    const byTarget = new Map();
    for (const [key, v] of Object.entries(src)) {
      const targetId = tab === 'product' ? v.prodKey : v.custKey;
      const targetName = tab === 'product'
        ? (v.displayName || v.prodName || `품목#${v.prodKey}`)
        : (v.custName || `거래처#${v.custKey}`);
      const gid = String(targetId ?? targetName);
      if (!byTarget.has(gid)) byTarget.set(gid, { targetId, targetName, keys: [] });
      byTarget.get(gid).keys.push({ key, ...v });
    }
    let list = Array.from(byTarget.values());
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(g =>
        String(g.targetName).toLowerCase().includes(q) ||
        g.keys.some(k => String(k.key).toLowerCase().includes(q))
      );
    }
    // 입력 많은(중복 의심) 순 → 이름 순
    list.sort((a, b) => (b.keys.length - a.keys.length) || String(a.targetName).localeCompare(String(b.targetName), 'ko'));
    return list;
  }, [tab, prodMap, custMap, search]);

  const total = tab === 'product' ? Object.keys(prodMap).length : Object.keys(custMap).length;
  const dupGroups = groups.filter(g => g.keys.length >= FALLBACK_THRESHOLD).length;

  const del = async (key) => {
    const path = tab === 'product' ? '/api/orders/mappings' : '/api/orders/customer-mappings';
    try {
      await apiDelete(path, { key });
      if (tab === 'product') setProdMap(prev => { const n = { ...prev }; delete n[key]; return n; });
      else setCustMap(prev => { const n = { ...prev }; delete n[key]; return n; });
    } catch (e) { alert(`삭제 실패: ${e.message}`); }
  };

  // 품목 목록 lazy 로드 (재지정 검색용)
  const ensureProducts = async () => {
    if (products || prodLoading) return;
    setProdLoading(true);
    try {
      const d = await apiGet('/api/master', { entity: 'products' });
      setProducts(d.data || d.products || []);
    } catch (e) { setErr(`품목 로드 실패: ${e.message}`); }
    finally { setProdLoading(false); }
  };

  const startEdit = (key) => { setEditKey(key); setEditQuery(''); ensureProducts(); };
  const cancelEdit = () => { setEditKey(''); setEditQuery(''); };

  // 같은 입력토큰에 새 prodKey 로 덮어쓰기 (force: 명시적 수정이므로 fallback 경고 무시)
  const saveEdit = async (prod) => {
    if (!editKey || !prod) return;
    setSavingEdit(true);
    try {
      await apiPost('/api/orders/mappings', {
        inputToken: editKey,
        prodKey: prod.ProdKey,
        prodName: prod.ProdName,
        displayName: prod.DisplayName || prod.ProdName,
        flowerName: prod.FlowerName,
        counName: prod.CounName,
        force: true,
      });
      setProdMap(prev => ({
        ...prev,
        [editKey]: {
          ...prev[editKey],
          prodKey: prod.ProdKey,
          prodName: prod.ProdName,
          displayName: prod.DisplayName || prod.ProdName,
          flowerName: prod.FlowerName,
          counName: prod.CounName,
        },
      }));
      cancelEdit();
    } catch (e) { alert(`품목 변경 실패: ${e.message}`); }
    finally { setSavingEdit(false); }
  };

  const editCandidates = useMemo(() => {
    if (!editKey || !products) return [];
    const q = editQuery.trim();
    if (!q) return [];
    return filterProducts(products, q).slice(0, 12);
  }, [editKey, products, editQuery]);

  if (!open) return null;

  return (
    <div style={S.back} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <strong style={{ fontSize: 15 }}>저장된 매칭 현황</strong>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={load} style={S.btn}>새로고침</button>
            <button onClick={onClose} style={S.btn}>닫기</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, padding: '8px 10px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => { setTab('product'); cancelEdit(); }} style={tab === 'product' ? S.tabOn : S.tab}>
            품목 매핑 {Object.keys(prodMap).length}
          </button>
          <button onClick={() => { setTab('customer'); cancelEdit(); }} style={tab === 'customer' ? S.tabOn : S.tab}>
            거래처 매핑 {Object.keys(custMap).length}
          </button>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="품목/거래처/입력어 검색"
            style={S.search}
          />
          <span style={{ fontSize: 12, color: '#667085', marginLeft: 'auto' }}>
            총 {total}개 · <span style={{ color: '#c0392b' }}>중복의심 {dupGroups}그룹</span>
          </span>
        </div>

        {err && <div style={{ color: '#c0392b', padding: '6px 12px', fontSize: 12 }}>오류: {err}</div>}

        <div style={S.body}>
          {tab === 'product' && editKey && (
            <div style={S.editor}>
              <div style={S.editorHead}>
                <span style={{ fontSize: 12 }}>
                  🔧 <b>“{editKey}”</b> 품목 변경 — 현재:{' '}
                  <span style={{ color: '#c0392b' }}>
                    {prodMap[editKey]?.displayName || prodMap[editKey]?.prodName || `품목#${prodMap[editKey]?.prodKey}`}
                  </span>
                </span>
                <button onClick={cancelEdit} style={S.btn}>취소</button>
              </div>
              <input
                autoFocus
                value={editQuery}
                onChange={e => setEditQuery(e.target.value)}
                placeholder="새 품목 검색 (한글/영문) — 클릭하면 즉시 변경"
                style={{ ...S.search, width: '100%' }}
              />
              {prodLoading && <div style={S.empty}>품목 불러오는 중…</div>}
              {!prodLoading && editQuery.trim() && editCandidates.length === 0 && (
                <div style={S.empty}>검색 결과가 없습니다.</div>
              )}
              {!prodLoading && !editQuery.trim() && (
                <div style={{ ...S.empty, padding: 8 }}>변경할 품목명을 입력하세요.</div>
              )}
              <div style={S.candList}>
                {editCandidates.map(p => {
                  const sel = Number(p.ProdKey) === Number(prodMap[editKey]?.prodKey);
                  return (
                    <button key={p.ProdKey} disabled={savingEdit || sel} onClick={() => saveEdit(p)} style={{ ...S.cand, ...(sel ? S.candSel : {}) }}>
                      <b>{getDisplayName(p)}</b>
                      <span style={{ color: '#90a4ae', fontSize: 11 }}>
                        {' '}{p.ProdName} · {(p.FlowerName || '')}/{(p.CounName || '')} · key {p.ProdKey}{sel ? ' (현재)' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {loading && <div style={S.empty}>불러오는 중…</div>}
          {!loading && groups.length === 0 && <div style={S.empty}>매핑이 없습니다.</div>}
          {!loading && groups.map(g => {
            const dup = g.keys.length >= FALLBACK_THRESHOLD;
            return (
              <div key={String(g.targetId) + g.targetName} style={{ ...S.group, ...(dup ? S.groupDup : {}) }}>
                <div style={S.groupHead}>
                  <span style={{ fontWeight: 700 }}>{g.targetName}</span>
                  <span style={{ color: '#90a4ae', fontSize: 11 }}>{tab === 'product' ? 'prodKey' : 'custKey'} {String(g.targetId)}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, padding: '1px 7px', borderRadius: 10,
                    background: dup ? '#fdecea' : '#eef2ff', color: dup ? '#c0392b' : '#3949ab', fontWeight: 700,
                  }}>
                    입력 {g.keys.length}개{dup ? ' · 중복/과다 의심' : ''}
                  </span>
                </div>
                <div style={S.chips}>
                  {g.keys.map(k => (
                    <span key={k.key} style={{ ...S.chip, ...(editKey === k.key ? S.chipEditing : {}) }} title={`저장: ${(k.savedAt || '').slice(0, 16).replace('T', ' ')}`}>
                      {k.key}
                      {tab === 'product' && (
                        <button onClick={() => startEdit(k.key)} style={S.chipEdit} title="이 입력의 품목 변경">✎</button>
                      )}
                      <button onClick={() => del(k.key)} style={S.chipX} title="이 입력 매핑 삭제">×</button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const S = {
  back: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', width: 'min(820px, 94vw)', maxHeight: '86vh', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #eceff1' },
  body: { overflowY: 'auto', padding: 10, background: '#fafafa' },
  btn: { border: '1px solid #cfd8dc', background: '#fff', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12 },
  tab: { border: '1px solid #cfd8dc', background: '#fff', borderRadius: 16, padding: '4px 12px', cursor: 'pointer', fontSize: 12 },
  tabOn: { border: '1px solid #3949ab', background: '#3949ab', color: '#fff', borderRadius: 16, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  search: { border: '1px solid #cfd8dc', borderRadius: 5, padding: '4px 8px', fontSize: 12, width: 200 },
  group: { background: '#fff', border: '1px solid #e3e6ea', borderRadius: 6, padding: 8, marginBottom: 6 },
  groupDup: { borderColor: '#f3b7b1', background: '#fffaf9' },
  groupHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 4, background: '#eef2ff', border: '1px solid #d6deff', borderRadius: 12, padding: '2px 4px 2px 8px', fontSize: 12 },
  chipEditing: { background: '#fff7e6', border: '1px solid #ffd591' },
  chipEdit: { border: 0, background: '#ede7f6', color: '#5e35b1', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 11, padding: 0 },
  chipX: { border: 0, background: '#c5cae9', color: '#1a237e', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 12, padding: 0 },
  empty: { color: '#90a4ae', fontSize: 13, padding: 20, textAlign: 'center' },
  editor: { background: '#fffdf5', border: '1px solid #ffe0a3', borderRadius: 8, padding: 10, marginBottom: 8 },
  editorHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  candList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxHeight: 220, overflowY: 'auto' },
  cand: { textAlign: 'left', border: '1px solid #e3e6ea', background: '#fff', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 13 },
  candSel: { background: '#eef2ff', borderColor: '#c5cae9', cursor: 'default' },
};
