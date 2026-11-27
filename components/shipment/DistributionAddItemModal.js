import { distributionSlotMark } from '../../lib/shipmentDistributionPeers.js';
import { customerMatchesSearch } from '../../lib/customerSearch';
import {
  pendingDistributionItem,
  sortDistributionCustomers,
  sortDistributionProducts,
  distributionPairGroups,
  distributionAddProductCandidates,
  distributionPairFilterMatches,
  distributionUnitFactor,
  toDisplayQty,
  toNativeQty,
} from '../../lib/shipmentDistributionWorkspace.js';
import { pickButtonStyle } from '../../lib/shipmentDistributionPageHelpers.js';

export default function DistributionAddItemModal({
  addPanel,
  setAddPanel,
  selectedCust,
  week,
  pairSides,
  products,
  productCatalog,
  addProdFilter,
  setAddProdFilter,
  addCustFilter,
  setAddCustFilter,
  matchItemName,
  custList,
  allCustomers,
  pairCust,
  extraPeers,
  selectPairCust,
  selectExtraCust,
  hasDateDrafts,
  saving,
  loading,
  saveBlocked,
  fixedBadge,
  handleSaveCustItems,
}) {
  if (!addPanel || !selectedCust) return null;

  const sides = pairSides().filter(side => side.cust);
  const side = sides[Math.min(addPanel.side, sides.length - 1)];
  const addCandidates = distributionAddProductCandidates(products, productCatalog);
  const groups = distributionPairGroups(addCandidates);
  const searching = String(addProdFilter || '').trim() !== '';
  const groupProducts = searching
    ? sortDistributionProducts(addCandidates.filter(p => matchItemName(p, addProdFilter)))
    : addPanel.group
      ? sortDistributionProducts(addCandidates.filter(p => distributionPairFilterMatches(p, addPanel.group)))
      : [];
  const prod = addCandidates.find(p => Number(p.ProdKey) === Number(addPanel.prodKey));
  const unit = prod ? (addPanel.unit || prod.OutUnit || '박스') : '';
  const factor = prod ? (distributionUnitFactor(prod, unit) || 1) : 1;
  const itemOf = (sd, key) => sd.items.find(i => Number(i.ProdKey) === Number(key));
  const qtyOf = (sd, key) => {
    const item = itemOf(sd, key);
    if (!item) return 0;
    const e = sd.inputs[key];
    return e?.outQty !== undefined ? parseFloat(e.outQty) || 0 : (item.출고수량 || 0);
  };
  const remainOf = (p) => {
    const delta = sides.reduce((a, sd) => {
      const item = itemOf(sd, p.ProdKey);
      return a + (item ? qtyOf(sd, p.ProdKey) - (item.출고수량 || 0) : 0);
    }, 0);
    return (Number(p.inQty) || 0) - (Number(p.outQty) || 0) - delta;
  };
  const bump = (n) => {
    if (!prod || !side) return;
    const exists = itemOf(side, prod.ProdKey);
    const next = Math.max(0, Math.round((qtyOf(side, prod.ProdKey) + toNativeQty(n, factor)) * 1000) / 1000);
    if (!exists) {
      if (next <= 0) return;
      side.setItems(prev => [...prev, pendingDistributionItem(prod)]);
    }
    side.setInputs(prev => ({
      ...prev,
      [prod.ProdKey]: {
        ...(prev[prod.ProdKey] || {}),
        outQty: next,
        cost: prev[prod.ProdKey]?.cost ?? (exists?.Cost ?? prod.Cost ?? 0),
      },
    }));
  };
  const current = prod && side ? qtyOf(side, prod.ProdKey) : 0;
  const stepRow = (sign) => (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {[1, 2, 5, 10, 16, 25].map(n => (
        <button key={n} type="button" className="btn" data-ai-verify={`add-${sign > 0 ? 'plus' : 'minus'}-${n}`} disabled={!prod || saving || (sign < 0 && current <= 0)}
          onClick={() => bump(sign * n)}
          style={{ minWidth: 52, height: 40, fontSize: 15, fontWeight: 700, color: sign > 0 ? 'var(--blue)' : 'var(--red)' }}>{sign > 0 ? '+' : '−'}{n}</button>
      ))}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={() => setAddPanel(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="품목추가·수량추가" data-testid="distribution-add-panel"
        onClick={e => e.stopPropagation()} style={{ maxWidth: 860, width: '95vw', maxHeight: '90vh', overflowY: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <b>➕ 품목추가·수량추가 — {week}</b>
          <button type="button" className="btn btn-sm" data-ai-verify="add-panel-close" onClick={() => setAddPanel(null)}>닫기</button>
        </div>
        {sides.length > 1 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)', alignSelf: 'center' }}>업체</span>
            {sides.map((sd, i) => (
              <button key={sd.cust.CustKey} type="button" data-ai-verify={`add-side-${i + 1}`} aria-pressed={sd === side}
                onClick={() => setAddPanel(prev => ({ ...prev, side: i }))} style={pickButtonStyle(sd === side, true)}>{distributionSlotMark(i)} {sd.cust.CustName}</button>
            ))}
          </div>
        )}
        {sides.length === 1 && <div style={{ fontSize: 12, marginBottom: 8 }}>업체: <b>{side.cust.CustName}</b></div>}
        {(() => {
          const text = addCustFilter.trim().toLowerCase();
          const searchInput = (
            <input className="filter-input" placeholder="업체 검색 (이름·코드, 주문 없는 업체 포함)" value={addCustFilter} data-ai-verify="add-cust-search" aria-label="품목추가 업체 검색"
              onChange={e => setAddCustFilter(e.target.value)} style={{ height: 28, fontSize: 12, width: 280, marginBottom: 4 }} />
          );
          const managerOf = (c) => String(c.Manager || allCustomers.find(a => Number(a.CustKey) === Number(c.CustKey))?.Manager || '').trim() || '담당자 없음';
          const pool = [...custList, ...allCustomers.filter(a => !custList.some(c => Number(c.CustKey) === Number(a.CustKey))).map(a => ({ ...a, noOrder: true }))];
          const managers = [...new Set(pool.map(managerOf))].sort((a, b) => a.localeCompare(b, 'ko'));
          const managerRow = (
            <div data-testid="distribution-add-managers" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>담당자</span>
              {allCustomers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>불러오는 중…</span>}
              {managers.map(m => (
                <button key={m} type="button" data-ai-verify={`add-manager-${m}`} aria-pressed={addPanel.manager === m}
                  onClick={() => setAddPanel(prev => ({ ...prev, manager: prev.manager === m ? '' : m }))} style={pickButtonStyle(addPanel.manager === m, true)}>{m}</button>
              ))}
            </div>
          );
          if (!text && !addPanel.manager) return <div style={{ marginBottom: 4 }}>{managerRow}{searchInput}</div>;
          const hits = sortDistributionCustomers(pool.filter(c => (!addPanel.manager || managerOf(c) === addPanel.manager) &&
            (!text || customerMatchesSearch(c, text)))).slice(0, 60);
          const pick = async (c) => {
            const at = sides.findIndex(sd => Number(sd.cust.CustKey) === Number(c.CustKey));
            if (at >= 0) { setAddPanel(prev => ({ ...prev, side: at })); setAddCustFilter(''); return; }
            if (!pairCust) { await selectPairCust(c); setAddPanel(prev => prev && ({ ...prev, side: 1 })); }
            else { const slot = 3 + extraPeers.length; const ok = await selectExtraCust(c, slot); if (ok) setAddPanel(prev => prev && ({ ...prev, side: slot - 1 })); }
            setAddCustFilter('');
          };
          return (
            <div style={{ marginBottom: 8 }}>
              {managerRow}
              {searchInput}
              <div data-testid="distribution-add-cust-hits" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {hits.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>검색 결과 없음</span>}
                {hits.map(c => (
                  <button key={c.CustKey} type="button" data-ai-verify={`add-cust-${c.CustKey}`} disabled={hasDateDrafts || saving || loading} onClick={() => pick(c)}
                    style={pickButtonStyle(false, true)}>{c.CustName}{c.noOrder ? ' (주문없음)' : ''}</button>
                ))}
              </div>
            </div>
          );
        })()}
        <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>① 품종</div>
        <div data-testid="distribution-add-groups" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {groups.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>이 차수 품목이 없습니다.</span>}
          {groups.map(g => (
            <button key={g} type="button" data-ai-verify={`add-group-${g}`} aria-pressed={addPanel.group === g}
              onClick={() => setAddPanel(prev => ({ ...prev, group: g, prodKey: null, unit: '' }))} style={pickButtonStyle(addPanel.group === g, true)}>{g}</button>
          ))}
        </div>
        <input className="filter-input" placeholder="품목명 검색 (품종 상관없이)" value={addProdFilter} data-ai-verify="add-prod-search" aria-label="품목추가 품목명 검색"
          onChange={e => setAddProdFilter(e.target.value)} style={{ height: 28, fontSize: 12, width: 240, marginBottom: 8 }} />
        {(addPanel.group || searching) && (<>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>② 품목 (남은 재고)</div>
          <div data-testid="distribution-add-products" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {groupProducts.map(p => {
              const left = remainOf(p);
              const ordered = side && itemOf(side, p.ProdKey) && !itemOf(side, p.ProdKey).pendingOrder;
              return (
                <button key={p.ProdKey} type="button" data-ai-verify={`add-prod-${p.ProdKey}`} aria-pressed={Number(addPanel.prodKey) === Number(p.ProdKey)}
                  onClick={() => setAddPanel(prev => ({ ...prev, prodKey: p.ProdKey, unit: '' }))} style={pickButtonStyle(Number(addPanel.prodKey) === Number(p.ProdKey), false)}>
                  {fixedBadge(p.ProdKey)}{p.DisplayName || p.ProdName}
                  <span style={{ fontSize: 10, marginLeft: 4, color: left < 0 ? 'var(--red)' : 'inherit', opacity: 0.8 }}>{left.toFixed(1)}{p.OutUnit}</span>
                  {ordered && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>· 주문 있음</span>}
                </button>
              );
            })}
          </div>
        </>)}
        {prod && side && (<>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 4 }}>③ 단위 · 수량 (현재 수량에 더하기 / 빼기)</div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
            {['박스', '단', '송이'].filter(u => distributionUnitFactor(prod, u)).map(u => (
              <label key={u} style={{ display: 'inline-flex', gap: 3, alignItems: 'center', padding: '4px 10px', border: '1px solid var(--border2)', borderRadius: 6, cursor: 'pointer', background: unit === u ? 'var(--blue-bg)' : 'var(--bg)' }}>
                <input type="radio" name="add-unit" data-ai-verify={`add-unit-${u}`} checked={unit === u} onChange={() => setAddPanel(prev => ({ ...prev, unit: u }))} />{u}
              </label>
            ))}
            <span style={{ marginLeft: 12, fontSize: 13 }}>{side.cust.CustName} · <b data-testid="distribution-add-current" style={{ fontSize: 20, fontFamily: 'var(--mono)' }}>{toDisplayQty(current, factor)}</b> {unit}
              {unit !== prod.OutUnit && <span style={{ fontSize: 11, color: 'var(--text3)' }}> (= {current} {prod.OutUnit})</span>}
              <span style={{ fontSize: 11, marginLeft: 8, color: remainOf(prod) < 0 ? 'var(--red)' : 'var(--text3)' }}>재고잔량 {remainOf(prod).toFixed(2)} {prod.OutUnit}{remainOf(prod) < 0 ? ' ⚠ 마이너스' : ''}</span>
            </span>
          </div>
          {stepRow(1)}
          <div style={{ height: 4 }} />
          {stepRow(-1)}
        </>)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddPanel(null)}>닫기 (입력값은 표에 남음)</button>
          <button type="button" className="btn btn-primary" data-ai-verify="add-panel-save" disabled={saveBlocked}
            onClick={async () => { setAddPanel(null); await handleSaveCustItems(); }}>💾 저장</button>
        </div>
      </div>
    </div>
  );
}
