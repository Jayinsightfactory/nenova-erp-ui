import { useState, useEffect } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';
import { suggestDisplayName, getDisplayName, filterProducts } from '../../lib/displayName';

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
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [showOnlyNoAlias, setShowOnlyNoAlias] = useState(false);

  const load = () => {
    setLoading(true);
    apiGet('/api/master', { entity: 'products' })
      .then(d => { setProducts(d.data || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const filtered = products
    .filter(p => !showOnlyNoAlias || !p.DisplayName)
    .filter(p => !search || filterProducts([p], search).length > 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        prodKey:       form.ProdKey       ?? form.prodKey,
        prodCode:      form.prodCode      ?? form.ProdCode,
        prodName:      form.prodName      ?? form.ProdName,
        displayName:   form.displayName   ?? form.DisplayName ?? null,
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

  // 일괄 자동생성 — 자연어명 없는 품목에 제안명 저장
  const handleBulkGenerate = async () => {
    const targets = products.filter(p => !p.DisplayName);
    if (targets.length === 0) { alert('모든 품목에 자연어명이 이미 설정되어 있습니다.'); return; }
    const previews = targets.map(p => ({ ...p, suggested: suggestDisplayName(p.ProdName) }))
      .filter(p => p.suggested && p.suggested !== p.ProdName);
    if (previews.length === 0) { alert('자동 매칭되는 품목이 없습니다.'); return; }
    if (!confirm(`${previews.length}개 품목에 자연어명을 자동 설정합니다.\n예시:\n${previews.slice(0,5).map(p => `${p.ProdName} → ${p.suggested}`).join('\n')}\n\n계속하시겠습니까?`)) return;

    setBulkGenerating(true);
    try {
      const updates = previews.map(p => ({ prodKey: p.ProdKey, displayName: p.suggested }));
      // 100개씩 배치 전송
      for (let i = 0; i < updates.length; i += 100) {
        await fetch('/api/master?entity=display-name', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: updates.slice(i, i + 100) }),
        });
      }
      load();
    } catch (e) { alert(e.message); } finally { setBulkGenerating(false); }
  };

  const noAliasCount = products.filter(p => !p.DisplayName).length;

  return (
    <div>
      <div className="filter-bar">
        <input
          className="filter-input"
          placeholder="품목명(한글/영문) / 코드 / 꽃 / 국가"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <label style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showOnlyNoAlias} onChange={e => setShowOnlyNoAlias(e.target.checked)} />
          자연어명 미설정만 ({noAliasCount})
        </label>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>{t('새로고침')}</button>
          <button
            className="btn btn-warning"
            onClick={handleBulkGenerate}
            disabled={bulkGenerating || noAliasCount === 0}
            title="자연어명이 없는 품목에 자동으로 한글명 적용"
          >
            {bulkGenerating ? '생성 중...' : `✨ 자연어명 일괄생성 (${noAliasCount})`}
          </button>
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
            <thead>
              <tr>
                <th>#</th>
                <th>품목코드</th>
                <th>품목명 (DB)</th>
                <th style={{ background: 'var(--primary-bg, #eff6ff)' }}>자연어명 (웹표시)</th>
                <th>꽃</th>
                <th>국가</th>
                <th style={{ textAlign: 'right' }}>출고단가</th>
                <th>출고단위</th>
                <th style={{ textAlign: 'right' }}>1박스단수</th>
                <th style={{ textAlign: 'right' }}>1단송이</th>
                <th style={{ textAlign: 'right' }}>박스무게</th>
                <th style={{ textAlign: 'right' }}>박스CBM</th>
                <th style={{ textAlign: 'right' }}>관세%</th>
                <th style={{ textAlign: 'right' }}>재고</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr
                  key={p.ProdKey}
                  className={selected?.ProdKey === p.ProdKey ? 'selected' : ''}
                  onClick={() => setSelected(p)}
                  onDoubleClick={() => { setForm({ ...p }); setShowModal(true); }}
                  style={{ cursor: 'pointer' }}
                >
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text3)', fontSize: 12 }}>{i + 1}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{p.ProdCode}</td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>{p.ProdName}</td>
                  <td
                    className="name"
                    style={{ background: p.DisplayName ? 'var(--primary-bg, #eff6ff)' : undefined }}
                  >
                    {p.DisplayName
                      ? <strong>{p.DisplayName}</strong>
                      : <span style={{ color: 'var(--text3)', fontStyle: 'italic' }}>{suggestDisplayName(p.ProdName) || '–'}</span>
                    }
                  </td>
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
            <div className="modal-header">
              <span className="modal-title">{form.ProdKey ? '품목 수정' : '신규 품목 등록'}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">품목코드</label>
                  <input className="form-control" value={form.ProdCode || ''} onChange={e => setForm(f => ({ ...f, prodCode: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">품목명 * (DB 원본)</label>
                  <input
                    className="form-control"
                    value={form.ProdName || ''}
                    onChange={e => setForm(f => ({ ...f, prodName: e.target.value }))}
                  />
                </div>
              </div>

              {/* 자연어명 필드 */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ color: 'var(--primary, #2563eb)' }}>
                    자연어명 (웹 표시용 한글명)
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="form-control"
                      placeholder="예: 카네이션 문라이트"
                      value={form.displayName ?? form.DisplayName ?? ''}
                      onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      title="품목명에서 자동 생성"
                      onClick={() => {
                        const pn = form.prodName ?? form.ProdName ?? '';
                        const suggested = suggestDisplayName(pn);
                        if (suggested) setForm(f => ({ ...f, displayName: suggested }));
                      }}
                    >
                      ✨ 자동
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      title="자연어명 초기화"
                      onClick={() => setForm(f => ({ ...f, displayName: '' }))}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>
                    비워두면 품목명(영문) 그대로 표시됩니다
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">꽃 종류</label>
                  <select className="form-control" value={form.FlowerName || ''} onChange={e => setForm(f => ({ ...f, flowerName: e.target.value }))}>
                    {['카네이션','장미','수국','알스트로','아카시아','루스커스','기타'].map(fl => <option key={fl}>{fl}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">국가</label>
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
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '💾 저장 / Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
