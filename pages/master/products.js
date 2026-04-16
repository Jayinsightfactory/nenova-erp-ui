import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

export default function Products() {
  const { t } = useLang();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/master', { entity: 'products' })
      .then(d => { setProducts(d.data || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = products.filter(p =>
    !search || p.ProdName?.toLowerCase().includes(search.toLowerCase()) ||
    p.FlowerName?.includes(search) || p.CounName?.includes(search) || p.ProdCode?.includes(search)
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      // upper→lower 정규화: 수정 모드에서 미변경 필드가 Uppercase 로 남아있어도 API 호환
      const payload = {
        prodKey:       form.ProdKey       ?? form.prodKey,
        prodCode:      form.prodCode      ?? form.ProdCode,
        prodName:      form.prodName      ?? form.ProdName,
        flowerName:    form.flowerName    ?? form.FlowerName,
        counName:      form.counName      ?? form.CounName,
        cost:          form.cost          ?? form.Cost,
        outUnit:       form.outUnit       ?? form.OutUnit,
        estUnit:       form.estUnit       ?? form.EstUnit,
        bunchOf1Box:   form.bunchOf1Box   ?? form.BunchOf1Box,
        steamOf1Bunch: form.steamOf1Bunch ?? form.SteamOf1Bunch,
        boxWeight:     form.boxWeight     ?? form.BoxWeight,
        boxCBM:        form.boxCBM        ?? form.BoxCBM,
        tariffRate:    form.tariffRate    ?? form.TariffRate,
      };
      await apiPost('/api/master?entity=products', payload);
      setShowModal(false);
      load();
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="filter-bar">
        <input className="filter-input" placeholder="품목명 / 코드 / 꽃 / 국가" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button className="btn btn-success" onClick={() => { setForm({}); setSelected(null); setShowModal(true); }}>＋ 신규 / Nuevo</button>
          <button className="btn btn-secondary" onClick={() => selected && (setForm({ ...selected }), setShowModal(true))}>✏️ 수정 / Editar</button>
          <button className="btn btn-secondary">📊 엑셀 / Excel</button>
          <button className="btn btn-secondary" onClick={() => window.opener ? window.close() : history.back()}>✖️ 닫기 / Cerrar</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      <div className="table-wrap">
        {loading ? <div className="skeleton" style={{ height: 300, borderRadius: 0 }}></div> : (
          <table className="tbl">
            <thead><tr><th>#</th><th>품목코드</th><th>품목명</th><th>꽃</th><th>국가</th><th style={{ textAlign: 'right' }}>출고단가</th><th>출고단위</th><th style={{ textAlign: 'right' }}>1박스단수</th><th style={{ textAlign: 'right' }}>1단송이</th><th style={{ textAlign: 'right' }}>박스무게</th><th style={{ textAlign: 'right' }}>박스CBM</th><th style={{ textAlign: 'right' }}>관세%</th><th style={{ textAlign: 'right' }}>재고</th></tr></thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr key={p.ProdKey} className={selected?.ProdKey === p.ProdKey ? 'selected' : ''} onClick={() => setSelected(p)} onDoubleClick={() => { setForm({ ...p }); setShowModal(true); }} style={{ cursor: 'pointer' }}>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{p.ProdCode}</td>
                  <td className="name">{p.ProdName}</td>
                  <td><span className="badge badge-purple">{p.FlowerName}</span></td>
                  <td><span className="badge badge-gray">{p.CounName}</span></td>
                  <td className="num">{Number(p.Cost || 0).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{p.OutUnit}</td>
                  <td className="num">{p.BunchOf1Box}</td>
                  <td className="num">{p.SteamOf1Bunch}</td>
                  <td className="num" style={{ color: p.BoxWeight == null ? 'var(--text3)' : 'inherit' }}>{p.BoxWeight ?? '–'}</td>
                  <td className="num" style={{ color: p.BoxCBM == null ? 'var(--text3)' : 'inherit' }}>{p.BoxCBM ?? '–'}</td>
                  <td className="num" style={{ color: p.TariffRate == null ? 'var(--text3)' : 'inherit' }}>{p.TariffRate == null ? '–' : (Number(p.TariffRate) * 100).toFixed(1) + '%'}</td>
                  <td className="num" style={{ color: p.Stock === 0 ? 'var(--red)' : p.Stock < 10 ? 'var(--amber)' : 'var(--green)', fontWeight: 700 }}>{p.Stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><span className="modal-title">{form.ProdKey ? '품목 수정' : '신규 품목 등록'}</span><button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button></div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group"><label className="form-label">품목코드</label><input className="form-control" value={form.ProdCode || ''} onChange={e => setForm(f => ({ ...f, prodCode: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">품목명 *</label><input className="form-control" value={form.ProdName || ''} onChange={e => setForm(f => ({ ...f, prodName: e.target.value }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">꽃 종류</label>
                  <select className="form-control" value={form.FlowerName || ''} onChange={e => setForm(f => ({ ...f, flowerName: e.target.value }))}>
                    {['카네이션','장미','수국','알스트로','아카시아','루스커스','기타'].map(fl => <option key={fl}>{fl}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">국가</label>
                  <select className="form-control" value={form.CounName || ''} onChange={e => setForm(f => ({ ...f, counName: e.target.value }))}>
                    {['콜롬비아','에콰도르','네달란드','중국','태국','호주','이스라엘','국내'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row form-row-3">
                <div className="form-group"><label className="form-label">출고단가</label><input type="number" className="form-control" value={form.Cost || 0} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">출고단위</label>
                  <select className="form-control" value={form.OutUnit || '박스'} onChange={e => setForm(f => ({ ...f, outUnit: e.target.value }))}>
                    <option>박스</option><option>단</option><option>송이</option>
                  </select>
                </div>
                <div className="form-group"><label className="form-label">견적단위</label>
                  <select className="form-control" value={form.EstUnit || '박스'} onChange={e => setForm(f => ({ ...f, estUnit: e.target.value }))}>
                    <option>박스</option><option>단</option><option>송이</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">1박스 당 단수</label><input type="number" className="form-control" value={form.BunchOf1Box || 0} onChange={e => setForm(f => ({ ...f, bunchOf1Box: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">1단 당 송이수</label><input type="number" className="form-control" value={form.SteamOf1Bunch || 0} onChange={e => setForm(f => ({ ...f, steamOf1Bunch: e.target.value }))} /></div>
              </div>
              <div style={{ margin: '8px 0 4px', fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                🚛 운송 원가 계산용 — 빈칸이면 꽃 카테고리 기본값 사용
              </div>
              <div className="form-row form-row-3">
                <div className="form-group"><label className="form-label">박스당 무게 (kg)</label><input type="number" step="0.1" className="form-control" value={form.BoxWeight ?? ''} onChange={e => setForm(f => ({ ...f, boxWeight: e.target.value }))} placeholder="예: 8" /></div>
                <div className="form-group"><label className="form-label">박스당 CBM</label><input type="number" step="0.1" className="form-control" value={form.BoxCBM ?? ''} onChange={e => setForm(f => ({ ...f, boxCBM: e.target.value }))} placeholder="예: 10" /></div>
                <div className="form-group"><label className="form-label">관세율 (%)</label><input type="number" step="0.01" className="form-control" value={form.TariffRate != null ? Number(form.TariffRate) * 100 : ''} onChange={e => setForm(f => ({ ...f, tariffRate: e.target.value === '' ? '' : (parseFloat(e.target.value) / 100) }))} placeholder="0 (콜롬비아)" /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>취소 / Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장 중... / Guardando' : '💾 저장 / Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
