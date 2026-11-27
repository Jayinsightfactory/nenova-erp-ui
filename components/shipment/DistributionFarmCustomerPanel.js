import { distributeProductName } from '../../lib/distributeProductDisplay';
import { customerMatchesSearch } from '../../lib/customerSearch';
import {
  distributionQuantityRemark,
  sortDistributionCustomers,
  distributionUnitFactor,
  toDisplayQty,
  toNativeQty,
} from '../../lib/shipmentDistributionWorkspace.js';
import { fmt, pickButtonStyle } from '../../lib/shipmentDistributionPageHelpers.js';

export default function DistributionFarmCustomerPanel({
  selectedProd,
  selectedFlower,
  distLoading,
  farmCustomerSearch,
  setFarmCustomerSearch,
  visibleFarmCustomerRows,
  custDistRows,
  custDist,
  prodAddOpen,
  setProdAddOpen,
  loadAllCustomers,
  prodAddedCusts,
  setProdAddedCusts,
  allCustomers,
  prodAddFilter,
  setProdAddFilter,
  prodAddManager,
  setProdAddManager,
  outInputs,
  setOutInputs,
  totalOutInput,
  remain,
  hasDateDrafts,
  saving,
  loading,
  dateHeader,
  dateButton,
  handleQuantityEnter,
  selectedDistCust,
  selectDistCustRow,
  farmLoading,
  farmRows,
}) {
  return (
    <div data-distribution-scroll="prod" className="distribution-data-scroll">
      {!selectedProd
        ? <div className="empty-state"><div className="empty-icon">←</div><div className="empty-text">품목을 선택하세요</div></div>
        : distLoading ? <div className="skeleton" style={{ margin: 16, height: 200, borderRadius: 8 }}></div>
        : (
          <>
            <div data-distribution-context data-testid="distribution-item-context" className="distribution-table-context" style={{ padding: '4px 5px', background: 'var(--blue-bg)', fontSize: 12, color: 'var(--blue)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{distributeProductName(selectedProd, selectedFlower)} — 거래처 분배 정보</span>
              <input className="filter-input" placeholder="업체명 검색 (분배 업체)" value={farmCustomerSearch}
                data-ai-verify="farm-distribution-customer-search" aria-label="농장정보 분배 업체 검색"
                onChange={e => setFarmCustomerSearch(e.target.value)} style={{ height: 25, fontSize: 11, width: 190, background: 'white' }} />
              <span role="status" style={{ fontSize: 10, fontWeight: 400, color: 'var(--text3)' }}>{visibleFarmCustomerRows.length}/{custDistRows.length}곳</span>
              <button type="button" className="btn btn-sm" data-ai-verify="prod-add-cust-open" disabled={hasDateDrafts || saving || loading}
                onClick={async () => { const next = !prodAddOpen; setProdAddOpen(next); if (next) await loadAllCustomers(); }}
                style={{ padding: '1px 8px', fontSize: 11 }}>{prodAddOpen ? '업체추가 닫기' : '+ 업체추가'}</button>
              {prodAddedCusts.length > 0 && <span style={{ fontWeight: 400, color: '#b45309' }}>추가 업체 {prodAddedCusts.length}곳 · 여러 업체 추가 후 수량을 입력하고 상단 저장</span>}
            </div>
            {prodAddOpen && (() => {
              const managers = [...new Set(allCustomers.map(c => c.Manager || '담당자 없음'))].sort((a, b) => a.localeCompare(b, 'ko'));
              const addText = prodAddFilter.trim().toLowerCase();
              const list = addText
                ? sortDistributionCustomers(allCustomers.filter(c => (!prodAddManager || (c.Manager || '담당자 없음') === prodAddManager) && customerMatchesSearch(c, addText))).slice(0, 60)
                : prodAddManager ? sortDistributionCustomers(allCustomers.filter(c => (c.Manager || '담당자 없음') === prodAddManager)) : [];
              return (
                <div data-testid="distribution-prod-add-cust" style={{ padding: '4px 5px', borderBottom: '1px solid var(--border-t)', display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input className="filter-input" placeholder="업체명 검색" value={prodAddFilter} data-ai-verify="prod-add-cust-search" aria-label="업체추가 업체명 검색"
                      onChange={e => setProdAddFilter(e.target.value)} style={{ height: 26, fontSize: 12, width: 150, marginRight: 6 }} />
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>담당자</span>
                    {allCustomers.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>불러오는 중…</span>}
                    {managers.map(m => (
                      <button key={m} type="button" data-ai-verify={`prod-add-manager-${m}`} aria-pressed={prodAddManager === m}
                        onClick={() => setProdAddManager(prev => prev === m ? null : m)} style={pickButtonStyle(prodAddManager === m, true)}>{m}</button>
                    ))}
                  </div>
                  {(prodAddManager || addText) && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>업체</span>
                      {list.length === 0 && <span style={{ fontSize: 11, color: 'var(--text3)' }}>검색 결과 없음</span>}
                      {list.map(c => {
                        const inDist = custDist.some(d => Number(d.CustKey) === Number(c.CustKey));
                        const added = prodAddedCusts.some(a => Number(a.CustKey) === Number(c.CustKey));
                        return (
                          <button key={c.CustKey} type="button" data-ai-verify={`prod-add-cust-${c.CustKey}`} aria-pressed={added || inDist} disabled={inDist || saving}
                            title={inDist ? '이미 이 품목 주문이 있는 업체' : added ? '다시 누르면 빼기' : '추가'}
                            onClick={() => setProdAddedCusts(prev => added ? prev.filter(a => Number(a.CustKey) !== Number(c.CustKey)) : [...prev, c])}
                            style={pickButtonStyle(added || inDist, false)}>{added ? '✓ ' : ''}{c.CustName}</button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
            <table className="tbl distribution-customer-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th>거래처명</th><th>주문코드</th><th>단위</th>
                  <th style={{ textAlign: 'right' }}>주문수량</th>
                  <th style={{ textAlign: 'right', color: 'var(--blue)' }}>출고수량 입력</th>
                  <th style={{ textAlign: 'right' }}>차이</th>
                  <th style={{ textAlign: 'right' }}>Box수량</th>
                  <th style={{ textAlign: 'right' }}>단수량</th>
                  <th style={{ textAlign: 'right' }}>송이수량</th>
                  <th style={{ textAlign: 'right' }}>단가</th>
                  <th style={{ padding: 0 }}>{dateHeader}</th>
                </tr>
              </thead>
              <tbody>
                {visibleFarmCustomerRows.length === 0
                  ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 24, color: 'var(--text3)' }}>{farmCustomerSearch.trim() ? '검색 결과가 없습니다.' : '주문 데이터 없음 — 위 「+ 업체추가」로 업체를 넣을 수 있습니다'}</td></tr>
                  : visibleFarmCustomerRows.map(c => {
                    const outVal = outInputs[c.CustKey] || 0;
                    const diff = (c.주문수량 || 0) - outVal;
                    const unitCell = (unit) => {
                      const f = distributionUnitFactor(selectedProd, unit);
                      return (
                        <td key={unit} style={{ textAlign: 'right' }}>
                          <input type="number" min={0} step={0.01} placeholder={unit} value={outVal && f ? toDisplayQty(outVal, f) : ''} disabled={hasDateDrafts || saving || loading || !f}
                            data-ai-verify={`qty-${c.CustKey}-${selectedProd.ProdKey}-${unit}`} aria-label={`${c.CustName} ${selectedProd.ProdName} 출고수량 (${unit})`}
                            title={f ? `${unit} 입력 → 저장 단위 ${selectedProd.OutUnit} 로 환산` : `${unit}: 입수 정보가 없어 환산 불가`}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { const v = Number(toNativeQty(e.target.value, f)) || 0; setOutInputs(o => ({ ...o, [c.CustKey]: v })); }}
                            style={{ width: 62, height: 26, border: '1px solid var(--border2)', borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: 'var(--bg)' }} />
                        </td>
                      );
                    };
                    const isSel = selectedDistCust?.CustKey === c.CustKey;
                    return (
                      <tr key={c.CustKey}
                        onClick={() => selectDistCustRow(c)}
                        style={{ cursor: 'pointer', background: isSel ? 'var(--blue-bg)' : undefined }}>
                        <td className="name" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{c.CustName}
                          {c.addedNoOrder && <span style={{ fontSize: 10, color: '#b45309', marginLeft: 4 }}>주문 없음 · 저장 시 주문등록</span>}
                          {c.addedNoOrder && <button type="button" className="btn btn-sm" data-ai-verify={`prod-added-remove-${c.CustKey}`} disabled={hasDateDrafts || saving}
                            onClick={e => { e.stopPropagation(); setProdAddedCusts(prev => prev.filter(a => Number(a.CustKey) !== Number(c.CustKey))); setOutInputs(o => { const n = { ...o }; delete n[c.CustKey]; return n; }); }}
                            style={{ padding: '0 5px', fontSize: 10, marginLeft: 4 }}>✕</button>}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.주문코드}</td>
                        <td style={{ fontSize: 11 }}>{selectedProd.OutUnit || c.OutUnit || '—'}</td>
                        <td className="num">{(c.주문수량 || 0).toFixed(2)}</td>
                        <td>
                          <input type="number" min={0} step={1} value={outVal || ''} data-distribute-qty="true" aria-keyshortcuts="Enter" disabled={hasDateDrafts || saving || loading}
                            data-ai-verify={`qty-${c.CustKey}-${selectedProd.ProdKey}`}
                            aria-label={`${c.CustName} ${selectedProd.ProdName} 출고수량 (${selectedProd.OutUnit || c.OutUnit || ''})`}
                            onKeyDown={handleQuantityEnter}
                            onChange={e => { const v = parseFloat(e.target.value) || 0; setOutInputs(o => ({ ...o, [c.CustKey]: v })); }}
                            style={{ width: 75, height: 26, border: `1px solid ${outVal > 0 ? 'var(--blue)' : 'var(--border2)'}`, borderRadius: 4, textAlign: 'right', fontSize: 12, fontFamily: 'var(--mono)', padding: '0 4px', background: outVal > 0 ? 'var(--blue-bg)' : 'var(--bg)', fontWeight: outVal > 0 ? 700 : 400 }}
                          />
                        </td>
                        <td className="num" style={{ color: diff < 0 ? 'var(--red)' : diff === 0 ? 'var(--green)' : 'var(--text3)' }}>{diff.toFixed(2)}</td>
                        {['박스', '단', '송이'].map(unitCell)}
                        <td className="num">{fmt(c.Cost || selectedProd.Cost || 0)}</td>
                        <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                          {dateButton(c.CustKey, { ...selectedProd, ...c, ProdKey: selectedProd.ProdKey }, `${c.CustName} · ${selectedProd.ProdName}`)}
                          <div>{distributionQuantityRemark(c.ShipmentDescr, c.출고수량, outVal, selectedProd.OutUnit || c.OutUnit)}</div>
                          {c.비고 && c.비고 !== c.ShipmentDescr && <div>주문 메모: {c.비고}</div>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
              <tfoot>
                <tr className="foot">
                  <td colSpan={3}>합계</td>
                  <td className="num">{custDist.reduce((a, b) => a + (b.주문수량 || 0), 0).toFixed(2)}</td>
                  <td className="num" style={{ color: 'var(--blue)' }}>{totalOutInput.toFixed(2)}</td>
                  <td className="num" style={{ color: remain < 0 ? 'var(--red)' : remain === 0 ? 'var(--green)' : 'var(--amber)' }}>{remain.toFixed(2)}</td>
                  <td colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
            <div style={{ borderTop: '2px solid var(--border)', padding: '8px 14px', background: '#FAFAFA' }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text2)' }}>
                ≡ 농장 정보
                {selectedDistCust ? ` — ${selectedDistCust.CustName}` : ' (거래처 행 클릭)'}
              </div>
              {farmLoading ? (
                <div className="skeleton" style={{ height: 60, borderRadius: 6 }} />
              ) : !selectedDistCust ? (
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>위 분배표에서 거래처를 클릭하면 농장별 입고/출고 잔량이 표시됩니다.</div>
              ) : farmRows.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>농장 데이터 없음</div>
              ) : (
                <table className="tbl" style={{ fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th>농장명</th><th>코드</th><th>주문코드</th>
                      <th style={{ textAlign: 'right' }}>입고</th>
                      <th style={{ textAlign: 'right' }}>출고</th>
                      <th style={{ textAlign: 'right' }}>잔량</th>
                    </tr>
                  </thead>
                  <tbody>
                    {farmRows.map((f, i) => (
                      <tr key={i}>
                        <td>{f.FarmName}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{f.FarmCode}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{f.OrderCode}</td>
                        <td className="num">{(f.wOutQuantity ?? 0).toLocaleString()}</td>
                        <td className="num">{(f.sOutQuantity ?? 0).toLocaleString()}</td>
                        <td className="num" style={{ fontWeight: 700, color: (f.Remainuantity || 0) < 0 ? 'var(--red)' : 'var(--green)' }}>
                          {(f.Remainuantity ?? 0).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
    </div>
  );
}
