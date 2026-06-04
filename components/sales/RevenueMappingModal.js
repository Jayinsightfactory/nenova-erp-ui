// components/sales/RevenueMappingModal.js
// 영업매출관리 — 저장된 "업체 매칭 내역"(이카운트 원본 거래처명 → 통용명) 보기/수정/삭제.
//   GET    /api/sales/revenue-customer-mappings       → 전체 매핑
//   POST   (ecountName, canonicalName, ...)           → 통용명 수정(같은 ecountName upsert)
//   DELETE { key }                                    → 매핑 삭제
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiDelete } from '../../lib/useApi';
import { BASE_CUSTOMERS } from '../../lib/salesRevenueConfig';

export default function RevenueMappingModal({ open, onClose, onChanged }) {
  const [rows, setRows] = useState([]);     // [{ key, ecountName, canonicalName, custArea, custName, note, savedAt, _edit }]
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newEcount, setNewEcount] = useState('');
  const [newCanon, setNewCanon] = useState('');
  const [adding, setAdding] = useState(false);

  const addMapping = async () => {
    const ecount = newEcount.trim();
    const canon = newCanon.trim();
    if (!ecount || !canon) { alert('이카운트 원본 거래처명과 통용명을 모두 입력하세요.'); return; }
    setAdding(true); setErr(''); setMsg('');
    try {
      await apiPost('/api/sales/revenue-customer-mappings', { ecountName: ecount, canonicalName: canon });
      setMsg(`추가됨: ${ecount} → ${canon}`);
      setNewEcount(''); setNewCanon('');
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setAdding(false); }
  };

  const load = async () => {
    setLoading(true); setErr(''); setMsg('');
    try {
      const d = await apiGet('/api/sales/revenue-customer-mappings');
      const list = Object.entries(d.mappings || {}).map(([key, v]) => ({
        key,
        ecountName: v.ecountName || '',
        canonicalName: v.canonicalName || '',
        custArea: v.custArea || '',
        custName: v.custName || '',
        custKey: v.custKey ?? null,
        note: v.note || '',
        savedAt: v.savedAt || '',
        _edit: v.canonicalName || '',
      }));
      list.sort((a, b) => String(a.canonicalName).localeCompare(String(b.canonicalName), 'ko') || String(a.ecountName).localeCompare(String(b.ecountName), 'ko'));
      setRows(list);
    } catch (e) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (open) { setSearch(''); load(); } }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.ecountName.toLowerCase().includes(q) ||
      r.canonicalName.toLowerCase().includes(q) ||
      r.custArea.toLowerCase().includes(q));
  }, [rows, search]);

  const setEdit = (key, val) => setRows(prev => prev.map(r => r.key === key ? { ...r, _edit: val } : r));

  const saveRow = async (r) => {
    const next = (r._edit || '').trim();
    if (!next) { alert('통용명을 입력하세요.'); return; }
    if (next === r.canonicalName) { setMsg('변경사항이 없습니다.'); return; }
    setBusyKey(r.key); setErr(''); setMsg('');
    try {
      await apiPost('/api/sales/revenue-customer-mappings', {
        ecountName: r.ecountName,
        canonicalName: next,
        custKey: r.custKey,
        custName: r.custName,
        custArea: r.custArea,
        note: r.note,
      });
      setRows(prev => prev.map(x => x.key === r.key ? { ...x, canonicalName: next, _edit: next } : x));
      setMsg(`수정됨: ${r.ecountName} → ${next}`);
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusyKey(''); }
  };

  const deleteRow = async (r) => {
    if (!confirm(`매칭 삭제\n원본: ${r.ecountName}\n통용명: ${r.canonicalName}\n\n삭제하면 다음 업로드부터 이 업체는 자동매칭되지 않습니다. 진행할까요?`)) return;
    setBusyKey(r.key); setErr(''); setMsg('');
    try {
      await apiDelete('/api/sales/revenue-customer-mappings', { key: r.key });
      setRows(prev => prev.filter(x => x.key !== r.key));
      setMsg(`삭제됨: ${r.ecountName}`);
      onChanged?.();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusyKey(''); }
  };

  if (!open) return null;

  return (
    <div style={S.back} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <strong style={{ fontSize: 15 }}>업체 매칭 내역 (수정/삭제)</strong>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="원본/통용명/지점 검색" style={S.search} />
            <button onClick={load} style={S.btn}>새로고침</button>
            <button onClick={onClose} style={S.btn}>닫기</button>
          </div>
        </div>

        {/* 새 매칭 직접 추가 (원본 없는 통용명: 꽃동산/레바논 등) */}
        <div style={S.addBar}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#37474f' }}>＋ 새 매칭</span>
          <input value={newEcount} onChange={e => setNewEcount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMapping(); }}
            placeholder="이카운트 원본 거래처명" style={{ ...S.input, width: 220 }} />
          <span style={{ color: '#90a4ae' }}>→</span>
          <input value={newCanon} onChange={e => setNewCanon(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addMapping(); }}
            list="rev-canon-list" placeholder="통용명 (예: 꽃동산, 레바논)" style={{ ...S.input, width: 180 }} />
          <datalist id="rev-canon-list">
            {(BASE_CUSTOMERS || []).map(n => <option key={n} value={n} />)}
          </datalist>
          <button onClick={addMapping} disabled={adding} style={S.addBtn}>{adding ? '추가중…' : '추가'}</button>
        </div>

        <div style={{ padding: '6px 12px', fontSize: 12, color: '#667085', display: 'flex', gap: 12 }}>
          <span>총 {rows.length}건 · 표시 {filtered.length}건</span>
          {err && <span style={{ color: '#c0392b' }}>오류: {err}</span>}
          {msg && <span style={{ color: '#1b5e20' }}>{msg}</span>}
        </div>

        <div style={S.body}>
          {loading && <div style={S.empty}>불러오는 중…</div>}
          {!loading && filtered.length === 0 && <div style={S.empty}>매칭 내역이 없습니다.</div>}
          {!loading && filtered.length > 0 && (
            <table style={S.tbl}>
              <thead>
                <tr>
                  <th style={S.th}>이카운트 원본 거래처명</th>
                  <th style={S.th}>통용명 (수정)</th>
                  <th style={S.th}>지점</th>
                  <th style={S.th}>저장일</th>
                  <th style={S.th}>작업</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const dirty = (r._edit || '').trim() !== r.canonicalName;
                  return (
                    <tr key={r.key} style={dirty ? { background: '#fffaf0' } : {}}>
                      <td style={S.td}>{r.ecountName}</td>
                      <td style={S.td}>
                        <input
                          value={r._edit}
                          onChange={e => setEdit(r.key, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveRow(r); }}
                          style={{ ...S.input, ...(dirty ? { borderColor: '#e65100' } : {}) }}
                        />
                      </td>
                      <td style={S.td}>{r.custArea || '-'}</td>
                      <td style={{ ...S.td, color: '#90a4ae' }}>{(r.savedAt || '').slice(0, 16).replace('T', ' ')}</td>
                      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
                        <button onClick={() => saveRow(r)} disabled={busyKey === r.key || !dirty}
                          style={{ ...S.act, ...(dirty ? S.actOn : {}) }}>저장</button>
                        <button onClick={() => deleteRow(r)} disabled={busyKey === r.key}
                          style={{ ...S.act, ...S.actDel }}>삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  back: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', width: 'min(900px, 95vw)', maxHeight: '88vh', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #eceff1' },
  search: { border: '1px solid #cfd8dc', borderRadius: 5, padding: '5px 8px', fontSize: 12, width: 200 },
  btn: { border: '1px solid #cfd8dc', background: '#fff', borderRadius: 5, padding: '5px 10px', cursor: 'pointer', fontSize: 12 },
  body: { overflow: 'auto', padding: 10, background: '#fafafa', flex: 1 },
  tbl: { borderCollapse: 'collapse', width: '100%', fontSize: 12, background: '#fff' },
  th: { background: '#eceff1', padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #cfd8dc', position: 'sticky', top: 0, whiteSpace: 'nowrap' },
  td: { padding: '4px 8px', borderBottom: '1px solid #eee' },
  input: { width: '100%', minWidth: 120, border: '1px solid #cfd8dc', borderRadius: 4, padding: '4px 6px', fontSize: 12 },
  act: { border: '1px solid #cfd8dc', background: '#fff', borderRadius: 5, padding: '3px 9px', cursor: 'pointer', fontSize: 12, marginRight: 4 },
  actOn: { border: 'none', background: '#1565c0', color: '#fff', fontWeight: 700 },
  actDel: { border: '1px solid #ef9a9a', color: '#c0392b' },
  empty: { color: '#90a4ae', fontSize: 13, padding: 24, textAlign: 'center' },
  addBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eceff1', background: '#f3f8ff', flexWrap: 'wrap' },
  addBtn: { border: 'none', background: '#2e7d32', color: '#fff', borderRadius: 5, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
};
