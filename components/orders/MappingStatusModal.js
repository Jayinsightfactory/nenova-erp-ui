// components/orders/MappingStatusModal.js
// 붙여넣기 주문등록 — 저장된 매칭 현황 보기 + 개별 삭제.
//   탭: 품목 매핑(order-mappings) / 거래처 매핑(customer-mappings)
//   - 품목별/거래처별로 입력토큰을 묶어 표시
//   - 한 대상(prodKey/custKey)에 입력이 5개 이상이면 "중복/과다 매핑" 강조
//   - 입력토큰 개별 삭제(DELETE)
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiDelete } from '../../lib/useApi';

const FALLBACK_THRESHOLD = 5;

export default function MappingStatusModal({ open, onClose }) {
  const [tab, setTab] = useState('product');
  const [prodMap, setProdMap] = useState({});
  const [custMap, setCustMap] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

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
    finally { setLoading(false); }
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
          <button onClick={() => setTab('product')} style={tab === 'product' ? S.tabOn : S.tab}>
            품목 매핑 {Object.keys(prodMap).length}
          </button>
          <button onClick={() => setTab('customer')} style={tab === 'customer' ? S.tabOn : S.tab}>
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
                    <span key={k.key} style={S.chip} title={`저장: ${(k.savedAt || '').slice(0, 16).replace('T', ' ')}`}>
                      {k.key}
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
  chipX: { border: 0, background: '#c5cae9', color: '#1a237e', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 12, padding: 0 },
  empty: { color: '#90a4ae', fontSize: 13, padding: 20, textAlign: 'center' },
};
