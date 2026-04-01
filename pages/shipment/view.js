import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { apiGet } from '../../lib/useApi';
import { useLang } from '../../lib/i18n';

const fmt = n => Number(n || 0).toLocaleString();

export default function ShipmentView() {
  const { t } = useLang();
  const [shipments, setShipments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [details, setDetails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const weekInput = useWeekInput('');
  const [custFilter, setCustFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    apiGet('/api/shipment', { week: weekInput.value, custName: custFilter, area: areaFilter })
      .then(d => { setShipments(d.shipments || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const selectRow = (id) => {
    setSelectedId(id);
    setDetailLoading(true);
    apiGet(`/api/shipment/${id}`)
      .then(d => setDetails(d.items || []))
      .catch(() => setDetails([]))
      .finally(() => setDetailLoading(false));
  };

  const selected = shipments.find(s => s.ShipmentKey === selectedId);

  return (
    <div>
      <div className="filter-bar">
        <WeekInput weekInput={weekInput} label="차수" />
        <span className="filter-label">거래처</span>
        <input className="filter-input" placeholder="거래처명" value={custFilter} onChange={e => setCustFilter(e.target.value)} style={{ minWidth: 140 }} />
        <span className="filter-label">지역</span>
        <select className="filter-select" value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
          <option value="">전체</option>
          <option>경부선</option><option>양재동</option><option>지방</option><option>호남선</option>
        </select>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={load}>🔄 조회 / Buscar</button>
          <button className="btn btn-secondary">🖨️ 출고물량표 출력</button>
          <button className="btn btn-secondary">📷 이미지 다운로드</button>
        </div>
      </div>
      {err && <div style={{ padding: '10px 14px', background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>⚠️ {err}</div>}
      <div className="split-panel">
        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">출고 목록</span>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{shipments.length}개</span>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? <div className="skeleton" style={{ margin: 16, height: 200, borderRadius: 8 }}></div> : (
              <table className="tbl">
                <thead><tr><th>차수</th><th>거래처</th><th style={{ textAlign: 'right' }}>총 출고</th><th>확정</th></tr></thead>
                <tbody>
                  {shipments.map(s => (
                    <tr key={s.ShipmentKey} className={selectedId === s.ShipmentKey ? 'selected' : ''} onClick={() => selectRow(s.ShipmentKey)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{s.OrderWeek}</td>
                      <td>
                        <div className="name">{s.CustName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.CustArea} · {s.Manager}</div>
                      </td>
                      <td className="num">{fmt(s.totalQty)}</td>
                      <td>{s.isFix ? <span className="badge badge-green">확정</span> : <span className="badge badge-gray">미확정</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="foot"><td colSpan={2}>합계</td><td className="num">{fmt(shipments.reduce((a, b) => a + (b.totalQty || 0), 0))}</td><td></td></tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
        <div className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">출고 상세</span>
            {selected && <span style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600 }}>{selected.CustName}</span>}
          </div>
          {!selectedId ? (
            <div className="empty-state"><div className="empty-icon">🔍</div><div className="empty-text">거래처를 선택하세요</div></div>
          ) : detailLoading ? (
            <div className="skeleton" style={{ margin: 16, height: 200, borderRadius: 8 }}></div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table className="tbl">
                <thead><tr><th>출고일</th><th>국가</th><th>꽃</th><th>품목명</th><th>단위</th><th style={{ textAlign: 'right' }}>출고수량</th><th style={{ textAlign: 'right' }}>금액</th></tr></thead>
                <tbody>
                  {details.map((item, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.ShipmentDtm}</td>
                      <td><span className="badge badge-gray">{item.CounName}</span></td>
                      <td style={{ fontSize: 12 }}>{item.FlowerName}</td>
                      <td style={{ fontSize: 12, fontWeight: 500 }}>{item.ProdName}</td>
                      <td style={{ fontSize: 12 }}>{item.unit}</td>
                      <td className="num">{fmt(item.OutQuantity)}</td>
                      <td className="num">{fmt(item.Amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="foot">
                    <td colSpan={5}>합계</td>
                    <td className="num">{fmt(details.reduce((a, b) => a + (b.OutQuantity || 0), 0))}</td>
                    <td className="num">{fmt(details.reduce((a, b) => a + (b.Amount || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
