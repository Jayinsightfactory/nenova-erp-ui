import DistributionDateFilter from './DistributionDateFilter';
import { distributionPeerColor, distributionSlotMark } from '../../lib/shipmentDistributionPeers.js';
import { distributeProductName } from '../../lib/distributeProductDisplay';
import {
  distributionQuantityRemark,
  pendingDistributionItem,
  distributionPairGroups,
  distributionPairFilterMatches,
  distributionUnitFactor,
  toDisplayQty,
  toNativeQty,
} from '../../lib/shipmentDistributionWorkspace.js';
import { fmt, weekButtonStyle, pickButtonStyle } from '../../lib/shipmentDistributionPageHelpers.js';

export function DistributionCustomerLeftNav({
  customerDate,
  setCustomerDate,
  dateLookup,
  dateIndexLoading,
  dateIndexError,
  dealerSearchRef,
  custFilter,
  setCustFilter,
  loadAllCustomers,
  showAllCustomers,
  toggleAllCustomers,
  hasDateDrafts,
  saving,
  loading,
  custList,
  filteredCustomers,
  pairSlot,
  setPairSlot,
  setAppendCompany,
  appendCompany,
  selectedCust,
  pairCust,
  pairLoading,
  extraLoading,
  extraPeers,
  clearPairCust,
  clearExtraCust,
  chooseCustomerSlot,
}) {
  return (
    <div className="distribution-left-column" style={{ borderRight: '1px solid var(--border)', minWidth: 0 }}>
      <DistributionDateFilter label="업체" value={customerDate} onChange={setCustomerDate} dates={dateLookup.dates} loading={dateIndexLoading} error={dateIndexError} />
      <div style={{ padding: '8px 12px', background: '#F8FAFC', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>거래처 목록</span>
        <input ref={dealerSearchRef} className="filter-input" placeholder="업체명 검색" value={custFilter || ''} disabled={hasDateDrafts || saving} data-ai-verify="customer-search"
          aria-label="업체명 검색" onChange={e => { setCustFilter(e.target.value); if (e.target.value.trim()) loadAllCustomers(); }} style={{ flex: 1, height: 28, fontSize: 12, minWidth: 120 }} />
        <label style={{ fontSize: 11, display: 'inline-flex', gap: 3, alignItems: 'center' }} title="이 차수에 주문이 없는 업체도 목록에 보여 줍니다. 그 업체로 옮기거나 추가하면 저장 시 주문등록 후 분배합니다.">
          <input type="checkbox" data-ai-verify="customer-show-all" checked={showAllCustomers} disabled={hasDateDrafts || saving} onChange={e => toggleAllCustomers(e.target.checked)} />주문 없는 업체도
        </label>
      </div>
      {!loading && custList.length > 0 && custList.every(c => c.noOrder) && <p role="status" data-testid="distribution-no-order-candidates" style={{ margin: 0, padding: 5, fontSize: 12, color: 'var(--blue)' }}>이 차수·선택 범위에 주문이 없어 전체 업체를 표시합니다. 업체 선택 후 품목을 추가하세요. 양수 수량을 저장할 때 주문등록 후 분배합니다.</p>}
      {filteredCustomers.length > 80 && <p role="status" style={{ margin: 0, padding: 5, fontSize: 11 }}>전체 {filteredCustomers.length}개 업체 중 80개 표시 · 업체명 검색으로 전체 업체를 찾을 수 있습니다.</p>}
      <div data-testid="distribution-pair-slots" style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ color: 'var(--text3)' }}>버튼 클릭 →</span>
        <button type="button" data-ai-verify="pair-slot-1" aria-pressed={pairSlot === 1} disabled={hasDateDrafts || saving} onClick={() => { setAppendCompany(false); setPairSlot(1); }}
          style={{ ...weekButtonStyle('1', pairSlot === 1), padding: '3px 10px', fontSize: 11 }}>
          업체 1{selectedCust ? `: ${selectedCust.CustName}` : ''}
        </button>
        <button type="button" data-ai-verify="pair-slot-2" aria-pressed={pairSlot === 2} disabled={hasDateDrafts || saving} onClick={() => { setAppendCompany(false); setPairSlot(2); }}
          style={{
            ...weekButtonStyle('2', pairSlot === 2), padding: '3px 10px', fontSize: 11,
            border: pairSlot === 2 ? '2px solid #b45309' : '1px solid #fcd34d', background: pairSlot === 2 ? '#b45309' : '#fffbeb', color: pairSlot === 2 ? '#fff' : '#b45309',
          }}>
          업체 2{pairCust ? `: ${pairCust.CustName}` : ' (비교·이동)'}
        </button>
        {pairCust && <button type="button" className="btn btn-sm" data-ai-verify="pair-clear" disabled={hasDateDrafts || saving || pairLoading || extraLoading > 0} onClick={clearPairCust} style={{ padding: '2px 7px', fontSize: 11 }}>업체 2 해제</button>}
        {pairCust && Array.from({ length: extraPeers.length + 1 }, (_, i) => i + 3).map(slot => {
          const peer = extraPeers[slot - 3];
          const color = distributionPeerColor(slot - 3);
          return (
            <span key={slot} style={{ display: 'inline-flex', gap: 3 }}>
              <button type="button" data-ai-verify={`pair-slot-${slot}`} aria-pressed={pairSlot === slot} disabled={hasDateDrafts || saving} onClick={() => { setAppendCompany(false); setPairSlot(slot); }}
                style={{
                  ...weekButtonStyle(String(slot), pairSlot === slot), padding: '3px 10px', fontSize: 11,
                  border: `${pairSlot === slot ? 2 : 1}px solid ${color}`, background: pairSlot === slot ? color : '#fff', color: pairSlot === slot ? '#fff' : color,
                }}>
                업체 {slot}{peer ? `: ${peer.cust.CustName}` : ' (추가)'}
              </button>
              {peer && <button type="button" className="btn btn-sm" data-ai-verify={`pair-clear-${slot}`} disabled={hasDateDrafts || saving} onClick={() => clearExtraCust(slot - 3)} style={{ padding: '2px 7px', fontSize: 11 }}>해제</button>}
            </span>
          );
        })}
        <button type="button" className={`btn btn-sm ${appendCompany ? 'btn-primary' : 'btn-secondary'}`} data-ai-verify="customer-append-mode" aria-pressed={appendCompany} disabled={saving || hasDateDrafts} onClick={() => setAppendCompany(v => !v)}>+ 업체 연속 추가</button>
        <span style={{ color: 'var(--text3)' }}>업체를 여러 곳 고르면 품목·수량이 나란히 보입니다. 이동은 상단 별도 창에서 합니다.</span>
      </div>
      <div className="distribution-navigation-scroll" data-testid="distribution-customer-navigation">
        <div data-testid="distribution-customer-buttons" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 5, flexWrap: 'wrap', maxHeight: 150, overflowY: 'auto' }}>
          {loading ? <span style={{ fontSize: 11, color: 'var(--text3)' }}>업체 조회 중…</span>
            : filteredCustomers.length === 0 ? <span style={{ fontSize: 11, color: 'var(--text3)' }}>차수를 선택하면 업체 버튼이 나타납니다.</span>
            : filteredCustomers.slice(0, 80).map(c => {
              const active = Number(selectedCust?.CustKey) === Number(c.CustKey);
              const isPair = Number(pairCust?.CustKey) === Number(c.CustKey);
              const extraIndex = extraPeers.findIndex(p => Number(p.cust.CustKey) === Number(c.CustKey));
              return (
                <button key={c.CustKey} type="button" data-ai-verify={`customer-${c.CustKey}`} aria-pressed={active || isPair || extraIndex >= 0}
                  disabled={loading || saving} title={`${c.CustName} #${c.CustKey}${isPair ? ' (업체 2)' : active ? ' (업체 1)' : extraIndex >= 0 ? ` (업체 ${extraIndex + 3})` : ''}`}
                  onClick={() => chooseCustomerSlot(c)}
                  style={isPair ? { ...pickButtonStyle(true, false), background: '#b45309', border: '2px solid #b45309' }
                    : extraIndex >= 0 ? { ...pickButtonStyle(true, false), background: distributionPeerColor(extraIndex), border: `2px solid ${distributionPeerColor(extraIndex)}` }
                    : pickButtonStyle(active, false)}>
                  {active ? '① ' : isPair ? '② ' : extraIndex >= 0 ? `${distributionSlotMark(extraIndex + 2)} ` : ''}{c.CustName}{c.noOrder && <span style={{ fontSize: 10, opacity: 0.7 }}> (주문없음)</span>}
                </button>
              );
            })}
        </div>
        <div style={{ overflowX: 'auto' }}>
          {loading ? <div className="skeleton" style={{ margin: 12, height: 200, borderRadius: 8 }}></div> : (
            <table className="tbl distribution-compact-table" style={{ fontSize: 12 }}>
              <thead><tr><th>거래처명</th><th>지역</th><th>코드</th></tr></thead>
              <tbody>
                {filteredCustomers.length === 0
                  ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{custFilter ? '검색 결과가 없습니다.' : '표시할 활성 업체가 없습니다.'}</td></tr>
                  : filteredCustomers.slice(0, 80).map(c => (
                    <tr key={c.CustKey} className={selectedCust?.CustKey === c.CustKey ? 'selected' : ''}>
                      <td className="name"><button type="button" className="btn btn-sm" disabled={loading || saving} data-ai-verify={`customer-row-${c.CustKey}`}
                        onClick={() => chooseCustomerSlot(c)}>{c.CustName}</button></td>
                      <td><span className="badge badge-gray" style={{ fontSize: 10 }}>{c.CustArea}</span></td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.OrderCode}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DistributionCustomerWorkspacePanel({
  showCustomerDates,
  setShowCustomerDates,
  hasDateDrafts,
  pairCust,
  saving,
  pairLoading,
  extraLoading,
  setMoveOpen,
  customerReadError,
  pairReadError,
  selectCust,
  selectPairCust,
  selectExtraCust,
  selectedCust,
  extraPeers,
  custLoading,
  pairRows,
  pairSearchRows,
  custItemFilter,
  setCustItemFilter,
  ensureProductCatalog,
  pairGroupFilter,
  setPairGroupFilter,
  pairSides,
  matchItemName,
  customerDate,
  dateLookup,
  products,
  custItems,
  custSearchRows,
  custEditInputs,
  setCustEditInputs,
  addCustSearchItem,
  fixedBadge,
  fixedCount,
  loading,
  handleQuantityEnter,
  dateHeader,
  dateButton,
}) {
  const itemFilterInput = (
    <input className="filter-input" placeholder="품목명 검색 (전체 품목)" value={custItemFilter} data-ai-verify="cust-item-search" aria-label="품목명 검색"
      title="주문 있는 품목이 먼저, 그 뒤 주문 없는 품목·다른 품종도 전체 품목에서 찾아 수량을 넣을 수 있습니다"
      onFocus={ensureProductCatalog}
      onChange={e => { if (e.target.value.trim()) ensureProductCatalog(); setCustItemFilter(e.target.value); }} style={{ height: 26, fontSize: 12, width: 160, marginLeft: 8 }} />
  );

  const pairQtyCell = (sideIndex, row, color) => {
    const side = pairSides()[sideIndex];
    if (!side?.cust) return '—';
    if (side.error || side.loading) return <span role="status">{side.loading ? '조회 중…' : '조회 실패: 다시 조회하세요'}</span>;
    const item = side.items.find(i => Number(i.ProdKey) === Number(row.ProdKey));
    const edit = side.inputs[row.ProdKey] || {};
    const before = item ? Number(item.출고수량 || 0) : 0;
    const value = edit.outQty !== undefined ? edit.outQty : before;
    const src = row.a || row.b || (row.extra || []).find(Boolean) || row;
    const setQty = (native) => {
      if (!item) side.setItems(prev => prev.some(i => Number(i.ProdKey) === Number(row.ProdKey)) ? prev : [...prev, pendingDistributionItem({ ...row, Cost: src.Cost })]);
      side.setInputs(prev => ({ ...prev, [row.ProdKey]: { ...(prev[row.ProdKey] || {}), outQty: native, cost: prev[row.ProdKey]?.cost ?? (item?.Cost ?? src.Cost ?? 0) } }));
    };
    const changed = (parseFloat(value) || 0) !== before;
    return (
      <div>
        <span style={{ display: 'inline-flex', gap: 3 }}>
          {['박스', '단', '송이'].map(unit => {
            const f = distributionUnitFactor(row, unit);
            const native = unit === (row.OutUnit || '박스');
            const filled = parseFloat(value) > 0;
            return (
              <input key={unit} type="number" min={0} step={native ? 0.1 : 0.01} placeholder={unit}
                value={filled && f ? toDisplayQty(value, f) : ''} disabled={hasDateDrafts || saving || loading || !f}
                title={f ? `${unit} (저장 단위 ${row.OutUnit})${item ? '' : ' — 주문 없음: 입력하면 저장 시 주문등록 후 분배'}` : `${unit}: 입수 정보가 없어 환산 불가`}
                {...(native ? { 'data-distribute-qty': 'true', 'aria-keyshortcuts': 'Enter', onKeyDown: handleQuantityEnter } : {})}
                data-ai-verify={native ? `qty-${side.cust.CustKey}-${row.ProdKey}` : `qty-${side.cust.CustKey}-${row.ProdKey}-${unit}`}
                aria-label={`${side.cust.CustName} ${row.ProdName} 출고수량 (${unit})`}
                onChange={e => setQty(native ? e.target.value : toNativeQty(e.target.value, f))}
                style={{ width: native ? 58 : 50, height: 26, border: `1px solid ${filled && native ? color : 'var(--border2)'}`, borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 3px', background: filled && native ? 'var(--blue-bg)' : item ? 'var(--bg)' : '#fafafa', fontWeight: filled && native ? 700 : 400, color: native ? undefined : 'var(--text2)' }} />
            );
          })}
        </span>
        {dateButton(side.cust.CustKey, row, `${side.cust.CustName} · ${row.ProdName}`)}
        <div>{distributionQuantityRemark(item?.ShipmentDescr, before, value, row.OutUnit) && `${distributionSlotMark(sideIndex)} ${distributionQuantityRemark(item?.ShipmentDescr, before, value, row.OutUnit)}`}</div>
        {changed && <div data-ai-verify={`before-${side.cust.CustKey}-${row.ProdKey}`} style={{ fontSize: 10, color: '#b45309', textAlign: 'right' }}>변경 전 {before} {row.OutUnit}</div>}
      </div>
    );
  };

  return (
    <>
      <div className="distribution-customer-controls">
        <label><input type="checkbox" data-ai-verify="customer-show-dates" checked={showCustomerDates} disabled={hasDateDrafts} onChange={e => setShowCustomerDates(e.target.checked)} /> 출고일 표시</label>
        {hasDateDrafts && <span>출고일 변경을 저장하거나 취소한 뒤 숨길 수 있습니다.</span>}
        {pairCust && <button type="button" className="btn btn-sm" data-ai-verify="customer-move-open" disabled={saving || pairLoading || extraLoading > 0} onClick={() => setMoveOpen(true)}>업체 간 수량 이동</button>}
        {customerReadError && <button type="button" onClick={() => selectCust(selectedCust, { skipDraftCheck: true })}>업체 1 다시 조회</button>}
        {pairReadError && <button type="button" onClick={() => selectPairCust(pairCust, { skipDraftCheck: true })}>업체 2 다시 조회</button>}
        {extraPeers.filter(p => p.error).map(p => <span key={p.cust.CustKey} role="alert">업체 {extraPeers.indexOf(p) + 3} 조회 실패 <button type="button" onClick={() => selectExtraCust(p.cust, extraPeers.indexOf(p) + 3, { skipDraftCheck: true })}>다시 조회</button></span>)}
      </div>
      <div data-distribution-scroll="cust" className="distribution-data-scroll">
        {!selectedCust
          ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">업체를 선택하세요</div></div>
          : custLoading || pairLoading || extraLoading > 0 ? <div className="skeleton" style={{ margin: 16, height: 300, borderRadius: 8 }}></div>
          : pairCust ? (
            <>
              <div data-distribution-context className="distribution-table-context">
                <div style={{ padding: '8px 14px', background: 'var(--blue-bg)', fontSize: 12, color: 'var(--blue)', fontWeight: 600, borderBottom: '1px solid var(--border-t)' }}>
                  ① {selectedCust.CustName} ↔ ② {pairCust.CustName} — 품목별 출고수량 비교 (Ctrl+S 함께 저장)
                  {extraPeers.map((p, i) => <span key={p.cust.CustKey} style={{ color: distributionPeerColor(i) }}> ↔ {distributionSlotMark(i + 2)} {p.cust.CustName}</span>)}
                  {fixedCount(pairRows) > 0 && <span data-testid="distribution-pair-fixed-count" style={{ marginLeft: 8, color: '#B91C1C' }}>🔒 확정 품목 {fixedCount(pairRows)}개 (저장 시 확정해제→저장→재확정)</span>}
                </div>
                {(() => {
                  const groups = distributionPairGroups(pairRows);
                  return (
                    <div style={{ padding: '4px 5px', borderBottom: '1px solid var(--border-t)', display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      {itemFilterInput}
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>품종</span>
                      <span data-testid="distribution-pair-group-buttons" style={{ display: 'contents' }}>
                        {['', ...groups].map(g => (
                          <button key={g || 'all'} type="button" data-ai-verify={`pair-group-${g || 'all'}`} aria-pressed={pairGroupFilter === g}
                            onClick={() => setPairGroupFilter(g)} style={pickButtonStyle(pairGroupFilter === g, true)}>{g || '전체'}</button>
                        ))}
                      </span>
                    </div>
                  );
                })()}
              </div>
              {(() => {
                const sides = pairSides();
                const colors = sides.map((_, i) => i === 0 ? 'var(--blue)' : i === 1 ? '#b45309' : distributionPeerColor(i - 2));
                const rows = pairSearchRows
                  .filter(row => matchItemName(row, custItemFilter))
                  .filter(row => distributionPairFilterMatches(row, pairGroupFilter))
                  .filter(row => !customerDate || pairSides().some(side => side.cust && dateLookup.matches(customerDate, row.ProdKey, side.cust.CustKey)));
                const itemAt = (sd, row) => sd.items.find(i => Number(i.ProdKey) === Number(row.ProdKey));
                const qtyAt = (sd, row) => { const item = itemAt(sd, row); const e = sd.inputs[row.ProdKey]; return e?.outQty !== undefined ? parseFloat(e.outQty) || 0 : (item?.출고수량 || 0); };
                const edge = i => ({ borderLeft: `2px solid ${colors[i]}` });
                return (
                  <table className="tbl" data-testid="distribution-pair-table" data-layout="multi" style={{ fontSize: 12, width: 'auto' }}>
                    <thead>
                      <tr data-testid="distribution-pair-cust-header">
                        <th rowSpan={2} className="distribution-matrix-product">품목명</th><th rowSpan={2}>단위</th>
                        {sides.map((sd, i) => (
                          <th key={sd.cust.CustKey} colSpan={2} data-ai-verify={`pair-cust-head-${i + 1}`}
                            style={{ ...edge(i), textAlign: 'center', color: colors[i], fontSize: 13, background: '#f8fafc' }}>{distributionSlotMark(i)} {sd.cust.CustName}</th>
                        ))}
                        <th rowSpan={2} style={{ textAlign: 'right' }} title="이 차수 입고 − 전체 출고(선택 업체들의 화면 변경분 반영), 저장 단위">재고잔량(변경후)</th>
                      </tr>
                      <tr>
                        {sides.map((sd, i) => [
                          <th key={`o-${i}`} style={{ ...edge(i), textAlign: 'right' }}>주문</th>,
                          <th key={`q-${i}`} style={{ textAlign: 'center', color: colors[i] }}>출고 입력 <span style={{ fontWeight: 400, fontSize: 10 }}>박스 · 단 · 송이</span>{showCustomerDates && dateHeader}</th>,
                        ])}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => {
                        const prod = products.find(p => Number(p.ProdKey) === Number(row.ProdKey));
                        const delta = sides.reduce((a, sd) => { const item = itemAt(sd, row); return a + (item ? qtyAt(sd, row) - (item.출고수량 || 0) : 0); }, 0);
                        const left = prod ? (Number(prod.inQty) || 0) - (Number(prod.outQty) || 0) - delta : null;
                        return (
                          <tr key={row.ProdKey}>
                            <td style={{ fontWeight: 500, padding: '3px 6px', whiteSpace: 'normal' }} className="distribution-matrix-product">{fixedBadge(row.ProdKey)}<span className="distribution-product-label" title={row.DisplayName || row.ProdName}>{distributeProductName(row, row.FlowerName)}</span></td>
                            <td style={{ fontSize: 11, padding: '3px 6px' }} title="저장 단위">{row.OutUnit}</td>
                            {sides.map((sd, i) => {
                              const item = itemAt(sd, row);
                              return [
                                <td key={`o-${i}`} className="num" style={{ ...edge(i), color: colors[i] }}>{item ? (item.pendingOrder ? <span style={{ fontSize: 11 }}>주문등록 예정</span> : (item.주문수량 || 0).toFixed(2)) : <span style={{ color: 'var(--text3)', fontSize: 11 }}>주문 없음</span>}</td>,
                                <td key={`q-${i}`}>{pairQtyCell(i, row, colors[i])}</td>,
                              ];
                            })}
                            <td className="num" data-ai-verify={`pair-remain-${row.ProdKey}`}>{left === null ? <span style={{ color: 'var(--text3)' }}>—</span>
                              : <span style={{ fontWeight: 700, color: left < 0 ? 'var(--red)' : left === 0 ? 'var(--green)' : 'var(--text1)' }}>{left.toFixed(2)} <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text3)' }}>{row.OutUnit}</span></span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="foot">
                        <td colSpan={2}>합계</td>
                        {sides.map((sd, i) => [
                          <td key={`o-${i}`} className="num" style={edge(i)}>{sd.items.reduce((a, b) => a + (b.주문수량 || 0), 0).toFixed(2)}</td>,
                          <td key={`q-${i}`} className="num" style={{ color: colors[i] }}>{sd.items.reduce((a, item) => a + qtyAt(sd, item), 0).toFixed(2)}</td>,
                        ])}
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                );
              })()}
            </>
          ) : (
            <>
              <div data-distribution-context className="distribution-table-context">
                <div style={{ padding: '8px 14px', background: 'var(--blue-bg)', fontSize: 12, color: 'var(--blue)', fontWeight: 600, borderBottom: '1px solid var(--border-t)' }}>
                  {selectedCust.CustName} ({selectedCust.OrderCode}) — 주문 품목 목록
                  {itemFilterInput}
                </div>
                <div data-testid="distribution-single-group-buttons" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', padding: '4px 5px' }}>
                  <span style={{ fontSize: 11 }}>품종</span>
                  {['', ...distributionPairGroups(custItems)].map(g => <button key={g || 'all'} type="button" data-ai-verify={`single-group-${g || 'all'}`} aria-pressed={pairGroupFilter === g} onClick={() => setPairGroupFilter(g)} style={pickButtonStyle(pairGroupFilter === g, true)}>{g || '전체'}</button>)}
                </div>
              </div>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>국가</th><th>꽃</th><th>품목명</th><th>단위</th>
                    <th style={{ textAlign: 'right', color: 'var(--blue)' }}>주문수량</th>
                    <th style={{ textAlign: 'right', color: 'var(--blue)' }}>출고수량 입력</th>
                    <th style={{ textAlign: 'center' }}>박스 · 단 · 송이</th>
                    <th style={{ textAlign: 'right' }}>잔량</th>
                    <th style={{ textAlign: 'right', color: 'var(--amber)' }}>단가 (편집)</th>
                    <th style={{ textAlign: 'right', color: 'var(--text3)' }}>금액</th>
                    <th style={{ padding: 0 }}>{showCustomerDates && dateHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {custSearchRows.length === 0
                    ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{String(custItemFilter || '').trim() ? '검색 결과 없음' : '주문 데이터 없음'}</td></tr>
                    : custSearchRows.map((item, i) => {
                      if (item.searchOnly) {
                        return (
                          <tr key={`search-${item.ProdKey}`} data-ai-verify={`search-only-${selectedCust.CustKey}-${item.ProdKey}`} style={{ background: '#fafafa', color: 'var(--text2)' }}>
                            <td style={{ fontSize: 11 }}>{item.CounName}</td>
                            <td style={{ fontSize: 11 }}>{item.FlowerName}</td>
                            <td style={{ fontWeight: 500 }}><span className="distribution-product-label" title={item.DisplayName || item.ProdName}>{distributeProductName(item, item.FlowerName)}</span> <span style={{ fontSize: 10, color: '#b45309' }}>주문 없음</span></td>
                            <td style={{ fontSize: 11 }}>{item.OutUnit}</td>
                            <td className="num" style={{ color: 'var(--text3)' }}>0.00</td>
                            <td>
                              <input type="number" min={0} step={0.1} value="" placeholder="수량" data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                                data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}`}
                                aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${item.OutUnit || ''})`}
                                title="주문 없음: 입력하면 저장 시 주문등록 후 분배"
                                onKeyDown={handleQuantityEnter}
                                onChange={e => addCustSearchItem(item, e.target.value)}
                                style={{ width: 80, height: 26, border: '1px dashed var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: 'var(--bg)' }}
                              />
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              {['박스', '단', '송이'].map(unit => {
                                const f = distributionUnitFactor(item, unit);
                                return (
                                  <input key={unit} type="number" min={0} step={0.01} placeholder={unit} disabled={hasDateDrafts || saving || loading || !f} value=""
                                    data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}-${unit}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${unit})`}
                                    title={f ? `${unit} 입력 → 저장 단위 ${item.OutUnit}` : `${unit}: 입수 정보가 없어 환산 불가`}
                                    onChange={e => addCustSearchItem(item, toNativeQty(e.target.value, f))}
                                    style={{ width: 52, height: 26, marginRight: 2, border: '1px dashed var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 3px', background: 'var(--bg)', color: 'var(--text2)' }} />
                                );
                              })}
                            </td>
                            <td className="num" style={{ color: 'var(--text3)' }}>0.00</td>
                            <td className="num" style={{ color: 'var(--text3)' }}>{item.Cost ? fmt(Math.round(item.Cost)) : '—'}</td>
                            <td className="num" style={{ color: 'var(--text3)' }}>—</td>
                            <td style={{ fontSize: 11, color: 'var(--text3)' }}>수량 입력 시 저장할 때 주문등록 후 분배</td>
                          </tr>
                        );
                      }
                      const edit = custEditInputs[item.ProdKey] || {};
                      const outVal = edit.outQty !== undefined ? edit.outQty : (item.출고수량 || 0);
                      const costVal = edit.cost !== undefined ? edit.cost : (item.Cost || 0);
                      const diff = (item.주문수량 || 0) - parseFloat(outVal || 0);
                      const amount = parseFloat(outVal || 0) * parseFloat(costVal || 0);
                      return (
                        <tr key={i} style={{ background: item.잔량 > 0 ? '#FFFBEB' : undefined }}>
                          <td style={{ fontSize: 11 }}>{item.CounName}</td>
                          <td style={{ fontSize: 11 }}>{item.FlowerName}</td>
                          <td style={{ fontWeight: 500 }}>{fixedBadge(item.ProdKey)}<span className="distribution-product-label" title={item.DisplayName || item.ProdName}>{distributeProductName(item, item.FlowerName)}</span></td>
                          <td style={{ fontSize: 11 }}>{item.OutUnit}</td>
                          <td className="num" style={{ color: 'var(--blue)', fontWeight: 700 }}>{(item.주문수량 || 0).toFixed(2)}</td>
                          <td>
                            <input type="number" min={0} step={0.1} value={outVal || ''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                              data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}`}
                              aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${item.OutUnit || ''})`}
                              onKeyDown={handleQuantityEnter}
                              onChange={e => setCustEditInputs(prev => ({ ...prev, [item.ProdKey]: { ...(prev[item.ProdKey] || {}), outQty: e.target.value } }))}
                              style={{ width: 80, height: 26, border: `1px solid ${parseFloat(outVal) > 0 ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: parseFloat(outVal) > 0 ? 'var(--blue-bg)' : 'var(--bg)', fontWeight: parseFloat(outVal) > 0 ? 700 : 400 }}
                            />
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {['박스', '단', '송이'].map(unit => {
                              const f = distributionUnitFactor(item, unit);
                              return (
                                <input key={unit} type="number" min={0} step={0.01} placeholder={unit} disabled={hasDateDrafts || saving || loading || !f}
                                  value={parseFloat(outVal) > 0 && f ? toDisplayQty(outVal, f) : ''}
                                  data-ai-verify={`qty-${selectedCust.CustKey}-${item.ProdKey}-${unit}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 출고수량 (${unit})`}
                                  title={f ? `${unit} 입력 → 저장 단위 ${item.OutUnit}` : `${unit}: 입수 정보가 없어 환산 불가`}
                                  onChange={e => setCustEditInputs(prev => ({ ...prev, [item.ProdKey]: { ...(prev[item.ProdKey] || {}), outQty: toNativeQty(e.target.value, f) } }))}
                                  style={{ width: 52, height: 26, marginRight: 2, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 3px', background: 'var(--bg)', color: 'var(--text2)' }} />
                              );
                            })}
                          </td>
                          <td className="num" style={{ fontWeight: 700, color: diff < 0 ? 'var(--red)' : diff === 0 ? 'var(--green)' : 'var(--amber)' }}>{diff.toFixed(2)}</td>
                          <td>
                            <input type="number" min={0} step={1} value={costVal || ''} disabled={hasDateDrafts || saving || loading}
                              data-ai-verify={`cost-${selectedCust.CustKey}-${item.ProdKey}`} aria-label={`${selectedCust.CustName} ${item.ProdName} 단가`}
                              onChange={e => setCustEditInputs(prev => ({ ...prev, [item.ProdKey]: { ...(prev[item.ProdKey] || {}), cost: e.target.value } }))}
                              style={{ width: 90, height: 26, border: '1px solid var(--amber)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: '#FFFBEB' }}
                            />
                          </td>
                          <td className="num" style={{ color: 'var(--text2)' }}>{amount > 0 ? fmt(Math.round(amount)) : '—'}</td>
                          <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                            {dateButton(selectedCust.CustKey, item, `${selectedCust.CustName} · ${item.ProdName}`)}<div>{distributionQuantityRemark(item.ShipmentDescr, item.출고수량, outVal, item.OutUnit)}</div>
                            {item.비고 && item.비고 !== item.ShipmentDescr && <div>주문 메모: {item.비고}</div>}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={4}>합계</td>
                    <td className="num">{custItems.reduce((a, b) => a + (b.주문수량 || 0), 0).toFixed(2)}</td>
                    <td className="num" style={{ color: 'var(--blue)' }}>
                      {custItems.reduce((a, item) => { const e = custEditInputs[item.ProdKey] || {}; return a + parseFloat(e.outQty !== undefined ? e.outQty : (item.출고수량 || 0)) || 0; }, 0).toFixed(2)}
                    </td>
                    <td></td>
                    <td className="num">
                      {custItems.reduce((a, item) => { const e = custEditInputs[item.ProdKey] || {}; const q = parseFloat(e.outQty !== undefined ? e.outQty : (item.출고수량 || 0)) || 0; return a + ((item.주문수량 || 0) - q); }, 0).toFixed(2)}
                    </td>
                    <td></td>
                    <td className="num" style={{ color: 'var(--text2)', fontWeight: 700 }}>
                      {fmt(Math.round(custItems.reduce((a, item) => { const e = custEditInputs[item.ProdKey] || {}; const q = parseFloat(e.outQty !== undefined ? e.outQty : (item.출고수량 || 0)) || 0; const c = parseFloat(e.cost !== undefined ? e.cost : (item.Cost || 0)) || 0; return a + q * c; }, 0)))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </>
          )}
      </div>
    </>
  );
}
