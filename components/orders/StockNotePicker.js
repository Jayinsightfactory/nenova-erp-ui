// components/orders/StockNotePicker.js
// 시작재고(기존재고) 저장본을 여러 개 골라 불러오는 피커.
//  - 저장된 시작재고 목록(여러 차수/여러 건)을 체크박스로 다중 선택
//  - "합쳐서 불러오기"(기존 입력에 추가) 또는 "교체로 불러오기"
//  notes: [{ FavoriteKey, data:{ baseWeek, baseStockText, savedAt? } }]
//  onApply(combinedText, mode)  mode: 'append' | 'replace'
import { useEffect, useMemo, useState } from 'react';

export default function StockNotePicker({ open, notes, onApply, onClose, formatWeek }) {
  const [picked, setPicked] = useState(() => new Set());

  useEffect(() => { if (open) setPicked(new Set()); }, [open]);

  // 최신(FavoriteKey 큰) 순
  const list = useMemo(() => {
    return (notes || [])
      .filter(n => n?.data?.baseWeek)
      .slice()
      .sort((a, b) => Number(b.FavoriteKey) - Number(a.FavoriteKey));
  }, [notes]);

  const toggle = (key) => setPicked(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  const allKeys = list.map(n => n.FavoriteKey);
  const allOn = allKeys.length > 0 && allKeys.every(k => picked.has(k));
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(allKeys));

  const combinedText = useMemo(() => {
    return list
      .filter(n => picked.has(n.FavoriteKey))
      .map(n => (n.data.baseStockText || '').trim())
      .filter(Boolean)
      .join('\n');
  }, [list, picked]);

  if (!open) return null;

  const apply = (mode) => {
    if (!picked.size) { alert('불러올 시작재고를 1개 이상 선택하세요.'); return; }
    onApply(combinedText, mode);
  };

  return (
    <div style={S.back} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.head}>
          <strong style={{ fontSize: 15 }}>시작재고 불러오기 (여러 개 선택)</strong>
          <button onClick={onClose} style={S.btn}>닫기</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eceff1' }}>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={allOn} onChange={toggleAll} /> 전체선택
          </label>
          <span style={{ fontSize: 12, color: '#667085', marginLeft: 'auto' }}>
            선택 {picked.size}건 · 저장본 {list.length}건
          </span>
        </div>

        <div style={S.body}>
          {list.length === 0 && <div style={S.empty}>저장된 시작재고가 없습니다.</div>}
          {list.map(n => {
            const on = picked.has(n.FavoriteKey);
            const text = (n.data.baseStockText || '').trim();
            const preview = text.split('\n').slice(0, 4).join('\n');
            const lineCount = text ? text.split('\n').filter(Boolean).length : 0;
            return (
              <label key={n.FavoriteKey} style={{ ...S.item, ...(on ? S.itemOn : {}) }}>
                <input type="checkbox" checked={on} onChange={() => toggle(n.FavoriteKey)} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700 }}>{formatWeek ? formatWeek(n.data.baseWeek) : n.data.baseWeek}</span>
                    <span style={{ fontSize: 11, color: '#90a4ae' }}>{lineCount}줄</span>
                    {n.data.savedAt && <span style={{ fontSize: 11, color: '#b0bec5' }}>{String(n.data.savedAt).slice(0, 16).replace('T', ' ')}</span>}
                  </div>
                  <pre style={S.preview}>{preview || '(내용 없음)'}</pre>
                </div>
              </label>
            );
          })}
        </div>

        <div style={S.foot}>
          <span style={{ fontSize: 12, color: '#667085', marginRight: 'auto' }}>합치면 총 {combinedText ? combinedText.split('\n').filter(Boolean).length : 0}줄</span>
          <button onClick={() => apply('append')} style={S.primary} disabled={!picked.size}>＋ 기존에 합쳐 불러오기</button>
          <button onClick={() => apply('replace')} style={S.btn} disabled={!picked.size}>교체로 불러오기</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  back: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { background: '#fff', width: 'min(720px, 94vw)', maxHeight: '86vh', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #eceff1' },
  body: { overflowY: 'auto', padding: 8, background: '#fafafa', flex: 1 },
  foot: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid #eceff1' },
  btn: { border: '1px solid #cfd8dc', background: '#fff', borderRadius: 5, padding: '6px 12px', cursor: 'pointer', fontSize: 13 },
  primary: { border: 'none', background: '#1565c0', color: '#fff', borderRadius: 5, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700 },
  item: { display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fff', border: '1px solid #e3e6ea', borderRadius: 6, padding: 8, marginBottom: 6, cursor: 'pointer' },
  itemOn: { borderColor: '#1565c0', background: '#f3f8ff' },
  preview: { margin: '4px 0 0', fontSize: 11, color: '#546e7a', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 70, overflow: 'hidden', fontFamily: 'monospace' },
  empty: { color: '#90a4ae', fontSize: 13, padding: 20, textAlign: 'center' },
};
