import { useMemo, useRef, useState } from 'react';
import {
  buildRaumOrderItems,
  buildRaumPnlItems,
  getClipboardImage,
  formatRaumUnit,
  groupRaumImageRows,
  isRaumImageDraftComplete,
  normalizeRaumUnit,
  parseImageNumber,
} from '../../lib/raumPnlImage';

const cell = { border: '1px solid #e2e8f0', padding: '5px 7px', fontSize: 12, verticalAlign: 'top' };
const input = { border: '1px solid #cbd5e1', borderRadius: 4, padding: '4px 6px', fontSize: 12, width: 76 };
const button = { border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', padding: '4px 8px', cursor: 'pointer', fontSize: 11.5 };

function ProductPicker({ group, onPick, onClose }) {
  const [q, setQ] = useState(group.inputName || '');
  const [products, setProducts] = useState(group.suggestedProducts || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const search = async (value = q) => {
    const term = String(value || '').trim();
    if (!term) return;
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/raum/item-mapping?q=${encodeURIComponent(term)}`);
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '품목 검색 실패');
      setProducts(j.products || []);
      if (!(j.products || []).length) setError('검색 결과가 없습니다. 기준정보에서 신규 상품을 먼저 등록하세요.');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 'min(760px,95vw)', maxHeight: '86vh', overflow: 'auto', background: '#fff', borderRadius: 10, padding: 18, boxShadow: '0 12px 44px rgba(0,0,0,.25)' }}>
        <b style={{ fontSize: 15 }}>품목 검색/매칭 — {group.inputName}</b>
        <div style={{ margin: '8px 0', color: '#64748b', fontSize: 12 }}>
          상단 추천 품목을 먼저 보여주며, 검색 결과를 선택하면 같은 품목·가격 그룹 전체에 적용합니다.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} style={{ ...input, flex: 1, width: 'auto' }} placeholder="품목명/품종/원산지" />
          <button style={{ ...button, background: '#2563eb', borderColor: '#2563eb', color: '#fff' }} disabled={loading} onClick={() => search()}>{loading ? '검색 중…' : '🔍 검색'}</button>
        </div>
        {error ? <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 8 }}>{error}</div> : null}
        {products.length ? (
          <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 10 }}>
            <thead><tr>{['품목', '꽃/분류', '원산지', '단위', ''].map(h => <th key={h} style={{ ...cell, background: '#f1f5f9' }}>{h}</th>)}</tr></thead>
            <tbody>{products.map((p, i) => (
              <tr key={p.prodKey || p.ProdKey || i}>
                <td style={cell}>{p.prodName || p.ProdName}{p.displayName || p.DisplayName ? ` (${p.displayName || p.DisplayName})` : ''}{i === 0 && group.suggestedProducts?.length ? <span style={{ color: '#2563eb', marginLeft: 5 }}>추천</span> : null}</td>
                <td style={cell}>{p.flowerName || p.FlowerName || ''}</td>
                <td style={cell}>{p.counName || p.CounName || ''}</td>
                <td style={cell}>{p.outUnit || p.OutUnit || ''}</td>
                <td style={cell}><button style={{ ...button, color: '#166534', borderColor: '#86efac' }} onClick={() => onPick(p)}>선택</button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <a href="/master/products" target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2563eb' }}>기준정보에서 신규 상품 등록</a>
          <span style={{ flex: 1 }} />
          <button style={button} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function RaumImageOrderPanel({ open, onClose, onPreview, onSaveDraft, savingDraft = false }) {
  const fileRef = useRef(null);
  const [images, setImages] = useState([]);
  const [lines, setLines] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [picker, setPicker] = useState(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [week, setWeek] = useState('');
  const [registering, setRegistering] = useState(false);
  const [registered, setRegistered] = useState(null);

  const groups = useMemo(() => groupRaumImageRows(lines), [lines]);
  const complete = useMemo(() => isRaumImageDraftComplete(lines), [lines]);
  if (!open) return null;

  const upload = async files => {
    const list = [...(files || [])];
    if (!list.length) return;
    setUploading(true); setError(''); setMessage('');
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append('file', file, file.name || `raum-paste-${Date.now()}.png`);
        const r = await fetch('/api/raum/pnl-image-import', { method: 'POST', body: fd });
        const j = await r.json();
        if (!j.success) throw new Error(`${file.name}: ${j.error || '이미지 분석 실패'}`);
        setImages(prev => [...prev, j.sourceImage]);
        setLines(prev => [...prev, ...(j.items || [])]);
      }
      setMessage(`${list.length}개 이미지 분석 완료 — 가격이 다른 품목은 별도 행으로 유지됩니다.`);
    } catch (e) { setError(e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const handlePaste = event => {
    const file = getClipboardImage(event.clipboardData?.items);
    if (!file) return;
    event.preventDefault();
    upload([file]);
  };

  const updateGroup = (group, patch) => {
    setLines(prev => prev.map(line => {
      if (!group.lineIds.includes(line.lineId)) return line;
      if (patch.qty != null && group.lines.length > 1) return line;
      const next = { ...line, ...patch };
      if (patch.qty != null) next.qty = Math.max(0, Number(patch.qty) || 0);
      if (patch.price !== undefined) next.price = parseImageNumber(patch.price);
      return next;
    }));
  };

  const updateGroupQty = (group, value) => {
    const qty = Math.max(0, Number(value) || 0);
    setLines(prev => {
      const ids = new Set(group.lineIds);
      const orderedIds = group.lineIds.filter(Boolean);
      if (orderedIds.length <= 1) {
        return prev.map(line => ids.has(line.lineId) ? { ...line, qty } : line);
      }
      // 화면의 합산행을 수정할 때 원본 이미지 행의 합계가 정확히 맞도록
      // 균등 배분하고 마지막 행에 나머지를 넣는다. 특정 원행을 임의로
      // 0으로 만드는 방식은 목표 합계가 기존 앞행 합계보다 작을 때 틀린다.
      const base = Math.floor((qty / orderedIds.length) * 100) / 100;
      let remaining = qty;
      const lastId = orderedIds[orderedIds.length - 1];
      return prev.map(line => {
        if (!ids.has(line.lineId)) return line;
        const nextQty = line.lineId === lastId ? remaining : base;
        remaining = Math.max(0, remaining - nextQty);
        return { ...line, qty: nextQty };
      });
    });
  };

  const toggleSeparate = group => {
    const separate = group.lines.length > 1 ? true : !Boolean(group.lines[0]?.separate);
    setLines(prev => prev.map(line => group.lineIds.includes(line.lineId) ? { ...line, separate } : line));
  };

  const deleteGroup = group => setLines(prev => prev.filter(line => !group.lineIds.includes(line.lineId)));

  const chooseProduct = async (group, product) => {
    const pk = Number(product.prodKey ?? product.ProdKey);
    const pn = product.prodName || product.ProdName || product.displayName || product.DisplayName || group.inputName;
    setLines(prev => prev.map(line => group.lineIds.includes(line.lineId)
      ? { ...line, prodKey: pk, prodName: pn, displayName: product.displayName || product.DisplayName || pn, needsReview: false, confidenceLabel: 'manual' }
      : line));
    try {
      const names = [...new Set(group.lines.map(line => line.inputName).filter(Boolean))];
      await Promise.all(names.map(name => fetch('/api/raum/item-mapping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, prodKey: pk }),
      })));
    } catch { /* UI 선택은 유지; 다음 업로드 학습 저장 실패만 알림 대상 */ }
    setPicker(null);
  };

  const confirmGroup = group => setLines(prev => prev.map(line => group.lineIds.includes(line.lineId) && line.prodKey != null ? { ...line, needsReview: false } : line));

  const resetDraft = () => {
    if ((images.length || lines.length) && !window.confirm('현재 업로드 이미지와 매칭 수정 내용을 모두 초기화할까요? 저장된 결산표와 전산 주문은 변경되지 않습니다.')) return;
    setImages([]);
    setLines([]);
    setWeek('');
    setPicker(null);
    setRegistered(null);
    setError('');
    setMessage('이미지 매칭 작업을 초기화했습니다.');
  };

  const register = async () => {
    if (!complete) { setError('주문등록 전 모든 행의 품목 매칭을 확정해야 합니다.'); return; }
    if (!week.trim()) { setError('주문등록 차수를 입력하세요. 예: 2026-29-01 또는 29-01'); return; }
    const orderItems = buildRaumOrderItems(lines);
    if (!orderItems.length) { setError('주문등록할 품목이 없습니다.'); return; }
    setRegistering(true); setError('');
    try {
      const r = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ custName: '라움', year, week: week.trim(), source: 'raum-pnl', ensureShipmentMaster: true, items: orderItems }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error || '주문등록 실패');
      setRegistered(j);
      setMessage(`주문등록 완료 — ${orderItems.length}개 품목, 빈 출고마스터 ${j.shipmentMasterKey ? '준비됨' : '기존 사용'}`);
    } catch (e) { setError(e.message); }
    finally { setRegistering(false); }
  };

  const preview = () => {
    if (!complete) { setError('결산 미리보기 전 모든 행의 품목 매칭을 확정해야 합니다.'); return; }
    const m = week.trim().match(/^(\d{4}-)?(\d{2})-(\d{2})$/);
    const major = m ? m[2] : '';
    const orderYear = m?.[1] ? m[1].slice(0, 4) : year;
    if (!major) { setError('결산 차수를 알 수 없습니다. 주문등록 차수를 먼저 입력하세요.'); return; }
    onPreview({
      items: buildRaumPnlItems(lines), images,
      orderYear, major,
      sourceFile: images.map(image => image.fileName).join(', '),
    });
  };

  const saveDraft = async () => {
    if (!complete) { setError('저장 전 모든 행의 품목 매칭을 확정해야 합니다.'); return; }
    const m = week.trim().match(/^(\d{4}-)?(\d{2})-(\d{2})$/);
    const major = m ? m[2] : '';
    const orderYear = m?.[1] ? m[1].slice(0, 4) : year;
    if (!major) { setError('결산 저장 차수를 알 수 없습니다. 주문등록 차수를 입력하세요.'); return; }
    if (typeof onSaveDraft !== 'function') {
      preview();
      return;
    }
    setSavingDraft(true); setError('');
    try {
      await onSaveDraft({
        items: buildRaumPnlItems(lines), images, orderYear, major,
        sourceFile: images.map(image => image.fileName).join(', '),
      });
      setMessage(`${Number(major)}차 이미지 결산 초안을 저장했습니다. 주문등록은 별도 버튼에서 실행됩니다.`);
    } catch (e) { setError(e.message); }
    finally { setSavingDraft(false); }
  };

  return (
    <div style={{ border: '1px solid #93c5fd', borderRadius: 9, background: '#f8fbff', padding: 12, marginBottom: 14 }}>
      {picker ? <ProductPicker group={picker} onPick={p => chooseProduct(picker, p)} onClose={() => setPicker(null)} /> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <b style={{ color: '#1d4ed8' }}>📷 라움 이미지 주문등록·결산 초안</b>
        <span style={{ fontSize: 12, color: '#64748b' }}>이미지는 왼쪽, 품목·수량·단가·적요는 오른쪽</span>
        <span style={{ flex: 1 }} />
        <button style={{ ...button, color: '#b45309', borderColor: '#fbbf24' }} onClick={resetDraft}>🧹 초기화</button>
        <button style={button} onClick={onClose}>닫기</button>
      </div>
      {error ? <div style={{ color: '#b91c1c', background: '#fee2e2', padding: '6px 8px', borderRadius: 5, marginBottom: 8, fontSize: 12 }}>{error}</div> : null}
      {message ? <div style={{ color: '#166534', background: '#dcfce7', padding: '6px 8px', borderRadius: 5, marginBottom: 8, fontSize: 12 }}>{message}</div> : null}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 300, minWidth: 240, display: 'grid', gap: 8 }}>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => upload(e.target.files)} />
          <button style={{ ...button, background: '#2563eb', color: '#fff', borderColor: '#2563eb', padding: '8px 10px' }} disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? '이미지 분석 중…' : '📤 이미지 여러 장 업로드'}</button>
          <div
            tabIndex={0}
            onPaste={handlePaste}
            style={{ border: '1px dashed #60a5fa', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', padding: '10px 8px', textAlign: 'center', fontSize: 12, outline: 'none' }}
            title="이 영역을 클릭한 뒤 Ctrl+V"
          >
            🖼️ 이미지 붙여넣기<br />
            <span style={{ color: '#64748b', fontSize: 11 }}>화면 캡처 후 이 영역을 클릭하고 Ctrl+V</span>
          </div>
          {!images.length ? <div style={{ color: '#94a3b8', fontSize: 12, padding: '30px 8px', textAlign: 'center', border: '1px dashed #bfdbfe', borderRadius: 6 }}>이미지를 올리면 원본 미리보기가 여기에 표시됩니다.</div> : null}
          {images.map(image => <div key={image.id} style={{ border: '1px solid #dbeafe', borderRadius: 6, background: '#fff', padding: 5 }}><img src={image.url} alt={image.fileName} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }} /><div style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }}>{image.fileName}</div></div>)}
        </div>
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5 }}>매칭률 <b style={{ color: complete ? '#166534' : '#b45309' }}>{groups.filter(g => g.prodKey != null && !g.needsReview).length}/{groups.length || 0}</b></span>
            <span style={{ fontSize: 11.5, color: '#64748b' }}>같은 품목·같은 단가만 합산 / 다른 단가는 별도 행 · 단위: 박스/단/스팀(대)</span>
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
            <thead><tr>{['품목(이미지)', '매칭 품목', '수량', '단위\n(박스/단/스팀)', '1개당 단가(원/VAT별도)', '적요', '처리'].map(h => <th key={h} style={{ ...cell, background: '#dbeafe', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>{groups.map(group => {
              const good = group.prodKey != null && !group.needsReview;
              return <tr key={group.groupKey} style={{ background: good ? '#fff' : '#fff7ed' }}>
                <td style={cell}>{group.inputName}<div style={{ color: '#94a3b8', fontSize: 10.5 }}>{group.lines.length > 1 ? `${group.lines.length}개 원행 합산` : group.lines[0]?.sourceImageName || ''}</div></td>
                <td style={cell}>{group.prodName || <span style={{ color: '#b91c1c' }}>미매칭</span>}<div><button style={{ ...button, padding: '2px 6px', marginTop: 3 }} onClick={() => setPicker(group)}>{group.prodKey ? '매칭 수정' : '품목 검색'}</button>{group.prodKey && group.needsReview ? <button style={{ ...button, padding: '2px 6px', color: '#166534', marginLeft: 4 }} onClick={() => confirmGroup(group)}>추천 확정</button> : null}</div></td>
                <td style={{ ...cell, textAlign: 'right' }}><input style={{ ...input, width: 70 }} type="number" min="0" step="0.01" value={group.qty} onChange={e => updateGroupQty(group, e.target.value)} /></td>
                <td style={cell}><input style={{ ...input, width: 76 }} value={formatRaumUnit(group.unit)} onChange={e => updateGroup(group, { unit: normalizeRaumUnit(e.target.value) || e.target.value })} title="박스 / 단 / 스팀(대)" /></td>
                <td style={{ ...cell, textAlign: 'right' }}><input style={{ ...input, width: 125 }} type="number" min="0" step="1" value={group.price ?? ''} placeholder="미입력" onChange={e => updateGroup(group, { price: e.target.value })} /></td>
                <td style={cell}><input style={{ ...input, width: 140, textAlign: 'left' }} value={group.remark} onChange={e => updateGroup(group, { remark: e.target.value })} placeholder="적요" /></td>
                <td style={{ ...cell, whiteSpace: 'nowrap' }}><button style={button} onClick={() => toggleSeparate(group)}>{group.lines.length > 1 ? '행 별도' : (group.lines[0]?.separate ? '합산' : '분리 유지')}</button><button style={{ ...button, color: '#b91c1c', marginLeft: 4 }} onClick={() => deleteGroup(group)}>삭제</button></td>
              </tr>;
            })}</tbody>
          </table>
          {!groups.length ? <div style={{ color: '#94a3b8', textAlign: 'center', padding: 30, fontSize: 12 }}>분석된 품목이 없습니다.</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid #dbeafe', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5 }}>주문등록 차수</b>
        <input style={{ ...input, width: 56, textAlign: 'center' }} value={year} onChange={e => setYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))} placeholder="연도" />
        <input style={{ ...input, width: 150, textAlign: 'center' }} value={week} onChange={e => setWeek(e.target.value)} placeholder="예: 2026-29-01 또는 29-01" />
        <button style={{ ...button, background: complete && !savingDraft ? '#0f766e' : '#e2e8f0', color: complete && !savingDraft ? '#fff' : '#94a3b8', borderColor: complete && !savingDraft ? '#0f766e' : '#cbd5e1' }} disabled={!complete || savingDraft} onClick={saveDraft}>{savingDraft ? '저장 중…' : '💾 매칭 저장'}</button>
        <button style={{ ...button, background: complete ? '#16a34a' : '#e2e8f0', color: complete ? '#fff' : '#94a3b8', borderColor: complete ? '#16a34a' : '#cbd5e1' }} disabled={!complete || registering} onClick={register}>{registering ? '등록 중…' : '✅ 100% 매칭 후 주문등록'}</button>
        <button style={{ ...button, background: complete ? '#2563eb' : '#e2e8f0', color: complete ? '#fff' : '#94a3b8', borderColor: complete ? '#2563eb' : '#cbd5e1' }} disabled={!complete} onClick={preview}>📋 결산표 미리보기</button>
        {registered ? <span style={{ fontSize: 11.5, color: '#166534' }}>주문 Master {registered.orderMasterKey} / 출고 Master {registered.shipmentMasterKey || '기존'}</span> : null}
      </div>
    </div>
  );
}
