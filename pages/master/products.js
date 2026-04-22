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
  const [reviewItems, setReviewItems] = useState(null);  // null = 모달 닫힘
  const [reviewEdits, setReviewEdits] = useState({});    // { prodKey: string }
  const [reviewSaving, setReviewSaving] = useState(false);

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

  // 일괄 자동생성 — 매칭되는 건 바로 저장, 안되는 건 검토 모달
  const handleBulkGenerate = async () => {
    const targets = products.filter(p => !p.DisplayName);
    if (targets.length === 0) { alert('모든 품목에 자연어명이 이미 설정되어 있습니다.'); return; }

    const withSuggestion = targets.map(p => ({
      ...p,
      suggested: suggestDisplayName(p.ProdName),
    }));

    // 자동 적용 가능: 제안명이 원본과 다르고 한글 포함
    const autoItems = withSuggestion.filter(p =>
      p.suggested && p.suggested !== p.ProdName && /[\uAC00-\uD7A3]/.test(p.suggested)
    );
    // 검토 필요: 매칭 안 됨 (한글 없음 = 전혀 번역 안 된 것)
    const needsReview = withSuggestion.filter(p =>
      !p.suggested || p.suggested === p.ProdName || !/[\uAC00-\uD7A3]/.test(p.suggested)
    );

    setBulkGenerating(true);
    try {
      // 자동 적용
      if (autoItems.length > 0) {
        const updates = autoItems.map(p => ({ prodKey: p.ProdKey, displayName: p.suggested }));
        for (let i = 0; i < updates.length; i += 100) {
          await fetch('/api/master?entity=display-name', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: updates.slice(i, i + 100) }),
          });
        }
        await load();
      }
      // 검토 모달 오픈
      if (needsReview.length > 0) {
        const initEdits = {};
        for (const p of needsReview) initEdits[p.ProdKey] = p.suggested !== p.ProdName ? p.suggested : '';
        setReviewEdits(initEdits);
        setReviewItems(needsReview);
      } else if (autoItems.length > 0) {
        alert(`✅ ${autoItems.length}개 자동 적용 완료. 검토 필요 항목 없음.`);
      }
    } catch (e) { alert(e.message); } finally { setBulkGenerating(false); }
  };

  const handleReviewSave = async () => {
    const updates = Object.entries(reviewEdits)
      .filter(([, v]) => v && v.trim())
      .map(([prodKey, displayName]) => ({ prodKey: Number(prodKey), displayName: displayName.trim() }));
    if (updates.length === 0) { setReviewItems(null); return; }
    setReviewSaving(true);
    try {
      for (let i = 0; i < updates.length; i += 100) {
        await fetch('/api/master?entity=display-name', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: updates.slice(i, i + 100) }),
        });
      }
      setReviewItems(null);
      load();
    } catch (e) { alert(e.message); } finally { setReviewSaving(false); }
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

      {/* 자연어명 검토 모달 */}
      {reviewItems && (
        <div className="modal-overlay" onClick={() => setReviewItems(null)}>
          <div className="modal" style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">🔍 자연어명 검토 ({reviewItems.length}개 — 자동 매칭 안 됨)</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setReviewItems(null)}>✕</button>
            </div>
            <div style={{ padding: '8px 16px', background: '#fff8e1', fontSize: 12, color: '#795548', borderBottom: '1px solid var(--border)' }}>
              한글명을 입력하거나 비워두면 건너뜁니다. 입력한 항목만 저장됩니다.
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f5f5f5' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: 40 }}>#</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>품목명 (DB)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: 80 }}>꽃/국가</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, width: 200 }}>자연어명 입력</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewItems.map((p, i) => (
                    <tr key={p.ProdKey} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '5px 8px', color: 'var(--text3)', fontSize: 11 }}>{i + 1}</td>
                      <td style={{ padding: '5px 8px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text3)' }}>{p.ProdName}</td>
                      <td style={{ padding: '5px 8px', fontSize: 11 }}>
                        <span className="badge badge-purple" style={{ fontSize: 10 }}>{p.FlowerName}</span>
                        <br />
                        <span className="badge badge-gray" style={{ fontSize: 10, marginTop: 2 }}>{p.CounName}</span>
                      </td>
                      <td style={{ padding: '4px 8px' }}>
                        <input
                          type="text"
                          className="form-control"
                          style={{ fontSize: 12, padding: '3px 6px' }}
                          placeholder="예: 카네이션 핑크"
                          value={reviewEdits[p.ProdKey] ?? ''}
                          onChange={e => setReviewEdits(prev => ({ ...prev, [p.ProdKey]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {Object.values(reviewEdits).filter(v => v && v.trim()).length}개 입력됨
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setReviewItems(null)}>건너뛰기</button>
                <button className="btn btn-primary" onClick={handleReviewSave} disabled={reviewSaving}>
                  {reviewSaving ? '저장 중...' : '💾 입력한 항목 저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              {(() => {
                // 박스당/단당 입력 — 콜롬비아는 박스 기준, 외국은 단 기준 (사용자 선호)
                const counName = String(form.CounName || form.counName || '').trim();
                const isColombia = /콜롬비아|COLOMBIA/i.test(counName);
                const bpb = Number(form.BunchOf1Box || form.bunchOf1Box) || 0;
                const boxW = form.BoxWeight ?? form.boxWeight;
                const boxC = form.BoxCBM ?? form.boxCBM;
                const bunchW = boxW !== '' && boxW != null && bpb > 0 ? (Number(boxW) / bpb) : '';
                const bunchC = boxC !== '' && boxC != null && bpb > 0 ? (Number(boxC) / bpb) : '';
                // 단당으로 입력 시 박스당으로 환산해 BoxWeight/BoxCBM 에 저장 (DB 는 기존 컬럼 유지)
                const onBunchWeight = (v) => {
                  if (v === '') { setForm(f => ({ ...f, boxWeight: '' })); return; }
                  if (bpb > 0) setForm(f => ({ ...f, boxWeight: (parseFloat(v) * bpb).toFixed(3).replace(/\.?0+$/, '') }));
                };
                const onBunchCBM = (v) => {
                  if (v === '') { setForm(f => ({ ...f, boxCBM: '' })); return; }
                  if (bpb > 0) setForm(f => ({ ...f, boxCBM: (parseFloat(v) * bpb).toFixed(4).replace(/\.?0+$/, '') }));
                };
                // 콜롬비아면 박스 칸 강조, 아니면 단 칸 강조 (activeStyle)
                const boxActive = isColombia;
                const activeStyle = { background: '#e8f5e9', border: '2px solid #66bb6a', boxShadow: '0 0 0 2px rgba(102,187,106,0.2)' };
                const dimStyle    = { background: '#fafafa', color: '#777' };
                return (
                  <>
                    <div style={{ margin: '8px 0 4px', fontSize: 11, color: 'var(--text3)', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      🚛 운송 원가 계산용 — 빈칸이면 꽃 카테고리 기본값 사용
                      <span style={{ marginLeft: 10, fontSize: 10, fontWeight: 600, color: boxActive ? '#2e7d32' : '#1565c0' }}>
                        [{counName || '국가 미지정'}] 기본 입력: <b>{boxActive ? '박스당' : '단당'}</b>
                      </span>
                      <span style={{ marginLeft: 8, fontSize: 10, color: '#888' }}>
                        (양쪽 어디에 입력해도 자동 환산 {bpb > 0 ? `· 1박스 = ${bpb}단` : '· ⚠ BunchOf1Box 설정 필요'})
                      </span>
                    </div>

                    <div className="form-row form-row-3">
                      <div className="form-group">
                        <label className="form-label">박스당 무게 (kg)</label>
                        <input type="number" step="0.1" className="form-control"
                          value={form.BoxWeight ?? form.boxWeight ?? ''}
                          onChange={e => setForm(f => ({ ...f, boxWeight: e.target.value }))}
                          placeholder={isColombia ? '예: 8' : ''}
                          style={boxActive ? activeStyle : dimStyle} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">단당 무게 (kg)</label>
                        <input type="number" step="0.01" className="form-control"
                          value={bunchW === '' ? '' : (typeof bunchW === 'number' ? +bunchW.toFixed(4) : bunchW)}
                          onChange={e => onBunchWeight(e.target.value)}
                          placeholder={!isColombia ? '예: 0.5' : ''}
                          disabled={!(bpb > 0)}
                          title={bpb > 0 ? '단당 값을 입력하면 박스당(=단당×1박스단수)으로 자동 환산되어 DB 저장됩니다.' : '1박스당 단수(BunchOf1Box) 먼저 설정하세요.'}
                          style={!boxActive && bpb > 0 ? activeStyle : dimStyle} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">관세율 (%)</label>
                        <input type="number" step="0.01" className="form-control"
                          value={form.TariffRate != null ? Number(form.TariffRate) * 100 : ''}
                          onChange={e => setForm(f => ({ ...f, tariffRate: e.target.value === '' ? '' : (parseFloat(e.target.value) / 100) }))}
                          placeholder="0 (콜롬비아)" />
                      </div>
                    </div>

                    <div className="form-row form-row-3">
                      <div className="form-group">
                        <label className="form-label">박스당 CBM</label>
                        <input type="number" step="0.1" className="form-control"
                          value={form.BoxCBM ?? form.boxCBM ?? ''}
                          onChange={e => setForm(f => ({ ...f, boxCBM: e.target.value }))}
                          placeholder={isColombia ? '예: 10' : ''}
                          style={boxActive ? activeStyle : dimStyle} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">단당 CBM</label>
                        <input type="number" step="0.01" className="form-control"
                          value={bunchC === '' ? '' : (typeof bunchC === 'number' ? +bunchC.toFixed(5) : bunchC)}
                          onChange={e => onBunchCBM(e.target.value)}
                          placeholder={!isColombia ? '예: 0.03' : ''}
                          disabled={!(bpb > 0)}
                          title={bpb > 0 ? '단당 값을 입력하면 박스당(=단당×1박스단수)으로 자동 환산되어 DB 저장됩니다.' : '1박스당 단수(BunchOf1Box) 먼저 설정하세요.'}
                          style={!boxActive && bpb > 0 ? activeStyle : dimStyle} />
                      </div>
                      <div />
                    </div>
                  </>
                );
              })()}
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
