import { useState, useEffect } from 'react';
import { useWeekInput, getCurrentWeek, WeekInput } from '../../lib/useWeekInput';
import { apiGetExe } from '../../lib/exeParity/client.js';
import { useLang } from '../../lib/i18n';
import { downloadTextFile, makeDatedFilename } from '../../lib/exportUtils';

const fmt = n => Number(n || 0).toLocaleString();
const escSvg = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

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
    apiGetExe('/api/shipment', { week: weekInput.value, custName: custFilter, area: areaFilter })
      .then(d => { setShipments(d.shipments || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (weekInput.value) load(); }, [weekInput.value]);

  const selectRow = (id) => {
    setSelectedId(id);
    setDetailLoading(true);
    apiGetExe(`/api/shipment/${id}`)
      .then(d => setDetails(d.items || []))
      .catch(() => setDetails([]))
      .finally(() => setDetailLoading(false));
  };

  const selected = shipments.find(s => s.ShipmentKey === selectedId);

  const handlePrint = () => {
    if (!selected) {
      alert('출고 목록에서 거래처를 먼저 선택하세요.');
      return;
    }
    window.print();
  };

  const handleImageDownload = () => {
    if (!selected) {
      alert('출고 목록에서 거래처를 먼저 선택하세요.');
      return;
    }
    if (details.length === 0) {
      alert('이미지로 저장할 출고 상세가 없습니다.');
      return;
    }
    const width = 980;
    const rowHeight = 26;
    const headerHeight = 104;
    const height = headerHeight + (details.length + 2) * rowHeight + 28;
    const totalQty = details.reduce((a, b) => a + (b.OutQuantity || 0), 0);
    const totalAmount = details.reduce((a, b) => a + (b.Amount || 0), 0);
    const rowSvg = details.map((item, i) => {
      const y = headerHeight + i * rowHeight;
      return `
        <rect x="24" y="${y}" width="932" height="${rowHeight}" fill="${i % 2 ? '#f8fafc' : '#ffffff'}" stroke="#d7dde5"/>
        <text x="36" y="${y + 17}" font-size="13">${escSvg(item.ShipmentDtm)}</text>
        <text x="145" y="${y + 17}" font-size="13">${escSvg(item.CounName)}</text>
        <text x="240" y="${y + 17}" font-size="13">${escSvg(item.FlowerName)}</text>
        <text x="345" y="${y + 17}" font-size="13">${escSvg(item.ProdName)}</text>
        <text x="720" y="${y + 17}" font-size="13">${escSvg(item.unit)}</text>
        <text x="830" y="${y + 17}" font-size="13" text-anchor="end">${escSvg(fmt(item.OutQuantity))}</text>
        <text x="942" y="${y + 17}" font-size="13" text-anchor="end">${escSvg(fmt(item.Amount))}</text>`;
    }).join('');
    const totalY = headerHeight + details.length * rowHeight;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="24" y="34" font-size="22" font-weight="700">${escSvg(selected.CustName)} 출고 상세</text>
      <text x="24" y="60" font-size="13" fill="#526071">차수 ${escSvg(weekInput.value || selected.OrderWeek)} · ${escSvg(selected.CustArea || '')} · ${escSvg(selected.Manager || '')}</text>
      <rect x="24" y="76" width="932" height="28" fill="#e8eef6" stroke="#cfd7e2"/>
      <text x="36" y="95" font-size="13" font-weight="700">출고일</text>
      <text x="145" y="95" font-size="13" font-weight="700">국가</text>
      <text x="240" y="95" font-size="13" font-weight="700">꽃</text>
      <text x="345" y="95" font-size="13" font-weight="700">품목명</text>
      <text x="720" y="95" font-size="13" font-weight="700">단위</text>
      <text x="830" y="95" font-size="13" font-weight="700" text-anchor="end">출고수량</text>
      <text x="942" y="95" font-size="13" font-weight="700" text-anchor="end">금액</text>
      ${rowSvg}
      <rect x="24" y="${totalY}" width="932" height="${rowHeight}" fill="#eef7ee" stroke="#cfd7e2"/>
      <text x="36" y="${totalY + 17}" font-size="13" font-weight="700">합계</text>
      <text x="830" y="${totalY + 17}" font-size="13" font-weight="700" text-anchor="end">${escSvg(fmt(totalQty))}</text>
      <text x="942" y="${totalY + 17}" font-size="13" font-weight="700" text-anchor="end">${escSvg(fmt(totalAmount))}</text>
    </svg>`;
    downloadTextFile(makeDatedFilename(`출고상세_${selected.CustName}`, 'svg'), svg, 'image/svg+xml;charset=utf-8;');
  };

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
          <button className="btn btn-secondary" onClick={handlePrint}>🖨️ 출고물량표 출력</button>
          <button className="btn btn-secondary" onClick={handleImageDownload}>📷 이미지 다운로드</button>
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
