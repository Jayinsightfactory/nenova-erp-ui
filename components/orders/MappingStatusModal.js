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

// 거래처명 오염 감지에서 제외할 토큰(국가/꽃/색/수식어) — 거래처가 우연히 같은 이름이어도 오탐 방지
const POLLUTION_EXCLUDE = new Set([
  '콜롬비아', '콜', '중국', '네덜란드', '에콰도르', '에콰', '태국', '호주', '베트남', '스페인', 'nl',
  '수국', '장미', '카네이션', '카네', '루스커스', '튤립', '알스트로', '소재',
  '화이트', '블루', '연핑크', '진핑크', '핑크', '그린', '연그린', '진그린', '레드', '라벤더', '라벤다',
  '피치', '옐로', '오렌지', '퍼플', '크림', '살몬', '버건디', '샴페인',
  '차', '여분', '여분코드', '변경사항',
]);

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
  const [editKeys, setEditKeys] = useState([]);     // 수정 중인 입력토큰들 (1개=chip, N개=그룹 전체)
  const [editTitle, setEditTitle] = useState('');   // 에디터 헤더 라벨
  const [editCurKey, setEditCurKey] = useState(null); // 현재 prodKey (선택표시용)
  const [editQuery, setEditQuery] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [custList, setCustList] = useState([]);     // 거래처명 오염 감지용 전체 거래처

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [p, c, cu] = await Promise.all([
        apiGet('/api/orders/mappings').catch(() => ({ mappings: {} })),
        apiGet('/api/orders/customer-mappings').catch(() => ({ mappings: {} })),
        apiGet('/api/master', { entity: 'customers' }).catch(() => ({ data: [] })),
      ]);
      setCustList(cu.data || cu.customers || []);
      setProdMap(p.mappings || {});
      setCustMap(c.mappings || {});
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); setEditKeys([]); setEditQuery(''); }
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

  // 단일 입력(chip) 품목 변경
  const startEdit = (key) => {
    setEditKeys([key]); setEditTitle(`“${key}”`); setEditCurKey(prodMap[key]?.prodKey ?? null);
    setEditQuery(''); ensureProducts();
  };
  // 그룹 헤더 — 같은 품목으로 묶인 입력 전체를 한 번에 다른 품목으로 재지정
  const startEditGroup = (g) => {
    setEditKeys(g.keys.map(k => k.key));
    setEditTitle(`그룹 “${g.targetName}” · 입력 ${g.keys.length}개 전체`);
    setEditCurKey(g.targetId ?? null);
    setEditQuery(''); ensureProducts();
  };
  const cancelEdit = () => { setEditKeys([]); setEditQuery(''); };

  // 입력토큰(들)에 새 prodKey 로 덮어쓰기 (force: 명시적 수정이므로 fallback 경고 무시)
  const saveEdit = async (prod) => {
    if (!editKeys.length || !prod) return;
    if (editKeys.length > 1 && !window.confirm(`입력 ${editKeys.length}개 전체를 “${prod.DisplayName || prod.ProdName}” (으)로 변경할까요?`)) return;
    setSavingEdit(true);
    const next = {
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
    };
    try {
      for (const k of editKeys) {
        await apiPost('/api/orders/mappings', { inputToken: k, ...next, force: true });
      }
      setProdMap(prev => {
        const n = { ...prev };
        for (const k of editKeys) if (n[k]) n[k] = { ...n[k], ...next };
        return n;
      });
      cancelEdit();
    } catch (e) { alert(`품목 변경 실패: ${e.message}`); }
    finally { setSavingEdit(false); }
  };

  // 품목 검색 — 토큰 AND 부분일치(숫자 cm 포함) + 한↔영/자모 보강. "pink mondial 50" 같은 입력도 잡음.
  const editCandidates = useMemo(() => {
    if (!editKeys.length || !products) return [];
    const q = editQuery.trim().toLowerCase();
    if (!q) return [];
    const toks = q.split(/\s+/).filter(Boolean);
    const hay = p => `${p.ProdName || ''} ${p.DisplayName || ''} ${p.FlowerName || ''} ${p.CounName || ''}`.toLowerCase();
    const andHits = products.filter(p => { const h = hay(p); return toks.every(t => h.includes(t)); });
    const fuzzy = filterProducts(products, editQuery).slice(0, 20);
    const seen = new Set(); const out = [];
    for (const p of [...andHits, ...fuzzy]) { const k = Number(p.ProdKey); if (!seen.has(k)) { seen.add(k); out.push(p); } }
    return out.slice(0, 20);
  }, [editKeys, products, editQuery]);

  // ── 거래처명 오염 감지 (품목 매핑 키에 거래처 이름이 섞인 경우)
  const custNameSet = useMemo(() => {
    const s = new Set();
    const norm = x => String(x || '').toLowerCase().replace(/\s+/g, '');
    for (const c of custList) {
      const n = norm(c.CustName); if (n.length >= 2) s.add(n);
      const first = norm(String(c.CustName || '').split(/[\s/]/)[0]); if (first.length >= 2) s.add(first);
    }
    for (const v of Object.values(custMap)) { const n = norm(v.custName); if (n.length >= 2) s.add(n); }
    return s;
  }, [custList, custMap]);

  const pollutedCustomer = (key) => {
    if (!custNameSet.size) return null;
    const toks = String(key || '').toLowerCase().split(/\s+/);
    for (let t of toks) {
      t = t.replace(/[()]/g, '');
      if (t.length >= 2 && !POLLUTION_EXCLUDE.has(t) && custNameSet.has(t)) return t;
    }
    return null;
  };

  const pollutedKeys = useMemo(
    () => Object.keys(prodMap).filter(k => pollutedCustomer(k)),
    [prodMap, custNameSet]   // eslint-disable-line react-hooks/exhaustive-deps
  );

  const cleanupPolluted = async () => {
    if (!pollutedKeys.length) return;
    if (!window.confirm(`거래처명이 섞인 품목 매핑 ${pollutedKeys.length}개를 삭제할까요?\n(거래처명 없는 깨끗한 입력 매핑은 유지됩니다)`)) return;
    for (const k of pollutedKeys) { try { await apiDelete('/api/orders/mappings', { key: k }); } catch { /* skip */ } }
    setProdMap(prev => { const n = { ...prev }; for (const k of pollutedKeys) delete n[k]; return n; });
  };

  if (!open) return null;

  return (
    <div style={S.back} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={S.modal} onMouseDown={e => e.stopPropagation()}>
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

        {tab === 'product' && pollutedKeys.length > 0 && (
          <div style={{ padding: '6px 10px 0' }}>
            <button onClick={cleanupPolluted} style={S.cleanBtn} title="품목 매핑 키에 거래처 이름이 섞인 입력을 일괄 삭제합니다 (깨끗한 입력은 유지)">
              ⚠ 거래처명 섞인 입력 {pollutedKeys.length}개 정리
            </button>
          </div>
        )}

        {err && <div style={{ color: '#c0392b', padding: '6px 12px', fontSize: 12 }}>오류: {err}</div>}

        <div style={S.body}>
          {tab === 'product' && editKeys.length > 0 && (
            <div style={S.editor}>
              <div style={S.editorHead}>
                <span style={{ fontSize: 12 }}>
                  🔧 <b>{editTitle}</b> 품목 변경
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
                  const sel = Number(p.ProdKey) === Number(editCurKey);
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
                  {tab === 'product' && g.targetId != null && (
                    <button onClick={() => startEditGroup(g)} style={S.headEdit} title="이 그룹 전체의 품목을 한 번에 변경">✎ 품목변경</button>
                  )}
                  <span style={{ color: '#90a4ae', fontSize: 11 }}>{tab === 'product' ? 'prodKey' : 'custKey'} {String(g.targetId)}</span>
                  <span style={{
                    marginLeft: 'auto', fontSize: 11, padding: '1px 7px', borderRadius: 10,
                    background: dup ? '#fdecea' : '#eef2ff', color: dup ? '#c0392b' : '#3949ab', fontWeight: 700,
                  }}>
                    입력 {g.keys.length}개{dup ? ' · 중복/과다 의심' : ''}
                  </span>
                </div>
                <div style={S.chips}>
                  {g.keys.map(k => {
                    const poll = tab === 'product' ? pollutedCustomer(k.key) : null;
                    return (
                    <span key={k.key} style={{ ...S.chip, ...(editKeys.includes(k.key) ? S.chipEditing : {}), ...(poll ? S.chipPolluted : {}) }} title={poll ? `거래처명 "${poll}" 섞임 — 정리 권장` : `저장: ${(k.savedAt || '').slice(0, 16).replace('T', ' ')}`}>
                      {poll && <span style={{ color: '#c0392b', fontWeight: 700 }}>⚠</span>}
                      {k.key}
                      {tab === 'product' && (
                        <button onClick={() => startEdit(k.key)} style={S.chipEdit} title="이 입력의 품목 변경">✎</button>
                      )}
                      <button onClick={() => del(k.key)} style={S.chipX} title="이 입력 매핑 삭제">×</button>
                    </span>
                    );
                  })}
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
  headEdit: { border: '1px solid #d1c4e9', background: '#ede7f6', color: '#5e35b1', borderRadius: 12, padding: '1px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 },
  chipEditing: { background: '#fff7e6', border: '1px solid #ffd591' },
  chipPolluted: { background: '#fdecea', border: '1px solid #f3b7b1' },
  cleanBtn: { border: '1px solid #f3b7b1', background: '#fff5f5', color: '#c0392b', borderRadius: 16, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  chipEdit: { border: 0, background: '#ede7f6', color: '#5e35b1', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 11, padding: 0 },
  chipX: { border: 0, background: '#c5cae9', color: '#1a237e', borderRadius: '50%', width: 16, height: 16, lineHeight: '14px', cursor: 'pointer', fontSize: 12, padding: 0 },
  empty: { color: '#90a4ae', fontSize: 13, padding: 20, textAlign: 'center' },
  editor: { background: '#fffdf5', border: '1px solid #ffe0a3', borderRadius: 8, padding: 10, marginBottom: 8 },
  editorHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  candList: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxHeight: 220, overflowY: 'auto' },
  cand: { textAlign: 'left', border: '1px solid #e3e6ea', background: '#fff', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', fontSize: 13 },
  candSel: { background: '#eef2ff', borderColor: '#c5cae9', cursor: 'default' },
};
